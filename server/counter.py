#!/usr/bin/env python3
"""Compteur mondial GROUND//ZERO — petit service HTTP sans dépendance (bibliothèque standard).

  GET  /stats   → {"strikes", "deaths", "injured", "updated"}
  POST /strike  ← {"yieldKt", "lat", "lon", "burst"}  → mêmes totaux, mis à jour

Le navigateur n'envoie jamais de nombre de victimes : le serveur les recalcule à partir de la
puissance et de la position, avec les mêmes formules que la page (src/nuke/physics.js), ce qui
empêche de gonfler les chiffres. Limite anti-spam par adresse IP. Stockage : un fichier JSON
écrit de façon atomique. Écoute uniquement en local ; Caddy fait le relais public.
"""

import json
import math
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = os.environ.get("GZ_HOST", "127.0.0.1")
PORT = int(os.environ.get("GZ_PORT", "8787"))
STATE_DIR = Path(os.environ.get("STATE_DIRECTORY", os.environ.get("GZ_STATE_DIR", "./state")))
STATE_FILE = STATE_DIR / "stats.json"
CITIES = json.loads((Path(__file__).with_name("cities.json")).read_text(encoding="utf-8"))

MIN_INTERVAL_S = 4.0      # une frappe toutes les 4 s au plus par adresse
MAX_PER_HOUR = 40         # et 40 par heure
MAX_BODY = 1024
# seules ces origines peuvent poster depuis un navigateur (bloque l'envoi forcé depuis un autre site)
ALLOWED_ORIGINS = set(os.environ.get("GZ_ALLOWED_ORIGINS", "https://airfall.dev").split())

# ---------- Physique (portage de src/nuke/physics.js, partie victimes) ----------


def js_round(x):
    """Arrondi identique à Math.round en JavaScript (et non l'arrondi bancaire de Python)."""
    return math.floor(x + 0.5)


def check_rough_landmask(lat, lon):
    if lat < -65:
        return True
    if 15 < lat < 72 and -168 < lon < -52:
        if lat < 25 and -98 < lon < -82:
            return False
        return True
    if -56 < lat <= 12 and -81 < lon < -34:
        return True
    if 36 < lat < 71 and -10 < lon < 60:
        return True
    if -35 < lat <= 37 and -17 < lon < 51:
        if lat < 4 and lon < 8:
            return False
        return True
    if 8 < lat < 75 and 40 <= lon < 145:
        return True
    if -10 < lat < 46 and 95 <= lon < 146:
        return True
    if -43 < lat < -11 and 113 < lon < 154:
        return True
    return False


def population_density(lat, lon):
    for c in CITIES:
        d_lat = (lat - c["lat"]) * 111.32
        d_lon = (lon - c["lon"]) * 111.32 * math.cos(lat * math.pi / 180)
        dist = math.hypot(d_lat, d_lon)
        if dist < 8:
            return c["density"]
        if dist < 35:
            return max(40, js_round(c["density"] * math.exp(-dist / 14)))
    if not check_rough_landmask(lat, lon):
        return 0
    if abs(lat) > 66:
        return 3
    if (14 < lat < 31 and -15 < lon < 55) or (-30 < lat < -18 and 118 < lon < 142):
        return 35
    h = abs(math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453) % 1
    return js_round(45 + h * 280)


def casualties(yield_kt, lat, lon, burst):
    y = max(0.001, yield_kt)
    y13 = y ** (1 / 3)
    air = burst == "airburst"
    r20 = (218.1 if air else 178.0) * y13 / 1000
    r5 = (486.6 if air else 365.0) * y13 / 1000
    att = 1 / (1 + 0.0035 * y ** 0.32)
    rth = max(r5, (710.0 if air else 590.0) * y ** 0.41 * att / 1000)
    r1 = max(rth, (1257.0 if air else 940.0) * y13 / 1000)
    a20 = math.pi * r20 * r20
    a5 = max(0, math.pi * r5 * r5 - a20)
    ath = max(0, math.pi * rth * rth - math.pi * r5 * r5)
    a1 = max(0, math.pi * r1 * r1 - math.pi * rth * rth)
    d = population_density(lat, lon)
    deaths = js_round(d * (a20 * 0.98 + a5 * 0.48 + ath * 0.14))
    injured = js_round(d * (a20 * 0.02 + a5 * 0.44 + ath * 0.50 + a1 * 0.25))
    return deaths, injured


# ---------- État persistant ----------

lock = threading.Lock()
recent = {}  # ip -> [horodatages des frappes de la dernière heure]


def load_state():
    try:
        s = json.loads(STATE_FILE.read_text())
        return {k: int(s.get(k, 0)) for k in ("strikes", "deaths", "injured")}
    except (FileNotFoundError, ValueError):
        return {"strikes": 0, "deaths": 0, "injured": 0}


def save_state(s):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(s))
    os.replace(tmp, STATE_FILE)  # écriture atomique


state = load_state()


def snapshot():
    return {**state, "updated": int(time.time())}


def allow(ip):
    now = time.time()
    hits = [t for t in recent.get(ip, []) if now - t < 3600]
    if (hits and now - hits[-1] < MIN_INTERVAL_S) or len(hits) >= MAX_PER_HOUR:
        recent[ip] = hits
        return False
    hits.append(now)
    recent[ip] = hits
    if len(recent) > 50000:  # garde la mémoire bornée
        for k in [k for k, v in recent.items() if not v or now - v[-1] > 3600]:
            recent.pop(k, None)
    return True


# ---------- HTTP ----------


class Handler(BaseHTTPRequestHandler):
    server_version = "gz-counter/1.0"

    def log_message(self, fmt, *args):  # journal discret (systemd)
        pass

    def send_json(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def client_ip(self):
        # derrière Caddy : la première adresse de X-Forwarded-For est celle du visiteur
        fwd = self.headers.get("X-Forwarded-For", "")
        return fwd.split(",")[0].strip() or self.client_address[0]

    def do_GET(self):
        if self.path.split("?")[0] == "/stats":
            with lock:
                return self.send_json(200, snapshot())
        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/strike":
            return self.send_json(404, {"error": "not found"})
        # un formulaire ou un script d'un autre site ne peut ni imposer cette origine ni ce type
        origin = self.headers.get("Origin")
        if origin is not None and origin not in ALLOWED_ORIGINS:
            return self.send_json(403, {"error": "forbidden origin"})
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            return self.send_json(415, {"error": "json expected"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > MAX_BODY:
                raise ValueError("taille")
            req = json.loads(self.rfile.read(n))
            y = float(req["yieldKt"])
            lat = float(req["lat"])
            lon = float(req["lon"])
            burst = req.get("burst", "airburst")
            if not (0.001 <= y <= 100000 and -90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError("plage")
            if burst not in ("airburst", "surface") or not all(map(math.isfinite, (y, lat, lon))):
                raise ValueError("valeurs")
        except (ValueError, KeyError, TypeError, json.JSONDecodeError):
            return self.send_json(400, {"error": "bad request"})
        with lock:
            if not allow(self.client_ip()):
                return self.send_json(429, {"error": "too many strikes", **snapshot()})
            deaths, injured = casualties(y, lat, lon, burst)
            state["strikes"] += 1
            state["deaths"] += deaths
            state["injured"] += injured
            save_state(state)
            return self.send_json(200, {**snapshot(), "strike": {"deaths": deaths, "injured": injured}})


if __name__ == "__main__":
    ThreadingHTTPServer.daemon_threads = True
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"gz-counter sur {HOST}:{PORT}, état dans {STATE_FILE}", flush=True)
    httpd.serve_forever()

// Contrôles façon Google Earth : on « saisit » la Terre, zoom vers le curseur,
// clic droit / Ctrl pour incliner et tourner, double-clic pour plonger. Mouvement amorti.

import * as THREE from 'three/webgpu';
import { geodeticToEcef, ecefToGeodetic, enu, A } from './geo.js';

const MIN_RANGE = 40;
const MAX_RANGE = A * 4;
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

class View {
  constructor(lat, lon, range, heading = 0, pitch = 0, aim = 0) {
    this.lat = lat; this.lon = lon; this.h = 0;
    this.range = range; this.heading = heading; this.pitch = pitch; this.aim = aim;
  }
  copy(o) { Object.assign(this, { lat: o.lat, lon: o.lon, h: o.h, range: o.range, heading: o.heading, pitch: o.pitch, aim: o.aim }); return this; }
  // point visé : sol + hauteur de visée (permet de cadrer un nuage en altitude)
  target() { return v3(geodeticToEcef(this.lat, this.lon, this.h + this.aim)); }

  // position + orientation caméra
  pose() {
    const T = this.target();
    const { east, north, up } = enu(this.lat, this.lon);
    const E = v3(east), Nn = v3(north), U = v3(up);
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const fwdH = Nn.clone().multiplyScalar(ch).addScaledVector(E, sh);
    const right = E.clone().multiplyScalar(ch).addScaledVector(Nn, -sh);
    const off = U.clone().multiplyScalar(Math.cos(this.pitch)).addScaledVector(fwdH, -Math.sin(this.pitch));
    const pos = T.clone().addScaledVector(off, this.range);
    const f = off.clone().negate();
    const camUp = new THREE.Vector3().crossVectors(right, f);
    const m = new THREE.Matrix4().makeBasis(right, camUp, off);
    const quat = new THREE.Quaternion().setFromRotationMatrix(m);
    return { pos, quat, right, up: camUp, forward: f };
  }
}

export function maxPitchFor(range) {
  const t = THREE.MathUtils.clamp((Math.log(range) - Math.log(80e3)) / (Math.log(6e6) - Math.log(80e3)), 0, 1);
  return THREE.MathUtils.degToRad(THREE.MathUtils.lerp(84, 0, t));
}

export class EarthControls {
  constructor(dom, camera, globe) {
    this.dom = dom; this.camera = camera; this.globe = globe;
    this.desired = new View(THREE.MathUtils.degToRad(46.5), THREE.MathUtils.degToRad(2.5), A * 2.6);
    this.current = new View(0, 0, 0).copy(this.desired);
    this.pointers = new Map();
    this.mode = null;
    this.flight = null;
    this.ray = new THREE.Raycaster();
    this.minClearance = 15;
    this.onClick = null;
    this.onUserInput = null;
    this.bind();
  }

  // rayon depuis la caméra (pose désirée), intersecté avec une sphère passant par la cible
  pick(clientX, clientY, view = this.desired, radiusOverride = null) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const { pos, quat } = view.pose();
    const cam = this.camera;
    const savedQ = cam.quaternion.clone();
    cam.quaternion.copy(quat);
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld();
    this.ray.setFromCamera(ndc, cam);
    cam.quaternion.copy(savedQ);
    cam.updateMatrixWorld();
    const dir = this.ray.ray.direction;
    const radius = radiusOverride ?? view.target().length();
    // intersection rayon / sphère (origine pos)
    const b = pos.dot(dir);
    const c = pos.lengthSq() - radius * radius;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    return pos.clone().addScaledVector(dir, t);
  }

  // fait tourner la vue autour du centre de la Terre pour amener `from` sur `to`
  rotateTarget(from, to) {
    const q = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
    const T = this.desired.target().applyQuaternion(q);
    const g = ecefToGeodetic(T.x, T.y, T.z);
    this.desired.lat = THREE.MathUtils.clamp(g.lat, -1.55, 1.55);
    this.desired.lon = g.lon;
  }

  bind() {
    const el = this.dom;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.flight = null;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.onUserInput?.();
      this.down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
      if (this.pointers.size === 2) { this.startPinch(); return; }
      const rotate = e.button === 2 || e.button === 1 || e.ctrlKey || e.shiftKey || e.metaKey;
      this.mode = rotate ? 'rotate' : 'pan';
      this.last = { x: e.clientX, y: e.clientY };
      if (this.mode === 'pan') {
        this.grab = this.pick(e.clientX, e.clientY);
        if (!this.grab) this.mode = 'spin';
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) { this.movePinch(); return; }
      const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
      if (this.mode === 'pan') {
        const p = this.pick(e.clientX, e.clientY);
        if (p) this.rotateTarget(p, this.grab);
      } else if (this.mode === 'rotate') {
        this.desired.heading -= dx * 0.005;
        this.desired.pitch = THREE.MathUtils.clamp(this.desired.pitch - dy * 0.005, 0, this.pitchLimit());
      } else if (this.mode === 'spin') {
        const k = this.desired.range / A;
        this.desired.lon -= dx * 0.003 * k;
        this.desired.lat = THREE.MathUtils.clamp(this.desired.lat + dy * 0.003 * k, -1.5, 1.5);
      }
    });
    const end = (e) => {
      if (this.down && this.pointers.size === 1 && this.down.button === 0 && e.type === 'pointerup') {
        const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
        // double-tap tactile : plonge vers le point touché (le dblclick n'existe pas au doigt)
        const now = performance.now();
        if (e.pointerType === 'touch' && moved < 10 && this.lastTap && now - this.lastTap.t < 320
          && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 30) {
          this.lastTap = null;
          this.diveAt(e.clientX, e.clientY);
        } else if (e.pointerType === 'touch' && moved < 10) {
          this.lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
        if (moved < 5 && performance.now() - this.down.t < 450 && this.onClick) {
          const groundR = v3(geodeticToEcef(this.desired.lat, this.desired.lon, this.desired.h)).length();
          const p = this.pick(e.clientX, e.clientY, this.desired, groundR);
          if (p) { const g = ecefToGeodetic(p.x, p.y, p.z); this.onClick(THREE.MathUtils.radToDeg(g.lat), THREE.MathUtils.radToDeg(g.lon)); }
        }
      }
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 1) {
        const [p] = this.pointers.values();
        this.last = { x: p.x, y: p.y };
        this.mode = 'pan';
        this.grab = this.pick(p.x, p.y);
        if (!this.grab) this.mode = 'spin';
      } else if (!this.pointers.size) this.mode = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.flight = null;
      this.onUserInput?.();
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.zoomAt(e.clientX, e.clientY, Math.exp(delta * 0.0018));
    }, { passive: false });
    el.addEventListener('dblclick', (e) => this.diveAt(e.clientX, e.clientY));
  }

  diveAt(x, y) {
    const p = this.pick(x, y);
    if (!p) return;
    const g = ecefToGeodetic(p.x, p.y, p.z);
    this.flyTo({ lat: g.lat, lon: g.lon, range: Math.max(this.desired.range * 0.3, MIN_RANGE * 4),
      heading: this.desired.heading, pitch: this.desired.pitch, aim: 0, duration: 1.2, radians: true });
  }

  zoomAt(x, y, factor) {
    const before = this.pick(x, y);
    this.desired.range = THREE.MathUtils.clamp(this.desired.range * factor, MIN_RANGE, MAX_RANGE);
    this.desired.pitch = Math.min(this.desired.pitch, this.pitchLimit());
    if (before) {
      const after = this.pick(x, y);
      if (after) this.rotateTarget(after, before);
    }
  }

  startPinch() {
    const [a, b] = [...this.pointers.values()];
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), my: (a.y + b.y) / 2 };
    this.mode = 'pinch';
  }

  movePinch() {
    const [a, b] = [...this.pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), my = (a.y + b.y) / 2;
    if (!this.pinch) return this.startPinch();
    this.zoomAt((a.x + b.x) / 2, my, this.pinch.d / d);
    this.desired.heading += ang - this.pinch.ang;
    this.desired.pitch = THREE.MathUtils.clamp(this.desired.pitch - (my - this.pinch.my) * 0.005, 0, this.pitchLimit());
    this.pinch = { d, ang, my };
  }

  // au-dessus d'un point visé en altitude, on peut regarder vers le haut
  pitchLimit() {
    return this.desired.aim > 50 ? THREE.MathUtils.degToRad(105) : maxPitchFor(this.desired.range);
  }

  flyTo({ lat, lon, range, heading = 0, pitch = 0, aim = 0, duration, radians = false }) {
    const d2r = radians ? (v) => v : THREE.MathUtils.degToRad;
    const from = new View(0, 0, 0).copy(this.desired);
    const to = new View(d2r(lat), d2r(lon), range, d2r(heading), d2r(pitch), aim);
    const p0 = v3(geodeticToEcef(from.lat, from.lon, 0)).normalize();
    const p1 = v3(geodeticToEcef(to.lat, to.lon, 0)).normalize();
    const arc = p0.angleTo(p1) * A;
    const peak = Math.min(Math.max(arc * 0.9, from.range, to.range), A * 2.5);
    let dh = (to.heading - from.heading) % (2 * Math.PI);
    if (dh > Math.PI) dh -= 2 * Math.PI;
    if (dh < -Math.PI) dh += 2 * Math.PI;
    this.flight = {
      t: 0, duration: duration ?? THREE.MathUtils.clamp(1.5 + Math.log10(1 + arc / 1000) * 0.9, 1.5, 5),
      from, to, p0, p1, peak, dh,
    };
  }

  stepFlight(dt) {
    const f = this.flight;
    f.t = Math.min(1, f.t + dt / f.duration);
    const s = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
    const dir = new THREE.Vector3().copy(f.p0);
    const ang = f.p0.angleTo(f.p1);
    if (ang > 1e-9) {
      const axis = new THREE.Vector3().crossVectors(f.p0, f.p1).normalize();
      dir.applyAxisAngle(axis, ang * s);
    }
    const g = ecefToGeodetic(dir.x * A, dir.y * A, dir.z * A);
    const d = this.desired;
    d.lat = g.lat; d.lon = g.lon;
    // portée : montée puis descente en espace logarithmique
    const lr = Math.log(f.from.range) * (1 - s) + Math.log(f.to.range) * s;
    const bump = Math.max(0, Math.log(f.peak) - Math.max(Math.log(f.from.range), Math.log(f.to.range)));
    d.range = Math.exp(lr + bump * Math.sin(Math.PI * s));
    d.heading = f.from.heading + f.dh * s;
    d.pitch = f.from.pitch + (f.to.pitch - f.from.pitch) * s;
    d.aim = f.from.aim + (f.to.aim - f.from.aim) * s;
    this.current.copy(d);
    if (f.t >= 1) this.flight = null;
  }

  update(dt) {
    if (this.flight) this.stepFlight(dt);
    const d = this.desired, c = this.current;
    // la cible suit le relief
    const gh = this.globe.groundHeight(d.lat, d.lon);
    d.h += (gh - d.h) * Math.min(1, dt * 6);

    const a = 1 - Math.exp(-dt * 12);
    let dl = d.lon - c.lon;
    if (dl > Math.PI) dl -= 2 * Math.PI;
    if (dl < -Math.PI) dl += 2 * Math.PI;
    c.lat += (d.lat - c.lat) * a;
    c.lon += dl * a;
    c.h += (d.h - c.h) * a;
    c.range = Math.exp(Math.log(c.range) + (Math.log(d.range) - Math.log(c.range)) * a);
    c.heading += (d.heading - c.heading) * a;
    c.pitch += (d.pitch - c.pitch) * a;
    c.aim += (d.aim - c.aim) * a;

    const pose = c.pose();
    // ne jamais passer sous le sol
    const g = ecefToGeodetic(pose.pos.x, pose.pos.y, pose.pos.z);
    const ground = this.globe.groundHeight(g.lat, g.lon);
    const minH = ground + this.minClearance;
    if (g.h < minH) pose.pos.copy(v3(geodeticToEcef(g.lat, g.lon, minH)));
    this.camHeight = Math.max(g.h, minH);
    this.heightAboveGround = this.camHeight - ground;
    this.camGeo = g;
    return pose;
  }
}

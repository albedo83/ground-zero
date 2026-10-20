// Noms des villes : tirés de la couche « place » des tuiles vectorielles (OpenFreeMap),
// projetés à l'écran à chaque image, triés par importance (capitales, rang) et sans chevauchement.

import * as THREE from 'three/webgpu';
import { geodeticToEcef } from './geo.js';

const d2r = THREE.MathUtils.degToRad;
const LANG = (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';

export class CityLabels {
  constructor(globe, camera, root, { max = 45 } = {}) {
    this.globe = globe;
    this.camera = camera;
    this.root = root;
    this.max = max;
    this.cache = new Map();      // clé de tuile → liste de lieux (ou promesse)
    this.places = [];            // candidats courants, triés par importance
    this.pool = [];
    this.nextRefresh = 0;
    this.v = new THREE.Vector3();
    this.n = new THREE.Vector3();
  }

  // niveau de zoom des noms : un peu plus grossier que le terrain affiché
  labelZoom(z) { return Math.max(3, Math.min(11, z - 2)); }

  // zones à éviter : panneaux du HUD visibles (relevées à chaque rafraîchissement)
  hudRects() {
    const sel = '.hud-top-left > *, .hud-top-right > *, .hud-bottom-dock, .mini-bar, #shockwave-alert, .hud-bottom-right, .fs-btn';
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.3) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) out.push([r.left - 4, r.top - 4, r.right + 4, r.bottom + 4]);
    }
    return out;
  }

  refresh() {
    this.hud = this.hudRects();
    const keys = new Map();
    for (const t of this.globe.visible) {
      const lz = this.labelZoom(t.z);
      const s = 2 ** (t.z - lz);
      const x = Math.floor(t.x / s), y = Math.floor(t.y / s);
      keys.set(`${lz}/${x}/${y}`, { z: lz, x, y });
    }
    const seen = new Set();
    const list = [];
    for (const [key, k] of keys) {
      let entry = this.cache.get(key);
      if (!entry) {
        entry = { places: null };
        this.cache.set(key, entry);
        this.globe.pool.run({ type: 'places', ...k, lang: LANG })
          .then((d) => { entry.places = d.places; this.nextRefresh = 0; })
          .catch(() => { this.cache.delete(key); });
        if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
      }
      for (const p of entry.places || []) {
        const id = `${p.name}|${p.lat.toFixed(2)}|${p.lon.toFixed(2)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        list.push(p);
      }
    }
    // capitales d'abord, puis villes > bourgs > villages, puis rang
    list.sort((a, b) => (b.capital === 2) - (a.capital === 2) || a.cls - b.cls || a.rank - b.rank);
    for (const p of list.slice(0, 400)) {
      const h = this.globe.groundHeight(d2r(p.lat), d2r(p.lon)) + 40;
      p.ecef = geodeticToEcef(d2r(p.lat), d2r(p.lon), h);
    }
    this.places = list.slice(0, 400);
  }

  node(i) {
    let el = this.pool[i];
    if (!el) {
      el = document.createElement('div');
      el.className = 'city-label';
      el.innerHTML = '<i></i><span></span>';
      this.root.appendChild(el);
      this.pool[i] = el;
    }
    return el;
  }

  // reserved : rectangles écran déjà occupés (réticule de la cible…)
  update(camPos, now, reserved = []) {
    if (now > this.nextRefresh) { this.refresh(); this.nextRefresh = now + 600; }
    const cam = this.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const placed = [...(this.hud || []), ...reserved];
    let shown = 0;
    for (const p of this.places) {
      if (shown >= this.max) break;
      if (!p.ecef) continue;
      const P = this.n.set(p.ecef[0], p.ecef[1], p.ecef[2]);
      // côté visible de la Terre uniquement
      const toCam = this.v.copy(camPos).sub(P);
      if (toCam.dot(P) < 0) continue;
      const q = this.v.copy(P).sub(camPos).applyMatrix4(cam.matrixWorldInverse);
      if (q.z > 0) continue;
      const dist = -q.z;
      q.applyMatrix4(cam.projectionMatrix);
      const x = (q.x * 0.5 + 0.5) * W, y = (-q.y * 0.5 + 0.5) * H;
      if (x < 0 || x > W || y < 0 || y > H) continue;
      // trop proche : le nom écraserait la vue de rue
      if (dist < 600) continue;
      const big = p.capital === 2 || (p.cls === 0 && p.rank <= 2);
      const w = p.name.length * (big ? 7.4 : 6.4) + 16, h = big ? 16 : 14;
      const box = [x - 4, y - h / 2, x + w, y + h / 2];
      if (box[2] > W - 2 || box[1] < 2 || box[3] > H - 2) continue; // nom entièrement visible uniquement
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      const el = this.node(shown++);
      if (el._name !== p.name) { el.lastChild.textContent = p.name; el._name = p.name; }
      el.className = `city-label${big ? ' big' : ''}${p.cls === 2 ? ' small' : ''}`;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.display = '';
    }
    for (let i = shown; i < this.pool.length; i++) this.pool[i].style.display = 'none';
  }
}

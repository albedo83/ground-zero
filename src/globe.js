// Moteur de globe : quadtree Web Mercator, sélection du niveau de détail par erreur écran,
// file de chargement priorisée, cache LRU et rendu « relatif à la caméra ».

import * as THREE from 'three/webgpu';
import { geodeticToEcef, mercYToLat, latToMercY, MAX_LAT, A, B } from './geo.js';
import { IMAGERY, VECTOR, GRID } from './config.js';
import { createBuildingMaterial } from './nuke/buildingMaterial.js';

const ROOT_Z = 2;
const MAX_TILES = 900;
const MAX_BUILDING_TILES = 48;
const MAX_INFLIGHT = 18;
const SSE_THRESHOLD = 1.1; // texels par pixel CSS au-delà duquel on subdivise
const BUILDING_RANGE = 9000; // m

class WorkerPool {
  constructor(n) {
    this.workers = Array.from({ length: n }, () =>
      new Worker(new URL('./tileWorker.js', import.meta.url), { type: 'module' }));
    this.pending = new Map();
    this.nextId = 1;
    for (const w of this.workers) w.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      this.pending.delete(e.data.id);
      e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error));
    };
  }
  broadcast(msg) { for (const w of this.workers) w.postMessage(msg); }
  // les tuiles voisines vont au même worker pour partager son cache d'ancêtres
  run(msg) {
    const k = Math.max(0, msg.z - 4);
    const h = ((msg.x >> (msg.z - k)) * 73856093) ^ ((msg.y >> (msg.z - k)) * 19349663) ^ (k * 83492791);
    const w = this.workers[Math.abs(h) % this.workers.length];
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ ...msg, id });
    });
  }
}

class Tile {
  constructor(z, x, y, parent) {
    this.z = z; this.x = x; this.y = y; this.parent = parent;
    this.key = `${z}/${x}/${y}`;
    this.children = null;
    this.state = 'empty'; // empty | queued | loading | ready
    this.mesh = null;
    this.heights = null;
    this.lastUsed = 0;
    this.generation = 0;
    const n = 2 ** z;
    this.latN = mercYToLat(y / n);
    this.latS = mercYToLat((y + 1) / n);
    this.lonW = (x / n) * 2 * Math.PI - Math.PI;
    this.lonE = ((x + 1) / n) * 2 * Math.PI - Math.PI;
    const latMin = this.latN * this.latS <= 0 ? 0 : Math.min(Math.abs(this.latN), Math.abs(this.latS));
    this.texel = (2 * Math.PI * A * Math.cos(latMin)) / n / 256;
    this.computeBounds(0, parent ? parent.maxH : 9000);
  }

  computeBounds(minH, maxH) {
    this.minH = minH; this.maxH = maxH;
    const pts = [];
    for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) for (const h of [minH, maxH]) {
      const lat = this.latN + (this.latS - this.latN) * j / 2;
      const lon = this.lonW + (this.lonE - this.lonW) * i / 2;
      pts.push(new THREE.Vector3(...geodeticToEcef(lat, lon, h)));
    }
    const c = new THREE.Vector3();
    pts.forEach((p) => c.add(p));
    c.divideScalar(pts.length);
    let r = 0;
    pts.forEach((p) => { r = Math.max(r, p.distanceTo(c)); });
    // la courbure entre points échantillonnés : marge
    this.sphere = new THREE.Sphere(c, r * 1.05 + 10);
  }

  getChildren() {
    if (!this.children) {
      const { z, x, y } = this;
      this.children = [
        new Tile(z + 1, 2 * x, 2 * y, this), new Tile(z + 1, 2 * x + 1, 2 * y, this),
        new Tile(z + 1, 2 * x, 2 * y + 1, this), new Tile(z + 1, 2 * x + 1, 2 * y + 1, this),
      ];
    }
    return this.children;
  }
}

export class Globe {
  constructor(scene, { imagery = 'sentinel' } = {}) {
    this.scene = scene;
    this.group = new THREE.Group(); // translaté de -positionCaméra chaque frame
    scene.add(this.group);
    this.pool = new WorkerPool(Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)));
    this.imagery = imagery;
    this.frame = 0;
    this.generation = 0;
    this.exaggeration = 2; // relief exagéré par défaut : les reliefs se lisent même vus d'avion
    this.sse = SSE_THRESHOLD;          // réglé par le niveau de qualité
    this.buildingRange = BUILDING_RANGE;
    this.inflight = 0;
    this.queue = [];
    this.index = new Map();
    this.loaded = new Set();
    this.visible = [];
    this.buildings = new Map();
    this.visibleBuildings = [];
    this.frustum = new THREE.Frustum();
    this.stats = { tiles: 0, loading: 0, buildings: 0 };

    this.buildingMaterial = createBuildingMaterial();
    this.roots = [];
    const n = 2 ** ROOT_Z;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) this.roots.push(new Tile(ROOT_Z, x, y, null));
    this.roots.forEach((t) => this.register(t));
    this.addPolarCaps();
  }

  async init() {
    try {
      const tj = await (await fetch(VECTOR.tilejson)).json();
      this.vectorUrl = tj.tiles[0];
      this.pool.broadcast({ type: 'init', vectorUrl: this.vectorUrl });
    } catch (e) {
      console.warn('OpenFreeMap indisponible, pas de routes ni de bâtiments', e);
    }
  }

  register(tile) { this.index.set(tile.key, tile); }

  setImagery(name) {
    if (name === this.imagery) return;
    this.imagery = name;
    this.reloadAll();
  }

  // exagération verticale : relief, bâtiments et hauteur du sol suivent (tout est rechargé)
  setExaggeration(k) {
    if (k === this.exaggeration) return;
    this.exaggeration = k;
    this.reloadAll();
    this.addPolarCaps();
    for (const b of this.buildings.values()) {
      if (b.mesh) { this.group.remove(b.mesh); b.mesh.geometry.dispose(); }
    }
    this.buildings.clear();
    this.visibleBuildings = [];
  }

  reloadAll() {
    this.generation++;
    for (const tile of [...this.loaded]) this.unload(tile);
    this.queue.length = 0;
  }

  get maxZoom() { return IMAGERY[this.imagery].maxTileZoom; }

  addPolarCaps() {
    const make = (north, h, color) => {
      const geo = new THREE.BufferGeometry();
      const pos = [], idx = [], tmp = [0, 0, 0];
      const RINGS = 12, SEG = 128;
      const cLat = north ? Math.PI / 2 : -Math.PI / 2;
      const center = geodeticToEcef(cLat, 0, h);
      for (let r = 0; r <= RINGS; r++) {
        const lat = (north ? 1 : -1) * (MAX_LAT + (Math.PI / 2 - MAX_LAT) * (r / RINGS));
        for (let s = 0; s <= SEG; s++) {
          geodeticToEcef(lat, (s / SEG) * 2 * Math.PI - Math.PI, h, tmp);
          pos.push(tmp[0] - center[0], tmp[1] - center[1], tmp[2] - center[2]);
        }
      }
      for (let r = 0; r < RINGS; r++) for (let s = 0; s < SEG; s++) {
        const a = r * (SEG + 1) + s, b = a + 1, c = a + SEG + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
      mesh.position.set(...center);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.caps.push(mesh);
    };
    for (const m of this.caps || []) { this.group.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.caps = [];
    make(true, 0, 0x1c2b3c);
    // plateau antarctique (~2 700 m) : suit l'exagération pour rester jointif avec les tuiles
    make(false, 2700 * this.exaggeration, 0xf1f4f8);
  }

  // ---------- Requête de hauteur du sol (pour la caméra) ----------

  groundHeight(lat, lon) {
    const mx = (lon + Math.PI) / (2 * Math.PI);
    const my = latToMercY(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)));
    for (let z = this.maxZoom; z >= ROOT_Z; z--) {
      const n = 2 ** z;
      const tx = Math.min(n - 1, Math.floor(mx * n)), ty = Math.min(n - 1, Math.floor(my * n));
      const t = this.index.get(`${z}/${tx}/${ty}`);
      if (t?.heights) {
        const V = GRID + 1;
        const fx = (mx * n - tx) * GRID, fy = (my * n - ty) * GRID;
        const i = Math.min(GRID - 1, fx | 0), j = Math.min(GRID - 1, fy | 0);
        const ax = fx - i, ay = fy - j, h = t.heights;
        return (h[j * V + i] * (1 - ax) + h[j * V + i + 1] * ax) * (1 - ay) +
               (h[(j + 1) * V + i] * (1 - ax) + h[(j + 1) * V + i + 1] * ax) * ay;
      }
    }
    return 0;
  }

  // ---------- Sélection par frame ----------

  update(camera, camPos, viewportHeight) {
    this.frame++;
    const frame = this.frame;
    this.group.position.copy(camPos).negate();

    const proj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(proj, camera.coordinateSystem);
    const K = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const camR = camPos.length();
    const Rm = B;
    const horizonAngle = Math.acos(Math.min(1, Rm / camR));
    const camDir = camPos.clone().divideScalar(camR);
    const rel = new THREE.Vector3();
    const relSphere = new THREE.Sphere();
    const maxZ = this.maxZoom;
    const render = [];
    const wantBuildings = new Map();

    const isVisible = (tile) => {
      const s = tile.sphere;
      relSphere.center.subVectors(s.center, camPos);
      relSphere.radius = s.radius;
      if (!this.frustum.intersectsSphere(relSphere)) return false;
      const sr = s.center.length();
      const ang = Math.acos(THREE.MathUtils.clamp(s.center.dot(camDir) / sr, -1, 1));
      const angR = Math.asin(Math.min(1, s.radius / sr));
      const beyond = Math.acos(Math.min(1, Rm / (Rm + Math.max(tile.maxH, 0) + 100)));
      return ang - angR < horizonAngle + beyond;
    };

    const now = performance.now();
    const request = (tile, priority) => {
      tile.lastUsed = frame;
      if (tile.state === 'empty' && !(tile.retryAt > now)) {
        tile.state = 'queued';
        this.queue.push(tile);
      }
      if (tile.state === 'queued') tile.priority = priority;
    };

    const traverse = (tile) => {
      tile.lastUsed = frame;
      const dist = Math.max(rel.subVectors(tile.sphere.center, camPos).length() - tile.sphere.radius, 1);
      const sse = (tile.texel * K) / dist;
      if (tile.z < maxZ && sse > this.sse) {
        const kids = tile.getChildren();
        let ready = true;
        const vis = kids.map((c) => isVisible(c));
        kids.forEach((c, i) => {
          if (!this.index.has(c.key)) this.register(c);
          if (vis[i]) {
            request(c, c.z * 1e9 + dist);
            if (c.state !== 'ready') ready = false;
          }
        });
        // on ne descend que lorsque tous les enfants visibles sont prêts : jamais de trou
        if (ready) {
          kids.forEach((c, i) => { if (vis[i]) traverse(c); });
          return;
        }
      }
      if (tile.state === 'ready') {
        render.push(tile);
        if (this.vectorUrl && tile.z >= VECTOR.buildingZoom && dist < this.buildingRange) {
          const s = 2 ** (tile.z - VECTOR.buildingZoom);
          const bx = Math.floor(tile.x / s), by = Math.floor(tile.y / s);
          const key = `${VECTOR.buildingZoom}/${bx}/${by}`;
          const prev = wantBuildings.get(key);
          if (prev === undefined || dist < prev.dist) wantBuildings.set(key, { x: bx, y: by, dist });
        }
      } else {
        request(tile, tile.z * 1e9 + dist);
      }
    };

    for (const root of this.roots) {
      if (root.state !== 'ready') request(root, 0);
      else if (isVisible(root)) traverse(root);
    }

    // visibilité
    for (const t of this.visible) if (t.mesh) t.mesh.visible = false;
    for (const t of render) t.mesh.visible = true;
    this.visible = render;

    this.updateBuildings(wantBuildings, frame);
    this.pump(frame);
    this.evict(frame);
    this.stats.tiles = render.length;
    this.stats.loading = this.inflight + this.queue.length;
  }

  pump(frame) {
    this.queue = this.queue.filter((t) => {
      if (t.lastUsed < frame - 1) { t.state = 'empty'; return false; }
      return true;
    });
    this.queue.sort((a, b) => a.priority - b.priority);
    while (this.inflight < MAX_INFLIGHT && this.queue.length) this.load(this.queue.shift());
  }

  async load(tile) {
    tile.state = 'loading';
    this.inflight++;
    const gen = this.generation;
    try {
      const d = await this.pool.run({ type: 'tile', z: tile.z, x: tile.x, y: tile.y, imagery: this.imagery, exag: this.exaggeration });
      if (gen !== this.generation) { d.bitmap.close(); tile.state = 'empty'; return; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(d.nrm, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
      geo.setIndex(new THREE.BufferAttribute(d.index, 1));
      const tex = new THREE.Texture(d.bitmap);
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      mat.color.setScalar(this.imagery === 'sentinel' ? 1.3 : 1.12); // Sentinel-2 est terne : on le ramène à une lumière de plein jour
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...d.center);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      tile.mesh = mesh;
      tile.heights = d.heights;
      tile.computeBounds(d.minH, d.maxH);
      tile.state = 'ready';
      tile.retry = 0;
      this.loaded.add(tile);
    } catch (e) {
      tile.state = 'empty';
      // réseau capricieux : nouvelle tentative espacée (1 s, 2 s, 4 s… 30 s), jamais d'abandon définitif
      tile.retry = (tile.retry || 0) + 1;
      tile.retryAt = performance.now() + Math.min(30000, 1000 * 2 ** (tile.retry - 1));
    } finally {
      this.inflight--;
    }
  }

  unload(tile) {
    if (tile.mesh) {
      this.group.remove(tile.mesh);
      tile.mesh.geometry.dispose();
      tile.mesh.material.map.source.data?.close?.();
      tile.mesh.material.map.dispose();
      tile.mesh.material.dispose();
      tile.mesh = null;
    }
    tile.heights = null;
    tile.state = 'empty';
    this.loaded.delete(tile);
  }

  evict(frame) {
    if (this.loaded.size <= MAX_TILES) return;
    const candidates = [...this.loaded].filter((t) => t.z > ROOT_Z && t.lastUsed < frame);
    candidates.sort((a, b) => a.lastUsed - b.lastUsed || b.z - a.z);
    const excess = this.loaded.size - MAX_TILES;
    for (let i = 0; i < Math.min(excess, candidates.length); i++) this.unload(candidates[i]);
  }

  // ---------- Bâtiments ----------

  updateBuildings(want, frame) {
    for (const b of this.visibleBuildings) if (b.mesh) b.mesh.visible = false;
    this.visibleBuildings = [];
    const sorted = [...want.entries()].sort((a, b) => a[1].dist - b[1].dist);
    let loading = 0;
    for (const b of this.buildings.values()) if (b.state === 'loading') loading++;
    for (const [key, info] of sorted) {
      let b = this.buildings.get(key);
      if (!b) {
        if (loading >= 4) continue;
        b = { key, state: 'loading', mesh: null, lastUsed: frame };
        this.buildings.set(key, b);
        loading++;
        this.loadBuildings(b, info);
      }
      b.lastUsed = frame;
      if (b.mesh) { b.mesh.visible = true; this.visibleBuildings.push(b); }
    }
    if (this.buildings.size > MAX_BUILDING_TILES) {
      const old = [...this.buildings.values()]
        .filter((b) => b.lastUsed < frame && b.state !== 'loading')
        .sort((a, b) => a.lastUsed - b.lastUsed);
      for (const b of old.slice(0, this.buildings.size - MAX_BUILDING_TILES)) {
        if (b.mesh) { this.group.remove(b.mesh); b.mesh.geometry.dispose(); }
        this.buildings.delete(b.key);
      }
    }
    this.stats.buildings = this.visibleBuildings.length;
  }

  async loadBuildings(b, { x, y }) {
    try {
      const d = await this.pool.run({ type: 'buildings', z: VECTOR.buildingZoom, x, y, exag: this.exaggeration });
      b.state = 'ready';
      if (d.empty || this.buildings.get(b.key) !== b) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(d.nrm, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(d.col, 3));
      geo.setAttribute('hbase', new THREE.BufferAttribute(d.hbase, 1));
      geo.setAttribute('seed', new THREE.BufferAttribute(d.seed, 1));
      geo.setIndex(new THREE.BufferAttribute(d.index, 1));
      const mesh = new THREE.Mesh(geo, this.buildingMaterial);
      mesh.position.set(...d.center);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      b.mesh = mesh;
    } catch {
      b.state = 'failed';
    }
  }
}

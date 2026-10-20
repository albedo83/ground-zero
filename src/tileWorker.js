// Worker : télécharge et décode imagerie / relief / vecteur, construit les maillages.
// Tout le travail lourd se fait ici pour garder le thread de rendu fluide.

import { VectorTile, classifyRings } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import earcut from 'earcut';
import { geodeticToEcef, mercYToLat, enu, A } from './geo.js';
import { IMAGERY, TERRAIN, VECTOR, GRID } from './config.js';

let vectorUrl = null;

class LRU {
  constructor(max) { this.max = max; this.map = new Map(); }
  get(k) {
    const v = this.map.get(k);
    if (v !== undefined) { this.map.delete(k); this.map.set(k, v); }
    return v;
  }
  set(k, v) {
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}

const imageCache = new LRU(96);
const terrainCache = new LRU(64);
const vectorCache = new LRU(24);

function cached(cache, key, loader) {
  let p = cache.get(key);
  if (!p) {
    p = loader();
    cache.set(key, p);
    p.catch(() => cache.map.delete(key));
  }
  return p;
}

async function fetchBitmap(url, raw = false) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const blob = await res.blob();
  return createImageBitmap(blob, raw ? { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } : undefined);
}

// ---------- Imagerie ----------

async function getImagery(src, z, x, y) {
  const cfg = IMAGERY[src];
  let iz = Math.min(z, cfg.maxZoom);
  while (iz >= 0) {
    const s = 2 ** (z - iz);
    const ix = Math.floor(x / s), iy = Math.floor(y / s);
    try {
      const bitmap = await cached(imageCache, `${src}/${iz}/${ix}/${iy}`, () => fetchBitmap(cfg.url(iz, ix, iy)));
      return { bitmap, iz, ix, iy };
    } catch {
      iz--;
    }
  }
  return null;
}

// ---------- Relief (Terrarium) ----------

let decodeCanvas = null;
function decodeTerrarium(bitmap) {
  const w = bitmap.width, h = bitmap.height;
  if (!decodeCanvas || decodeCanvas.width !== w) decodeCanvas = new OffscreenCanvas(w, h);
  const ctx = decodeCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
  }
  bitmap.close();
  return { data: out, size: w };
}

async function getTerrain(z, x, y) {
  let tz = Math.min(z, TERRAIN.maxZoom);
  while (tz >= 0) {
    const s = 2 ** (z - tz);
    const tx = Math.floor(x / s), ty = Math.floor(y / s);
    try {
      const t = await cached(terrainCache, `${tz}/${tx}/${ty}`, async () =>
        decodeTerrarium(await fetchBitmap(TERRAIN.url(tz, tx, ty), true)));
      return { ...t, tz, tx, ty };
    } catch {
      tz--;
    }
  }
  return null;
}

// fx, fy ∈ [0,1] dans la tuile de relief
function sampleTerrain(t, fx, fy) {
  const n = t.size;
  let px = fx * n - 0.5, py = fy * n - 0.5;
  px = Math.min(Math.max(px, 0), n - 1.001);
  py = Math.min(Math.max(py, 0), n - 1.001);
  const x0 = px | 0, y0 = py | 0, ax = px - x0, ay = py - y0;
  const d = t.data, i = y0 * n + x0;
  const h = (d[i] * (1 - ax) + d[i + 1] * ax) * (1 - ay) + (d[i + n] * (1 - ax) + d[i + n + 1] * ax) * ay;
  return h > 0 ? h : 0; // océans à plat (pas de bathymétrie)
}

// hauteur au point (mx,my) en coordonnées tuile du niveau z
// exagération verticale du relief (réglage utilisateur), fixée par chaque message
let exag = 1;

function heightAt(t, z, mx, my) {
  const s = 2 ** (z - t.tz);
  return exag * sampleTerrain(t, mx / s - t.tx, my / s - t.ty);
}

// ---------- Vecteur (OpenFreeMap / OpenMapTiles) ----------

async function getVector(z, x, y) {
  if (!vectorUrl) return null;
  const vz = Math.min(z, VECTOR.maxZoom);
  const s = 2 ** (z - vz);
  const vx = Math.floor(x / s), vy = Math.floor(y / s);
  try {
    const tile = await cached(vectorCache, `${vz}/${vx}/${vy}`, async () => {
      const url = vectorUrl.replace('{z}', vz).replace('{x}', vx).replace('{y}', vy);
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      return new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
    });
    return { tile, vz, vx, vy };
  } catch {
    return null;
  }
}

const ROADS = {
  motorway: { w: 22, min: 2.2, color: '#f7b36b', rank: 9 },
  trunk: { w: 18, min: 1.9, color: '#f9c97c', rank: 8 },
  primary: { w: 14, min: 1.6, color: '#ffe08f', rank: 7 },
  secondary: { w: 12, min: 1.3, color: '#fff3c8', rank: 6 },
  tertiary: { w: 10, min: 1.1, color: '#ffffff', rank: 5 },
  minor: { w: 7, min: 0.8, color: 'rgba(255,255,255,0.88)', rank: 4 },
  service: { w: 4, min: 0.6, color: 'rgba(255,255,255,0.7)', rank: 3 },
  busway: { w: 6, min: 0.6, color: 'rgba(255,255,255,0.7)', rank: 3 },
  raceway: { w: 6, min: 0.6, color: 'rgba(255,200,200,0.7)', rank: 3 },
  track: { w: 3, min: 0.5, color: 'rgba(245,225,185,0.65)', rank: 2 },
  path: { w: 2, min: 0.5, color: 'rgba(255,240,210,0.6)', rank: 1 },
  rail: { w: 3, min: 0.7, color: 'rgba(210,210,220,0.85)', rank: 2 },
};

function drawRoads(ctx, size, vec, z, x, y, metersPerPx) {
  const layer = vec.tile.layers.transportation;
  if (!layer) return;
  const k = 2 ** (z - vec.vz);
  const ox = x - vec.vx * k, oy = y - vec.vy * k;
  const items = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 2) continue;
    const p = f.properties;
    const style = ROADS[p.class];
    if (!style || p.brunnel === 'tunnel') continue;
    items.push({ f, style, extent: f.extent });
  }
  items.sort((a, b) => a.style.rank - b.style.rank);

  const toPx = (pt, extent) => [(pt.x / extent * k - ox) * size, (pt.y / extent * k - oy) * size];
  const paths = items.map(({ f, style, extent }) => {
    const path = new Path2D();
    for (const line of f.loadGeometry()) {
      line.forEach((pt, j) => {
        const [px, py] = toPx(pt, extent);
        j ? path.lineTo(px, py) : path.moveTo(px, py);
      });
    }
    return { path, width: Math.max(style.w / metersPerPx, style.min), style };
  });

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(20,20,25,0.38)';
  for (const p of paths) { ctx.lineWidth = p.width + 1.6; ctx.stroke(p.path); }
  for (const p of paths) { ctx.strokeStyle = p.style.color; ctx.lineWidth = p.width; ctx.stroke(p.path); }
}

// ---------- Tuile de terrain ----------

async function buildTile({ z, x, y, imagery }) {
  const withVector = z >= VECTOR.minOverlayZoom;
  const [img, terr, vec] = await Promise.all([
    getImagery(imagery, z, x, y),
    getTerrain(z, x, y),
    withVector ? getVector(z, x, y) : null,
  ]);

  // Texture
  const size = vec ? 512 : 256;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b2a3a';
  ctx.fillRect(0, 0, size, size);
  if (img) {
    const s = 2 ** (z - img.iz);
    const w = img.bitmap.width / s;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.bitmap, (x - img.ix * s) * w, (y - img.iy * s) * w, w, w, 0, 0, size, size);
  }
  const n = 2 ** z;
  const latC = mercYToLat((y + 0.5) / n);
  if (vec) {
    const metersPerPx = (2 * Math.PI * A * Math.cos(latC)) / n / size;
    drawRoads(ctx, size, vec, z, x, y, metersPerPx);
  }
  const bitmap = canvas.transferToImageBitmap();

  // Maillage
  const N = GRID, V = N + 1;
  const heights = new Float32Array(V * V);
  let minH = Infinity, maxH = -Infinity;
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const h = terr ? heightAt(terr, z, x + i / N, y + j / N) : 0;
      heights[j * V + i] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }
  const lonC = ((x + 0.5) / n) * 2 * Math.PI - Math.PI;
  const center = geodeticToEcef(latC, lonC, (minH + maxH) / 2);

  const tileW = (2 * Math.PI * A * Math.cos(latC)) / n;
  const skirt = Math.max(tileW * 0.04, 30);
  const vertCount = V * V + 4 * V;
  const pos = new Float32Array(vertCount * 3);
  const nrm = new Float32Array(vertCount * 3);
  const uv = new Float32Array(vertCount * 2);
  const tmp = [0, 0, 0];
  const lats = new Float64Array(V), lons = new Float64Array(V);
  for (let k = 0; k < V; k++) {
    lats[k] = mercYToLat((y + k / N) / n);
    lons[k] = ((x + k / N) / n) * 2 * Math.PI - Math.PI;
  }
  const put = (idx, lat, lon, h, u, v) => {
    geodeticToEcef(lat, lon, h, tmp);
    pos[idx * 3] = tmp[0] - center[0];
    pos[idx * 3 + 1] = tmp[1] - center[1];
    pos[idx * 3 + 2] = tmp[2] - center[2];
    uv[idx * 2] = u;
    uv[idx * 2 + 1] = v;
  };
  for (let j = 0; j < V; j++)
    for (let i = 0; i < V; i++) put(j * V + i, lats[j], lons[i], heights[j * V + i], i / N, j / N);

  // normales par différences finies (relief éclairé)
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const a = (j * V + Math.max(i - 1, 0)) * 3, b = (j * V + Math.min(i + 1, N)) * 3;
      const c = (Math.max(j - 1, 0) * V + i) * 3, d = (Math.min(j + 1, N) * V + i) * 3;
      const ex = pos[b] - pos[a], ey = pos[b + 1] - pos[a + 1], ez = pos[b + 2] - pos[a + 2]; // vers l'est
      const sx = pos[d] - pos[c], sy = pos[d + 1] - pos[c + 1], sz = pos[d + 2] - pos[c + 2]; // vers le sud
      // haut = sud × est
      let nx = sy * ez - sz * ey, ny = sz * ex - sx * ez, nz = sx * ey - sy * ex;
      const l = Math.hypot(nx, ny, nz) || 1;
      const o = (j * V + i) * 3;
      nrm[o] = nx / l; nrm[o + 1] = ny / l; nrm[o + 2] = nz / l;
    }
  }

  // jupes pour masquer les fissures entre niveaux de détail
  const edges = [
    (k) => [k, 0], (k) => [N, k], (k) => [k, N], (k) => [0, k],
  ];
  const idx = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  edges.forEach((edge, e) => {
    const base = V * V + e * V;
    for (let k = 0; k < V; k++) {
      const [i, j] = edge(k);
      const src = j * V + i;
      put(base + k, lats[j], lons[i], heights[src] - skirt, i / N, j / N);
      nrm.copyWithin((base + k) * 3, src * 3, src * 3 + 3);
      if (k < N) {
        const s0 = (() => { const [i2, j2] = edge(k); return j2 * V + i2; })();
        const s1 = (() => { const [i2, j2] = edge(k + 1); return j2 * V + i2; })();
        const k0 = base + k, k1 = base + k + 1;
        idx.push(s0, k0, s1, s1, k0, k1, s0, s1, k0, s1, k1, k0);
      }
    }
  });

  let radius = 0;
  for (let i = 0; i < V * V * 3; i += 3) radius = Math.max(radius, Math.hypot(pos[i], pos[i + 1], pos[i + 2]));

  const index = new Uint16Array(idx);
  return {
    result: { bitmap, pos, nrm, uv, index, center, radius, minH, maxH, heights },
    transfer: [bitmap, pos.buffer, nrm.buffer, uv.buffer, index.buffer, heights.buffer],
  };
}

// ---------- Bâtiments 3D ----------

async function buildBuildings({ z, x, y }) {
  const [vec, terr] = await Promise.all([getVector(z, x, y), getTerrain(z, x, y)]);
  const layer = vec?.tile.layers.building;
  if (!layer) return { result: { empty: true }, transfer: [] };

  const n = 2 ** z;
  const latC = mercYToLat((y + 0.5) / n), lonC = ((x + 0.5) / n) * 2 * Math.PI - Math.PI;
  const gC = terr ? heightAt(terr, z, x + 0.5, y + 0.5) : 0;
  const center = geodeticToEcef(latC, lonC, gC);
  const { up } = enu(latC, lonC);

  const pos = [], nrm = [], col = [], idx = [], hbs = [], seeds = [];
  const tmp = [0, 0, 0];
  let seed = 0;
  const metersPerUnit = (2 * Math.PI * A * Math.cos(latC)) / n; // par unité de tuile

  const vertex = (u, v, h, hb) => {
    geodeticToEcef(mercYToLat((y + v) / n), ((x + u) / n) * 2 * Math.PI - Math.PI, h, tmp);
    pos.push(tmp[0] - center[0], tmp[1] - center[1], tmp[2] - center[2]);
    hbs.push(hb);
    seeds.push(seed);
    return pos.length / 3 - 1;
  };

  for (let f = 0; f < layer.length; f++) {
    const feat = layer.feature(f);
    if (feat.type !== 3) continue;
    const p = feat.properties;
    if (p.hide_3d) continue;
    const top = p.render_height ?? 8;
    const bottom = p.render_min_height ?? 0;
    if (top <= bottom) continue;
    const ext = feat.extent;

    for (const poly of classifyRings(feat.loadGeometry())) {
      const outer = poly[0];
      if (outer.length < 4) continue;
      // un bâtiment n'appartient qu'à la tuile qui contient son centre (évite les doublons de bordure)
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const pt of outer) { bx0 = Math.min(bx0, pt.x); bx1 = Math.max(bx1, pt.x); by0 = Math.min(by0, pt.y); by1 = Math.max(by1, pt.y); }
      const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
      if (cx < 0 || cy < 0 || cx >= ext || cy >= ext) continue;

      let ground = Infinity;
      for (const pt of outer) ground = Math.min(ground, terr ? heightAt(terr, z, x + pt.x / ext, y + pt.y / ext) : 0);
      const h0 = ground + bottom, h1 = ground + top;
      seed = Math.random();

      const shade = 0.86 + 0.1 * (((cx * 7 + cy * 13) | 0) % 7) / 6;
      const color = [0.93 * shade, 0.9 * shade, 0.85 * shade];

      // murs
      for (const ring of poly) {
        for (let k = 0; k < ring.length - 1; k++) {
          const p0 = ring[k], p1 = ring[k + 1];
          const u0 = p0.x / ext, v0 = p0.y / ext, u1 = p1.x / ext, v1 = p1.y / ext;
          const a = vertex(u0, v0, h0, bottom), b = vertex(u1, v1, h0, bottom), c = vertex(u1, v1, h1, top), d = vertex(u0, v0, h1, top);
          // normale horizontale : arête × haut
          const ex = pos[c * 3] - pos[d * 3], ey = pos[c * 3 + 1] - pos[d * 3 + 1], ez = pos[c * 3 + 2] - pos[d * 3 + 2];
          let nx = ey * up[2] - ez * up[1], ny = ez * up[0] - ex * up[2], nz = ex * up[1] - ey * up[0];
          const l = Math.hypot(nx, ny, nz) || 1;
          for (let q = 0; q < 4; q++) { nrm.push(nx / l, ny / l, nz / l); col.push(color[0] * 0.92, color[1] * 0.92, color[2] * 0.92); }
          idx.push(a, b, c, a, c, d);
        }
      }

      // toit
      const flat = [], holes = [];
      const baseIdx = pos.length / 3;
      for (const ring of poly) {
        if (flat.length) holes.push(flat.length / 2);
        for (let k = 0; k < ring.length - 1; k++) {
          const u = ring[k].x / ext, v = ring[k].y / ext;
          flat.push(u * metersPerUnit, v * metersPerUnit);
          vertex(u, v, h1, top);
          nrm.push(up[0], up[1], up[2]);
          col.push(color[0], color[1], color[2]);
        }
      }
      for (const t of earcut(flat, holes)) idx.push(baseIdx + t);
    }
  }

  if (!idx.length) return { result: { empty: true }, transfer: [] };
  const P = new Float32Array(pos), Nn = new Float32Array(nrm), C = new Float32Array(col), I = new Uint32Array(idx);
  const HB = new Float32Array(hbs), SD = new Float32Array(seeds);
  return {
    result: { pos: P, nrm: Nn, col: C, index: I, center, hbase: HB, seed: SD },
    transfer: [P.buffer, Nn.buffer, C.buffer, I.buffer, HB.buffer, SD.buffer],
  };
}

// ---------- Noms de lieux (couche « place ») ----------

const PLACE_CLASSES = { city: 0, town: 1, village: 2 };

async function buildPlaces({ z, x, y, lang }) {
  const vec = await getVector(z, x, y);
  const layer = vec?.tile.layers.place;
  const out = [];
  if (!layer) return { result: { places: out }, transfer: [] };
  const key = lang === 'fr' ? 'name:fr' : 'name:en';
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const p = f.properties;
    if (!(p.class in PLACE_CLASSES)) continue;
    const g = f.toGeoJSON(vec.vx, vec.vy, vec.vz).geometry;
    if (g.type !== 'Point') continue;
    const name = p[key] || p['name:latin'] || p.name_int || p.name;
    if (!name) continue;
    out.push({
      name, cls: PLACE_CLASSES[p.class], rank: p.rank ?? 99, capital: p.capital ?? 0,
      lon: g.coordinates[0], lat: g.coordinates[1],
    });
  }
  return { result: { places: out }, transfer: [] };
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') { vectorUrl = msg.vectorUrl; return; }
  if (msg.exag !== undefined) exag = msg.exag;
  try {
    const out = msg.type === 'buildings' ? await buildBuildings(msg)
      : msg.type === 'places' ? await buildPlaces(msg) : await buildTile(msg);
    self.postMessage({ id: msg.id, ok: true, ...out.result }, out.transfer);
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err) });
  }
};

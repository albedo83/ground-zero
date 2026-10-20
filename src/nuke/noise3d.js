// Texture de bruit 3D périodique « Perlin-Worley » (technique des nuages volumétriques temps réel) :
// R = billow perlin-worley basse fréquence, G = worley fbm haute fréquence (érosion des bords).

import * as THREE from 'three/webgpu';

const N = 64;

function hash3(x, y, z, p) {
  x = ((x % p) + p) % p; y = ((y % p) + p) % p; z = ((z % p) + p) % p;
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

// bruit de valeur lissé périodique
function vnoise(x, y, z, p) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const wgt = (i ? u : 1 - u) * (j ? v : 1 - v) * (k ? w : 1 - w);
    r += wgt * hash3(xi + i, yi + j, zi + k, p);
  }
  return r;
}

function worley(x, y, z, p) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d = 9;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, cz = zi + k;
    const fx = cx + hash3(cx, cy, cz, p), fy = cy + hash3(cx + 17, cy, cz, p), fz = cz + hash3(cx, cy + 31, cz, p);
    const dd = (fx - x) ** 2 + (fy - y) ** 2 + (fz - z) ** 2;
    if (dd < d) d = dd;
  }
  return Math.min(1, Math.sqrt(d));
}

let cached = null;

export function getNoiseTexture() {
  if (cached) return cached;
  const data = new Uint8Array(N * N * N * 4);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N;
    // fbm de valeur (4 octaves, périodique)
    let f = 0, amp = 0.5, tot = 0;
    for (let o = 0; o < 4; o++) {
      const fr = 4 << o;
      f += amp * vnoise(u * fr, v * fr, w * fr, fr);
      tot += amp; amp *= 0.5;
    }
    f /= tot;
    const w1 = 1 - worley(u * 4, v * 4, w * 4, 4);
    const w2 = 1 - worley(u * 8, v * 8, w * 8, 8);
    const w3 = 1 - worley(u * 16, v * 16, w * 16, 16);
    const wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
    // Perlin-Worley : le fbm remappé par le worley donne des « choux-fleurs »
    const pw = Math.min(1, Math.max(0, (f - (wf - 1)) / (1 - (wf - 1)) - 0.35) * 1.6);
    const hf = w2 * 0.6 + w3 * 0.4;
    const i = ((z * N + y) * N + x) * 4;
    data[i] = Math.round(Math.min(1, Math.max(0, pw)) * 255);
    data[i + 1] = Math.round(hf * 255);
    data[i + 2] = Math.round(f * 255);
    data[i + 3] = 255;
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}

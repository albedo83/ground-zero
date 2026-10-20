// Géodésie WGS84 + projection Web Mercator (partagé entre thread principal et workers)

export const A = 6378137.0;
export const F = 1 / 298.257223563;
export const E2 = F * (2 - F);
export const B = A * (1 - F);

export function geodeticToEcef(lat, lon, h, out = [0, 0, 0], o = 0) {
  const sl = Math.sin(lat), cl = Math.cos(lat);
  const n = A / Math.sqrt(1 - E2 * sl * sl);
  out[o] = (n + h) * cl * Math.cos(lon);
  out[o + 1] = (n + h) * cl * Math.sin(lon);
  out[o + 2] = (n * (1 - E2) + h) * sl;
  return out;
}

export function ecefToGeodetic(x, y, z) {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - E2));
  let h = 0;
  for (let i = 0; i < 5; i++) {
    const sl = Math.sin(lat);
    const n = A / Math.sqrt(1 - E2 * sl * sl);
    const cl = Math.cos(lat);
    h = Math.abs(cl) > 1e-6 ? p / cl - n : Math.abs(z) - n * (1 - E2);
    lat = Math.atan2(z, p * (1 - E2 * n / (n + h)));
  }
  return { lat, lon, h };
}

// yNorm ∈ [0,1] du nord au sud
export const mercYToLat = (yNorm) => Math.atan(Math.sinh(Math.PI * (1 - 2 * yNorm)));
export const latToMercY = (lat) => (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2;
export const MAX_LAT = mercYToLat(0);

// Repère local Est/Nord/Haut (normale géodésique)
export function enu(lat, lon) {
  const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
  return {
    east: [-so, co, 0],
    north: [-sl * co, -sl * so, cl],
    up: [cl * co, cl * so, sl],
  };
}

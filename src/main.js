import * as THREE from 'three/webgpu';
import {
  positionView, normalize, cross, length, dot, clamp, pow, vec3, vec2, uniform, float, pass, screenUV, screenSize,
  fract, sin, mix,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { Globe } from './globe.js';
import { EarthControls } from './controls.js';
import { A, B, geodeticToEcef, ecefToGeodetic } from './geo.js';
import { IMAGERY, TERRAIN, VECTOR } from './config.js';
import {
  HISTORICAL_DETONATIONS_BASE, WEAPON_PRESETS, TARGET_CITIES, formatDistance, calculateNuclearEffects, overpressureAt,
} from './nuke/physics.js';
import { NuclearSoundEngine } from './nuke/sound.js';
import { Explosion } from './nuke/explosion.js';
import { CityLabels } from './labels.js';
import './style.css';

const $ = (s) => document.querySelector(s);
const d2r = THREE.MathUtils.degToRad, r2d = THREE.MathUtils.radToDeg;

// ---------- Rendu ----------

const canvas = $('#view');
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
// écran tactile (téléphone, tablette) : résolution plafonnée pour garder la fluidité et la batterie
const isTouch = window.matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setClearColor(0x000000, 0);
await renderer.init();
const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 1e8);

const ambient = new THREE.AmbientLight(0xffffff, 0.42);
// sol plat ≈ 1,1 × l'imagerie en plein jour ; ambiance basse et soleil fort : versants très contrastés
const sun = new THREE.DirectionalLight(0xfff2e0, 1.5);
scene.add(ambient, sun, sun.target);

let stars;
{
  const n = 4000, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(5e7);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false }));
  scene.add(stars);
}

const globe = new Globe(scene, { imagery: 'sentinel' });
await globe.init();

// Atmosphère (halo analytique)
const R_ATM = A * 1.028;
const uCenter = uniform(new THREE.Vector3());
{
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const dir = normalize(positionView);
  const d = dot(dir, uCenter).greaterThan(0).select(length(cross(dir, uCenter)), length(uCenter));
  const t = clamp(d.sub(B).div(R_ATM - B), 0, 1);
  const glow = pow(float(1).sub(t), 2.2);
  mat.colorNode = vec3(0.32, 0.58, 1.0).mul(glow).add(vec3(0.9, 0.95, 1.0).mul(pow(glow, 8).mul(0.35)));
  const shell = new THREE.Mesh(new THREE.SphereGeometry(R_ATM, 160, 80), mat);
  shell.scale.set(1, 1, B / A);
  shell.frustumCulled = false;
  shell.renderOrder = -1;
  globe.group.add(shell);
}
const fog = new THREE.Fog(0xffffff, 1e6, 2e6);
fog.color.setRGB(0.3, 0.52, 0.88, THREE.LinearSRGBColorSpace);

// ---------- Niveaux de qualité ----------
// Chaque niveau règle : résolution max, résolution et nombre de pas du nuage, ombrage du nuage,
// bloom, réfraction de l'onde de choc, finesse des tuiles et portée des bâtiments 3D.
const QUALITY = {
  low: { label: 'Low', dpr: 1, vol: 0.34, steps: 36, shadow2: 0, ao: 0, bloom: false, refraction: false, sse: 2.0, buildings: 2500 },
  medium: { label: 'Medium', dpr: 1.25, vol: 0.42, steps: 48, shadow2: 0, ao: 1, bloom: true, refraction: true, sse: 1.5, buildings: 4500 },
  high: { label: 'High', dpr: 1.5, vol: 0.5, steps: 64, shadow2: 1, ao: 1, bloom: true, refraction: true, sse: 1.25, buildings: 7000 },
  ultra: { label: 'Ultra', dpr: 2, vol: 0.6, steps: 80, shadow2: 1, ao: 1, bloom: true, refraction: true, sse: 1.1, buildings: 9000 },
};
const TIERS = ['low', 'medium', 'high', 'ultra'];
// point de départ prudent selon la machine ; le niveau s'ajuste ensuite à la fluidité mesurée
const weakDevice = backend !== 'WebGPU' || (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
const quality = {
  auto: true,
  tier: weakDevice ? 'medium' : 'high',
  ceiling: isTouch ? 'high' : 'ultra',
};

// Post-traitement :
//  1. scène principale ; 2. nuage volumétrique à demi-résolution (masqué par la profondeur de la scène),
//     flouté puis composé ; 3. bloom HDR ; 4. grain / vignette « pellicule »
const pipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera, { samples: weakDevice ? 0 : 4 });
const sceneColor = scenePass.getTextureNode('output');
const volumeScene = new THREE.Scene();
const volumePass = pass(volumeScene, camera, { samples: 0 });
const uVolScale = uniform(0.6);
volumePass.setResolutionScale(0.6);

const explosion = new Explosion(globe, { volumeScene, sceneDepth: scenePass.getTextureNode('depth') });
const controls = new EarthControls(canvas, camera, globe);
const labels = new CityLabels(globe, camera, $('#city-labels'), { max: isTouch ? 22 : 45 });
const sound = new NuclearSoundEngine();

// filtre « tente » léger (5 échantillons) : efface le bruit du raymarching sans flouter les volutes
const volTex = volumePass.getTextureNode('output');
const px = vec2(1.0).div(screenSize.mul(uVolScale));
const volume = volTex.sample(screenUV).mul(0.4)
  .add(volTex.sample(screenUV.add(px.mul(vec2(0.75, 0.75)))).mul(0.15))
  .add(volTex.sample(screenUV.add(px.mul(vec2(-0.75, 0.75)))).mul(0.15))
  .add(volTex.sample(screenUV.add(px.mul(vec2(0.75, -0.75)))).mul(0.15))
  .add(volTex.sample(screenUV.add(px.mul(vec2(-0.75, -0.75)))).mul(0.15));
const composite = sceneColor.rgb.mul(float(1).sub(volume.a)).add(volume.rgb);
const bloomPass = bloom(composite, 0.55, 0.55, 0.95);
const uFilm = uniform(1);
const uTime = uniform(0);
const uFlashTint = uniform(0);
// deux sorties : avec et sans bloom (sans bloom, ses 5 passes de flou ne sont plus calculées du tout)
function finalOutput(withBloom) {
  const uv = screenUV;
  const grain = fract(sin(uv.x.mul(12.9898).add(uv.y.mul(78.233)).add(uTime.mul(17.13))).mul(43758.5453)).sub(0.5);
  const vig = float(1).sub(pow(length(uv.sub(0.5)).mul(1.25), 2.4).mul(0.3));
  let col = withBloom ? composite.add(bloomPass.rgb) : composite;
  col = col.mul(mix(float(1), vig, uFilm)).add(grain.mul(0.012).mul(uFilm));
  // la caméra sature : le flash blanchit l'image
  return mix(col, vec3(1.6, 1.45, 1.25), uFlashTint);
}
const outputs = { bloom: finalOutput(true), plain: finalOutput(false) };
let userBloom = true;
function setBloom(on) {
  const node = on ? outputs.bloom : outputs.plain;
  if (pipeline.outputNode !== node) { pipeline.outputNode = node; pipeline.needsUpdate = true; }
}
setBloom(true);

// ---------- État de l'application ----------

const state = {
  presetId: 'little-boy',
  yieldKt: 15,
  burst: 'airburst',
  lat: 48.8584, lon: 2.2945, targetName: 'PARIS, FRANCE',
  view: 'globe',
  strikes: 0, deaths: 0, injured: 0,
  effects: null,
  armed: false, detonated: false, t: 0, speedMode: 'auto', paused: false,
  arrived: false, tracking: false,
  shake: 0, glare: 0, autoFactor: 1,
};
try {
  const saved = JSON.parse(localStorage.getItem('groundzero_globe_stats') || 'null');
  if (saved) Object.assign(state, { strikes: saved.strikes ?? 0, deaths: saved.deaths ?? 0, injured: saved.injured ?? 0 });
} catch { /* stockage indisponible */ }
const saveStats = () => {
  try { localStorage.setItem('groundzero_globe_stats', JSON.stringify({ strikes: state.strikes, deaths: state.deaths, injured: state.injured })); } catch { /* ignore */ }
};

// ---------- Accessibilité ----------

// annonces ponctuelles pour lecteurs d'écran (zone role=status, hors de l'affichage)
let announceTimer = null;
function announce(text) {
  const el = $('#sr-live');
  el.textContent = '';
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { el.textContent = text; }, 60);
}
// « réduire les animations » : pas de tremblement, flash adouci
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------- Compteur mondial (service /api du serveur ; repli local si indisponible) ----------

const API = `${import.meta.env.BASE_URL}api/`;
state.global = null; // { strikes, deaths, injured } partagés par tous les visiteurs

function renderCounter() {
  const g = state.global;
  // 2 058 essais et emplois réels + les frappes simulées sur ce site (ou les tiennes hors ligne)
  $('#global-counter-value').textContent = fmt(HISTORICAL_DETONATIONS_BASE + (g ? g.strikes : state.strikes));
  $('#counter-detail').textContent = g
    ? `simulated here: ${fmt(g.strikes)} · yours: ${fmt(state.strikes)}`
    : `your strikes: ${fmt(state.strikes)}`;
  $('#global-deaths-count').textContent = fmt(g ? g.deaths : state.deaths);
  $('#global-injured-count').textContent = fmt(g ? g.injured : state.injured);
}

function acceptStats(d) {
  if (d && Number.isFinite(d.strikes)) { state.global = { strikes: d.strikes, deaths: d.deaths, injured: d.injured }; renderCounter(); }
}

async function fetchStats() {
  try {
    const r = await fetch(`${API}stats`, { cache: 'no-store' });
    if (r.ok) acceptStats(await r.json());
  } catch { /* hors ligne : compteur local */ }
}

// le serveur recalcule lui-même les victimes : on n'envoie que la puissance, la position et le type d'explosion
async function postStrike(e) {
  try {
    const r = await fetch(`${API}strike`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yieldKt: state.yieldKt, lat: state.lat, lon: state.lon, burst: state.burst }),
    });
    if (r.ok || r.status === 429) acceptStats(await r.json());
  } catch {
    // service injoignable : on ajoute la frappe localement pour ne pas figer l'affichage
    if (state.global) {
      state.global.strikes++; state.global.deaths += e.casualties.deaths; state.global.injured += e.casualties.injured;
      renderCounter();
    }
  }
}

fetchStats();
setInterval(() => { if (!document.hidden) fetchStats(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchStats(); });

// ---------- HUD ----------

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const sliderToYield = (v) => Math.pow(10, -2 + (Number(v) / 1000) * 7);
const yieldToSlider = (y) => Math.round(((Math.log10(Math.max(0.01, Math.min(1e5, y))) + 2) / 7) * 1000);
const fmtCoords = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} / ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;

function refresh() {
  const e = state.effects = calculateNuclearEffects(state.yieldKt, state.lat, state.lon, state.burst);
  const preset = WEAPON_PRESETS.find((p) => p.id === state.presetId);
  $('#report-weapon-title').textContent = `${preset ? preset.name : 'CUSTOM WARHEAD'} — ${e.yieldFormatted}`;
  const loc = state.targetName || e.casualties.cityName;
  const coords = fmtCoords(state.lat, state.lon);
  $('#report-coords-line').textContent = `${loc ? `${loc} (${coords})` : coords} · cloud top ${e.cloudTopKm} km`;
  $('#radius-1psi').textContent = e.formattedRadii.blast1Psi;
  $('#radius-thermal').textContent = e.formattedRadii.thermal;
  $('#radius-5psi').textContent = e.formattedRadii.blast5Psi;
  $('#radius-20psi').textContent = e.formattedRadii.blast20Psi;
  $('#radius-fireball').textContent = e.formattedRadii.fireball;
  $('#report-deaths').textContent = fmt(e.casualties.deaths);
  $('#report-injured').textContent = fmt(e.casualties.injured);
  $('#report-density').textContent = `density: ${e.casualties.densityLabel} — simplified model`;
  $('#yield-slider-readout').textContent = e.yieldFormatted;
  $('#yield-log-slider').setAttribute('aria-valuetext', e.yieldFormatted.replace(' kt', ' kilotons').replace(' Mt', ' megatons').replace(' t', ' tons'));
  $('#yield-log-slider').value = String(yieldToSlider(state.yieldKt));
  $('#yield-slider-fill').style.width = `${(yieldToSlider(state.yieldKt) / 10).toFixed(1)}%`;
  $('#target-status-title').textContent = loc ? `TARGET: ${loc.toUpperCase()}` : 'TARGET LOCKED';
  $('#target-status-sub').textContent = `${coords} · ${state.view === 'globe' ? 'click to dive' : 'click the ground to retarget'}`;
  renderCounter();
  if (!state.detonated) {
    explosion.setTarget(state.lat, state.lon);
    explosion.setEffects(e);
  }
  return e;
}

function initPresets() {
  const box = $('#preset-buttons-container');
  box.innerHTML = '';
  for (const p of WEAPON_PRESETS) {
    const b = document.createElement('button');
    b.className = `preset-card ${p.id === state.presetId ? 'active' : ''}`;
    b.dataset.id = p.id;
    b.innerHTML = `<div class="preset-name">${p.name}</div><div class="preset-sub">${p.subtitle}</div>`;
    b.onclick = () => {
      sound.playClick(1100);
      state.presetId = p.id;
      state.yieldKt = p.yieldKt;
      state.burst = p.defaultBurst;
      document.querySelectorAll('.burst-btn').forEach((x) => x.classList.toggle('active', x.dataset.burst === state.burst));
      document.querySelectorAll('.preset-card').forEach((x) => x.classList.toggle('active', x.dataset.id === p.id));
      if (state.detonated) resetSim();
      refresh();
      if (state.view !== 'globe') setView(state.view);
    };
    box.appendChild(b);
  }
}

$('#yield-log-slider').addEventListener('input', (e) => {
  state.yieldKt = sliderToYield(e.target.value);
  state.presetId = null;
  document.querySelectorAll('.preset-card').forEach((x) => x.classList.remove('active'));
  if (state.detonated) resetSim();
  refresh();
});

document.querySelectorAll('.burst-btn').forEach((btn) => {
  btn.onclick = () => {
    sound.playClick(950);
    state.burst = btn.dataset.burst;
    document.querySelectorAll('.burst-btn').forEach((b) => b.classList.toggle('active', b === btn));
    if (state.detonated) resetSim();
    refresh();
  };
});

// ---------- Cibles et recherche ----------

function setTarget(lat, lon, name = null, { fly = true } = {}) {
  if (state.detonated) resetSim();
  sound.playTargetLock();
  state.lat = lat; state.lon = lon; state.targetName = name;
  refresh();
  lockTargetMarker();
  announce(`Target set: ${name || fmtCoords(lat, lon)}.`);
  if (!name) reverseGeocode(lat, lon);
  if (fly) setView(state.view);
}

let reverseTimer = null;
function reverseGeocode(lat, lon) {
  clearTimeout(reverseTimer);
  reverseTimer = setTimeout(async () => {
    try {
      const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&lang=en`);
      const p = (await r.json()).features?.[0]?.properties;
      if (!p) return;
      const place = p.city || p.town || p.village || p.county || p.state || p.name;
      if (place && Math.abs(state.lat - lat) < 1e-6) {
        const label = `${place}${p.country ? `, ${p.country}` : ''}`;
        state.targetName = label.toUpperCase();
        $('#city-search-input').value = label;
        refresh();
      }
    } catch { /* hors ligne */ }
  }, 250);
}

const elSearch = $('#city-search-input'), elDrop = $('#city-dropdown');
function renderDropdown(filter = '') {
  const q = filter.trim().toLowerCase();
  elDrop.innerHTML = '';
  for (const c of TARGET_CITIES.filter((c) => !q || c.name.toLowerCase().includes(q))) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'city-option';
    row.innerHTML = `<span>⌖ ${c.name}</span><span class="city-option-meta">${c.density.toLocaleString('en-US')}/km²</span>`;
    row.onclick = () => { closeDropdown(); elSearch.value = c.name; setTarget(c.lat, c.lon, c.name.toUpperCase()); };
    elDrop.appendChild(row);
  }
  if (q.length > 2) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'city-option';
    row.innerHTML = '<span></span><span class="city-option-meta">Photon / OSM</span>';
    row.firstChild.textContent = `🌐 Search "${filter}" worldwide (Enter)`;
    row.onclick = () => { closeDropdown(); geocode(filter); };
    elDrop.appendChild(row);
  }
}
async function geocode(raw) {
  raw = raw.trim();
  if (!raw) return;
  const m = raw.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
  if (m) return setTarget(parseFloat(m[1]), parseFloat(m[3]));
  const local = TARGET_CITIES.find((c) => c.name.toLowerCase().includes(raw.toLowerCase()));
  if (local) return setTarget(local.lat, local.lon, local.name.toUpperCase());
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(raw)}&limit=1&lang=en`);
    const f = (await r.json()).features?.[0];
    if (!f) return;
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;
    setTarget(lat, lon, [p.name, p.country].filter(Boolean).join(', ').toUpperCase());
  } catch { /* hors ligne */ }
}
function openDropdown(filter) {
  renderDropdown(filter);
  elDrop.classList.remove('hidden');
  elSearch.setAttribute('aria-expanded', 'true');
  $('#city-presets-toggle').setAttribute('aria-expanded', 'true');
}
function closeDropdown() {
  elDrop.classList.add('hidden');
  elSearch.setAttribute('aria-expanded', 'false');
  $('#city-presets-toggle').setAttribute('aria-expanded', 'false');
}
elSearch.addEventListener('focus', () => openDropdown(elSearch.value));
elSearch.addEventListener('input', () => openDropdown(elSearch.value));
elSearch.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { closeDropdown(); geocode(elSearch.value); }
  if (e.key === 'Escape') { closeDropdown(); }
  if (e.key === 'ArrowDown') { e.preventDefault(); elDrop.querySelector('.city-option')?.focus(); }
});
// flèches haut/bas dans la liste, Échap pour revenir au champ
elDrop.addEventListener('keydown', (e) => {
  e.stopPropagation();
  const items = [...elDrop.querySelectorAll('.city-option')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); (i <= 0 ? elSearch : items[i - 1]).focus(); }
  if (e.key === 'Escape') { closeDropdown(); elSearch.focus(); }
});
$('#city-presets-toggle').onclick = () => {
  if (elDrop.classList.contains('hidden')) openDropdown(''); else closeDropdown();
};
document.addEventListener('click', (e) => { if (!e.target.closest('.target-bar')) closeDropdown(); });
document.addEventListener('focusin', (e) => { if (!e.target.closest('.target-bar')) closeDropdown(); });

controls.onClick = (lat, lon) => {
  if (state.detonated || state.armed) return;
  setTarget(lat, lon, null, { fly: false });
};
controls.onUserInput = () => { state.tracking = false; };
controls.onKeyTarget = () => {
  if (state.detonated || state.armed) return;
  const c = controls.desired;
  setTarget(r2d(c.lat), r2d(c.lon), null, { fly: false });
};

// ---------- Modes caméra ----------

// observateur fixe : distance horizontale D, hauteur hc, point visé à `aim` au-dessus du point zéro
function cinemaPose(kind) {
  const e = state.effects;
  const r = e.radii;
  const Htop = e.cloudTopKm * 1000;
  if (kind === 'street') return { D: r.blast5PsiM * 1.75, hc: 1.8, aim: Math.max(e.optimalHobMeters * 0.8, 120) };
  // spectateur aérien : en hélicoptère, à ~1/3 de la hauteur finale du nuage, il domine la ville
  return { D: Math.max(r.blast1PsiM * 1.35, Htop * 1.55), hc: Math.max(1200, Htop * 0.32), aim: Math.max(e.optimalHobMeters, 250) };
}

function poseFor(D, hc, aim) {
  const dz = hc - aim;
  return { range: Math.hypot(D, dz), pitch: r2d(Math.atan2(D, dz)) };
}

function trackAim(mode) {
  const s = explosion.state;
  const c = cinemaPose(mode);
  if (!s || !state.detonated) return c.aim;
  // quand la tige s'est dissipée, il ne reste que le chapeau en altitude : on relève le cadre
  const lift = 0.24 * (1 - (s.stemFade ?? 1));
  return Math.max(c.aim, s.capC * ((mode === 'street' ? 0.55 : 0.5) + lift));
}

function setView(mode) {
  state.view = mode;
  document.querySelectorAll('.view-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === mode);
    b.setAttribute('aria-pressed', String(b.dataset.view === mode));
  });
  document.body.classList.toggle('cinematic', mode === 'cinema' || mode === 'street');
  controls.minClearance = mode === 'street' ? 1.6 : 15;
  const e = state.effects;
  const heading = r2d(controls.desired.heading);
  if (mode === 'globe') {
    state.tracking = false;
    controls.flyTo({ lat: state.lat, lon: state.lon, range: A * 2.4, heading: 0, pitch: 0 });
  } else if (mode === 'tactical') {
    state.tracking = false;
    controls.flyTo({ lat: state.lat, lon: state.lon, range: Math.max(e.radii.blast1PsiM, e.radii.thermalM) * 3.4, heading, pitch: 48 });
  } else {
    const c = cinemaPose(mode);
    const aim = trackAim(mode);
    const p = poseFor(c.D, c.hc, aim);
    state.tracking = true;
    controls.flyTo({ lat: state.lat, lon: state.lon, range: p.range, heading, pitch: p.pitch, aim });
  }
  refresh();
}

document.querySelectorAll('.view-btn').forEach((b) => { b.onclick = () => { sound.playClick(1300); setView(b.dataset.view); }; });
$('#brand-reset-btn').onclick = () => setView('globe');
$('#target-status-box').onclick = () => setView(state.view === 'globe' ? 'cinema' : 'globe');
document.querySelectorAll('.effect-item').forEach((it) => { it.onclick = () => setView('tactical'); });

// ---------- Détonation ----------

function detonate() {
  if (state.armed) return;
  sound.init();
  if (state.detonated) resetSim();
  const e = refresh();
  state.strikes++;
  state.deaths += e.casualties.deaths;
  state.injured += e.casualties.injured;
  saveStats();
  postStrike(e);
  refresh();
  const counter = $('#global-counter-value');
  counter.style.transform = 'scale(1.14)';
  setTimeout(() => { counter.style.transform = 'scale(1)'; }, 220);

  state.armed = true;
  $('#live-telemetry-panel').classList.remove('hidden');
  document.body.classList.add('detonating');
  setPaused(false);
  if (state.view === 'globe') setView('cinema');
  else if (state.view === 'cinema' || state.view === 'street') setView(state.view);
  // le compte à rebours démarre quand la caméra est en place (géré dans la boucle de rendu)
  state.armTimer = 1.4;
  state.whistled = false;
  showAlert(`☢ WEAPON RELEASE — ${e.optimalHobMeters ? `HOB ${fmt(e.optimalHobMeters)} m` : 'SURFACE BURST'}`);
}

function stepArming(dt) {
  if (!state.armed || controls.flight) return;
  state.armTimer -= dt;
  if (!state.whistled && state.armTimer < 1.0) { state.whistled = true; sound.playIncomingDrop(1.0); }
  if (state.armTimer > 0) return;
  const e = state.effects;
  state.armed = false;
  state.detonated = true;
  state.t = 0;
  state.arrived = false;
  state.autoFactor = 1;
  state.glare = 0;
  explosion.setTarget(state.lat, state.lon);
  explosion.setEffects(e);
  explosion.detonate();
  // silence au flash ; le son voyage ensuite à sa vraie vitesse jusqu'à la caméra
  const camDist = state.camPos ? explosion.origin.distanceTo(state.camPos) : 20000;
  sound.playDetonationFlash(state.yieldKt, camDist);
  announce(`Detonation: ${e.yieldFormatted} over ${state.targetName || 'the target'}. Shockwave arrives in about ${Math.round(camDist / 340)} seconds.`);
}

function resetSim() {
  sound.stopAll();
  state.armed = false;
  state.detonated = false;
  state.t = 0;
  state.shake = 0;
  explosion.reset();
  $('#thermal-flash-overlay').style.opacity = '0';
  $('#shockwave-alert').classList.add('hidden');
  $('#live-telemetry-panel').classList.add('hidden');
  document.body.classList.remove('detonating');
  renderer.toneMappingExposure = 1;
  uFlashTint.value = 0;
}

let alertTimer = null;
function showAlert(text, ms = 0) {
  $('#shockwave-alert').classList.remove('hidden');
  $('#shockwave-alert-text').textContent = text;
  clearTimeout(alertTimer);
  if (ms) alertTimer = setTimeout(() => $('#shockwave-alert').classList.add('hidden'), ms);
}

$('#detonate-btn').onclick = detonate;
// barre de contrôle réduite : lecture/pause, frise, vitesse (cycle), nouvelle frappe
const SPEEDS = ['auto', '0.25', '1', '10'];
const speedLabel = (m) => (m === 'auto' ? 'AUTO' : `${m}×`);
function setPaused(p) {
  state.paused = p;
  const b = $('#mb-play');
  b.textContent = p ? '▶' : '⏸';
  b.title = p ? 'Play' : 'Pause';
  b.setAttribute('aria-label', b.title);
}
$('#mb-play').onclick = () => { sound.playClick(900); setPaused(!state.paused); };
$('#mb-speed').onclick = () => {
  sound.playClick(1000);
  state.speedMode = SPEEDS[(SPEEDS.indexOf(state.speedMode) + 1) % SPEEDS.length];
  $('#mb-speed').textContent = speedLabel(state.speedMode);
  $('#mb-speed').setAttribute('aria-label', `Playback speed: ${state.speedMode === 'auto' ? 'auto' : `${state.speedMode} times`}`);
  setPaused(false);
};
$('#mb-reset').onclick = () => { sound.playClick(750); resetSim(); refresh(); };
$('#timeline-scrub-slider').addEventListener('input', (e) => {
  if (!state.detonated) return;
  setPaused(true);
  state.t = parseFloat(e.target.value);
  state.arrived = true;
  $('#shockwave-alert').classList.add('hidden');
});

// ---------- Panneau rendu, audio, modales ----------

// plein écran on/off (API standard + préfixe WebKit ; absent sur iPhone, où le bouton est masqué)
{
  const root = document.documentElement;
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const canFs = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  const btn = $('#fs-btn');
  // déjà lancé depuis l'écran d'accueil (iOS) : on est déjà en plein écran
  const standalone = navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  btn.onclick = async () => {
    if (standalone && !canFs) {
      showAlert('ALREADY FULL SCREEN (HOME SCREEN APP)', 3500);
      return;
    }
    // iPhone : pas d'API plein écran dans Safari, on explique la voie « écran d'accueil »
    if (!canFs) {
      showAlert('FULL SCREEN ON IPHONE: SHARE ⬆ → "ADD TO HOME SCREEN", THEN OPEN FROM THE ICON', 6000);
      return;
    }
    try {
      if (fsEl()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else await (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: 'hide' });
    } catch { /* refusé par le navigateur */ }
  };
  const sync = () => {
    const on = !!fsEl();
    document.body.classList.toggle('is-fullscreen', on);
    btn.title = on ? 'Quitter le plein écran' : 'Plein écran';
  };
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
}

$('#build-tag').textContent = __BUILD__;

// rapport de dégâts repliable (utile sur téléphone en paysage)
$('.damage-header-row').addEventListener('click', (e) => {
  if (e.target.closest('.burst-btn')) return;
  $('.damage-card').classList.toggle('open');
  $('.damage-header-row').setAttribute('aria-expanded', String($('.damage-card').classList.contains('open')));
});
$('#fx-toggle-header').onclick = () => $('#fx-control-body').classList.toggle('collapsed');
$('#fx-imagery').onchange = (e) => { globe.setImagery(e.target.value); };
// exagération du relief : l'étiquette suit le curseur, le rechargement se fait au relâchement
$('#fx-relief').oninput = (e) => { $('#fx-relief-val').textContent = `×${Number(e.target.value).toFixed(2).replace(/0$/, '')}`; };
$('#fx-relief').onchange = (e) => { globe.setExaggeration(Number(e.target.value)); };
$('#fx-bloom').onchange = (e) => { userBloom = e.target.checked; setBloom(userBloom && QUALITY[quality.tier].bloom); };
$('#fx-quality').onchange = (e) => {
  quality.auto = e.target.value === 'auto';
  if (!quality.auto) applyQuality(e.target.value);
  else refreshQualityLabel();
};
$('#fx-film').onchange = (e) => { uFilm.value = e.target.checked ? 1 : 0; };
let shakeEnabled = true;
$('#fx-shake').onchange = (e) => { shakeEnabled = e.target.checked; };
$('#audio-toggle-btn').onclick = (e) => {
  sound.setEnabled(!sound.enabled);
  e.currentTarget.textContent = sound.enabled ? '🔊 AUDIO: ON' : '🔇 AUDIO: OFF';
};

// la présentation scientifique est écrite en dur dans index.html (lisible par les moteurs de recherche)
const aboutHtml = $('#about-content').outerHTML;
const CREDITS = () => `<div class="credits">
  <p>${IMAGERY[globe.imagery].attribution}</p><p>${TERRAIN.attribution}</p><p>${VECTOR.attribution}</p>
  <p>Geocoding: <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a> (OpenStreetMap)</p></div>`;
let modalOpener = null;
function openModal(title, html) {
  modalOpener = document.activeElement;
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#science-modal').classList.remove('hidden');
  $('#close-science-modal').focus();
}
function closeModal() {
  $('#science-modal').classList.add('hidden');
  modalOpener?.focus?.();
}
$('#science-modal').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') { closeModal(); return; }
  if (e.key !== 'Tab') return;
  const f = [...$('#science-modal').querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')];
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
$('#science-modal-btn').onclick = () => openModal('SCIENTIFIC MODEL & REFERENCES', aboutHtml);
$('#credits-btn').onclick = () => openModal('MAP DATA', CREDITS());
$('#close-science-modal').onclick = closeModal;
$('#science-modal').onclick = (e) => { if (e.target.id === 'science-modal') closeModal(); };

// éléments « bouton » non natifs : activables au clavier (Entrée / Espace)
document.addEventListener('keydown', (e) => {
  const el = e.target.closest?.('[role="button"][tabindex]');
  if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); el.click(); }
}, true);

window.addEventListener('keydown', (e) => {
  // raccourcis globaux seulement hors des champs et boutons (sinon Espace activerait aussi le bouton)
  if (e.target.closest?.('input, select, textarea, button, a, [role="button"]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Espace : détoner, ou pause/lecture pendant une détonation
  if (e.code === 'Space') { e.preventDefault(); state.detonated ? setPaused(!state.paused) : detonate(); }
  else if (e.key === '1') setView('globe');
  else if (e.key === '2') setView('cinema');
  else if (e.key === '3') setView('tactical');
  else if (e.key === '4') setView('street');
  else if (e.key.toLowerCase() === 'r') { resetSim(); refresh(); }
});

// ---------- Boucle ----------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
timer.connect(document);
let hudTimer = 0, fpsFrames = 0, fps = 0;
const shakeQ = new THREE.Quaternion();
const shakeE = new THREE.Euler();

const T_END = 1800; // 30 min simulées : le nuage a le temps de dériver et de se dissiper

function simSpeed() {
  if (state.paused) return 0;
  if (state.speedMode !== 'auto') return parseFloat(state.speedMode);
  return state.autoFactor;
}

renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  uTime.value = (uTime.value + dt) % 1000;

  stepArming(dt);
  // horloge : temps réel pendant le flash et le souffle, puis accéléré « documentaire »
  if (state.detonated) {
    if (state.speedMode === 'auto' && state.t > 8 && state.arrived) {
      // temps réel pendant le souffle, puis accéléré « documentaire » de plus en plus fort jusqu'à la dissipation
      const target = state.t < 30 ? 3 : state.t < 150 ? 8 : 30;
      state.autoFactor += (target - state.autoFactor) * Math.min(1, dt * 0.6);
    }
    state.t = Math.min(T_END, state.t + dt * simSpeed());
  }

  // la caméra suit la montée du nuage
  if (state.tracking && (state.view === 'cinema' || state.view === 'street') && !controls.flight) {
    const c = cinemaPose(state.view);
    const d = controls.desired;
    d.aim += (trackAim(state.view) - d.aim) * Math.min(1, dt * 1.5);
    // le cadre suit le nuage emporté par le vent
    const st = explosion.state;
    if (st && st.driftM > 50) {
      const P = explosion.origin.clone()
        .addScaledVector(explosion.basis.e, st.driftX * 0.9).addScaledVector(explosion.basis.s, st.driftZ * 0.9);
      const g = ecefToGeodetic(P.x, P.y, P.z);
      d.lat += (g.lat - d.lat) * Math.min(1, dt * 1.5);
      d.lon += (g.lon - d.lon) * Math.min(1, dt * 1.5);
    }
    const p = poseFor(c.D, c.hc, d.aim);
    d.range = p.range;
    d.pitch = d2r(p.pitch);
  }

  const pose = controls.update(dt);
  state.camPos = pose.pos;
  const camPos = pose.pos;

  camera.position.set(0, 0, 0);
  camera.quaternion.copy(pose.quat);

  // tremblement à l'arrivée de l'onde de choc
  state.shake *= Math.exp(-dt / 1.4);
  if (shakeEnabled && !reduceMotion.matches && state.shake > 0.002) {
    const a = state.shake, tt = uTime.value;
    shakeE.set(
      (Math.sin(tt * 37.1) + Math.sin(tt * 61.7) * 0.5) * a * 0.012,
      (Math.sin(tt * 43.3) + Math.sin(tt * 71.9) * 0.5) * a * 0.012,
      Math.sin(tt * 29.3) * a * 0.008,
    );
    camera.quaternion.multiply(shakeQ.setFromEuler(shakeE));
  }

  const camR = camPos.length();
  const hAG = Math.max(controls.heightAboveGround, 1);
  const horizon = Math.sqrt(Math.max(camR * camR - B * B, 0));
  camera.near = Math.max(0.3, hAG * 0.02);
  camera.far = horizon + Math.sqrt(R_ATM * R_ATM - B * B) + 1e5;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const localUp = camPos.clone().normalize();
  const fwdH = pose.forward.clone().addScaledVector(localUp, -pose.forward.dot(localUp));
  if (fwdH.lengthSq() < 1e-6) fwdH.copy(pose.up);
  fwdH.normalize();
  // soleil de trois-quarts arrière-gauche : relief lisible, nuages modelés
  // lumière rasante (≈ 25°) : creuse les vallées et fait ressortir les reliefs
  sun.position.copy(localUp).multiplyScalar(0.5).addScaledVector(pose.right, -0.95).addScaledVector(fwdH, 0.15).normalize();

  const alt = controls.camHeight;
  uCenter.value.copy(camPos).negate().applyMatrix4(camera.matrixWorldInverse);
  if (alt < 120000) {
    fog.near = Math.min(horizon * 0.35, 4e4 + alt * 3);
    fog.far = horizon * 1.25 + 2e4;
    scene.fog = fog;
  } else scene.fog = null;
  stars.material.opacity = THREE.MathUtils.clamp((alt - 40000) / 200000, 0, 0.85);

  // explosion
  const s = explosion.update(state.t, camPos, pose.forward, sun.position, scene.fog);
  if (state.detonated && s) {
    const e = state.effects;
    const burst = new THREE.Vector3(...geodeticToEcef(d2r(state.lat), d2r(state.lon), explosion.groundH + s.capC));
    const toFb = burst.clone().sub(camPos);
    const dist = toFb.length();
    const gz = new THREE.Vector3(...geodeticToEcef(d2r(state.lat), d2r(state.lon), explosion.groundH));
    const groundDist = gz.distanceTo(camPos);
    const facing = THREE.MathUtils.clamp(toFb.normalize().dot(pose.forward) * 0.6 + 0.55, 0.2, 1);

    // flash thermique : la caméra sature
    const distK = Math.min(1, (e.radii.fireballM * 90) / dist);
    const flash = s.flashIntensity * (s.t < 3 ? 1 : 0) * facing * (0.35 + 0.65 * distK);
    const flashCap = reduceMotion.matches ? 0.35 : 0.94; // flash adouci si l'utilisateur limite les animations
    $('#thermal-flash-overlay').style.opacity = String(Math.min(flashCap, flash * 0.95));
    uFlashTint.value = Math.min(reduceMotion.matches ? 0.3 : 0.85, flash * 0.9);

    // iris automatique : la boule de feu éblouit, le décor s'assombrit puis récupère
    // seul le flash (pas la lueur lente du nuage) ferme l'iris, qui se rouvre en ~1 s
    const flashLum = Math.max(0, s.brightness - 1.5 * s.coreFade);
    const glareTarget = Math.min(6, flashLum * Math.min(1, (s.fireballR * 6) / dist) * facing);
    state.glare += (glareTarget - state.glare) * Math.min(1, dt * (glareTarget > state.glare ? 20 : 2.5));
    renderer.toneMappingExposure = 1 / (1 + state.glare * 0.6);

    // arrivée du souffle sur l'observateur
    if (!state.arrived && s.shockRadiusM >= groundDist && state.t > 0.05) {
      state.arrived = true;
      const psi = overpressureAt(e, groundDist);
      sound.playShockwaveImpact(state.yieldKt, psi);
      state.shake = Math.min(1.6, 0.25 + psi * 0.35);
      showAlert(`⚠ BLAST WAVE IMPACT — ${psi.toFixed(1)} PSI`, 3500);
      announce(`Blast wave reached the camera: ${psi.toFixed(1)} psi.`);
    } else if (!state.arrived && state.t > 0) {
      const eta = (groundDist - s.shockRadiusM) / 340;
      showAlert(`SHOCKWAVE ARRIVAL IN ${eta.toFixed(1)}s (DIST: ${formatDistance(groundDist)})`);
    }
    hudTick(s, groundDist);
  }

  updateTargetMarker(camPos);
  // le réticule de la cible (et son étiquette) a priorité sur les noms de villes
  const tmRect = !tm.classList.contains('hidden-marker') && !tm.classList.contains('edge') && tmPos
    ? [[tmPos.x - 24, tmPos.y - 24, tmPos.x + 120, tmPos.y + 24]] : [];
  labels.update(camPos, performance.now(), tmRect, cloudOccluders(camPos));
  globe.update(camera, camPos, window.innerHeight);

  // rendu à la demande : si rien ne bouge, on ne redessine que 4 fois par seconde
  // (économise batterie et chauffe, et libère le processeur pour charger les tuiles)
  const now = performance.now();
  const q = camera.quaternion;
  const sig = `${camPos.x.toFixed(1)},${camPos.y.toFixed(1)},${camPos.z.toFixed(1)},${q.x.toFixed(5)},${q.y.toFixed(5)},${q.z.toFixed(5)},${state.t},${globe.stats.tiles},${globe.stats.buildings},${dpr},${window.innerWidth}x${window.innerHeight}`;
  const active = sig !== lastSig || controls.flight || state.armed || globe.stats.loading > 0 || now < kickUntil
    || (state.detonated && !state.paused);
  lastSig = sig;
  if (active || now - lastRender > 250) {
    pipeline.render();
    lastRender = now;
    if (active) { fpsFrames++; activeTime += dt; }
  }

  hudTimer += dt;
  if (hudTimer > 0.5) {
    // la fluidité n'est mesurée que sur les images réellement animées
    fps = activeTime > 0.25 ? Math.round(fpsFrames / activeTime) : 0;
    if (fps) adaptResolution(fps);
    fpsFrames = 0; hudTimer = 0; activeTime = 0;
    const c = controls.current;
    const lat = r2d(c.lat), lon = r2d(c.lon);
    $('#hud-geo').textContent = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'} · CAM ALT ${formatDistance(alt)} · ${fps ? `${fps} FPS` : 'IDLE'} · ${QUALITY[quality.tier].label.toUpperCase()}${quality.auto ? ' (AUTO)' : ''} · ${globe.stats.tiles} TILES · ${backend}`;
  }
});

// résolution dynamique : on garde la fluidité quand le volume couvre l'écran
let maxDpr = Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2);
const minDpr = isTouch ? 0.6 : 0.75;
let dpr = Math.min(window.devicePixelRatio, 2), lowFor = 0, highFor = 0, slowFor = 0, smoothFor = 0;
let lastSig = '', lastRender = 0, kickUntil = 0, activeTime = 0;
const kick = (ms = 600) => { kickUntil = performance.now() + ms; };
window.addEventListener('pointerdown', () => kick(1500));
window.addEventListener('wheel', () => kick(800), { passive: true });
window.addEventListener('resize', () => kick());

function applyQuality(tier) {
  const q = QUALITY[tier];
  quality.tier = tier;
  maxDpr = Math.min(window.devicePixelRatio, q.dpr);
  dpr = Math.min(dpr, maxDpr);
  renderer.setPixelRatio(dpr);
  volumePass.setResolutionScale(q.vol);
  uVolScale.value = q.vol;
  explosion.U.steps.value = q.steps;
  explosion.U.shadow2.value = q.shadow2;
  explosion.U.aoOn.value = q.ao;
  explosion.refraction = q.refraction;
  setBloom(userBloom && q.bloom);
  globe.sse = q.sse;
  globe.buildingRange = q.buildings;
  lowFor = highFor = slowFor = smoothFor = 0;
  refreshQualityLabel();
  kick();
}
function refreshQualityLabel() {
  const opt = document.querySelector('#fx-quality option[value="auto"]');
  if (opt) opt.textContent = `Auto (${QUALITY[quality.tier].label})`;
}

// 1) la résolution s'adapte en continu ; 2) si elle est au plancher et que ça rame encore,
//    on descend d'un niveau ; si tout est fluide longtemps, on remonte (jusqu'au plafond de l'appareil)
function adaptResolution(f) {
  if (f < 42) { lowFor++; highFor = 0; } else if (f > 56) { highFor++; lowFor = 0; } else { lowFor = highFor = 0; }
  let next = dpr;
  if (lowFor >= 2 && dpr > minDpr) next = Math.max(minDpr, dpr - 0.25);
  if (highFor >= 6 && dpr < maxDpr) next = Math.min(maxDpr, dpr + 0.25);
  if (next !== dpr) { dpr = next; lowFor = highFor = 0; renderer.setPixelRatio(dpr); }

  if (!quality.auto) return;
  const i = TIERS.indexOf(quality.tier);
  slowFor = f < 30 && dpr <= minDpr + 1e-3 ? slowFor + 1 : 0;
  smoothFor = f > 57 && dpr >= maxDpr - 1e-3 ? smoothFor + 1 : 0;
  if (slowFor >= 3 && i > 0) applyQuality(TIERS[i - 1]);
  else if (smoothFor >= 20 && i < TIERS.indexOf(quality.ceiling)) applyQuality(TIERS[i + 1]);
}
applyQuality(quality.tier);

// ---------- Silhouette du champignon (pour cacher les noms qui sont derrière) ----------

const occV = new THREE.Vector3();
function projectPoint(P, camPos) {
  const q = occV.copy(P).sub(camPos).applyMatrix4(camera.matrixWorldInverse);
  if (q.z > -1) return null;
  const depth = -q.z;
  q.applyMatrix4(camera.projectionMatrix);
  return { x: (q.x * 0.5 + 0.5) * window.innerWidth, y: (-q.y * 0.5 + 0.5) * window.innerHeight, depth };
}
// liste d'ellipses écran { x, y, rx, ry, depth } couvrant le chapeau, la tige et le nuage de base
function cloudOccluders(camPos) {
  const s = explosion.state;
  if (!state.detonated || !s || s.dissipated || s.fade < 0.35) return [];
  const focal = window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const O = explosion.origin, b = explosion.basis;
  const at = (h, lean) => O.clone().addScaledVector(b.u, h)
    .addScaledVector(b.e, s.driftX * lean).addScaledVector(b.s, s.driftZ * lean);
  const out = [];
  const add = (P, rH, rV) => {
    const p = projectPoint(P, camPos);
    if (p) out.push({ x: p.x, y: p.y, rx: (rH / p.depth) * focal, ry: (rV / p.depth) * focal, depth: p.depth - rH });
  };
  // chapeau (ou boule de feu au début)
  const capR = s.toroid > 0.3 ? s.capMajor + s.capMinor * 0.85 : s.capMinor;
  add(at(s.capC, 1), capR, s.capMinor * 1.05);
  // tige (quelques tronçons le long de l'inclinaison)
  if (s.stemTop > 5 && s.stemFade > 0.3) {
    for (const f of [0.15, 0.4, 0.65, 0.88]) add(at(s.stemTop * f, (s.stemTop * f) / Math.max(1, s.capC)), s.stemR * 1.6, s.stemTop * 0.16);
  }
  // nuage de base au sol
  if (s.surgeDensity > 0.2) add(at(s.surgeH * 0.6, 0), s.surgeR * 0.95, s.surgeH * 1.3);
  return out;
}

// ---------- Réticule de cible ----------

const tm = $('#target-marker');
let tmPos = null;
const tmV = new THREE.Vector3(), tmN = new THREE.Vector3();
function lockTargetMarker() {
  tm.classList.remove('locking');
  void tm.offsetWidth; // relance l'animation
  tm.classList.add('locking');
}
function updateTargetMarker(camPos) {
  // pendant l'explosion, le champignon est le repère : on masque le réticule
  if (state.detonated) { tm.classList.add('hidden-marker'); return; }
  const e = state.effects;
  const loc = state.targetName || e.casualties.cityName || fmtCoords(state.lat, state.lon);
  $('#tm-name').textContent = loc.split(',')[0].toUpperCase();
  $('#tm-yield').textContent = state.armed ? `${e.yieldFormatted} · ARMED` : e.yieldFormatted;
  tm.classList.toggle('armed', state.armed);

  const gz = tmN.set(...geodeticToEcef(d2r(state.lat), d2r(state.lon), explosion.groundH ?? 0));
  // derrière l'horizon terrestre ?
  const toCam = tmV.copy(camPos).sub(gz).normalize();
  const behindEarth = gz.clone().normalize().dot(toCam) < -0.02;
  // projection écran (espace rendu = relatif à la caméra)
  const p = tmV.copy(gz).sub(camPos).applyMatrix4(camera.matrixWorldInverse);
  const inFront = p.z < 0;
  p.applyMatrix4(camera.projectionMatrix);
  const W = window.innerWidth, H = window.innerHeight;
  let x = (p.x * 0.5 + 0.5) * W, y = (-p.y * 0.5 + 0.5) * H;
  if (!inFront) { x = W - x; y = H - y; }
  const m = 28;
  // de l'autre côté de la Terre : flèche de bord dans la direction de la cible
  const onScreen = inFront && !behindEarth && x > m && x < W - m && y > m && y < H - m;
  tm.classList.remove('hidden-marker');
  tm.classList.toggle('edge', !onScreen);
  if (!onScreen) {
    // hors champ : flèche plaquée au bord, orientée vers la cible
    const cx = W / 2, cy = H / 2, dx = x - cx, dy = y - cy;
    const k = Math.min((W / 2 - m) / Math.abs(dx || 1e-6), (H / 2 - m) / Math.abs(dy || 1e-6));
    x = cx + dx * k; y = cy + dy * k;
    tm.style.setProperty('--arrow-rot', `${Math.atan2(dy, dx)}rad`);
  }
  tm.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  tmPos = { x, y };
}

let telTimer = 0;
function hudTick(s, camDist) {
  if (telTimer++ % 4) return;
  const e = state.effects;
  $('#tel-temp').textContent = `${fmt(s.t < 0.002 ? s.temperatureK : s.coreTemp)} K`;
  $('#tel-shock-radius').textContent = formatDistance(s.shockRadiusM);
  $('#tel-mach').textContent = `M ${s.machNumber} · ${fmt(s.windSpeedKmh)} km/h`;
  $('#tel-cloud').textContent = formatDistance(s.capC + s.capMinor);
  $('#tel-cam-psi').textContent = state.arrived ? `${overpressureAt(e, camDist).toFixed(1)} psi` : 'pending';
  $('#tel-cam-dist').textContent = formatDistance(camDist);
  $('#mb-time').textContent = `T+${state.t < 100 ? state.t.toFixed(1) : Math.round(state.t)}s`;
  const sl = $('#timeline-scrub-slider');
  sl.setAttribute('aria-valuetext', `T plus ${state.t < 120 ? `${Math.round(state.t)} seconds` : `${Math.round(state.t / 60)} minutes`}`);
  if (document.activeElement !== sl) sl.value = String(state.t);
}

initPresets();
refresh();
lockTargetMarker();
controls.flyTo({ lat: state.lat, lon: state.lon, range: A * 2.4, heading: 0, pitch: 0, duration: 0.01 });

window.__gz = { controls, globe, camera, renderer, explosion, state, detonate, setView, setTarget, quality, applyQuality };

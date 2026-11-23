// Choix du moteur de rendu et affichage des erreurs graphiques.
// Certains pilotes (AMD notamment) peuvent laisser l'écran noir en WebGPU : on montre l'erreur
// et on propose de recharger en WebGL 2. Chargé avant tout le reste pour voir aussi un échec d'initialisation.

const KEY = 'groundzero_renderer';

// choix explicite : ?renderer=webgl|webgpu, sinon le choix enregistré (null si aucun)
function chosenRenderer() {
  const q = new URLSearchParams(location.search).get('renderer');
  if (q === 'webgl' || q === 'webgpu') return q;
  try { const v = localStorage.getItem(KEY); return v === 'webgl' || v === 'webgpu' ? v : null; } catch { return null; }
}

export function preferredRenderer() { return chosenRenderer() || 'webgpu'; }

// sans choix explicite : WebGL 2 sur les cartes AMD (écran noir constaté en WebGPU)
export async function pickRenderer() {
  const chosen = chosenRenderer();
  if (chosen) return chosen;
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    const vendor = (adapter?.info?.vendor || '').toLowerCase();
    if (/\b(amd|ati)\b/.test(vendor)) return 'webgl';
  } catch { /* pas d'adaptateur : WebGPU échouera et Three.js repliera sur WebGL */ }
  return 'webgpu';
}

export function switchRenderer(kind) {
  try { localStorage.setItem(KEY, kind); } catch { /* stockage indisponible */ }
  const url = new URL(location.href);
  url.searchParams.delete('renderer');
  location.replace(url);
}

const seen = new Set();
let count = 0;

// une erreur WebGPU au démarrage (ou dans les 10 s qui suivent) bascule seule en WebGL 2,
// sauf si le visiteur a choisi WebGPU lui-même
let autoUntil = Infinity;
let onWebGPU = false;
export function setBackend(isWebGPU) { onWebGPU = isWebGPU; }

export function reportGpuError(message) {
  const text = String(message || 'Unknown graphics error').slice(0, 600);
  console.error('[GROUND//ZERO] graphics error:', text);
  if (onWebGPU && !chosenRenderer() && performance.now() < autoUntil) { switchRenderer('webgl'); return; }
  count++;
  const box = document.getElementById('gpu-error');
  if (!box) return;
  box.classList.remove('hidden');
  if (!seen.has(text) && seen.size < 4) {
    seen.add(text);
    const li = document.createElement('li');
    li.textContent = text;
    document.getElementById('gpu-error-list').appendChild(li);
  }
  document.getElementById('gpu-error-count').textContent = count > 1 ? ` (${count})` : '';
  const sw = document.getElementById('gpu-error-switch');
  const webgl = preferredRenderer() === 'webgl';
  sw.textContent = webgl ? 'Retry with WebGPU' : 'Switch to WebGL 2';
  sw.onclick = () => switchRenderer(webgl ? 'webgpu' : 'webgl');
}

// erreurs WebGPU non interceptées et perte du périphérique
export function watchDevice(device) {
  if (!device) return;
  device.addEventListener('uncapturederror', (e) => reportGpuError(`WebGPU: ${e.error?.message || e.error}`));
  device.lost.then((info) => {
    if (info.reason !== 'destroyed') reportGpuError(`WebGPU device lost: ${info.message || info.reason}`);
  });
}

// échec pendant le démarrage (init du rendu, shaders, globe)
let started = false;
export function markStarted() { started = true; autoUntil = performance.now() + 10000; }
window.addEventListener('error', (e) => { if (!started) reportGpuError(e.message); });
window.addEventListener('unhandledrejection', (e) => { if (!started) reportGpuError(e.reason?.message || e.reason); });

document.getElementById('gpu-error-close')?.addEventListener('click', () => {
  document.getElementById('gpu-error').classList.add('hidden');
});

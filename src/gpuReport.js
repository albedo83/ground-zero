// Choix du moteur de rendu et affichage des erreurs graphiques.
// Certains pilotes (AMD notamment) peuvent laisser l'écran noir en WebGPU : on montre l'erreur
// et on propose de recharger en WebGL 2. Chargé avant tout le reste pour voir aussi un échec d'initialisation.

const KEY = 'groundzero_renderer';

// ?renderer=webgl|webgpu prime sur le choix enregistré
export function preferredRenderer() {
  const q = new URLSearchParams(location.search).get('renderer');
  if (q === 'webgl' || q === 'webgpu') return q;
  try { return localStorage.getItem(KEY) === 'webgl' ? 'webgl' : 'webgpu'; } catch { return 'webgpu'; }
}

export function switchRenderer(kind) {
  try { localStorage.setItem(KEY, kind); } catch { /* stockage indisponible */ }
  const url = new URL(location.href);
  url.searchParams.delete('renderer');
  location.replace(url);
}

const seen = new Set();
let count = 0;

export function reportGpuError(message) {
  const text = String(message || 'Unknown graphics error').slice(0, 600);
  console.error('[GROUND//ZERO] graphics error:', text);
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
export function markStarted() { started = true; }
window.addEventListener('error', (e) => { if (!started) reportGpuError(e.message); });
window.addEventListener('unhandledrejection', (e) => { if (!started) reportGpuError(e.reason?.message || e.reason); });

document.getElementById('gpu-error-close')?.addEventListener('click', () => {
  document.getElementById('gpu-error').classList.add('hidden');
});

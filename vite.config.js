import { defineConfig } from 'vite';

const stamp = new Date();
const pad = (n) => String(n).padStart(2, '0');

export default defineConfig({
  // repère de version affiché dans le HUD (utile pour vérifier qu'un mobile n'est pas resté sur un ancien cache)
  define: { __BUILD__: JSON.stringify(`v${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`) },
  build: { target: 'esnext' },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  // aperçu du build avec la politique de sécurité de production (test de la CSP en local)
  preview: { host: '127.0.0.1', port: 4173, headers: { 'Content-Security-Policy': process.env.GZ_CSP || '' } },
});

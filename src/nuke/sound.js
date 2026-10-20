// Moteur audio procédural (Web Audio, aucun fichier) pensé pour le réalisme :
//  - au flash : le silence (la lumière arrive avant le son), seulement une légère onde sismique
//    qui précède le souffle (~5 km/s dans le sol) ;
//  - à l'arrivée du front de choc : claquement + coup de pression, puis tonnerre roulant
//    réverbéré ; de près, vent de souffle et verre brisé ; de loin, grondement sourd et long.
// Une réverbération générée et une saturation douce rendent les graves audibles même sur un téléphone.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);

export class NuclearSoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.noise = {};
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.buildGraph();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // maître → limiteur ; bus « événement » (coupable d'un coup) → sec + réverbération
  buildGraph() {
    const c = this.ctx;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.3;
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.limiter).connect(c.destination);

    this.reverb = c.createConvolver();
    this.reverb.buffer = this.makeImpulse(6.5, 2.6);
    this.wet = c.createGain();
    this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet).connect(this.master);
    this.newEventBus();
  }

  newEventBus() {
    const c = this.ctx;
    this.bus = c.createGain();
    this.bus.connect(this.master);
    this.busToVerb = c.createGain();
    this.busToVerb.gain.value = 1;
    this.bus.connect(this.busToVerb).connect(this.reverb);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.stopAll();
    else this.init();
  }

  // coupe tout ce qui joue (fondu court) sans toucher à la réverbération
  stopAll() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const old = this.bus;
    old.gain.setTargetAtTime(0, t, 0.08);
    setTimeout(() => { try { old.disconnect(); } catch { /* déjà déconnecté */ } }, 600);
    clearTimeout(this.seismicTimer);
    this.newEventBus();
  }

  // ---------- Matières premières ----------

  // réponse impulsionnelle stéréo : bruit qui décroît, de plus en plus sourd (grand espace ouvert)
  makeImpulse(seconds, decay) {
    const c = this.ctx, n = Math.floor(seconds * c.sampleRate);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        const k = 0.02 + 0.5 * x; // filtrage croissant : les aigus meurent avant les graves
        lp += (Math.random() * 2 - 1 - lp) * (1 - k);
        d[i] = lp * Math.pow(1 - x, decay) * (i < c.sampleRate * 0.02 ? i / (c.sampleRate * 0.02) : 1);
      }
    }
    return buf;
  }

  noiseBuffer(kind, seconds = 8) {
    const key = `${kind}${seconds}`;
    if (this.noise[key]) return this.noise[key];
    const c = this.ctx, n = Math.floor(seconds * c.sampleRate);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      } else { // brown
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return (this.noise[key] = buf);
  }

  src(kind, { loop = false, seconds = 8 } = {}) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuffer(kind, seconds);
    s.loop = loop;
    return s;
  }

  filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // saturation douce : crée des harmoniques qui rendent les infra-graves audibles sur petits haut-parleurs
  saturator(drive = 2.5) {
    const ws = this.ctx.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * drive) / Math.tanh(drive); }
    ws.curve = curve;
    ws.oversample = '2x';
    return ws;
  }

  // enveloppe de tonnerre : plusieurs « roulements » successifs qui s'amortissent
  rollingCurve(duration, rolls) {
    const n = 512, curve = new Float32Array(n);
    // un premier roulement puissant, puis des échos/roulements qui se chevauchent sur toute la durée
    const peaks = Array.from({ length: rolls }, (_, i) => ({
      at: i === 0 ? 0 : rand(0.04, 0.62) * duration,
      amp: i === 0 ? 1 : rand(0.3, 0.8) * Math.exp(-i * 0.12),
      w: (i === 0 ? 0.12 : rand(0.06, 0.18)) * duration,
      rise: i === 0 ? 0.03 : rand(0.3, 1.2),
    }));
    let max = 0;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * duration;
      let v = 0.28 * Math.exp(-t / (duration * 0.5));
      for (const p of peaks) {
        const dt = t - p.at;
        if (dt >= 0) v += p.amp * (1 - Math.exp(-dt / p.rise)) * Math.exp(-dt / p.w);
      }
      curve[i] = v;
      max = Math.max(max, v);
    }
    for (let i = 0; i < n; i++) curve[i] = (curve[i] / max) * (1 - Math.pow(i / (n - 1), 4));
    curve[n - 1] = 0;
    return curve;
  }

  // ---------- Interface (discrète) ----------

  tick(freq = 2600, gain = 0.04) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = this.src('white', { seconds: 1 });
    const bp = this.filter('bandpass', freq, 3.5);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    s.connect(bp).connect(g).connect(this.master);
    s.start(t, rand(0, 0.5), 0.04);
  }

  playClick() { this.tick(2400 + Math.random() * 600, 0.035); }

  playTargetLock() {
    this.tick(1800, 0.04);
    setTimeout(() => this.tick(2600, 0.035), 70);
  }

  // l'avion largue à ~9 km d'altitude : rien d'audible au sol, on reste silencieux
  playIncomingDrop() {}

  // ---------- Détonation ----------

  // au flash : silence. Si l'observateur est assez proche, l'onde sismique arrive avant le souffle.
  playDetonationFlash(yieldKt = 15, distM = 20000) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    this.stopAll();
    const seismicDelay = distM / 5000;
    const blastDelay = distM / 340;
    if (distM < 80000 && blastDelay - seismicDelay > 0.4) {
      this.seismicTimer = setTimeout(() => this.playSeismic(yieldKt, distM), seismicDelay * 1000);
    }
  }

  // grondement sourd du sol et vibration des vitres
  playSeismic(yieldKt, distM) {
    const c = this.ctx, t = c.currentTime;
    const k = clamp(Math.log10(Math.max(1, yieldKt)) / 4.7, 0.1, 1) * clamp(6000 / distM, 0.15, 1);
    const dur = 2.5 + 2 * k;
    const s = this.src('brown');
    const lp = this.filter('lowpass', 90);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35 * k, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(lp).connect(this.saturator(3)).connect(g).connect(this.bus);
    s.start(t);
    s.stop(t + dur + 0.1);
    // vitres qui tremblent (cliquetis grave modulé)
    const r = this.src('white');
    const bp = this.filter('bandpass', 260, 6);
    const rg = c.createGain();
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = 17;
    lg.gain.value = 0.06 * k;
    lfo.connect(lg).connect(rg.gain);
    rg.gain.setValueAtTime(0, t);
    r.connect(bp).connect(rg).connect(this.bus);
    r.start(t + 0.2); r.stop(t + dur);
    lfo.start(t + 0.2); lfo.stop(t + dur);
  }

  // arrivée du front de choc chez l'observateur
  playShockwaveImpact(yieldKt = 15, psi = 1) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + 0.01;
    const near = clamp((Math.log10(Math.max(0.01, psi)) + 1.3) / 2.3, 0, 1); // 0.05 psi → 0, 10 psi → 1
    const big = clamp(Math.log10(Math.max(0.01, yieldKt)) / 4.7, 0, 1);    // 15 kt ≈ 0.25, 50 Mt ≈ 1
    const loud = 0.35 + 0.65 * near;
    // niveau d'ensemble : un souffle lointain arrive bien plus faible (le limiteur ne doit pas l'égaliser)
    const level = c.createGain();
    level.gain.value = 0.22 + 0.78 * near;
    level.connect(this.bus);
    const out = level;

    // 1. claquement de l'onde N (sec et brillant de près, étouffé de loin)
    {
      const s = this.src('white', { seconds: 2 });
      const lp = this.filter('lowpass', 250 + 7000 * near * near, 0.5);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(1.0 * loud, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12 + 0.5 * (1 - near));
      s.connect(lp).connect(g).connect(out);
      s.start(t); s.stop(t + 1);
    }

    // 2. coup de pression : onde grave saturée (audible même sur téléphone)
    {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(62 - 18 * big, t);
      o.frequency.exponentialRampToValueAtTime(24, t + 1.4);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.95 * loud, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 + big);
      o.connect(g).connect(this.saturator(4)).connect(this.filter('lowpass', 420)).connect(out);
      o.start(t); o.stop(t + 3 + big);
    }

    // 3. tonnerre roulant, long et réverbéré (plus long et plus grave pour les fortes puissances et de loin)
    {
      const dur = 14 + 22 * big + 10 * (1 - near);
      const s = this.src('brown', { loop: true, seconds: 8 });
      const lp = this.filter('lowpass', 700 * (0.45 + near), 0.6);
      lp.frequency.setValueAtTime(700 * (0.45 + near), t);
      lp.frequency.exponentialRampToValueAtTime(90, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setValueCurveAtTime(this.rollingCurve(dur, 5 + Math.round(4 * big)).map((v) => v * 0.9 * (0.55 + 0.45 * loud)), t + 0.05, dur);
      const pan = c.createStereoPanner();
      pan.pan.setValueAtTime(rand(-0.3, 0.3), t);
      pan.pan.linearRampToValueAtTime(rand(-0.3, 0.3), t + dur);
      s.connect(lp).connect(this.saturator(1.8)).connect(g).connect(pan).connect(out);
      s.start(t, rand(0, 6)); s.stop(t + dur + 0.2);
    }

    // 4. vent de souffle : rafale qui balaie la scène (de près uniquement)
    if (near > 0.25) {
      const dur = 2.5 + 5 * near;
      const s = this.src('pink', { loop: true });
      const bp = this.filter('bandpass', 700, 0.6);
      bp.frequency.setValueAtTime(1600, t);
      bp.frequency.exponentialRampToValueAtTime(260, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.6 * near, t + 0.15);
      g.gain.setTargetAtTime(0.25 * near, t + 0.6, 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const pan = c.createStereoPanner();
      pan.pan.setValueAtTime(-0.7, t);
      pan.pan.linearRampToValueAtTime(0.7, t + dur);
      s.connect(bp).connect(g).connect(pan).connect(out);
      s.start(t, rand(0, 4)); s.stop(t + dur + 0.1);
    }

    // 5. verre et débris (au-delà d'environ 0,5 psi les vitres éclatent)
    if (psi > 0.5) {
      const count = Math.round(30 + 90 * near);
      for (let i = 0; i < count; i++) {
        const at = t + 0.03 + Math.pow(Math.random(), 1.8) * (1.2 + 1.8 * near);
        const s = this.src('white', { seconds: 1 });
        const bp = this.filter('bandpass', rand(2500, 9000), rand(6, 18));
        const g = c.createGain();
        const a = rand(0.04, 0.22) * near;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(a, at + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, at + rand(0.04, 0.35));
        const pan = c.createStereoPanner();
        pan.pan.value = rand(-0.9, 0.9);
        s.connect(bp).connect(g).connect(pan).connect(out);
        s.start(at, rand(0, 0.8), 0.4);
      }
      // gravats plus lourds
      for (let i = 0; i < Math.round(8 + 20 * near); i++) {
        const at = t + 0.2 + Math.random() * (2 + 2 * near);
        const s = this.src('brown', { seconds: 2 });
        const bp = this.filter('bandpass', rand(120, 500), 2);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(rand(0.1, 0.3) * near, at + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, at + rand(0.15, 0.5));
        s.connect(bp).connect(g).connect(out);
        s.start(at, rand(0, 1), 0.6);
      }
    }
  }
}

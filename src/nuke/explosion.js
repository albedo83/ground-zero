// Explosion nucléaire à l'échelle réelle, posée sur le globe :
//  - nuage volumétrique raymarché (boule de feu → anneau tourbillonnaire → champignon, tige, nuage de base,
//    coquille de Wilson), émission de corps noir, auto-ombrage, diffusion de Henyey-Greenstein, brume aérienne ;
//  - coquille de choc qui réfracte l'image (viewportSharedTexture) ;
//  - voile au sol drapé sur le relief : anneaux d'effets, brûlure thermique, incendies, front de poussière ;
//  - lumière ponctuelle du flash qui éclaire terrain et bâtiments.

import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, Discard, uniform, vec2, vec3, vec4, float, positionLocal, length, max, min, mix,
  smoothstep, clamp, exp, pow, dot, normalize, texture3D, screenCoordinate, fract, sin, cos, atan, abs, sqrt,
  attribute, viewportSharedTexture, screenUV, normalView, positionViewDirection, cameraNear, cameraFar,
  logarithmicDepthToViewZ,
} from 'three/tsl';
import { geodeticToEcef, ecefToGeodetic, enu } from '../geo.js';
import { explosionTimeline } from './physics.js';
import { getNoiseTexture } from './noise3d.js';
import { damage } from './damage.js';

// le nombre de pas et les échantillons d'ombrage dépendent du niveau de qualité (uniformes : pas de recompilation)

export class Explosion {
  // volumeScene : scène dédiée au nuage (rendue à demi-résolution puis composée) ;
  // sceneDepth : profondeur de la scène principale, pour que relief et bâtiments masquent le nuage
  constructor(globe, { volumeScene, sceneDepth }) {
    this.globe = globe;
    this.group = new THREE.Group();
    globe.group.add(this.group);
    this.volumeRoot = new THREE.Group();
    volumeScene.add(this.volumeRoot);
    this.sceneDepth = sceneDepth;
    this.effects = null;
    this.state = null;
    this.detonated = false;
    this.t = 0;
    this.frame = new THREE.Matrix4();
    this.origin = new THREE.Vector3();
    this.basis = { e: new THREE.Vector3(), u: new THREE.Vector3(), s: new THREE.Vector3() };
    this.noise = getNoiseTexture();

    this.U = {
      camLocal: uniform(new THREE.Vector3()),
      steps: uniform(80, 'int'),
      shadow2: uniform(1),   // 2e échantillon d'ombre vers le soleil
      aoOn: uniform(1),      // occlusion ambiante (échantillon vers le haut)
      camFwd: uniform(new THREE.Vector3(0, 0, -1)),
      extent: uniform(new THREE.Vector3(1, 1, 1)),
      t: uniform(0),
      hob: uniform(0),
      capC: uniform(0), capMajor: uniform(1), capMinor: uniform(1), toroid: uniform(0),
      stemTop: uniform(0), stemR: uniform(1), stemVis: uniform(0),
      surgeR: uniform(1), surgeH: uniform(1), surgeDen: uniform(0),
      wilson: uniform(0), wilsonR: uniform(1),
      coreTemp: uniform(6000), bright: uniform(0), coreFade: uniform(1),
      roll: uniform(0), age: uniform(0),
      sunDir: uniform(new THREE.Vector3(0.4, 0.8, 0.3)),
      visibility: uniform(60000),
      hazeColor: uniform(new THREE.Color(0.3, 0.52, 0.88)),
    };

    this.buildVolume();
    this.buildShockShell();
    this.buildGroundOverlay();

    this.light = new THREE.PointLight(0xffe2b8, 0, 0, 2);
    this.group.add(this.light);
    this.group.visible = false;
  }

  // ---------- Repère local : x = est, y = haut, z = sud ----------

  setTarget(lat, lon) {
    this.lat = lat; this.lon = lon;
    const latR = THREE.MathUtils.degToRad(lat), lonR = THREE.MathUtils.degToRad(lon);
    this.groundH = this.globe.groundHeight(latR, lonR);
    const { east, north, up } = enu(latR, lonR);
    this.basis.e.set(...east);
    this.basis.u.set(...up);
    this.basis.s.set(-north[0], -north[1], -north[2]);
    this.origin.set(...geodeticToEcef(latR, lonR, this.groundH));
    this.frame.makeBasis(this.basis.e, this.basis.u, this.basis.s).setPosition(this.origin);
    for (const m of [this.volume, this.shell, this.overlay]) {
      m.matrix.copy(this.frame);
      m.matrixWorldNeedsUpdate = true;
    }
    this.rebuildOverlayHeights();
    this.group.visible = true;
  }

  toLocal(ecef, out = new THREE.Vector3()) {
    const d = ecef.clone().sub(this.origin);
    return out.set(d.dot(this.basis.e), d.dot(this.basis.u), d.dot(this.basis.s));
  }

  setEffects(effects) {
    this.effects = effects;
    const o = this.O;
    const r = effects.radii;
    o.rFb.value = r.fireballM; o.r20.value = r.blast20PsiM; o.r5.value = r.blast5PsiM;
    o.rTh.value = r.thermalM; o.r1.value = r.blast1PsiM;
    o.outer.value = Math.max(r.blast1PsiM, r.thermalM) * 1.15;
    if (this.lat !== undefined) this.rebuildOverlayHeights();
  }

  detonate() {
    this.detonated = true;
    this.t = 0;
    this.O.rings.value = 0;
    damage.active.value = 1;
  }

  reset() {
    this.detonated = false;
    this.t = 0;
    this.O.rings.value = 1;
    damage.active.value = 0;
    damage.time.value = 0;
    damage.shockR.value = 0;
    this.volume.visible = false;
    this.shell.visible = false;
    this.light.intensity = 0;
  }

  // ---------- Nuage volumétrique ----------

  buildVolume() {
    const U = this.U, tex = this.noise;
    const n3 = (q) => texture3D(tex, q).level(0);

    const field = Fn(([p]) => {
      const r = length(p.xz);
      const dy = p.y.sub(U.capC);

      // Anneau tourbillonnaire : advection poloïdale du bruit (monte au centre, retombe au bord)
      const pol = atan(dy, r.sub(U.capMajor));
      const az = atan(p.z, p.x);
      const k = U.capMinor.mul(0.28);
      const rr = r.add(k.mul(sin(pol.sub(U.roll))));
      const qCap = vec3(cos(az).mul(rr), p.y.add(k.mul(cos(pol.sub(U.roll)))), sin(az).mul(rr)).div(U.capMinor.mul(1.6));
      const nc = n3(qCap.mul(0.42).add(vec3(0.0, U.age.mul(-0.004), 0.0)));
      const nm = n3(qCap.mul(1.05).add(vec3(0.13, 0.57, 0.29)));
      const nd = n3(qCap.mul(2.6).add(vec3(0.31, 0.17, 0.0)));
      // « choux-fleurs » : lobes arrondis (1-|2n-1|) sur plusieurs échelles
      const lob = (n) => float(1.0).sub(abs(n.mul(2.0).sub(1.0)));
      const billow = nc.r.mul(0.5).add(lob(nm.b).mul(0.32)).add(nd.g.mul(0.18));

      const sphereD = length(vec3(p.x, dy, p.z)).sub(U.capMinor);
      const torusD = length(vec2(r.sub(U.capMajor), dy.mul(1.25))).sub(U.capMinor);
      const domeD = length(vec3(p.x, dy.sub(U.capMinor.mul(0.32)).mul(1.45), p.z)).sub(U.capMajor.mul(0.5).add(U.capMinor.mul(0.78)));
      const capRaw = mix(sphereD, min(torusD, domeD), U.toroid);
      const capD = capRaw.sub(billow.sub(0.45).mul(U.capMinor).mul(1.05));

      // Tige aspirée
      const yn = clamp(p.y.div(max(U.stemTop, 1.0)), 0.0, 1.0);
      const flare = float(1.0).add(exp(yn.mul(-6.0)).mul(1.8)).add(pow(yn, 6.0).mul(1.6));
      const qS = vec3(p.x, p.y.sub(U.age.mul(U.stemR).mul(0.35)), p.z).div(U.stemR.mul(3.0));
      const ns = n3(qS.mul(0.6).add(vec3(0.5, 0.0, 0.2))).r.mul(0.65).add(n3(vec3(qS.z, qS.y, qS.x).mul(1.4)).b.mul(0.35));
      const stemD = max(r.sub(U.stemR.mul(flare)), max(p.y.sub(U.stemTop), p.y.negate()))
        .sub(ns.sub(0.5).mul(U.stemR).mul(1.4));

      // Nuage de base (poussière) + piédestal
      const qG = p.div(U.surgeH.mul(2.2)).add(vec3(0.0, U.age.mul(-0.01), 0.7));
      const ng1 = n3(qG.mul(0.35));
      const ng2 = n3(vec3(qG.z, qG.x, qG.y).mul(0.9).add(0.37));
      const ng = ng1.r.mul(0.6).add(ng2.b.mul(0.4));
      const surgeD = length(vec2(r.sub(U.surgeR.mul(0.7)).div(U.surgeR.mul(0.34).add(1.0)), p.y.div(U.surgeH.mul(1.3).add(1.0)))).sub(1.0).mul(U.surgeH);
      const pedD = length(vec2(r.div(U.stemR.mul(4.0).add(U.surgeR.mul(0.22)).add(1.0)), p.y.div(U.surgeH.mul(1.5).add(1.0)))).sub(1.0).mul(U.surgeH);
      const groundD = min(surgeD, pedD).sub(ng.sub(0.5).mul(U.surgeH).mul(1.2));

      // Coquille de condensation de Wilson
      const wd = abs(length(vec3(p.x, p.y.sub(U.hob), p.z)).sub(U.wilsonR)).sub(U.wilsonR.mul(0.05))
        .sub(nd.b.sub(0.5).mul(U.wilsonR).mul(0.12));

      const capDen = smoothstep(U.capMinor.mul(0.04), U.capMinor.mul(-0.12), capD).mul(float(9.0).div(U.capMinor));
      const stemDen = smoothstep(U.stemR.mul(0.1), U.stemR.mul(-0.25), stemD).mul(float(2.6).div(U.stemR)).mul(U.stemVis);
      const surgeDen = smoothstep(U.surgeH.mul(0.3), U.surgeH.mul(-0.6), groundD).mul(float(0.55).div(U.surgeH)).mul(U.surgeDen);
      const wDen = smoothstep(U.wilsonR.mul(0.02), U.wilsonR.mul(-0.03), wd).mul(float(0.9).div(U.wilsonR.mul(0.1))).mul(U.wilson);
      const above = smoothstep(-2.0, 6.0, p.y);
      const total = capDen.add(stemDen).add(surgeDen).add(wDen).mul(above);

      // Chaleur : cœur profond + crevasses entre les lobes ; boule de feu entière au début
      const depth = clamp(capD.negate().div(U.capMinor.mul(0.55)), 0.0, 1.0);
      const crevice = clamp(float(1.3).sub(billow.mul(1.9)), 0.0, 1.0);
      const throat = exp(length(vec3(p.x, p.y.sub(U.capC.sub(U.capMinor.mul(0.6))).mul(1.8), p.z)).div(U.capMinor).pow(2.0).negate().mul(2.5));
      const capHeat = depth.mul(0.7).add(crevice.mul(crevice).mul(0.55)).add(throat.mul(0.6)).add(float(1.0).sub(U.toroid).mul(0.9));
      const heat = capHeat.mul(capDen.div(max(total, 1e-6)));
      const dust = stemDen.add(surgeDen).div(max(total, 1e-6));
      const wFrac = wDen.div(max(total, 1e-6));
      return vec4(total, heat, dust, wFrac);
    });

    // Corps noir approché (K → RGB linéaire normalisé)
    const blackbody = Fn(([T]) => {
      const c1 = vec3(1.0, 0.08, 0.0), c2 = vec3(1.0, 0.33, 0.04), c3 = vec3(1.0, 0.62, 0.28), c4 = vec3(1.0, 0.92, 0.84), c5 = vec3(0.85, 0.9, 1.0);
      const a = mix(c1, c2, smoothstep(900.0, 1700.0, T));
      const b = mix(a, c3, smoothstep(1700.0, 3000.0, T));
      const c = mix(b, c4, smoothstep(3000.0, 5500.0, T));
      return mix(c, c5, smoothstep(6500.0, 9000.0, T));
    });

    const hg = (c, g) => float(1.0 - g * g).div(pow(float(1.0 + g * g).sub(c.mul(2.0 * g)), 1.5).mul(4.0 * Math.PI));

    const march = Fn(() => {
      const ro = U.camLocal;
      const pExit = positionLocal.mul(U.extent);
      const rd = normalize(pExit.sub(ro));
      const Rb = U.extent.x, Hb = U.extent.y;

      // intersection rayon / cylindre englobant
      const a = dot(rd.xz, rd.xz);
      const b = dot(ro.xz, rd.xz).mul(2.0);
      const c = dot(ro.xz, ro.xz).sub(Rb.mul(Rb));
      const disc = b.mul(b).sub(a.mul(c).mul(4.0));
      If(disc.lessThan(0.0), () => { Discard(); });
      const sd = sqrt(max(disc, 0.0));
      const t0 = b.negate().sub(sd).div(a.mul(2.0).add(1e-9));
      const t1 = b.negate().add(sd).div(a.mul(2.0).add(1e-9));
      const ty0 = float(0.0).sub(ro.y).div(rd.y);
      const ty1 = Hb.sub(ro.y).div(rd.y);
      const tNear = max(max(min(t0, t1), min(ty0, ty1)), 0.0).toVar();
      const tFar = min(max(t0, t1), max(ty0, ty1)).toVar();
      // la scène opaque (relief, bâtiments) arrête le rayon
      const viewZ = logarithmicDepthToViewZ(this.sceneDepth.sample(screenUV).r, cameraNear, cameraFar);
      const tScene = viewZ.negate().div(max(dot(rd, U.camFwd), 1e-4));
      tFar.assign(min(tFar, tScene));
      If(tFar.lessThanEqual(tNear), () => { Discard(); });

      const span = tFar.sub(tNear);
      const ds = span.div(float(U.steps));
      // bruit à gradient entrelacé : décalage de départ structuré, lissé ensuite par le flou de composition
      const jitter = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189));
      const tc = tNear.add(ds.mul(jitter)).toVar();

      const sun = normalize(U.sunDir);
      const cosT = dot(rd, sun);
      const phase = mix(hg(cosT, -0.25), hg(cosT, 0.55), 0.65).mul(4.0 * Math.PI);
      const shadowStep = max(U.capMinor.mul(0.22), 15.0);

      const acc = vec3(0.0).toVar();
      const trans = float(1.0).toVar();
      const fbCenter = vec3(0.0, U.capC, 0.0);

      Loop({ start: 0, end: U.steps, type: 'int' }, () => {
        If(trans.lessThan(0.008), () => { Break(); });
        const p = ro.add(rd.mul(tc));
        const f = field(p);
        const sigma = f.x;
        If(sigma.greaterThan(1e-5), () => {
          // auto-ombrage : 2 échantillons vers le soleil
          const s1 = field(p.add(sun.mul(shadowStep))).x;
          const od = s1.mul(shadowStep).mul(1.6).toVar();
          If(U.shadow2.greaterThan(0.5), () => {
            const s2 = field(p.add(sun.mul(shadowStep.mul(3.0)))).x;
            od.assign(s1.mul(shadowStep).add(s2.mul(shadowStep.mul(2.0))));
          });
          const sunT = exp(od.negate()).add(exp(od.mul(-0.2)).mul(0.12));
          // occlusion ambiante : densité au-dessus de l'échantillon
          const ao = float(1.0).sub(sunT.oneMinus().mul(0.35)).toVar();
          If(U.aoOn.greaterThan(0.5), () => {
            const sUp = field(p.add(vec3(0.0, shadowStep.mul(2.0), 0.0))).x;
            ao.assign(exp(sUp.mul(shadowStep).mul(-1.6)).mul(0.75).add(0.25));
          });
          const powder = float(1.0).sub(exp(sigma.mul(ds).mul(-2.0)).mul(0.6));

          // albédo : NO₂ brun-rouge qui blanchit avec la condensation, poussière, vapeur blanche
          const capAlb = mix(vec3(0.27, 0.19, 0.14), vec3(0.62, 0.6, 0.6), smoothstep(30.0, 180.0, U.t));
          const dustAlb = vec3(0.34, 0.3, 0.26);
          const alb = mix(mix(capAlb, dustAlb, f.z), vec3(0.95, 0.96, 1.0), f.w);

          const hgt = clamp(p.y.div(max(U.capC.add(U.capMinor), 1.0)), 0.0, 1.0);
          const sky = mix(vec3(0.12, 0.13, 0.15), vec3(0.32, 0.42, 0.58), hgt).mul(ao);
          const sunCol = vec3(2.6, 2.4, 2.1);

          // la boule de feu éclaire la fumée de l'intérieur
          const toC = p.sub(fbCenter);
          const glowFall = float(1.0).div(float(1.0).add(dot(toC, toC).div(U.capMinor.mul(U.capMinor).mul(1.5))));
          const inner = vec3(1.0, 0.42, 0.12).mul(U.bright.mul(0.6).add(U.coreFade.mul(0.35))).mul(glowFall);

          // émission thermique
          const T = U.coreTemp.mul(float(0.45).add(f.y.mul(0.55)));
          const hot = smoothstep(0.15, 0.9, f.y);
          const emitI = U.bright.mul(pow(T.div(4200.0), 3.0)).add(U.coreFade.mul(3.2).mul(hot).mul(hot));
          const emit = blackbody(T).mul(emitI).mul(hot);

          const radiance = alb.mul(sunCol.mul(sunT).mul(phase).mul(powder).add(sky).add(inner)).add(emit);
          const stepT = exp(sigma.mul(ds).negate());
          acc.addAssign(radiance.mul(trans).mul(float(1.0).sub(stepT)));
          trans.mulAssign(stepT);
        });
        tc.addAssign(ds);
      });

      const alpha = float(1.0).sub(trans);
      If(alpha.lessThan(0.003), () => { Discard(); });
      // perspective aérienne ; sortie prémultipliée pour le flou et la composition
      const haze = float(1.0).sub(exp(tNear.add(span.mul(0.3)).div(U.visibility).negate())).mul(0.85);
      const col = acc.mul(float(1.0).sub(haze)).add(U.hazeColor.mul(haze).mul(alpha));
      return vec4(col, alpha);
    });

    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: false, depthWrite: false, depthTest: false, fog: false,
      side: THREE.BackSide, blending: THREE.NoBlending,
    });
    const out = march();
    mat.colorNode = out.rgb;
    mat.opacityNode = out.a;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 48, 1, false);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.volumeRoot.add(mesh);
    this.volume = mesh;
    this.volumeMat = mat;
  }

  // ---------- Onde de choc : coquille réfractive ----------

  buildShockShell() {
    this.S = { strength: uniform(0), white: uniform(0) };
    const S = this.S;
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const fres = pow(float(1.0).sub(abs(dot(normalView, positionViewDirection))), 2.5);
    const offset = normalView.xy.mul(fres).mul(S.strength);
    const bg = viewportSharedTexture(screenUV.add(offset)).rgb;
    mat.colorNode = bg.add(vec3(1.0, 0.97, 0.92).mul(fres).mul(S.white));
    mat.opacityNode = clamp(fres.mul(4.0), 0.0, 1.0);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), mat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.visible = false;
    this.group.add(mesh);
    this.shell = mesh;
  }

  // ---------- Voile au sol drapé sur le relief ----------

  buildGroundOverlay() {
    const RINGS = 90, SEG = 160;
    this.overlayDims = { RINGS, SEG };
    const count = (RINGS + 1) * (SEG + 1);
    const pos = new Float32Array(count * 3);
    const polar = new Float32Array(count * 2);
    const idx = [];
    for (let i = 0; i < RINGS; i++) for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j, b = a + 1, c = a + SEG + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('polar', new THREE.BufferAttribute(polar, 2));
    geo.setIndex(idx);

    const O = this.O = {
      rings: uniform(1), rFb: uniform(1), r20: uniform(1), r5: uniform(1), rTh: uniform(1), r1: uniform(1), outer: uniform(1),
      pulse: uniform(0),
    };
    const D = damage;
    const tex = this.noise;
    const shader = Fn(() => {
      const pr = attribute('polar', 'vec2');
      const r = pr.x;
      const xy = pr.y;
      const lw = max(r.mul(0.0), O.outer.mul(0.004)).add(4.0);
      const ring = (R) => float(1.0).sub(smoothstep(lw.mul(0.5), lw, abs(r.sub(R))));
      const col = vec3(0.0).toVar();
      const alpha = float(0.0).toVar();

      // anneaux d'effets avant la détonation
      If(O.rings.greaterThan(0.5), () => {
        const rings = [
          [O.r1, vec3(0.22, 0.91, 0.56)], [O.rTh, vec3(0.96, 0.65, 0.14)], [O.r5, vec3(1.0, 0.42, 0.09)],
          [O.r20, vec3(1.0, 0.16, 0.22)], [O.rFb, vec3(1.0, 1.0, 1.0)],
        ];
        for (const [R, c] of rings) {
          const k = ring(R);
          col.assign(mix(col, c.mul(1.6), k));
          alpha.assign(max(alpha, k.mul(0.95)));
          const inside = float(1.0).sub(smoothstep(R.mul(0.995), R, r)).mul(0.07);
          col.assign(mix(col, c, inside.mul(float(1.0).sub(alpha))));
          alpha.assign(max(alpha, inside));
        }
        const pulse = float(1.0).sub(smoothstep(0.0, lw.mul(2.0), abs(r.sub(O.pulse.mul(O.outer)))));
        col.assign(mix(col, vec3(1.0, 0.8, 0.5).mul(2.0), pulse.mul(0.6)));
        alpha.assign(max(alpha, pulse.mul(0.5)));
      });

      If(D.active.greaterThan(0.5), () => {
        const t = D.time;
        // brûlure thermique (fluence ∝ 1/r²), progressive pendant l'impulsion
        const fluence = clamp(O.rTh.div(max(r, 1.0)).pow(2.0).sub(0.35), 0.0, 1.0);
        const burn = fluence.mul(smoothstep(0.0, 1.2, t));
        const scorch = vec3(0.045, 0.035, 0.03);
        alpha.assign(burn.mul(0.82));
        col.assign(scorch);

        // sol incandescent sous la boule de feu
        const glowK = exp(r.div(O.rFb.mul(2.2)).pow(2.0).negate()).mul(D.glow);
        col.addAssign(vec3(3.0, 1.2, 0.35).mul(glowK));
        alpha.assign(max(alpha, clamp(glowK, 0.0, 1.0)));

        // incendies : taches vacillantes dans la zone thermique
        const ang = xy.mul(Math.PI * 2);
        const gx = cos(ang).mul(r), gz = sin(ang).mul(r);
        const n = texture3D(tex, vec3(gx.div(900.0), gz.div(900.0), t.mul(0.004))).level(0);
        const n2 = texture3D(tex, vec3(gz.div(260.0), gx.div(260.0), t.mul(0.011).add(0.5))).level(0);
        const fireZone = smoothstep(O.rTh.mul(1.05), O.rTh.mul(0.5), r).mul(smoothstep(O.rFb.mul(0.8), O.rFb.mul(1.6), r));
        const fires = smoothstep(0.62, 0.8, n.r.mul(0.6).add(n2.g.mul(0.4))).mul(fireZone).mul(smoothstep(1.5, 6.0, t));
        const flick = float(0.75).add(sin(t.mul(9.0).add(n2.b.mul(40.0))).mul(0.25));
        col.addAssign(vec3(4.0, 1.25, 0.3).mul(fires).mul(flick));
        alpha.assign(max(alpha, fires.mul(0.9)));

        // front de poussière qui suit l'onde de choc
        const behind = D.shockR.sub(r);
        const front = smoothstep(0.0, D.shockR.mul(0.01).add(10.0), behind).mul(exp(behind.div(D.shockR.mul(0.18).add(30.0)).negate()));
        const dustZone = smoothstep(O.r1.mul(1.3), O.r5, r);
        const dustA = front.mul(dustZone).mul(0.6);
        col.assign(mix(col, vec3(0.5, 0.44, 0.37), dustA));
        alpha.assign(max(alpha, dustA));
      });

      If(alpha.lessThan(0.004), () => { Discard(); });
      return vec4(col, alpha);
    });
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const out = shader();
    mat.colorNode = out.rgb;
    mat.opacityNode = out.a;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.overlay = mesh;
  }

  // drape la grille polaire sur le relief chargé (en mètres, repère local)
  rebuildOverlayHeights() {
    if (!this.effects || this.lat === undefined) return;
    const { RINGS, SEG } = this.overlayDims;
    const outer = this.O.outer.value;
    const pos = this.overlay.geometry.attributes.position.array;
    const polar = this.overlay.geometry.attributes.polar.array;
    const P = new THREE.Vector3();
    for (let i = 0; i <= RINGS; i++) {
      const r = outer * Math.pow(i / RINGS, 1.6);
      for (let j = 0; j <= SEG; j++) {
        const a = (j / SEG) * Math.PI * 2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        P.copy(this.origin).addScaledVector(this.basis.e, x).addScaledVector(this.basis.s, z);
        const g = ecefToGeodetic(P.x, P.y, P.z);
        const h = this.globe.groundHeight(g.lat, g.lon) + 3 + r * 0.0015;
        const E = new THREE.Vector3(...geodeticToEcef(g.lat, g.lon, h));
        const L = this.toLocal(E);
        const k = i * (SEG + 1) + j;
        pos[k * 3] = L.x; pos[k * 3 + 1] = L.y; pos[k * 3 + 2] = L.z;
        polar[k * 2] = r; polar[k * 2 + 1] = j / SEG;
      }
    }
    this.overlay.geometry.attributes.position.needsUpdate = true;
    this.overlay.geometry.attributes.polar.needsUpdate = true;
    this.overlay.geometry.computeBoundingSphere();
  }

  // ---------- Mise à jour par frame ----------

  update(t, camPos, camFwd, sunWorld, fog) {
    if (this.lat === undefined) return null;
    this.t = t;
    // re-drape périodique tant que les tuiles arrivent
    this.drapeTimer = (this.drapeTimer || 0) + 1;
    if (this.drapeTimer % 45 === 0) {
      const latR = THREE.MathUtils.degToRad(this.lat), lonR = THREE.MathUtils.degToRad(this.lon);
      const gh = this.globe.groundHeight(latR, lonR);
      if (Math.abs(gh - this.groundH) > 2) this.setTarget(this.lat, this.lon);
      else this.rebuildOverlayHeights();
    }
    if (!this.detonated) {
      this.O.pulse.value = (performance.now() / 2600) % 1;
      damage.gz.value.copy(this.origin).sub(camPos);
      return null;
    }

    const e = this.effects;
    const s = this.state = explosionTimeline(e, t);
    const U = this.U;
    U.t.value = t; U.age.value = t; U.hob.value = s.hob;
    U.capC.value = s.capC; U.capMajor.value = s.capMajor; U.capMinor.value = s.capMinor; U.toroid.value = s.toroid;
    U.stemTop.value = s.stemTop; U.stemR.value = s.stemR; U.stemVis.value = s.stemTop > 5 ? 1 : 0;
    U.surgeR.value = Math.max(1, s.surgeR); U.surgeH.value = Math.max(1, s.surgeH); U.surgeDen.value = s.surgeDensity;
    U.wilson.value = s.wilson; U.wilsonR.value = Math.max(1, s.wilsonR);
    U.coreTemp.value = s.coreTemp; U.bright.value = s.brightness; U.coreFade.value = s.coreFade;
    U.roll.value = t / (0.35 * s.tau + 2);

    // volume englobant
    const Rb = s.radiusBound, Hb = s.heightBound;
    U.extent.value.set(Rb, Hb, Rb);
    this.volume.matrix.copy(this.frame).multiply(new THREE.Matrix4().makeScale(Rb, Hb, Rb));
    this.volume.matrixWorldNeedsUpdate = true;
    U.camLocal.value.copy(this.toLocal(camPos));
    U.camFwd.value.set(camFwd.dot(this.basis.e), camFwd.dot(this.basis.u), camFwd.dot(this.basis.s));
    this.volumeRoot.position.copy(camPos).negate();
    this.volume.visible = true;

    // soleil dans le repère local
    U.sunDir.value.set(sunWorld.dot(this.basis.e), sunWorld.dot(this.basis.u), sunWorld.dot(this.basis.s)).normalize();
    if (fog) {
      U.visibility.value = Math.max(8000, fog.far * 0.6);
      U.hazeColor.value.copy(fog.color);
    } else U.visibility.value = 4e5;

    // coquille de choc (centrée sur le point d'éclatement)
    const shockR = s.shockRadiusM;
    const shellLife = Math.max(0, 1 - shockR / (e.radii.blast1PsiM * 2.2));
    this.shell.visible = this.refraction !== false && shellLife > 0.01 && t > 0.05;
    this.shell.matrix.copy(this.frame).multiply(new THREE.Matrix4().makeTranslation(0, s.hob, 0)).multiply(new THREE.Matrix4().makeScale(shockR, shockR, shockR));
    this.shell.matrixWorldNeedsUpdate = true;
    this.S.strength.value = 0.018 * shellLife;
    this.S.white.value = 0.03 * shellLife + s.wilson * 0.06;

    // lumière du flash
    const fbPos = new THREE.Vector3().copy(this.origin).addScaledVector(this.basis.u, s.capC);
    this.light.position.copy(fbPos);
    const flashLum = Math.max(0, s.brightness - 1.5 * s.coreFade) + 0.12 * s.coreFade;
    this.light.intensity = flashLum * 2.2e6 * Math.pow(e.yieldKt / 15, 0.5);
    this.light.distance = Math.max(e.radii.thermalM, e.radii.blast1PsiM) * 2.5;
    this.light.color.setRGB(1, 0.75 + 0.2 * Math.min(1, s.coreTemp / 6000), 0.5 + 0.45 * Math.min(1, s.coreTemp / 7000));

    // uniformes partagés (bâtiments, sol)
    damage.time.value = t;
    damage.shockR.value = shockR;
    damage.gz.value.copy(this.origin).sub(camPos);
    damage.up.value.copy(this.basis.u);
    damage.rFireball.value = e.radii.fireballM;
    damage.r20.value = e.radii.blast20PsiM;
    damage.r5.value = e.radii.blast5PsiM;
    damage.r1.value = e.radii.blast1PsiM;
    damage.rThermal.value = e.radii.thermalM;
    damage.glow.value = Math.min(4, Math.max(0, s.brightness - 1.5 * s.coreFade) * 0.5);

    return s;
  }
}

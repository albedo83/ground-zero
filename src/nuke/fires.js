// Incendies au sol après la détonation : particules GPU instanciées, animées entièrement dans le shader.
//  - colonnes de fumée (noire à la base, éclairée par les flammes, poussée par le vent d'altitude) ;
//  - flammes au pied des colonnes (HDR, additives, alimentent le bloom) ;
//  - braises qui s'envolent.
// Les foyers sont répartis dans la zone thermique, posés sur le relief, et s'allument progressivement.

import * as THREE from 'three/webgpu';
import {
  uniform, attribute, uv, vec2, vec3, float, fract, sin, cos, pow, mix, smoothstep, length, exp, clamp,
  texture3D, positionLocal, step, max,
} from 'three/tsl';
import { geodeticToEcef, ecefToGeodetic } from '../geo.js';

const MAX_PLUMES = 360;
const LAYERS = {
  smoke: { perPlume: 16, blending: THREE.NormalBlending },
  flame: { perPlume: 6, blending: THREE.AdditiveBlending },
  ember: { perPlume: 6, blending: THREE.AdditiveBlending },
};

export class Fires {
  constructor(explosion) {
    this.ex = explosion;
    this.plumes = 0;
    this.density = 250;
    this.U = {
      anim: uniform(0),          // temps réel (s) : l'animation ne s'emballe pas en accéléré
      simT: uniform(0),          // temps simulé : allumage progressif des foyers
      fireI: uniform(0),         // intensité globale de l'incendie
      plumeH: uniform(400),      // hauteur atteinte par la fumée (m)
      wind: uniform(new THREE.Vector2(0.94, -0.34)),
      camR: uniform(new THREE.Vector3(1, 0, 0)),
      camU: uniform(new THREE.Vector3(0, 1, 0)),
    };
    this.meshes = {};
    for (const [kind, cfg] of Object.entries(LAYERS)) this.meshes[kind] = this.buildLayer(kind, cfg);
  }

  buildLayer(kind, cfg) {
    const n = MAX_PLUMES * cfg.perPlume;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    geo.setAttribute('iOrigin', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('iData', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
    geo.instanceCount = 0;

    const U = this.U, tex = this.ex.noise;
    const origin = attribute('iOrigin', 'vec3');
    const data = attribute('iData', 'vec4'); // x graine, y échelle, z période, w délai d'allumage
    const seed = data.x, scale = data.y, period = data.z, delay = data.w;
    const lit = smoothstep(delay, delay.add(4.0), U.simT).mul(U.fireI);
    const age = fract(U.anim.div(period).add(seed.mul(7.31)));

    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: cfg.blending, side: THREE.DoubleSide });
    const corner = positionLocal.xy;

    if (kind === 'smoke') {
      const H = U.plumeH.mul(scale);
      const rise = pow(age, 0.8).mul(H);
      const drift = U.wind.mul(pow(age, 1.3).mul(H).mul(0.9));
      const wob = sin(U.anim.mul(0.6).add(seed.mul(40.0))).mul(H).mul(0.05).mul(age);
      const center = origin.add(vec3(drift.x.add(wob), rise, drift.y));
      const size = mix(0.16, 0.75, pow(age, 0.7)).mul(H).mul(fract(seed.mul(13.7)).mul(0.5).add(0.75)).mul(lit.greaterThan(0.01).select(1.0, 0.0));
      mat.positionNode = center.add(U.camR.mul(corner.x.mul(size))).add(U.camU.mul(corner.y.mul(size)));
      const p = uv().sub(0.5).mul(2.0);
      const n = texture3D(tex, vec3(uv().mul(0.9).add(seed), age.mul(0.5).add(seed.mul(3.0)))).r;
      const shape = float(1.0).sub(smoothstep(0.15, 1.0, length(p).add(n.sub(0.5).mul(0.7))));
      const life = smoothstep(0.0, 0.08, age).mul(float(1.0).sub(smoothstep(0.6, 1.0, age)));
      // fumée noire à la base, plus grise en hauteur ; sous-face éclairée en orange par les flammes
      const smoke = mix(vec3(0.025, 0.022, 0.02), vec3(0.13, 0.12, 0.115), clamp(age.mul(1.1), 0.0, 1.0));
      const glow = vec3(1.9, 0.62, 0.15).mul(exp(age.mul(-22.0))).mul(lit);
      mat.colorNode = smoke.add(glow);
      mat.opacityNode = shape.mul(life).mul(0.42).mul(lit);
    } else if (kind === 'flame') {
      const H = float(30.0).mul(scale).mul(U.fireI.mul(0.6).add(0.4));
      const center = origin.add(vec3(sin(seed.mul(91.0)).mul(H).mul(0.6), age.mul(H), cos(seed.mul(57.0)).mul(H).mul(0.6)));
      const size = mix(1.0, 0.25, age).mul(H).mul(lit.greaterThan(0.01).select(1.0, 0.0));
      mat.positionNode = center.add(U.camR.mul(corner.x.mul(size))).add(U.camU.mul(corner.y.mul(size)));
      const p = uv().sub(0.5).mul(2.0);
      const n = texture3D(tex, vec3(uv().mul(1.6).add(seed), U.anim.mul(0.8).add(seed))).g;
      const shape = float(1.0).sub(smoothstep(0.2, 1.0, length(vec2(p.x.mul(1.4), p.y)).add(n.sub(0.5).mul(0.9))));
      const flick = sin(U.anim.mul(17.0).add(seed.mul(60.0))).mul(0.25).add(0.75);
      mat.colorNode = mix(vec3(5.0, 2.4, 0.6), vec3(3.0, 0.7, 0.12), age).mul(flick);
      mat.opacityNode = shape.mul(float(1.0).sub(age)).mul(lit).mul(0.8);
    } else {
      const H = float(160.0).mul(scale);
      const rise = age.mul(H);
      const center = origin.add(vec3(
        U.wind.x.mul(rise).mul(0.7).add(sin(seed.mul(77.0).add(U.anim)).mul(12.0)),
        rise,
        U.wind.y.mul(rise).mul(0.7).add(cos(seed.mul(33.0).add(U.anim)).mul(12.0)),
      ));
      const size = float(3.5).mul(float(1.0).sub(age.mul(0.6))).mul(lit.greaterThan(0.01).select(1.0, 0.0));
      mat.positionNode = center.add(U.camR.mul(corner.x.mul(size))).add(U.camU.mul(corner.y.mul(size)));
      const d = length(uv().sub(0.5).mul(2.0));
      mat.colorNode = vec3(6.0, 2.2, 0.4).mul(float(1.0).sub(age.mul(0.7)));
      mat.opacityNode = float(1.0).sub(smoothstep(0.0, 1.0, d)).mul(float(1.0).sub(age)).mul(lit);
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = kind === 'smoke' ? 4 : 5;
    this.ex.group.add(mesh);
    mesh.userData.perPlume = cfg.perPlume;
    return mesh;
  }

  setDensity(n) { this.density = Math.min(MAX_PLUMES, n); }

  // répartit les foyers dans la zone thermique (plus serrés vers le centre), sur la terre ferme
  place() {
    const ex = this.ex, e = ex.effects;
    if (!e) return;
    const rIn = e.radii.fireballM * 1.2, rOut = Math.max(rIn * 1.5, e.radii.thermalM * 1.05);
    const P = this.density;
    this.sites = [];
    for (let i = 0, tries = 0; i < P && tries < P * 6; tries++) {
      const r = rIn + (rOut - rIn) * Math.pow(Math.random(), 1.5);
      const a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const site = { x, z, r, h: 0 };
      if (!this.ground(site)) continue; // eau : pas de feu
      site.delay = 1.5 + Math.random() * 10 + (r / rOut) * 10;
      site.scale = (0.6 + Math.random() * 0.9) * (1.25 - 0.5 * (r / rOut));
      this.sites.push(site);
      i++;
    }
    this.plumes = this.sites.length;
    this.writeAttributes();
  }

  // hauteur du sol au foyer (repère local de l'explosion) ; faux si c'est de l'eau
  ground(site) {
    const ex = this.ex, b = ex.basis;
    const P = ex.origin.clone().addScaledVector(b.e, site.x).addScaledVector(b.s, site.z);
    const g = ecefToGeodetic(P.x, P.y, P.z);
    const gh = ex.globe.groundHeight(g.lat, g.lon);
    if (gh <= 0.3) return false;
    const E = new THREE.Vector3(...geodeticToEcef(g.lat, g.lon, gh + 2));
    site.h = ex.toLocal(E).y;
    return true;
  }

  writeAttributes() {
    for (const mesh of Object.values(this.meshes)) {
      const k = mesh.userData.perPlume;
      const o = mesh.geometry.attributes.iOrigin, d = mesh.geometry.attributes.iData;
      let i = 0;
      for (const s of this.sites) {
        for (let j = 0; j < k; j++, i++) {
          o.setXYZ(i, s.x, s.h, s.z);
          const period = mesh === this.meshes.smoke ? 14 + Math.random() * 10
            : mesh === this.meshes.flame ? 0.9 + Math.random() * 0.8 : 4 + Math.random() * 3;
          d.setXYZW(i, j / k + Math.random() * 0.08, s.scale, period, s.delay);
        }
      }
      o.needsUpdate = true;
      d.needsUpdate = true;
      mesh.geometry.instanceCount = i;
    }
  }

  // re-pose les foyers sur le relief tant que les tuiles fines arrivent
  refreshHeights() {
    if (!this.sites?.length) return;
    for (const s of this.sites) this.ground(s);
    this.writeAttributes();
  }

  reset() {
    for (const m of Object.values(this.meshes)) { m.visible = false; m.geometry.instanceCount = 0; }
    this.sites = [];
    this.plumes = 0;
  }

  update(simT, realT, cameraMatrixWorld, effects) {
    const U = this.U;
    U.anim.value = realT % 10000;
    U.simT.value = simT;
    // allumage puis embrasement (tempête de feu) sur une dizaine de minutes
    U.fireI.value = smooth(2, 25, simT) * (0.65 + 0.35 * smooth(60, 600, simT));
    U.plumeH.value = 520 * Math.pow(Math.max(1, effects.yieldKt) / 15, 0.22);
    // axes de la caméra exprimés dans le repère local (billboards)
    const b = this.ex.basis;
    const m = cameraMatrixWorld.elements;
    const R = new THREE.Vector3(m[0], m[1], m[2]), Up = new THREE.Vector3(m[4], m[5], m[6]);
    U.camR.value.set(R.dot(b.e), R.dot(b.u), R.dot(b.s));
    U.camU.value.set(Up.dot(b.e), Up.dot(b.u), Up.dot(b.s));
    for (const mesh of Object.values(this.meshes)) {
      mesh.matrix.copy(this.ex.frame);
      mesh.matrixWorldNeedsUpdate = true;
      mesh.visible = this.plumes > 0 && U.fireI.value > 0.001;
    }
  }
}

function smooth(a, b, x) {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

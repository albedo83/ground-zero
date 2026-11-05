// Retombées radioactives (ordre de grandeur pédagogique, modèle WSEG-10 simplifié) :
//  - panache au sol : contours de débit de dose drapés sur le relief, le long d'un axe courbé par le
//    cisaillement du vent, qui progressent avec le front de dépôt ;
//  - rideaux de débris qui tombent du nuage et dérivent : gros grains près du point zéro, fines plus loin.
// Le panache n'existe qu'en explosion au sol (ou très faible puissance) : une explosion en altitude
// n'aspire presque pas de terre, donc presque pas de retombées locales.

import * as THREE from 'three/webgpu';
import {
  Fn, uniform, attribute, uv, vec3, float, fract, sin, cos, pow, mix, smoothstep, length, abs, max, clamp,
  texture3D, positionLocal,
} from 'three/tsl';
import { geodeticToEcef, ecefToGeodetic } from '../geo.js';

const NU = 110, NV = 36;
const MAX_FLAKES = 1400;

export class Fallout {
  constructor(explosion) {
    this.ex = explosion;
    this.enabled = true;
    this.density = 900;
    this.U = {
      front: uniform(0), show: uniform(0), fall: uniform(0),
      k0: uniform(new THREE.Vector2(1, 1)), k1: uniform(new THREE.Vector2(1, 1)), k2: uniform(new THREE.Vector2(1, 1)),
      anim: uniform(0),
      emit: uniform(new THREE.Vector3()), capR: uniform(1), travel: uniform(new THREE.Vector2()),
      camR: uniform(new THREE.Vector3(1, 0, 0)), camU: uniform(new THREE.Vector3(0, 1, 0)),
    };
    this.buildPlume();
    this.buildFlakes();
  }

  buildPlume() {
    const count = (NU + 1) * (NV + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('fc', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    const idx = [];
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
      const a = i * (NV + 1) + j, b = a + 1, c = a + NV + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);

    const U = this.U, tex = this.ex.noise;
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const fc = attribute('fc', 'vec2');
    const s = fc.x, lat = abs(fc.y);
    // irrégularités : le dépôt n'est jamais lisse (taches chaudes liées aux averses et aux reliefs)
    const scale = U.k2.x.mul(0.22);
    const n = texture3D(tex, vec3(s.div(scale), fc.y.div(scale), 0.37)).level(0).r.sub(0.5);
    const level = Fn(([k]) => {
      const u = clamp(s.add(k.x.mul(0.05)).div(k.x.mul(1.05)), 0.0, 1.0);
      const w = pow(u.add(0.015), 0.38).mul(pow(float(1.0).sub(u), 0.5)).mul(1.65).mul(k.y);
      return float(1.0).sub(lat.div(max(w, 1.0))).add(n.mul(0.28));
    });
    const v0 = level(U.k0), v1 = level(U.k1), v2 = level(U.k2);
    const in0 = smoothstep(0.0, 0.05, v0), in1 = smoothstep(0.0, 0.05, v1), in2 = smoothstep(0.0, 0.05, v2);
    const col = mix(mix(vec3(1.0, 0.84, 0.16), vec3(1.0, 0.45, 0.06), in1), vec3(0.95, 0.09, 0.03), in0);
    const front = float(1.0).sub(smoothstep(U.front.mul(0.92), U.front, s));
    mat.colorNode = col;
    mat.opacityNode = in2.mul(in1.mul(0.1).add(in0.mul(0.12)).add(0.2)).mul(front).mul(U.show);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = false;
    this.ex.group.add(mesh);
    this.plume = mesh;
  }

  buildFlakes() {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    const data = new Float32Array(MAX_FLAKES * 4);
    for (let i = 0; i < MAX_FLAKES; i++) {
      data.set([Math.random(), Math.random() * Math.PI * 2, Math.sqrt(Math.random()), 0.5 + Math.random()], i * 4);
    }
    geo.setAttribute('iData', new THREE.InstancedBufferAttribute(data, 4));
    geo.instanceCount = 0;

    const U = this.U;
    const d = attribute('iData', 'vec4'); // graine, angle, rayon, vitesse relative de chute
    const age = fract(U.anim.mul(d.w).mul(0.07).add(d.x.mul(17.3)));
    const r = d.z.mul(U.capR);
    const pos = vec3(
      U.emit.x.add(cos(d.y).mul(r)).add(U.travel.x.mul(age).div(d.w)),
      U.emit.y.mul(float(1.0).sub(age)),
      U.emit.z.add(sin(d.y).mul(r)).add(U.travel.y.mul(age).div(d.w)),
    );
    const size = mix(0.13, 0.26, age).mul(U.emit.y).add(60.0); // larges et très transparentes : un rideau, pas des taches
    const c = positionLocal.xy;
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    mat.positionNode = pos.add(U.camR.mul(c.x.mul(size))).add(U.camU.mul(c.y.mul(size)));
    const puff = float(1.0).sub(smoothstep(0.0, 1.0, length(uv().sub(0.5).mul(2.0))));
    mat.colorNode = vec3(0.17, 0.145, 0.12);
    mat.opacityNode = puff.mul(puff).mul(sin(age.mul(Math.PI))).mul(0.075).mul(U.fall);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.visible = false;
    this.ex.group.add(mesh);
    this.flakes = mesh;
  }

  setDensity(n) { this.density = Math.min(MAX_FLAKES, n); }

  start() {
    const e = this.ex.effects, f = e.fallout;
    this.active = f.active;
    this.axis = (f.windAngleDeg * Math.PI) / 180;
    this.bend = f.bend;
    const [c0, c1, c2] = f.contours;
    this.U.k0.value.set(c0.downwindM, c0.widthM);
    this.U.k1.value.set(c1.downwindM, c1.widthM);
    this.U.k2.value.set(c2.downwindM, c2.widthM);
    this.flakes.geometry.instanceCount = this.density;
    this.lastDrape = 0;
    if (this.active) this.drape();
  }

  // coordonnées locales d'un point du panache (distance s le long de l'axe, écart l sur le côté)
  point(s, l) {
    const L = this.ex.effects.fallout.lengthM;
    const off = this.bend * (s * s) / Math.max(L, 1);    // l'axe s'incurve avec la distance
    const ca = Math.cos(this.axis), sa = Math.sin(this.axis);
    return { x: s * ca + (l + off) * sa, z: -s * sa + (l + off) * ca };
  }

  // drape le panache sur le relief disponible (repère local de l'explosion)
  drape() {
    const ex = this.ex, b = ex.basis, f = ex.effects.fallout;
    const L = f.lengthM, W = f.contours[2].widthM * 1.25;
    const pos = this.plume.geometry.attributes.position, fc = this.plume.geometry.attributes.fc;
    const P = new THREE.Vector3(), E = new THREE.Vector3();
    for (let i = 0; i <= NU; i++) {
      const s = -0.06 * L + 1.08 * L * (i / NU);
      for (let j = 0; j <= NV; j++) {
        const l = W * (2 * (j / NV) - 1);
        const q = this.point(s, l);
        P.copy(ex.origin).addScaledVector(b.e, q.x).addScaledVector(b.s, q.z);
        const g = ecefToGeodetic(P.x, P.y, P.z);
        const h = ex.globe.groundHeight(g.lat, g.lon) + 4 + Math.abs(s) * 0.002;
        const L2 = ex.toLocal(E.set(...geodeticToEcef(g.lat, g.lon, h)));
        const k = i * (NV + 1) + j;
        pos.setXYZ(k, L2.x, L2.y, L2.z);
        fc.setXY(k, s, l);
      }
    }
    pos.needsUpdate = true;
    fc.needsUpdate = true;
  }

  reset() {
    this.active = false;
    this.plume.visible = false;
    this.flakes.visible = false;
    this.U.front.value = 0;
  }

  update(s, realT, cameraMatrixWorld) {
    const U = this.U, b = this.ex.basis, e = this.ex.effects;
    U.anim.value = realT % 10000;
    U.front.value = s.falloutFront;
    U.show.value = this.enabled ? smoothstep01(0, 30, s.t) : 0;

    // re-drape toutes les 3 s tant que des tuiles plus fines arrivent
    if (this.active && realT - this.lastDrape > 3) { this.lastDrape = realT; this.drape(); }
    this.plume.matrix.copy(this.ex.frame);
    this.plume.matrixWorldNeedsUpdate = true;
    this.plume.visible = this.active && this.enabled && s.falloutFront > 1;

    // rideaux de débris sous le nuage (très faibles en altitude : peu de terre aspirée)
    const strength = e.burstMode === 'surface' ? 1 : 0.22;
    U.fall.value = this.enabled ? s.fallRate * strength : 0;
    U.emit.value.set(s.driftX, Math.max(100, s.capC - s.capMinor * 0.4), s.driftZ);
    U.capR.value = s.capMajor + s.capMinor * 0.4;
    const fallTime = U.emit.value.y / 45;
    const m = e.fallout.meanSpeed, a = this.axis;
    U.travel.value.set(m * Math.cos(a) * fallTime, -m * Math.sin(a) * fallTime);
    const em = cameraMatrixWorld.elements;
    const R = new THREE.Vector3(em[0], em[1], em[2]), Up = new THREE.Vector3(em[4], em[5], em[6]);
    U.camR.value.set(R.dot(b.e), R.dot(b.u), R.dot(b.s));
    U.camU.value.set(Up.dot(b.e), Up.dot(b.u), Up.dot(b.s));
    this.flakes.matrix.copy(this.ex.frame);
    this.flakes.matrixWorldNeedsUpdate = true;
    this.flakes.visible = U.fall.value > 0.01;
  }
}

function smoothstep01(a, b, x) {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

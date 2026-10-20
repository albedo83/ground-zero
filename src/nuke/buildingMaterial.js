// Matériau des bâtiments réactif à l'explosion :
//  - au passage du front de choc, effondrement selon la surpression (20 psi → rasé, 5 psi → partiel),
//    avec bascule dans le sens du souffle ;
//  - vaporisation dans la boule de feu ;
//  - carbonisation dans la zone thermique puis incendies vacillants.

import * as THREE from 'three/webgpu';
import {
  attribute, positionLocal, modelWorldMatrix, vec3, vec4, float, dot, length, normalize, clamp, smoothstep,
  max, mix, sin, fract, Fn, varying, normalWorld, abs,
} from 'three/tsl';
import { damage as D } from './damage.js';

export function createBuildingMaterial() {
  const mat = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  const hb = attribute('hbase', 'float');
  const seed = attribute('seed', 'float');
  const rnd = fract(sin(seed.mul(91.7).add(3.1)).mul(43758.5453));

  // distance horizontale au point zéro (espace rendu)
  const world = modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz;
  const v = world.sub(D.gz);
  const hgt = dot(v, D.up);
  const hv = v.sub(D.up.mul(hgt));
  const d = length(hv);

  const arrival = clamp(D.shockR.sub(d).div(max(d.mul(0.04), 25.0)), 0.0, 1.0).mul(D.active);
  const severity = float(1.0).sub(smoothstep(D.r20.mul(0.85), D.r5.mul(1.3), d));
  const vapor = float(1.0).sub(smoothstep(D.rFireball.mul(0.9), D.rFireball.mul(1.5), d)).mul(D.active)
    .mul(smoothstep(0.0, 0.3, D.time));
  const collapse = max(arrival.mul(severity).mul(rnd.mul(0.35).add(0.62)), vapor);
  const away = normalize(hv.add(vec3(1e-3)));

  mat.positionNode = Fn(() => {
    const drop = D.up.mul(hb.mul(collapse).mul(0.93));
    const lean = away.mul(hb.mul(arrival).mul(severity).mul(0.35));
    return positionLocal.sub(drop).add(lean);
  })();

  // fluence thermique : carbonisation selon la distance
  const vD = varying(d, 'vGzDist');
  const vRnd = varying(rnd, 'vRnd');
  const fluence = clamp(D.rThermal.div(max(vD, 1.0)).pow(2.0).sub(0.4), 0.0, 1.0).mul(D.active)
    .mul(smoothstep(0.0, 1.0, D.time));
  const base = attribute('color', 'vec3');
  mat.colorNode = mix(base, vec3(0.05, 0.042, 0.036), fluence.mul(0.9));

  // flammes aux étages bas, fenêtres qui scintillent (motif pseudo-aléatoire en espace monde)
  const vHb = varying(hb, 'vHb');
  const vW = varying(v, 'vRel'); // relatif au point zéro : stable quand la caméra bouge
  const cell = fract(sin(dot(vW.floor().mul(vec3(0.31, 0.17, 0.23)), vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  const lowFloors = float(1.0).sub(smoothstep(4.0, 22.0, vHb));
  const fireOn = smoothstep(0.8, 0.88, vRnd).mul(smoothstep(1.5, 8.0, D.time)).mul(fluence)
    .mul(lowFloors).mul(smoothstep(0.35, 0.75, cell))
    // seulement les façades encore debout (pas les toits ni les gravats à plat)
    .mul(float(1.0).sub(smoothstep(0.3, 0.6, abs(dot(normalWorld, D.up)))))
    .mul(float(1.0).sub(varying(collapse, 'vCollapse').mul(0.9)));
  const flick = float(0.6).add(sin(D.time.mul(11.0).add(vRnd.mul(60.0)).add(cell.mul(25.0))).mul(0.4));
  const flash = D.glow.mul(D.glow).mul(0.05).mul(clamp(D.rThermal.div(max(vD, 1.0)), 0.0, 3.0));
  mat.emissiveNode = vec3(2.4, 0.7, 0.14).mul(fireOn).mul(flick).add(vec3(1.0, 0.85, 0.6).mul(flash));
  return mat;
}

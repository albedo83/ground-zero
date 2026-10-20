// Uniformes partagés entre l'explosion et les matériaux du monde (bâtiments).
// Toutes les positions sont en espace « rendu » (relatif à la caméra), donc précises en float32.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export const damage = {
  active: uniform(0),                     // 0 = rien, 1 = explosion en cours
  gz: uniform(new THREE.Vector3()),       // point zéro au sol (espace rendu)
  up: uniform(new THREE.Vector3(0, 1, 0)),
  time: uniform(0),                        // secondes depuis la détonation
  shockR: uniform(0),
  rFireball: uniform(0),
  r20: uniform(0),
  r5: uniform(0),
  r1: uniform(0),
  rThermal: uniform(0),
  glow: uniform(0),                        // luminance de la boule de feu
};

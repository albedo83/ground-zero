# GROUND//ZERO — Globe WebGPU

**En ligne : https://airfall.dev/ground-zero/**

Simulateur de détonation nucléaire **à l'échelle réelle** sur un globe façon Google Earth :
relief, imagerie satellite, routes et bâtiments OpenStreetMap, explosion volumétrique cinématographique.
Three.js `WebGPURenderer` (repli WebGL 2 automatique). HUD repris de `../ground-zero`.

```bash
npm install
npm run dev        # http://127.0.0.1:5180
npm run build      # site statique dans dist/
```

Raccourcis : `Espace` détoner · `1-4` vues (globe, cinéma, tactique, témoin) · `R` réinitialiser · clic sur le sol = nouvelle cible.

## L'explosion

| Élément | Technique |
|---|---|
| Boule de feu → champignon | Volume raymarché (TSL, 64 pas) : sphère → anneau tourbillonnaire, tige, nuage de base, coquille de Wilson ; bruit Perlin-Worley 3D ; corps noir ; auto-ombrage + occlusion ; Henyey-Greenstein ; brume aérienne |
| Chronologie | `src/nuke/physics.js` (Glasstone & Dolan) : rayon de boule de feu, montée flottante, sommet du nuage, front de choc Sedov → Mach 1 |
| Onde de choc | Coquille qui réfracte l'image (`viewportSharedTexture`), front de poussière au sol |
| Ville | Bâtiments rasés/inclinés au passage du front selon la surpression, vaporisés dans la boule de feu, carbonisés, incendies aux étages bas |
| Caméra | Flash qui sature, iris automatique, bloom HDR, grain/vignette, tremblement à l'arrivée du souffle, bandes cinéma |
| Son | Flash immédiat, boom retardé par la distance réelle (≈ 340 m/s), grondement filtré selon la surpression reçue |
| Temps | Temps réel pendant le flash et le souffle, puis accéléré « documentaire » (AUTO), frise temporelle navigable |

## Données (0 €, appelées directement par le navigateur)

| Couche | Source |
|---|---|
| Imagerie | Sentinel-2 cloudless 2024 (EOX, CC BY-NC-SA) ou Esri World Imagery (quota) |
| Relief | AWS Terrain Tiles (Terrarium) |
| Routes + bâtiments 3D | OpenFreeMap (OpenMapTiles / OSM) |
| Recherche | Photon (komoot) |

## Fichiers

- `src/globe.js`, `src/tileWorker.js`, `src/controls.js` : moteur de globe (quadtree, LOD, workers, caméra).
- `src/nuke/explosion.js` : volume, coquille de choc, voile au sol, lumière du flash.
- `src/nuke/buildingMaterial.js` : effondrement et incendies des bâtiments.
- `src/nuke/physics.js`, `src/nuke/sound.js` : physique et son (repris puis étendus de `../ground-zero`).
- `src/main.js` : rendu HDR, horloge de simulation, modes caméra, HUD.

## Performances

Niveaux de qualité **Ultra / High / Medium / Low** (panneau Render pipeline, *Auto* par défaut) : résolution max,
résolution et nombre de pas du nuage, ombrage, bloom, réfraction du choc, finesse des tuiles, portée des bâtiments.
En *Auto*, la résolution s'adapte en continu puis le niveau descend/remonte selon la fluidité mesurée.
Rendu à la demande : ~4 images/s quand rien ne bouge. En 4K à résolution égale : Ultra 15 i/s → Low 69 i/s.

## Mobile

Mise en page paysage dédiée (HUD compact, vues en icônes), invite de rotation en portrait, double-tap pour plonger,
manifeste d'application web (plein écran depuis l'écran d'accueil).

## Publication

```bash
npx vite build --base=/ground-zero/
rsync -az --delete dist/ user@your-server:/var/www/ground-zero/
```

Servi par Caddy (`airfall.dev`) : page et manifeste en `no-cache`, fichiers versionnés en cache long.

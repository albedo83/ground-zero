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
| Temps | Temps réel pendant le flash et le souffle, puis accéléré « documentaire » (AUTO, jusqu'à 30×), frise sur 30 min |
| Dissipation | Le vent d'altitude emporte le nuage : la tige s'incline et se rompt, le chapeau s'étale puis s'efface (~20–25 min) |

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
- `src/labels.js` : noms des villes (couche « place » d'OpenFreeMap), triés par importance, sans chevauchement, dans la langue du navigateur.

Relief exagéré ×2 par défaut (curseur ×1 à ×4 dans Render pipeline), avec un éclairage rasant qui contraste les versants.

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

## Licence

Code sous licence **MIT** (voir `LICENSE`).
Les données cartographiques chargées à l'exécution gardent leurs propres licences et attributions :
Sentinel-2 cloudless (EOX, CC BY-NC-SA 4.0), Esri World Imagery, AWS Terrain Tiles,
OpenFreeMap / OpenMapTiles © contributeurs OpenStreetMap (ODbL).

## Compteur mondial (`server/`)

Petit service Python sans dépendance (`server/counter.py`) qui totalise les frappes de tous les visiteurs.

- `GET /stats` → `{ strikes, deaths, injured }` ; `POST /strike` ← `{ yieldKt, lat, lon, burst }`.
- Le serveur **recalcule lui-même les victimes** (portage exact de `src/nuke/physics.js`, table `server/cities.json`) :
  le navigateur n'envoie jamais de chiffres, impossible de les gonfler.
- Anti-spam : 1 frappe / 4 s et 40 / heure par adresse IP ; corps limité à 1 Ko ; valeurs validées.
- Stockage atomique dans un fichier JSON ; écoute en local uniquement.
- `server/gz-counter.service` : unité systemd isolée (utilisateur dynamique, système en lecture seule, 64 Mo max).

Installation (sur le serveur) :

```bash
sudo install -d /opt/ground-zero-counter && sudo install -m 644 server/counter.py server/cities.json /opt/ground-zero-counter/
sudo install -m 644 server/gz-counter.service /etc/systemd/system/ && sudo systemctl enable --now gz-counter
```

Caddy relaie l'API sous le chemin du site :

```
handle_path /ground-zero/api/* {
	reverse_proxy 127.0.0.1:8787
}
```

Si l'API est injoignable (développement local, panne), la page retombe sur le compteur local du navigateur.
`server/cities.json` se régénère depuis `src/nuke/physics.js` si la liste de villes change.

## Sécurité

- En-têtes servis par Caddy : HSTS (preload), **CSP stricte** sans `unsafe-inline` ni `eval`
  (scripts/styles du site uniquement ; connexions limitées aux fournisseurs de tuiles et de recherche),
  `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` minimale, COOP/CORP `same-origin`.
- Polices auto-hébergées (`public/fonts`, SIL OFL) : aucune requête vers Google Fonts.
- API du compteur : JSON obligatoire, origine vérifiée (`GZ_ALLOWED_ORIGINS`), anti-spam par IP,
  victimes recalculées côté serveur.
- Tester la CSP en local : `npx vite build --base=/ground-zero/ && GZ_CSP="…" npx vite preview --base=/ground-zero/`.

## Accessibilité (WCAG 2.2 AA)

Audit axe-core : 0 violation (page, fenêtre modale, détonation, mobile).
Zoom autorisé, repères (landmarks), noms accessibles, focus visible, lien d'évitement,
fenêtre modale avec piège de focus et Échap, annonces `aria-live` (cible, détonation, arrivée du souffle),
cibles tactiles ≥ 24 px, contraste ≥ 4,5:1, `prefers-reduced-motion` (pas de tremblement, flash adouci).
Globe au clavier : flèches (déplacer), `+`/`-` (zoom), PgPréc/PgSuiv (inclinaison), `Q`/`E` (rotation),
Entrée (cible au centre).

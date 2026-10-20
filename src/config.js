// Sources de tuiles — toutes gratuites, appelées directement par le navigateur du visiteur.

export const IMAGERY = {
  sentinel: {
    label: 'Sentinel-2',
    url: (z, x, y) =>
      `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/${z}/${y}/${x}.jpg`,
    maxZoom: 15,
    maxTileZoom: 17,
    attribution:
      'Sentinel-2 cloudless 2024 © <a href="https://s2maps.eu" target="_blank">EOX IT Services GmbH</a> (données Copernicus Sentinel modifiées)',
  },
  esri: {
    label: 'Esri (HD)',
    url: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    maxZoom: 18,
    maxTileZoom: 19,
    attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics',
  },
};

export const TERRAIN = {
  url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  maxZoom: 15,
  attribution: 'Relief © Mapzen / AWS Terrain Tiles',
};

export const VECTOR = {
  tilejson: 'https://tiles.openfreemap.org/planet',
  maxZoom: 14,
  minOverlayZoom: 13, // routes dessinées sur l'imagerie à partir de ce zoom
  buildingZoom: 14,
  attribution:
    '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">contributeurs OpenStreetMap</a>',
};

export const GRID = 32; // segments par tuile

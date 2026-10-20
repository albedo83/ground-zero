/**
 * GROUND//ZERO — Nuclear Physics & Scaling Engine
 *
 * Scientific References:
 * 1. Glasstone, S., & Dolan, P. J. (1977). "The Effects of Nuclear Weapons" (3rd Edition).
 *    United States Department of Defense & Energy Research and Development Administration.
 * 2. Brode, H. L. (1955). "Numerical Solutions of Spherical Blast Waves". Journal of Applied Physics.
 * 3. Sedov, L. I. (1959). "Similarity and Dimensional Methods in Mechanics".
 * 4. WSEG-10 (1959) / Miller Fallout Scaling Model & Wellerstein NUKEMAP methodology.
 * 5. Sublette, C. (2001). Nuclear Weapon Archive — Effects of Nuclear Explosions.
 */

export const HISTORICAL_DETONATIONS_BASE = 2058; // 1945 Trinity -> 2017 North Korea test

export const WEAPON_PRESETS = [
  {
    id: 'davy-crockett',
    name: 'DAVY CROCKETT',
    subtitle: '20 t · 1961',
    yieldKt: 0.02,
    year: 1961,
    origin: 'USA',
    type: 'M-388 Recoilless Rifle Fission Warhead',
    defaultBurst: 'airburst',
    description: 'Smallest tactical nuclear weapon ever deployed by the US Army. Prompt lethal ionizing radiation radius exceeds its 5 psi blast radius.'
  },
  {
    id: 'little-boy',
    name: 'LITTLE BOY',
    subtitle: '15 kt · 1945',
    yieldKt: 15,
    year: 1945,
    origin: 'USA',
    type: 'Gun-Type Enriched Uranium-235',
    defaultBurst: 'airburst',
    description: 'Detonated at 580 m altitude over Hiroshima on August 6, 1945. Leveled 13 km² of urban center.'
  },
  {
    id: 'fat-man',
    name: 'FAT MAN',
    subtitle: '21 kt · 1945',
    yieldKt: 21,
    year: 1945,
    origin: 'USA',
    type: 'Implosion-Type Plutonium-239',
    defaultBurst: 'airburst',
    description: 'Detonated at 503 m altitude over Nagasaki on August 9, 1945. Higher efficiency implosion design.'
  },
  {
    id: 'w76',
    name: 'W76 — TRIDENT II',
    subtitle: '100 kt · 1978',
    yieldKt: 100,
    year: 1978,
    origin: 'USA / UK',
    type: 'Thermonuclear MIRV Re-entry Vehicle',
    defaultBurst: 'airburst',
    description: 'Standard Submarine-Launched Ballistic Missile (SLBM) warhead forming the backbone of modern naval deterrence.'
  },
  {
    id: 'tn81',
    name: 'TN 81',
    subtitle: '300 kt · 1988',
    yieldKt: 300,
    year: 1988,
    origin: 'France',
    type: 'ASMP Thermonuclear Warhead',
    defaultBurst: 'airburst',
    description: 'French air-sol moyenne portée strategic thermonuclear warhead (300 kt yield).'
  },
  {
    id: 'b83',
    name: 'B83',
    subtitle: '1.2 Mt · 1983',
    yieldKt: 1200,
    year: 1983,
    origin: 'USA',
    type: 'Variable-Yield Strategic Gravity Bomb',
    defaultBurst: 'airburst',
    description: 'Highest-yield strategic weapon currently in the United States active stockpile (1.2 Megatons).'
  },
  {
    id: 'castle-bravo',
    name: 'CASTLE BRAVO',
    subtitle: '15 Mt · 1954',
    yieldKt: 15000,
    year: 1954,
    origin: 'USA',
    type: 'Lithium-Deuteride Dry Thermonuclear Device',
    defaultBurst: 'surface',
    description: 'Detonated at Bikini Atoll. Runaway Lithium-7 fusion reaction produced 2.5x the predicted yield (15 Megatons).'
  },
  {
    id: 'tsar-bomba',
    name: 'TSAR BOMBA',
    subtitle: '50 Mt · 1961',
    yieldKt: 50000,
    year: 1961,
    origin: 'USSR',
    type: 'RDS-220 Three-Stage Thermonuclear Bomb',
    defaultBurst: 'airburst',
    description: 'Most powerful human-made explosion in history. Shockwave circled Earth 3 times; mushroom cloud reached 64 km into the mesosphere.'
  }
];

export const TARGET_CITIES = [
  { name: 'Paris, France', lat: 48.8566, lon: 2.3522, density: 20500, tier: 'metropolis' },
  { name: 'Lyon, France', lat: 45.7640, lon: 4.8357, density: 10800, tier: 'urban' },
  { name: 'Marseille, France', lat: 43.2965, lon: 5.3698, density: 6800, tier: 'urban' },
  { name: 'Bordeaux, France', lat: 44.8378, lon: -0.5792, density: 5400, tier: 'urban' },
  { name: 'Toulouse, France', lat: 43.6047, lon: 1.4442, density: 4900, tier: 'urban' },
  { name: 'Nice, France', lat: 43.7102, lon: 7.2620, density: 4800, tier: 'urban' },
  { name: 'Lille, France', lat: 50.6292, lon: 3.0573, density: 6700, tier: 'urban' },
  { name: 'Nantes, France', lat: 47.2184, lon: -1.5536, density: 5100, tier: 'urban' },
  { name: 'Strasbourg, France', lat: 48.5734, lon: 7.7521, density: 4600, tier: 'urban' },
  { name: 'London, UK', lat: 51.5074, lon: -0.1278, density: 11200, tier: 'metropolis' },
  { name: 'Madrid, Spain', lat: 40.4168, lon: -3.7038, density: 8400, tier: 'metropolis' },
  { name: 'Barcelona, Spain', lat: 41.3874, lon: 2.1686, density: 16200, tier: 'metropolis' },
  { name: 'Brussels, Belgium', lat: 50.8503, lon: 4.3517, density: 7500, tier: 'urban' },
  { name: 'Amsterdam, Netherlands', lat: 52.3676, lon: 4.9041, density: 5300, tier: 'urban' },
  { name: 'Geneva, Switzerland', lat: 46.2044, lon: 6.1432, density: 12600, tier: 'urban' },
  { name: 'Berlin, Germany', lat: 52.5200, lon: 13.4050, density: 4200, tier: 'urban' },
  { name: 'Munich, Germany', lat: 48.1351, lon: 11.5820, density: 4800, tier: 'urban' },
  { name: 'Rome, Italy', lat: 41.9028, lon: 12.4964, density: 6200, tier: 'metropolis' },
  { name: 'Milan, Italy', lat: 45.4642, lon: 9.1900, density: 7600, tier: 'metropolis' },
  { name: 'Vienna, Austria', lat: 48.2082, lon: 16.3738, density: 4700, tier: 'urban' },
  { name: 'Warsaw, Poland', lat: 52.2297, lon: 21.0122, density: 3600, tier: 'urban' },
  { name: 'Kyiv, Ukraine', lat: 50.4501, lon: 30.5234, density: 3500, tier: 'urban' },
  { name: 'Moscow, Russia', lat: 55.7558, lon: 37.6173, density: 9800, tier: 'metropolis' },
  { name: 'Istanbul, Turkey', lat: 41.0082, lon: 28.9784, density: 13400, tier: 'metropolis' },
  { name: 'New York, USA', lat: 40.7128, lon: -74.0060, density: 11300, tier: 'metropolis' },
  { name: 'Washington D.C., USA', lat: 38.8977, lon: -77.0365, density: 4400, tier: 'urban' },
  { name: 'Los Angeles, USA', lat: 34.0522, lon: -118.2437, density: 3300, tier: 'urban' },
  { name: 'San Francisco, USA', lat: 37.7749, lon: -122.4194, density: 7200, tier: 'urban' },
  { name: 'Chicago, USA', lat: 41.8781, lon: -87.6298, density: 4600, tier: 'urban' },
  { name: 'Tokyo, Japan', lat: 35.6895, lon: 139.6917, density: 15400, tier: 'metropolis' },
  { name: 'Hiroshima, Japan', lat: 34.3946, lon: 132.4547, density: 4600, tier: 'urban' },
  { name: 'Nagasaki, Japan', lat: 32.7737, lon: 129.8633, density: 3900, tier: 'urban' },
  { name: 'Seoul, South Korea', lat: 37.5665, lon: 126.9780, density: 16000, tier: 'metropolis' },
  { name: 'Beijing, China', lat: 39.9042, lon: 116.4074, density: 13100, tier: 'metropolis' },
  { name: 'Mumbai, India', lat: 19.0760, lon: 72.8777, density: 24500, tier: 'metropolis' },
  { name: 'Dubai, UAE', lat: 25.2048, lon: 55.2708, density: 5800, tier: 'urban' },
  { name: 'Cairo, Egypt', lat: 30.0444, lon: 31.2357, density: 19300, tier: 'metropolis' },
  { name: 'São Paulo, Brazil', lat: -23.5505, lon: -46.6333, density: 8100, tier: 'metropolis' },
  { name: 'Sydney, Australia', lat: -33.8688, lon: 151.2093, density: 4800, tier: 'urban' },
  { name: 'Bikini Atoll, Marshall Islands', lat: 11.5975, lon: 165.3772, density: 8, tier: 'test-site' },
  { name: 'Novaya Zemlya, Arctic', lat: 73.8072, lon: 54.9817, density: 2, tier: 'test-site' },
  { name: 'Trinity Site, New Mexico', lat: 33.6773, lon: -106.4754, density: 12, tier: 'test-site' },
  { name: 'Sudan Desert (Ref. Screenshot)', lat: 16.49, lon: 29.21, density: 35, tier: 'rural' }
];

/**
 * Formats yield in tons (t), kilotons (kt), or megatons (Mt)
 */
export function formatYield(yieldKt) {
  if (yieldKt < 1) {
    const tons = Math.round(yieldKt * 1000);
    return `${tons} t`;
  }
  if (yieldKt >= 1000) {
    const mt = yieldKt / 1000;
    return `${mt >= 10 ? Math.round(mt) : Number(mt.toFixed(1))} Mt`;
  }
  return `${yieldKt >= 10 ? Math.round(yieldKt) : Number(yieldKt.toFixed(1))} kt`;
}

/**
 * Formats distance in meters (m) or kilometers (km) matching NUKEMAP / screenshot style
 */
export function formatDistance(meters) {
  if (meters >= 1000) {
    const km = meters / 1000;
    return `${km >= 100 ? Math.round(km) : km.toFixed(1)} km`;
  }
  return `${Math.max(1, Math.round(meters))} m`;
}

/**
 * Estimates population density (people / km²) for any (lat, lon) on Earth.
 */
export function estimatePopulationDensity(lat, lon) {
  for (const city of TARGET_CITIES) {
    const dLat = (lat - city.lat) * 111.32;
    const dLon = (lon - city.lon) * 111.32 * Math.cos((lat * Math.PI) / 180);
    const distKm = Math.hypot(dLat, dLon);
    if (distKm < 8) {
      return {
        density: city.density,
        label: city.tier === 'metropolis'
          ? `dense urban core (${city.density.toLocaleString('en-US')}/km²)`
          : city.tier === 'urban'
            ? `urban center (${city.density.toLocaleString('en-US')}/km²)`
            : city.tier === 'test-site'
              ? `test range (${city.density}/km²)`
              : `rural area (${city.density}/km²)`,
        cityName: city.name
      };
    }
    if (distKm < 35) {
      const falloff = Math.exp(-distKm / 14);
      const subDensity = Math.max(40, Math.round(city.density * falloff));
      return {
        density: subDensity,
        label: `suburban metro (${subDensity.toLocaleString('en-US')}/km²)`,
        cityName: `Near ${city.name}`
      };
    }
  }

  const isLand = checkRoughLandmask(lat, lon);
  if (!isLand) {
    return {
      density: 0,
      label: 'open ocean (0/km²)',
      cityName: 'Maritime Zone'
    };
  }

  const absLat = Math.abs(lat);
  if (absLat > 66) {
    return { density: 3, label: 'polar region (3/km²)', cityName: null };
  }

  if (
    (lat > 14 && lat < 31 && lon > -15 && lon < 55) ||
    (lat < -18 && lat > -30 && lon > 118 && lon < 142)
  ) {
    return { density: 35, label: 'rural area (35/km²)', cityName: null };
  }

  const hash = Math.abs(Math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453) % 1;
  const baseDensity = Math.round(45 + hash * 280);
  const category = baseDensity > 180 ? 'semi-urban area' : 'rural area';
  return {
    density: baseDensity,
    label: `${category} (${baseDensity}/km²)`,
    cityName: null
  };
}

export function checkRoughLandmask(lat, lon) {
  if (lat < -65) return true;
  if (lat > 15 && lat < 72 && lon > -168 && lon < -52) {
    if (lat < 25 && lon > -98 && lon < -82) return false;
    return true;
  }
  if (lat > -56 && lat <= 12 && lon > -81 && lon < -34) return true;
  if (lat > 36 && lat < 71 && lon > -10 && lon < 60) return true;
  if (lat > -35 && lat <= 37 && lon > -17 && lon < 51) {
    if (lat < 4 && lon < 8) return false;
    return true;
  }
  if (lat > 8 && lat < 75 && lon >= 40 && lon < 145) return true;
  if (lat > -10 && lat < 46 && lon >= 95 && lon < 146) return true;
  if (lat > -43 && lat < -11 && lon > 113 && lon < 154) return true;
  return false;
}

/**
 * Computes WSEG-10 / Glasstone & Dolan Ch. IX Radioactive Fallout Contours
 * Fallout is severe when the fireball touches the ground (Surface Burst) and minimal for high airbursts.
 */
export function calculateFalloutPlume(yieldKt, burstMode = 'airburst', windSpeedKmh = 24, windAngleDeg = 45) {
  const Y = Math.max(0.01, yieldKt);
  const fissionFraction = Y > 100 ? 0.5 : 1.0;
  const effectiveFissionKt = Y * fissionFraction;
  const surfaceFactor = burstMode === 'surface' ? 1.0 : 0.12; // Airburst produces minimal local fallout
  const windFactor = windSpeedKmh / 24.0;

  // Downwind plume length (meters) & max width (meters) for 100 rad/hr, 10 rad/hr, 1 rad/hr at H+1
  const baseDownwindM = 3400 * Math.pow(effectiveFissionKt, 0.46) * surfaceFactor * Math.pow(windFactor, 0.35);
  const baseWidthM = 620 * Math.pow(effectiveFissionKt, 0.42) * surfaceFactor;

  return {
    active: burstMode === 'surface' || Y <= 1.0,
    windSpeedKmh,
    windAngleDeg,
    contours: [
      {
        doseLabel: '1,000 rad/hr (Lethal in <1h)',
        downwindM: baseDownwindM * 0.22,
        widthM: baseWidthM * 0.20,
        color: 0xff2200
      },
      {
        doseLabel: '100 rad/hr (Acute Radiation Sickness)',
        downwindM: baseDownwindM * 0.58,
        widthM: baseWidthM * 0.52,
        color: 0xff8800
      },
      {
        doseLabel: '10 rad/hr (Evacuation Zone)',
        downwindM: baseDownwindM * 1.35,
        widthM: baseWidthM * 1.1,
        color: 0xffdd22
      }
    ]
  };
}

/**
 * Computes full scientific effects of a nuclear detonation of yield Y (in kilotons)
 * Based on Glasstone & Dolan (1977) scaling laws.
 */
export function calculateNuclearEffects(yieldKt, lat = 16.49, lon = 29.21, burstMode = 'airburst') {
  const Y = Math.max(0.001, yieldKt);
  const y13 = Math.pow(Y, 1 / 3);
  const y04 = Math.pow(Y, 0.4);
  const y041 = Math.pow(Y, 0.41);

  const isAirburst = burstMode === 'airburst';

  // Optimal Height of Burst (HOB) in meters for maximizing moderate-to-severe blast (5-10 psi Mach stem)
  const optimalHobMeters = isAirburst ? Math.round(220 * y13) : 0;

  // 1. Fireball Radius (meters) — 177 m at 15 kt airburst
  const fireballRadiusM = (isAirburst ? 60.0 : 72.0) * y04;

  // 2. 20 PSI Heavy Blast Radius (meters) — 538 m at 15 kt airburst
  const blast20PsiRadiusM = (isAirburst ? 218.1 : 178.0) * y13;

  // 3. 5 PSI Moderate/Severe Blast Radius (meters) — 1.2 km at 15 kt airburst
  const blast5PsiRadiusM = (isAirburst ? 486.6 : 365.0) * y13;

  // 4. Thermal Radiation Radius (3rd-degree burns) — 2.1 km at 15 kt airburst
  const atmosphericAttenuation = 1 / (1 + 0.0035 * Math.pow(Y, 0.32));
  const thermalRadiusM = (isAirburst ? 710.0 : 590.0) * y041 * atmosphericAttenuation;

  // 5. 1 PSI Light Blast Radius (meters) — 3.1 km at 15 kt airburst
  const blast1PsiRadiusM = (isAirburst ? 1257.0 : 940.0) * y13;

  // 6. Prompt Ionizing Radiation (500 rem)
  const rad500RemM = solvePromptRadiationRadius(Y);

  // 7. Crater Diameter (for surface bursts, Glasstone & Dolan Ch. VI)
  const craterRadiusM = isAirburst ? 0 : 19.5 * Math.pow(Y, 0.3);

  // 8. Stabilized Mushroom Cloud Dimensions (Glasstone & Dolan Fig. 2.18)
  // 13.2 km at 15 kt; ~64 km at 50 Mt
  let cloudTopKm;
  if (Y <= 25) {
    cloudTopKm = 4.98 * Math.pow(Y, 0.36);
  } else {
    cloudTopKm = Math.min(68.0, 9.8 * Math.pow(Y, 0.175));
  }
  const cloudCapDiameterKm = Math.min(95.0, 2.1 * Math.pow(Y, 0.38));

  // 9. Time of 2nd Thermal Pulse Maximum (Bhangmeter equation: t_2max ≈ 0.042 * Y^0.44 seconds)
  const bhangmeterSecondMaxSec = 0.042 * Math.pow(Y, 0.44);

  // 10. Population & Casualty Estimation (Glasstone & Dolan / NUKEMAP ring integration)
  const popInfo = estimatePopulationDensity(lat, lon);
  const densityPerKm2 = popInfo.density;

  const r20Km = blast20PsiRadiusM / 1000;
  const r5Km = blast5PsiRadiusM / 1000;
  const rThermKm = Math.max(r5Km, thermalRadiusM / 1000);
  const r1Km = Math.max(rThermKm, blast1PsiRadiusM / 1000);

  const area20 = Math.PI * r20Km * r20Km;
  const area5 = Math.max(0, Math.PI * r5Km * r5Km - area20);
  const areaTherm = Math.max(0, Math.PI * rThermKm * rThermKm - Math.PI * r5Km * r5Km);
  const area1 = Math.max(0, Math.PI * r1Km * r1Km - Math.PI * rThermKm * rThermKm);

  const rawDeaths =
    densityPerKm2 * (area20 * 0.98 + area5 * 0.48 + areaTherm * 0.14);
  const rawInjured =
    densityPerKm2 * (area20 * 0.02 + area5 * 0.44 + areaTherm * 0.50 + area1 * 0.25);

  const estDeaths = Math.round(rawDeaths);
  const estInjured = Math.round(rawInjured);

  const fallout = calculateFalloutPlume(Y, burstMode);

  return {
    yieldKt: Y,
    yieldFormatted: formatYield(Y),
    burstMode,
    optimalHobMeters,
    craterRadiusM,
    cloudTopKm: Number(cloudTopKm.toFixed(1)),
    cloudCapDiameterKm: Number(cloudCapDiameterKm.toFixed(1)),
    bhangmeterSecondMaxSec,
    radii: {
      fireballM: fireballRadiusM,
      blast20PsiM: blast20PsiRadiusM,
      blast5PsiM: blast5PsiRadiusM,
      thermalM: thermalRadiusM,
      blast1PsiM: blast1PsiRadiusM,
      radiation500RemM: rad500RemM
    },
    formattedRadii: {
      fireball: formatDistance(fireballRadiusM),
      blast20Psi: formatDistance(blast20PsiRadiusM),
      blast5Psi: formatDistance(blast5PsiRadiusM),
      thermal: formatDistance(thermalRadiusM),
      blast1Psi: formatDistance(blast1PsiRadiusM),
      radiation500Rem: formatDistance(rad500RemM)
    },
    fallout,
    casualties: {
      deaths: estDeaths,
      injured: estInjured,
      density: densityPerKm2,
      densityLabel: popInfo.label,
      cityName: popInfo.cityName
    }
  };
}

function solvePromptRadiationRadius(yieldKt) {
  let r = 700;
  for (let i = 0; i < 12; i++) {
    const f = Math.log(yieldKt) + 14.9 - 2 * Math.log(r) - r / 260;
    const df = -2 / r - 1 / 260;
    r = Math.max(30, r - f / df);
  }
  return r;
}

/**
 * Computes instantaneous physical state of the detonation at elapsed time `tSec` (seconds)
 */
export function getDetonationStateAtTime(effects, tSec) {
  const Y = effects.yieldKt;
  const y13 = Math.pow(Y, 1 / 3);
  const y04 = Math.pow(Y, 0.4);
  const t = Math.max(0.0001, tSec);

  const tau = t / y13;

  // 1. Bhangmeter Double Flash curve (normalized irradiance 0..1)
  const tMin = 0.014 * y04;
  const tMax2 = Math.max(0.08, effects.bhangmeterSecondMaxSec);
  let flashIntensity = 0;
  if (t < tMin) {
    const p = t / tMin;
    flashIntensity = 0.35 + 0.65 * Math.pow(1 - p, 2);
  } else {
    const u = (t - tMin) / tMax2;
    flashIntensity = 0.35 * Math.exp(-u * 2.5) + 0.92 * u * Math.exp(1 - u);
  }
  flashIntensity = Math.min(1, Math.max(0, flashIntensity));

  // 2. Effective Surface Blackbody Temperature (Kelvin)
  let temperatureK;
  if (t < 0.002) {
    temperatureK = 15000000 * Math.exp(-t * 1200);
  } else if (t < tMin) {
    temperatureK = 3200 + 8000 * (1 - t / tMin);
  } else {
    const u = (t - tMin) / tMax2;
    const secondPulseT = 4800 * u * Math.exp(1 - u);
    const baseCooling = 2900 / (1 + Math.pow(t / (0.8 * y04), 0.75));
    temperatureK = Math.max(450, baseCooling + secondPulseT);
  }

  // 3. Shockwave Front Radius R_s(t) in meters (Sedov-Taylor early + acoustic Mach 1 asymptotic)
  const c0 = 340.3;
  const sedovRadius = 215 * y13 * Math.pow(Math.min(tau, 2.5), 0.42);
  const acousticRadius = tau > 0.15 ? c0 * (t - 0.08 * y13) : 0;
  const shockRadiusM = Math.max(sedovRadius, sedovRadius * Math.exp(-tau) + acousticRadius);

  const machNumber = 1.0 + 4.8 / (1 + Math.pow(shockRadiusM / effects.radii.blast20PsiM, 1.45));
  const shockSpeedKmh = Math.round(machNumber * c0 * 3.6);

  const rNorm = Math.max(0.15, shockRadiusM / effects.radii.blast5PsiM);
  const overpressurePsi = 5.0 * (0.45 / Math.pow(rNorm, 1.35) + 0.55 / Math.pow(rNorm, 2.6));

  const windSpeedKmh = Math.round(
    (260 * (overpressurePsi / 5.0)) / Math.sqrt(1 + 0.04 * overpressurePsi)
  );

  const maxCloudM = effects.cloudTopKm * 1000;
  const riseRate = 1 / (12 + 6 * Math.log10(Math.max(1, Y)));
  const currentCloudTopM =
    effects.optimalHobMeters +
    (maxCloudM - effects.optimalHobMeters) * (1 - Math.exp(-t * riseRate));

  const casualtyProgress = Math.min(
    1,
    Math.pow(Math.min(1, shockRadiusM / Math.max(1, effects.radii.blast1PsiM)), 0.7)
  );

  return {
    tSec: t,
    flashIntensity,
    temperatureK: Math.round(temperatureK),
    shockRadiusM,
    machNumber: Number(machNumber.toFixed(2)),
    shockSpeedKmh,
    overpressurePsi: Number(Math.min(9999, overpressurePsi).toFixed(1)),
    windSpeedKmh,
    currentCloudTopM,
    casualtyProgress
  };
}

/**
 * Chronologie géométrique complète du champignon (mètres, secondes), pilotant les shaders.
 * Échelles inspirées de Glasstone & Dolan ch. II (boule de feu, montée, stabilisation du nuage).
 */
export function explosionTimeline(effects, tSec) {
  const s0 = getDetonationStateAtTime(effects, tSec);
  const Y = effects.yieldKt;
  const t = Math.max(0, tSec);
  const y13 = Math.cbrt(Y);
  const hob = effects.optimalHobMeters;
  const Rfb = effects.radii.fireballM;
  const Htop = effects.cloudTopKm * 1000;
  const RcapF = (effects.cloudCapDiameterKm * 1000) / 2;

  // Boule de feu : croissance vers le rayon max (≈ 11 × t₂max), puis refroidissement
  const t2 = Math.max(0.02, effects.bhangmeterSecondMaxSec);
  const tR = 11 * t2;
  const grow = Math.min(1, Math.pow(t / tR, 0.38));
  const fireballR = Math.max(1, Rfb * grow);

  // Montée flottante : vitesse nulle au départ, f(s) = 1 − (1+s)e^(−s)
  const tau = 26 + 3 * Math.log10(Math.max(1, Y));
  const s = t / tau;
  const rise = 1 - (1 + s) * Math.exp(-s);
  const capThick = Math.max(Rfb, 0.34 * (Htop - hob) * 0.5);
  const capCFinal = Htop - capThick;
  const capC = hob + Math.max(0, capCFinal - hob) * rise;

  // Morphose sphère → tore (anneau tourbillonnaire)
  const toroid = smooth(0.8 * tR, 6 * tR + 0.25 * tau, t);
  const g = 1 - Math.exp(-s * 1.15);
  const capMinor = Math.max(fireballR, RcapF * 0.36 * g + fireballR * (1 - g));
  const capMajor = Math.max(fireballR * 0.3, RcapF * 0.62 * g);

  // Tige : poussière aspirée depuis le sol par les vents de retour
  const tStem = 0.6 * y13 + 0.4 * tR;
  const stemTop = Math.max(0, Math.min(capC - capMinor * 0.5, (capC + 60) * smooth(tStem, tStem + 0.9 * tau, t)));
  const stemR = RcapF * (0.05 + 0.07 * g) * smooth(tStem, tStem + 4, t) + 1;

  // Nuage de base (poussière soulevée derrière le front de choc)
  const r5 = effects.radii.blast5PsiM;
  const surgeR = Math.min(s0.shockRadiusM, r5 * 1.15) * (1 + 0.15 * s);
  const surgeH = (40 + 0.07 * surgeR) * smooth(0.2, 3, t);
  const surgeDensity = smooth(0.2 * y13, 1.2 * y13, t) * Math.exp(-Math.max(0, t - 3 * tau) / (2 * tau));

  // Nuage de condensation de Wilson (coquille blanche éphémère)
  const ws = Math.pow(Y / 20, 1 / 3);
  const wilson = smooth(0.25 * ws, 0.7 * ws, t) * (1 - smooth(1.6 * ws, 3.5 * ws, t));
  const wilsonR = Math.min(s0.shockRadiusM, fireballR * 4.5);

  // Températures (K) et luminance
  let coreTemp;
  if (t < tR) coreTemp = 8000 - 2600 * (t / tR);
  else coreTemp = 1300 + 4100 * Math.exp(-(t - tR) / (3.5 * tR)) + 900 * Math.exp(-(t - tR) / 25);
  const coreFade = Math.exp(-Math.max(0, t - tR) / (1.6 * tau + 20));
  const brightness = s0.flashIntensity * 60 * (t < tR ? 1 : Math.exp(-(t - tR) / (1.5 * tR))) + 1.5 * coreFade;

  // Étendue englobante pour le raymarching
  const radiusBound = Math.max(fireballR * 1.4, capMajor + capMinor * 1.6, surgeR + surgeH * 1.5, wilson > 0.01 ? wilsonR * 1.1 : 0) + 50;
  const heightBound = Math.max(capC + capMinor * 1.5, hob + fireballR * 1.4, surgeH * 2) + 50;

  return {
    ...s0,
    t, tau, hob, fireballR, capC, capMajor, capMinor, toroid,
    stemTop, stemR, surgeR, surgeH, surgeDensity,
    wilson, wilsonR, coreTemp, coreFade, brightness,
    radiusBound, heightBound,
  };
}

/** Surpression approximative (psi) à la distance r, une fois le front passé */
export function overpressureAt(effects, r) {
  const rn = Math.max(0.05, r / effects.radii.blast5PsiM);
  return 5.0 * (0.45 / Math.pow(rn, 1.35) + 0.55 / Math.pow(rn, 2.6));
}

function smooth(a, b, x) {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

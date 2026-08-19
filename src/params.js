import { uniform, uniformArray } from 'three/tsl';

// Duft-Typen: Reihenfolge = Index im typeIntensity-Array und in den Emitter-Daten
export const SCENT_TYPES = [
  { key: 'blume',    name: 'Wiesenblume (blumig)',  color: 0xff4f9a },
  { key: 'lavendel', name: 'Lavendel',              color: 0x8a5cff },
  { key: 'baum',     name: 'Laubbaum (honigartig)', color: 0xffb340 },
  { key: 'kiefer',   name: 'Kiefer (harzig)',       color: 0x2fd6a3 },
  { key: 'kraut',    name: 'Kräuterbusch (frisch)', color: 0xb8e02e },
];

// Geteilte GPU-Uniforms — das Dev-Tool schreibt direkt in .value
export const u = {
  // Wind
  windSpeed:  uniform(1.6),
  windDirRad: uniform(0.7),
  turbulence: uniform(1.6),
  noiseScale: uniform(0.28),
  noiseSpeed: uniform(0.3),
  rise:       uniform(0.12),
  gust:       uniform(0.5),
  gustFreq:   uniform(0.25),
  spread:     uniform(0.55),

  // Partikel / Duft
  size:        uniform(0.3),
  intensity:   uniform(0.55),
  pickup:      uniform(6.0),  // wie schnell Luft Duft aufnimmt
  evaporate:   uniform(7.0),  // Verflüchtigung (Sekunden)
  spawnRadius: uniform(1.0),  // Multiplikator der Duftzonen-Radien
  airOpacity:  uniform(0.0),  // unbeduftete Luft sichtbar machen
  airHeight:   uniform(6.0),  // Höhe der Luftschicht (m)
  airGround:   uniform(2.0),  // Bodennähe-Exponent (1 = gleichmäßig, höher = bodennah)

  // Szene / Simulation
  timeScale: uniform(1.0),
  sway:      uniform(1.0),
  windOnly:  uniform(0.0), // 1 = nur Windfeld zeigen (neutral, ohne Duft)

  // Performance
  pickupStride: uniform(1.0),   // Duftaufnahme nur jeden N-ten Frame (kompensiert)
  frameMod:     uniform(0.0),   // aktueller Frame % pickupStride (von der Loop gesetzt)
  cheapNoise:   uniform(0.0),   // 1 = billige Turbulenz (1 Noise statt 3)
  cullDist:     uniform(115.0), // Partikel jenseits dieser Distanz nicht zeichnen

  // Intensität pro Duft-Typ (Index = SCENT_TYPES)
  typeIntensity: uniformArray(SCENT_TYPES.map(() => 1.0)),
};

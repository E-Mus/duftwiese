import GUI from 'lil-gui';
import { SCENT_TYPES, u } from './params.js';

// Dev-Tool: alle Regler schreiben direkt in die GPU-Uniforms (params.js)
// bzw. schalten Szenen-Objekte. "Zurücksetzen" stellt die Defaults wieder her.
export function createDevTool({
  scent, world, scene, windArrow,
  setDarkMode, setResolution, setParticleRes, setShadowFreeze,
}) {
  const gui = new GUI({ title: 'Duftwiese — Dev-Tool', width: 320 });

  const s = {
    windSpeed: u.windSpeed.value,
    windDirDeg: (u.windDirRad.value * 180) / Math.PI,
    gust: u.gust.value,
    gustFreq: u.gustFreq.value,
    turbulence: u.turbulence.value,
    noiseScale: u.noiseScale.value,
    noiseSpeed: u.noiseSpeed.value,
    rise: u.rise.value,
    spread: u.spread.value,

    count: scent.count,
    size: u.size.value,
    intensity: u.intensity.value,
    pickup: u.pickup.value,
    evaporate: u.evaporate.value,
    spawnRadius: u.spawnRadius.value,
    airOpacity: u.airOpacity.value,
    airHeight: u.airHeight.value,
    airGround: u.airGround.value,
    additive: false,

    // Performance
    compaction: false,
    particleRes: 1,
    shadowFreeze: true,
    pickupStride: 1,
    cheapNoise: false,
    cullFar: true,

    timeScale: u.timeScale.value,
    pause: false,
    sway: u.sway.value,
    dark: false,
    resolution: 1,
    windOnly: false,
    showPlants: true,
    showGrass: true,
    showMarkers: false,
    showWindArrow: true,
  };

  // ------------------------------------------------------------ Wind
  const fWind = gui.addFolder('Wind');
  fWind.add(s, 'windSpeed', 0, 8, 0.05).name('Stärke (m/s)')
    .onChange((v) => (u.windSpeed.value = v));
  fWind.add(s, 'windDirDeg', 0, 360, 1).name('Richtung (°)')
    .onChange((v) => (u.windDirRad.value = (v * Math.PI) / 180));
  fWind.add(s, 'gust', 0, 2, 0.05).name('Böen-Stärke')
    .onChange((v) => (u.gust.value = v));
  fWind.add(s, 'gustFreq', 0.02, 2, 0.01).name('Böen-Frequenz')
    .onChange((v) => (u.gustFreq.value = v));
  fWind.add(s, 'turbulence', 0, 5, 0.05).name('Turbulenz')
    .onChange((v) => (u.turbulence.value = v));
  fWind.add(s, 'noiseScale', 0.02, 1, 0.01).name('Wirbel-Größe')
    .onChange((v) => (u.noiseScale.value = v));
  fWind.add(s, 'noiseSpeed', 0, 2, 0.01).name('Wirbel-Tempo')
    .onChange((v) => (u.noiseSpeed.value = v));
  fWind.add(s, 'rise', 0, 2, 0.01).name('Auftrieb')
    .onChange((v) => (u.rise.value = v));
  fWind.add(s, 'spread', 0, 2, 0.01).name('Streuung')
    .onChange((v) => (u.spread.value = v));

  // ------------------------------------------------------------ Partikel
  const fPart = gui.addFolder('Duft & Luft');
  fPart.add(s, 'count', 5000, scent.maxCount, 5000).name('Luft-Partikel')
    .onChange((v) => (scent.count = v));
  fPart.add(s, 'size', 0.05, 2, 0.01).name('Größe')
    .onChange((v) => (u.size.value = v));
  fPart.add(s, 'intensity', 0, 1, 0.01).name('Deckkraft')
    .onChange((v) => (u.intensity.value = v));
  fPart.add(s, 'pickup', 0.5, 20, 0.1).name('Aufnahme-Rate')
    .onChange((v) => (u.pickup.value = v));
  fPart.add(s, 'evaporate', 1, 30, 0.5).name('Verflüchtigung (s)')
    .onChange((v) => (u.evaporate.value = v));
  fPart.add(s, 'spawnRadius', 0.2, 4, 0.05).name('Duftzonen-Radius ×')
    .onChange((v) => (u.spawnRadius.value = v));
  fPart.add(s, 'airOpacity', 0, 0.06, 0.001).name('Luft sichtbar')
    .onChange((v) => (u.airOpacity.value = v));
  fPart.add(s, 'airHeight', 2, 20, 0.5).name('Luft-Höhe (m)')
    .onChange((v) => (u.airHeight.value = v))
    .onFinishChange(() => scent.requestReseed());
  fPart.add(s, 'airGround', 1, 4, 0.05).name('Bodennähe')
    .onChange((v) => (u.airGround.value = v))
    .onFinishChange(() => scent.requestReseed());
  fPart.add(s, 'additive').name('Additives Leuchten')
    .onChange((v) => scent.setAdditive(v));

  // ------------------------------------------------------------ Düfte
  const fScents = gui.addFolder('Düfte (Intensität pro Pflanze)');
  SCENT_TYPES.forEach((t, i) => {
    s['scent_' + t.key] = 1.0;
    const ctrl = fScents.add(s, 'scent_' + t.key, 0, 2, 0.01).name(t.name)
      .onChange((v) => {
        u.typeIntensity.array[i] = v;
      });
    // Farbfleck des Duftes im Label anzeigen
    const dot = document.createElement('span');
    dot.style.cssText =
      'display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;' +
      `background:#${t.color.toString(16).padStart(6, '0')}`;
    ctrl.$name.prepend(dot);
  });

  // ------------------------------------------------------------ Performance
  const fPerf = gui.addFolder('Performance');
  fPerf.add(s, 'resolution', 0.4, 1.5, 0.05).name('Auflösung ×')
    .onChange((v) => setResolution(v));
  fPerf.add(s, 'particleRes', { 'Voll': 1, 'Halb (¼ Pixel)': 0.5, 'Viertel (¹⁄₁₆ Pixel)': 0.25 })
    .name('Partikel-Auflösung')
    .onChange((v) => setParticleRes(Number(v)));
  fPerf.add(s, 'shadowFreeze').name('Schatten einfrieren')
    .onChange((v) => setShadowFreeze(v));
  fPerf.add(s, 'compaction').name('GPU-Kompaktierung')
    .onChange((v) => scent.setCompaction(v));
  fPerf.add(s, 'pickupStride', { 'jeden Frame': 1, 'jeden 2. Frame': 2, 'jeden 4. Frame': 4 })
    .name('Duft-Update')
    .onChange((v) => (u.pickupStride.value = Number(v)));
  fPerf.add(s, 'cheapNoise').name('Einfache Turbulenz')
    .onChange((v) => (u.cheapNoise.value = v ? 1 : 0));
  fPerf.add(s, 'cullFar').name('Fern-Culling (>115 m)')
    .onChange((v) => (u.cullDist.value = v ? 115 : 1e6));

  // ------------------------------------------------------------ Szene
  const fScene = gui.addFolder('Szene');

  // Nur-Wind-Modus: Welt + Düfte aus, alle Luftpartikel als neutrale
  // Windpunkte sichtbar. Beim Ausschalten Sichtbarkeiten wiederherstellen.
  function applyWindOnly(v) {
    u.windOnly.value = v ? 1 : 0;
    world.plants.visible = !v && s.showPlants;
    world.grass.visible = !v && s.showGrass;
    world.ground.visible = !v;
    world.markers.visible = !v && s.showMarkers;
  }
  fScene.add(s, 'windOnly').name('Nur Wind zeigen')
    .onChange(applyWindOnly);

  fScene.add(s, 'pause').name('Pause')
    .onChange((v) => (u.timeScale.value = v ? 0 : s.timeScale));
  fScene.add(s, 'timeScale', 0.1, 3, 0.05).name('Zeitraffer ×')
    .onChange((v) => { if (!s.pause) u.timeScale.value = v; });
  fScene.add(s, 'sway', 0, 3, 0.05).name('Gras-Schwanken')
    .onChange((v) => (u.sway.value = v));
  fScene.add(s, 'dark').name('Dunkler Modus')
    .onChange((v) => setDarkMode(v));
  fScene.add(s, 'showPlants').name('Pflanzen zeigen')
    .onChange((v) => (world.plants.visible = v && !s.windOnly));
  fScene.add(s, 'showGrass').name('Gras zeigen')
    .onChange((v) => (world.grass.visible = v && !s.windOnly));
  fScene.add(s, 'showMarkers').name('Duftzonen zeigen')
    .onChange((v) => (world.markers.visible = v && !s.windOnly));
  fScene.add(s, 'showWindArrow').name('Windpfeil zeigen')
    .onChange((v) => (windArrow.visible = v));

  gui.add({ reset: () => gui.reset() }, 'reset').name('Alles zurücksetzen');

  fWind.open();
  fPart.open();
  fScents.open();
  fPerf.open();
  fScene.close();

  return gui;
}

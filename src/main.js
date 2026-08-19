import * as THREE from 'three/webgpu';
import { texture } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import Stats from 'three/addons/libs/stats.module.js';
import { u } from './params.js';
import { buildWorld } from './world.js';
import { ScentField } from './scents.js';
import { createDevTool } from './devtool.js';

const LIGHT_BG = new THREE.Color(0xe9e9e6);
const DARK_BG = new THREE.Color(0x0b0d10);

async function init() {
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  document.getElementById('backend').textContent =
    renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2-Fallback';

  // Beim Verlassen/Neuladen (auch Vite-HMR) das GPU-Device sofort freigeben —
  // sonst leben alte Devices bis zur GC weiter und die FPS sinken nach
  // jedem Save schleichend
  window.addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
  }, { once: true });

  // Display-Frequenz messen (FPS sind vsync-gebunden: 60-Hz-Display ⇒ max 60,
  // 120-Hz-Display ⇒ max 120) und im Badge anzeigen
  (async () => {
    await new Promise((r) => setTimeout(r, 3000));
    const t0 = performance.now();
    let n = 0;
    await new Promise((res) => {
      const tick = () => (++n < 90 ? requestAnimationFrame(tick) : res());
      requestAnimationFrame(tick);
    });
    const hz = Math.round(90000 / (performance.now() - t0));
    document.getElementById('backend').textContent += ` · Display ~${hz} Hz`;
  })();

  // ------------------------------------------------------------ Szene
  const scene = new THREE.Scene();
  scene.background = LIGHT_BG.clone();
  scene.fog = new THREE.Fog(LIGHT_BG.clone(), 30, 110);

  const camera = new THREE.PerspectiveCamera(
    50, window.innerWidth / window.innerHeight, 0.1, 300
  );
  camera.position.set(13, 7.5, 19);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 2;
  controls.maxDistance = 90;

  // ------------------------------------------------------------ Licht
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd8d8d2, 1.1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(18, 28, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // ------------------------------------------------------------ Welt + Düfte
  const world = buildWorld(scene);
  const scent = new ScentField(world.emitters, world.fieldRadius, 2000000, 150000);
  scene.add(scent.object);

  // Windpfeil (zeigt Richtung + Stärke)
  const windArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.15, 0), 2, 0x333333, 0.5, 0.3
  );
  scene.add(windArrow);

  // -------------------------------------------- Performance: Half-Res-Pass
  // Partikel optional in reduzierter Auflösung in ein eigenes Render-Target
  // zeichnen und über das Bild legen — Füllraten-Kosten sinken quadratisch.
  // Damit Pflanzen die Partikel weiter verdecken, schreibt die Welt vorher
  // nur ihre Tiefe ins Target (Proxies teilen sich die Geometrie).
  let particleResScale = 1;
  const particleScene = new THREE.Scene();
  const depthOnlyMat = new THREE.MeshBasicMaterial();
  depthOnlyMat.colorWrite = false;
  const depthProxies = new THREE.Group();
  for (const src of [...world.plants.children, world.ground]) {
    const proxy = new THREE.Mesh(src.geometry, depthOnlyMat);
    proxy.position.copy(src.position);
    proxy.rotation.copy(src.rotation);
    proxy.scale.copy(src.scale);
    proxy.renderOrder = -1;
    proxy.userData.src = src; // Sichtbarkeit folgt dem Original (z. B. "Nur Wind")
    depthProxies.add(proxy);
  }
  particleScene.add(depthProxies);

  const particleRT = new THREE.RenderTarget(1, 1, { depthBuffer: true });
  renderer.setClearColor(0x000000, 0); // RT transparent leeren (Canvas nutzt scene.background)

  const rtTex = texture(particleRT.texture);
  const compositeMat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  compositeMat.colorNode = rtTex.rgb;
  compositeMat.opacityNode = rtTex.a;
  // RT-Inhalt ist durch Blending gegen Transparent-Schwarz premultiplied
  compositeMat.blending = THREE.CustomBlending;
  compositeMat.blendSrc = THREE.OneFactor;
  compositeMat.blendDst = THREE.OneMinusSrcAlphaFactor;
  const compositeQuad = new THREE.QuadMesh(compositeMat);

  function setParticleRes(f) {
    particleResScale = f;
    // Partikel-Gruppe zwischen Haupt- und Partikel-Szene umhängen
    (f === 1 ? scene : particleScene).add(scent.object);
    applySize();
  }

  // ------------------------------------------------------------ Dev-Tool
  let resolutionScale = 1;
  function applySize() {
    const pr = Math.min(window.devicePixelRatio, 2) * resolutionScale;
    renderer.setPixelRatio(pr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    particleRT.setSize(
      Math.max(1, Math.floor(window.innerWidth * pr * particleResScale)),
      Math.max(1, Math.floor(window.innerHeight * pr * particleResScale))
    );
  }
  function setResolution(v) {
    resolutionScale = v;
    applySize();
  }

  // Schatten einfrieren: Szene ist statisch, die Shadow-Map muss nicht
  // jeden Frame neu gerendert werden (nur das Gras-Wiegen friert mit ein)
  function setShadowFreeze(on) {
    sun.shadow.autoUpdate = !on;
    if (on) sun.shadow.needsUpdate = true; // einmal rendern, dann eingefroren
  }
  setShadowFreeze(true);
  applySize();

  function setDarkMode(dark) {
    const bg = dark ? DARK_BG : LIGHT_BG;
    scene.background.copy(bg);
    scene.fog.color.copy(bg);
    hemi.intensity = dark ? 0.35 : 1.1;
    sun.intensity = dark ? 0.8 : 2.2;
    windArrow.setColor(dark ? 0xcccccc : 0x333333);
    document.body.classList.toggle('dark', dark);
  }

  const gui = createDevTool({
    scent, world, scene, windArrow,
    setDarkMode, setResolution, setParticleRes, setShadowFreeze,
  });

  // Debug-Handle für die Konsole
  window.duftwiese = { u, scent, world, scene, camera, gui, setDarkMode, renderer };

  const stats = new Stats();
  document.body.appendChild(stats.dom);

  // ------------------------------------------------------------ Loop
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    applySize();
  });

  const arrowDir = new THREE.Vector3();
  let frame = 0;
  renderer.setAnimationLoop(() => {
    controls.update();

    // Rotierender Frame-Index für "Duft-Update jeden N-ten Frame"
    frame = (frame + 1) % 240;
    u.frameMod.value = frame % u.pickupStride.value;

    const a = u.windDirRad.value;
    windArrow.setDirection(arrowDir.set(Math.cos(a), 0, Math.sin(a)));
    windArrow.setLength(0.8 + u.windSpeed.value * 0.5, 0.5, 0.3);

    if (scent.reseedRequested) {
      renderer.compute(scent.reseedPass);
      scent.reseedRequested = false;
    }
    renderer.compute(scent.update);
    if (scent.compactionEnabled) {
      renderer.compute(scent.compactClear);
      renderer.compute(scent.compact);
      scent.syncDrawCount(renderer);
    }

    if (particleResScale === 1) {
      renderer.render(scene, camera);
    } else {
      // 1) Welt aufs Canvas, 2) Partikel ins kleine RT (mit Welt-Tiefe),
      // 3) RT über das Bild kompositieren
      for (const p of depthProxies.children) {
        const src = p.userData.src;
        p.visible = src.visible && (!src.parent || src.parent.visible);
      }
      renderer.render(scene, camera);
      renderer.setRenderTarget(particleRT);
      renderer.render(particleScene, camera);
      renderer.setRenderTarget(null);
      renderer.autoClear = false;
      compositeQuad.render(renderer);
      renderer.autoClear = true;
    }
    stats.update();
  });
}

init().catch((err) => {
  console.error(err);
  const div = document.createElement('div');
  div.style.cssText =
    'position:fixed;inset:0;display:grid;place-items:center;font-family:monospace;padding:2rem;';
  div.textContent = 'Fehler beim Start: ' + err.message;
  document.body.appendChild(div);
});

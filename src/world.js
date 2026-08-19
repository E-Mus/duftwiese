import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { Fn, positionLocal, instanceIndex, hash, time, vec3, cos, sin } from 'three/tsl';
import { SCENT_TYPES, u } from './params.js';

// Deterministischer Zufall, damit die Wiese bei jedem Reload gleich aussieht
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WHITE = { color: 0xffffff, roughness: 0.95, metalness: 0 };

function flatMat() {
  return new THREE.MeshStandardMaterial({ ...WHITE, flatShading: true });
}
function smoothMat() {
  return new THREE.MeshStandardMaterial(WHITE);
}

function scentIndex(key) {
  return SCENT_TYPES.findIndex((t) => t.key === key);
}

// ---------------------------------------------------------------- Pflanzen

function makeLaubbaum(rng) {
  const g = new THREE.Group();
  const h = 2.4 + rng() * 1.6;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, h, 7), smoothMat());
  trunk.position.y = h / 2;
  g.add(trunk);

  const canopyY = h + 0.4;
  const blobs = 3 + Math.floor(rng() * 2);
  const zones = [];
  for (let i = 0; i < blobs; i++) {
    const r = 0.8 + rng() * 0.7;
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), flatMat());
    blob.position.set((rng() - 0.5) * 1.6, canopyY + (rng() - 0.3) * 1.0, (rng() - 0.5) * 1.6);
    blob.rotation.set(rng() * Math.PI, rng() * Math.PI, 0);
    g.add(blob);
    // eine Duftzone pro Kronen-Blob — der ganze Baum duftet
    zones.push({ pos: blob.position.clone(), radius: r * 1.25 });
  }
  return { group: g, zones, type: scentIndex('baum') };
}

function makeKiefer(rng) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 1.2, 6), smoothMat());
  trunk.position.y = 0.6;
  g.add(trunk);

  let y = 1.0;
  let r = 1.0 + rng() * 0.4;
  const zones = [];
  for (let i = 0; i < 3; i++) {
    const ch = 1.2 - i * 0.15;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, ch, 8), flatMat());
    cone.position.y = y + ch / 2;
    g.add(cone);
    // eine Duftzone pro Nadel-Etage
    zones.push({ pos: new THREE.Vector3(0, y + ch / 2, 0), radius: r * 0.95 });
    y += ch * 0.62;
    r *= 0.68;
  }
  return { group: g, zones, type: scentIndex('kiefer') };
}

function makeBlume(rng) {
  const g = new THREE.Group();
  const h = 0.55 + rng() * 0.4;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, h, 5), smoothMat());
  stem.position.y = h / 2;
  g.add(stem);

  const center = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), smoothMat());
  center.position.y = h;
  g.add(center);

  const petals = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 4), flatMat());
    petal.scale.set(1.5, 0.4, 0.8);
    petal.position.set(Math.cos(a) * 0.12, h, Math.sin(a) * 0.12);
    petal.rotation.y = -a;
    g.add(petal);
  }
  return {
    group: g,
    zones: [{ pos: new THREE.Vector3(0, h, 0), radius: 0.5 }],
    type: scentIndex('blume'),
  };
}

function makeLavendel(rng) {
  const g = new THREE.Group();
  const stems = 6 + Math.floor(rng() * 5);
  for (let i = 0; i < stems; i++) {
    const h = 0.45 + rng() * 0.35;
    const a = rng() * Math.PI * 2;
    const d = rng() * 0.22;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, h, 4), smoothMat());
    stem.position.set(x, h / 2, z);
    stem.rotation.z = (rng() - 0.5) * 0.25;
    g.add(stem);

    const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.12, 3, 6), smoothMat());
    tip.position.set(x, h + 0.08, z);
    g.add(tip);
  }
  return {
    group: g,
    zones: [{ pos: new THREE.Vector3(0, 0.7, 0), radius: 0.6 }],
    type: scentIndex('lavendel'),
  };
}

function makeBusch(rng) {
  const g = new THREE.Group();
  const blobs = 2 + Math.floor(rng() * 2);
  const zones = [];
  for (let i = 0; i < blobs; i++) {
    const r = 0.45 + rng() * 0.45;
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), flatMat());
    blob.scale.y = 0.75;
    blob.position.set((rng() - 0.5) * 0.9, r * 0.6, (rng() - 0.5) * 0.9);
    blob.rotation.y = rng() * Math.PI;
    g.add(blob);
    zones.push({ pos: blob.position.clone(), radius: r * 1.15 });
  }
  return { group: g, zones, type: scentIndex('kraut') };
}

// ---------------------------------------------------------------- Gras

function makeGras(count, fieldRadius, rng) {
  const geo = new THREE.ConeGeometry(0.016, 0.3, 4);
  geo.translate(0, 0.15, 0);

  const mat = new THREE.MeshStandardNodeMaterial(WHITE);
  // Sanftes Schwanken im Wind: Auslenkung wächst mit der Halmhöhe,
  // Phase pro Instanz verschoben, Richtung = Windrichtung
  mat.positionNode = Fn(() => {
    const phase = hash(instanceIndex.toFloat()).mul(6.2832);
    const t = time.mul(u.timeScale);
    const amp = positionLocal.y
      .max(0)
      .mul(u.sway)
      .mul(u.windSpeed.mul(0.045).add(0.015));
    const wave = sin(t.mul(2.1).add(phase)).mul(0.5).add(0.8);
    const dir = vec3(cos(u.windDirRad), 0, sin(u.windDirRad));
    return positionLocal.add(dir.mul(amp).mul(wave));
  })();

  const grass = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * fieldRadius;
    p.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    const sc = 0.55 + rng() * 0.8;
    s.set(sc, sc * (0.7 + rng() * 0.8), sc);
    m.compose(p, q, s);
    grass.setMatrixAt(i, m);
  }
  grass.receiveShadow = true;
  return grass;
}

// ---------------------------------------------------------------- Welt

export function buildWorld(scene) {
  const rng = mulberry32(1337);
  const fieldRadius = 28;

  const plants = new THREE.Group();
  const emitters = [];

  // Boden
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(fieldRadius + 14, 64),
    new THREE.MeshStandardMaterial({ ...WHITE, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Platzierung mit Mindestabstand
  const placed = [];
  function place(minR, maxR, clearance) {
    for (let tries = 0; tries < 60; tries++) {
      const a = rng() * Math.PI * 2;
      const d = minR + Math.sqrt(rng()) * (maxR - minR);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.c + clearance)) {
        placed.push({ x, z, c: clearance });
        return { x, z };
      }
    }
    return null;
  }

  const flatGeoms = [];
  const smoothGeoms = [];

  const spawnList = [
    { make: makeLaubbaum, count: 6,  minR: 9,  maxR: 26, clearance: 3.2 },
    { make: makeKiefer,   count: 5,  minR: 10, maxR: 27, clearance: 2.8 },
    { make: makeBusch,    count: 10, minR: 4,  maxR: 24, clearance: 1.4 },
    { make: makeLavendel, count: 12, minR: 3,  maxR: 20, clearance: 0.9 },
    { make: makeBlume,    count: 26, minR: 2,  maxR: 18, clearance: 0.6 },
  ];

  for (const { make, count, minR, maxR, clearance } of spawnList) {
    for (let i = 0; i < count; i++) {
      const pos = place(minR, maxR, clearance);
      if (!pos) continue;
      const { group, zones, type } = make(rng);
      group.position.set(pos.x, 0, pos.z);
      group.rotation.y = rng() * Math.PI * 2;
      group.updateMatrixWorld(true);
      // Statische weiße Meshes in zwei große Geometrien backen
      // (2 Draw-Calls statt ~500 Einzel-Meshes mit je eigenem Material)
      group.traverse((o) => {
        if (o.isMesh) {
          let g = o.geometry.applyMatrix4(o.matrixWorld);
          if (g.index) g = g.toNonIndexed(); // Merge braucht einheitlich non-indexed
          (o.material.flatShading ? flatGeoms : smoothGeoms).push(g);
        }
      });
      for (const z of zones) {
        emitters.push({
          position: z.pos.clone().applyMatrix4(group.matrixWorld),
          radius: z.radius,
          type,
        });
      }
    }
  }
  for (const [geoms, material] of [
    [flatGeoms, flatMat()],
    [smoothGeoms, smoothMat()],
  ]) {
    if (!geoms.length) continue;
    const merged = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(geoms), material);
    merged.castShadow = true;
    merged.receiveShadow = true;
    plants.add(merged);
    for (const g of geoms) g.dispose();
  }
  scene.add(plants);

  const grass = makeGras(6000, fieldRadius, rng);
  scene.add(grass);

  // Debug-Marker: Duftzonen als farbige Drahtgitter-Kugeln (Dev-Tool)
  const markers = new THREE.Group();
  markers.visible = false;
  const markerGeo = new THREE.SphereGeometry(1, 12, 8);
  for (const e of emitters) {
    const marker = new THREE.Mesh(
      markerGeo,
      new THREE.MeshBasicMaterial({
        color: SCENT_TYPES[e.type].color,
        wireframe: true,
        transparent: true,
        opacity: 0.35,
      })
    );
    marker.position.copy(e.position);
    marker.scale.setScalar(e.radius);
    markers.add(marker);
  }
  scene.add(markers);

  return { plants, grass, ground, markers, emitters, fieldRadius };
}

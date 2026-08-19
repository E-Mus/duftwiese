import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, instanceIndex, instancedArray, uniform, hash, time, deltaTime,
  float, vec3, vec4, uv, cos, sin, exp, sqrt, mix, smoothstep, step,
  varying, atomicAdd, atomicStore, cameraPosition,
  mx_noise_vec3, mx_noise_float,
} from 'three/tsl';
import { SCENT_TYPES, u } from './params.js';

// Die Luft über der Wiese ist überall voller Partikel — unsichtbar, solange
// sie "nichts riechen". Strömt ein Partikel durch die Duftzone einer Pflanze,
// nimmt es deren Duft auf (Farbe + Sättigung) und trägt ihn mit dem Wind
// davon, während er sich langsam verflüchtigt. Duftzonen liegen über der
// ganzen Pflanze verteilt (z. B. eine pro Kronen-Blob eines Baums).
export class ScentField {
  constructor(zones, fieldRadius, maxCount = 1000000, initialCount = 150000) {
    this.maxCount = maxCount;
    const bound = fieldRadius + 8;

    // Aktive Partikelzahl: steuert Darstellung UND Simulation (Early-Out im
    // Compute), damit ungenutzte Partikel keine GPU-Zeit kosten
    const active = uniform(Math.min(initialCount, maxCount));
    this._active = active;

    // ---------------------------------------------------- Partikel-Buffer
    const posArr = new Float32Array(maxCount * 3);   // Position
    const scentArr = new Float32Array(maxCount * 4); // Duftfarbe + Sättigung

    for (let i = 0; i < maxCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * bound;
      posArr[i * 3 + 0] = Math.cos(a) * r;
      posArr[i * 3 + 1] =
        Math.pow(Math.random(), u.airGround.value) * u.airHeight.value + 0.03;
      posArr[i * 3 + 2] = Math.sin(a) * r;
    }

    const posBuf = instancedArray(posArr, 'vec3');
    const scentBuf = instancedArray(scentArr, 'vec4');

    // ---------------------------------------------------- Duftzonen-Buffer
    const zoneCount = zones.length;
    const zonePosArr = new Float32Array(zoneCount * 4); // xyz + Radius
    const zoneColArr = new Float32Array(zoneCount * 4); // rgb + Typ-Index
    const c = new THREE.Color();
    zones.forEach((z, i) => {
      c.set(SCENT_TYPES[z.type].color);
      zonePosArr[i * 4 + 0] = z.position.x;
      zonePosArr[i * 4 + 1] = z.position.y;
      zonePosArr[i * 4 + 2] = z.position.z;
      zonePosArr[i * 4 + 3] = z.radius;
      zoneColArr[i * 4 + 0] = c.r;
      zoneColArr[i * 4 + 1] = c.g;
      zoneColArr[i * 4 + 2] = c.b;
      zoneColArr[i * 4 + 3] = z.type;
    });
    const zonePosBuf = instancedArray(zonePosArr, 'vec4');
    const zoneColBuf = instancedArray(zoneColArr, 'vec4');

    // ------------------------------------------- Räumliches Gitter (2D, XZ)
    // Statt dass jedes Partikel alle Zonen prüft, prüft es nur die Zonen
    // seiner Gitterzelle. Zellradius deckt den maximalen Duftzonen-Radius
    // ab (Basisradius × 4 = Maximum des "Duftzonen-Radius ×"-Reglers).
    const CELL = 4;
    const HALF = Math.ceil((bound + 8) / CELL);
    const GRID_W = HALF * 2;
    const GRID_OFF = HALF * CELL;
    const CAP = 32; // max. Zonen pro Zelle
    const cellCountArr = new Float32Array(GRID_W * GRID_W);
    const cellListArr = new Float32Array(GRID_W * GRID_W * CAP);
    let overflow = 0;
    zones.forEach((z, zi) => {
      const rMax = z.radius * 4 + 0.5;
      const x0 = Math.max(0, Math.floor((z.position.x - rMax + GRID_OFF) / CELL));
      const x1 = Math.min(GRID_W - 1, Math.floor((z.position.x + rMax + GRID_OFF) / CELL));
      const z0 = Math.max(0, Math.floor((z.position.z - rMax + GRID_OFF) / CELL));
      const z1 = Math.min(GRID_W - 1, Math.floor((z.position.z + rMax + GRID_OFF) / CELL));
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          // Kreis-Zellen-Überlappung statt nur Bounding-Box
          const nx = Math.max(cx * CELL - GRID_OFF, Math.min(z.position.x, (cx + 1) * CELL - GRID_OFF));
          const nz = Math.max(cz * CELL - GRID_OFF, Math.min(z.position.z, (cz + 1) * CELL - GRID_OFF));
          if ((nx - z.position.x) ** 2 + (nz - z.position.z) ** 2 > rMax * rMax) continue;
          const idx = cz * GRID_W + cx;
          const n = cellCountArr[idx];
          if (n < CAP) {
            cellListArr[idx * CAP + n] = zi;
            cellCountArr[idx] = n + 1;
          } else {
            overflow++;
          }
        }
      }
    });
    if (overflow > 0) {
      console.warn(`ScentField: ${overflow} Zonen-Zell-Einträge über CAP=${CAP} verworfen`);
    }
    const cellCountBuf = instancedArray(cellCountArr, 'float');
    const cellListBuf = instancedArray(cellListArr, 'float');

    // ---------------------------------------------------------- Compute
    this.update = Fn(() => {
      If(instanceIndex.toFloat().greaterThanEqual(active), () => {
        // Partikel oberhalb der eingestellten Anzahl: nichts simulieren
      }).Else(() => {
      const pos = posBuf.element(instanceIndex);
      const scent = scentBuf.element(instanceIndex);
      const dt = deltaTime.min(0.05).mul(u.timeScale);
      const sd = instanceIndex.toFloat();

      // --- Advektion: Wind + Böen + Turbulenz + individuelle Drift
      const gust = mx_noise_float(vec3(time.mul(u.gustFreq), 7.31, 1.17))
        .mul(u.gust).add(1).max(0);
      const wind = vec3(cos(u.windDirRad), 0, sin(u.windDirRad))
        .mul(u.windSpeed.mul(gust));
      // Turbulenz: volles 3D-Perlin-Feld oder billige 1-Kanal-Variante
      // (Wirbelwinkel aus einem Noise statt drei — ~3× weniger Compute)
      const turb = vec3(0).toVar();
      If(u.cheapNoise.greaterThan(0.5), () => {
        const swirl = mx_noise_float(
          pos.mul(u.noiseScale).add(vec3(0, 0, time.mul(u.noiseSpeed)))
        ).mul(6.2832);
        turb.assign(
          vec3(cos(swirl), sin(swirl.mul(1.7)).mul(0.35), sin(swirl)).mul(u.turbulence)
        );
      }).Else(() => {
        turb.assign(mx_noise_vec3(
          pos.mul(u.noiseScale).add(vec3(0, time.mul(u.noiseSpeed).negate(), time.mul(u.noiseSpeed.mul(0.6))))
        ).mul(u.turbulence));
      });
      const drift = vec3(
        hash(sd.add(3.13)), hash(sd.add(5.29)).mul(0.5), hash(sd.add(9.71))
      ).sub(vec3(0.5, 0.25, 0.5)).mul(u.spread);

      pos.addAssign(wind.add(turb).add(drift).add(vec3(0, u.rise, 0)).mul(dt));
      pos.y.assign(pos.y.max(0.03));

      // --- Verlässt ein Partikel das Feld, kommt frische (geruchlose) Luft nach
      If(pos.xz.length().greaterThan(bound).or(pos.y.greaterThan(u.airHeight.add(3))), () => {
        const h1 = hash(sd.add(time));
        const h2 = hash(sd.add(time).add(17.17));
        const h3 = hash(sd.add(time).add(43.7));
        const ang = h1.mul(6.2832);
        const rad = sqrt(h2).mul(bound);
        pos.assign(vec3(
          cos(ang).mul(rad),
          h3.pow(u.airGround).mul(u.airHeight).add(0.03),
          sin(ang).mul(rad)
        ));
        scent.w.assign(0);
      });

      // --- Verflüchtigung läuft jeden Frame
      const decayed = scent.w.mul(exp(dt.negate().div(u.evaporate)));

      // --- Duftaufnahme ggf. nur jeden N-ten Frame (rotierend über die
      // Partikel, Aufnahme wird mit N multipliziert — integriert gleich)
      const myTurn = sd.mod(u.pickupStride).round()
        .equal(u.frameMod.round());
      If(myTurn, () => {
        // Nur die Zonen der eigenen Gitterzelle abtasten
        const cx = pos.x.add(GRID_OFF).div(CELL).floor().clamp(0, GRID_W - 1);
        const cz = pos.z.add(GRID_OFF).div(CELL).floor().clamp(0, GRID_W - 1);
        const cellIdx = cz.mul(GRID_W).add(cx).toInt();
        const zonesInCell = cellCountBuf.element(cellIdx).toInt();

        const sumInfl = float(0).toVar();
        const sumCol = vec3(0).toVar();
        Loop({ start: 0, end: zonesInCell, type: 'int' }, ({ i }) => {
          const zi = cellListBuf.element(cellIdx.mul(CAP).add(i)).toInt();
          const zp = zonePosBuf.element(zi);
          const zc = zoneColBuf.element(zi);
          const r = zp.w.mul(u.spawnRadius);
          const infl = smoothstep(r, r.mul(0.15), pos.distance(zp.xyz))
            .mul(u.typeIntensity.element(zc.w.toInt()));
          sumInfl.addAssign(infl);
          sumCol.addAssign(zc.xyz.mul(infl));
        });

        // Duft mischt sich ein
        const pick = sumInfl.mul(u.pickup).mul(dt).mul(u.pickupStride);
        const total = decayed.add(pick);
        const newCol = scent.xyz.mul(decayed)
          .add(sumCol.mul(u.pickup).mul(dt).mul(u.pickupStride))
          .div(total.max(1e-5));
        scent.assign(vec4(newCol, total.min(1)));
      }).Else(() => {
        scent.w.assign(decayed);
      });
      });
    })().compute(maxCount);

    // ----------------------------------------------- Neuverteilung (Reseed)
    // Verteilt alle Partikel sofort gemäß airHeight/airGround neu — für die
    // Höhen-Regler, damit die Änderung nicht erst nach Minuten durchsickert
    this._reseedSeed = uniform(0);
    this.reseedPass = Fn(() => {
      const pos = posBuf.element(instanceIndex);
      const scent = scentBuf.element(instanceIndex);
      const sd = instanceIndex.toFloat().add(this._reseedSeed);
      const h1 = hash(sd.add(1.71));
      const h2 = hash(sd.add(23.19));
      const h3 = hash(sd.add(57.31));
      const ang = h1.mul(6.2832);
      const rad = sqrt(h2).mul(bound);
      pos.assign(vec3(
        cos(ang).mul(rad),
        h3.pow(u.airGround).mul(u.airHeight).add(0.03),
        sin(ang).mul(rad)
      ));
      scent.w.assign(0);
    })().compute(maxCount);
    this.reseedRequested = false;

    // ---------------------------------------------------------- Rendering
    const posAttr = posBuf.toAttribute();
    const scentAttr = scentBuf.toAttribute();
    const amount = scentAttr.w.clamp(0, 1);

    const material = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
    });

    material.positionNode = posAttr;

    // Unsichtbare Partikel (kein Duft, Luft nicht sichtbar) auf Größe 0
    // kollabieren — der Rasterizer verwirft sie, statt Millionen
    // vollständig transparenter Sprites zu blenden.
    // Im "Nur Wind"-Modus (windOnly=1) ist jedes Partikel sichtbar.
    const visible = step(0.008, amount.add(u.airOpacity.mul(50)).add(u.windOnly));

    // Winkelgrößen-Deckel: Partikel nah an der Kamera würden riesige
    // Screen-Flächen bedecken (Füllraten-Krater beim Durchfliegen einer
    // Wolke) — Weltgröße auf einen Bruchteil der Distanz begrenzen
    const camDist = posAttr.sub(cameraPosition).length();

    material.scaleNode = u.size
      .mul(amount.mul(0.9).add(0.55)) // beduftete Partikel wirken voller
      .mul(hash(instanceIndex.toFloat()).mul(0.5).add(0.75))
      .mul(mix(float(1), float(0.5), u.windOnly)) // Windpunkte: feiner
      .min(camDist.mul(0.18))
      .mul(step(camDist, u.cullDist)) // Fern-Culling (hinter dem Nebel)
      .mul(visible);

    // Unbeduftete Luft ist neutral hellgrau (nur bei "Luft sichtbar" relevant);
    // im "Nur Wind"-Modus sind alle Partikel neutral grau
    material.colorNode = mix(
      mix(vec3(0.72), scentAttr.xyz, amount.pow(0.35)),
      vec3(0.55),
      u.windOnly
    );

    const d = uv().sub(0.5).length();
    const disc = smoothstep(0.1, 0.5, d).oneMinus();
    material.opacityNode = disc
      .mul(mix(
        u.airOpacity.add(amount.pow(1.3).mul(u.intensity)),
        float(0.25),
        u.windOnly
      ))
      .min(1);

    this.material = material;

    const sprite = new THREE.Sprite(material);
    sprite.count = Math.min(initialCount, maxCount);
    sprite.frustumCulled = false;
    sprite.renderOrder = 10;
    this.sprite = sprite;

    // ------------------------------------------- GPU-Kompaktierung (optional)
    // Statt alle aktiven Partikel zu zeichnen (unsichtbare kollabieren auf
    // Größe 0, kosten aber Vertex-Arbeit), sammelt ein Compute-Pass per
    // Atomics nur die Indices der sichtbaren Partikel in einen kompakten
    // Buffer; gezeichnet wird dann nur diese Liste. Die Anzahl wird
    // asynchron zurückgelesen (1–2 Frames Latenz, visuell egal).
    const counterRaw = instancedArray(new Uint32Array(1), 'uint');
    const counter = counterRaw.toAtomic();
    const visIdxBuf = instancedArray(maxCount, 'uint');
    this._counterAttr = counterRaw.value;

    this.compactClear = Fn(() => {
      atomicStore(counter.element(0), 0);
    })().compute(1);

    this.compact = Fn(() => {
      If(instanceIndex.toFloat().lessThan(active), () => {
        const a = scentBuf.element(instanceIndex).w;
        If(a.add(u.airOpacity.mul(50)).add(u.windOnly).greaterThan(0.008), () => {
          const slot = atomicAdd(counter.element(0), 1);
          visIdxBuf.element(slot).assign(instanceIndex);
        });
      });
    })().compute(maxCount);

    const cMat = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
    });
    const pIdx = visIdxBuf.element(instanceIndex);
    const cPos = varying(posBuf.element(pIdx));
    const cScent = varying(scentBuf.element(pIdx));
    const cRnd = varying(hash(pIdx.toFloat()));
    const cAmount = cScent.w.clamp(0, 1);

    cMat.positionNode = cPos;
    const cDist = cPos.sub(cameraPosition).length();
    cMat.scaleNode = u.size
      .mul(cAmount.mul(0.9).add(0.55))
      .mul(cRnd.mul(0.5).add(0.75))
      .mul(mix(float(1), float(0.5), u.windOnly))
      .min(cDist.mul(0.18))
      .mul(step(cDist, u.cullDist));
    cMat.colorNode = mix(
      mix(vec3(0.72), cScent.xyz, cAmount.pow(0.35)),
      vec3(0.55),
      u.windOnly
    );
    cMat.opacityNode = disc
      .mul(mix(
        u.airOpacity.add(cAmount.pow(1.3).mul(u.intensity)),
        float(0.25),
        u.windOnly
      ))
      .min(1);
    this.compactMaterial = cMat;

    const compactSprite = new THREE.Sprite(cMat);
    compactSprite.count = 1;
    compactSprite.frustumCulled = false;
    compactSprite.renderOrder = 10;
    compactSprite.visible = false;
    this.compactSprite = compactSprite;

    this.compactionEnabled = false;
    this._reading = false;

    this.object = new THREE.Group();
    this.object.add(sprite, compactSprite);
  }

  set count(v) {
    const n = Math.min(Math.round(v), this.maxCount);
    this.sprite.count = n;
    this._active.value = n;
    this.compactSprite.count = Math.min(this.compactSprite.count, Math.max(n, 1));
  }
  get count() { return this._active.value; }

  setAdditive(on) {
    const blending = on ? THREE.AdditiveBlending : THREE.NormalBlending;
    for (const m of [this.material, this.compactMaterial]) {
      m.blending = blending;
      m.needsUpdate = true;
    }
  }

  requestReseed() {
    this._reseedSeed.value = Math.random() * 1000;
    this.reseedRequested = true;
  }

  setCompaction(on) {
    this.compactionEnabled = on;
    this.sprite.visible = !on;
    this.compactSprite.visible = on;
    if (on) this.compactSprite.count = 1; // Readback zieht die echte Zahl nach
  }

  // Sichtbaren-Zähler asynchron von der GPU holen (max. ein Read in flight)
  syncDrawCount(renderer) {
    if (this._reading) return;
    this._reading = true;
    renderer.getArrayBufferAsync(this._counterAttr)
      .then((ab) => {
        const n = new Uint32Array(ab)[0];
        this.compactSprite.count = Math.max(1, Math.min(n, this._active.value));
        this._reading = false;
      })
      .catch((err) => {
        console.warn('Kompaktierung: Readback fehlgeschlagen', err);
        this._reading = false;
        this.setCompaction(false);
      });
  }
}

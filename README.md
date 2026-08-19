# Duftwiese — Chemische Wahrnehmung

Eine Wiese aus rein weißen Pflanzen (Bäume, Kiefern, Büsche, Lavendel, Blumen, Gras).
Sichtbar ist nur die *chemische* Ebene: Die Luft über der Wiese ist überall voller
Partikel — unsichtbar, solange sie nichts riechen. Strömt ein Luftpartikel durch die
Duftzone einer Pflanze (Bäume haben mehrere, über die ganze Krone verteilt), nimmt
es deren Duftfarbe auf und trägt sie mit dem Wind davon, während sich der Duft
langsam verflüchtigt. Wind = Richtung + Böen + Turbulenz + Auftrieb.

## Starten

```bash
npm install
npm run dev
```

Läuft mit Three.js `WebGPURenderer` (fällt automatisch auf WebGL2 zurück, das
Badge unten links zeigt das aktive Backend). Die Partikel werden vollständig
auf der GPU simuliert (TSL-Compute-Shader, bis zu 1 000 000 Partikel; der
Regler steuert Simulation und Darstellung gemeinsam).

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `src/main.js` | Renderer, Kamera, Licht, Loop |
| `src/world.js` | Prozedurale weiße Pflanzen + Duftzonen + Gras (instanziert, schwankt im Wind) |
| `src/scents.js` | GPU-Luftfeld: Advektion durch Wind + Noise, Duftaufnahme in Zonennähe, Verflüchtigung |
| `src/params.js` | Geteilte GPU-Uniforms + Duft-Typen (Farbe pro Pflanze) |
| `src/devtool.js` | lil-gui Dev-Tool |

## Dev-Tool

- **Wind**: Stärke, Richtung, Böen, Turbulenz (Wirbelgröße/-tempo), Auftrieb, Streuung
- **Duft & Luft**: Partikelanzahl, Größe, Deckkraft, Aufnahme-Rate, Verflüchtigung, Duftzonen-Radius, „Luft sichtbar", additives Leuchten
- **Düfte**: Intensität pro Pflanzentyp (Blume, Lavendel, Laubbaum, Kiefer, Kräuterbusch)
- **Szene**: „Nur Wind zeigen" (Welt + Düfte aus, alle Luftpartikel als neutrale Windpunkte), Pause, Zeitraffer, Gras-Schwanken, dunkler Modus, Sichtbarkeiten, Duftzonen-Marker, Windpfeil

In der Browser-Konsole gibt es `window.duftwiese` (Uniforms, Szene, Kamera) zum Experimentieren.

## Performance

Bis zu 2 000 000 Partikel. Immer aktiv:

1. **Sichtbarkeits-Culling**: Geruchlose (unsichtbare) Partikel werden im
   Vertex-Shader auf Größe 0 kollabiert — der Rasterizer verwirft sie, nur
   tatsächlich beduftete Partikel kosten Füllrate.
2. **Räumliches Gitter**: Jedes Partikel prüft nur die Duftzonen seiner
   4-m-Gitterzelle statt aller ~100 Zonen der Wiese.
3. **Early-Out**: Der Partikel-Regler begrenzt Simulation *und* Darstellung —
   ungenutzte Partikel kosten keine GPU-Zeit.
4. **Winkelgrößen-Deckel**: Partikel nah an der Kamera werden auf 18 % ihrer
   Distanz begrenzt — kein Füllraten-Krater beim Durchfliegen von Wolken.

Zuschaltbar im **Performance-Ordner** des Dev-Tools:

- **Auflösung ×**: Render-Auflösung der ganzen Szene (wirkt quadratisch).
- **Partikel-Auflösung** (Voll/Halb/Viertel): Partikel werden in ein
  kleineres Render-Target gezeichnet (Welt-Tiefe als Proxy-Prepass, damit
  Pflanzen weiter verdecken) und über das Bild kompositiert — ¼ bzw. ¹⁄₁₆
  der Füllraten-Kosten, bei weichem Nebel kaum sichtbar.
- **Schatten einfrieren** (Standard: an): Die Szene ist statisch, die
  2048er-Shadow-Map wird nur einmal gerendert statt jeden Frame.
- **GPU-Kompaktierung**: Atomics sammeln die Indices der sichtbaren
  Partikel; gezeichnet wird nur diese Liste (Anzahl per Async-Readback,
  1–2 Frames Latenz). Lohnt, wenn die Vertex-Stufe limitiert.
- **Duft-Update** (jeden/2./4. Frame): Duftaufnahme rotierend über die
  Partikel verteilt, Aufnahme entsprechend kompensiert — Zonen-Checks ÷ N.
- **Einfache Turbulenz**: 1 Noise-Kanal statt 3 (~3× billigeres Windfeld,
  etwas gröbere Wirbel).
- **Fern-Culling** (Standard: an): Partikel jenseits des Nebels (115 m)
  werden nicht gerastert.

Wenn sehr viel Duft gleichzeitig sichtbar ist (hohe Aufnahme-Rate + lange
Verflüchtigung), limitiert die Blending-Füllrate — dann „Auflösung ×" im
Szene-Ordner senken, Partikel kleiner machen oder Deckkraft reduzieren.
Beachte: Die sichtbare Duftmenge wächst nach dem Start bzw. nach
Regler-Änderungen noch ~5× Verflüchtigungszeit weiter, bis Emission und
Verflüchtigung im Gleichgewicht sind — bei „Verflüchtigung 30 s" wird die
Szene also erst nach ~2–3 Minuten „fertig schwer".

Alle statischen Pflanzen sind in 2 gemergte Meshes gebacken (2 Draw-Calls
statt ~500), und beim Verlassen/Neuladen der Seite wird das WebGPU-Device
explizit freigegeben (sonst sinken die FPS im Dev-Betrieb nach jedem
Datei-Save schleichend, weil alte Devices bis zur GC weiterleben).

**FPS-Limit**: Der Loop läuft über `requestAnimationFrame` und ist damit
vsync-gebunden — auf einem 60-Hz-Display sind 60 FPS das Maximum, auf einem
120-Hz-Display (z. B. MacBook ProMotion) läuft er automatisch mit bis zu
120 FPS; es gibt keine künstliche Begrenzung im Code. Das Badge unten links
zeigt die erkannte Display-Frequenz. Wenn dort 60 Hz steht, obwohl das
Display 120 Hz kann: macOS-Stromsparmodus aus, ProMotion aktiv, Browser auf
dem internen Display.

# PDFwerk – PDF-Editor im Browser

**PDFwerk** ist ein freier, quelloffener PDF-Editor (MIT-Lizenz), der komplett im Browser läuft.
Dateien werden **nie hochgeladen** – alles passiert lokal auf deinem Rechner. Die App lässt sich
als statische Seite auf **GitHub Pages** betreiben und funktioniert nach dem ersten Laden auch offline.

> English summary: PDFwerk is a free, MIT-licensed, client-side PDF editor with a desktop-style
> ribbon UI: annotate, highlight, draw (Shift snaps to 0°/45°/90°), sign, stamp, measure, redact,
> fill forms and organise pages – all in the browser, deployable to GitHub Pages. The UI is available
> in German and English (auto-detected).

## Funktionen

**Ansehen & Navigieren**
- Mehrere Dokumente in Tabs, Drag & Drop von Dateien
- Zoom (Strg + Mausrad, Seitenbreite, ganze Seite, 100 %), Ansicht drehen
- Einzelseite, fortlaufend, Doppelseite
- Seitenminiaturen, Lesezeichen (anzeigen **und bearbeiten**), Volltextsuche mit Treffer-Hervorhebung
- Links und Formularfelder (Ausfüllen wird beim Speichern übernommen)
- Helles und dunkles Design

**Kommentieren** – als echte PDF-Anmerkungen mit Erscheinungsbild gespeichert (also auch in
Acrobat, Firefox, Chrome usw. sichtbar) und beim erneuten Öffnen wieder bearbeitbar
- Schreibmaschine, Textfeld, Legende (Callout), Notiz mit Antworten
- Hervorheben, Unterstreichen, Durchstreichen, Wellenlinie (über Textauswahl oder Bereich)
- Rechteck, Ellipse, Linie, Pfeil, Polylinie, Polygon, Wolke, Freihand, Radierer
- Stempel (vordefiniert, eigener Text, optional mit Name/Datum), Bilder, Unterschriften (zeichnen, tippen, Bild)
- Messen: Abstand, Umfang, Fläche mit Maßstab und Einheit
- Eigenschaften-Leiste: Farbe, Füllung, Deckkraft, Linienstärke/-stil, Pfeilenden, Schrift, Ausrichtung …
- Auswählen, Verschieben, Größe ändern, Punkte bearbeiten, Kopieren/Einfügen, Duplizieren, Ebenen, Sperren
- Kommentarliste mit Filter, Anmerkungen abflachen oder alle löschen
- Text und Bilder direkt aus der Zwischenablage einfügen (Strg+V)

**Seiten organisieren**
- Drehen, Löschen, Einfügen (leer oder aus anderen PDFs), Extrahieren, Duplizieren, Verschieben, Umkehren
- Umsortieren per Drag & Drop in den Miniaturen, PDFs auf die Miniaturen ziehen zum Einfügen
- Dokument teilen (ZIP), Dateien anhängen/zusammenführen
- Zuschneiden, Wasserzeichen, Kopf-/Fußzeile und Seitenzahlen

**Schützen & Exportieren**
- Echte Schwärzung: markierte Bereiche werden eingebrannt, darunterliegender Inhalt wird entfernt
- Metadaten bearbeiten/entfernen, abgeflachte Kopie speichern
- Drucken, Seiten als PNG/JPEG exportieren, PDF aus Bildern erstellen
- Speichern direkt in die Originaldatei (Chrome/Edge, File System Access API), sonst Download

Unbegrenztes Rückgängig/Wiederholen gilt für Anmerkungen **und** Seitenoperationen.

## Tastenkürzel (Auswahl)

| Taste | Funktion |
|---|---|
| **Shift** beim Zeichnen | Linien, Pfeile, Polygon-Segmente, Messungen rasten in 45°-Schritten ein (0°/45°/90° …); Rechteck/Ellipse → Quadrat/Kreis; Freihand → gerade Linie |
| **Shift** beim Verschieben / Skalieren | nur waagrecht/senkrecht bzw. Seitenverhältnis beibehalten |
| **Alt** beim Aufziehen | Rechteck/Ellipse vom Mittelpunkt aus |
| **Strg** + Ziehen | Anmerkung duplizieren |
| **Leertaste** halten | vorübergehend Hand-Werkzeug |
| H · V · S | Hand · Anmerkungen auswählen · Text auswählen |
| T · B · K · N | Schreibmaschine · Textfeld · Legende · Notiz |
| M · U · D · W | Hervorheben · Unterstreichen · Durchstreichen · Wellenlinie |
| R · E · L · A · P · G · C · F · X | Rechteck · Ellipse · Linie · Pfeil · Polylinie · Polygon · Wolke · Freihand · Radierer |
| J · I · Q | Stempel · Bild · Unterschrift |
| Strg+O / Strg+S / Strg+Shift+S / Strg+P | Öffnen / Speichern / Speichern unter / Drucken |
| Strg+Z / Strg+Y | Rückgängig / Wiederholen |
| Strg+C / X / V, Entf | Kopieren / Ausschneiden / Einfügen, Löschen |
| Pfeiltasten (+Shift) | Auswahl um 1 pt (10 pt) verschieben |
| Strg+0 / 1 / 2 | Ganze Seite / 100 % / Seitenbreite |
| Strg+Plus / Minus | Zoomen |
| Strg+Shift+Plus / Minus | Ansicht drehen |
| Strg+F, F3 / Shift+F3 | Suchen, nächster/vorheriger Treffer |
| Strg+G | Gehe zu Seite |
| Strg+Shift+R / L | Seiten rechts/links drehen |
| Strg+Shift+D / I / E | Seiten löschen / einfügen / extrahieren |
| Strg+B | Lesezeichen hinzufügen |
| F1 | Alle Tastenkürzel anzeigen |

## Entwicklung

Voraussetzung: Node.js 18 oder neuer.

```bash
npm install
npm run dev      # Entwicklungsserver auf http://localhost:5173
npm run build    # Produktions-Build nach dist/
npm run preview  # Build lokal ansehen
```

## Auf GitHub Pages veröffentlichen

1. Repository auf GitHub anlegen und den Code auf den Branch `main` pushen.
2. In den Repository-Einstellungen unter **Settings → Pages → Build and deployment** als Quelle
   **GitHub Actions** wählen.
3. Der Workflow `.github/workflows/deploy.yml` baut die App bei jedem Push auf `main` und
   veröffentlicht sie unter `https://<benutzer>.github.io/<repository>/`.

Der Build verwendet relative Pfade (`base: './'`) und funktioniert daher unter jedem Repository-Namen.

## Aufbau

```
src/
  core/        Dokumentmodell, PDF lesen/schreiben (pdf-lib), Seitenoperationen, Geometrie, Schriften
  viewer/      Dokumentansicht, Seitendarstellung (pdf.js), SVG-Ebene für Anmerkungen, Suche
  tools/       Werkzeuge (Auswahl, Zeichnen, Text, Markieren, Stempel …) und Editoren
  ui/          Menüband, Seitenleisten, Eigenschaften, Statusleiste, Dialoge
  commands.js  Alle Befehle und Tastenkürzel
  app.js       Anwendungsrahmen (Tabs, Zwischenablage, Drag & Drop, Design)
```

Jede Anmerkung wird einmal als Zeichenanweisungen beschrieben (`core/appearance.js`). Daraus
entstehen sowohl die SVG-Darstellung im Editor als auch der Appearance-Stream im PDF – Bildschirm und
Datei sehen deshalb identisch aus. Beim Öffnen werden bearbeitbare Anmerkungen aus dem PDF gelesen;
unveränderte Anmerkungen werden beim Speichern unverändert übernommen.

## Grenzen

- Vorhandenen Seitentext direkt bearbeiten (wie in Desktop-Editoren) ist nicht möglich –
  Workaround: weißes Rechteck + Textfeld.
- Verschlüsselte PDFs werden schreibgeschützt geöffnet (Ansehen und Formulare ausfüllen).
- Texte in Anmerkungen nutzen die PDF-Standardschriften (WinAnsi); Zeichen außerhalb davon
  (z. B. Chinesisch) werden im gespeicherten PDF als „?“ dargestellt.
- Kein OCR.

## Lizenz

[MIT](LICENSE). Verwendete Bibliotheken: [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0),
[pdf-lib](https://github.com/Hopding/pdf-lib) (MIT), [Lucide](https://lucide.dev) (ISC).

PDFwerk ist ein unabhängiges Projekt und steht in keiner Verbindung zu Herstellern kommerzieller
PDF-Editoren; genannte Produktnamen sind Marken ihrer jeweiligen Inhaber.

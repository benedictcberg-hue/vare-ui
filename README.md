# VARE · öffentliche Hülle

Stimmmessung im Browser für einen Bariton, der seine eigene Stimme forensisch misst:
aufnehmen, analysieren, lokal aufbewahren, als CSV exportieren. Reine HTML-Seite, kein
Server, kein Build, keine Fremdbibliothek, kein CDN.

**Diese Seite enthält keine Messwerte.** Keine Aufnahme, keine Chronik, keine Marken, keine
Zielwerte. Vor der Verbindung zeigt sie nichts als ein Feld für den Token. Alles Persönliche
kommt zur Laufzeit aus dem privaten Repo `benedictcberg-hue/vare-tools`:

- `korpus.json` — gelesen: die eigenen Marken für ΔF3–4, die Zielschwelle für F3, die Gatterschwellen

```
  Mikrofon (nur gelesen)                Browser
        |                                  |
        v                                  v
  vare-tools (privat)  <---- api.github.com, Token nur im Browser ----
    korpus.json             nur gelesen
    docs/physik.md          bleibt privat, die Seite liest es nie
        |
        v
  vare-ui (diese Seite, GitHub Pages)
        |
        v
  IndexedDB im Browser: Aufnahmen, Chronik, Kalibrierungen — nichts geht zurück
```

Es geht **nichts** an GitHub zurück. Aufnahmen, Chronik, Kalibrierungen und Export liegen
im Browserspeicher dieses Geräts. Der einzige Netzzugriff der Seite ist das Lesen von
`korpus.json`; die Content-Security-Policy erlaubt `connect-src` ausschließlich
`https://api.github.com`.

## Token

Fine-grained Personal Access Token, angelegt unter
<https://github.com/settings/personal-access-tokens/new>:

- Repository access: **nur** `vare-tools` (keine weiteren Repos)
- Permissions → Repository → **Contents: Read-only**
- Sonst nichts. Schreibrechte braucht die Seite nicht.

Das Token bleibt im Browser (localStorage, wenn „merken“ angehakt ist, sonst nur für die
Sitzung) und geht ausschließlich an `api.github.com`.

## Warum dieses Repo öffentlich sein darf

`index.html`, `style.css` und die Rechendateien sind eine leere Hülle. Kein Messwert, keine
Marke, kein Vokalbefund, kein Datum. Auch die Striche auf dem ΔF3–4-Balken stehen nirgends
im Code — sie kommen aus `korpus.json` im privaten Repo.

## Start

**GitHub Pages:** Settings → Pages → Deploy from a branch, **main** / **(root)**.
Adresse: `https://benedictcberg-hue.github.io/vare-ui/`

**Lokal (Windows 10, Edge oder Chrome):** im Ordner `py -m http.server 8000`, dann
<http://localhost:8000>. Nicht per Doppelklick als `file://` öffnen: dort ist das Mikrofon
gesperrt, und ein gemerktes Token wäre für alle lokalen Seiten lesbar.

Die Chronik gehört zur Adresse: unter `localhost:8000` aufgenommene Takes sind unter
`github.io` nicht sichtbar. Übertragung per JSON-Sicherung.

## Was die Seite tut

1. **Vokalgebundene Cluster-Anzeige.** ΔF3–4 wird nur bewertet, solange F1 und F2 im
   nachlaufenden Fenster stehen, F3 und F4 in beiden Sweeps stabil sind und F3 über der
   Zielschwelle liegt. Im Vokalwechsel steht „Übergang“, und es wird nicht gewertet.
   Referenz je Vokalklasse aus der eigenen Chronik, nie über Vokale hinweg verglichen.
2. **Session-Recorder mit Chronik.** Take aufnehmen, Analyse im 10-ms-Raster mit Ordnungs-
   und Fensterlängensweep, Zusammenfassung und Rahmenverlauf und WAV in IndexedDB,
   CSV-Export, JSON-Sicherung und -Import, Neu-Analyse mit neuerem Kern.
3. **Kalibrierpflicht.** 5 s Stille, 3 s /a/, 1 s Ausklang vor dem ersten Take. Rauschboden,
   SNR gesamt und im Band 2,4–3,2 kHz, Ausklangrate, Formant-Fingerabdruck; Warnung, wenn die
   Kette gegenüber der letzten Kalibrierung abgesackt ist.

## Prüfung

```
node test_dsp.js
```

177 Kriterien gegen synthetische Vokale mit bekannter Wahrheit. Exit-Code 1, sobald eines
reißt. **Reißt ein Kriterium, ist das ein Befund, keine Toleranzfrage — melden, nicht die
Schwelle anheben.** Läuft in CI auf `ubuntu-latest` und `windows-latest`.

```
npm install -g playwright && npx playwright install chromium
node pruefung/browser-test.js
```

37 Prüfungen in Chromium: Token-Tor (leere Hülle ohne Token, Meldung bei falschem Token,
Oberfläche erst nach Verbindung), Mikrofon, Kalibrierung, Take gegen bekannte Formanten,
Chronik, CSV, Sicherung, Import, Detailansicht, Neu-Analyse, Bedienelemente ab 46 px.
Die GitHub-API wird nachgestellt — kein Netz, kein echtes Token.

## CSV

Zwei Dialekte, einstellbar unter „Einstellungen“:

- **Standard** (Komma, Dezimalpunkt, ohne BOM) — für pandas und andere Leser. Text steht unverändert da.
- **Excel DE** (Semikolon, Dezimalkomma, mit BOM). Text, der mit `=`, `+`, `-` oder `@` beginnt, auch nach
  Leerzeichen, Tabulator oder Zeilenumbruch, bekommt ein Apostroph vorangestellt (`'=1+1`). Sonst führte
  Excel ihn als Formel aus. Excel zeigt das Apostroph mit an; der Text dahinter ist unverändert. Zahlen
  betrifft das nie: `-99,00` bleibt eine Zahl.

In beiden Dialekten: fehlende Zahlen stehen als Sentinel `-99` (mit den Nachkommastellen der Spalte),
fehlender Text bleibt leer — auch `f0_note`, wenn kein Grundton gemessen ist.

## Dateien

| Datei | Zweck | unter Node testbar |
|---|---|---|
| `dsp.js` | Rechenkern: Resampling je Eingangsrate, Burg-LPC, FFT-Hüllkurve, Gipfelsuche mit Slot-Prüfung, YIN mit angepasstem Fenster, Spektrum, Teilerkontrolle, SHR, SFR, CPP, H1−H2, Rohrlänge, Ausklang, Alternation, Synthese für Prüfsignale | ja |
| `vowel.js` | Vokalklassen (Modell-Zentroide) und Stabilitätsgatter, live nachlaufend und offline zentriert | ja |
| `analysis.js` | Analyse eines ganzen Takes, Aggregation (Quantile Typ 7), Segmente, Referenzen | ja |
| `calibration.js` | Kalibrierablauf auswerten und mit der letzten vergleichen | ja |
| `csv.js` | CSV-Spalten, Rahmen-CSV, JSON-Sicherung | ja |
| `wav.js` | WAV schreiben und lesen (PCM 8/16/24/32, Float32, EXTENSIBLE) | ja |
| `korpus.js` | Lesen von `korpus.json` aus dem privaten Repo, Token-Verwaltung | Browser |
| `storage.js` | IndexedDB: takes, series, audio, calibrations, meta | Browser |
| `recorder.js`, `recorder-worklet.js` | getUserMedia ohne Browserbearbeitung, AudioWorklet, Ringpuffer | Browser |
| `chronik.js` | Liste, Referenzen, Detailansicht mit vier Zeitspuren | Browser |
| `app.js` | Verdrahtung: Anmeldung, Live-Schleife, Kalibrierung, Take, Export, Prüfsignal, Einstellungen | Browser |
| `index.html`, `style.css` | Oberfläche, Forest Green und Gold | – |

## Was die Anzeige verspricht

- Ein instabiler Formant (Streuung über Ordnungen oder Fensterlängen über der Grenze) steht
  gestrichelt in Rost, bekommt keine Klammer und keine Wertung.
- Fehlt eine Resonanz, ist die Nummerierung oberhalb der Lücke unsicher. Dann steht
  „Zuordnung unsicher, nur N Resonanzen“ — ein anderer Satz als „Streuung“, weil im ersten
  Fall womöglich der falsche Formant gemeint ist.
- Rost heißt „Messwert trägt nicht“. Ein sicher gemessener Befund (F3 unter dem Zielwert,
  SHR über der Warnschwelle) steht in Gold ohne Strich.
- In Pausen frieren alle Werte sichtbar ein; im Export steht −99,00. Ein lauter Ton ohne
  fassbare Periode heißt nicht „Pause“, sondern „kein Periodenbezug“.
- Die Glättung wirkt nur auf die Anzeige, beginnt nach jeder Lücke neu und ist per Regler
  veränderbar. Messwerte werden nie geglättet gespeichert.
- H1−H2 ist bei F1 ≈ F0 filtergetrieben und wird so beschriftet. Bandbreiten unter 40 Hz
  sind laut Physik Artefakt und werden als solche gekennzeichnet.
- CPP auf eigener Skala, nicht Praat-CPPS. Rohrlänge ist eine Modellgröße, keine Messung.
- **Registerwechsel: zwei Spuren.** Die Hauptspur misst F0 auf mindestens 60 ms und verliert
  dadurch Ereignisse unter etwa 90 ms vollständig — ein Oktavsprung von 50 ms ergibt null
  auffällige Rahmen. Eine zweite Spur mit 30-ms-Fenster fängt ihn. Unterschieden wird nach Dauer:
  Kante unter 90 ms (Silbengrenze, Staccato) gegen gehaltenen Wechsel ab 90 ms (Register).
  Portamento und Vibrato lösen nichts aus; geprüft ist das an beidem.
- **Periodenverdopplung wird nicht spektral erkannt.** Geprüft und verworfen: über saubere
  Vokale erreicht das Verhältnis gerade/ungerade Teiltöne +87 dB, bei echter Alternation
  +0,8 dB. Sicher ist nur die Zyklusalternation — die misst dieses Werkzeug nicht und
  verspricht sie auch nicht.
- Adduktion wird nicht geschätzt. Dafür bleibt EGG die einzige Option, und das ist ein Gerät.

## Ausbaustufen (Anschlussstellen vorhanden)

A/B-Vergleich zweier Takes (`chronik.drawLanes` nimmt eine zweite Serie), Rast-Anzeige für
Teiltöne, Periodenverdopplungs-Warner über Zyklusalternation (`recorder.onChunk` liefert
rohes PCM, `alternation` rechnet das Kriterium), WAV-Auswertung per Drag-and-drop
(`wav.decode` plus `analysis.analyseTake` sind quellenunabhängig).

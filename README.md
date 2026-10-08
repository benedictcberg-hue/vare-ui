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

**GitHub Pages:** Settings → Pages → Build and deployment → Source: **GitHub Actions**. Veröffentlicht wird über
`.github/workflows/pages.yml`, und zwar nur, wenn der Prüflauf auf ubuntu-latest und windows-latest grün ist.
Nicht die Quelle „Deploy from a branch“ wählen: Dann veröffentlicht GitHub jeden Push auf main selbst, ohne
Prüflauf, und das Gate in `pages.yml` greift nicht.
Adresse: `https://benedictcberg-hue.github.io/vare-ui/`

**Lokal (Windows 10, Edge oder Chrome):** im Ordner `py -m http.server 8000` (oder `python -m http.server 8000`), dann
<http://localhost:8000>. Nicht per Doppelklick als `file://` öffnen: dort ist das Mikrofon
gesperrt, und ein gemerktes Token wäre für alle lokalen Seiten lesbar.

Die Chronik gehört zur Adresse: unter `localhost:8000` aufgenommene Takes sind unter
`github.io` nicht sichtbar. Übertragung per JSON-Sicherung.

## Was die Seite tut

1. **Vokalgebundene Cluster-Anzeige.** ΔF3–4 wird nur gewertet, solange F1 und F2 im
   nachlaufenden Fenster stehen, der neueste Rahmen selbst noch im Vokal steht, F3 und F4 gültig
   sind (siehe „Was ungültig heißt“) und F3 über dem eingestellten Mindestwert liegt. Im
   Vokalwechsel steht „Übergang“ oder „nicht gewertet“ mit Grund.
   Referenz je Vokalklasse aus der eigenen Chronik, nie über Vokale hinweg verglichen.
2. **Session-Recorder mit Chronik.** Take aufnehmen, Analyse im 10-ms-Raster mit Ordnungs-
   und Fensterlängensweep, Zusammenfassung und Rahmenverlauf und WAV in IndexedDB,
   CSV-Export, JSON-Sicherung und -Import, Neu-Analyse mit neuerem Kern — einzeln oder als
   „Alle neu analysieren“ für jeden Take mit gespeichertem Audio (abbrechbar; Takes ohne Audio werden
   genannt und bleiben „anders gerechnet“). Verglichen und als Referenz genutzt werden nur Takes mit
   gleicher Rechenweise (Kernversion, Zusammenfassung, Gatter, Rahmenabstand, Streuungsgrenze).
   Kein Take geht verloren: Vor der Analyse liegt die Aufnahme mit allen Angaben in IndexedDB. Wird die
   Seite währenddessen neu geladen oder geschlossen, bietet sie die Aufnahme danach unter „Unvollendete
   Analyse“ an (fortsetzen, WAV sichern, verwerfen); während Aufnahme und Analyse fragt der Browser vor
   dem Verlassen nach. Take und Rahmenverlauf (und das WAV) werden in einer Transaktion gespeichert.
3. **Kalibrierpflicht.** 5 s Stille, 3 s /a/, 1 s Ausklang vor dem ersten Take. Rauschboden,
   SNR gesamt und im Band 2,4–3,2 kHz, Ausklangrate, Formant-Fingerabdruck; Warnung, wenn die
   Kette gegenüber der letzten Kalibrierung abgesackt ist.

Die Zahlen und Regeln in diesem README gelten für **Kern 4.1.0** (`dsp.js`, `VERSION`). Wo eine Messung
mit einem früheren Kern entstand, steht es dabei.

## Was „ungültig“ heißt

Ein Formant gilt nur als gültig, wenn alles zutrifft:

- Er steht in mindestens 3 der 4 Analysefenster (0,06 / 0,08 / 0,10 / 0,14 s) und streut über sie
  unter 130 Hz.
- Er steht im Hauptfenster (0,10 s) in mindestens 2 der 3 LPC-Ordnungen (12 / 14 / 16) und streut
  über sie unter 130 Hz.
- Seine Nummer ist eindeutig: Jede zulässige Lesart der Gipfel (eine Resonanz darf fehlen, auch unter
  dem untersten Gipfel; ein Gipfel, den nur eine Ordnung sieht, darf entfallen) nummeriert ihn in
  jedem Fenster gleich, und nichts spricht dafür, dass er oder ein Gipfel darunter zwei Resonanzen
  enthält.
- Er hebt sich aus dem Rauschboden: Oberhalb seines Gipfels fällt die Hüllkurve im Median über
  Fenster und Ordnungen um mindestens 10 dB unter seinen Pegel. Gesucht wird bis 4800 Hz.

ΔF3–4 ist nur gültig, wenn F3 und F4 gültig sind. Ein ungültiger Wert verschwindet nicht: Er steht
gestrichelt in Rost, ohne Klammer und ohne Wertung, und nennt live jeden zutreffenden Grund, im Hover
der Chronik jeden gespeicherten. Die Zahl der Fenster steht je Rahmen im Verlauf (CSV `n_win1…5`); nur ältere
Verläufe ohne sie zeigen „nur in 2 Fenstern“ allein dann, wenn kein anderer Grund zutrifft.

| Grund | heißt |
|---|---|
| Nummer mehrdeutig | Mindestens ein Fenster lässt Lesarten zu, die den Gipfel verschieden nummerieren (etwa F4 oder F5). Der Wert gehört womöglich zu einem anderen Formanten. |
| zwei Resonanzen in einem Gipfel möglich | Ein Gipfel kann zwei verschmolzene Resonanzen enthalten; dann ist jeder Slot darüber verschoben. |
| im Rauschboden | Oberhalb des Gipfels fällt die Hüllkurve um weniger als 10 dB; seine Lage bestimmt dann das Rauschen mit. |
| Streuung über Fenster N Hz, Streuung über Ordnungen N Hz | Die Streuung erreicht die Grenze (Vorgabe 130 Hz, Einstellung „Gültigkeitsgrenze Streuung“). |
| nur in einem Fenster, nur in 2 Fenstern | Zu wenige Fensterlängen sehen ihn. |
| in weniger als 2 Ordnungen | Zu wenige LPC-Ordnungen sehen ihn. |
| Teiltonabstand N Hz zu groß · Teiltonabstand zu groß | Die Teiltöne liegen weiter als 250 Hz auseinander (Grundton, bei unsicherem Grundton sein Doppeltes). Die LPC-Hüllkurve sieht eine Resonanz nur an den Teiltönen; ihr Gipfel sitzt womöglich auf dem nächsten Teilton statt auf der Resonanz. Siehe „Grenze: Formanten in hoher Lage“. |
| Vokalwechsel im Fenster | Die Hüllkurven der beiden Fensterhälften weichen um mehr als 5 dB voneinander ab: Im Fenster wechselt der Vokal, der Wert mischt zwei Vokale. |
| nicht gefunden | Kein Gipfel für diesen Slot. |
| Zuordnung unsicher, Grund nicht gespeichert · Grund nicht gespeichert | Ältere Rahmenverläufe ohne die Gründe; nach „Neu analysieren“ steht der genaue Grund da. |
| Grund unbekannt | Keiner der Gründe trifft zu. Das darf nicht vorkommen und wäre selbst ein Befund. |

„Bandbreite unter 40 Hz“ ist kein Grund: Solche Bandbreiten sind laut Physik ein Artefakt der LPC.
Der Hinweis steht neutral daneben (die Bandbreite geht in H1*−H2* ein), die Frequenz bleibt gültig.

Grundton und SHR folgen derselben Regel:

- **Grundton unsicher.** Der YIN-Wert muss eine Gegenprobe bestehen: die eigene Teiltonreihe und
  das Cepstrum. Fällt er durch und lässt er sich nicht geprüft ersetzen, steht er in Rost mit Grund
  („eigene Teiltonreihe fehlt“, „Cepstrum zeigt … Hz“, „keine Gegenprobe möglich“) und geht in keinen
  Median ein (F0, Note, H1−H2, SFR je Halbton). Ebenso unsicher: ein Mischwert zweier Töne am Tonwechsel
  („Mischwert am Tonwechsel“, mit den Tönen der Teilfenster) und eine teilweise belegte Reihe bei F0/2
  („womöglich eine Oktave tiefer“). Ein geprüft ersetzter Wert ist nicht unsicher: Er steht
  mit dem alten YIN-Wert da, in der F0-Spur in Gold. Die Teilerkontrolle teilt nie unter 60 Hz; eine
  Teiltonreihe darunter heißt „Oktave unsicher“.
- **SHR unsicher.** Das Raster liegt zwischen F0 und 2·F0. Ist es zweifelhaft (Kammkontrast der
  Teiltöne, zweite Anregung im LPC-Restsignal), stehen beide Werte in Rost mit Grund. Die Warnung in
  Gold (über −15 dB) gibt es nur ohne Zweifel. Siehe „Grenze: SHR an Rändern, Tonwechseln und bei Hauch“.
- **SFR und CPP unsicher.** Liegt neben dem Vokal ein hörbarer, nicht periodischer Teil mit mehr Hochton im
  Fenster (Konsonant, starker Hauch), stehen SFR und CPP in Rost mit „Rauschanteil im Fenster“. Ohne diese
  Marke stand ein Frikativ im Median als Stimmklang da. Bei stark behauchter Stimme trägt ein kleiner Teil der
  Rahmen die Marke, ohne dass ein Konsonant da ist.
- **ΔF3–4 und ΔF4–5 nicht messbar** bei einem Teiltonabstand über 250 Hz (Grund „Teiltonabstand zu groß“).

In Zusammenfassung und CSV behält jeder Rahmen Wert und Marke; die Zusammenfassung lässt unsichere
Rahmen aus und nennt ihren Anteil daneben.

## Grenze: ΔF3–4 im Raumrauschen

Bei Raumrauschen ist ΔF3–4 **oft nicht entscheidbar**. Bei 30–50 dB Rauschabstand löst die
LPC-Hüllkurve F5 meist nicht auf. Dann bleiben vier Gipfel, und ob der oberste F4 oder F5 ist,
lässt sich aus der Hüllkurve nicht entscheiden; verschmolzene Gipfel sind schmal, die Bandbreite
trennt die Lesarten also nicht. Der Kern führt F3 und F4 dann als „Nummer mehrdeutig“ und wertet
ΔF3–4 nicht. Das ist gewollt: Ein falscher Wert, der als gültig gilt, wiegt schwerer als ein
fehlender, der als fehlend dasteht.

Gemessen mit Kern 4.0.0 an synthetischen Vokalen /a e i o u/ in Baritonlage, Grundton 98, 147, 196
und 247 Hz, je 0,4 s, Rahmen alle 20 ms, weißes und rosa Rauschen bei 30, 40 und 50 dB Abstand.
„Falsch“ heißt mehr als 120 Hz neben dem bekannten ΔF3–4. Zum Vergleich der frühere Kern 3.0.0, noch
ohne die Lesarten-Prüfung:

| Quelle | Rahmen | ΔF3–4 gültig | davon falsch | Kern 3.0.0: gültig / falsch |
|---|---|---|---|---|
| Impulsfolge, ohne Rauschen | 260 | 260 | 0 | 260 / 0 |
| Impulsfolge, mit Rauschen | 1560 | 55 (3,5 %) | 0 | 599 / 19 |
| Rosenberg-Puls, mit Rauschen | 1560 | 5 (0,3 %) | 0 | 613 / 135 |

- Nach Rauschabstand (Impulsfolge, je 520 Rahmen): 30 dB 0, 40 dB 6, 50 dB 49 gültig; Kern 3.0.0
  218 / 192 / 189, davon 18 / 1 / 0 falsch.
- Mehr Abstand hilft erst weit über einem normalen Raum: Impulsfolge 60 dB 220, 70 dB 323, 80 dB 450
  von 520; Rosenberg-Puls (Glottispuls mit abfallendem Spektrum, einer Stimme ähnlicher) 60 dB 4, 70 dB 19,
  80 dB 177 von 520. Keiner davon falsch.
- Einzelne Formanten, Impulsfolge mit Rauschen: gültig F1 1084, F2 820, F3 72, F4 55, F5 47 von 1560,
  keiner falsch. Kern 3.0.0 hatte 4063 gültige, davon 467 mehr als 130 Hz daneben.

Folge: In einem normalen Raum wertet das Live-Gatter selten. „nicht gewertet: F3/F4 unsicher“ ist
dann die ehrliche Anzeige, kein Defekt. Eine weitere Beweisquelle für F5 gibt es nicht; das ist eine
offene Entwurfsfrage. Echte Aufnahmen sind nicht geprüft — die Zahlen gelten für synthetische
Signale.

## Grenze: Formanten in hoher Lage

Die LPC-Hüllkurve sieht eine Resonanz nur an den Teiltönen. Liegen sie weit auseinander, sitzt der Gipfel
auf dem nächsten Teilton, bis zum halben Teiltonabstand neben der Resonanz. Der Kern rechnet mit dem
Teiltonabstand (Grundton, bei unsicherem Grundton sein Doppeltes; CSV `teilton_hz`):

- **über 250 Hz:** ΔF3–4 und ΔF4–5 sind nie gültig (Grund „Teiltonabstand zu groß“, CSV `d34_grund`,
  `d45_grund`). Ein Formant gilt nur, wenn kein Nachbargipfel näher als das 1,5-Fache des Abstands liegt,
  und ist auch dann meist nur auf etwa ± halben Teiltonabstand bestimmt. Die Zusammenfassung nennt je Formant den
  Anteil solcher Rahmen im Median (CSV `fK_teilton_share`), das Detail steht in Rost daneben.
- **über 375 Hz:** kein Formant ist messbar (alle Slots ungültig). Darüber liegen im Analyseband weniger
  Teiltöne, als die LPC Koeffizienten hat.

Gilt für hohe Töne, Kiekser und Brüche in die obere Lage. Anteile je Take: CSV `teilton_share` (über
250 Hz) und `teilton_hoch_share` (über 375 Hz), im Detail „Hohe Lage“. Offen: Zwischen 250 und 375 Hz lagen
an synthetischen Vokalen rund 1,5 % der gültigen Formanten weiter daneben, bis etwa einen ganzen
Teiltonabstand. Sie sind als gültig markiert; dort hilft nur der Anteil in Rost als Warnung.

## Grenze: SHR an Rändern, Tonwechseln und bei Hauch

Der frühere bekannte Fehler (SHR stieg an harten Ein- und Aussätzen ohne Marke und erschien als sichere
Warnung) ist behoben. SHR gilt jetzt als unsicher, mit Grund in Rost:

- **Ein- oder Aussatz im Fenster:** Die Pegel der 20-ms-Blöcke im längsten Fenster liegen 12 dB oder mehr
  auseinander (CSV `fenster_pegel_db`). Das schlägt auch bei einem raschen Decrescendo an: mehr unsichere
  Rahmen, kein falscher Wert.
- **Tonwechsel im Fenster:** Die Teilfenster gehören nicht zum selben Ton (CSV `fenster_f0_lo_hz`,
  `fenster_f0_hi_hz`). Schritte unter etwa 1,5 HT und Wechsel ganz am Fensterrand erkennt die Probe nicht.
- **Hauch:** SHR liegt über −25 dB, aber weniger als 8 dB über dem Pegel zwischen den Teiltönen (CSV
  `shr_boden_db`). Der Wert bleibt stehen, ist aber nur eine Obergrenze. Eine echte Subharmonische in
  behauchter Stimme lässt sich davon nicht trennen. Bei sehr starkem Hauch ist SHR praktisch nicht messbar.

Einzelne Rahmen mit kurzzeitiger Alternation (Jitter um 1–2 % in tiefer Lage) können SHR bis etwa −20 dB
ohne Marke erreichen. Die Werte stammen aus synthetischen Signalen.

## Tonsprünge: zwei Spuren

Die Hauptspur misst F0 mit YIN (60–500 Hz) auf Fenstern von mindestens 60 ms. Ereignisse unter
etwa 90 ms verliert sie ganz: Ein Oktavsprung von 50 ms ergibt null auffällige Rahmen. Deshalb gibt
es eine zweite, kurze Spur, die **Feinspur** (`dsp.js` `pitchTrackFine`), nur für die Frage „war da
ein Sprung?“, nicht für Formanten:

- Fenster 35 ms, Raster 5 ms, Untergrenze 70 Hz, Suche bis 900 Hz, Tiefpass 1500 Hz vor YIN.
- Die Untergrenze liegt unter dem tiefsten Ton samt Vibrato (75 Hz − 50 Cent). 35 ms lassen dort noch
  1,5 Perioden; 30 ms ergaben bei 75–80 Hz Scheinsprünge, 40 ms dehnten Staccato-Kanten über 90 ms.
  Der Tiefpass hält hohe Formanten aus dem Periodenvergleich; ohne ihn nahm YIN bei hohen Tönen mit
  Vibrato die doppelte Periode.
- Randprüfung: Liegt ein Tonanfang oder -ende im Fenster (eine Fensterhälfte unter 1/10 der Energie
  der anderen), gilt der Rahmen als stimmlos.

Gezählt wird nur Weite und Dauer, ohne Urteil (`dsp.js` `detectJumps`):

- **Tonsprung ≥ 5 HT, gehalten ≥ 90 ms** und **kurze Kante unter 90 ms** (Silbenkante, Staccato,
  Kiekser), gemessen gegen die ruhige Umgebung davor. Ein Bezug gilt erst ab drei übereinstimmenden
  Rahmen.
- Erst eine stimmlose Lücke ab 120 ms trennt Phrasen: Eine neue Phrase nach einer Atempause ist kein
  Sprung, ein Konsonant dazwischen unterbricht nichts.
- Ein gehaltener Tonsprung ist **kein Urteil über das Register.** Auch ein legato gesungener
  Melodiesprung (Quarte bis Oktave) ist einer. Ob ein Registerbruch vorliegt, zeigt erst ein
  Qualitätseinbruch am Übergang; den prüft diese Zählung nicht. Jedes Ereignis trägt dafür Belege
  ohne Wertung (`uebergangMs`, `apSpitze`, `oktave`, in der JSON-Sicherung unter
  `summary.spruenge.liste`). An synthetischen Signalen überlappen diese Belege für legato Sprünge und
  gestörte Übergänge.
- Vibrato und Portamento ab 300 ms lösen nichts aus. Schnelles Gleiten über 80–200 ms zählt
  teilweise als Sprung.
- Die Feinspur prüft die Oktave über die Teiltonreihe. Rahmen am Tonwechsel, die zwischen den Tönen davor und
  danach liegen, gelten als stimmlos. Eine Atempause erkennt die Sprungsuche auch im Nachhall und bei Brumm
  am Pegel gegenüber dem eigenen Ton; ein Fenster mit digitaler Stille (exakte Nullen ab 5 ms) gilt als
  stimmlos.
- **Restkanten:** Einzelne kurze Kanten bleiben, vor allem im Ausklang eines Raums mit langem Nachhall und
  bei Schritten knapp unter 5 HT mit Vibrato. Eine Atempause von nur 0,2 s im stark halligen Raum kann einen
  gehaltenen Scheinsprung ergeben; die Grenze der Pausentiefe hat dort nach beiden Seiten wenig Abstand. Ein
  leiser, gehaltener Oktavbruch am Phrasenende kann als Ausklang entfallen. Die Grenzen sind an
  synthetischen Räumen und Stimmen gemessen.

## Signallücken

Fehlen mitten im Take Abtastwerte — Gerätewechsel unter Windows, USB- oder Bluetooth-Aussetzer,
angehaltener Audiokontext —, stößt das Signal vor und nach der Lücke ohne Pause aneinander. Über einer
Atempause entsteht so ein gehaltener Tonsprung, den niemand gesungen hat. Deshalb:

- **Erkennen** (`recorder-worklet.js`, `recorder.js`): Jedes Stück aus dem AudioWorklet trägt den
  Rahmenzähler des Kontexts und die Uhrzeit im Audiofaden. Springt der Rahmenzähler weiter, als
  Abtastwerte da sind, fehlt Eingang (auf den Abtastwert genau). Läuft die Uhr dem Rahmenzähler um mehr
  als 0,1 s davon und holt nicht wieder auf, stand der Kontext. Kam das erste Stück mehr als 0,3 s nach
  dem Start oder das letzte mehr als 0,3 s vor dem Stopp, fehlt dort Signal. Ein Stück, das nur spät
  kommt, ist keine Lücke; Stücke, die vor dem Stopp abgeschickt, aber noch nicht angekommen sind, gehören
  dazu.
- **Speichern und kennzeichnen:** Der Take wird gespeichert, mit Stelle und Dauer jeder Lücke
  (`signalLuecken`), und steht in Ergebnis, Liste (Marke „Signallücke“), Detail und Hover in Rost. Die
  Sprung-Kachel gilt dann als unsicher: Was in der Lücke gesungen wurde, fehlt.
- **Naht als Pause** (`analysis.js`, auch bei jeder Neu-Analyse): Rahmen, deren längstes Fenster die
  Naht überdeckt, werden nicht gemessen und als Pause geführt (Bit 8192 in `flags` der Rahmen-CSV); kein
  Segment reicht über die Naht, und Feinspur und Sprungsuche laufen je Abschnitt. Stand der Kontext (angehalten,
  Gerätewechsel), kennt der Recorder die Stelle nur auf einige Stücke genau (gemessen in Chromium: der Schnitt lag
  1–2 Stücke später); dann gilt die ganze Spanne von drei Stücken (rund 0,13 s) als Naht.
- **Keine Referenz:** Ein Take mit Lücke zählt nie als Referenz und lässt sich nicht anpinnen; eine
  angepinnte Referenz aus ihm steht verwaist mit Grund da.
- CSV `signal_gap_s`: fehlende Sekunden; 0 = geprüft, keine Lücke; −99 = nicht geprüft (ältere Takes).

## Prüfung

```
node test_dsp.js
```

Erst die eingebauten Kriterien T1–T27 in `test_dsp.js`, danach jedes Modul unter
`pruefung/kriterien/` in alphabetischer Reihenfolge (Format: `pruefung/kriterien/README.md`).
Kriterien gegen synthetische Signale mit bekannter Wahrheit; wie viele, nennt die letzte Zeile des Laufs. Exit-Code 1,
sobald eines reißt. **Reißt ein Kriterium, ist das ein Befund, keine Toleranzfrage — melden, nicht
die Schwelle anheben.** Läuft in CI auf `ubuntu-latest` und `windows-latest` mit Node 22.

Laufzeit unter Linux mit Node 22: rund 9 Minuten, davon `n_kern.js` und `k_kern.js` zusammen knapp sechs. Unter
Windows länger.

| Modul | IDs | prüft | Linux |
|---|---|---|---|
| eingebaut in `test_dsp.js` | T1–T27 | Abnahmetabelle, Sweeps, Gatter, Sprünge, CSV-Grundlagen, Schritt 0 | 10 s |
| `n_kern.js` | A1–A4 | Nachprüfung des Kerns: Feinspur mit Oktavkontrolle, Mischrahmen am Tonwechsel, Atempause im Raum und mit Brumm, digitale Stille; SHR an Rändern, Tonwechseln und bei Hauch; Formanten nach dem Teiltonabstand (hohe Lage), enge Cluster, Vokalwechsel; Grundton bei starkem Hauch (Unterton, Oktave offen); SFR/CPP neben Frikativen | 181 s |
| `k_kern.js` | K1–K4 | Feinspur und Tonsprünge; Nummerierung, Lesarten, Verschmelzung, Rauschboden; Gegenprobe des Grundtons; SHR-Raster | 162 s |
| `v_auswertung.js` | V1–V3 | Live-Gatter im Vokalwechsel und bei Vibrato; Grenzvokal, Referenzen, Pins; lange Takes, „stabil“, Boden ohne Stille | 30 s |
| `u_oberflaeche.js` | U1–U3 | `app.js` in einer nachgebauten Seite: Schritt 0, Löschen, Import, Gerätewechsel, Token, Sicherung, Rost und Gold, Historie | 22 s |
| `i3_gruende.js` | I3 | Grund je Slot in Serie, CSV, Live und Hover; Live-Boden; angenommene Stimmschwelle | 18 s |
| `t1_pruefstaerke.js` | P1 | ob jede Regel für gültig, stimmhaft und stabil wirklich entscheidet (gegen Mutanten) | 10 s |
| `i4_rechenweise.js` | I4 | Kern-Fingerabdruck je Version, „Alle neu analysieren“, Formelschutz, Sicherung Version 3 | 10 s |
| `i2_durchreichen.js` | I2 | Grundton- und SHR-Unsicherheit bis Zusammenfassung, CSV und Anzeige | 8 s |
| `i1_versoehnen.js` | I1 | Nummerierung über alle Fenster an Vokalwechseln | 4 s |
| `t2_pruefstaerke.js` | P2 | jede CSV-Spalte gegen eine eigene Solltabelle, SFR-Normierung, WAV | 4 s |
| `i5_doku.js` | I5 | Browserdateien in ES5, Hilfetext Schritt 0 und dieses README gegen den Code | < 1 s |
| `n_ui.js` | B1–B3 | `app.js` mit dem echten `storage.js` auf nachgebildetem IndexedDB: Take und Verlauf in einer Transaktion, Notiz im Detail während „Alle neu analysieren“, Export/Import im Lauf gesperrt, Meldung bei vollem Speicher, Neuladen während der Analyse; Lückenerkennung in Worklet und Recorder, Naht in der Analyse, Take mit Lücke durch die Seite. B2: Take-Ergebnis wie Detail, Meldung der Neu-Analyse, Take-Codes für pandas, Größe der Sicherung, Pages-Quelle, Note ohne Grundton, Streuungsgrenze, Fensterzahl, H1*−H2*-Bandbreite, stimmlose Rahmen in der CSV. B3 (Prüfstärke): ΔF3–4 nur aus gültigem ΔF3–4 gewertet, Gültigkeit in der Zusammenfassung, H1−H2 filtergetrieben, Rost live und Chronik-Spur, Band „Oktave offen“, Zweideutig-Anteil der Referenzen | 47 s |
| `n_zusammen.js` | C1–C3 | Kern und Oberfläche zusammen: Marken und Grundcodes passen in die Serie (auch NAHT neben neuen Kernmarken), Rahmen an einer Naht in jedem Serienfeld und jeder CSV-Spalte nicht gemessen, Feinspur und Sprungsuche je Abschnitt mit der Sprungerkennung des Kerns; jeder Grund und Beleg des Kerns 4.1 in Serie, Sicherung, Zusammenfassung, CSV, live, Hover, Detail, Liste und Ergebnis; Naht nach stehendem Kontext als Spanne | 21 s |

Jede Änderung am Kern, die einen Rahmenwert ändert, erhöht `VERSION` in `dsp.js` und trägt einen neuen
Fingerabdruck in `i4_rechenweise.js` ein; sonst reißt I4a.

Browser-Prüfung (Playwright mit Chromium):

```
npm install -g playwright
npx playwright install chromium
```

Linux: `NODE_PATH="$(npm root -g)" node pruefung/browser-test.js`
Windows (PowerShell): `$env:NODE_PATH = (npm root -g); node pruefung\browser-test.js`

Chromium kommt aus der Umgebungsvariablen `VARE_CHROMIUM`, sonst aus `/opt/pw-browsers/chromium`, falls
vorhanden, sonst aus der Playwright-Installation. Laufzeit rund 2 Minuten; wie viele Prüfungen, nennt die
letzte Zeile des Laufs. Geprüft: Token-Tor (leere Hülle
ohne Token: keine Marke, kein Stand, keine Notiz des Testkorpus in Quelltext, Text, Eingaben, Speicher oder
Zustand, vor und nach falschem Token, mit Gegenprobe nach der Verbindung; Meldung bei falschem Token,
Oberfläche erst nach Verbindung), Mikrofon über das AudioWorklet, Kalibrierung, Take gegen bekannte
Formanten, Live-Gatter über die ganze Aufnahme (gewertet nur beim wahren ΔF3–4), Chronik, CSV, Sicherung,
Import, Detailansicht mit Hover, Neu-Analyse einzeln und „Alle neu analysieren“, Schritt 0 über
Neuladen und neue Sitzung, „Alles löschen“, Gerätewechsel, Token entfernen, Bedienelemente ab 46 px,
Datenbank Version 1 → 2, Neuladen mitten in der Analyse mit Rückfrage und Fortsetzen, Take ohne
vorgetäuschte Lücke und ein Aussetzer von 1,5 s als Signallücke, schwach belegte Formanten im Take-Ergebnis
und die Meldung der Neu-Analyse nach verstellten Gatter-Reglern.
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

Einlesen mit pandas, ohne dass ein Text still als fehlend gilt:

```python
df = pd.read_csv(datei, keep_default_na=False, na_values=[-99])                        # Standard
df = pd.read_csv(datei, sep=';', decimal=',', keep_default_na=False, na_values=[-99])  # Excel DE
```

`na_values=[-99]` macht jede Sentinel-Zahl zu NaN (in jeder Schreibweise, `-99.00` wie `-99,00`);
`keep_default_na=False` verhindert, dass pandas Texte wie `NA` oder `NULL` als fehlend liest. Take-Codes,
die pandas oder Excel nicht als denselben Text zurückgeben (`NA`, `NULL`, `INF`, `INFINITY`, `TRUE`, `FALSE`,
`WAHR`, `FALSCH`, `NAN`, `NONE`), vergibt die Seite nicht; nach `MZ` folgt `NB`.

`signal_gap_s` (Take): Sekunden, die in der Aufnahme fehlen (siehe „Signallücken“); 0 = geprüft, keine
Lücke; −99 = nicht geprüft. In der Rahmen-CSV markiert Bit 8192 in `flags` einen Rahmen an einer Naht
(nicht gemessen, als Pause geführt).

Stand Kern 4.1.0: 111 Spalten je Take, 88 je Rahmen. Neu mit Kern 4.1.0:

- **Take:** `sfr_unsure_share`, `cpp_unsure_share` (SFR und CPP stehen nur aus Rahmen ohne Rauschanteil im
  Median), `teilton_share`, `teilton_hoch_share` (Teiltonabstand über 250 bzw. 375 Hz) und `f1…f5_teilton_share`
  (Anteil der gültigen Rahmen im Median mit Teiltonabstand über 250 Hz). Ältere Auswertungen: −99.
- **Rahmen:** `slot_grund1…5` auch `teilton` und `wechsel`; `teilton_hz`, `d34_grund`, `d45_grund`
  (`teilton`), `huell_abstand_db` (über 5 dB: Vokalwechsel); `f0_grund` auch `wechsel` und `oktave`;
  `shr_grund` auch `rand`, `wechsel`, `rauschen`, mit den Belegen `shr_boden_db`, `fenster_pegel_db`,
  `fenster_f0_lo_hz`, `fenster_f0_hi_hz`; `sfr_unsure`, `sfr_grund`, `cpp_unsure`, `cpp_grund`
  (`rauschanteil`) mit `fenster_rausch_ap` und `fenster_rausch_hoch_db`. Marken und Gründe in stimmlosen
  Rahmen −99 bzw. leer.

Neu mit Kern 4.0.0:

- **Take:** `f0_unsure_share`, `f0_korrektur_share`, `shr_unsure_share`, `shr_unsure_max_db`,
  `shr_other_max_db`, `voicing_floor_dbfs`. F0, Note, SHR und H1−H2 kommen nur aus sicheren Rahmen; die
  Anteile daneben sagen, wie viele ausgelassen wurden. `floor_dbfs` steht nur für einen gemessenen
  Boden (Kalibrierung oder Stille im Take), sonst −99; die angenommene Stimmschwelle steht dann in
  `voicing_floor_dbfs` und ist kein Messwert.
- **Rahmen:** `slot_grund1…5` (`nummer`, `verschmolzen` oder leer) und `rauschboden1…5` (0/1) neben
  `valid1…5`; `f0_unsure`, `f0_grund`, `f0_korrektur`, `f0_cep`, `f0_yin`, `octave_unter_grenze`;
  `shr_grid_hz`, `shr_other_db`, `shr_unsure`, `shr_grund`, `shr_kamm_db`, `shr_zweitpuls`.
  `valid1…5` = 0 heißt ungültig; den Grund liefern `slot_grund`, `rauschboden` und die Streuungen
  `sdw1…5`, `sdo1…5`; `n_win1…5` sagt, in wie vielen der 4 Analysefenster der Formant stand (unter 3 ungültig;
  −99 in stimmlosen Rahmen und in älteren Verläufen). Die Streuungsgrenze,
  gegen die `sdw` und `sdo` geprüft wurden, steht je Take in `spread_max_hz` (Vorgabe 130 Hz).
- **Stimmlose Rahmen** (Pausen, Rahmen an einer Naht): Der Kern misst dort nichts. Marken und Gründe, die nur für
  einen gemessenen Rahmen etwas sagen (`f0_unsure`, `octave_corrected`, `octave_ambiguous`, `octave_unter_grenze`,
  `h1h2_unsure`, `shr_unsure`, `slot_unsure`, `rauschboden1…5`, `n_win1…5`, `n_peaks`), stehen dort als −99, die
  Gründe (`f0_grund`, `f0_korrektur`, `shr_grund`, `slot_grund1…5`) leer — nie 0, das sich als „sicher“ läse.
  `valid1…5` bleibt 0: „nicht gültig“ stimmt auch ohne Messung.
- **Ältere Rahmenverläufe** ohne diese Felder: Marken und Zahlen −99, Slot-Grund `?`, übrige Gründe
  leer — nie still „sicher“.

## JSON-Sicherung

Version 3: Takes, Referenzen, Kalibrierungen und Einstellungen als JSON; nicht endliche Zahlen ausgeschrieben
(`{"$nf":"NaN"}`). Die Rahmenverläufe stehen exakt als Bytes (Base64, little-endian, `{ $type, n, b64 }`),
also bitgleich mit dem gespeicherten Float32-Wert — die Rahmen-CSV ist nach Sicherung → Import byte-gleich.
Sicherungen der Versionen 1 und 2 (Verläufe auf 0,001 gerundet) bleiben lesbar. Eine ältere Seite lehnt
Version 3 als unbekannt ab, statt sie falsch zu lesen. Unvollendete Analysen (Aufnahmen, deren Auswertung
noch nicht gespeichert ist) gehören nicht zur Sicherung; liegen welche vor, sagt die Seite es nach dem
Sichern.

Eine Sicherung ist höchstens 500 MB groß: Chrome und Edge halten höchstens 2^29 − 24 Zeichen in einem String,
und der Import liest die Datei in einen. Geprüft wird vorher die ganze Datei — Takes, Rahmenverläufe (rund
1,4 MB je Minute Take bei 10 ms Rahmenabstand, doppelt so viel bei 5 ms) und Audio (Base64, 7,7 MB je Minute
16 Bit bei 48 kHz). Passt das Audio nicht mehr, entsteht die Sicherung ohne Audio, und die Seite sagt, wie
viel Platz bliebe; passen schon die Messwerte nicht, entsteht keine Datei, und die Seite sagt es.

## Dateien

| Datei | Zweck | unter Node testbar |
|---|---|---|
| `dsp.js` | Rechenkern: Resampling je Eingangsrate, Burg-LPC, FFT-Hüllkurve, Gipfelsuche mit Lesarten- und Rauschbodenprüfung, YIN mit angepasstem Fenster und Gegenprobe, Feinspur und Sprungerkennung, Spektrum, Teilerkontrolle, SHR mit Rasterwahl, SFR, CPP, H1−H2, Rohrlänge, Ausklang, Alternation, Synthese für Prüfsignale | ja |
| `vowel.js` | Vokalklassen (Modell-Zentroide) und Stabilitätsgatter, live nachlaufend und offline zentriert | ja |
| `analysis.js` | Analyse eines ganzen Takes, Aggregation (Quantile Typ 7), Segmente, Referenzen, Vergleichbarkeit | ja |
| `calibration.js` | Kalibrierablauf auswerten und mit der letzten vergleichen | ja |
| `csv.js` | CSV-Spalten, Rahmen-CSV, JSON-Sicherung | ja |
| `wav.js` | WAV schreiben und lesen (PCM 8/16/24/32, Float32, EXTENSIBLE) | ja |
| `korpus.js` | Lesen von `korpus.json` aus dem privaten Repo, Token-Verwaltung | Browser |
| `storage.js` | IndexedDB (Version 2): takes, series, audio, calibrations, meta, pending; Take und Verlauf in einer Transaktion | Browser |
| `recorder.js`, `recorder-worklet.js` | getUserMedia ohne Browserbearbeitung, AudioWorklet mit Rahmenzähler und Uhrzeit, Ringpuffer, Erkennung von Signallücken | Browser |
| `chronik.js` | Liste, Referenzen, Detailansicht mit vier Zeitspuren, Gründe im Hover | Browser |
| `app.js` | Verdrahtung: Anmeldung, Live-Schleife, Kalibrierung, Take, Export, Prüfsignal, Einstellungen | Browser |
| `index.html`, `style.css` | Oberfläche, Forest Green und Gold | – |
| `test_dsp.js`, `pruefung/kriterien/*.js` | Prüflauf unter Node | – |
| `pruefung/browser-test.js` | Prüfung im Browser | – |

Alle Browserdateien sind ES5 (kein `class`, `let`, `const`, keine Pfeilfunktion); die
Content-Security-Policy verbietet Inline-Skripte und Inline-Styles.

## Was die Anzeige verspricht

- Ein ungültiger Formant steht gestrichelt in Rost, mit Grund, ohne Klammer und ohne Wertung (siehe
  „Was ungültig heißt“). „Nummer mehrdeutig“ ist ein anderer Satz als „Streuung“: Im ersten Fall ist
  womöglich der falsche Formant gemeint.
- Rost heißt „Messwert trägt nicht“. Ein sicher gemessener Befund (F3 unter dem Mindestwert, SHR über
  der Warnschwelle, gehaltene Tonsprünge) steht in Gold ohne Strich, ebenso ein geprüft korrigierter
  Grundton in der F0-Spur. SHR an Ein- und Aussätzen, an Tonwechseln und bei Hauch steht als unsicher in
  Rost, nie als Warnung (siehe „Grenze: SHR an Rändern, Tonwechseln und bei Hauch“).
- In Pausen frieren alle Werte sichtbar ein; im Export steht −99. Ein lauter Ton ohne fassbare Periode
  heißt nicht „Pause“, sondern „kein Periodenbezug“.
- Ohne Kalibrierung und ohne Stille ist der Rauschboden unbekannt. Dann steht „unbekannt ·
  Stimmschwelle angenommen“, nie eine Annahme als Rauschboden.
- Die Glättung wirkt nur auf die Anzeige, beginnt nach jeder Lücke neu und ist per Regler
  veränderbar. Messwerte werden nie geglättet gespeichert.
- H1−H2 ist bei F1 ≈ F0 filtergetrieben und wird so beschriftet. Bandbreiten unter 40 Hz
  sind laut Physik Artefakt und werden als solche gekennzeichnet — am Formanten und bei H1*−H2*, das mit den
  Bandbreiten von F1–F3 rechnet und eine solche auf 40 Hz begrenzt (live, im Hover, im Detail als Anteil, in der
  CSV als `h1h2c_bw_artifact_share`).
- CPP auf eigener Skala, nicht Praat-CPPS. Rohrlänge ist eine Modellgröße, keine Messung.
- Tonsprünge heißen „Tonsprünge ≥ 5 HT, gehalten ≥ 90 ms“ und „kurze Kanten unter 90 ms“, nicht
  „Registerwechsel“ (siehe „Tonsprünge: zwei Spuren“).
- **Periodenverdopplung hat keinen eigenen Warner.** Geprüft und verworfen: über saubere Vokale
  erreicht das Verhältnis gerade/ungerade Teiltöne +87 dB, bei echter Alternation +0,8 dB. SHR wählt
  sein Raster nach Kammkontrast und zweiter Anregung und macht Alternation so als SHR-Wert sichtbar;
  ein Urteil „Periodenverdopplung“ fällt das Werkzeug nicht. Sicher wäre nur die Zyklusalternation —
  die misst dieses Werkzeug nicht und verspricht sie auch nicht.
- Adduktion wird nicht geschätzt. Dafür bleibt EGG die einzige Option, und das ist ein Gerät.
- Ein Take mit Signallücke steht überall in Rost als lückenhaft da und ist keine Referenz (siehe
  „Signallücken“). Meldungen nach dem Take sagen, was gespeichert ist: „NICHT gespeichert“ nur, wenn der
  Take nicht in der Chronik steht; passt nur das WAV nicht mehr, heißt es „gespeichert, das WAV nicht“.

## Ausbaustufen (Anschlussstellen vorhanden)

A/B-Vergleich zweier Takes (`chronik.drawLanes` nimmt eine zweite Serie), Rast-Anzeige für
Teiltöne, Periodenverdopplungs-Warner über Zyklusalternation (`recorder.onChunk` liefert
rohes PCM, `alternation` rechnet das Kriterium), WAV-Auswertung per Drag-and-drop
(`wav.decode` plus `analysis.analyseTake` sind quellenunabhängig).

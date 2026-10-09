/* VARE — CSV-Export und JSON-Sicherung
   Läuft im Browser (window.VARECSV) und unter Node (module.exports). Keine Abhängigkeiten.

   SPALTENFORMAT: Die Spaltenliste TAKE_COLUMNS ist ein abgeleiteter PLATZHALTER, bis das
   Zielformat nachgereicht ist. Sie ist die einzige Stelle, die beim Tausch angefasst werden muss:
   jede Zeile = { key, get(take) → Wert, dec (Nachkommastellen) }. Fehlende Zahlen werden als −99.00
   geschrieben (Sentinel), fehlende Texte leer. Texte mit Trenner, Anführungszeichen oder Zeilenumbruch
   stehen in Anführungszeichen, Anführungszeichen verdoppelt. Excel DE: Formelschutz (DIALECTS). */
(function (root) {
  'use strict';

  var SENTINEL = -99;
  /* formelSchutz: Excel führt eine Zelle als Formel aus, die mit =, +, - oder @ beginnt, auch nach
     Leerzeichen oder Tabulator. Ein Kommentar „=HYPERLINK(…)“ wäre dann Code, „-3 dB gepresst“ eine
     Fehlermeldung statt Notiz. Im Dialekt Excel DE steht vor solchem TEXT ein Apostroph; Excel zeigt es
     mit an, der Text dahinter bleibt unverändert. Zahlen betrifft das nie: −99,00 bleibt eine Zahl.
     Der Standard-Dialekt (pandas) schreibt den Text unverändert — dort ist er Wert, kein Code. */
  /* chronik: der Dialekt des Übergabepakets (Chronik-Standard, vare_standard.py). Fehlende Zahl leer (NULL), nie −99;
     Zahlen mit gespeicherter Genauigkeit (Float32: 9 signifikante Stellen, damit der Wert bitgleich zurückgelesen
     wird), nicht auf die Anzeigestellen gerundet; Wahrheitswerte 0/1. Kein BOM, kein Formelschutz: Leser ist Python. */
  var DIALECTS = {
    standard: { sep: ',', dec: '.', bom: false, formelSchutz: false, name: 'Standard (Komma, Punkt) — pandas' },
    excelde: { sep: ';', dec: ',', bom: true, formelSchutz: true, name: 'Excel DE (Semikolon, Komma, Text gegen Formeln geschützt)' },
    chronik: { sep: ',', dec: '.', bom: false, formelSchutz: false, leer: true, genau: true, name: 'Chronik-Paket (Komma, Punkt, fehlend leer, volle Genauigkeit)' }
  };
  var FORMEL_ANFANG = /^\s*[=+\-@]/;

  function g(path) {                                   // Zugriff 'summary.f0.med'
    var parts = path.split('.');
    return function (t) { var v = t; for (var i = 0; i < parts.length && v != null; i++) v = v[parts[i]]; return v; };
  }
  function stat(prefix, key, dec, share) {
    var cols = [
      { key: prefix + '_med', get: g(key + '.med'), dec: dec },
      { key: prefix + '_q1', get: g(key + '.q1'), dec: dec },
      { key: prefix + '_q3', get: g(key + '.q3'), dec: dec },
      { key: prefix + '_n', get: g(key + '.n'), dec: 0 }
    ];
    if (share) cols.push({ key: prefix + '_valid_share', get: g(key + '.share'), dec: 3 },
      // Anteil der gültigen Rahmen dieses Medians mit Teiltonabstand über 250 Hz (Formant nur auf ± Abstand/2), Kern 4.1
      { key: prefix + '_teilton_share', get: g(key + '.teiltonShare'), dec: 3 });
    return cols;
  }
  /* Zeitbezug: eine Zeile, ein Zeitbezug (Chronik-Standard 9.10.). datetime_iso und time_local nennen den START des
     Takes, wie pause_before_s und warmup_min; das Ende steht eigens in end_iso und end_local. Ältere Takes kennen nur
     createdAt (das Ende): ihr Start ist Ende minus Dauer, auf die Sekunde — kein geratener Wert, eine Rechnung. */
  function startDate(t) {
    if (!t) return null;
    if (t.startedAt) { var d = new Date(t.startedAt); if (!isNaN(d.getTime())) return d; }
    var e = t.createdAt ? new Date(t.createdAt) : null;
    if (!e || isNaN(e.getTime())) return null;
    return (typeof t.durationS === 'number' && isFinite(t.durationS)) ? new Date(e.getTime() - Math.round(t.durationS * 1000)) : e;
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function startIso(t) { var d = startDate(t); return d ? d.toISOString() : null; }
  // Wanduhrzeit zu einem Zeitpunkt: mit dem gespeicherten UTC-Abstand des Takes (unabhängig von der Uhr des Lesers), sonst örtlich.
  function wanduhr(d, t) {
    if (t && typeof t.tzOffsetMin === 'number' && isFinite(t.tzOffsetMin)) { var u = new Date(d.getTime() + t.tzOffsetMin * 60000); return p2(u.getUTCHours()) + ':' + p2(u.getUTCMinutes()); }
    return p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function startLocal(t) {
    if (!t) return null;
    if (t.startedAt) return t.timeLocal || wanduhr(new Date(t.startedAt), t);
    // Älterer Take: timeLocal war das Ende. Ohne Dauer ist der Start nicht zu rechnen, dann bleibt das Ende stehen.
    if (!(typeof t.durationS === 'number' && isFinite(t.durationS))) return t.timeLocal || null;
    var d = startDate(t); return d ? wanduhr(d, t) : null;
  }
  function endIso(t) { return t ? (t.endedAt || t.createdAt || null) : null; }
  function endLocal(t) { if (!t) return null; if (t.timeLocalEnd) return t.timeLocalEnd; if (!t.startedAt && t.timeLocal) return t.timeLocal; var d = t.endedAt || t.createdAt ? new Date(t.endedAt || t.createdAt) : null; return (d && !isNaN(d.getTime())) ? wanduhr(d, t) : null; }
  /* Bearbeitet der Browser das Signal (Echo-, Rausch-, Pegelautomatik)? 1 = mindestens eine an, 0 = alle aus, fehlend =
     nicht bekannt (ältere Takes, Gerät ohne Auskunft). Teil des Kettenprotokolls (These 30). */
  function browserBearbeitung(t) {
    var f = t && t.captureFlags; if (!f) return null;
    var k = ['echoCancellation', 'noiseSuppression', 'autoGainControl'], an = false, bekannt = false;
    for (var i = 0; i < k.length; i++) { if (f[k[i]] === true) an = true; if (typeof f[k[i]] === 'boolean') bekannt = true; }
    return an ? 1 : (bekannt ? 0 : null);
  }
  // Angaben des Formulars (Stichpunkte zum Take): die aktuelle Fassung; ältere Fassungen in angabenVersionen.
  function angabe(feld) { return function (t) { var a = t && t.angaben; return a && a[feld] != null && a[feld] !== '' ? a[feld] : null; }; }
  var TAKE_COLUMNS = [
    { key: 'code', get: g('code') },
    { key: 'take_id', get: g('id') },
    { key: 'label', get: g('label') },
    { key: 'datetime_iso', get: startIso },
    /* Schritt 0 aus dem Manual: ohne Uhrzeit, Position in der Sitzung, Pause davor und
       Einsing-Status sind zwei Takes nicht vergleichbar. datetime_iso ist UTC, time_local ist
       die Wanduhrzeit — beides steht da, damit keins aus dem anderen geraten werden muss. */
    { key: 'time_local', get: startLocal },
    { key: 'tz_offset_min', get: g('tzOffsetMin'), dec: 0 },
    { key: 'session_nr', get: g('sitzung.nr'), dec: 0 },
    { key: 'session_id', get: g('sitzung.id') },
    { key: 'take_in_session', get: g('sitzung.position'), dec: 0 },
    { key: 'pause_before_s', get: g('sitzung.pauseVorherS'), dec: 1 },
    { key: 'pause_same_session', get: g('sitzung.pauseSelbeSitzung'), dec: 0 },
    { key: 'warmup_state', get: g('sitzung.warmup') },
    { key: 'warmup_min', get: g('sitzung.warmupMin'), dec: 0 },
    // Ende des Takes (UTC und Wanduhr); Start steht in datetime_iso/time_local.
    { key: 'end_iso', get: endIso },
    { key: 'end_local', get: endLocal },
    { key: 'duration_s', get: g('durationS'), dec: 2 },
    /* Signallücke: Sekunden, die in der Aufnahme fehlen (Gerätewechsel, Aussetzer). 0 = geprüft, keine;
       −99 = nicht geprüft (ältere Takes). Ein Take mit Lücke ist keine Referenz, seine Nähte gelten als Pause. */
    { key: 'signal_gap_s', get: g('signalLueckeS'), dec: 2 },
    /* Kette je Take (These 30, Hülle-/Kabelbefund vom 6.10.): Kontextrate, Geräterate, Gerät mit Kennung, Bearbeitung durch
       den Browser, Erfassungsweg, WAV-Format. track_sample_rate wurde gespeichert, aber bis Kern 4.1 nicht exportiert. */
    { key: 'sample_rate', get: g('sampleRate'), dec: 0 },
    { key: 'track_sample_rate', get: g('trackSampleRate'), dec: 0 },
    { key: 'device', get: g('deviceLabel') },
    { key: 'device_id', get: g('deviceId') },
    { key: 'browser_processing', get: browserBearbeitung, dec: 0 },
    { key: 'capture', get: g('captureFlags.capture') },
    { key: 'audio_format', get: g('audioFormat') },
    { key: 'kernel_version', get: g('analysis.kernelVersion') },
    /* Gültigkeitsgrenze der Streuung, mit der dieser Take gerechnet wurde (Hz). Ohne sie musste, wer in der Rahmen-CSV
       sdw/sdo gegen den Grund „Streuung“ nachprüft, 130 Hz annehmen; ältere Takes ohne Angabe −99. */
    { key: 'spread_max_hz', get: g('analysis.spreadMaxHz'), dec: 0 },
    { key: 'calibration_id', get: g('calibrationId') },
    { key: 'vowel_intent', get: g('vowelIntent') },
    { key: 'vowel_class', get: g('summary.vowel.dominant') },
    { key: 'vowel_share', get: g('summary.vowel.dominantShare'), dec: 3 },
    { key: 'f0_med_hz', get: g('summary.f0.med'), dec: 1 },
    { key: 'f0_q1_hz', get: g('summary.f0.q1'), dec: 1 },
    { key: 'f0_q3_hz', get: g('summary.f0.q3'), dec: 1 },
    /* Die Note gehört zu einem gemessenen Grundton. Ohne F0 liefert hzToNote '--' — ein Text, wo nichts
       gemessen ist; fehlender Text ist in dieser CSV leer (fehlende Zahl −99). */
    { key: 'f0_note', get: function (t) { var f = t && t.summary && t.summary.f0; return (f && typeof f.med === 'number' && isFinite(f.med) && f.note && f.note !== '--') ? f.note : null; } },
    /* F0-Median, Quartile und Note stammen nur aus Rahmen, deren Grundton die Gegenprobe besteht
       (analysis.js summarise). Wie viele das nicht taten und wie viele korrigiert wurden, steht hier;
       ältere Auswertungen kennen beides nicht (−99). */
    { key: 'f0_unsure_share', get: g('summary.f0UnsureShare'), dec: 3 },
    { key: 'f0_korrektur_share', get: g('summary.f0KorrekturShare'), dec: 3 }
  ]
    .concat(stat('f1', 'summary.F.0', 1, true), stat('f2', 'summary.F.1', 1, true), stat('f3', 'summary.F.2', 1, true), stat('f4', 'summary.F.3', 1, true), stat('f5', 'summary.F.4', 1, true))
    .concat(stat('d34', 'summary.d34', 1))
    .concat([
      { key: 'd34_stable_med', get: g('summary.d34stable.med'), dec: 1 },
      { key: 'd34_stable_n', get: g('summary.d34stable.n'), dec: 0 },
      { key: 'd34_best_sustained', get: g('summary.best.d34'), dec: 1 },
      { key: 'd34_best_vowel', get: g('summary.best.cls') },
      { key: 'f3_stable_med', get: g('summary.f3stable.med'), dec: 1 },
      { key: 'f3_scored_med', get: g('summary.f3scored.med'), dec: 1 }
    ])
    .concat(stat('d45', 'summary.d45', 1))
    .concat([
      { key: 'sfr_med_db', get: g('summary.sfr.med'), dec: 2 },
      { key: 'sfr_q1', get: g('summary.sfr.q1'), dec: 2 },
      { key: 'sfr_q3', get: g('summary.sfr.q3'), dec: 2 },
      /* SFR und CPP nur aus Rahmen ohne Rauschanteil im Fenster (Kern 4.1, sfrUnsure/cppUnsure); wie viele ausgelassen
         sind, steht hier. Ältere Auswertungen kennen die Marke nicht: −99. */
      { key: 'sfr_unsure_share', get: g('summary.sfrUnsureShare'), dec: 3 },
      { key: 'shr_med_db', get: g('summary.shr.med'), dec: 2 },
      { key: 'shr_max_db', get: g('summary.shr.max'), dec: 2 },
      /* shr_med_db und shr_max_db: nur Rahmen ohne shrUnsure. Die übrigen fehlen dort nicht still:
         Anteil, höchster Hauptwert und höchster Wert auf dem anderen Raster. */
      { key: 'shr_unsure_share', get: g('summary.shrUnsureShare'), dec: 3 },
      { key: 'shr_unsure_max_db', get: g('summary.shrUnsureMax'), dec: 2 },
      { key: 'shr_other_max_db', get: g('summary.shrOtherMax'), dec: 2 },
      { key: 'cpp_med_db', get: g('summary.cpp.med'), dec: 2 },
      { key: 'cpp_unsure_share', get: g('summary.cppUnsureShare'), dec: 3 },
      { key: 'h1h2_med_db', get: g('summary.h1h2.med'), dec: 2 },
      { key: 'h1h2c_med_db', get: g('summary.h1h2c.med'), dec: 2 },
      { key: 'h1h2_unsure_share', get: g('summary.h1h2.unsureShare'), dec: 3 },
      // Anteil der Rahmen im H1*−H2*-Median mit einer LPC-Bandbreite unter 40 Hz (auf 40 Hz begrenzt); ältere −99.
      { key: 'h1h2c_bw_artifact_share', get: g('summary.h1h2c.bwArtefaktShare'), dec: 3 },
      { key: 'rms_med_dbfs', get: g('summary.rms.med'), dec: 2 },
      { key: 'rms_max_dbfs', get: g('summary.rms.max'), dec: 2 },
      /* floor_dbfs: nur ein gemessener Boden (Kalibrierung oder Stille im Take), sonst −99 — auch bei älteren
         Takes ohne Stille, die die Annahme noch als floorDb trugen (vor V3: q05 − 12). voicing_floor_dbfs: der
         Boden, gegen den die Stimmhaftigkeit geprüft wurde (Pegel > Boden + 12), gemessen oder angenommen
         (analysis.js voicingFloorDb). Ältere Auswertungen haben das Feld nicht; dort war floorDb genau dieser
         Wert, er steht dann hier. */
      { key: 'floor_dbfs', get: function (t) { var s = t && t.summary; return (!s || s.floorSource === 'unknown') ? null : s.floorDb; }, dec: 2 },
      { key: 'floor_source', get: g('summary.floorSource') },
      { key: 'voicing_floor_dbfs', get: function (t) { var s = t && t.summary; return !s ? null : (s.voicingFloorDb != null ? s.voicingFloorDb : s.floorDb); }, dec: 2 },
      { key: 'snr_db', get: g('summary.snrDb'), dec: 2 },
      { key: 'tube_cm', get: g('summary.tubeCm'), dec: 1 },
      { key: 'tube_q1', get: g('summary.tube.q1'), dec: 1 },
      { key: 'tube_q3', get: g('summary.tube.q3'), dec: 1 },
      { key: 'tube_n', get: g('summary.tube.n'), dec: 0 },
      { key: 'octave_corrected_share', get: g('summary.octaveCorrectedShare'), dec: 3 },
      { key: 'octave_ambiguous_share', get: g('summary.octaveAmbiguousShare'), dec: 3 },
      { key: 'slot_unsure_share', get: g('summary.slotUnsureShare'), dec: 3 },
      /* Anteil der stimmhaften Rahmen mit Teiltonabstand über 250 Hz (ΔF3–4/ΔF4–5 nicht messbar, Formanten nur auf
         ± Abstand/2) und über 375 Hz (kein Formant messbar). Ältere Auswertungen: −99. */
      { key: 'teilton_share', get: g('summary.teiltonShare'), dec: 3 },
      { key: 'teilton_hoch_share', get: g('summary.teiltonHochShare'), dec: 3 },
      { key: 'jumps_held', get: g('summary.spruenge.gehalten'), dec: 0 },
      { key: 'jumps_edge', get: g('summary.spruenge.kante'), dec: 0 },
      { key: 'lambda_held_per_s', get: g('summary.spruenge.lambdaGehalten'), dec: 4 },
      { key: 'lambda_edge_per_s', get: g('summary.spruenge.lambdaKante'), dec: 4 },
      { key: 'voiced_share', get: g('summary.voicedShare'), dec: 3 },
      { key: 'valid_share', get: g('summary.validShare'), dec: 3 },
      { key: 'stable_share', get: g('summary.stableShare'), dec: 3 },
      { key: 'n_frames', get: g('summary.nFrames'), dec: 0 },
      { key: 'comment', get: g('comment') },
      /* Stichpunkte zum Take (Formular, Chronik-Standard 2.2): Haltung, Ort, Kette-Zusatz, Gefühl, manuelle Angaben zu
         Biphonation und Periodenverdopplung (ja/nein/offen), Stand der Angaben und Zahl früherer Fassungen. Nachgetragen
         wird als neue Fassung, nichts wird überschrieben. */
      { key: 'haltung', get: angabe('haltung') },
      { key: 'ort', get: angabe('ort') },
      { key: 'kette_zusatz', get: angabe('kette') },
      { key: 'gefuehl', get: angabe('gefuehl') },
      { key: 'biphonation_manuell', get: angabe('biphonation') },
      { key: 'periodenverdopplung_manuell', get: angabe('periodenverdopplung') },
      { key: 'angaben_stand', get: angabe('zeit') },
      // Zahl der FRÜHEREN Fassungen (0 = nur die aktuelle); ältere Takes ohne Fassungen: fehlend.
      { key: 'angaben_fassungen', get: g('angabenVersionen.length'), dec: 0 }
    ]);

  /* Gründe je Rahmen stehen in der Serie als Codes (analysis.js GRUND, codeAus); hier werden sie wieder
     Text. Die Listen müssen denen in analysis.js gleichen — die Prüfung P2f/P2g setzt jeden Text über
     analysis.js ein und erwartet ihn hier zurück. 255 = Text, den die Analyse nicht kannte: '?'. */
  var GRUND_TEXT = { f0Grund: ['', 'teiltonreihe', 'cepstrum', 'kein cepstrum', 'wechsel', 'oktave'], f0Korrektur: ['', 'teiltonreihe', 'cepstrum'],
    shrGrund: ['kamm', 'zweitpuls', 'grundton', 'rand', 'wechsel', 'rauschen'], d34Grund: ['', 'teilton'], d45Grund: ['', 'teilton'],
    sfrGrund: ['', 'rauschanteil'], cppGrund: ['', 'rauschanteil'] };
  function grundText(feld, code) {
    if (!code) return '';
    if (code === 255) return '?';
    var liste = GRUND_TEXT[feld];
    if (feld !== 'shrGrund') return code < liste.length ? liste[code] : '?';
    if (code >> liste.length) return '?';
    var t = [];
    for (var b = 0; b < liste.length; b++) if (code & (1 << b)) t.push(liste[b]);
    return t.join('+');
  }
  /* Ältere gespeicherte Serien haben die Grundton- und SHR-Felder nicht. Dann ist ein Bit 0 keine
     Aussage („sicher“), sondern unbekannt: −99, und die Gründe bleiben leer. Merkmal ist das Codefeld,
     das mit den Bits zusammen geschrieben wird (f0Grund für den Grundton, shrGrund für SHR). */
  function bitMit(merkmal, bit) { return function (s, i) { return s[merkmal] ? ((s.flags[i] & bit) ? 1 : 0) : null; }; }
  function grundSpalte(feld) { return function (s, i) { return s[feld] ? grundText(feld, s[feld][i]) : null; }; }
  /* Warum ein Formant ungültig ist, je Slot neben valid1…valid5 — als eigene Spalten, nicht als Maske wie
     slot_unsure: Eine Maske verlangt Bitrechnung (12 heißt F3 und F4), und genau dort verrechnet man sich
     beim Nachprüfen. slot_grundK trägt den Text des Kerns (dsp.js slotGrund): 'nummer' (Nummer mehrdeutig),
     'verschmolzen' (zwei Resonanzen in einem Gipfel möglich), seit Kern 4.1 'teilton' (Teiltonabstand zu groß)
     und 'wechsel' (Vokalwechsel im Fenster), leer bei eindeutiger Nummer. Eine ältere Serie kennt nur „unsicher“,
     nicht warum: dann '?', nie still 'nummer'. Serien aus Kern 4.0 (mit slotVerschmolzen, ohne slotTeilton) kannten
     nur 'nummer' und 'verschmolzen'. rauschbodenK ist 0/1 und unabhängig davon (ein Gipfel kann beides sein); ältere
     Serien −99. Streuung über Fenster und Ordnungen steht schon in sdwK und sdoK. */
  function slotGrundAus(s, i, k) {
    var b = 1 << k;
    if (!s.slotUnsure || !(s.slotUnsure[i] & b)) return '';
    if (!s.slotVerschmolzen) return '?';
    if (s.slotVerschmolzen[i] & b) return 'verschmolzen';
    if (s.slotTeilton && (s.slotTeilton[i] & b)) return 'teilton';
    if (s.slotWechsel && (s.slotWechsel[i] & b)) return 'wechsel';
    return 'nummer';
  }
  function slotGrundSpalte(k) { return function (s, i) { return slotGrundAus(s, i, k); }; }
  function maskenSpalte(feld, k) { var b = 1 << k; return function (s, i) { return s[feld] ? ((s[feld][i] & b) ? 1 : 0) : null; }; }
  /* In wie vielen Analysefenstern Formant k+1 stand (analysis.js nWin, je Slot 3 Bit): Grund „nur in 2 Fenstern“ auch
     neben anderen Gründen. In stimmlosen Rahmen ist nichts analysiert, in älteren Serien fehlt das Feld: −99. */
  function fensterSpalte(k) { return function (s, i) { return (s.nWin && (s.flags[i] & 1)) ? (s.nWin[i] >> (3 * k)) & 7 : null; }; }

  /* Marken und Gründe gibt es nur für einen gemessenen, also stimmhaften Rahmen: In einem stimmlosen Rahmen kehrt der
     Kern vorher zurück (dsp.js analyseAt, leere Marken), ebenso an einer Naht. Eine 0 läse sich dort als Aussage —
     f0_unsure 0 als „Grundton sicher“, rauschboden 0 als „über dem Boden“, slot_unsure 0 als „Nummer eindeutig“ —, wo
     nichts gemessen ist. Deshalb stehen diese Spalten in stimmlosen Rahmen wie jeder nicht gemessene Wert: Zahl −99,
     Text leer. valid1…5 bleibt 0: „nicht gültig“ stimmt auch ohne Messung (README: 0 heißt ungültig). */
  function stimmhaft(fn) { return function (s, i, V) { return (s.flags[i] & 1) ? fn(s, i, V) : null; }; }
  function feld(name) { return function (s, i) { return s[name] ? s[name][i] : null; }; }
  // SFR/CPP unsicher steht nur als Code in der Serie (analysis.js FLAG): 1, wenn ein Grund da ist; ohne Codefeld −99.
  function codeBit(name) { return function (s, i) { return s[name] ? (s[name][i] ? 1 : 0) : null; }; }
  function flagBit(bit) { return function (s, i) { return (s.flags[i] & bit) ? 1 : 0; }; }

  // Rahmenweise Spalten: Name → Serienfeld (oder Funktion) und Nachkommastellen.
  var FRAME_COLUMNS = [
    ['t_s', 't', 3], ['voiced', function (s, i) { return (s.flags[i] & 1) ? 1 : 0; }, 0],
    ['gate', function (s, i) { return ['pause', 'uebergang', 'stabil'][s.gate[i]]; }],
    ['vowel', function (s, i, V) { return s.cls[i] >= 0 ? V.CENTROIDS[s.cls[i]].cls : ''; }],
    ['f0_hz', 'f0', 2], ['ap', 'ap', 3], ['rms_dbfs', 'rms', 2],
    ['f1', 'f1', 1], ['f2', 'f2', 1], ['f3', 'f3', 1], ['f4', 'f4', 1], ['f5', 'f5', 1],
    ['valid1', function (s, i) { return (s.valid[i] & 1) ? 1 : 0; }, 0], ['valid2', function (s, i) { return (s.valid[i] & 2) ? 1 : 0; }, 0],
    ['valid3', function (s, i) { return (s.valid[i] & 4) ? 1 : 0; }, 0], ['valid4', function (s, i) { return (s.valid[i] & 8) ? 1 : 0; }, 0],
    ['valid5', function (s, i) { return (s.valid[i] & 16) ? 1 : 0; }, 0],
    ['sdo1', 'sdo1', 1], ['sdo2', 'sdo2', 1], ['sdo3', 'sdo3', 1], ['sdo4', 'sdo4', 1], ['sdo5', 'sdo5', 1],
    ['sdw1', 'sdw1', 1], ['sdw2', 'sdw2', 1], ['sdw3', 'sdw3', 1], ['sdw4', 'sdw4', 1], ['sdw5', 'sdw5', 1],
    ['bw1', 'bw1', 1], ['bw2', 'bw2', 1], ['bw3', 'bw3', 1], ['bw4', 'bw4', 1], ['bw5', 'bw5', 1],
    ['d34', 'd34', 1], ['d45', 'd45', 1], ['score_d34', 'score', 1],
    ['sfr_db', 'sfr', 2], ['sfr_norm_db', 'sfrn', 2], ['shr_db', 'shr', 2], ['cpp_db', 'cpp', 2], ['h1h2_db', 'h1h2', 2], ['h1h2c_db', 'h1h2c', 2],
    ['slot_unsure', stimmhaft(feld('slotUnsure')), 0], ['n_peaks', stimmhaft(feld('nPeaks')), 0],
    ['slot_grund1', stimmhaft(slotGrundSpalte(0))], ['slot_grund2', stimmhaft(slotGrundSpalte(1))], ['slot_grund3', stimmhaft(slotGrundSpalte(2))], ['slot_grund4', stimmhaft(slotGrundSpalte(3))], ['slot_grund5', stimmhaft(slotGrundSpalte(4))],
    ['rauschboden1', stimmhaft(maskenSpalte('rauschBoden', 0)), 0], ['rauschboden2', stimmhaft(maskenSpalte('rauschBoden', 1)), 0], ['rauschboden3', stimmhaft(maskenSpalte('rauschBoden', 2)), 0],
    ['rauschboden4', stimmhaft(maskenSpalte('rauschBoden', 3)), 0], ['rauschboden5', stimmhaft(maskenSpalte('rauschBoden', 4)), 0],
    ['n_win1', fensterSpalte(0), 0], ['n_win2', fensterSpalte(1), 0], ['n_win3', fensterSpalte(2), 0], ['n_win4', fensterSpalte(3), 0], ['n_win5', fensterSpalte(4), 0],
    ['octave_corrected', stimmhaft(flagBit(2)), 0],
    ['octave_ambiguous', stimmhaft(flagBit(128)), 0],
    ['h1h2_unsure', stimmhaft(flagBit(8)), 0],
    // Grundton: Gegenprobe gerissen (gilt für alles aus F0 Abgeleitete), Grund, Korrektur, Cepstrum- und YIN-Wert
    ['f0_unsure', stimmhaft(bitMit('f0Grund', 512)), 0], ['f0_grund', stimmhaft(grundSpalte('f0Grund'))], ['f0_korrektur', stimmhaft(grundSpalte('f0Korrektur'))],
    ['f0_cep', 'f0Cep', 2], ['f0_yin', 'f0Yin', 2], ['octave_unter_grenze', stimmhaft(bitMit('f0Grund', 4096)), 0],
    // SHR: Raster des Hauptwerts, Wert auf dem anderen Raster (nur bei Zweifel), Zweifel und Belege
    ['shr_grid_hz', 'shrGrid', 2], ['shr_other_db', 'shrOther', 2], ['shr_unsure', stimmhaft(bitMit('shrGrund', 2048)), 0], ['shr_grund', stimmhaft(grundSpalte('shrGrund'))],
    ['shr_kamm_db', 'shrKamm', 2], ['shr_zweitpuls', 'shrZweitpuls', 3],
    /* Kern 4.1. Teiltonabstand der Gültigkeitsentscheidung (F0, bei unsicherem Grundton 2·F0); ΔF3–4/ΔF4–5 nicht
       messbar ('teilton'); Hüllkurvenabstand der Fensterhälften (über 5 dB: Vokalwechsel, Slot-Grund 'wechsel'). */
    ['teilton_hz', 'teiltonHz', 2], ['d34_grund', stimmhaft(grundSpalte('d34Grund'))], ['d45_grund', stimmhaft(grundSpalte('d45Grund'))], ['huell_abstand_db', 'huellAbstandDb', 2],
    /* SHR-Belege: Zwischenpegel (shr − shr_boden_db unter 8 dB über −25 dB: 'rauschen'), Pegelspanne der 20-ms-Blöcke
       im längsten Fenster (ab 12 dB: 'rand'), kleinste und größte Tonhöhe der Teilfenster ('wechsel'). */
    ['shr_boden_db', 'shrBoden', 2], ['fenster_pegel_db', 'fensterPegelDb', 2], ['fenster_f0_lo_hz', 'fensterF0Lo', 2], ['fenster_f0_hi_hz', 'fensterF0Hi', 2],
    // SFR und CPP unsicher bei Rauschanteil im Fenster, mit den Belegen: Aperiodizität und Hochtonanstieg der kurzen Teile.
    ['sfr_unsure', stimmhaft(codeBit('sfrGrund')), 0], ['sfr_grund', stimmhaft(grundSpalte('sfrGrund'))],
    ['cpp_unsure', stimmhaft(codeBit('cppGrund')), 0], ['cpp_grund', stimmhaft(grundSpalte('cppGrund'))],
    ['fenster_rausch_ap', 'fensterRauschAp', 3], ['fenster_rausch_hoch_db', 'fensterRauschHochDb', 2],
    ['flags', 'flags', 0]
  ];

  /* Zahl mit gespeicherter Genauigkeit (Dialekt chronik): ganze Zahlen ohne Nachkommastellen; sonst 9 signifikante
     Stellen — genug, dass ein Float32-Wert bitgleich zurückgelesen wird (JSON und Python lesen beides als Zahl). */
  function genau(v) {
    if (v === Math.round(v) && Math.abs(v) < 1e15) return String(v);
    return String(Number(v.toPrecision(9)));
  }
  function fmtNum(v, dec, dialect) {
    if (v == null || (typeof v === 'number' && !isFinite(v))) { if (dialect.leer) return ''; v = SENTINEL; }
    var s = (typeof v === 'number') ? (dialect.genau ? genau(v) : v.toFixed(dec == null ? 2 : dec)) : String(v);
    if (dialect.dec !== '.') s = s.replace('.', dialect.dec);
    return s;
  }
  function fmtCell(v, dec, dialect) {
    if (v == null) return (dec == null) ? '' : fmtNum(v, dec, dialect);   // Textspalte leer, Zahlenspalte Sentinel (chronik: leer)
    if (typeof v === 'number') return fmtNum(v, dec, dialect);
    if (typeof v === 'boolean') return v ? '1' : '0';
    var s = String(v);
    if (dialect.formelSchutz && FORMEL_ANFANG.test(s)) s = "'" + s;
    if (s.indexOf(dialect.sep) >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function takeRow(take, dialect) {
    return TAKE_COLUMNS.map(function (c) { return fmtCell(c.get(take), c.dec, dialect); }).join(dialect.sep);
  }
  function takesToCsv(takes, dialectName) {
    var d = DIALECTS[dialectName] || DIALECTS.standard;
    var lines = [TAKE_COLUMNS.map(function (c) { return c.key; }).join(d.sep)];
    for (var i = 0; i < takes.length; i++) lines.push(takeRow(takes[i], d));
    return (d.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
  }
  /* Spaltennamen im Übergabepaket (Dialekt chronik), Regel aus These 30: gleiche Spalte nur bei gleicher Formel. Was der
     Browser anders rechnet als vare_standard.py, bekommt die Endung _b; was dort gleich heißt und gleich gerechnet ist,
     behält den Namen der Chronik. f0 bleibt f0_b, bis der Abgleich gegen die Praat-Entscheidungen der Chronik gelaufen ist
     (Reihenfolge, Punkt 3). Nicht genannte Spalten behalten ihren Namen. Die Formeln stehen in vare-tools/schema.md. */
  var PAKET_NAMEN = { t_s: 't', f0_hz: 'f0_b', f0_grund: 'f0_grund', f0_korrektur: 'f0_korr', f0_cep: 'f0_cep_b', f0_yin: 'f0_yin_b', rms_dbfs: 'rms',
    f1: 'f1_b', f2: 'f2_b', f3: 'f3_b', f4: 'f4_b', f5: 'f5_b', d34: 'd34_b', d45: 'd45_b', score_d34: 'd34_stable_b',
    sfr_db: 'sfr0_b', sfr_norm_db: 'sfr0_norm_b', shr_db: 'shr_b', shr_grid_hz: 'shr_raster', shr_other_db: 'shr_other_b', shr_zweitpuls: 'zweitpuls',
    cpp_db: 'cpp_b', h1h2_db: 'h1h2_b', h1h2c_db: 'h1h2c_b', h1h2_unsure: 'h1h2_filter' };
  function paketName(key) { return Object.prototype.hasOwnProperty.call(PAKET_NAMEN, key) ? PAKET_NAMEN[key] : key; }
  function framesToCsv(series, dialectName, VOWEL) {
    var d = DIALECTS[dialectName] || DIALECTS.standard;
    var lines = [FRAME_COLUMNS.map(function (c) { return d === DIALECTS.chronik ? paketName(c[0]) : c[0]; }).join(d.sep)];
    for (var i = 0; i < series.t.length; i++) {
      var cells = [];
      for (var c = 0; c < FRAME_COLUMNS.length; c++) {
        // Fehlt ein Feld (ältere Serie), ist der Wert unbekannt: −99, nicht Absturz und nicht 0.
        var col = FRAME_COLUMNS[c], v = (typeof col[1] === 'function') ? col[1](series, i, VOWEL) : (series[col[1]] ? series[col[1]][i] : null);
        cells.push(fmtCell(v, col[2], d));
      }
      lines.push(cells.join(d.sep));
    }
    return (d.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
  }

  /* ---------- Übergabepaket je Take (Chronik-Standard 2.6) ----------
     <id>.take.json (Metadaten, Formular, Kette, Kalibrier-ID, Kennwerte, Kernversion), <id>.frames.csv (Dialekt chronik),
     <id>.ereignisse.csv (Sprünge aus detectJumps). Fehlend = null bzw. leer, nie −99. Gelesen von vare_import_ui.py. */

  /* Take-ID nach Chronik-Schema JJJJMMTT-hhmm-kurztitel aus der STARTZEIT (Wanduhr). Der Code A…Z bleibt Zweitschlüssel.
     Dateinamen = ID. kurztitel: Kleinbuchstaben a–z und Ziffern, Umlaute aufgelöst, alles andere wird Bindestrich, höchstens
     24 Zeichen; ohne Titel „ohne-titel“. vergeben: Liste oder Prüffunktion schon vergebener IDs — dann -2, -3, … */
  function kurztitel(label) {
    var s = String(label == null ? '' : label).toLowerCase();
    s = s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
    if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    // Über 24 Zeichen: am letzten Bindestrich kürzen, wenn dann noch mindestens 12 bleiben; sonst hart.
    if (s.length > 24) { var k = s.slice(0, 25).lastIndexOf('-'); s = (k >= 12 ? s.slice(0, k) : s.slice(0, 24)).replace(/-+$/g, ''); }
    return s || 'ohne-titel';
  }
  function takeId(start, label, vergeben) {
    var d = start instanceof Date ? start : new Date(start);
    if (isNaN(d.getTime())) throw new Error('Take-ID: keine gültige Startzeit');
    var basis = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + '-' + kurztitel(label);
    var da = typeof vergeben === 'function' ? vergeben : function (id) { return !!(vergeben && (Array.isArray(vergeben) ? vergeben.indexOf(id) >= 0 : vergeben[id])); };
    var id = basis, n = 2;
    while (da(id)) id = basis + '-' + (n++);
    return id;
  }
  var ID_SCHEMA = /^\d{8}-\d{4}-[a-z0-9-]+$/;
  // Dateiname eines Takes: seine ID, wenn sie dem Chronik-Schema folgt; sonst (ältere Takes mit UUID) Code und Zeitstempel.
  function dateiStamm(take) {
    if (take && ID_SCHEMA.test(String(take.id))) return String(take.id);
    var d = startDate(take) || new Date(0);
    return 'vare-' + String(take && take.code || 'take') + '-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes());
  }
  /* Zahlen für JSON: NaN und ±Infinity werden null (fehlend), nicht {"$nf":…} wie in der Sicherung — das Paket liest
     Python, dort ist null ein NULL. Typisierte Felder werden zu Listen. */
  function jsonRein(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v === null || v === undefined) return null;
    if (typeof v !== 'object') return v;
    var i, out;
    if (Array.isArray(v) || ArrayBuffer.isView(v)) { out = []; for (i = 0; i < v.length; i++) out.push(jsonRein(v[i])); return out; }
    out = {};
    var ks = Object.keys(v);
    for (i = 0; i < ks.length; i++) out[ks[i]] = jsonRein(v[ks[i]]);
    return out;
  }
  function takeJson(take) {
    var s = take.summary || {}, kenn = {};
    for (var k in s) if (k !== 'spruenge') kenn[k] = s[k];
    var sp = s.spruenge || null, spKurz = null;
    if (sp) { spKurz = {}; for (var q in sp) if (q !== 'liste') spKurz[q] = sp[q]; }
    var cf = take.captureFlags || {};
    return jsonRein({
      format: 'vare-take', version: 1, id: take.id, code: take.code || null, titel: take.label || null,
      zeit: { start_iso: startIso(take), start_lokal: startLocal(take), ende_iso: endIso(take), ende_lokal: endLocal(take), utc_abstand_min: take.tzOffsetMin == null ? null : take.tzOffsetMin },
      dauer_s: take.durationS, signal_luecke_s: take.signalLueckeS == null ? null : take.signalLueckeS, signal_luecken: take.signalLuecken || null,
      sitzung: take.sitzung || null, vokal_absicht: take.vowelIntent || null,
      angaben: take.angaben || null, angaben_versionen: take.angabenVersionen || [], notiz: take.comment || null,
      kette: { geraet: take.deviceLabel || null, geraet_id: take.deviceId || null, kontextrate_hz: take.sampleRate, geraeterate_hz: take.trackSampleRate || null,
        browser_bearbeitung: browserBearbeitung(take), echo: cf.echoCancellation == null ? null : !!cf.echoCancellation, rauschen: cf.noiseSuppression == null ? null : !!cf.noiseSuppression,
        pegel: cf.autoGainControl == null ? null : !!cf.autoGainControl, erfassung: cf.capture || null, wav_format: take.audioFormat || null, kalibrier_id: take.calibrationId || null },
      analyse: take.analysis || null, kern_version: take.analysis ? take.analysis.kernelVersion : null,
      kennwerte: kenn, spruenge: spKurz, historie_fassungen: Array.isArray(take.history) ? take.history.length : 0,
      dateien: { wav: dateiStamm(take) + '.wav', frames: dateiStamm(take) + '.frames.csv', ereignisse: dateiStamm(take) + '.ereignisse.csv' }
    });
  }
  /* Sprünge aus detectJumps als Tabelle ereignisse: t, von_hz, nach_hz, halbtoene, art, uebergang_ms, oktave, ap_spitze (dazu
     dauer_s und richtung). Dialekt chronik, fehlend leer. */
  var EREIGNIS_SPALTEN = [['t', 'startS'], ['dauer_s', 'dauerS'], ['von_hz', 'vonHz'], ['nach_hz', 'nachHz'], ['halbtoene', 'halbtoene'], ['richtung', 'richtung'], ['art', 'art'], ['uebergang_ms', 'uebergangMs'], ['oktave', 'oktave'], ['ap_spitze', 'apSpitze']];
  function ereignisseToCsv(liste) {
    var d = DIALECTS.chronik, lines = [EREIGNIS_SPALTEN.map(function (c) { return c[0]; }).join(d.sep)];
    (liste || []).forEach(function (e) {
      lines.push(EREIGNIS_SPALTEN.map(function (c) { var v = e ? e[c[1]] : null; return fmtCell(typeof v === 'number' ? v : (v == null ? null : v), typeof v === 'string' ? undefined : 0, d); }).join(d.sep));
    });
    return lines.join('\r\n') + '\r\n';
  }
  // Das Paket als Liste von Dateien { name, text } (ohne WAV; die legt app.js dazu).
  function takePaket(take, series, VOWEL) {
    var stamm = dateiStamm(take), out = [{ name: stamm + '.take.json', text: JSON.stringify(takeJson(take), null, 2) + '\n' }];
    if (series) out.push({ name: stamm + '.frames.csv', text: framesToCsv(series, 'chronik', VOWEL) });
    out.push({ name: stamm + '.ereignisse.csv', text: ereignisseToCsv(take.summary && take.summary.spruenge && take.summary.spruenge.liste) });
    return out;
  }

  /* ---------- JSON-Sicherung ---------- */

  var TYPED = { Float32Array: Float32Array, Float64Array: Float64Array, Uint8Array: Uint8Array, Int8Array: Int8Array, Int16Array: Int16Array, Uint16Array: Uint16Array, Int32Array: Int32Array, Uint32Array: Uint32Array };

  /* Nicht endliche Zahlen: JSON kennt weder NaN noch Infinity und schreibt null. Zurückgelesen ist
     null aber keine Lücke, sondern fast überall 0 — isFinite(null) ist wahr, und die Chronik zeichnete
     nie gemessene Formanten bei 0 Hz (Bericht 4, Befund 5). Deshalb stehen sie in der Sicherung
     ausgeschrieben als {"$nf":"NaN"}, {"$nf":"Infinity"} oder {"$nf":"-Infinity"}. Ab Version 2.
     Version 3: typisierte Serien exakt als Bytes (Base64, little-endian). Bis Version 2 standen Float-Serien
     auf 0,001 gerundet da; die Rahmen-CSV rundet ein zweites Mal und wich nach Sicherung → Import in der
     letzten Stelle ab (−11,845 → −11,85 statt −11,84). Jetzt ist die Rahmen-CSV nach dem Rundlauf byte-gleich. */
  var BACKUP_VERSION = 3;
  function nfSchreiben(v) {
    if (typeof v === 'number') return isFinite(v) ? v : { $nf: String(v) };
    if (v === null || typeof v !== 'object' || typeof v.toJSON === 'function') return v;
    var i, out;
    if (Array.isArray(v)) { out = new Array(v.length); for (i = 0; i < v.length; i++) out[i] = nfSchreiben(v[i]); return out; }
    out = {};
    var ks = Object.keys(v);
    for (i = 0; i < ks.length; i++) out[ks[i]] = nfSchreiben(v[ks[i]]);
    return out;
  }
  function nfWert(v) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.$nf === 'string' && Object.keys(v).length === 1) {
      if (v.$nf === 'NaN') return NaN;
      if (v.$nf === 'Infinity') return Infinity;
      if (v.$nf === '-Infinity') return -Infinity;
    }
    return v;
  }
  // Liest frisch geparstes JSON an Ort und Stelle zurück.
  function nfLesen(v) {
    var w = nfWert(v);
    if (w !== v || v === null || typeof v !== 'object') return w;
    var i;
    if (Array.isArray(v)) { for (i = 0; i < v.length; i++) v[i] = nfLesen(v[i]); return v; }
    var ks = Object.keys(v);
    for (i = 0; i < ks.length; i++) v[ks[i]] = nfLesen(v[ks[i]]);
    return v;
  }

  /* ---------- Serien exakt: Bytes in Base64 (ab Version 3) ----------
     Jedes typisierte Feld steht als { $type, n, b64 }: n Werte, ihre Bytes little-endian in Base64.
     Float32 bleibt bitgleich, auch NaN, ±Infinity und −0; nichts wird gerundet. Feste Byte-Reihenfolge,
     damit eine Sicherung auf jedem Gerät gleich gelesen wird; auf big-endian-Geräten wird getauscht. */
  var LITTLE = (function () { var b = new ArrayBuffer(2); new Uint16Array(b)[0] = 1; return new Uint8Array(b)[0] === 1; })();
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', B64_CODE = [], B64_WERT = [];
  (function () { for (var i = 0; i < 64; i++) { B64_CODE[i] = B64.charCodeAt(i); B64_WERT[B64.charCodeAt(i)] = i; } })();
  // Byte-Reihenfolge je Element umdrehen (nur auf big-endian-Geräten nötig), in einer Kopie.
  function getauscht(u8, bpe) {
    var o = new Uint8Array(u8.length);
    for (var i = 0; i < u8.length; i += bpe) for (var j = 0; j < bpe; j++) o[i + j] = u8[i + bpe - 1 - j];
    return o;
  }
  // Stücke zu 3·8192 Bytes: jedes ergibt ganze Base64-Vierer, die Stücke lassen sich also aneinanderhängen.
  function base64Aus(u8) {
    var teile = [], STUECK = 3 * 8192, n = u8.length, a;
    // btoa ist eingebaut und in Chromium gut doppelt so schnell; ohne btoa (ältere Umgebung) dieselbe Kodierung in JS.
    if (typeof btoa === 'function') {
      for (a = 0; a < n; a += STUECK) teile.push(btoa(String.fromCharCode.apply(null, u8.subarray(a, Math.min(n, a + STUECK)))));
      return teile.join('');
    }
    var codes = new Uint16Array(STUECK / 3 * 4);
    for (a = 0; a < n; a += STUECK) {
      var e = Math.min(n, a + STUECK), j = a, c = 0, x;
      for (; j + 2 < e; j += 3) {
        x = (u8[j] << 16) | (u8[j + 1] << 8) | u8[j + 2];
        codes[c++] = B64_CODE[x >> 18]; codes[c++] = B64_CODE[(x >> 12) & 63]; codes[c++] = B64_CODE[(x >> 6) & 63]; codes[c++] = B64_CODE[x & 63];
      }
      if (j < e) {                                   // Rest (nur im letzten Stück): 1 oder 2 Bytes, mit '='
        x = (u8[j] << 16) | (j + 1 < e ? u8[j + 1] << 8 : 0);
        codes[c++] = B64_CODE[x >> 18]; codes[c++] = B64_CODE[(x >> 12) & 63]; codes[c++] = j + 1 < e ? B64_CODE[(x >> 6) & 63] : 61; codes[c++] = 61;
      }
      teile.push(String.fromCharCode.apply(null, c === codes.length ? codes : codes.subarray(0, c)));
    }
    return teile.join('');
  }
  function base64Ein(s) {
    if (typeof s !== 'string' || s.length % 4) throw new Error('Serie: Base64 mit falscher Länge');
    var rest = s.charAt(s.length - 1) === '=' ? (s.charAt(s.length - 2) === '=' ? 2 : 1) : 0;
    var out = new Uint8Array(s.length / 4 * 3 - rest), o = 0;
    for (var i = 0; i < s.length; i += 4) {
      var a = B64_WERT[s.charCodeAt(i)], b = B64_WERT[s.charCodeAt(i + 1)], c = B64_WERT[s.charCodeAt(i + 2)], d = B64_WERT[s.charCodeAt(i + 3)];
      var ende = i + 4 === s.length;
      if (a === undefined || b === undefined || (c === undefined && !(ende && rest === 2)) || (d === undefined && !(ende && rest >= 1))) throw new Error('Serie: kein Base64');
      var x = (a << 18) | (b << 12) | ((c || 0) << 6) | (d || 0);
      out[o++] = x >> 16;
      if (o < out.length) out[o++] = (x >> 8) & 255;
      if (o < out.length) out[o++] = x & 255;
    }
    return out;
  }
  function feldAus(v) {
    var u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return { $type: v.constructor.name, n: v.length, b64: base64Aus(LITTLE || v.BYTES_PER_ELEMENT === 1 ? u8 : getauscht(u8, v.BYTES_PER_ELEMENT)) };
  }
  function feldEin(k, v) {
    var T = TYPED[v.$type], u8 = base64Ein(v.b64);
    if (typeof v.n !== 'number' || u8.length !== v.n * T.BYTES_PER_ELEMENT) throw new Error('Serie ' + k + ': ' + u8.length + ' Bytes für ' + v.n + ' Werte ' + v.$type);
    if (!LITTLE && T.BYTES_PER_ELEMENT > 1) u8 = getauscht(u8, T.BYTES_PER_ELEMENT);
    return new T(u8.buffer, 0, v.n);
  }
  function packSeries(series) {
    var out = {};
    for (var k in series) {
      var v = series[k];
      if (ArrayBuffer.isView(v) && TYPED[v.constructor.name]) out[k] = feldAus(v);
      else out[k] = nfSchreiben(v);
    }
    return out;
  }
  /* Liest Version 3 ({ $type, n, b64 }) und die älteren Fassungen: Version 1 und 2 schrieben { $type, data }
     mit gerundeten Zahlen, NaN als null; Version 2 dazu ±Infinity als {"$nf":…}. */
  function unpackSeries(p) {
    var out = {};
    for (var k in p) {
      var v = p[k];
      if (v && v.$type && TYPED[v.$type] && typeof v.b64 === 'string') out[k] = feldEin(k, v);
      else if (v && v.$type && TYPED[v.$type] && v.data) {
        var T = TYPED[v.$type], arr = new T(v.data.length);
        for (var i = 0; i < v.data.length; i++) arr[i] = (v.data[i] == null) ? NaN : nfWert(v.data[i]);
        out[k] = arr;
      } else out[k] = nfLesen(v);
    }
    return out;
  }
  /* Größte Sicherungsdatei in Byte. Chrome und Edge halten höchstens 2^29 − 24 = 536 870 888 Zeichen in einem String;
     serializeBackup baut die Sicherung in einem, und der Import liest sie mit file.text() in einen zurück (Blob.text()
     lehnt 536 870 888 Byte ab). Was darüber liegt, lässt sich nicht schreiben oder nicht wieder einlesen. 500 Mio.
     lassen Reserve, auch für Zeichen, die in UTF-8 mehr als ein Byte belegen. app.js exportJson prüft gegen diese
     Grenze die ganze Datei, nicht nur das Audio (Befund N19). */
  var SICHERUNG_MAX_BYTES = 500e6;
  /* bundle = { takes: [take], series: { takeId: series }, refs, calibrations, settings, kernelVersion, exportedAt, audio?: {takeId: base64} } */
  /* Version 2 schreibt nicht endliche Zahlen aus (nfSchreiben), Version 3 die Serien als Bytes. Eine ältere
     Seite lehnt beides als unbekannt ab, statt {"$nf":…} als Wert zu übernehmen oder Serien ohne data zu
     lesen. Versionen 1 und 2 bleiben lesbar; was Version 1 als null trägt, bleibt null und gilt als fehlend. */
  function serializeBackup(bundle) {
    var takes = [];
    for (var i = 0; i < bundle.takes.length; i++) {
      var t = bundle.takes[i], s = bundle.series && bundle.series[t.id];
      takes.push({ take: nfSchreiben(t), series: s ? packSeries(s) : null, audio: (bundle.audio && bundle.audio[t.id]) || null });
    }
    return JSON.stringify({
      format: 'vare-backup', version: BACKUP_VERSION, exportedAt: bundle.exportedAt || null, kernelVersion: bundle.kernelVersion || null,
      takes: takes, refs: nfSchreiben(bundle.refs || null), calibrations: nfSchreiben(bundle.calibrations || []), settings: nfSchreiben(bundle.settings || null)
    });
  }
  function parseBackup(text) {
    var o = JSON.parse(text);
    if (!o || o.format !== 'vare-backup') throw new Error('Keine VARE-Sicherung (format fehlt)');
    if (o.version !== 1 && o.version !== 2 && o.version !== BACKUP_VERSION) throw new Error('Sicherungsversion ' + o.version + ' unbekannt');
    if (!Array.isArray(o.takes)) throw new Error('Sicherung ohne takes');
    var neu = o.version >= 2, lies = function (v) { return neu ? nfLesen(v) : v; };
    var takes = [], series = {}, audio = {};
    for (var i = 0; i < o.takes.length; i++) {
      var e = o.takes[i];
      if (!e || !e.take || !e.take.id) throw new Error('Take ' + i + ' ohne id');
      takes.push(lies(e.take));
      if (e.series) series[e.take.id] = unpackSeries(e.series);
      if (e.audio) audio[e.take.id] = e.audio;
    }
    return { takes: takes, series: series, audio: audio, refs: lies(o.refs || null), calibrations: lies(o.calibrations || []), settings: lies(o.settings || null), exportedAt: o.exportedAt, kernelVersion: o.kernelVersion };
  }

  var api = { SENTINEL: SENTINEL, BACKUP_VERSION: BACKUP_VERSION, SICHERUNG_MAX_BYTES: SICHERUNG_MAX_BYTES, DIALECTS: DIALECTS, TAKE_COLUMNS: TAKE_COLUMNS, FRAME_COLUMNS: FRAME_COLUMNS, takesToCsv: takesToCsv, framesToCsv: framesToCsv, fmtCell: fmtCell, serializeBackup: serializeBackup, parseBackup: parseBackup, packSeries: packSeries, unpackSeries: unpackSeries,
    PAKET_NAMEN: PAKET_NAMEN, paketName: paketName, EREIGNIS_SPALTEN: EREIGNIS_SPALTEN, kurztitel: kurztitel, takeId: takeId, ID_SCHEMA: ID_SCHEMA, dateiStamm: dateiStamm, startIso: startIso, startLocal: startLocal, endIso: endIso, endLocal: endLocal, browserBearbeitung: browserBearbeitung, jsonRein: jsonRein, takeJson: takeJson, ereignisseToCsv: ereignisseToCsv, takePaket: takePaket };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VARECSV = api;
})(typeof self !== 'undefined' ? self : this);

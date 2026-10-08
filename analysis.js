/* VARE — Analyse eines ganzen Takes: Rahmen im 10-ms-Raster, Gatter-Wiedergabe, Aggregation,
   Vokalsegmente und Referenzen. Läuft im Browser (window.VAREANALYSIS) und unter Node (module.exports).
   Braucht dsp.js und vowel.js (Node: require, Browser: globale Objekte). */
(function (root) {
  'use strict';
  var D = (typeof module !== 'undefined' && module.exports) ? require('./dsp.js') : root.VAREDSP;
  var V = (typeof module !== 'undefined' && module.exports) ? require('./vowel.js') : root.VAREVOWEL;

  var DEFAULTS = { hopS: 0.010, floorDb: null, gate: null, spreadMaxHz: D.SPREAD_MAX_HZ, chunk: 40, yieldMs: 0 };
  var GATE_CODE = { pause: 0, uebergang: 1, stabil: 2 };
  /* Grundton und SHR (dsp.js analyseAt): F0UNSURE = Gegenprobe gerissen, gilt für alles aus F0
     Abgeleitete; F0KORR = YIN-Wert durch die Gegenprobe ersetzt (sichtbar, nicht unsicher);
     SHRUNSURE = Raster zweifelhaft oder Grundton unsicher; OCTUNTER = Reihe unter 60 Hz, nicht geteilt
     (dann auch OCTAMBIG). SUBGRID heißt seit dem SHR-Raster aus dem Kamm „Hauptwert auf 2·F0“.
     Frei in Uint16: 8192, 16384, 32768. */
  var FLAG = { VOICED: 1, OCTAVE: 2, SUBGRID: 4, H1H2UNSURE: 8, D34VALID: 16, D45VALID: 32, SCORE: 64, OCTAMBIG: 128, VOWELAMBIG: 256,
    F0UNSURE: 512, F0KORR: 1024, SHRUNSURE: 2048, OCTUNTER: 4096 };

  /* Gründe je Rahmen als kleine Codes (Uint8), nicht als Text: Texte in einem gewöhnlichen Array
     kosteten bei einer Stunde (360 000 Rahmen) ein Vielfaches und überstünden keine Sicherung als
     typisiertes Feld. Gespeicherte Serien tragen die Nummern, deshalb werden die Listen nur
     verlängert, nie umgestellt. f0Grund und f0Korrektur: Index in der Liste. shrGrund: Bitmaske über
     die Teile, in dieser Reihenfolge mit '+' verbunden (dsp.js: 'kamm+zweitpuls', 'zweitpuls+grundton').
     Ein Text, den diese Fassung nicht kennt, wird CODE_UNBEKANNT und als '?' gelesen — nie still ''. */
  var GRUND = {
    f0Grund: ['', 'teiltonreihe', 'cepstrum', 'kein cepstrum'],
    f0Korrektur: ['', 'teiltonreihe', 'cepstrum'],
    shrGrund: ['kamm', 'zweitpuls', 'grundton']
  };
  var CODE_UNBEKANNT = 255;
  function codeAus(feld, text) {
    if (!text) return 0;
    var liste = GRUND[feld], i;
    if (feld !== 'shrGrund') { i = liste.indexOf(String(text)); return i > 0 ? i : CODE_UNBEKANNT; }
    var teile = String(text).split('+'), m = 0;
    for (i = 0; i < teile.length; i++) { var b = liste.indexOf(teile[i]); if (b < 0) return CODE_UNBEKANNT; m |= (1 << b); }
    return m;
  }
  function textAus(feld, code) {
    if (!code) return '';
    if (code === CODE_UNBEKANNT) return '?';
    var liste = GRUND[feld];
    if (feld !== 'shrGrund') return code < liste.length ? liste[code] : '?';
    var t = [];
    for (var b = 0; b < liste.length; b++) if (code & (1 << b)) t.push(liste[b]);
    return (code >> liste.length) ? '?' : t.join('+');
  }

  function stats(arr, extra) {
    var vals = [];
    for (var i = 0; i < arr.length; i++) if (isFinite(arr[i])) vals.push(arr[i]);
    var o = { med: D.median(vals), q1: D.quantile(vals, 0.25), q3: D.quantile(vals, 0.75), n: vals.length };
    /* Minimum und Maximum per Schleife: Math.min.apply übergibt jeden Wert als Argument, ab etwa
       125 000 Werten (21 min bei 10 ms Raster, 11 min bei 5 ms) lief der Stapel über (RangeError), und
       der Take wurde nicht gespeichert (Bericht 2, Befund 7). */
    if (extra) {
      var mn = Infinity, mx = -Infinity;
      for (var k = 0; k < vals.length; k++) { if (vals[k] < mn) mn = vals[k]; if (vals[k] > mx) mx = vals[k]; }
      o.min = vals.length ? mn : NaN; o.max = vals.length ? mx : NaN;
    }
    return o;
  }

  /* Rauschboden ohne Kalibrierung: nur messbar, wenn der Take Stille enthält. Die Pegelverteilung
     ist dann zweigipfelig — zwischen Stille und Stimme klafft eine Lücke. Ohne solche Lücke ist der
     Boden NICHT bekannt, und die frühere Klammer min(q05, q50−20) hat ihn erfunden: bei einem Take
     ohne Stille stand das SNR danach konstruktionsbedingt auf exakt 20,00 dB, und im Decrescendo
     schnitt die Schwelle Boden+12 die leisen Rahmen als „Pause“ ab, obwohl sie 40 dB über dem
     echten Boden lagen. Jetzt wird in dem Fall gesagt, dass der Boden unbekannt ist, und das SNR
     gar nicht erst ausgegeben. */
  function estimateFloor(ds, sr, hopS) {
    var n = Math.round(D.MAIN_WINDOW * sr), hop = Math.round(hopS * sr), levels = [];
    for (var s = 0; s + n <= ds.length; s += hop) levels.push(D.rmsDb(ds.subarray(s, s + n)));
    return bodenAusPegeln(levels);
  }
  /* Die Regel selbst, auf eine Liste von Pegeln der 0,10-s-Fenster: offline über alle Rahmen des Takes, live
     (app.js floorNow) über den Ringpuffer der letzten 10 s — damit live und offline dieselbe Schwelle gilt.
     Die übergebene Liste bleibt unverändert (live ist sie der Puffer in Zeitfolge). */
  function bodenAusPegeln(pegel) {
    var levels = [];
    for (var p = 0; p < pegel.length; p++) if (isFinite(pegel[p])) levels.push(pegel[p]);
    if (levels.length < 10) return { db: -70, known: false, gapDb: NaN };
    levels.sort(function (a, b) { return a - b; });
    var lo = Math.max(1, Math.ceil(levels.length * 0.05)), hi = Math.floor(levels.length * 0.95);
    var cut = -1, gap = 0;
    for (var j = lo; j <= hi; j++) { var g = levels[j] - levels[j - 1]; if (g > gap) { gap = g; cut = j; } }
    if (gap >= 10 && cut > 0) {
      var quiet = levels.slice(0, cut);
      return { db: Math.max(-95, D.median(quiet)), known: true, gapDb: gap };
    }
    /* Keine Stille: Der Boden liegt unter dem leisesten Rahmen, wie weit, ist unbekannt. Jede Annahme
       darüber verwirft gemessene Stimme. Früher q05 − 12: die Schwelle Boden + 12 lag genau auf q05,
       die leisesten 5 % jedes Takes galten als Pause (gehaltener Vokal 22 von 395 Rahmen, im
       Decrescendo die letzten 0,22 s), obwohl sie weit über dem echten Boden lagen (dort rund 45 dB;
       Bericht 2, Befund 3). Jetzt leisester Rahmen − 24: die Schwelle liegt 12 dB unter allem
       Gemessenen. Mit − 12 fielen bis zu 3 Rahmen je Take heraus: der leiseste selbst (Pegel gleich
       Schwelle) und Randrahmen, die analyseAt mit kürzerem Fenster leiser misst; mit q05 − 24 ein
       schneller Ausklang (30 dB in 0,3 s am Ende eines 4-s-Takes: 10 Rahmen). Über stimmhaft
       entscheidet dann die Periodizität (ap < 0,45); Rauschen ohne Stimme bleibt stimmlos.
       Periodischen Brumm (100 Hz) trennt auch die alte Regel nicht, nur eine Kalibrierung. Die Zahl
       ist eine Arbeitsannahme, kein gemessener Boden: summarise gibt sie nur als voicingFloorDb aus,
       floorDb bleibt NaN. */
    return { db: Math.max(-95, levels[0] - 24), known: false, gapDb: gap };
  }

  /* Speicher je Rahmen: 39 Float32, 10 Byte-Felder und die Flags (Uint16), 168 Byte (vorher 139). Eine Stunde bei 10 ms
     sind 360 000 Rahmen, also 60 MB statt 50 MB im Speicher; die Gründe kosten als Codes 3 Byte. Ältere
     gespeicherte Serien haben die Felder f0Cep … shrGrund, slotVerschmolzen und rauschBoden nicht: Wer sie
     liest, muss das Fehlen als „nicht gemessen“ behandeln, nicht als 0 (csv.js, chronik.js).
     Warum ein Slot unsicher ist (dsp.js slotGrund), steht als Maske wie valid und slotUnsure, Bit k für Fk+1:
     slotVerschmolzen = Grund 'verschmolzen' (zwei Resonanzen in einem Gipfel möglich); ein gesetztes
     slotUnsure-Bit ohne dieses Bit heißt 'nummer'. rauschBoden = Gipfel im Rauschboden, unabhängig davon. */
  function makeSeries(n) {
    var f = function () { return new Float32Array(n); };
    var s = { t: f(), f0: f(), ap: f(), rms: f(), d34: f(), d45: f(), score: f(), sfr: f(), sfrn: f(), shr: f(), cpp: f(), h1h2: f(), h1h2c: f(),
      f0Cep: f(), f0Yin: f(), shrGrid: f(), shrOther: f(), shrKamm: f(), shrZweitpuls: f(),
      f0Grund: new Uint8Array(n), f0Korrektur: new Uint8Array(n), shrGrund: new Uint8Array(n),
      valid: new Uint8Array(n), slotUnsure: new Uint8Array(n), slotVerschmolzen: new Uint8Array(n), rauschBoden: new Uint8Array(n), nPeaks: new Uint8Array(n),
      gate: new Uint8Array(n), flags: new Uint16Array(n), cls: new Int8Array(n) };
    for (var k = 1; k <= 5; k++) { s['f' + k] = f(); s['sdo' + k] = f(); s['sdw' + k] = f(); s['bw' + k] = f(); }
    return s;
  }

  function applyGate(series, states) {
    for (var i = 0; i < states.length; i++) {
      var gs = states[i];
      series.gate[i] = GATE_CODE[gs.state];
      series.cls[i] = (gs.state === 'stabil' && gs.cls) ? V.CLASS_INDEX[gs.cls] : -1;
      series.score[i] = gs.score;
      if (isFinite(gs.score)) series.flags[i] |= FLAG.SCORE; else series.flags[i] &= ~FLAG.SCORE;
      if (gs.ambiguous) series.flags[i] |= FLAG.VOWELAMBIG;
    }
  }

  function fillFrame(series, i, t, r) {
    series.t[i] = t; series.f0[i] = r.f0; series.ap[i] = r.ap; series.rms[i] = r.rmsDb;
    var vmask = 0;
    for (var k = 0; k < 5; k++) {
      series['f' + (k + 1)][i] = r.F[k]; series['sdo' + (k + 1)][i] = r.sdOrder[k]; series['sdw' + (k + 1)][i] = r.sdWin[k]; series['bw' + (k + 1)][i] = r.BW[k];
      if (r.valid[k]) vmask |= (1 << k);
    }
    series.valid[i] = vmask;
    var umask = 0, vmerk = 0, bmask = 0;
    for (var u = 0; u < 5; u++) {
      if (r.slotUnsure && r.slotUnsure[u]) umask |= (1 << u);
      if (r.slotGrund && r.slotGrund[u] === 'verschmolzen') vmerk |= (1 << u);
      if (r.rauschBoden && r.rauschBoden[u]) bmask |= (1 << u);
    }
    series.slotUnsure[i] = umask; series.slotVerschmolzen[i] = vmerk; series.rauschBoden[i] = bmask;
    series.nPeaks[i] = r.nPeaksRef;
    series.d34[i] = r.d34; series.d45[i] = r.d45; series.sfr[i] = r.sfr; series.shr[i] = r.shr; series.cpp[i] = r.cpp; series.h1h2[i] = r.h1h2; series.h1h2c[i] = r.h1h2c;
    // Gegenprobe und SHR-Raster: was den Wert unsicher macht oder ändert, gehört zum Rahmen.
    series.f0Cep[i] = r.f0Cep; series.f0Yin[i] = r.f0Yin;
    series.shrGrid[i] = r.shrGrid; series.shrOther[i] = r.shrOther; series.shrKamm[i] = r.shrKamm; series.shrZweitpuls[i] = r.shrZweitpuls;
    series.f0Grund[i] = codeAus('f0Grund', r.f0Grund); series.f0Korrektur[i] = codeAus('f0Korrektur', r.f0Korrektur); series.shrGrund[i] = codeAus('shrGrund', r.shrGrund);
    var fl = 0;
    if (r.voiced) fl |= FLAG.VOICED;
    if (r.octaveCorrected) fl |= FLAG.OCTAVE;
    if (isFinite(r.shrGrid) && r.shrGrid > r.f0 * 1.5) fl |= FLAG.SUBGRID;
    if (r.h1h2unsure) fl |= FLAG.H1H2UNSURE;
    if (r.octaveAmbiguous) fl |= FLAG.OCTAMBIG;
    if (r.d34valid) fl |= FLAG.D34VALID;
    if (r.d45valid) fl |= FLAG.D45VALID;
    if (r.f0Unsure) fl |= FLAG.F0UNSURE;
    if (r.f0Korrektur) fl |= FLAG.F0KORR;
    if (r.shrUnsure) fl |= FLAG.SHRUNSURE;
    if (r.octaveUnterGrenze) fl |= FLAG.OCTUNTER;
    series.gate[i] = 0; series.cls[i] = -1; series.score[i] = NaN;
    series.flags[i] = fl;
  }

  /* Ein Segment, dessen Rahmen überwiegend dicht an der Grenze zur Nachbarklasse liegen, hat keinen
     gemessenen, sondern einen entschiedenen Vokal. Es bleibt in den Segmenten sichtbar, wird aber
     weder Bestwert noch Referenz für diesen Vokal (Referenzen gelten je Vokal). */
  var AMBIG_MAX_SHARE = 0.5;

  /* Fassung der Zusammenfassung. Erhöhen, sobald bei gleichen Rahmenwerten andere Rahmen stabil,
     gewertet, Segment oder Bestwert werden (hier oder im Offline-Gatter von vowel.js) — ältere Takes
     sind dann nicht mehr gleich zusammengefasst. Takes ohne Angabe stammen aus Fassung 1, vor der
     Prüfung auf zweideutige Vokalzuordnung. Fassung 3: stabil zählt nur noch stimmhafte Rahmen;
     ohne Stille und ohne Kalibrierung fallen die leisesten 5 % nicht mehr als Pause heraus. */
  var SUMMARY_VERSION = 3;
  var FASSUNG_FEHLT = { 1: 'ohne Prüfung auf zweideutige Vokalzuordnung', 2: 'stimmlose Rahmen zählten als stabil, ohne Stille und Kalibrierung fielen die leisesten 5 % als Pause heraus' };

  /* Segmente: maximale Läufe mit gate = stabil und gleicher Klasse, Mindestlänge, Mindestanteil Score.
     ambiguousShare = Anteil der Rahmen mit zweideutiger Vokalzuordnung (FLAG.VOWELAMBIG). */
  function segments(series, minLenS, minScoreShare) {
    minLenS = minLenS || 0.5; minScoreShare = minScoreShare || 0.7;
    var out = [], n = series.t.length, i = 0;
    while (i < n) {
      if (series.gate[i] !== 2 || series.cls[i] < 0) { i++; continue; }
      var j = i, cls = series.cls[i], scores = [], amb = 0;
      while (j < n && series.gate[j] === 2 && series.cls[j] === cls) {
        if (isFinite(series.score[j])) scores.push(series.score[j]);
        if (series.flags[j] & FLAG.VOWELAMBIG) amb++;
        j++;
      }
      var lenS = series.t[j - 1] - series.t[i] + (n > 1 ? series.t[1] - series.t[0] : 0);
      if (lenS >= minLenS && scores.length / (j - i) >= minScoreShare) {
        out.push({ cls: V.CENTROIDS[cls].cls, startS: series.t[i], lenS: lenS, n: j - i, d34Med: D.median(scores), d34Q1: D.quantile(scores, 0.25), d34Q3: D.quantile(scores, 0.75), ambiguousShare: amb / (j - i) });
      }
      i = j;
    }
    return out;
  }

  function summarise(series, meta) {
    var n = series.t.length, i, voicedIdx = [], stabilIdx = [];
    /* „Stabil“ heißt in der Zusammenfassung stabil UND stimmhaft. Das Gatter lässt einen stimmlosen
       Rahmen in einem stabilen Fenster als 'stabil' stehen (nur ohne Wertung, bis 10 % je Fenster).
       Mitgezählt, aber durch die stimmhaften Rahmen geteilt, stand der stabil-Anteil bis 103 %, und
       nStable und die Vokalanteile zählten Rahmen ohne Vokal (Bericht 2, Befund 6). */
    for (i = 0; i < n; i++) if (series.flags[i] & FLAG.VOICED) { voicedIdx.push(i); if (series.gate[i] === 2) stabilIdx.push(i); }
    function pick(col, idx, cond) { var out = []; for (var k = 0; k < idx.length; k++) { var j = idx[k]; if (!cond || cond(j)) out.push(series[col][j]); } return out; }
    var s = {};
    s.nFrames = n; s.hopS = meta.hopS; s.durationS = meta.durationS;
    s.voicedShare = n ? voicedIdx.length / n : 0;
    /* Unbekannter Boden ist keine Zahl (Anzeige „–“, CSV −99): sonst stünde die Arbeitsannahme aus
       estimateFloor als „Rauschboden“ da. voicingFloorDb ist der Boden, gegen den die
       Stimmhaftigkeit geprüft wurde (Pegel > voicingFloorDb + 12), gemessen oder angenommen. */
    s.floorKnown = meta.floorKnown !== false;
    s.floorDb = s.floorKnown ? meta.floorDb : NaN; s.voicingFloorDb = meta.floorDb; s.floorSource = meta.floorSource;
    /* Grundton: Statistik und Note nur aus Rahmen, deren Grundton die Gegenprobe besteht (dsp.js
       f0Unsure). Ein unsicherer Wert ist oft eine Oktave oder Quinte daneben; im Median gemischt
       verschöbe er die Note, ohne dass es jemand sieht. Dieselbe Regel gilt für alles, was aus F0
       abgeleitet ist (SHR, H1−H2, H1*−H2*, SFR je Halbton): Der Rahmen behält seine Werte und seine
       Marke, die Zusammenfassung lässt ihn aus und nennt den Anteil — wie bei ungültigen Formanten.
       Korrigierte Werte (f0Korrektur) gelten als sicher und zählen mit. octaveAmbiguous bleibt drin:
       Dort sind Ton und halber Ton zwei vertretbare Lesarten, kein gerissener Wert; der Anteil steht
       in octaveAmbiguousShare. */
    var f0sicher = function (j) { return !(series.flags[j] & FLAG.F0UNSURE); };
    var anteil = function (maske) { var c = 0; for (var q = 0; q < voicedIdx.length; q++) if (series.flags[voicedIdx[q]] & maske) c++; return voicedIdx.length ? c / voicedIdx.length : 0; };
    s.f0 = stats(pick('f0', voicedIdx, f0sicher)); s.f0.note = D.hzToNote(s.f0.med);
    s.f0UnsureShare = anteil(FLAG.F0UNSURE);
    s.f0KorrekturShare = anteil(FLAG.F0KORR);
    s.F = [];
    var validAll = 0;
    for (var k = 0; k < 5; k++) {
      (function (kk) {
        var fst = stats(pick('f' + (kk + 1), voicedIdx, function (j) { return series.valid[j] & (1 << kk); }));
        fst.share = voicedIdx.length ? fst.n / voicedIdx.length : 0;   // in wie vielen stimmhaften Rahmen war er überhaupt gültig
        s.F.push(fst);
      })(k);
    }
    for (i = 0; i < voicedIdx.length; i++) if ((series.valid[voicedIdx[i]] & 15) === 15) validAll++;
    s.validShare = voicedIdx.length ? validAll / voicedIdx.length : 0;
    s.stableShare = voicedIdx.length ? stabilIdx.length / voicedIdx.length : 0;
    s.d34 = stats(pick('d34', voicedIdx, function (j) { return series.flags[j] & FLAG.D34VALID; }));
    s.d45 = stats(pick('d45', voicedIdx, function (j) { return series.flags[j] & FLAG.D45VALID; }));
    s.d34stable = stats(pick('score', stabilIdx));
    // F3 aller stabilen Rahmen mit gültigem F3. Die frühere Teilmenge (nur gewertete Rahmen) war
    // per Konstruktion bei der F3-Mindestschwelle abgeschnitten: „F3 stabil“ konnte nie darunter
    // liegen, und ein Take mit F3 durchgehend bei 2370 Hz zeigte „–“ statt der Zahl.
    s.f3stable = stats(pick('f3', stabilIdx, function (j) { return series.valid[j] & 4; }));
    s.f3scored = stats(pick('f3', stabilIdx, function (j) { return series.flags[j] & FLAG.SCORE; }));
    s.sfr = stats(pick('sfr', voicedIdx)); s.cpp = stats(pick('cpp', voicedIdx));
    /* SHR: Median und Maximum nur aus Rahmen ohne shrUnsure (Raster zweifelhaft oder Grundton
       unsicher). Vorher zählten sie mit, und ein Wert, dessen Raster offen ist, konnte als „Warnung“
       im Maximum stehen (Bericht 1, Befunde 3 und 4). Die unsicheren Rahmen verschwinden nicht:
       shrUnsureShare ist ihr Anteil, shrUnsureMax der höchste Hauptwert unter ihnen, shrOtherMax der
       höchste Wert auf dem anderen Raster (nur bei Rasterzweifel eine Zahl). */
    var shrSicher = function (j) { return !(series.flags[j] & FLAG.SHRUNSURE); };
    s.shr = stats(pick('shr', voicedIdx, shrSicher), true);
    s.shrUnsureShare = anteil(FLAG.SHRUNSURE);
    s.shrUnsureMax = stats(pick('shr', voicedIdx, function (j) { return !shrSicher(j); }), true).max;
    s.shrOtherMax = series.shrOther ? stats(pick('shrOther', voicedIdx), true).max : NaN;
    s.h1h2 = stats(pick('h1h2', voicedIdx, function (j) { return !(series.flags[j] & FLAG.H1H2UNSURE) && f0sicher(j); }));
    s.h1h2.unsureShare = anteil(FLAG.H1H2UNSURE);   // filtergetrieben (F1 nahe H1/H2), nicht Grundton
    s.h1h2c = stats(pick('h1h2c', voicedIdx, f0sicher));
    var rmsAll = []; for (i = 0; i < n; i++) rmsAll.push(series.rms[i]);
    s.rms = stats(rmsAll, true);
    var lvl = D.median(pick('rms', voicedIdx));
    // SNR nur, wenn der Boden gemessen ist. Sonst wäre es die Differenz zu einer erfundenen Zahl.
    s.snrDb = (s.floorKnown && isFinite(lvl) && isFinite(meta.floorDb)) ? lvl - meta.floorDb : NaN;
    /* Korrigiert heißt: der gemeldete Grundton ist nicht der YIN-Wert — durch die Teilerkontrolle
       (OCTAVE) oder durch die Gegenprobe (F0KORR, davon f0KorrekturShare). Vorher zählte nur die
       Teilerkontrolle, und ein Take mit lauter korrigierten Rahmen stand bei 0 %. */
    s.octaveCorrectedShare = anteil(FLAG.OCTAVE | FLAG.F0KORR);
    s.octaveAmbiguousShare = voicedIdx.length ? pick('flags', voicedIdx, function (j) { return series.flags[j] & FLAG.OCTAMBIG; }).length / voicedIdx.length : 0;
    s.vowelAmbiguousShare = stabilIdx.length ? pick('flags', stabilIdx, function (j) { return series.flags[j] & FLAG.VOWELAMBIG; }).length / stabilIdx.length : 0;
    var slotBad = 0;
    for (i = 0; i < voicedIdx.length; i++) if (series.slotUnsure[voicedIdx[i]]) slotBad++;
    s.slotUnsureShare = voicedIdx.length ? slotBad / voicedIdx.length : 0;
    /* Rohrlänge je Rahmen rechnen, dann aggregieren — nicht aus vier Medianen, die jeweils über
       eine andere Rahmenmenge laufen. Sonst stammt F4 womöglich aus einem anderen Vokal als F1,
       und die Länge gehört zu keiner tatsächlich gesungenen Konfiguration. */
    var cms = [];
    for (i = 0; i < voicedIdx.length; i++) {
      var vi = voicedIdx[i];
      if ((series.valid[vi] & 15) !== 15) continue;
      var tlf = D.tubeLength([series.f1[vi], series.f2[vi], series.f3[vi], series.f4[vi]]);
      if (isFinite(tlf.cm)) cms.push(tlf.cm);
    }
    s.tube = stats(cms, true);
    s.tubeCm = s.tube.n >= 20 ? s.tube.med : NaN;
    // Vokalanteile über stabile Rahmen
    var counts = {}, tot = 0;
    for (i = 0; i < stabilIdx.length; i++) { var c = series.cls[stabilIdx[i]]; if (c >= 0) { var name = V.CENTROIDS[c].cls; counts[name] = (counts[name] || 0) + 1; tot++; } }
    var dom = null, domN = 0, shares = {};
    for (var nm in counts) { shares[nm] = counts[nm] / tot; if (counts[nm] > domN) { domN = counts[nm]; dom = nm; } }
    s.vowel = { dominant: dom, dominantShare: tot ? domN / tot : 0, shares: shares };
    // Vokalsegmente und Bestwert je Vokal (engstes Segment-Median = trägt innerhalb des Vokals am besten)
    // Zweideutig zugeordnete Segmente zählen in segmentsAmbiguous, nicht als Bestsegment (s. AMBIG_MAX_SHARE).
    var segs = segments(series), per = {};
    for (i = 0; i < segs.length; i++) {
      var sg = segs[i], e = per[sg.cls] || (per[sg.cls] = { nStable: 0, segments: 0, segmentsAmbiguous: 0, d34: null, bestSegment: null, scores: [] });
      e.segments++;
      if (sg.ambiguousShare > AMBIG_MAX_SHARE) { e.segmentsAmbiguous++; continue; }
      if (!e.bestSegment || sg.d34Med < e.bestSegment.d34Med) e.bestSegment = { d34Med: sg.d34Med, startS: sg.startS, lenS: sg.lenS, n: sg.n, ambiguousShare: sg.ambiguousShare };
    }
    for (i = 0; i < stabilIdx.length; i++) {
      var ci = series.cls[stabilIdx[i]];
      if (ci < 0) continue;
      var cn = V.CENTROIDS[ci].cls, pe = per[cn] || (per[cn] = { nStable: 0, segments: 0, segmentsAmbiguous: 0, d34: null, bestSegment: null, scores: [] });
      pe.nStable++;
      if (isFinite(series.score[stabilIdx[i]])) pe.scores.push(series.score[stabilIdx[i]]);
    }
    var best = null;
    for (var pv in per) {
      per[pv].d34 = stats(per[pv].scores); delete per[pv].scores;
      var bs = per[pv].bestSegment;
      if (bs && (!best || bs.d34Med < best.d34)) best = { cls: pv, d34: bs.d34Med, startS: bs.startS, lenS: bs.lenS, ambiguousShare: bs.ambiguousShare };
    }
    s.perVowel = per; s.best = best; s.segments = segs;
    s.summaryVersion = SUMMARY_VERSION;
    return s;
  }

  /* SFR normiert: je Halbton (gerundeter MIDI-Wert) Median über den Take, Rahmen relativ dazu.
     Der Halbton kommt aus F0. Ein Rahmen mit unsicherem Grundton (F0UNSURE) steht womöglich in der
     falschen Gruppe und geht deshalb in keinen Median ein (wie in summarise). Seinen eigenen Wert
     bekommt er gegen den Median der Gruppe seines gemeldeten Tons, mit der Marke im Rahmen; gibt es
     dort keinen sicheren Rahmen, bleibt er NaN statt gegen einen erfundenen Bezug gerechnet. */
  function normaliseSfr(series) {
    var n = series.t.length, groups = {}, i;
    for (i = 0; i < n; i++) {
      if (!(series.flags[i] & FLAG.VOICED) || !isFinite(series.sfr[i])) { series.sfrn[i] = NaN; continue; }
      if (series.flags[i] & FLAG.F0UNSURE) continue;
      var m = Math.round(D.hzToMidi(series.f0[i]));
      (groups[m] || (groups[m] = [])).push(series.sfr[i]);
    }
    var med = {};
    for (var g in groups) med[g] = D.median(groups[g]);
    for (i = 0; i < n; i++) {
      if (!(series.flags[i] & FLAG.VOICED && isFinite(series.sfr[i]))) continue;
      var mg = med[Math.round(D.hzToMidi(series.f0[i]))];
      series.sfrn[i] = mg === undefined ? NaN : series.sfr[i] - mg;
    }
    return med;
  }

  /* Hauptaufruf. samples: Float32Array/Float64Array bei sr. Liefert Promise<{ summary, series, meta }>.
     onProgress(done, total) wird je Block gerufen; zwischen Blöcken gibt die Funktion den Faden frei.
     o.abbrechen (Funktion): liefert sie vor einem Block true, endet die Analyse ohne Ergebnis — das Promise
     wird mit einem Fehler verworfen, der abgebrochen = true trägt. So lässt sich ein langer Take mitten in
     der Rechnung abbrechen, ohne dass halbe Werte entstehen. */
  function analyseTake(samples, sr, o, onProgress) {
    var opts = {};
    for (var k in DEFAULTS) opts[k] = (o && o[k] != null) ? o[k] : DEFAULTS[k];
    var abbrechen = (o && typeof o.abbrechen === 'function') ? o.abbrechen : null;
    var TSR = D.TARGET_SR;
    var ds = D.resample(samples, sr, TSR);
    var hop = Math.max(1, Math.round(opts.hopS * TSR)), half = Math.round(0.03 * TSR);
    var centres = [];
    for (var c = half; c + half <= ds.length; c += hop) centres.push(c);
    var floorDb, floorSource, floorKnown;
    if (opts.floorDb != null) { floorDb = opts.floorDb; floorSource = 'calibration'; floorKnown = true; }
    else { var est = estimateFloor(ds, TSR, opts.hopS); floorDb = est.db; floorKnown = est.known; floorSource = est.known ? 'estimate' : 'unknown'; }
    var series = makeSeries(centres.length), inputs = [];
    var frameOpts = { align: 'centre', floorDb: floorDb, spreadMaxHz: opts.spreadMaxHz };
    var i = 0;
    return new Promise(function (resolve, reject) {
      function step() {
        try {
          if (abbrechen && abbrechen()) { var ab = new Error('Analyse abgebrochen'); ab.abgebrochen = true; reject(ab); return; }
          var end = Math.min(centres.length, i + opts.chunk);
          for (; i < end; i++) {
            var t = centres[i] / TSR, r = D.analyseAt(ds, TSR, centres[i], frameOpts);
            var inp = { t: t, voiced: r.voiced, F1: r.F[0], F2: r.F[1], F3: r.F[2], valid1: r.valid[0], valid2: r.valid[1], d34: r.d34, d34valid: r.d34valid };
            inputs.push(inp);
            fillFrame(series, i, t, r);
          }
          if (onProgress) onProgress(i, centres.length);
          if (i < centres.length) { setTimeout(step, opts.yieldMs); return; }
          applyGate(series, V.gateOffline(inputs, opts.gate || {}));
          var sfrByNote = normaliseSfr(series);
          /* Zweite Tonhöhenspur mit kurzem Fenster: die Hauptspur misst auf mindestens 60 ms und
             verliert dadurch Kiekser unter etwa 90 ms vollständig. Unterschieden wird nur nach Dauer —
             Kante (unter 90 ms: Silbengrenze, Staccato) gegen gehaltenen Wechsel (ab 90 ms). Ein
             gehaltener Sprung (ab 5 Halbtönen) ist nicht automatisch ein Registerwechsel: Ein legato
             gesungener Melodiesprung (Quarte bis Oktave) zählt genauso. Einen Registerbruch zeigt
             erst ein Qualitätseinbruch am Übergang, und den prüft diese Zählung nicht. */
          var fein = D.pitchTrackFine(ds, TSR, opts.fine || {});
          var spruenge = D.detectJumps(fein, opts.jumps || {});
          var meta = { hopS: opts.hopS, durationS: samples.length / sr, floorDb: floorDb, floorSource: floorSource, floorKnown: floorKnown, sampleRate: sr, kernelVersion: D.VERSION, summaryVersion: SUMMARY_VERSION, gate: V.createGate(opts.gate || {}).opts, spreadMaxHz: opts.spreadMaxHz, windowsS: D.WINDOWS, orders: D.ORDERS, yinThresh: 0.15 };
          var summary = summarise(series, meta);
          summary.sfrByNote = sfrByNote;
          var stimmSek = summary.voicedShare * meta.durationS;
          var gehalten = spruenge.filter(function (e) { return e.art === 'gehalten'; });
          var kanten = spruenge.filter(function (e) { return e.art === 'kante'; });
          summary.spruenge = {
            gehalten: gehalten.length, kante: kanten.length,
            lambdaGehalten: stimmSek > 0 ? gehalten.length / stimmSek : NaN,
            lambdaKante: stimmSek > 0 ? kanten.length / stimmSek : NaN,
            stimmhafteSekunden: stimmSek,
            fenster: { windowS: fein.windowS, hopS: fein.hopS, fmin: fein.fmin },
            liste: spruenge.slice(0, 200)
          };
          resolve({ summary: summary, series: series, meta: meta });
        } catch (e) { reject(e); }
      }
      step();
    });
  }

  /* „Vergleiche nur bei gleicher Rechenweise“ (Manual): Eine Referenz ist die Zielmarke für das, was
     jetzt gemessen wird, also stammt sie nur aus Takes, die so gerechnet und zusammengefasst sind, wie
     jetzt gerechnet würde. Die Rechenweise tragen:
     - Kernversion: Formanten, Gültigkeit und ΔF3–4 je Rahmen;
     - summaryVersion: welche Rahmen Segment und Bestwert werden;
     - hopS und spreadMaxHz: welche Rahmen es gibt und welche als gültig gelten;
     - Offline-Gatter: die Regler windowS, sdF1Max, sdF2Max, minValidShare, f3MinHz, dazu die festen
       Werte und die Zentroide. holdS, minFramesLive und die Rahmenprüfung wirken nur live.
     Verlangt ist Gleichheit, nicht „mindestens so streng“: Ein strengeres Gatter zieht andere
     Segmentgrenzen und bildet andere Mediane, auch wenn jeder gewertete Rahmen die jetzige Regel
     erfüllt. Rauschboden und Gerät werden nicht verglichen: sie beschreiben die Aufnahme. */
  var GATTER_VERGLEICH = [
    ['f3MinHz', 'F3-Mindestwert', ' Hz'], ['windowS', 'Gatter-Fenster', ' s'], ['sdF1Max', 'F1-Bewegungsgrenze', ' Hz'],
    ['sdF2Max', 'F2-Bewegungsgrenze', ' Hz'], ['minValidShare', 'Mindestanteil gültiger F1/F2', ''],
    ['minVoicedShare', 'Mindestanteil stimmhafter Rahmen', ''], ['classShare', 'Mindestanteil der Fensterklasse', ''],
    ['minFrames', 'Mindestzahl Rahmen im Fenster', ''], ['minFillShare', 'Mindestfüllung des Fensters', '']
  ];
  function istZahl(v) { return typeof v === 'number' && isFinite(v); }
  function zahlGleich(a, b) { return istZahl(a) && istZahl(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)); }
  function abweichung(name, alt, neu, einheit) {
    var txt = function (v) { return String(v).replace('.', ','); };
    return istZahl(alt) ? name + ' ' + txt(alt) + ' statt ' + txt(neu) + einheit : name + ' nicht gespeichert';
  }
  function zentroideGleich(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!a[i] || !b[i] || a[i].cls !== b[i].cls || !zahlGleich(a[i].F1, b[i].F1) || !zahlGleich(a[i].F2, b[i].F2)) return false;
    return true;
  }
  /* '' = vergleichbar, sonst die Abweichungen als Text. aktuell = { kernelVersion, gate, spreadMaxHz,
     hopS }: was analyseTake jetzt bekäme; fehlende Angaben gelten wie dort als Vorgabe. Ohne aktuell
     wird nichts geprüft. */
  function unvergleichbar(take, aktuell) {
    if (!aktuell) return '';
    var an = take && take.analysis, su = take && take.summary, ag = aktuell.gate || {}, d = [], i;
    if (!an) return 'Rechenweise nicht gespeichert';
    var kern = aktuell.kernelVersion != null ? aktuell.kernelVersion : D.VERSION;
    if (an.kernelVersion !== kern) d.push(an.kernelVersion ? 'Kern ' + an.kernelVersion + ' statt ' + kern : 'Kernversion nicht gespeichert');
    var sv = su && su.summaryVersion != null ? su.summaryVersion : 1;
    if (sv !== SUMMARY_VERSION) d.push('Zusammenfassung Fassung ' + sv + ' statt ' + SUMMARY_VERSION + (Object.prototype.hasOwnProperty.call(FASSUNG_FEHLT, sv) ? ' (' + FASSUNG_FEHLT[sv] + ')' : ''));
    var hop = aktuell.hopS != null ? aktuell.hopS : DEFAULTS.hopS, spr = aktuell.spreadMaxHz != null ? aktuell.spreadMaxHz : DEFAULTS.spreadMaxHz;
    if (!zahlGleich(an.hopS, hop)) d.push(abweichung('Rahmenabstand', an.hopS, hop, ' s'));
    if (!zahlGleich(an.spreadMaxHz, spr)) d.push(abweichung('Gültigkeitsgrenze Streuung', an.spreadMaxHz, spr, ' Hz'));
    var tg = an.gate;
    if (!tg) { d.push('Gatterwerte nicht gespeichert'); return d.join(', '); }
    for (i = 0; i < GATTER_VERGLEICH.length; i++) {
      var f = GATTER_VERGLEICH[i], soll = ag[f[0]] != null ? ag[f[0]] : V.DEFAULTS[f[0]];
      if (!zahlGleich(tg[f[0]], soll)) d.push(abweichung(f[1], tg[f[0]], soll, f[2]));
    }
    if (!zentroideGleich(tg.centroids, ag.centroids || V.CENTROIDS)) d.push(tg.centroids ? 'andere Vokalzentroide' : 'Vokalzentroide nicht gespeichert');
    return d.join(', ');
  }

  function refAus(t, b, pinned) {
    var r = { d34: b.d34Med, takeId: t.id, code: t.code, label: t.label, date: t.createdAt, startS: b.startS, lenS: b.lenS, pinned: pinned };
    if (typeof b.ambiguousShare === 'number') r.ambiguousShare = b.ambiguousShare;
    return r;
  }
  /* Angepinnt, aber nicht mehr aus dem eigenen Take aufzufrischen: Die Referenz bleibt stehen, mit
     verwaist und Grund, statt still durch das Minimum eines anderen Takes ersetzt zu werden — der
     Pin war eine Entscheidung des Nutzers. Kein d34, also keine Zielmarke. Nicht NaN: eine
     JSON-Sicherung macht daraus null, isFinite(null) ist wahr, nach dem Import stünde die Marke bei
     0 Hz. Der letzte Wert steht nur zur Anzeige in d34Zuletzt. */
  function verwaist(pr, host, grund) {
    var r = { takeId: pr.takeId, code: host ? host.code : pr.code, label: host ? host.label : pr.label, date: host ? host.createdAt : pr.date,
      startS: pr.startS, lenS: pr.lenS, pinned: true, verwaist: true, grund: grund };
    var alt = (typeof pr.d34 === 'number' && isFinite(pr.d34)) ? pr.d34 : pr.d34Zuletzt;
    if (typeof alt === 'number' && isFinite(alt)) r.d34Zuletzt = alt;
    return r;
  }

  /* Referenzen je Vokal: engstes Bestsegment über alle Takes, mit Herkunft. aktuell (optional, siehe
     unvergleichbar): Takes, die anders gerechnet sind, zählen nicht. Ohne aktuell wird die
     Rechenweise nicht geprüft. */
  function computeRefs(takes, previous, aktuell) {
    var refs = {};
    /* Eine angepinnte Referenz wird nach einer Neu-Analyse aus dem neuen Bestsegment desselben Takes
       aufgefrischt, nicht aus dem alten Wert. Geht das nicht — Take gelöscht, anders gerechnet, kein
       Bestsegment mehr, Bestsegment zweideutig —, bleibt sie verwaist stehen. Früher wurde sie
       verworfen und das Minimum der übrigen Takes trat kommentarlos an ihre Stelle. Eine verwaiste
       Referenz frischt sich wieder auf, sobald ihr Take wieder passt (Neu-Analyse, Import). */
    if (previous) for (var p in previous) {
      var pr = previous[p];
      if (!pr || !pr.pinned) continue;
      var host = null;
      for (var q = 0; q < takes.length; q++) if (takes[q] && takes[q].id === pr.takeId) { host = takes[q]; break; }
      var wer = 'Take ' + ((host ? host.code : pr.code) || '?');
      var pv = host && host.summary && host.summary.perVowel && host.summary.perVowel[p], hb = pv && pv.bestSegment, grund = '';
      var uv = host ? unvergleichbar(host, aktuell) : '';
      if (!host) grund = wer + ' ist gelöscht.';
      else if (uv) grund = wer + ' ist anders gerechnet als jetzt eingestellt: ' + uv + '.';
      else if (!hb || !isFinite(hb.d34Med)) grund = wer + ' hat in seiner letzten Auswertung ' + (pv && pv.segmentsAmbiguous ? 'für /' + p + '/ nur zweideutig zugeordnete Segmente, kein Bestsegment.' : 'kein Bestsegment für /' + p + '/.');
      else if (hb.ambiguousShare > AMBIG_MAX_SHARE) grund = wer + ': das Bestsegment für /' + p + '/ ist zweideutig zugeordnet (' + Math.round(100 * hb.ambiguousShare) + ' % der Rahmen).';
      refs[p] = grund ? verwaist(pr, host, grund) : refAus(host, hb, true);
    }
    for (var i = 0; i < takes.length; i++) {
      var t = takes[i], per = t.summary && t.summary.perVowel;
      if (!per) continue;
      // Bericht 2, Befund 2: ein Take mit gesenkter F3-Schwelle machte sein tiefes, enges Cluster zur Zielmarke.
      if (unvergleichbar(t, aktuell)) continue;
      for (var cls in per) {
        var b = per[cls].bestSegment;
        if (!b || !isFinite(b.d34Med)) continue;
        // Gespeicherte Zusammenfassungen werden nicht neu gerechnet: ein zweideutiges Bestsegment hier noch einmal abweisen.
        if (b.ambiguousShare > AMBIG_MAX_SHARE) continue;
        if (refs[cls] && refs[cls].pinned) continue;   // auch verwaist: der Platz bleibt dem Pin
        if (!refs[cls] || b.d34Med < refs[cls].d34) refs[cls] = refAus(t, b, false);
      }
    }
    return refs;
  }

  /* Take-Codes sind die Identität, unter der der Nutzer seine Aufnahmen führt (A, B, … AA).
     Nach einem Import oder nach „Alles löschen“ stand der Zähler wieder auf 0 und vergab Codes
     ein zweites Mal. Der nächste freie Index ergibt sich aus dem Zähler UND den vorhandenen Takes. */
  function indexFromCode(c) {
    var n = 0;
    if (!c) return -1;
    for (var i = 0; i < c.length; i++) { var d = c.charCodeAt(i) - 64; if (d < 1 || d > 26) return -1; n = n * 26 + d; }
    return n - 1;
  }
  function nextCodeIndex(takes, stored) {
    var m = stored || 0;
    for (var i = 0; i < (takes || []).length; i++) { var k = indexFromCode(takes[i].code); if (k >= 0 && k + 1 > m) m = k + 1; }
    return m;
  }

  var api = { bodenAusPegeln: bodenAusPegeln, DEFAULTS: DEFAULTS, FLAG: FLAG, GRUND: GRUND, CODE_UNBEKANNT: CODE_UNBEKANNT, codeAus: codeAus, textAus: textAus, GATE_CODE: GATE_CODE, AMBIG_MAX_SHARE: AMBIG_MAX_SHARE, SUMMARY_VERSION: SUMMARY_VERSION, analyseTake: analyseTake, applyGate: applyGate,
    indexFromCode: indexFromCode, nextCodeIndex: nextCodeIndex, summarise: summarise, segments: segments, estimateFloor: estimateFloor, normaliseSfr: normaliseSfr, computeRefs: computeRefs, unvergleichbar: unvergleichbar, makeSeries: makeSeries, stats: stats };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VAREANALYSIS = api;
})(typeof self !== 'undefined' ? self : this);

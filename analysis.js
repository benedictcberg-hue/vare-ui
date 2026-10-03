/* VARE — Analyse eines ganzen Takes: Rahmen im 10-ms-Raster, Gatter-Wiedergabe, Aggregation,
   Vokalsegmente und Referenzen. Läuft im Browser (window.VAREANALYSIS) und unter Node (module.exports).
   Braucht dsp.js und vowel.js (Node: require, Browser: globale Objekte). */
(function (root) {
  'use strict';
  var D = (typeof module !== 'undefined' && module.exports) ? require('./dsp.js') : root.VAREDSP;
  var V = (typeof module !== 'undefined' && module.exports) ? require('./vowel.js') : root.VAREVOWEL;

  var DEFAULTS = { hopS: 0.010, floorDb: null, gate: null, spreadMaxHz: D.SPREAD_MAX_HZ, chunk: 40, yieldMs: 0 };
  var GATE_CODE = { pause: 0, uebergang: 1, stabil: 2 };
  var FLAG = { VOICED: 1, OCTAVE: 2, SUBGRID: 4, H1H2UNSURE: 8, D34VALID: 16, D45VALID: 32, SCORE: 64, OCTAMBIG: 128, VOWELAMBIG: 256 };

  function stats(arr, extra) {
    var vals = [];
    for (var i = 0; i < arr.length; i++) if (isFinite(arr[i])) vals.push(arr[i]);
    var o = { med: D.median(vals), q1: D.quantile(vals, 0.25), q3: D.quantile(vals, 0.75), n: vals.length };
    if (extra) { o.min = vals.length ? Math.min.apply(null, vals) : NaN; o.max = vals.length ? Math.max.apply(null, vals) : NaN; }
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
    if (levels.length < 10) return { db: -70, known: false, gapDb: NaN };
    levels.sort(function (a, b) { return a - b; });
    var lo = Math.max(1, Math.ceil(levels.length * 0.05)), hi = Math.floor(levels.length * 0.95);
    var cut = -1, gap = 0;
    for (var j = lo; j <= hi; j++) { var g = levels[j] - levels[j - 1]; if (g > gap) { gap = g; cut = j; } }
    if (gap >= 10 && cut > 0) {
      var quiet = levels.slice(0, cut);
      return { db: Math.max(-95, D.median(quiet)), known: true, gapDb: gap };
    }
    // Keine Stille: der Boden liegt unter allem Gemessenen. Als Schranke der leiseste Rahmen
    // minus 12 dB — damit verwirft die Stimmhaftigkeitsprüfung keinen gemessenen Rahmen.
    return { db: Math.max(-95, D.quantile(levels, 0.05) - 12), known: false, gapDb: gap };
  }

  function makeSeries(n) {
    var f = function () { return new Float32Array(n); };
    var s = { t: f(), f0: f(), ap: f(), rms: f(), d34: f(), d45: f(), score: f(), sfr: f(), sfrn: f(), shr: f(), cpp: f(), h1h2: f(), h1h2c: f(),
      valid: new Uint8Array(n), slotUnsure: new Uint8Array(n), nPeaks: new Uint8Array(n),
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
    var umask = 0;
    for (var u = 0; u < 5; u++) if (r.slotUnsure && r.slotUnsure[u]) umask |= (1 << u);
    series.slotUnsure[i] = umask;
    series.nPeaks[i] = r.nPeaksRef;
    series.d34[i] = r.d34; series.d45[i] = r.d45; series.sfr[i] = r.sfr; series.shr[i] = r.shr; series.cpp[i] = r.cpp; series.h1h2[i] = r.h1h2; series.h1h2c[i] = r.h1h2c;
    var fl = 0;
    if (r.voiced) fl |= FLAG.VOICED;
    if (r.octaveCorrected) fl |= FLAG.OCTAVE;
    if (isFinite(r.shrGrid) && r.shrGrid > r.f0 * 1.5) fl |= FLAG.SUBGRID;
    if (r.h1h2unsure) fl |= FLAG.H1H2UNSURE;
    if (r.octaveAmbiguous) fl |= FLAG.OCTAMBIG;
    if (r.d34valid) fl |= FLAG.D34VALID;
    if (r.d45valid) fl |= FLAG.D45VALID;
    series.gate[i] = 0; series.cls[i] = -1; series.score[i] = NaN;
    series.flags[i] = fl;
  }

  /* Segmente: maximale Läufe mit gate = stabil und gleicher Klasse, Mindestlänge, Mindestanteil Score. */
  function segments(series, minLenS, minScoreShare) {
    minLenS = minLenS || 0.5; minScoreShare = minScoreShare || 0.7;
    var out = [], n = series.t.length, i = 0;
    while (i < n) {
      if (series.gate[i] !== 2 || series.cls[i] < 0) { i++; continue; }
      var j = i, cls = series.cls[i], scores = [];
      while (j < n && series.gate[j] === 2 && series.cls[j] === cls) { if (isFinite(series.score[j])) scores.push(series.score[j]); j++; }
      var lenS = series.t[j - 1] - series.t[i] + (n > 1 ? series.t[1] - series.t[0] : 0);
      if (lenS >= minLenS && scores.length / (j - i) >= minScoreShare) {
        out.push({ cls: V.CENTROIDS[cls].cls, startS: series.t[i], lenS: lenS, n: j - i, d34Med: D.median(scores), d34Q1: D.quantile(scores, 0.25), d34Q3: D.quantile(scores, 0.75) });
      }
      i = j;
    }
    return out;
  }

  function summarise(series, meta) {
    var n = series.t.length, i, voicedIdx = [], stabilIdx = [];
    for (i = 0; i < n; i++) { if (series.flags[i] & FLAG.VOICED) voicedIdx.push(i); if (series.gate[i] === 2) stabilIdx.push(i); }
    function pick(col, idx, cond) { var out = []; for (var k = 0; k < idx.length; k++) { var j = idx[k]; if (!cond || cond(j)) out.push(series[col][j]); } return out; }
    var s = {};
    s.nFrames = n; s.hopS = meta.hopS; s.durationS = meta.durationS;
    s.voicedShare = n ? voicedIdx.length / n : 0;
    s.floorDb = meta.floorDb; s.floorSource = meta.floorSource;
    var f0s = pick('f0', voicedIdx);
    s.f0 = stats(f0s); s.f0.note = D.hzToNote(s.f0.med);
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
    s.sfr = stats(pick('sfr', voicedIdx)); s.shr = stats(pick('shr', voicedIdx), true); s.cpp = stats(pick('cpp', voicedIdx));
    s.h1h2 = stats(pick('h1h2', voicedIdx, function (j) { return !(series.flags[j] & FLAG.H1H2UNSURE); }));
    var unsure = 0; for (i = 0; i < voicedIdx.length; i++) if (series.flags[voicedIdx[i]] & FLAG.H1H2UNSURE) unsure++;
    s.h1h2.unsureShare = voicedIdx.length ? unsure / voicedIdx.length : 0;
    s.h1h2c = stats(pick('h1h2c', voicedIdx));
    var rmsAll = []; for (i = 0; i < n; i++) rmsAll.push(series.rms[i]);
    s.rms = stats(rmsAll, true);
    var lvl = D.median(pick('rms', voicedIdx));
    // SNR nur, wenn der Boden gemessen ist. Sonst wäre es die Differenz zu einer erfundenen Zahl.
    s.floorKnown = meta.floorKnown !== false;
    s.snrDb = (s.floorKnown && isFinite(lvl) && isFinite(meta.floorDb)) ? lvl - meta.floorDb : NaN;
    s.octaveCorrectedShare = voicedIdx.length ? pick('flags', voicedIdx, function (j) { return series.flags[j] & FLAG.OCTAVE; }).length / voicedIdx.length : 0;
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
    var segs = segments(series), per = {};
    for (i = 0; i < segs.length; i++) {
      var sg = segs[i], e = per[sg.cls] || (per[sg.cls] = { nStable: 0, segments: 0, d34: null, bestSegment: null, scores: [] });
      e.segments++;
      if (!e.bestSegment || sg.d34Med < e.bestSegment.d34Med) e.bestSegment = { d34Med: sg.d34Med, startS: sg.startS, lenS: sg.lenS, n: sg.n };
    }
    for (i = 0; i < stabilIdx.length; i++) {
      var ci = series.cls[stabilIdx[i]];
      if (ci < 0) continue;
      var cn = V.CENTROIDS[ci].cls, pe = per[cn] || (per[cn] = { nStable: 0, segments: 0, d34: null, bestSegment: null, scores: [] });
      pe.nStable++;
      if (isFinite(series.score[stabilIdx[i]])) pe.scores.push(series.score[stabilIdx[i]]);
    }
    var best = null;
    for (var pv in per) { per[pv].d34 = stats(per[pv].scores); delete per[pv].scores; if (per[pv].bestSegment && (!best || per[pv].bestSegment.d34Med < best.d34)) best = { cls: pv, d34: per[pv].bestSegment.d34Med, startS: per[pv].bestSegment.startS, lenS: per[pv].bestSegment.lenS }; }
    s.perVowel = per; s.best = best; s.segments = segs;
    return s;
  }

  /* SFR normiert: je Halbton (gerundeter MIDI-Wert) Median über den Take, Rahmen relativ dazu. */
  function normaliseSfr(series) {
    var n = series.t.length, groups = {}, i;
    for (i = 0; i < n; i++) {
      if (!(series.flags[i] & FLAG.VOICED) || !isFinite(series.sfr[i])) { series.sfrn[i] = NaN; continue; }
      var m = Math.round(D.hzToMidi(series.f0[i]));
      (groups[m] || (groups[m] = [])).push(series.sfr[i]);
    }
    var med = {};
    for (var g in groups) med[g] = D.median(groups[g]);
    for (i = 0; i < n; i++) if (series.flags[i] & FLAG.VOICED && isFinite(series.sfr[i])) series.sfrn[i] = series.sfr[i] - med[Math.round(D.hzToMidi(series.f0[i]))];
    return med;
  }

  /* Hauptaufruf. samples: Float32Array/Float64Array bei sr. Liefert Promise<{ summary, series, meta }>.
     onProgress(done, total) wird je Block gerufen; zwischen Blöcken gibt die Funktion den Faden frei. */
  function analyseTake(samples, sr, o, onProgress) {
    var opts = {};
    for (var k in DEFAULTS) opts[k] = (o && o[k] != null) ? o[k] : DEFAULTS[k];
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
             verliert dadurch Kiekser unter etwa 90 ms vollständig. Unterschieden wird nach Dauer —
             Kante (Silbengrenze, Staccato) gegen gehaltenen Wechsel (Register). */
          var fein = D.pitchTrackFine(ds, TSR, opts.fine || {});
          var spruenge = D.detectJumps(fein, opts.jumps || {});
          var meta = { hopS: opts.hopS, durationS: samples.length / sr, floorDb: floorDb, floorSource: floorSource, floorKnown: floorKnown, sampleRate: sr, kernelVersion: D.VERSION, gate: V.createGate(opts.gate || {}).opts, spreadMaxHz: opts.spreadMaxHz, windowsS: D.WINDOWS, orders: D.ORDERS, yinThresh: 0.15 };
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

  /* Referenzen je Vokal aus allen Takes: engstes bestSegment (Minimum), mit Herkunft. Angepinnte bleiben. */
  function computeRefs(takes, previous) {
    var refs = {};
    // Eine angepinnte Referenz bleibt nur, solange ihr Take existiert — sonst stünde eine Zielmarke
    // auf dem Schirm, deren Herkunft gelöscht ist. Nach einer Neu-Analyse wird sie aus dem neuen
    // Bestsegment desselben Takes aufgefrischt, nicht aus dem alten Wert.
    if (previous) for (var p in previous) {
      var pr = previous[p];
      if (!pr || !pr.pinned) continue;
      var host = null;
      for (var q = 0; q < takes.length; q++) if (takes[q].id === pr.takeId) { host = takes[q]; break; }
      if (!host) continue;
      var hb = host.summary && host.summary.perVowel && host.summary.perVowel[p] && host.summary.perVowel[p].bestSegment;
      if (hb && isFinite(hb.d34Med)) refs[p] = { d34: hb.d34Med, takeId: host.id, code: host.code, label: host.label, date: host.createdAt, startS: hb.startS, lenS: hb.lenS, pinned: true };
    }
    for (var i = 0; i < takes.length; i++) {
      var t = takes[i], per = t.summary && t.summary.perVowel;
      if (!per) continue;
      for (var cls in per) {
        var b = per[cls].bestSegment;
        if (!b || !isFinite(b.d34Med)) continue;
        if (refs[cls] && refs[cls].pinned) continue;
        if (!refs[cls] || b.d34Med < refs[cls].d34) refs[cls] = { d34: b.d34Med, takeId: t.id, code: t.code, label: t.label, date: t.createdAt, startS: b.startS, lenS: b.lenS, pinned: false };
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

  var api = { DEFAULTS: DEFAULTS, FLAG: FLAG, GATE_CODE: GATE_CODE, analyseTake: analyseTake, applyGate: applyGate,
    indexFromCode: indexFromCode, nextCodeIndex: nextCodeIndex, summarise: summarise, segments: segments, estimateFloor: estimateFloor, normaliseSfr: normaliseSfr, computeRefs: computeRefs, makeSeries: makeSeries, stats: stats };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VAREANALYSIS = api;
})(typeof self !== 'undefined' ? self : this);

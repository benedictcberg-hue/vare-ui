/* VARE — Kalibrierung: 3 s Vorlauf (nicht aufgenommen), 6 s Stille, 2 s Einatmen (nicht ausgewertet),
   5 s /a/, 2 s Ausklang. Reine Rechenfunktionen (UMD, Node-testbar).
   Ergebnis: Rauschboden, Pegel, SNR (gesamt und je Band), Ausklangrate, Formant-Fingerabdruck.
   Vergleich mit der letzten Kalibrierung derselben Kette → Warnungen, wenn die Kette abgesackt ist. */
(function (root) {
  'use strict';
  var D = (typeof module !== 'undefined' && module.exports) ? require('./dsp.js') : root.VAREDSP;

  /* Der alte Ablauf (5 s / 3 s / 1 s ohne Vorlauf) war beim Singen kaum zu schaffen: Zwischen „still“
     und „/a/“ blieb keine Zeit zum Einatmen, der Einatem landete im /a/-Fenster oder der Ton kam zu spät.
     Jetzt: ein Vorlauf zum Bereitmachen, eine eigene Einatemphase, die keine Auswertung berührt, und
     längere Phasen. ansage = großer Text, hinweis = Zeile darunter. */
  var VORLAUF_S = 3;
  var PHASES = [
    { key: 'stille', label: 'Stille — nicht atmen, nicht bewegen', ansage: 'Still sein', hinweis: 'nicht atmen, nicht bewegen', seconds: 6 },
    { key: 'einatmen', label: 'Einatmen — gleich /a/ singen', ansage: 'Einatmen', hinweis: 'gleich /a/ singen', seconds: 2 },
    { key: 'a', label: '/a/ auf bequemer Höhe, gleichmäßig', ansage: '/a/ singen', hinweis: 'bequeme Höhe, gleichmäßig, gut hörbar', seconds: 5 },
    { key: 'ausklang', label: 'Abrupt aufhören — still bleiben', ansage: 'Aufhören!', hinweis: 'abrupt, dann ganz still bleiben', seconds: 2 }
  ];
  function totalSeconds() { var s = 0; for (var i = 0; i < PHASES.length; i++) s += PHASES[i].seconds; return s; }
  /* Beginn und Ende einer Phase in Sekunden ab Aufnahmebeginn. */
  function phaseRange(key) {
    var t = 0;
    for (var i = 0; i < PHASES.length; i++) { if (PHASES[i].key === key) return { from: t, to: t + PHASES[i].seconds }; t += PHASES[i].seconds; }
    return null;
  }
  /* Welche Phase zur Zeit el (s ab Klick, Vorlauf eingeschlossen) läuft: {phase|null, nr, rest, anteil, vorlauf}. */
  function phaseAt(el) {
    if (el < VORLAUF_S) return { phase: null, vorlauf: true, nr: 0, rest: VORLAUF_S - el, anteil: el / VORLAUF_S };
    var t = el - VORLAUF_S, acc = 0;
    for (var i = 0; i < PHASES.length; i++) {
      if (t < acc + PHASES[i].seconds) return { phase: PHASES[i], vorlauf: false, nr: i + 1, rest: acc + PHASES[i].seconds - t, anteil: (t - acc) / PHASES[i].seconds };
      acc += PHASES[i].seconds;
    }
    return { phase: null, vorlauf: false, nr: PHASES.length + 1, rest: 0, anteil: 1 };
  }

  function meanSpectrumDb(ds, sr, from, to) {
    var n = Math.round(0.14 * sr), hop = Math.round(0.05 * sr), acc = null, cnt = 0;
    for (var s = from; s + n <= to; s += hop) {
      var sp = D.spectrum(ds.subarray(s, s + n), sr);
      if (!acc) acc = new Float64Array(sp.pow.length);
      for (var k = 0; k < sp.pow.length; k++) acc[k] += sp.pow[k];
      cnt++;
    }
    if (!cnt) return null;
    var db = new Float32Array(acc.length);
    for (var j = 0; j < acc.length; j++) db[j] = 10 * Math.log10(acc[j] / cnt + 1e-20);
    return { db: db, df: sr / 2048, n: cnt };
  }
  function bandFromDb(spec, fLo, fHi) {
    var lo = Math.max(1, Math.ceil(fLo / spec.df)), hi = Math.min(spec.db.length - 1, Math.ceil(fHi / spec.df) - 1), s = 0;
    for (var k = lo; k <= hi; k++) s += Math.pow(10, spec.db[k] / 10);
    return 10 * Math.log10(s + 1e-20);
  }

  /* samples bei sr, aufgenommen über die Phasen in PHASES hintereinander, ohne Vorlauf (Gesamtlänge ≥ totalSeconds). */
  function analyseCalibration(samples, sr, meta) {
    var TSR = D.TARGET_SR, ds = D.resample(samples, sr, TSR);
    var hopS = 0.01, hop = Math.round(hopS * TSR), n = Math.round(D.MAIN_WINDOW * TSR);
    var pS = phaseRange('stille'), pA = phaseRange('a');
    var tS = pS.to, aVon = pA.from + 0.5, tA = pA.to;
    // Rahmenpegel über alles
    var rms = [], t = [];
    for (var s = 0; s + n <= ds.length; s += hop) { rms.push(D.rmsDb(ds.subarray(s, s + n))); t.push((s + n / 2) / TSR); }
    function idx(sec) { return Math.max(0, Math.min(rms.length - 1, Math.round((sec * TSR - n / 2) / hop))); }
    // Stille: Rand 0,5 s vorn, 0,3 s hinten weglassen
    var silLv = rms.slice(idx(0.5), idx(tS - 0.3));
    var floorDb = D.median(silLv), floorQ90 = D.quantile(silLv, 0.9);
    var silSpec = meanSpectrumDb(ds, TSR, Math.round(0.5 * TSR), Math.round((tS - 0.3) * TSR));
    // /a/: stimmhafte Rahmen ab 0,5 s nach Beginn der /a/-Phase (Einsatz eingeschwungen) bis tA−0,2
    var aFrames = [], F = [[], [], [], [], []], sfrs = [];
    for (var c = Math.round(aVon * TSR); c < Math.round((tA - 0.2) * TSR); c += hop * 2) {
      var r = D.analyseAt(ds, TSR, c, { floorDb: floorDb });
      if (!r.voiced) continue;
      aFrames.push(r);
      for (var k = 0; k < 5; k++) if (r.valid[k]) F[k].push(r.F[k]);
      if (isFinite(r.sfr)) sfrs.push(r.sfr);
    }
    var lvA = [], f0s = [];
    for (var i = 0; i < aFrames.length; i++) { lvA.push(aFrames[i].rmsDb); f0s.push(aFrames[i].f0); }
    var levelDb = D.median(lvA), snrDb = levelDb - floorDb;
    var aSpec = meanSpectrumDb(ds, TSR, Math.round(aVon * TSR), Math.round((tA - 0.2) * TSR));
    var bandSnr = {};
    if (silSpec && aSpec) {
      bandSnr.low = bandFromDb(aSpec, 0, 2000) - bandFromDb(silSpec, 0, 2000);
      bandSnr.sf = bandFromDb(aSpec, 2400, 3200) - bandFromDb(silSpec, 2400, 3200);
    }
    // Phrasenende = letzter Rahmen, der noch innerhalb 10 dB des /a/-Pegels liegt; danach Ausklangrate
    // (L_{+60 ms} − L_{+160 ms}) / 0,1 s nach Physik-Skript.
    var end = -1;
    // Suchfenster bis 1,2 s in die Ausklangphase: wer auf die Ansage „Aufhören!“ reagiert, hört etwas später auf.
    for (var e = idx(tA + 1.2); e >= idx(tA - 0.5); e--) if (rms[e] > levelDb - 10) { end = e; break; }
    var decay = (end >= 0) ? D.decayRate(rms, hopS, end) : NaN;
    var decayMs = NaN;
    if (end >= 0) { for (var q = end; q < rms.length; q++) if (rms[q] <= levelDb - 25) { decayMs = (q - end) * hopS * 1000; break; } }
    var Fmed = [];
    for (var m = 0; m < 5; m++) Fmed.push(D.median(F[m]));
    return {
      id: (meta && meta.id) || ('cal-' + Date.now()), createdAt: (meta && meta.createdAt) || new Date().toISOString(),
      deviceLabel: meta && meta.deviceLabel || '', deviceId: meta && meta.deviceId || '', sampleRate: sr, kernelVersion: D.VERSION,
      floorDb: floorDb, floorQ90Db: floorQ90, levelDb: levelDb, snrDb: snrDb, bandSnr: bandSnr,
      f0Med: D.median(f0s), F: Fmed, sfrMed: D.median(sfrs), nVoiced: aFrames.length,
      decayDbPerS: decay, decayMs: decayMs, floorSpectrumDb: silSpec ? silSpec.db : null,
      rmsTrack: Float32Array.from(rms), hopS: hopS, phases: PHASES.map(function (p) { return { key: p.key, seconds: p.seconds }; })
    };
  }

  /* Vergleich mit der letzten Kalibrierung: Liste von Warnungen (leer = Kette unverändert). */
  function compare(prev, cur) {
    var w = [];
    if (!prev) return w;
    if (isFinite(prev.floorDb) && isFinite(cur.floorDb) && cur.floorDb - prev.floorDb > 6) w.push('Rauschboden um ' + (cur.floorDb - prev.floorDb).toFixed(1) + ' dB gestiegen (' + prev.floorDb.toFixed(1) + ' → ' + cur.floorDb.toFixed(1) + ' dBFS)');
    if (isFinite(prev.snrDb) && isFinite(cur.snrDb) && prev.snrDb - cur.snrDb > 6) w.push('SNR um ' + (prev.snrDb - cur.snrDb).toFixed(1) + ' dB gefallen (' + prev.snrDb.toFixed(1) + ' → ' + cur.snrDb.toFixed(1) + ' dB)');
    if (prev.bandSnr && cur.bandSnr && isFinite(prev.bandSnr.sf) && isFinite(cur.bandSnr.sf) && prev.bandSnr.sf - cur.bandSnr.sf > 6) w.push('SNR im Sängerformantband um ' + (prev.bandSnr.sf - cur.bandSnr.sf).toFixed(1) + ' dB gefallen');
    if (isFinite(prev.decayDbPerS) && isFinite(cur.decayDbPerS) && prev.decayDbPerS > 0 && Math.abs(cur.decayDbPerS - prev.decayDbPerS) / prev.decayDbPerS > 0.5) w.push('Ausklang verändert (' + prev.decayDbPerS.toFixed(0) + ' → ' + cur.decayDbPerS.toFixed(0) + ' dB/s) — Raum oder Abstand anders?');
    for (var k = 0; k < 3; k++) if (prev.F && cur.F && isFinite(prev.F[k]) && isFinite(cur.F[k]) && Math.abs(cur.F[k] - prev.F[k]) > 150) w.push('F' + (k + 1) + ' des /a/ um ' + Math.abs(cur.F[k] - prev.F[k]).toFixed(0) + ' Hz verschoben');
    if (prev.deviceLabel && cur.deviceLabel && prev.deviceLabel !== cur.deviceLabel) w.push('Anderes Gerät: „' + prev.deviceLabel + '“ → „' + cur.deviceLabel + '“');
    return w;
  }

  var api = { PHASES: PHASES, VORLAUF_S: VORLAUF_S, totalSeconds: totalSeconds, phaseRange: phaseRange, phaseAt: phaseAt, analyseCalibration: analyseCalibration, compare: compare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VARECAL = api;
})(typeof self !== 'undefined' ? self : this);

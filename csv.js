/* VARE — CSV-Export und JSON-Sicherung
   Läuft im Browser (window.VARECSV) und unter Node (module.exports). Keine Abhängigkeiten.

   SPALTENFORMAT: Die Spaltenliste TAKE_COLUMNS ist ein abgeleiteter PLATZHALTER, bis das
   Zielformat nachgereicht ist. Sie ist die einzige Stelle, die beim Tausch angefasst werden muss:
   jede Zeile = { key, get(take) → Wert, dec (Nachkommastellen) }. Fehlende Zahlen werden als −99.00
   geschrieben (Sentinel), Texte in Anführungszeichen, Anführungszeichen verdoppelt. */
(function (root) {
  'use strict';

  var SENTINEL = -99;
  var DIALECTS = {
    standard: { sep: ',', dec: '.', bom: false, name: 'Standard (Komma, Punkt) — pandas' },
    excelde: { sep: ';', dec: ',', bom: true, name: 'Excel DE (Semikolon, Komma)' }
  };

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
    if (share) cols.push({ key: prefix + '_valid_share', get: g(key + '.share'), dec: 3 });
    return cols;
  }
  var TAKE_COLUMNS = [
    { key: 'code', get: g('code') },
    { key: 'label', get: g('label') },
    { key: 'datetime_iso', get: g('createdAt') },
    /* Schritt 0 aus dem Manual: ohne Uhrzeit, Position in der Sitzung, Pause davor und
       Einsing-Status sind zwei Takes nicht vergleichbar. datetime_iso ist UTC, time_local ist
       die Wanduhrzeit — beides steht da, damit keins aus dem anderen geraten werden muss. */
    { key: 'time_local', get: g('timeLocal') },
    { key: 'tz_offset_min', get: g('tzOffsetMin'), dec: 0 },
    { key: 'session_nr', get: g('sitzung.nr'), dec: 0 },
    { key: 'session_id', get: g('sitzung.id') },
    { key: 'take_in_session', get: g('sitzung.position'), dec: 0 },
    { key: 'pause_before_s', get: g('sitzung.pauseVorherS'), dec: 1 },
    { key: 'pause_same_session', get: g('sitzung.pauseSelbeSitzung'), dec: 0 },
    { key: 'warmup_state', get: g('sitzung.warmup') },
    { key: 'warmup_min', get: g('sitzung.warmupMin'), dec: 0 },
    { key: 'duration_s', get: g('durationS'), dec: 2 },
    { key: 'sample_rate', get: g('sampleRate'), dec: 0 },
    { key: 'device', get: g('deviceLabel') },
    { key: 'kernel_version', get: g('analysis.kernelVersion') },
    { key: 'calibration_id', get: g('calibrationId') },
    { key: 'vowel_intent', get: g('vowelIntent') },
    { key: 'vowel_class', get: g('summary.vowel.dominant') },
    { key: 'vowel_share', get: g('summary.vowel.dominantShare'), dec: 3 },
    { key: 'f0_med_hz', get: g('summary.f0.med'), dec: 1 },
    { key: 'f0_q1_hz', get: g('summary.f0.q1'), dec: 1 },
    { key: 'f0_q3_hz', get: g('summary.f0.q3'), dec: 1 },
    { key: 'f0_note', get: g('summary.f0.note') }
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
      { key: 'shr_med_db', get: g('summary.shr.med'), dec: 2 },
      { key: 'shr_max_db', get: g('summary.shr.max'), dec: 2 },
      { key: 'cpp_med_db', get: g('summary.cpp.med'), dec: 2 },
      { key: 'h1h2_med_db', get: g('summary.h1h2.med'), dec: 2 },
      { key: 'h1h2c_med_db', get: g('summary.h1h2c.med'), dec: 2 },
      { key: 'h1h2_unsure_share', get: g('summary.h1h2.unsureShare'), dec: 3 },
      { key: 'rms_med_dbfs', get: g('summary.rms.med'), dec: 2 },
      { key: 'rms_max_dbfs', get: g('summary.rms.max'), dec: 2 },
      { key: 'floor_dbfs', get: g('summary.floorDb'), dec: 2 },
      { key: 'floor_source', get: g('summary.floorSource') },
      { key: 'snr_db', get: g('summary.snrDb'), dec: 2 },
      { key: 'tube_cm', get: g('summary.tubeCm'), dec: 1 },
      { key: 'tube_q1', get: g('summary.tube.q1'), dec: 1 },
      { key: 'tube_q3', get: g('summary.tube.q3'), dec: 1 },
      { key: 'tube_n', get: g('summary.tube.n'), dec: 0 },
      { key: 'octave_corrected_share', get: g('summary.octaveCorrectedShare'), dec: 3 },
      { key: 'octave_ambiguous_share', get: g('summary.octaveAmbiguousShare'), dec: 3 },
      { key: 'slot_unsure_share', get: g('summary.slotUnsureShare'), dec: 3 },
      { key: 'jumps_held', get: g('summary.spruenge.gehalten'), dec: 0 },
      { key: 'jumps_edge', get: g('summary.spruenge.kante'), dec: 0 },
      { key: 'lambda_held_per_s', get: g('summary.spruenge.lambdaGehalten'), dec: 4 },
      { key: 'lambda_edge_per_s', get: g('summary.spruenge.lambdaKante'), dec: 4 },
      { key: 'voiced_share', get: g('summary.voicedShare'), dec: 3 },
      { key: 'valid_share', get: g('summary.validShare'), dec: 3 },
      { key: 'stable_share', get: g('summary.stableShare'), dec: 3 },
      { key: 'n_frames', get: g('summary.nFrames'), dec: 0 },
      { key: 'comment', get: g('comment') }
    ]);

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
    ['slot_unsure', 'slotUnsure', 0], ['n_peaks', 'nPeaks', 0],
    ['octave_corrected', function (s, i) { return (s.flags[i] & 2) ? 1 : 0; }, 0],
    ['octave_ambiguous', function (s, i) { return (s.flags[i] & 128) ? 1 : 0; }, 0],
    ['h1h2_unsure', function (s, i) { return (s.flags[i] & 8) ? 1 : 0; }, 0],
    ['flags', 'flags', 0]
  ];

  function fmtNum(v, dec, dialect) {
    if (v == null || (typeof v === 'number' && !isFinite(v))) v = SENTINEL;
    var s = (typeof v === 'number') ? v.toFixed(dec == null ? 2 : dec) : String(v);
    if (dialect.dec !== '.') s = s.replace('.', dialect.dec);
    return s;
  }
  function fmtCell(v, dec, dialect) {
    if (v == null) return (dec == null) ? '' : fmtNum(v, dec, dialect);   // Textspalte leer, Zahlenspalte Sentinel
    if (typeof v === 'number') return fmtNum(v, dec, dialect);
    if (typeof v === 'boolean') return v ? '1' : '0';
    var s = String(v);
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
  function framesToCsv(series, dialectName, VOWEL) {
    var d = DIALECTS[dialectName] || DIALECTS.standard;
    var lines = [FRAME_COLUMNS.map(function (c) { return c[0]; }).join(d.sep)];
    for (var i = 0; i < series.t.length; i++) {
      var cells = [];
      for (var c = 0; c < FRAME_COLUMNS.length; c++) {
        var col = FRAME_COLUMNS[c], v = (typeof col[1] === 'function') ? col[1](series, i, VOWEL) : series[col[1]][i];
        cells.push(fmtCell(v, col[2], d));
      }
      lines.push(cells.join(d.sep));
    }
    return (d.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
  }

  /* ---------- JSON-Sicherung ---------- */

  var TYPED = { Float32Array: Float32Array, Float64Array: Float64Array, Uint8Array: Uint8Array, Int8Array: Int8Array, Int16Array: Int16Array, Uint16Array: Uint16Array, Int32Array: Int32Array, Uint32Array: Uint32Array };

  /* Nicht endliche Zahlen: JSON kennt weder NaN noch Infinity und schreibt null. Zurückgelesen ist
     null aber keine Lücke, sondern fast überall 0 — isFinite(null) ist wahr, und die Chronik zeichnete
     nie gemessene Formanten bei 0 Hz (Bericht 4, Befund 5). Deshalb stehen sie in der Sicherung
     ausgeschrieben als {"$nf":"NaN"}, {"$nf":"Infinity"} oder {"$nf":"-Infinity"}. Ab Version 2. */
  var BACKUP_VERSION = 2;
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

  /* Serien: NaN bleibt wie bisher null (kompakt, Hunderttausende Werte je Take), ±Infinity wird
     ausgeschrieben — sonst käme es als NaN zurück. */
  function packSeries(series) {
    var out = {};
    for (var k in series) {
      var v = series[k];
      if (ArrayBuffer.isView(v)) {
        var arr = new Array(v.length), isF = (v instanceof Float32Array || v instanceof Float64Array);
        for (var i = 0; i < v.length; i++) arr[i] = isF ? (isFinite(v[i]) ? Math.round(v[i] * 1000) / 1000 : (v[i] !== v[i] ? null : { $nf: String(v[i]) })) : v[i];
        out[k] = { $type: v.constructor.name, data: arr };
      } else out[k] = nfSchreiben(v);
    }
    return out;
  }
  function unpackSeries(p) {
    var out = {};
    for (var k in p) {
      var v = p[k];
      if (v && v.$type && TYPED[v.$type]) {
        var T = TYPED[v.$type], arr = new T(v.data.length);
        for (var i = 0; i < v.data.length; i++) arr[i] = (v.data[i] == null) ? NaN : nfWert(v.data[i]);
        out[k] = arr;
      } else out[k] = nfLesen(v);
    }
    return out;
  }
  /* bundle = { takes: [take], series: { takeId: series }, refs, calibrations, settings, kernelVersion, exportedAt, audio?: {takeId: base64} } */
  /* Version 2 schreibt nicht endliche Zahlen aus (nfSchreiben). Eine ältere Seite lehnt sie deshalb
     als unbekannt ab, statt {"$nf":…} als Wert zu übernehmen und in der CSV „[object Object]“ zu
     schreiben. Version 1 bleibt lesbar; was sie als null trägt, bleibt null und gilt als fehlend. */
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
    if (o.version !== 1 && o.version !== BACKUP_VERSION) throw new Error('Sicherungsversion ' + o.version + ' unbekannt');
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

  var api = { SENTINEL: SENTINEL, BACKUP_VERSION: BACKUP_VERSION, DIALECTS: DIALECTS, TAKE_COLUMNS: TAKE_COLUMNS, FRAME_COLUMNS: FRAME_COLUMNS, takesToCsv: takesToCsv, framesToCsv: framesToCsv, fmtCell: fmtCell, serializeBackup: serializeBackup, parseBackup: parseBackup, packSeries: packSeries, unpackSeries: unpackSeries };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VARECSV = api;
})(typeof self !== 'undefined' ? self : this);

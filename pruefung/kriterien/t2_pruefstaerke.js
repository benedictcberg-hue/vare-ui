/* P2 — Prüfstärke CSV, WAV und SFR-Normierung.
   Die bestehenden Kriterien prüfen von 93 Take-Spalten rund zwölf und von 47 Rahmenspalten drei
   inhaltlich; jeder Text der Excel-DE-Prüfung enthielt ein '"' und wurde darum ohnehin gequotet.
   Man konnte q1 aus q3 lesen, valid3/valid4 vertauschen, das Quoting auf festes Komma stellen,
   die SFR-Normierung über den ganzen Take bilden oder die WAV-Begrenzung streichen — alles grün.
   Hier bekommt jede Spalte einen eigenen, eindeutigen Wert und wird Spalte für Spalte gegen ihren
   Sollpfad geprüft, in beiden Dialekten. Die Sollpfade stehen hier als eigene Tabelle und werden
   nicht aus csv.js gelesen: sonst ändert eine falsche Zuordnung Prüfling und Prüfung zugleich. */
'use strict';

/* Take-CSV: Spalte, Pfad im Take, Nachkommastellen ('text' = Text, 'bool' = Ja/Nein als 1/0). */
const TAKE_SOLL = [
  ['code', 'code', 'text'], ['label', 'label', 'text'], ['datetime_iso', 'createdAt', 'text'],
  ['time_local', 'timeLocal', 'text'], ['tz_offset_min', 'tzOffsetMin', 0], ['session_nr', 'sitzung.nr', 0],
  ['session_id', 'sitzung.id', 'text'], ['take_in_session', 'sitzung.position', 0], ['pause_before_s', 'sitzung.pauseVorherS', 1],
  ['pause_same_session', 'sitzung.pauseSelbeSitzung', 'bool'], ['warmup_state', 'sitzung.warmup', 'text'], ['warmup_min', 'sitzung.warmupMin', 0],
  ['duration_s', 'durationS', 2], ['sample_rate', 'sampleRate', 0], ['device', 'deviceLabel', 'text'],
  ['kernel_version', 'analysis.kernelVersion', 'text'], ['calibration_id', 'calibrationId', 'text'], ['vowel_intent', 'vowelIntent', 'text'],
  ['vowel_class', 'summary.vowel.dominant', 'text'], ['vowel_share', 'summary.vowel.dominantShare', 3],
  ['f0_med_hz', 'summary.f0.med', 1], ['f0_q1_hz', 'summary.f0.q1', 1], ['f0_q3_hz', 'summary.f0.q3', 1], ['f0_note', 'summary.f0.note', 'text'],
  ['f0_unsure_share', 'summary.f0UnsureShare', 3], ['f0_korrektur_share', 'summary.f0KorrekturShare', 3]
];
for (let k = 1; k <= 5; k++) {
  const p = 'summary.F.' + (k - 1) + '.';
  TAKE_SOLL.push(['f' + k + '_med', p + 'med', 1], ['f' + k + '_q1', p + 'q1', 1], ['f' + k + '_q3', p + 'q3', 1], ['f' + k + '_n', p + 'n', 0], ['f' + k + '_valid_share', p + 'share', 3]);
}
TAKE_SOLL.push(
  ['d34_med', 'summary.d34.med', 1], ['d34_q1', 'summary.d34.q1', 1], ['d34_q3', 'summary.d34.q3', 1], ['d34_n', 'summary.d34.n', 0],
  ['d34_stable_med', 'summary.d34stable.med', 1], ['d34_stable_n', 'summary.d34stable.n', 0], ['d34_best_sustained', 'summary.best.d34', 1],
  ['d34_best_vowel', 'summary.best.cls', 'text'], ['f3_stable_med', 'summary.f3stable.med', 1], ['f3_scored_med', 'summary.f3scored.med', 1],
  ['d45_med', 'summary.d45.med', 1], ['d45_q1', 'summary.d45.q1', 1], ['d45_q3', 'summary.d45.q3', 1], ['d45_n', 'summary.d45.n', 0],
  ['sfr_med_db', 'summary.sfr.med', 2], ['sfr_q1', 'summary.sfr.q1', 2], ['sfr_q3', 'summary.sfr.q3', 2],
  ['shr_med_db', 'summary.shr.med', 2], ['shr_max_db', 'summary.shr.max', 2],
  ['shr_unsure_share', 'summary.shrUnsureShare', 3], ['shr_unsure_max_db', 'summary.shrUnsureMax', 2], ['shr_other_max_db', 'summary.shrOtherMax', 2],
  ['cpp_med_db', 'summary.cpp.med', 2],
  ['h1h2_med_db', 'summary.h1h2.med', 2], ['h1h2c_med_db', 'summary.h1h2c.med', 2], ['h1h2_unsure_share', 'summary.h1h2.unsureShare', 3],
  ['rms_med_dbfs', 'summary.rms.med', 2], ['rms_max_dbfs', 'summary.rms.max', 2], ['floor_dbfs', 'summary.floorDb', 2],
  ['floor_source', 'summary.floorSource', 'text'], ['snr_db', 'summary.snrDb', 2],
  ['tube_cm', 'summary.tubeCm', 1], ['tube_q1', 'summary.tube.q1', 1], ['tube_q3', 'summary.tube.q3', 1], ['tube_n', 'summary.tube.n', 0],
  ['octave_corrected_share', 'summary.octaveCorrectedShare', 3], ['octave_ambiguous_share', 'summary.octaveAmbiguousShare', 3],
  ['slot_unsure_share', 'summary.slotUnsureShare', 3], ['jumps_held', 'summary.spruenge.gehalten', 0], ['jumps_edge', 'summary.spruenge.kante', 0],
  ['lambda_held_per_s', 'summary.spruenge.lambdaGehalten', 4], ['lambda_edge_per_s', 'summary.spruenge.lambdaKante', 4],
  ['voiced_share', 'summary.voicedShare', 3], ['valid_share', 'summary.validShare', 3], ['stable_share', 'summary.stableShare', 3],
  ['n_frames', 'summary.nFrames', 0], ['comment', 'comment', 'text']
);

/* Texte mit allen Fallen: Trenner des einen Dialekts ohne Anführungszeichen (Excel DE: 'x; y'),
   Anführungszeichen, Zeilenumbruch, Nicht-ASCII. Jeder Text ist eindeutig. */
const TEXTE = {
  code: 'AB', label: 'x; y', createdAt: '2026-09-03T10:00:00.000Z', timeLocal: '12:00', 'sitzung.id': 's-7, Abend',
  'sitzung.warmup': 'teilweise', deviceLabel: 'Mikro "USB"; Kanal 1, links', 'analysis.kernelVersion': 'kern-test',
  calibrationId: 'c-3', vowelIntent: 'ɔ', 'summary.vowel.dominant': 'ɐ', 'summary.f0.note': 'G3', 'summary.best.cls': 'ø',
  'summary.floorSource': 'estimate', comment: 'Zeile 1\r\nZeile 2; "x", y'
};

/* Rahmen-CSV: Spalte, Art, Quelle, Nachkommastellen.
   feld = Serienfeld; bit = [Feld, Bitmaske oder Name in A.FLAG]; gate = Wort zum Gatterzustand;
   vokal = Klassenname aus V.CENTROIDS; grund = Codefeld, in der CSV der Text des Kerns (GRUND_ZEILEN).
   Die Bitbedeutung folgt analysis.js (fillFrame, FLAG). */
const FRAME_SOLL = [
  ['t_s', 'feld', 't', 3], ['voiced', 'bit', ['flags', 'VOICED']], ['gate', 'gate'], ['vowel', 'vokal'],
  ['f0_hz', 'feld', 'f0', 2], ['ap', 'feld', 'ap', 3], ['rms_dbfs', 'feld', 'rms', 2]
];
for (let k = 1; k <= 5; k++) FRAME_SOLL.push(['f' + k, 'feld', 'f' + k, 1]);
for (let k = 1; k <= 5; k++) FRAME_SOLL.push(['valid' + k, 'bit', ['valid', 1 << (k - 1)]]);
for (const p of ['sdo', 'sdw', 'bw']) for (let k = 1; k <= 5; k++) FRAME_SOLL.push([p + k, 'feld', p + k, 1]);
FRAME_SOLL.push(
  ['d34', 'feld', 'd34', 1], ['d45', 'feld', 'd45', 1], ['score_d34', 'feld', 'score', 1],
  ['sfr_db', 'feld', 'sfr', 2], ['sfr_norm_db', 'feld', 'sfrn', 2], ['shr_db', 'feld', 'shr', 2], ['cpp_db', 'feld', 'cpp', 2],
  ['h1h2_db', 'feld', 'h1h2', 2], ['h1h2c_db', 'feld', 'h1h2c', 2],
  ['slot_unsure', 'feld', 'slotUnsure', 0], ['n_peaks', 'feld', 'nPeaks', 0],
  ['slot_grund1', 'slotgrund', 0], ['slot_grund2', 'slotgrund', 1], ['slot_grund3', 'slotgrund', 2], ['slot_grund4', 'slotgrund', 3], ['slot_grund5', 'slotgrund', 4],
  ['rauschboden1', 'bit', ['rauschBoden', 1]], ['rauschboden2', 'bit', ['rauschBoden', 2]], ['rauschboden3', 'bit', ['rauschBoden', 4]],
  ['rauschboden4', 'bit', ['rauschBoden', 8]], ['rauschboden5', 'bit', ['rauschBoden', 16]],
  ['octave_corrected', 'bit', ['flags', 'OCTAVE']], ['octave_ambiguous', 'bit', ['flags', 'OCTAMBIG']],
  ['h1h2_unsure', 'bit', ['flags', 'H1H2UNSURE']],
  ['f0_unsure', 'bit', ['flags', 'F0UNSURE']], ['f0_grund', 'grund', 'f0Grund'], ['f0_korrektur', 'grund', 'f0Korrektur'],
  ['f0_cep', 'feld', 'f0Cep', 2], ['f0_yin', 'feld', 'f0Yin', 2], ['octave_unter_grenze', 'bit', ['flags', 'OCTUNTER']],
  ['shr_grid_hz', 'feld', 'shrGrid', 2], ['shr_other_db', 'feld', 'shrOther', 2], ['shr_unsure', 'bit', ['flags', 'SHRUNSURE']], ['shr_grund', 'grund', 'shrGrund'],
  ['shr_kamm_db', 'feld', 'shrKamm', 2], ['shr_zweitpuls', 'feld', 'shrZweitpuls', 3],
  ['flags', 'feld', 'flags', 0]
);
/* Gründe je Zeile, Texte aus den Verträgen K3 (f0Grund, f0Korrektur) und K4 (shrGrund). In jeder Zeile
   tragen die drei Spalten verschiedene Texte, damit vertauschte Spalten auffallen. */
const GRUND_ZEILEN = {
  f0Grund: ['teiltonreihe', '', 'cepstrum', 'kein cepstrum', 'teiltonreihe', ''],
  f0Korrektur: ['', 'teiltonreihe', '', 'cepstrum', 'cepstrum', ''],
  shrGrund: ['kamm', 'zweitpuls', 'kamm+zweitpuls', 'grundton', 'kamm+zweitpuls+grundton', 'zweitpuls+grundton']
};

/* Grund je Slot (Vertrag K2, dsp.js slotGrund) je Zeile, als Sollwert der Spalten slot_grund1…5. Daraus werden
   slotUnsure und slotVerschmolzen der Serie gebaut, nicht umgekehrt. Jede Spalte hat ein eigenes Muster, und
   'nummer' und 'verschmolzen' stehen in verschiedenen Zeilen, damit vertauschte Spalten oder Texte auffallen.
   Rauschboden je Zeile als Maske (Bit k = Fk+1), Muster verschieden von valid1…5 und voneinander. */
const SLOTGRUND_ZEILEN = [
  ['nummer', '', 'verschmolzen', '', ''],
  ['', 'verschmolzen', '', 'nummer', ''],
  ['verschmolzen', '', 'nummer', '', 'verschmolzen'],
  ['', '', '', 'nummer', ''],
  ['', 'nummer', '', '', 'verschmolzen'],
  ['nummer', 'nummer', '', '', '']
];
const RAUSCHBODEN_ZEILEN = [2 | 16, 1 | 4, 4, 1 | 8, 16 | 8, 2 | 16 | 8];

/* CSV nach RFC 4180 lesen: Anführungszeichen, verdoppelte Anführungszeichen, Zeilenumbruch im Feld.
   Meldet Formfehler (Anführungszeichen mitten im ungequoteten Feld, LF ohne CR als Zeilenende). */
function parseCsv(text, sep) {
  const rows = [], errors = [];
  let row = [], cur = '', q = false, quotedField = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') {
      if (cur === '' && !quotedField) { q = true; quotedField = true; } else { errors.push('Anführungszeichen mitten im Feld, Zeile ' + (rows.length + 1)); cur += ch; }
    } else if (ch === sep) { row.push(cur); cur = ''; quotedField = false; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; quotedField = false; i++; }
    else if (ch === '\n') { errors.push('LF ohne CR als Zeilenende, Zeile ' + (rows.length + 1)); row.push(cur); rows.push(row); row = []; cur = ''; quotedField = false; }
    else cur += ch;
  }
  if (q) errors.push('Anführungszeichen nicht geschlossen');
  if (cur !== '' || row.length) { errors.push('letzte Zeile ohne CRLF'); row.push(cur); rows.push(row); }
  return { rows, errors };
}

function setPath(obj, path, v) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null) o[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = v;
}
/* undefined = Pfad fehlt; null unterwegs = ausdrücklich nicht vorhanden (zählt als vorhanden). */
function resolvePath(obj, path) {
  let o = obj;
  for (const p of path.split('.')) {
    if (o === null) return { found: true, v: null };
    if (o === undefined || typeof o !== 'object' || !(p in o)) return { found: false };
    o = o[p];
  }
  return { found: o !== undefined, v: o };
}

// Nachkommaanteil, der bei genau dec Stellen exakt darstellbar ist (auch als Float32).
const FRAC = { 0: 0, 1: 0.5, 2: 0.25, 3: 0.125, 4: 0.0625 };

/* Drei Take-Zeilen: (1) jede Spalte eindeutig befüllt, (2) jede Zahl NaN und jeder Text null,
   (3) leerer Take ohne Zusammenfassung. Liefert dazu die Sollwerte je Spalte (Zahl/Text/'fehlt'). */
function buildTakes() {
  const voll = {}, nan = {}, soll = {};
  let j = 0;
  for (const [key, path, dec] of TAKE_SOLL) {
    let v;
    if (dec === 'text') { v = TEXTE[path]; if (v === undefined) throw new Error('kein Text für ' + path); setPath(nan, path, null); }
    else if (dec === 'bool') { v = true; setPath(nan, path, NaN); }
    else { const mag = 1000 + 37 * j + FRAC[dec]; v = (j % 4 === 3) ? -mag : mag; j++; setPath(nan, path, NaN); }
    setPath(voll, path, v);
    soll[key] = v;
  }
  return { takes: [voll, nan, {}], soll };
}
function expectCell(dec, v, dialect) {
  const sep = dialect === 'excelde' ? ',' : '.';
  if (dec === 'text') return v == null ? '' : v;
  if (dec === 'bool') { if (typeof v === 'boolean') return v ? '1' : '0'; dec = 0; }
  const x = (typeof v === 'number' && isFinite(v)) ? v : -99;     // Sentinel −99 für fehlende Zahl
  return x.toFixed(dec).replace('.', sep);
}

/* Rahmenserie mit sechs Zeilen: 0..4 eindeutige Werte, Zeile 5 alle Gleitkommafelder NaN.
   Bits so verteilt, dass jede Bitspalte ein anderes Muster hat. */
function buildSeries(A) {
  const n = 6, s = A.makeSeries(n), F = A.FLAG;
  let c = 0;
  for (const [, kind, field, dec] of FRAME_SOLL) {
    if (kind !== 'feld' || !(s[field] instanceof Float32Array)) continue;
    for (let r = 0; r < n; r++) {
      const mag = 100 * (c + 1) + 10 * r + 1 + FRAC[dec];
      s[field][r] = (field !== 't' && r === 5) ? NaN : (c % 3 === 2 ? -mag : mag);
    }
    c++;
  }
  SLOTGRUND_ZEILEN.forEach((z, r) => {
    let u = 0, m = 0;
    z.forEach((t, k) => { if (t) u |= 1 << k; if (t === 'verschmolzen') m |= 1 << k; });
    s.slotUnsure[r] = u; if (s.slotVerschmolzen) s.slotVerschmolzen[r] = m;
  });
  if (s.rauschBoden) RAUSCHBODEN_ZEILEN.forEach((v, r) => { s.rauschBoden[r] = v; });
  [5, 4, 3, 2, 1, 0].forEach((v, r) => { s.nPeaks[r] = v; });
  [1, 2, 4, 8, 16, 22].forEach((v, r) => { s.valid[r] = v; });
  [F.VOICED, F.OCTAVE | F.SCORE, F.H1H2UNSURE | F.SUBGRID, F.OCTAMBIG | F.D34VALID,
    F.VOICED | F.OCTAVE | F.H1H2UNSURE | F.OCTAMBIG | F.VOWELAMBIG | F.D45VALID, 0].forEach((v, r) => { s.flags[r] = v; });
  // Grundton- und SHR-Bits mit eigenen Mustern (F0UNSURE 0,3; OCTUNTER 2,3; SHRUNSURE 0,2,3; F0KORR 1),
  // verschieden von denen oben und voneinander. Fehlt ein Name in A.FLAG, reißt P2f/P2g.
  [F.F0UNSURE | F.SHRUNSURE, F.F0KORR, F.OCTUNTER | F.SHRUNSURE, F.F0UNSURE | F.OCTUNTER | F.SHRUNSURE, 0, 0].forEach((v, r) => { s.flags[r] |= (v || 0); });
  for (const feld in GRUND_ZEILEN) if (s[feld]) GRUND_ZEILEN[feld].forEach((t, r) => { s[feld][r] = A.codeAus(feld, t); });
  [0, 1, 2, 2, 1, 0].forEach((v, r) => { s.gate[r] = v; });
  [-1, 0, 3, 9, 5, -1].forEach((v, r) => { s.cls[r] = v; });
  return s;
}
function expectFrame(entry, s, r, dialect, A, V) {
  const [, kind, src, dec] = entry;
  if (kind === 'feld') return expectCell(dec, s[src][r], dialect);
  // Fehlt das Serienfeld, reißt die Zelle (P2f/P2g) statt einer Ausnahme, die die übrigen Kriterien verdeckt.
  if (kind === 'bit') { const mask = typeof src[1] === 'number' ? src[1] : A.FLAG[src[1]]; return s[src[0]] ? ((s[src[0]][r] & mask) ? '1' : '0') : '(Serienfeld ' + src[0] + ' fehlt)'; }
  if (kind === 'gate') { for (const w in A.GATE_CODE) if (A.GATE_CODE[w] === s.gate[r]) return w; return '?'; }
  if (kind === 'vokal') return s.cls[r] >= 0 ? V.CENTROIDS[s.cls[r]].cls : '';
  if (kind === 'grund') return GRUND_ZEILEN[src][r];
  if (kind === 'slotgrund') return SLOTGRUND_ZEILEN[r][src];
  throw new Error('Art ' + kind);
}

/* WAV von Hand bauen: fmt-Block wahlweise als WAVE_FORMAT_EXTENSIBLE mit Subformat-GUID. */
function wavBuild(chunks) {
  let n = 12; for (const [, b] of chunks) n += 8 + b.length + (b.length & 1);
  const buf = new ArrayBuffer(n), u = new Uint8Array(buf), dv = new DataView(buf);
  const tag = (o, t) => { for (let i = 0; i < 4; i++) u[o + i] = t.charCodeAt(i); };
  tag(0, 'RIFF'); dv.setUint32(4, n - 8, true); tag(8, 'WAVE');
  let o = 12;
  for (const [id, b] of chunks) { tag(o, id); dv.setUint32(o + 4, b.length, true); u.set(b, o + 8); o += 8 + b.length + (b.length & 1); }
  return buf;
}
function fmtExt(sub, ch, sr, bits, cbSize) {
  const len = cbSize == null ? 40 : 18 + cbSize, b = new Uint8Array(len), dv = new DataView(b.buffer);
  dv.setUint16(0, 0xFFFE, true); dv.setUint16(2, ch, true); dv.setUint32(4, sr, true);
  dv.setUint32(8, sr * ch * bits / 8, true); dv.setUint16(12, ch * bits / 8, true); dv.setUint16(14, bits, true);
  dv.setUint16(16, cbSize == null ? 22 : cbSize, true);
  if (len >= 40) {
    dv.setUint16(18, bits, true); dv.setUint32(20, ch === 1 ? 4 : 3, true);
    // KSDATAFORMAT_SUBTYPE_*: Formatcode, dann 0000-0010-8000-00AA00389B71
    const guid = [0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xAA, 0, 0x38, 0x9B, 0x71];
    dv.setUint16(24, sub, true); for (let i = 0; i < guid.length; i++) b[26 + i] = guid[i];
  }
  return b;
}

module.exports = async function (H) {
  const { check, r1, r2, concat, noise, SR, BW5, CASES, D, V, A, C, W } = H;

  /* ---------- Take-CSV ---------- */
  const T = buildTakes();
  {
    const keys = C.TAKE_COLUMNS.map(c => c.key), soll = TAKE_SOLL.map(e => e[0]);
    const ohneSoll = keys.filter(k => soll.indexOf(k) < 0), fehlt = soll.filter(k => keys.indexOf(k) < 0);
    const doppelt = keys.filter((k, i) => keys.indexOf(k) !== i);
    check('P2a', 'Take-CSV: jede Spalte hat einen Sollpfad, keine Sollspalte fehlt, keine doppelt', !ohneSoll.length && !fehlt.length && !doppelt.length && keys.length === soll.length,
      keys.length + ' Spalten' + (ohneSoll.length ? ', ohne Sollpfad: ' + ohneSoll.join(',') : '') + (fehlt.length ? ', fehlen: ' + fehlt.join(',') : '') + (doppelt.length ? ', doppelt: ' + doppelt.join(',') : ''));
  }
  for (const [dialect, sep, id] of [['standard', ',', 'P2b'], ['excelde', ';', 'P2c']]) {
    const text = C.takesToCsv(T.takes, dialect), bom = text.charCodeAt(0) === 0xFEFF;
    const { rows, errors } = parseCsv(bom ? text.slice(1) : text, sep), head = rows[0] || [];
    const bad = [];
    if (bom !== (dialect === 'excelde')) bad.push('BOM ' + (bom ? 'vorhanden' : 'fehlt'));
    if (rows.length !== 4) bad.push(rows.length + ' Zeilen statt 4');
    rows.forEach((r, i) => { if (r.length !== head.length) bad.push('Zeile ' + i + ': ' + r.length + ' statt ' + head.length + ' Felder'); });
    let geprueft = 0;
    for (const [key, , dec] of TAKE_SOLL) {
      const c = head.indexOf(key);
      if (c < 0) { bad.push(key + ' fehlt im Kopf'); continue; }
      const want = [expectCell(dec, T.soll[key], dialect), expectCell(dec, null, dialect), expectCell(dec, undefined, dialect)];
      for (let r = 1; r <= 3; r++) { const got = rows[r] && rows[r][c]; if (got !== want[r - 1]) bad.push(key + '[' + r + '] ' + JSON.stringify(got) + ' statt ' + JSON.stringify(want[r - 1])); else geprueft++; }
    }
    check(id, 'Take-CSV ' + dialect + ': jede Spalte trägt den Wert ihres Pfads, fehlende Zahl −99, fehlender Text leer (3 Zeilen)', !errors.length && !bad.length && geprueft === 3 * TAKE_SOLL.length,
      geprueft + '/' + 3 * TAKE_SOLL.length + ' Zellen' + (errors.length ? '; Form: ' + errors.slice(0, 2).join('; ') : '') + (bad.length ? '; ' + bad.length + ' falsch: ' + bad.slice(0, 4).join('; ') : ''));
  }
  {
    // Text mit dem Trenner des Dialekts, aber ohne '"' und ohne Zeilenumbruch: wird nur durch den
    // Trenner zum Quoting-Fall. Fehlt es, zerfällt die Zeile (Excel DE: 'x; y' wird zwei Zellen).
    const res = [];
    let ok = true;
    for (const [dialect, sep, txt] of [['excelde', ';', 'x; y'], ['standard', ',', 'x, y']]) {
      const take = { code: 'Q', label: txt, comment: 'gut' + sep + ' etwas gepresst' };
      const text = C.takesToCsv([take], dialect), { rows, errors } = parseCsv(text.replace(/^﻿/, ''), sep);
      const head = rows[0], row = rows[1] || [];
      const good = !errors.length && rows.length === 2 && row.length === head.length && row[head.indexOf('label')] === take.label && row[head.indexOf('comment')] === take.comment && row[head.indexOf('code')] === 'Q';
      ok = ok && good;
      res.push(dialect + ' ' + row.length + '/' + head.length + ' Felder, label ' + JSON.stringify(row[head.indexOf('label')]));
    }
    check('P2d', 'CSV: Text mit dem Dialekt-Trenner ohne Anführungszeichen bleibt eine Zelle (Excel DE ";", Standard ",")', ok, res.join(' | '));
  }

  /* ---------- Rahmen-CSV ---------- */
  const S = buildSeries(A);
  {
    const keys = C.FRAME_COLUMNS.map(c => c[0]), soll = FRAME_SOLL.map(e => e[0]);
    const ohneSoll = keys.filter(k => soll.indexOf(k) < 0), fehlt = soll.filter(k => keys.indexOf(k) < 0);
    const doppelt = keys.filter((k, i) => keys.indexOf(k) !== i);
    check('P2e', 'Rahmen-CSV: jede Spalte hat eine Sollquelle, keine Sollspalte fehlt, keine doppelt', !ohneSoll.length && !fehlt.length && !doppelt.length && keys.length === soll.length,
      keys.length + ' Spalten' + (ohneSoll.length ? ', ohne Sollquelle: ' + ohneSoll.join(',') : '') + (fehlt.length ? ', fehlen: ' + fehlt.join(',') : '') + (doppelt.length ? ', doppelt: ' + doppelt.join(',') : ''));
  }
  for (const [dialect, sep, id] of [['standard', ',', 'P2f'], ['excelde', ';', 'P2g']]) {
    const text = C.framesToCsv(S, dialect, V), bom = text.charCodeAt(0) === 0xFEFF;
    const { rows, errors } = parseCsv(bom ? text.slice(1) : text, sep), head = rows[0] || [];
    const bad = [];
    if (bom !== (dialect === 'excelde')) bad.push('BOM ' + (bom ? 'vorhanden' : 'fehlt'));
    if (rows.length !== 7) bad.push(rows.length + ' Zeilen statt 7');
    rows.forEach((r, i) => { if (r.length !== head.length) bad.push('Zeile ' + i + ': ' + r.length + ' statt ' + head.length + ' Felder'); });
    let geprueft = 0;
    for (const e of FRAME_SOLL) {
      const c = head.indexOf(e[0]);
      if (c < 0) { bad.push(e[0] + ' fehlt im Kopf'); continue; }
      for (let r = 0; r < 6; r++) {
        const want = expectFrame(e, S, r, dialect, A, V), got = rows[r + 1] && rows[r + 1][c];
        if (got !== want) bad.push(e[0] + '[' + r + '] ' + JSON.stringify(got) + ' statt ' + JSON.stringify(want)); else geprueft++;
      }
    }
    check(id, 'Rahmen-CSV ' + dialect + ': jede Spalte trägt ihr Feld bzw. Bit, NaN → −99 (6 Zeilen)', !errors.length && !bad.length && geprueft === 6 * FRAME_SOLL.length,
      geprueft + '/' + 6 * FRAME_SOLL.length + ' Zellen' + (errors.length ? '; Form: ' + errors.slice(0, 2).join('; ') : '') + (bad.length ? '; ' + bad.length + ' falsch: ' + bad.slice(0, 4).join('; ') : ''));
  }

  /* ---------- SFR normiert je Halbton (Physik §7.1: SFR − median(SFR | gleicher Halbton, gleicher Take)) ---------- */
  const semitone = f => Math.round(69 + 12 * Math.log2(f / 440));
  const med = v => { const s = v.filter(isFinite).sort((a, b) => a - b), m = s.length >> 1; return !s.length ? NaN : s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]); };
  {
    // Konstruierte Serie: vier Halbtongruppen, Grenzfall der Rundung (107 und 113 Hz → A2, 116,5 Hz → A#2),
    // ein stimmloser Rahmen mit hohem SFR (darf in keinen Median) und ein stimmhafter ohne SFR.
    const fr = [[110, -20], [113, -16], [107, -18], [116.5, -30], [196, -12], [200, -10], [196, -9], [196, -8], [294, -4], [294, -2], [196, 40, 0], [294, NaN]];
    const s = A.makeSeries(fr.length);
    fr.forEach(([f0, sfr, fl], i) => { s.t[i] = 0.01 * i; s.f0[i] = f0; s.sfr[i] = sfr; s.flags[i] = fl === 0 ? 0 : A.FLAG.VOICED; });
    const back = A.normaliseSfr(s), groups = {};
    fr.forEach(([f0, sfr, fl]) => { if (fl !== 0 && isFinite(sfr)) (groups[semitone(f0)] = groups[semitone(f0)] || []).push(sfr); });
    const bad = [];
    let entscheidend = 0;
    const alle = [].concat(...Object.values(groups)), gesamt = med(alle);
    fr.forEach(([f0, sfr, fl], i) => {
      const want = (fl !== 0 && isFinite(sfr)) ? sfr - med(groups[semitone(f0)]) : NaN, got = s.sfrn[i];
      if (isFinite(want) && Math.abs(want - (sfr - gesamt)) > 0.01) entscheidend++;
      if (isNaN(want) ? !isNaN(got) : !(Math.abs(got - want) < 1e-4)) bad.push(f0 + ' Hz: ' + r2(got) + ' statt ' + r2(want));
    });
    const gk = Object.keys(groups).sort(), bk = Object.keys(back || {}).sort();
    if (gk.join() !== bk.join() || gk.some(g => !(Math.abs(back[g] - med(groups[g])) < 1e-4))) bad.push('Mediane je Halbton ' + JSON.stringify(back) + ' statt ' + JSON.stringify(Object.fromEntries(gk.map(g => [g, med(groups[g])]))));
    check('P2h', 'SFR normiert: jeder Rahmen relativ zum Median seines Halbtons, stimmlose und fehlende Werte zählen nicht', !bad.length && entscheidend >= 8 && gk.length === 4,
      gk.length + ' Halbtöne, ' + entscheidend + ' Rahmen weichen vom Gesamtmedian-Ergebnis ab' + (bad.length ? '; falsch: ' + bad.slice(0, 4).join('; ') : ''));
  }
  let takeZwei = null;
  {
    // Ganzer Take, gleicher Vokal auf zwei Tönen eine Quinte auseinander (G3, D4): roher SFR
    // unterscheidet sich je Ton um mehrere dB (Physik §7.1, Falle a). Der bestehende T14 prüft den
    // Gesamtmedian an einem Take mit nur einem Ton — dort ist jede Normierung gleich.
    const sil = noise(Math.round(0.4 * SR), 1e-3, 11);
    const sig = concat([sil, D.synthVowel(196, CASES[0].F, BW5, 1.5, SR), D.synthVowel(294, CASES[0].F, BW5, 1.5, SR), sil]);
    takeZwei = await A.analyseTake(sig, SR, {});
    /* Der Halbton kommt aus F0. Seit der Gegenprobe des Grundtons (K3) kann ein Rahmen einen Grundton
       tragen, der als unsicher markiert ist (F0UNSURE, z. B. 98 Hz am Übergang statt 196 Hz). Dessen
       Halbton ist nicht bekannt: Er bildet keine Gruppe und geht in keinen Median ein, sonst stünde er
       allein in seiner Gruppe mit „normiert 0“. Geprüft wird darum je Halbton über die sicheren Rahmen,
       und jeder unsichere Rahmen einzeln: gegen den Median der sicheren Rahmen seines Halbtons, ohne
       solche NaN. */
    const s = takeZwei.series, raw = {}, nrm = {}, UNS = A.FLAG.F0UNSURE || 0, unsicher = [];
    for (let i = 0; i < s.t.length; i++) {
      if (!(s.flags[i] & A.FLAG.VOICED) || !isFinite(s.sfr[i])) continue;
      if (s.flags[i] & UNS) { unsicher.push(i); continue; }
      const m = semitone(s.f0[i]);
      (raw[m] = raw[m] || []).push(s.sfr[i]); (nrm[m] = nrm[m] || []).push(s.sfrn[i]);
    }
    const gross = Object.keys(raw).filter(m => raw[m].length >= 50).sort((a, b) => a - b);
    const spanne = gross.length >= 2 ? Math.max(...gross.map(m => med(raw[m]))) - Math.min(...gross.map(m => med(raw[m]))) : 0;
    const bad = Object.keys(nrm).filter(m => !(Math.abs(med(nrm[m])) < 0.01));
    const badU = unsicher.filter(i => { const g = raw[semitone(s.f0[i])], want = g ? s.sfr[i] - med(g) : NaN; return isNaN(want) ? !isNaN(s.sfrn[i]) : !(Math.abs(s.sfrn[i] - want) < 1e-3); });
    check('P2i', 'SFR normiert, Take mit zwei Tönen: Median je Halbton 0 (|x| < 0,01 dB) über die Rahmen mit sicherem Grundton; Rahmen mit unsicherem Grundton gegen deren Median, ohne ihn NaN', !bad.length && !badU.length && gross.length >= 2 && spanne >= 1,
      gross.map(m => 'MIDI ' + m + ' n=' + raw[m].length + ' roh ' + r2(med(raw[m])) + ' norm ' + r2(med(nrm[m]))).join(' | ') + ', Spanne roh ' + r2(spanne) + ' dB, Grundton unsicher ' + unsicher.length + (bad.length ? '; ungleich 0: ' + bad.map(m => m + ':' + r2(med(nrm[m]))).join(' ') : '') + (badU.length ? '; unsicher falsch: ' + badU.map(i => r1(s.f0[i]) + ' Hz ' + r2(s.sfrn[i])).join(' ') : ''));
  }
  {
    // Sollpfade gegen eine echte Auswertung: ein Pfad, den analyseTake nicht liefert, ergäbe in
    // der CSV still dauerhaft −99 für einen gemessenen Wert.
    const sum = takeZwei.summary, ser = takeZwei.series, n = ser.t.length, fehlt = [];
    for (const [key, path] of TAKE_SOLL) if (path.indexOf('summary.') === 0 && !resolvePath({ summary: sum }, path).found) fehlt.push(key + '←' + path);
    for (const [name, kind, src] of FRAME_SOLL) {
      const field = kind === 'feld' || kind === 'grund' ? src : kind === 'bit' ? src[0] : kind === 'gate' ? 'gate' : kind === 'slotgrund' ? 'slotVerschmolzen' : 'cls';
      if (!(ArrayBuffer.isView(ser[field]) && ser[field].length === n)) fehlt.push(name + '←' + field);
      if (kind === 'bit' && typeof src[1] === 'string' && typeof A.FLAG[src[1]] !== 'number') fehlt.push(name + '←FLAG.' + src[1]);
    }
    const nSum = TAKE_SOLL.filter(e => e[1].indexOf('summary.') === 0).length;
    check('P2j', 'Sollpfade existieren in der Auswertung von analyseTake (Zusammenfassung und Serie)', !fehlt.length && sum.best !== null,
      nSum + ' Zusammenfassungs-, ' + FRAME_SOLL.length + ' Rahmenpfade' + (sum.best === null ? ', kein Bestsegment im Prüftake' : '') + (fehlt.length ? '; fehlen: ' + fehlt.join(', ') : ''));
  }

  /* ---------- WAV ---------- */
  {
    // 16 Bit: Werte jenseits ±1 werden begrenzt. Ohne Begrenzung läuft Int16 über und kippt das
    // Vorzeichen (1,5 → −0,5) — ein still erfundenes Signal in der Archivdatei.
    const x = [0, 0.25, -0.25, 1, -1, 1.5, -1.5, 2.75, -4, 1.0000001], clamp = v => Math.max(-1, Math.min(1, v));
    const buf = W.encode(Float64Array.from(x), 48000, 'i16'), dv = new DataView(buf), dec = W.decode(buf).samples, bad = [];
    x.forEach((v, i) => {
      const raw = dv.getInt16(44 + 2 * i, true), want = Math.round(clamp(v) * 32767);
      if (raw !== want || !(Math.abs(dec[i] - clamp(v)) <= 1 / 32767) || (v !== 0 && Math.sign(dec[i]) !== Math.sign(v))) bad.push(v + ' → ' + raw + ' / ' + dec[i].toFixed(5));
    });
    check('P2k', 'WAV 16 Bit: Werte jenseits ±1 auf ±32767 begrenzt, kein Überlauf mit Vorzeichenwechsel', !bad.length && dv.byteLength === 44 + 2 * x.length, bad.length ? bad.join('; ') : x.length + ' Werte');
    const f = W.decode(W.encode(Float64Array.from(x), 48000, 'f32')), fbad = x.filter((v, i) => f.samples[i] !== Math.fround(v));
    check('P2k', 'WAV Float32: Werte jenseits ±1 bleiben unverändert (keine stille Begrenzung)', !fbad.length && f.format === 'f32', fbad.length ? 'verändert: ' + fbad.join(', ') : '');
  }
  {
    // WAVE_FORMAT_EXTENSIBLE: das Format steht im Subformat-GUID. Wer es übergeht und PCM annimmt,
    // liest Gleitkomma-Bytes als Ganzzahlen — falsche Werte ohne Fehlermeldung.
    const pcm = (vals, put, bytes) => { const b = new Uint8Array(vals.length * bytes), dv = new DataView(b.buffer); vals.forEach((v, i) => put(dv, i * bytes, v)); return b; };
    const f32 = (dv, o, v) => dv.setFloat32(o, v, true), f64 = (dv, o, v) => dv.setFloat64(o, v, true);
    const i24 = (dv, o, v) => { const u = v < 0 ? v + 0x1000000 : v; dv.setUint8(o, u & 255); dv.setUint8(o + 1, (u >> 8) & 255); dv.setUint8(o + 2, (u >> 16) & 255); };
    const mono = [0.5, -0.25, 0.125, -1, 0.75], stereo = [0.5, 0.25, -1, 1, 0.125, -0.375], ints = [4194304, -2097152, 8388607, -8388608, 1];
    const faelle = [
      ['Float32 mono', wavBuild([['fmt ', fmtExt(3, 1, 48000, 32)], ['data', pcm(mono, f32, 4)]]), mono, 'f32'],
      ['Float32 stereo', wavBuild([['fmt ', fmtExt(3, 2, 44100, 32)], ['data', pcm(stereo, f32, 4)]]), [0.375, 0, 0.5 * (0.125 - 0.375)], 'f32'],
      ['Float64 mono', wavBuild([['fmt ', fmtExt(3, 1, 48000, 64)], ['data', pcm(mono, f64, 8)]]), mono, 'f32'],
      ['PCM 24 Bit', wavBuild([['fmt ', fmtExt(1, 1, 48000, 24)], ['data', pcm(ints, i24, 3)]]), ints.map(v => v / 8388608), 'pcm']
    ];
    const res = [];
    let ok = true;
    for (const [nm, buf, want, form] of faelle) {
      let d = null, err = '';
      try { d = W.decode(buf); } catch (e) { err = e.message; }
      const good = d && d.format === form && d.samples.length === want.length && want.every((v, i) => Math.abs(d.samples[i] - v) < 1e-7);
      ok = ok && !!good;
      res.push(nm + (good ? ' ok' : ' falsch: ' + (err || d.format + ' ' + Array.from(d.samples).map(v => v.toPrecision(4)).join(' '))));
    }
    check('P2l', 'WAV EXTENSIBLE: Subformat entscheidet (Float32 mono/stereo, Float64, PCM 24 Bit)', ok, res.join(' | '));
    // Unbekanntes Subformat (ADPCM = 2) oder fmt-Block ohne Subformat: ablehnen statt als PCM lesen.
    const abl = [];
    for (const [nm, buf] of [['Subformat 2', wavBuild([['fmt ', fmtExt(2, 1, 48000, 16)], ['data', new Uint8Array(8)]])],
      ['ohne Subformat (cbSize 0)', wavBuild([['fmt ', fmtExt(1, 1, 48000, 16, 0)], ['data', new Uint8Array(8)]])]]) {
      let thrown = false; try { W.decode(buf); } catch (e) { thrown = true; }
      abl.push(nm + (thrown ? ' abgelehnt' : ' GELESEN'));
    }
    check('P2m', 'WAV EXTENSIBLE: unbekanntes oder fehlendes Subformat wird abgelehnt, nicht still als PCM gelesen', abl.every(s => /abgelehnt$/.test(s)), abl.join(' | '));
  }
};

// Sollpfade für Gegenproben außerhalb des Prüflaufs (z. B. Einlesen mit einem anderen CSV-Leser).
module.exports.TAKE_SOLL = TAKE_SOLL;
module.exports.FRAME_SOLL = FRAME_SOLL;

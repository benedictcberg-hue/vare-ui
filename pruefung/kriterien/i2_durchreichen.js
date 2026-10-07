/* I2 — Grundton- und SHR-Unsicherheit bis in Serie, Zusammenfassung, CSV und Anzeige.
   Der Rechenkern liefert je Rahmen, ob der Grundton die Gegenprobe besteht (f0Unsure, f0Grund, f0Cep),
   ob er korrigiert wurde (f0Korrektur, f0Yin), ob die Teilerkontrolle unter 60 Hz nicht geteilt hat
   (octaveUnterGrenze) und ob das SHR-Raster zweifelhaft ist (shrUnsure, shrOther, shrGrund, shrKamm,
   shrZweitpuls). Vorher endete das alles in analyseAt: Die Serie speicherte nichts davon, die
   Zusammenfassung mischte unsichere Rahmen in F0-Median, Note und SHR-Maximum, CSV und Anzeige kannten
   die Felder nicht.
   Prüftake: Stücke, an denen der Kern die Fälle tatsächlich meldet — enger Cluster 335,7 Hz mit 2 %
   Jitter (Gegenprobe gerissen und korrigiert), /a/ 150 Hz mit jedem zweiten Impuls halb so stark
   (SHR-Raster zweifelhaft, beide Werte), /a/ 80 Hz ebenso (Reihe bei 40 Hz, nicht geteilt), enger
   Cluster 348,2 Hz (YIN eine Oktave tief, korrigiert). Die Sollwerte kommen aus analyseAt selbst,
   Rahmen für Rahmen, nicht aus den Marken der Serie. */
'use strict';
const path = require('path');

module.exports = async function (H) {
  const { check, r1, r2, noise, concat, SR, TSR, D, A } = H;
  const lcg = seed => { let z = seed >>> 0; return () => { z = (z * 1664525 + 1013904223) >>> 0; return z / 4294967296; }; };
  function pulse(times, amps, s, F, B) {
    const n = Math.round(s * SR), src = new Float64Array(n);
    for (let k = 0; k < times.length; k++) {
      const pos = times[k] * SR, i0 = Math.floor(pos), q = pos - i0;
      for (let j = 0; j < 6; j++) { const w = amps[k] * Math.cos(Math.PI * j / 12); if (i0 + j < n) src[i0 + j] += w * (1 - q); if (i0 + j + 1 < n) src[i0 + j + 1] += w * q; }
    }
    let y = src; for (let m = 0; m < F.length; m++) y = D.resonate(y, F[m], B[m], SR);
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i]));
    for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / mx;
    return y;
  }
  // Fester Grundton mit Jitter j (relativ, gleichverteilt je Periode)
  function jitter(f0, s, F, B, j, seed) {
    const rnd = lcg(seed), times = [], amps = []; let t = 0;
    while (t < s) { times.push(t); amps.push(1); t += (1 + j * (2 * rnd() - 1)) / f0; }
    return pulse(times, amps, s, F, B);
  }
  const ENG = [[500, 1500, 2450, 2800, 3150], [70, 90, 90, 90, 100]], AV = [[700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200]];
  const SIG = concat([noise(Math.round(0.3 * SR), 2e-4, 3),
    jitter(335.7, 0.8, ENG[0], ENG[1], 0.02, Math.round(335.7 * 13)),
    D.synthVowel(150, AV[0], AV[1], 0.6, SR, { altRatio: 0.5 }),
    D.synthVowel(80, AV[0], AV[1], 0.6, SR, { altRatio: 0.5 }),
    D.synthVowel(348.2, ENG[0], ENG[1], 0.6, SR),
    noise(Math.round(0.3 * SR), 2e-4, 4)]);

  /* ---------- I2a: Serie ---------- */
  const res = await A.analyseTake(SIG, SR, {});
  const ser = res.series, n = ser.t.length;
  // Dieselben Rahmen wie analyseTake: Raster 10 ms, Rand 30 ms, Boden aus dem Take (keine Kalibrierung).
  const ds = D.resample(SIG, SR, TSR), hop = Math.round(0.010 * TSR), half = Math.round(0.03 * TSR);
  const floorDb = A.estimateFloor(ds, TSR, 0.010).db, R = [];
  for (let c = half; c + half <= ds.length; c += hop) R.push(D.analyseAt(ds, TSR, c, { align: 'centre', floorDb, spreadMaxHz: D.SPREAD_MAX_HZ }));
  const F = A.FLAG || {}, f32 = v => Math.fround(v);
  const gleichZahl = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b;
  const FELDER = ['f0Cep', 'f0Yin', 'shrGrid', 'shrOther', 'shrKamm', 'shrZweitpuls'];
  const CODES = [['f0Grund', 'f0Grund'], ['f0Korrektur', 'f0Korrektur'], ['shrGrund', 'shrGrund']];
  const BITS = [['F0UNSURE', 'f0Unsure'], ['F0KORR', 'f0Korrektur'], ['SHRUNSURE', 'shrUnsure'], ['OCTUNTER', 'octaveUnterGrenze']];
  {
    const bad = [], fall = { unsicher: 0, korrigiert: 0, shrZweifel: 0, anderesRaster: 0, unterGrenze: 0 }, gruende = {};
    if (R.length !== n) bad.push(n + ' Rahmen in der Serie, ' + R.length + ' nachgerechnet');
    for (const f of FELDER) if (!(ser[f] instanceof Float32Array)) bad.push(f + ' fehlt oder ist kein Float32Array');
    for (const [f] of CODES) if (!(ser[f] instanceof Uint8Array)) bad.push(f + ' fehlt oder ist kein Uint8Array');
    for (const [b] of BITS) if (typeof F[b] !== 'number' || F[b] < 512 || F[b] > 32768) bad.push('FLAG.' + b + ' fehlt oder liegt auf einem belegten Bit');
    if (!bad.length) {
      for (let i = 0; i < Math.min(n, R.length); i++) {
        const r = R[i];
        for (const f of FELDER) if (!gleichZahl(ser[f][i], f32(r[f]))) bad.push(f + '[' + i + '] ' + ser[f][i] + ' statt ' + r[f]);
        for (const [f, rf] of CODES) { const t = A.textAus(f, ser[f][i]); if (t !== r[rf]) bad.push(f + '[' + i + '] „' + t + '“ statt „' + r[rf] + '“'); }
        for (const [b, rf] of BITS) if (!!(ser.flags[i] & F[b]) !== !!r[rf]) bad.push(b + '[' + i + '] ' + !!(ser.flags[i] & F[b]) + ' statt ' + !!r[rf]);
        if (r.voiced) {
          if (r.f0Unsure) { fall.unsicher++; gruende[r.f0Grund] = 1; }
          if (r.f0Korrektur) fall.korrigiert++;
          if (r.shrUnsure) fall.shrZweifel++;
          if (isFinite(r.shrOther)) fall.anderesRaster++;
          if (r.octaveUnterGrenze) fall.unterGrenze++;
        }
      }
    }
    const alleFaelle = Object.values(fall).every(v => v >= 10) && gruende.teiltonreihe && gruende.cepstrum;
    check('I2a', 'Serie trägt je Rahmen f0Cep, f0Yin, shrGrid, shrOther, shrKamm, shrZweitpuls (Float32), f0Grund, f0Korrektur, shrGrund (Code, zurückgelesen = Text des Kerns) und die Bits F0UNSURE, F0KORR, SHRUNSURE, OCTUNTER — Rahmen für Rahmen gleich analyseAt',
      !bad.length && alleFaelle, n + ' Rahmen; Fälle ' + JSON.stringify(fall) + ', Gründe ' + Object.keys(gruende).join('/') + (bad.length ? ' — ' + bad.length + ' Abweichungen: ' + bad.slice(0, 4).join('; ') : ''));
  }
  {
    // Gründe: jeder Text aus den Verträgen von K3 und K4 wird ein Code und kommt zurück; ein unbekannter
    // Text wird nicht still zu '' (sonst stünde ein unsicherer Rahmen ohne Grund da).
    const VERTRAG = { f0Grund: ['teiltonreihe', 'cepstrum', 'kein cepstrum'], f0Korrektur: ['teiltonreihe', 'cepstrum'],
      shrGrund: ['kamm', 'zweitpuls', 'grundton', 'kamm+zweitpuls', 'kamm+grundton', 'zweitpuls+grundton', 'kamm+zweitpuls+grundton'] };
    const bad = [];
    let geprueft = 0;
    try {
      for (const f in VERTRAG) {
        const codes = new Set();
        for (const t of VERTRAG[f]) { const c = A.codeAus(f, t); codes.add(c); geprueft++; if (!(c > 0 && c < 255) || A.textAus(f, c) !== t) bad.push(f + ' „' + t + '“ → ' + c + ' → „' + A.textAus(f, c) + '“'); }
        if (codes.size !== VERTRAG[f].length) bad.push(f + ': Codes nicht eindeutig');
        if (A.codeAus(f, '') !== 0 || A.textAus(f, 0) !== '') bad.push(f + ': leer ↔ 0 nicht');
        const u = A.codeAus(f, 'neuer grund');
        if (!u || A.textAus(f, u) === '') bad.push(f + ': unbekannter Text wird still leer');
      }
    } catch (e) { bad.push('Ausnahme ' + e.message); }
    check('I2a', 'Gründe als Codes: jeder Text aus den Verträgen K3/K4 eindeutig hin und zurück, leer ↔ 0, unbekannter Text bleibt sichtbar („?“), nie still leer', !bad.length && geprueft === 12,
      geprueft + ' Texte' + (bad.length ? '; ' + bad.join('; ') : ''));
  }
  {
    // Speicher: alle Felder typisiert, Gründe 1 Byte je Rahmen. Texte je Rahmen in gewöhnlichen Arrays
    // sprengten bei langen Takes Speicher und Sicherung.
    const s = A.makeSeries(1000), lose = Object.keys(s).filter(k => !ArrayBuffer.isView(s[k]));
    let bytes = 0; for (const k of Object.keys(s)) if (ArrayBuffer.isView(s[k])) bytes += s[k].byteLength;
    const codeBytes = CODES.map(([f]) => s[f] ? s[f].BYTES_PER_ELEMENT : 0);
    check('I2a', 'Speicher: jedes Serienfeld typisiert, Gründe 1 Byte je Rahmen; je Rahmen ' + (bytes / 1000) + ' Byte, eine Stunde bei 10 ms ' + (bytes / 1000 * 360000 / 1e6).toFixed(0) + ' MB',
      !lose.length && codeBytes.every(b => b === 1), (lose.length ? 'nicht typisiert: ' + lose.join(',') + ' ' : '') + 'Bytes je Grund ' + codeBytes.join('/'));
  }
  {
    // Sicherung → Import: die neuen Felder kommen als typisierte Felder zurück, NaN bleibt NaN, Codes exakt.
    const H2 = H.C.parseBackup(H.C.serializeBackup({ takes: [{ id: 'i2' }], series: { i2: ser }, refs: null, calibrations: [], settings: null })).series.i2;
    const bad = [];
    for (const f of FELDER) {
      if (!(H2[f] instanceof Float32Array)) { bad.push(f + ' kein Float32Array'); continue; }
      for (let i = 0; i < n; i++) if (Number.isNaN(ser[f][i]) ? !Number.isNaN(H2[f][i]) : !(Math.abs(H2[f][i] - ser[f][i]) <= 1e-3)) { bad.push(f + '[' + i + '] ' + ser[f][i] + ' → ' + H2[f][i]); break; }
    }
    for (const [f] of CODES) if (!(H2[f] instanceof Uint8Array) || Array.from(H2[f]).join() !== Array.from(ser[f] || []).join()) bad.push(f + ' verändert');
    if (!(H2.flags instanceof Uint16Array) || Array.from(H2.flags).join() !== Array.from(ser.flags).join()) bad.push('flags verändert');
    const nanOther = ser.shrOther ? Array.from(ser.shrOther).filter(Number.isNaN).length : 0;
    check('I2a', 'Sicherung → Import: Grundton- und SHR-Felder, Codes und Bits kommen unverändert zurück (NaN bleibt NaN, Zahlen auf 0,001)', !bad.length && nanOther > 0,
      nanOther + ' Rahmen ohne anderes Raster' + (bad.length ? '; ' + bad.slice(0, 4).join('; ') : ''));
  }

  /* ---------- I2b: Zusammenfassung ---------- */
  {
    const su = res.summary, V = R.filter(r => r.voiced), nv = V.length;
    const stat = (vals, extra) => A.stats(vals, extra);
    const sicher = V.filter(r => !r.f0Unsure), shrS = V.filter(r => !r.shrUnsure), shrU = V.filter(r => r.shrUnsure);
    const soll = {
      f0: stat(sicher.map(r => f32(r.f0))),
      f0UnsureShare: V.filter(r => r.f0Unsure).length / nv,
      f0KorrekturShare: V.filter(r => r.f0Korrektur).length / nv,
      octaveCorrectedShare: V.filter(r => r.octaveCorrected || r.f0Korrektur).length / nv,
      shr: stat(shrS.map(r => f32(r.shr)), true),
      shrUnsureShare: shrU.length / nv,
      shrUnsureMax: stat(shrU.map(r => f32(r.shr)), true).max,
      shrOtherMax: stat(V.map(r => f32(r.shrOther)), true).max,
      h1h2: stat(V.filter(r => !r.h1h2unsure && !r.f0Unsure).map(r => f32(r.h1h2))),
      h1h2c: stat(sicher.map(r => f32(r.h1h2c)))
    };
    const nah = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || (typeof a === 'number' && Math.abs(a - b) < 1e-9);
    const bad = [];
    for (const k of ['med', 'q1', 'q3', 'n']) { if (!nah(su.f0 && su.f0[k], soll.f0[k])) bad.push('f0.' + k + ' ' + (su.f0 && su.f0[k]) + ' statt ' + soll.f0[k]); }
    if (!su.f0 || su.f0.note !== D.hzToNote(soll.f0.med)) bad.push('Note ' + (su.f0 && su.f0.note) + ' statt ' + D.hzToNote(soll.f0.med));
    for (const k of ['med', 'n', 'max', 'min']) if (!nah(su.shr && su.shr[k], soll.shr[k])) bad.push('shr.' + k + ' ' + (su.shr && su.shr[k]) + ' statt ' + soll.shr[k]);
    for (const k of ['f0UnsureShare', 'f0KorrekturShare', 'octaveCorrectedShare', 'shrUnsureShare', 'shrUnsureMax', 'shrOtherMax']) if (!nah(su[k], soll[k])) bad.push(k + ' ' + su[k] + ' statt ' + soll[k]);
    for (const k of ['med', 'n']) { if (!nah(su.h1h2 && su.h1h2[k], soll.h1h2[k])) bad.push('h1h2.' + k + ' ' + (su.h1h2 && su.h1h2[k]) + ' statt ' + soll.h1h2[k]); if (!nah(su.h1h2c && su.h1h2c[k], soll.h1h2c[k])) bad.push('h1h2c.' + k + ' ' + (su.h1h2c && su.h1h2c[k]) + ' statt ' + soll.h1h2c[k]); }
    // Entscheidend: gemischt käme etwas anderes heraus (sonst prüfte das Kriterium nichts).
    const gemischtF0 = stat(V.map(r => f32(r.f0))), gemischtShr = stat(V.map(r => f32(r.shr)), true);
    const entscheidend = gemischtF0.n !== soll.f0.n && gemischtShr.max !== soll.shr.max && soll.f0UnsureShare > 0.05 && soll.f0KorrekturShare > 0.05 && soll.shrUnsureShare > 0.05;
    check('I2b', 'Zusammenfassung: F0 und Note nur aus Rahmen ohne f0Unsure, SHR nur ohne shrUnsure, H1−H2 und H1*−H2* ohne f0Unsure; Anteile f0Unsure, f0Korrektur, shrUnsure; shrUnsureMax, shrOtherMax; korrigiert zählt Teilerkontrolle und Gegenprobe',
      !bad.length && entscheidend,
      'stimmhaft ' + nv + ', F0 n ' + soll.f0.n + ' (gemischt ' + gemischtF0.n + '), Note ' + D.hzToNote(soll.f0.med) + ', SHR max ' + r1(soll.shr.max) + ' (gemischt ' + r1(gemischtShr.max) + '), unsicher ' + r2(soll.f0UnsureShare) + ', korrigiert ' + r2(soll.f0KorrekturShare) + ', SHR unsicher ' + r2(soll.shrUnsureShare)
      + (bad.length ? ' — ' + bad.length + ' falsch: ' + bad.slice(0, 4).join('; ') : ''));
  }
  {
    // SFR je Halbton: Ein Rahmen mit unsicherem Grundton steht womöglich im falschen Halbton und geht in
    // keinen Median ein. Er selbst wird gegen seine Gruppe gerechnet, ohne sichere Gruppe bleibt er NaN.
    const fr = [[196, -10], [196, -12], [196, -14], [196, 30, 'u'], [196, 31, 'u'], [196, 32, 'u'], [294, -4], [294, -6], [98, 20, 'u']];
    const s = A.makeSeries(fr.length);
    fr.forEach(([f0, sfr, u], i) => { s.t[i] = 0.01 * i; s.f0[i] = f0; s.sfr[i] = sfr; s.flags[i] = A.FLAG.VOICED | (u ? (A.FLAG.F0UNSURE || 0) : 0); });
    const med = A.normaliseSfr(s), bad = [];
    const soll = [2, 0, -2, 42, 43, 44, 1, -1, NaN];
    soll.forEach((w, i) => { if (Number.isNaN(w) ? !Number.isNaN(s.sfrn[i]) : !(Math.abs(s.sfrn[i] - w) < 1e-4)) bad.push(fr[i][0] + ' Hz ' + fr[i][1] + ' dB: ' + r2(s.sfrn[i]) + ' statt ' + w); });
    const gk = Object.keys(med || {}).sort().join(',');
    if (gk !== '55,62') bad.push('Gruppen ' + gk + ' statt 55,62');
    check('I2b', 'SFR je Halbton: Rahmen mit unsicherem Grundton gehen in keinen Halbton-Median ein; ihr Wert gegen den Median der sicheren Rahmen, ohne sichere Gruppe NaN', !bad.length,
      'Mediane ' + JSON.stringify(med) + (bad.length ? '; ' + bad.join('; ') : ''));
  }
};

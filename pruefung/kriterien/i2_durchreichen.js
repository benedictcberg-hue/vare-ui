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
   Rahmen für Rahmen, nicht aus den Marken der Serie.
   I2a Serie und Sicherung, I2b Zusammenfassung, I2c CSV, I2d Anzeige (chronik.js und app.js in einer
   vm-Umgebung wie in u_oberflaeche.js; die Farben im echten Browser prüft pruefung/browser-test.js). */
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

  /* ---------- I2c: CSV ---------- */
  const zeilen = (text, sep) => text.replace(/^﻿/, '').split('\r\n').filter(z => z !== '').map(z => z.split(sep));
  const zahlZelle = (v, dec) => (typeof v === 'number' && isFinite(v) ? v : -99).toFixed(dec);
  {
    // Rahmen-CSV des Prüftakes gegen analyseAt: Gründe als Text, Marken 0/1, Zahlen mit −99 für fehlend.
    // Die Gründe enthalten weder Komma noch Anführungszeichen, ein schlichtes Teilen reicht hier.
    const z = zeilen(H.C.framesToCsv(ser, 'standard', H.V), ','), kopf = z[0], bad = [];
    const SOLL = [['f0_unsure', r => r.f0Unsure ? '1' : '0'], ['f0_grund', r => r.f0Grund], ['f0_korrektur', r => r.f0Korrektur],
      ['f0_cep', r => zahlZelle(f32(r.f0Cep), 2)], ['f0_yin', r => zahlZelle(f32(r.f0Yin), 2)], ['octave_unter_grenze', r => r.octaveUnterGrenze ? '1' : '0'],
      ['shr_grid_hz', r => zahlZelle(f32(r.shrGrid), 2)], ['shr_other_db', r => zahlZelle(f32(r.shrOther), 2)], ['shr_unsure', r => r.shrUnsure ? '1' : '0'],
      ['shr_grund', r => r.shrGrund], ['shr_kamm_db', r => zahlZelle(f32(r.shrKamm), 2)], ['shr_zweitpuls', r => zahlZelle(f32(r.shrZweitpuls), 3)]];
    let geprueft = 0;
    const texte = new Set();
    for (const [k, f] of SOLL) {
      const c = kopf.indexOf(k);
      if (c < 0) { bad.push(k + ' fehlt'); continue; }
      for (let i = 0; i < R.length; i++) {
        const want = f(R[i]), got = z[i + 1] && z[i + 1][c];
        if (got !== want) { if (bad.length < 6) bad.push(k + '[' + i + '] ' + JSON.stringify(got) + ' statt ' + JSON.stringify(want)); } else geprueft++;
        if (/grund|korrektur/.test(k) && want) texte.add(want);
      }
    }
    check('I2c', 'Rahmen-CSV: f0_unsure, f0_grund, f0_korrektur, f0_cep, f0_yin, octave_unter_grenze, shr_grid_hz, shr_other_db, shr_unsure, shr_grund, shr_kamm_db, shr_zweitpuls Rahmen für Rahmen gleich analyseAt (Gründe als Text, fehlend −99)',
      !bad.length && geprueft === SOLL.length * R.length && texte.size >= 4, geprueft + '/' + SOLL.length * R.length + ' Zellen, Gründe ' + [...texte].join(' | ') + (bad.length ? ' — ' + bad.join('; ') : ''));
  }
  {
    // Take-CSV: die neuen Anteile und Höchstwerte aus der Zusammenfassung; F0- und SHR-Spalten aus den sicheren Rahmen.
    const su = res.summary, take = { code: 'I', summary: su }, z = zeilen(H.C.takesToCsv([take], 'standard'), ','), kopf = z[0], w = z[1] || [], bad = [];
    const SOLL = [['f0_unsure_share', su.f0UnsureShare, 3], ['f0_korrektur_share', su.f0KorrekturShare, 3], ['shr_unsure_share', su.shrUnsureShare, 3],
      ['shr_unsure_max_db', su.shrUnsureMax, 2], ['shr_other_max_db', su.shrOtherMax, 2], ['shr_max_db', su.shr && su.shr.max, 2], ['f0_med_hz', su.f0 && su.f0.med, 1]];
    for (const [k, v, dec] of SOLL) { const c = kopf.indexOf(k); if (c < 0) bad.push(k + ' fehlt'); else if (w[c] !== zahlZelle(v, dec)) bad.push(k + ' ' + w[c] + ' statt ' + zahlZelle(v, dec)); }
    check('I2c', 'Take-CSV: f0_unsure_share, f0_korrektur_share, shr_unsure_share, shr_unsure_max_db, shr_other_max_db aus der Zusammenfassung (im Prüftake alle gemessen)',
      !bad.length && SOLL.every(e => isFinite(e[1])), SOLL.map(([k, v, dec]) => k + ' ' + zahlZelle(v, dec)).join(', ') + (bad.length ? ' — ' + bad.join('; ') : ''));
  }
  {
    // Ältere Serie (vor der Gegenprobe gespeichert, ohne die neuen Felder): Ein Bit 0 hieße dort „sicher“,
    // ist aber unbekannt — −99, Gründe leer, kein Absturz; alle übrigen Spalten wie zuvor.
    const alt = {};
    for (const k in ser) if (FELDER.concat(CODES.map(c => c[0])).indexOf(k) < 0) alt[k] = ser[k];
    const NEU = ['f0_unsure', 'f0_grund', 'f0_korrektur', 'f0_cep', 'f0_yin', 'octave_unter_grenze', 'shr_grid_hz', 'shr_other_db', 'shr_unsure', 'shr_grund', 'shr_kamm_db', 'shr_zweitpuls'];
    const bad = [];
    let za = null, zv = null;
    try { za = zeilen(H.C.framesToCsv(alt, 'excelde', H.V), ';'); zv = zeilen(H.C.framesToCsv(ser, 'excelde', H.V), ';'); } catch (e) { bad.push('Ausnahme ' + e.message); }
    if (za) {
      const kopf = za[0];
      for (const k of NEU) {
        const c = kopf.indexOf(k);
        if (c < 0) { bad.push(k + ' fehlt'); continue; }
        const text = /grund|korrektur/.test(k), werte = new Set(za.slice(1).map(r => r[c]));
        if (werte.size !== 1 || !(text ? werte.has('') : /^-99(,0+)?$/.test([...werte][0]))) bad.push(k + ' ' + [...werte].slice(0, 3).join('/'));
      }
      kopf.forEach((k, c) => { if (NEU.indexOf(k) < 0 && za.some((r, i) => r[c] !== zv[i][c])) bad.push(k + ' verändert'); });
    }
    const altTake = zeilen(H.C.takesToCsv([{ code: 'A', summary: { f0: { med: 110, q1: 100, q3: 120, n: 50 }, shr: { med: -30, max: -20, n: 50 } } }], 'standard'), ',');
    for (const k of ['f0_unsure_share', 'f0_korrektur_share', 'shr_unsure_share', 'shr_unsure_max_db', 'shr_other_max_db']) { const c = altTake[0].indexOf(k); if (c < 0 || !/^-99\.0+$/.test(altTake[1][c])) bad.push('Take ' + k + ' ' + (c < 0 ? 'fehlt' : altTake[1][c])); }
    check('I2c', 'Ältere Serie und Zusammenfassung ohne die neuen Felder: Marken und Zahlen −99, Gründe leer (nicht 0 = „sicher“), übrige Spalten unverändert, kein Absturz',
      !bad.length, bad.length ? bad.slice(0, 5).join('; ') : NEU.length + ' Rahmenspalten, 5 Take-Spalten');
  }

  /* ---------- I2d: Anzeige (chronik.js und app.js in einer vm-Umgebung, wie in u_oberflaeche.js) ---------- */
  const vm = require('vm'), fs = require('fs');
  const ROOT = path.join(__dirname, '..', '..'), quelle = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  // Zeichenfläche, die Aufrufe UND gesetzte Farben in Reihenfolge mitschreibt.
  function leinwand() {
    const ops = [];
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { ops.push([k, a]); }), set: (t, k, v) => { t[k] = v; ops.push(['set', k, v]); return true; } });
    return { cv: { clientWidth: 450, style: {}, getContext: () => ctx }, ops };
  }
  // Punkte mit Farbe: [{ art: 'fill'|'stroke', farbe, x, y, w, h }] für Rechtecke der Größe 2 oder 3.
  function punkte(ops) {
    const out = []; let fill = '', stroke = '';
    for (const [k, a, v] of ops) {
      if (k === 'set') { if (a === 'fillStyle') fill = v; if (a === 'strokeStyle') stroke = v; continue; }
      if ((k === 'fillRect' || k === 'strokeRect') && (a[2] === 2 || a[2] === 3) && a[2] === a[3]) out.push({ art: k === 'fillRect' ? 'fill' : 'stroke', farbe: k === 'fillRect' ? fill : stroke, x: a[0], y: a[1] });
    }
    return out;
  }
  function kacheln(html) {
    const out = [], re = /<div class="stat([^"]*)"><span class="k">([\s\S]*?)<\/span><span class="v">([\s\S]*?)<\/span><\/div>/g;
    let m;
    while ((m = re.exec(html))) out.push({ klasse: m[1].trim(), k: m[2].replace(/<[^>]+>/g, ''), v: m[3].replace(/<[^>]+>/g, ''), vHtml: m[3] });
    return out;
  }
  const chronikSb = () => {
    const sb = { console: { log() { }, warn() { }, error() { } }, devicePixelRatio: 1 };
    sb.self = sb; sb.window = sb; vm.createContext(sb);
    for (const f of ['dsp.js', 'vowel.js', 'analysis.js', 'csv.js', 'chronik.js']) vm.runInContext(quelle(f), sb, { filename: f });
    return sb;
  };
  const sb = chronikSb(), CHR = sb.VARECHRONIK, COL = CHR.COL;
  const fmt = (v, d) => CHR.fmt(v, d);
  const finde = (bed) => { for (let i = 0; i < R.length; i++) if (R[i].voiced && bed(R[i])) return i; return -1; };
  {
    // Hover an echten Rahmen des Prüftakes: unsicher in Rost mit Grund, korrigiert mit altem Wert ohne Rost.
    const bad = [], belege = [];
    const iU = finde(r => r.f0Unsure && r.f0Grund === 'cepstrum'), iT = finde(r => r.f0Unsure && r.f0Grund === 'teiltonreihe');
    const iK = finde(r => r.f0Korrektur && !r.octaveAmbiguous && !r.shrUnsure), iS = finde(r => r.shrUnsure && !r.f0Unsure && isFinite(r.shrOther));
    const iO = finde(r => r.octaveUnterGrenze), iN = finde(r => !r.f0Unsure && !r.f0Korrektur && !r.octaveAmbiguous && !r.octaveCorrected && !r.shrUnsure);
    if ([iU, iT, iK, iS, iO, iN].some(i => i < 0)) bad.push('Fall fehlt im Prüftake: ' + [iU, iT, iK, iS, iO, iN].join(','));
    const hov = i => { try { return CHR.hoverText(ser, i); } catch (e) { return 'AUSNAHME ' + e.message; } };
    const rostTeile = h => (h.match(/<span class="rust">[^<]*<\/span>/g) || []).map(x => x.replace(/<[^>]+>/g, ''));
    const ohneSpans = h => h.replace(/<span class="rust">|<\/span>/g, '');
    const pruef = (name, i, soll, kein) => {
      if (i < 0) return;
      const h = hov(i), rost = rostTeile(h).join(' ‖ ');
      for (const [teil, text] of soll) if (!(teil === 'rost' ? rost : ohneSpans(h)).includes(text)) bad.push(name + ': „' + text + '“ fehlt' + (teil === 'rost' ? ' in Rost' : '') + ' — ' + ohneSpans(h).slice(0, 160));
      for (const text of kein || []) if (rost.includes(text)) bad.push(name + ': „' + text + '“ in Rost');
      if (/</.test(ohneSpans(h))) bad.push(name + ': HTML außer den Rost-Marken');
      belege.push(name + ' ' + (rost || 'kein Rost'));
    };
    if (iU >= 0) pruef('unsicher/Cepstrum', iU, [['rost', 'F0 ' + fmt(R[iU].f0, 1) + ' (Grundton unsicher: Cepstrum zeigt ' + fmt(R[iU].f0Cep, 1) + ' Hz'], ['rost', 'H1−H2'], ['rost', 'Grundton unsicher)'], ['rost', 'SHR ' + fmt(R[iU].shr, 1)]]);
    if (iT >= 0) pruef('unsicher/Teiltonreihe', iT, [['rost', 'Grundton unsicher: eigene Teiltonreihe fehlt']]);
    if (iK >= 0) pruef('korrigiert', iK, [['text', 'F0 ' + fmt(R[iK].f0, 1) + ' (korrigiert aus ' + fmt(R[iK].f0Yin, 1) + ' Hz, ' + (R[iK].f0Korrektur === 'cepstrum' ? 'Cepstrum' : 'Teiltonreihe') + ')']], ['F0', 'korrigiert']);
    if (iS >= 0) {
      const r = R[iS], anders = r.shrGrid > 1.5 * r.f0 ? r.f0 : 2 * r.f0;
      // Grund in Worten, hier unabhängig von chronik.js gebildet (Vertrag K4: Teile in fester Reihenfolge)
      const grundWorte = r.shrGrund.split('+').map(t => t === 'kamm' ? 'Kamm ' + fmt(r.shrKamm, 1) + ' dB' : t === 'zweitpuls' ? 'zweite Anregung ' + fmt(r.shrZweitpuls, 2) : t === 'grundton' ? 'Grundton unsicher' : '?').join(', ');
      pruef('SHR-Zweifel', iS, [['rost', 'SHR ' + fmt(r.shr, 1) + ' (Raster ' + fmt(r.shrGrid) + ' Hz) / ' + fmt(r.shrOther, 1) + ' (Raster ' + fmt(anders) + ' Hz), unsicher: ' + grundWorte]], ['F0']);
    }
    if (iO >= 0) pruef('unter 60 Hz', iO, [['rost', 'Reihe unter 60 Hz, nicht geteilt']]);
    if (iN >= 0 && rostTeile(hov(iN)).length) bad.push('sicherer Rahmen mit Rost: ' + hov(iN).slice(0, 120));
    check('I2d', 'Hover (Detail): unsicherer Grundton samt SHR und H1−H2 in Rost mit Grund (Cepstrum-Wert bzw. fehlende Teiltonreihe), korrigierter mit altem Wert ohne Rost, SHR-Zweifel mit beiden Werten und Rastern in Rost, „Reihe unter 60 Hz, nicht geteilt“; sicherer Rahmen ohne Rost',
      !bad.length, bad.length ? bad.slice(0, 4).join(' | ') : belege.join(' | ').slice(0, 400));
  }
  {
    // F0-Spur: Rost hohl für unsicher (F0UNSURE oder Oktave offen), Gold für korrigiert, nie Rost für Korrektur.
    const l = leinwand(); let fehler = '';
    try { CHR.drawLanes(l.cv, ser, {}, null); } catch (e) { fehler = e.message; }
    const p0 = punkte(l.ops).filter(p => p.y >= 8 && p.y <= 91);
    const zahl = (art, farbe) => p0.filter(p => p.art === art && p.farbe === farbe).length;
    let sollU = 0, sollK = 0, sollN = 0;
    for (let i = 0; i < R.length; i++) {
      if (!R[i].voiced) continue;
      if (R[i].f0Unsure || R[i].octaveAmbiguous) sollU++; else if (R[i].f0Korrektur || R[i].octaveCorrected) sollK++; else sollN++;
    }
    const ist = { rostHohl: zahl('stroke', COL.rust), gold: zahl('fill', COL.gold), hell: zahl('fill', COL.ink), rostVoll: zahl('fill', COL.rust) };
    check('I2d', 'Chronik, F0-Spur: unsichere Rahmen hohl in Rost, korrigierte in Gold (nicht Rost), übrige hell',
      !fehler && ist.rostHohl === sollU && ist.gold === sollK && ist.hell === sollN && ist.rostVoll === 0 && sollU > 0 && sollK > 0,
      (fehler ? 'Ausnahme ' + fehler + ' | ' : '') + 'Soll unsicher ' + sollU + ', korrigiert ' + sollK + ', übrig ' + sollN + ' | Ist ' + JSON.stringify(ist));
  }
  {
    // Detail und Liste mit der Zusammenfassung des Prüftakes und Abwandlungen.
    const El = function () { this.innerHTML = ''; };
    El.prototype.querySelector = function () { return { addEventListener() { }, value: '', hidden: false, getContext: () => leinwand().cv.getContext() }; };
    El.prototype.querySelectorAll = function () { return []; };
    const detail = su => { const d = new El(); CHR.renderDetail(d, { id: 'i2', code: 'I', label: 'Prüftake', createdAt: '2026-03-02T09:00:00.000Z', durationS: 3, analysis: { kernelVersion: D.VERSION, gate: { f3MinHz: 2500 } }, summary: su }, null, {}, false, {}); return kacheln(d.innerHTML); };
    const k = (ks, re) => ks.find(x => re.test(x.k)) || { klasse: '?', v: '', vHtml: '' };
    const bad = [], su = res.summary, mit = o => Object.assign(JSON.parse(JSON.stringify(su)), o);
    let ks = [], f0 = k([], /x/), shr = f0, okt = f0;
    // Eine fehlende Funktion oder Ausnahme reißt dieses Kriterium, nicht das ganze Modul.
    try {
      ks = detail(su);
      f0 = k(ks, /^F0 Median/); shr = k(ks, /^SHR/); okt = k(ks, /korrigiert/);
      const h12 = k(ks, /^H1−H2/);
      const pz = x => CHR.prozent ? CHR.prozent(x) : String(Math.round(x * 100));
      if (!new RegExp('<span class="rust">· Grundton unsicher in ' + pz(su.f0UnsureShare) + ' % der Rahmen, nicht im Median</span>').test(f0.vHtml) || f0.klasse !== '') bad.push('F0 „' + f0.v + '“ (' + f0.klasse + ')');
      if (!f0.v.startsWith(fmt(su.f0.med) + ' [')) bad.push('F0-Median fehlt: ' + f0.v);
      if (!/<span class="rust">· unsicher in [^<]* %: bis -?[\d.]+ dB, anderes Raster bis -?[\d.]+ dB<\/span>/.test(shr.vHtml) || !shr.v.includes(fmt(su.shrUnsureMax, 1)) || !shr.v.includes(fmt(su.shrOtherMax, 1))) bad.push('SHR „' + shr.v + '“');
      if (!/ohne [^)]* % mit unsicherem Grundton/.test(h12.v)) bad.push('H1−H2 „' + h12.v + '“');
      if (!/^Grundton korrigiert · Oktave unsicher$/.test(okt.k) || !okt.v.startsWith(pz(su.octaveCorrectedShare) + ' (Gegenprobe ' + pz(su.f0KorrekturShare) + ')')) bad.push('Korrektur-Kachel „' + okt.k + '“ „' + okt.v + '“');
      // Abwandlungen: viele Korrekturen ohne offene Oktave → kein Rost; überwiegend unsicher → Rost; SHR-Warnung nur aus sicheren Rahmen.
      const kor = k(detail(mit({ octaveCorrectedShare: 0.6, f0KorrekturShare: 0.4, octaveAmbiguousShare: 0 })), /korrigiert/);
      if (kor.klasse !== '') bad.push('60 % korrigiert, Oktave nie offen: Kachel „' + kor.klasse + '“ statt ohne Rost');
      const viel = detail(mit({ f0UnsureShare: 0.7, shrUnsureShare: 0.7 }));
      if (k(viel, /^F0 Median/).klasse !== 'unsure' || k(viel, /^SHR/).klasse !== 'unsure') bad.push('70 % unsicher: F0 „' + k(viel, /^F0 Median/).klasse + '“, SHR „' + k(viel, /^SHR/).klasse + '“ statt unsure');
      const keineWarnung = k(detail(mit({ shr: Object.assign({}, su.shr, { max: -30 }), shrUnsureMax: -8, shrOtherMax: -12 })), /^SHR/);
      if (keineWarnung.klasse === 'befund') bad.push('Warnung aus unsicheren Rahmen (sicher max −30, unsicher bis −8)');
      // Kleiner Anteil: „< 1 %“, im HTML maskiert (ein rohes „<“ im Markup verschluckt das Auslesen nach Tags).
      const klein = mit({ f0UnsureShare: 0.004, shrUnsureShare: 0.003, octaveCorrectedShare: 0.002, f0KorrekturShare: 0.002 }), kk = detail(klein);
      for (const [name, re, soll] of [['F0', /^F0 Median/, /&lt; 1 % der Rahmen/], ['SHR', /^SHR/, /unsicher in &lt; 1 %/], ['Korrektur', /korrigiert/, /^&lt; 1 \(Gegenprobe &lt; 1\) · /], ['H1−H2', /^H1−H2/, /ohne &lt; 1 %/]]) {
        const h = k(kk, re).vHtml;
        if (!soll.test(h) || /< 1/.test(h)) bad.push(name + ' bei kleinem Anteil: „' + h.slice(0, 120) + '“');
      }
      const alt = mit({}); for (const f of ['f0UnsureShare', 'f0KorrekturShare', 'shrUnsureShare', 'shrUnsureMax', 'shrOtherMax']) delete alt[f];
      const ka = detail(alt);
      if (!/ältere Auswertung/.test(k(ka, /^F0 Median/).v) || /rust/.test(k(ka, /^F0 Median/).vHtml)) bad.push('ältere Auswertung: „' + k(ka, /^F0 Median/).v + '“');
      // Liste: Anteil unsicher in Rost neben F0 und SHR max.
      const div = new El(); let zellen = [];
      try { CHR.renderList(div, [{ id: 'i2', code: 'I', label: 'Prüftake', createdAt: '2026-03-02T09:00:00.000Z', durationS: 3, analysis: { kernelVersion: D.VERSION, gate: { f3MinHz: 2500 } }, summary: su }], {}, {}); zellen = ((/<tr data-id="[^"]*">([\s\S]*?)<\/tr>/.exec(div.innerHTML) || [])[1] || '').split(/<\/td>/); } catch (e) { bad.push('Liste: ' + e.message); }
      if (!/class="rust small"[^>]*>[^<]*% unsicher</.test(zellen[2] || '') || !/class="rust small"[^>]*>[^<]*% unsicher</.test(zellen[7] || '')) bad.push('Liste F0 „' + (zellen[2] || '').replace(/<[^>]+>/g, '') + '“ SHR „' + (zellen[7] || '').replace(/<[^>]+>/g, '') + '“');
      const divK = new El();
      CHR.renderList(divK, [{ id: 'i2k', code: 'K', label: 'klein', createdAt: '2026-03-02T09:00:00.000Z', durationS: 3, analysis: { kernelVersion: D.VERSION }, summary: klein }], {}, {});
      const zk = ((/<tr data-id="[^"]*">([\s\S]*?)<\/tr>/.exec(divK.innerHTML) || [])[1] || '').split(/<\/td>/);
      if (!/>&lt; 1 % unsicher</.test(zk[2] || '') || /< 1/.test(zk[2] || '')) bad.push('Liste bei kleinem Anteil: „' + (zk[2] || '').slice(0, 160) + '“');
    } catch (e) { bad.push('Ausnahme ' + e.message); }
    check('I2d', 'Detail und Liste: F0 und SHR aus sicheren Rahmen, der unsichere Anteil in Rost daneben (SHR mit Höchstwerten beider Raster), Rost erst ab der Hälfte; Korrektur nicht rostig; keine SHR-Warnung aus unsicheren Rahmen; „< 1 %“ maskiert; ältere Auswertung benannt',
      !bad.length, bad.length ? bad.slice(0, 4).join(' | ') : 'F0 „' + f0.v + '“ | SHR „' + shr.v + '“ | „' + okt.k + '“ ' + okt.v);
  }
  {
    /* Live: app.js unverändert in einer vm-Umgebung. Das Mikrofon liefert Stille; analyseAt wird durch
       einen echten Rahmen eines sauberen /a/ bei 196 Hz ersetzt, in dem nur die Grundton- und SHR-Felder
       so gesetzt sind, wie der Kern sie meldet. Geprüft wird, was in den Kacheln, im Hinweis, in der
       Teiltonleiter und in der 20-s-Spur steht. */
    const els = {}, canv = {}, intervalle = [];
    class El {
      constructor(id) { this.id = id || ''; this._t = ''; this.kinder = []; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this.style = {}; this.clientWidth = 600; this._on = {}; this.innerHTML = ''; this.checked = false; this.files = []; }
      get textContent() { return this._t + this.kinder.map(k => k.textContent).join(''); }
      set textContent(v) { this._t = String(v); this.kinder = []; }
      addEventListener(t, f) { (this._on[t] = this._on[t] || []).push(f); }
      removeEventListener() { }
      click() { (this._on.click || []).forEach(f => f({ target: this, preventDefault() { } })); }
      setAttribute(k, v) { this['@' + k] = String(v); }
      getAttribute(k) { return this['@' + k] == null ? null : this['@' + k]; }
      querySelector() { return new El(); }
      querySelectorAll() { return []; }
      appendChild(c) { this.kinder.push(c); return c; }
      insertBefore(c) { return c; }
      remove() { } focus() { }
      getContext() { const l = leinwand(); canv[this.id] = l.ops; return l.cv.getContext(); }
      getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 600, height: 100 }; }
    }
    const el = id => els[id] || (els[id] = new El(id));
    let raf = null;
    const meta = new Map(), P = v => Promise.resolve(v);
    const store = { open: () => P(), putTake: () => P(), getTake: () => P(null), allTakes: () => P([]), deleteTake: () => P(), putSeries: () => P(), getSeries: () => P(null), putAudio: () => P(), getAudio: () => P(null),
      // Schnittstelle seit B1: Take und Verlauf in einer Transaktion, Aufnahme vor der Analyse in pending.
      putTakeSeries: () => P(), updateTake: () => P(null), updateTakeSeries: () => P(null), putPending: () => P(), allPending: () => P([]), deletePending: () => P(),
      deleteAudio: () => P(), hasAudio: () => P(false), audioIds: () => P([]), putCalibration: () => P(), allCalibrations: () => P([]), deleteCalibration: () => P(),
      getMeta: (k, fb) => P(meta.has(k) ? meta.get(k) : fb), setMeta: (k, v) => { meta.set(k, v); return P(); }, clearAll: () => P(), estimate: () => P(null), persist: () => P(false), persisted: () => P(false) };
    const rec = { active: false, info: null, sampleRate: 48000, samplesSeen: 0, recordedSeconds: 0,
      start() { rec.active = true; rec.info = { deviceLabel: 'Testmikrofon', deviceId: 'standard', sampleRate: 48000, trackSampleRate: 48000, capture: 'worklet', echoCancellation: false, noiseSuppression: false, autoGainControl: false }; return P(rec.info); },
      stop() { rec.active = false; return P(); }, beginTake() { }, endTake() { return { samples: new Float32Array(0), sampleRate: 48000, durationS: 0 }; }, latest: s => new Float32Array(Math.round(s * 48000)) };
    const leer = () => ({ getItem: () => null, setItem() { }, removeItem() { } });
    const doc = { readyState: 'complete', activeElement: null, body: new El('body'), getElementById: el, createElement: () => new El(), querySelector: () => el('main'), querySelectorAll: () => [], addEventListener() { } };
    const ab = { document: doc, console: { log() { }, warn() { }, error() { } }, navigator: {}, location: { hash: '#/aufnahme', protocol: 'http:', origin: 'http://localhost' },
      addEventListener() { }, removeEventListener() { }, requestAnimationFrame: f => { raf = f; return 1; }, cancelAnimationFrame() { }, performance: { now: () => Date.now() },
      setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: h => clearTimeout(h),
      setInterval: (f, ms) => { const h = setInterval(f, ms); if (h.unref) h.unref(); intervalle.push(h); return h; }, clearInterval: h => clearInterval(h),
      confirm: () => true, alert() { }, crypto: { randomUUID: () => require('crypto').randomUUID() }, Blob: require('buffer').Blob, URL, btoa, atob, Date, devicePixelRatio: 1,
      localStorage: leer(), sessionStorage: leer(), fetch: () => Promise.reject(new Error('kein Netz')), TextDecoder };
    ab.window = ab; ab.self = ab;
    const bad = [], belege = [];
    try {
      vm.createContext(ab);
      for (const f of ['dsp.js', 'vowel.js', 'analysis.js', 'csv.js', 'wav.js', 'calibration.js', 'korpus.js', 'chronik.js']) vm.runInContext(quelle(f), ab, { filename: f });
      ab.VARESTORE = store; ab.VARERECORDER = { createRecorder: () => rec, listDevices: () => P([]) };
      vm.runInContext(quelle('app.js'), ab, { filename: 'app.js' });
      const st = ab.VAREAPP.state;
      for (let w = 0; w < 500 && !st.settings; w++) await new Promise(r => setTimeout(r, 2));
      el('btn-mic').click();
      for (let w = 0; w < 500 && !(rec.active && raf); w++) await new Promise(r => setTimeout(r, 2));
      const DD = ab.VAREDSP, echt = DD.analyseAt, sig = DD.resample(DD.synthVowel(196, AV[0], AV[1], 0.4, 48000), 48000, DD.TARGET_SR);
      const basis = echt(sig, DD.TARGET_SR, sig.length - 1, { align: 'end', wantSpectrum: true, floorDb: -70 });
      let jetzt = 1000;
      const zeige = aenderung => {
        const fr = Object.assign({}, basis, aenderung);
        DD.analyseAt = () => fr;
        rec.samplesSeen += 1000; jetzt += 100;
        for (const k in canv) delete canv[k];
        raf(jetzt);
        const kach = id => ({ klasse: el('st-' + id).className, text: el('v-' + id).textContent, rost: el('v-' + id).kinder.filter(c => /\brust\b/.test(c.className)).map(c => c.textContent).join(' ') });
        return { f0: kach('f0'), f1: kach('f1'), shr: kach('shr'), h1h2: kach('h1h2'), hinweis: el('live-hints').textContent, spek: canv['spec-canvas'] || [], hist: canv['hist-canvas'] || [] };
      };
      if (!(basis.voiced && basis.valid[0] && !basis.f0Unsure && !basis.shrUnsure && !basis.octaveAmbiguous)) bad.push('Grundrahmen nicht sauber');
      const hat = (s, t) => s.includes(t);
      // 1. Gegenprobe gerissen: F0, Note, F1/F0, SHR, H1−H2, Teiltonleiter, Hinweis.
      let a = zeige({ f0Unsure: true, f0Grund: 'cepstrum', f0Cep: 98, shrUnsure: true, shrGrund: 'grundton', shrOther: NaN });
      if (!/\bunsure\b/.test(a.f0.klasse) || !hat(a.f0.text, 'Grundton unsicher: Cepstrum zeigt 98.0 Hz')) bad.push('F0 unsicher: „' + a.f0.text + '“ ' + a.f0.klasse);
      if (/\bunsure\b/.test(a.f1.klasse) || !hat(a.f1.rost, 'Grundton unsicher') || !hat(a.f1.rost, '(H')) bad.push('F1/F0: „' + a.f1.text + '“ Rost „' + a.f1.rost + '“ ' + a.f1.klasse);
      if (!/\bunsure\b/.test(a.shr.klasse) || /befund/.test(a.shr.klasse) || !hat(a.shr.text, 'unsicher: Grundton unsicher')) bad.push('SHR bei unsicherem Grundton: „' + a.shr.text + '“ ' + a.shr.klasse);
      if (!/\bunsure\b/.test(a.h1h2.klasse) || !hat(a.h1h2.text, 'Grundton unsicher')) bad.push('H1−H2: „' + a.h1h2.text + '“ ' + a.h1h2.klasse);
      if (!/^Grundton unsicher \(Cepstrum zeigt 98\.0 Hz\)/.test(a.hinweis)) bad.push('Hinweis „' + a.hinweis.slice(0, 80) + '“');
      const leiter = punkte(a.spek).length, leiterRost = a.spek.filter(o => o[0] === 'fillText' && /Teiltöne .* Grundton unsicher/.test(o[1][0])).length;
      let fillNow = '', leiterFarben = new Set();
      for (const [k2, x2, v2] of a.spek) { if (k2 === 'set' && x2 === 'fillStyle') fillNow = v2; if (k2 === 'fillRect' && x2[1] === 8 && x2[3] === 34) leiterFarben.add(fillNow); }
      if (!(leiterFarben.size === 1 && leiterFarben.has(COL.rust)) || !leiterRost) bad.push('Teiltonleiter ' + [...leiterFarben].join('/') + ', Beschriftung ' + leiterRost);
      // 2·F0 in der 20-s-Spur (Höhe 140): y = 140 − 12 − f/4000 · 120; Punkt hohl in Rost an genau dieser Höhe.
      const y2f0 = 140 - 12 - Math.min(4000, 2 * basis.f0) / 4000 * 120 - 1.5;
      const histRost = punkte(a.hist).filter(p => p.art === 'stroke' && p.farbe === COL.rust && Math.abs(p.y - y2f0) < 0.01).length;
      if (!histRost) bad.push('20-s-Spur: 2·F0 nicht hohl in Rost');
      belege.push('F0 „' + a.f0.text + '“');
      // 2. Korrigiert: sichtbar, nicht rostig.
      a = zeige({ f0Korrektur: 'teiltonreihe', f0Yin: 98 });
      if (/\bunsure\b/.test(a.f0.klasse) || !hat(a.f0.text, 'korrigiert aus 98.0 Hz, Teiltonreihe')) bad.push('F0 korrigiert: „' + a.f0.text + '“ ' + a.f0.klasse);
      a = zeige({ octaveCorrected: true, subFactor: 2 });
      if (/\bunsure\b/.test(a.f0.klasse) || !hat(a.f0.text, 'Teiler 2 aus Teiltonreihe')) bad.push('F0 Teilerkontrolle: „' + a.f0.text + '“ ' + a.f0.klasse);
      belege.push('korrigiert „' + a.f0.text + '“');
      // 3. Unter 60 Hz nicht geteilt.
      a = zeige({ octaveAmbiguous: true, octaveUnterGrenze: true });
      if (!/\bunsure\b/.test(a.f0.klasse) || !hat(a.f0.text, 'Reihe unter 60 Hz, nicht geteilt')) bad.push('unter 60 Hz: „' + a.f0.text + '“');
      // 4. SHR-Raster zweifelhaft: beide Werte mit Raster in Rost, keine Warnung trotz −10 dB.
      a = zeige({ shr: -10, shrGrid: 392, shrOther: -48.7, shrUnsure: true, shrGrund: 'kamm+zweitpuls', shrKamm: -10.1, shrZweitpuls: 0.79 });
      if (!/\bunsure\b/.test(a.shr.klasse) || /befund/.test(a.shr.klasse) || !hat(a.shr.text, '-10.0 dB (Raster 392 Hz) · -48.7 dB (Raster 196 Hz) — unsicher: Kamm -10.1 dB, zweite Anregung 0.79')) bad.push('SHR-Zweifel: „' + a.shr.text + '“ ' + a.shr.klasse);
      belege.push('SHR „' + a.shr.text + '“');
      // 5. Gegenprobe: sicheres SHR über −15 dB ist ein Befund (Gold), nicht unsicher.
      a = zeige({ shr: -10, shrUnsure: false, shrOther: NaN, shrGrund: '' });
      if (a.shr.klasse.trim() !== 'stat befund') bad.push('sicheres SHR −10 dB: „' + a.shr.klasse + '“ statt Befund');
      ab.VAREDSP.analyseAt = echt;
    } catch (e) { bad.push('Ausnahme ' + String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }
    check('I2d', 'Live: unsicherer Grundton in Rost mit Grund, mit ihm F1/F0 (Teil in Rost), SHR, H1−H2, Teiltonleiter, Hinweis und 2·F0-Spur; korrigiert (Gegenprobe, Teilerkontrolle) sichtbar ohne Rost; „Reihe unter 60 Hz, nicht geteilt“; SHR-Zweifel mit beiden Werten und Rastern in Rost ohne Warnung, sicheres SHR über −15 dB als Befund',
      !bad.length, bad.length ? bad.slice(0, 4).join(' | ') : belege.join(' | '));
    // Ergebnis gleich nach dem Take (renderTakeResult): derselbe Prüftake über finishTake.
    const badE = [];
    let ergebnis = '';
    try {
      const st = ab.VAREAPP.state;
      ab.VAREAPP.finishTake(SIG, SR);
      for (let w = 0; w < 30000 && !/Gespeichert als/.test(el('take-result').innerHTML); w += 5) await new Promise(r => setTimeout(r, 5));
      for (let w = 0; w < 2000 && st.busy; w += 5) await new Promise(r => setTimeout(r, 5));
      ergebnis = el('take-result').innerHTML;
      const ks = kacheln(ergebnis), kf0 = ks.find(x => x.k === 'F0') || { v: '', vHtml: '', klasse: '?' }, kshr = ks.find(x => /SHR max/.test(x.k)) || { v: '', vHtml: '' };
      if (!/<span class="rust">· Grundton unsicher in \d+ % der Rahmen, nicht im Median<\/span>/.test(kf0.vHtml) || kf0.klasse !== '') badE.push('F0 „' + kf0.v + '“ (' + kf0.klasse + ')');
      if (!/<span class="rust">· unsicher in \d+ %: bis -?[\d.]+ dB, anderes Raster bis -?[\d.]+ dB<\/span>/.test(kshr.vHtml)) badE.push('SHR „' + kshr.v + '“');
      if (!ks.length) badE.push('keine Kacheln: ' + ergebnis.slice(0, 120));
    } catch (e) { badE.push('Ausnahme ' + String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }
    intervalle.forEach(h => clearInterval(h));
    check('I2d', 'Ergebnis nach dem Take: F0 und SHR max aus sicheren Rahmen, unsicherer Anteil in Rost daneben (SHR mit Höchstwerten beider Raster)',
      !badE.length, badE.length ? badE.join(' | ') : kacheln(ergebnis).filter(x => /^F0$|SHR/.test(x.k)).map(x => x.k + ' „' + x.v + '“').join(' | '));
  }
};

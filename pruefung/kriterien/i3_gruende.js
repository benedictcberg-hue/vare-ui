/* I3 — Gründe für ungültige Formanten und angenommener Rauschboden, sichtbar bis in Serie, CSV und Anzeige.
   Der Rechenkern sagt je Slot, warum er unsicher ist (dsp.js analyseAt: slotGrund 'nummer' oder
   'verschmolzen', rauschBoden; Vertrag K2). Vorher speicherte die Serie nur die Maske slotUnsure, die
   Anzeige schrieb „Zuordnung unsicher, nur N Resonanzen“ — falsch bei 'verschmolzen' und bei fünf Gipfeln —
   und nannte einen Formanten im Rauschboden „Streuung“. Live ohne Kalibrierung galt noch die alte Klemme
   min(q05, q50 − 20), die leise Rahmen eines Decrescendo als Pause verwarf (derselbe Fehlertyp wie V3).
   Prüftake: Stücke, an denen der Kern die Gründe tatsächlich meldet — tiefer enger Cluster bei 110 Hz mit
   Rauschen 30 dB unter dem Vokal (Nummer mehrdeutig, im Rauschboden, Streuung), /a/ bei 330 Hz (zwei
   Resonanzen in einem Gipfel möglich), /o/ bei 247 Hz mit F6 im Band (Nummer mehrdeutig, Bandbreite unter
   40 Hz). Die Sollwerte kommen aus analyseAt selbst, Rahmen für Rahmen.
   I3a Serie und CSV-Rahmenspalten, I3b Gründe live und im Hover, I3c Live-Boden, I3d Stimmschwelle in CSV
   und Chronik. Anzeige in einer vm-Umgebung wie in i2_durchreichen.js. */
'use strict';
const path = require('path');

module.exports = async function (H) {
  const { check, r1, noise, concat, SR, TSR, D, A } = H;
  const rms = x => { let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i]; return Math.sqrt(e / x.length); };
  const mitRauschen = (x, abstandDb, seed) => {
    const z = noise(x.length, 1, seed), g = rms(x) / rms(z) * Math.pow(10, -abstandDb / 20), y = Float64Array.from(x);
    for (let i = 0; i < y.length; i++) y[i] += g * z[i];
    return y;
  };
  const ENG = [[500, 1500, 1700, 2200, 3150], [70, 90, 90, 90, 100]], AV = [[700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200]];
  const OF6 = [[500, 800, 2600, 2950, 4100, 4600], [70, 90, 120, 150, 200, 220]];
  const SIG = concat([noise(Math.round(0.2 * SR), 2e-4, 21),
    mitRauschen(D.synthVowel(110, ENG[0], ENG[1], 0.9, SR), 30, 22),
    D.synthVowel(330, AV[0], AV[1], 0.5, SR),
    D.synthVowel(247, OF6[0], OF6[1], 0.5, SR),
    noise(Math.round(0.2 * SR), 2e-4, 23)]);

  /* ---------- I3a: Serie ---------- */
  const res = await A.analyseTake(SIG, SR, {});
  const ser = res.series, n = ser.t.length;
  // Dieselben Rahmen wie analyseTake: Raster 10 ms, Rand 30 ms, Boden aus dem Take.
  const ds = D.resample(SIG, SR, TSR), hop = Math.round(0.010 * TSR), half = Math.round(0.03 * TSR);
  const floorDb = A.estimateFloor(ds, TSR, 0.010).db, R = [];
  for (let c = half; c + half <= ds.length; c += hop) R.push(D.analyseAt(ds, TSR, c, { align: 'centre', floorDb, spreadMaxHz: D.SPREAD_MAX_HZ }));
  const fall = { nummer: 0, verschmolzen: 0, rauschBoden: 0, beides: 0 };
  {
    const bad = [];
    if (R.length !== n) bad.push(n + ' Rahmen in der Serie, ' + R.length + ' nachgerechnet');
    for (const f of ['slotVerschmolzen', 'rauschBoden']) if (!(ser[f] instanceof Uint8Array)) bad.push(f + ' fehlt oder ist kein Uint8Array');
    if (!bad.length) {
      for (let i = 0; i < Math.min(n, R.length); i++) {
        const r = R[i];
        let m = 0, b = 0, u = 0;
        for (let k = 0; k < 5; k++) {
          if (r.slotUnsure[k]) u |= 1 << k;
          if (r.slotGrund[k] === 'verschmolzen') m |= 1 << k;
          if (r.rauschBoden[k]) b |= 1 << k;
          if (r.voiced && r.slotGrund[k] === 'nummer') fall.nummer++;
          if (r.voiced && r.slotGrund[k] === 'verschmolzen') fall.verschmolzen++;
          if (r.voiced && r.rauschBoden[k]) fall.rauschBoden++;
          if (r.voiced && r.rauschBoden[k] && r.slotGrund[k]) fall.beides++;
        }
        if (ser.slotVerschmolzen[i] !== m) bad.push('slotVerschmolzen[' + i + '] ' + ser.slotVerschmolzen[i] + ' statt ' + m);
        if (ser.rauschBoden[i] !== b) bad.push('rauschBoden[' + i + '] ' + ser.rauschBoden[i] + ' statt ' + b);
        if (ser.slotUnsure[i] !== u) bad.push('slotUnsure[' + i + '] ' + ser.slotUnsure[i] + ' statt ' + u);
        // „verschmolzen“ ist ein Grund für „unsicher“: ohne slotUnsure-Bit wäre die Maske widersprüchlich
        if (ser.slotVerschmolzen[i] & ~ser.slotUnsure[i]) bad.push('verschmolzen ohne unsicher [' + i + ']');
      }
    }
    check('I3a', 'Serie trägt je Rahmen die Masken slotVerschmolzen (slotGrund „verschmolzen“) und rauschBoden (Uint8, Bit k = Fk+1) — Rahmen für Rahmen gleich analyseAt; slotUnsure ohne Verschmolzen-Bit heißt „nummer“',
      !bad.length && fall.nummer >= 20 && fall.verschmolzen >= 20 && fall.rauschBoden >= 20 && fall.beides >= 5,
      n + ' Rahmen; Slots ' + JSON.stringify(fall) + (bad.length ? ' — ' + bad.length + ' Abweichungen: ' + bad.slice(0, 4).join('; ') : ''));
  }
  {
    // Sicherung → Import: die Masken kommen als Uint8Array exakt zurück.
    const H2 = H.C.parseBackup(H.C.serializeBackup({ takes: [{ id: 'i3' }], series: { i3: ser }, refs: null, calibrations: [], settings: null })).series.i3;
    const bad = [];
    for (const f of ['slotVerschmolzen', 'rauschBoden']) if (!(H2[f] instanceof Uint8Array) || Array.from(H2[f]).join() !== Array.from(ser[f] || []).join()) bad.push(f + ' verändert');
    check('I3a', 'Sicherung → Import: slotVerschmolzen und rauschBoden kommen unverändert zurück', !bad.length && !!ser.slotVerschmolzen, bad.join('; '));
  }

  /* ---------- I3a: CSV-Rahmenspalten ---------- */
  const zeilen = (text, sep) => text.replace(/^﻿/, '').split('\r\n').filter(z => z !== '').map(z => z.split(sep));
  {
    // Je Slot der Grund als Text des Kerns und der Rauschboden als 0/1, Rahmen für Rahmen gleich analyseAt.
    const z = zeilen(H.C.framesToCsv(ser, 'standard', H.V), ','), kopf = z[0], bad = [];
    let geprueft = 0;
    const texte = new Set();
    for (let k = 0; k < 5; k++) {
      for (const [name, f] of [['slot_grund' + (k + 1), r => r.slotGrund[k]], ['rauschboden' + (k + 1), r => r.rauschBoden[k] ? '1' : '0']]) {
        const c = kopf.indexOf(name);
        if (c < 0) { bad.push(name + ' fehlt'); continue; }
        for (let i = 0; i < R.length; i++) {
          const want = f(R[i]), got = z[i + 1] && z[i + 1][c];
          if (got !== want) { if (bad.length < 6) bad.push(name + '[' + i + '] ' + JSON.stringify(got) + ' statt ' + JSON.stringify(want)); } else geprueft++;
          if (/grund/.test(name) && want) texte.add(want);
        }
      }
    }
    check('I3a', 'Rahmen-CSV: slot_grund1…5 („nummer“, „verschmolzen“, leer) und rauschboden1…5 (0/1) Rahmen für Rahmen gleich analyseAt',
      !bad.length && geprueft === 10 * R.length && texte.size === 2, geprueft + '/' + 10 * R.length + ' Zellen, Gründe ' + [...texte].join(' | ') + (bad.length ? ' — ' + bad.join('; ') : ''));
  }
  {
    // Ältere Serie ohne die Masken: unsicher bleibt sichtbar, aber ohne erfundenen Grund („?“, nicht „nummer“);
    // Rauschboden unbekannt −99 (nicht 0 = „über dem Boden“); kein Absturz, übrige Spalten unverändert.
    const alt = {};
    for (const k in ser) if (k !== 'slotVerschmolzen' && k !== 'rauschBoden') alt[k] = ser[k];
    const bad = [];
    let za = null, zv = null;
    try { za = zeilen(H.C.framesToCsv(alt, 'excelde', H.V), ';'); zv = zeilen(H.C.framesToCsv(ser, 'excelde', H.V), ';'); } catch (e) { bad.push('Ausnahme ' + e.message); }
    let fragen = 0;
    if (za) {
      const kopf = za[0], NEU = [];
      for (let k = 0; k < 5; k++) {
        NEU.push('slot_grund' + (k + 1), 'rauschboden' + (k + 1));
        const cg = kopf.indexOf('slot_grund' + (k + 1)), cb = kopf.indexOf('rauschboden' + (k + 1));
        if (cg < 0 || cb < 0) { bad.push('Spalten für F' + (k + 1) + ' fehlen'); continue; }
        for (let i = 1; i < za.length; i++) {
          const want = (ser.slotUnsure[i - 1] & (1 << k)) ? '?' : '';
          if (want) fragen++;
          if (za[i][cg] !== want) { bad.push('slot_grund' + (k + 1) + '[' + (i - 1) + '] „' + za[i][cg] + '“ statt „' + want + '“'); break; }
          if (!/^-99(,0+)?$/.test(za[i][cb])) { bad.push('rauschboden' + (k + 1) + '[' + (i - 1) + '] ' + za[i][cb] + ' statt −99'); break; }
        }
      }
      kopf.forEach((k, c) => { if (NEU.indexOf(k) < 0 && za.some((r, i) => r[c] !== zv[i][c])) bad.push(k + ' verändert'); });
    }
    check('I3a', 'Ältere Serie ohne die Masken: unsichere Slots mit Grund „?“ (nie still „nummer“), Rauschboden −99, übrige Spalten unverändert, kein Absturz',
      !bad.length && fragen > 0, fragen + ' unsichere Slots' + (bad.length ? ' — ' + bad.slice(0, 4).join('; ') : ''));
  }
};

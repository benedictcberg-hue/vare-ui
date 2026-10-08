/* Kriterien der Zusammenführung: Kern 4.1 (A1–A4, fix/kern2) und Oberfläche (B1–B3, fix/ui2) zusammen.
   Beide Seiten wurden getrennt gebaut und geprüft; hier steht, was erst im zusammengeführten Baum gilt.
   C1a: Bitraum der Serie. B1 belegt FLAG.NAHT, der Kern bringt neue Marken und Gründe (A2–A4), die noch
        durchgereicht werden: Jede Marke ist ein eigenes Bit im Serienfeld flags, jeder Grundcode passt in sein
        Serienfeld und erreicht CODE_UNBEKANNT nie, Hin- und Rückweg Text → Code → Text ist verlustfrei.
   C1b: Rahmen an einer Naht (B1) sind nicht gemessen — in jedem Serienfeld und jeder Spalte der Rahmen-CSV,
        auch in Feldern und Spalten, die später für neue Kernwerte hinzukommen.
   C1c: Feinspur und Sprungsuche je Abschnitt (B1) mit der Sprungerkennung des Kerns (A1): Nähte am Rand, doppelt,
        dicht beieinander, Abschnitte kürzer als ein Feinspurfenster; Ereignisse an ihrer Stelle im Take.
   C2a–C2e: Jeder Grund und jeder Beleg, den der Kern 4.1 je Rahmen meldet (A2: Fensterprobe, Zwischenpegel; A3:
        Teiltonabstand, Vokalwechsel; A4: Unterton, Oktave, Rauschanteil), kommt durch: C2a Serie und Sicherung,
        C2b Rahmen- und Take-CSV, C2c Zusammenfassung, C2d Hover, Detail und Liste, C2e live und Ergebnis nach dem
        Take. Prüftake: Stücke, an denen der Kern jeden dieser Gründe tatsächlich meldet; Sollwerte aus analyseAt,
        Rahmen für Rahmen, Sollworte der Anzeige hier unabhängig gebildet.
   Testsignale: allgemeine Baritonlage, synthetische Vokale. Reißt ein Kriterium, ist das ein Befund. */
'use strict';
module.exports = async function (H) {
  const { check, D, A, C, V, SR, concat, noise, BW5 } = H;
  const kurz = e => String(e && e.stack || e).split('\n').slice(0, 2).join(' | ');
  const FA = [700, 1200, 2500, 3300, 4200];

  /* ---------- C1b zuerst: der Take dient auch C1a als Serie ---------- */
  // /a/ auf G3 1,6 s im Raumrauschen, Naht bei 1,0 s mitten im Ton (B1: Abtastwerte fehlen, Teile stoßen aneinander).
  const sig = concat([noise(Math.round(0.2 * SR), 3e-4, 301), D.synthVowel(196, FA, BW5, 1.6, SR, { gain: 0.3 }), noise(Math.round(0.2 * SR), 3e-4, 302)]);
  { const z = noise(sig.length, 3e-4, 303); for (let i = 0; i < sig.length; i++) sig[i] += z[i]; }
  let serie = null;
  try {
    const F = A.FLAG;
    const mit = await A.analyseTake(Float32Array.from(sig), SR, { hopS: 0.02, naehteS: [1.0] });
    const ohne = await A.analyseTake(Float32Array.from(sig), SR, { hopS: 0.02 });
    const s = mit.series, so = ohne.series; serie = s;
    const naht = [], bad = [];
    for (let i = 0; i < s.t.length; i++) if (s.flags[i] & F.NAHT) naht.push(i);
    // Jedes Serienfeld, nicht eine Liste: neue Felder für Kernwerte gelten ohne Nachtrag mit.
    const felder = Object.keys(s).filter(k => ArrayBuffer.isView(s[k]) && s[k].length === s.t.length);
    for (const k of felder) for (const i of naht) {
      const v = s[k][i], fl = s[k] instanceof Float32Array || s[k] instanceof Float64Array;
      const soll = k === 't' ? isFinite(v) : k === 'flags' ? v === F.NAHT : k === 'cls' ? v === -1 : fl ? Number.isNaN(v) : v === 0;
      if (!soll && bad.length < 8) bad.push('Serie ' + k + '[' + i + '] = ' + v);
    }
    // Gegenprobe: dieselben Rahmen ohne Naht sind gemessen — sonst prüfte das Kriterium nichts.
    const gemessen = naht.filter(i => (so.flags[i] & F.VOICED) && isFinite(so.f0[i])).length;
    // Rahmen-CSV, beide Dialekte: nur Zeit, Flags und die ausdrücklichen „nicht gemessen“-Werte stehen da.
    const ERLAUBT = { voiced: '0', gate: 'pause', valid1: '0', valid2: '0', valid3: '0', valid4: '0', valid5: '0', flags: String(F.NAHT) };
    let zellen = 0;
    for (const [d, sep] of [['standard', ','], ['excelde', ';']]) {
      const z = C.framesToCsv(s, d, V).replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(x => x.split(sep)), kopf = z[0];
      for (const i of naht) kopf.forEach((sp, j) => {
        const w = z[i + 1][j]; zellen++;
        if (sp === 't_s') return;
        const ok = Object.prototype.hasOwnProperty.call(ERLAUBT, sp) ? w === ERLAUBT[sp] : (w === '' || /^-99([.,]0+)?$/.test(w));
        if (!ok && bad.length < 8) bad.push(d + ' ' + sp + '[' + i + '] „' + w + '“');
      });
    }
    check('C1b', 'Rahmen an einer Naht (B1) mit dem Kern 4.1: jedes Serienfeld nicht gemessen (Zahl NaN, Marken, Masken und Codes 0, Klasse −1, flags genau NAHT), jede Spalte der Rahmen-CSV −99 bzw. leer außer Zeit, voiced 0, gate pause, valid 0 und flags (beide Dialekte); ohne Naht sind dieselben Rahmen gemessen',
      naht.length >= 5 && felder.length >= 40 && gemessen === naht.length && !bad.length,
      (bad.length ? bad.join(' | ') + ' || ' : '') + 'Naht-Rahmen ' + naht.length + ', Serienfelder ' + felder.length + ', CSV-Zellen ' + zellen + ' | ohne Naht gemessen ' + gemessen + '/' + naht.length);
  } catch (e) { check('C1b', 'Ablauf Naht-Rahmen läuft durch', false, kurz(e)); }

  /* ---------- C1a · Bitraum der Serie: Marken und Gründe ---------- */
  try {
    const F = A.FLAG, bad = [], namen = Object.keys(F);
    const bits = serie && serie.flags ? 8 * serie.flags.BYTES_PER_ELEMENT : 0;
    const belegt = {};
    for (const n of namen) {
      const v = F[n];
      if (!(v > 0 && (v & (v - 1)) === 0)) bad.push(n + ' = ' + v + ' ist kein einzelnes Bit');
      else if (v >= Math.pow(2, bits)) bad.push(n + ' = ' + v + ' passt nicht in flags (' + bits + ' Bit)');
      if (belegt[v]) bad.push(n + ' und ' + belegt[v] + ' teilen Bit ' + v); else belegt[v] = n;
    }
    if (!F.NAHT || !F.VOICED) bad.push('NAHT oder VOICED fehlt');
    const U = A.CODE_UNBEKANNT;
    let wege = 0;
    for (const feld of Object.keys(A.GRUND)) {
      const liste = A.GRUND[feld], maske = feld === 'shrGrund';
      const feldBits = serie && serie[feld] ? 8 * serie[feld].BYTES_PER_ELEMENT : 0;
      if (!feldBits) { bad.push(feld + ': kein Serienfeld'); continue; }
      // Bitmaske: alle Teile zugleich dürfen weder CODE_UNBEKANNT treffen noch über das Feld hinausgehen.
      const hoechst = maske ? Math.pow(2, liste.length) - 1 : liste.length - 1;
      if (hoechst >= U) bad.push(feld + ': höchster Code ' + hoechst + ' erreicht CODE_UNBEKANNT ' + U);
      if (hoechst >= Math.pow(2, feldBits)) bad.push(feld + ': höchster Code ' + hoechst + ' passt nicht in ' + feldBits + ' Bit');
      if (!maske && liste[0] !== '') bad.push(feld + ': Code 0 ist nicht „kein Grund“');
      const texte = maske ? [] : liste.slice(1);
      if (maske) for (let m = 1; m < Math.pow(2, liste.length); m++) texte.push(liste.filter((x, b) => m & (1 << b)).join('+'));
      for (const t of texte) { wege++; const r = A.textAus(feld, A.codeAus(feld, t)); if (r !== t && bad.length < 12) bad.push(feld + ': „' + t + '“ → „' + r + '“'); }
      if (A.textAus(feld, A.codeAus(feld, 'gibt es nicht')) !== '?') bad.push(feld + ': unbekannter Grund nicht als „?“');
      if (A.codeAus(feld, '') !== 0) bad.push(feld + ': leerer Grund nicht 0');
    }
    check('C1a', 'Bitraum der Serie: jede Marke (auch NAHT aus B1) ist ein eigenes Bit in flags, jeder Grundcode passt in sein Serienfeld und erreicht CODE_UNBEKANNT nie (Bitmaske shrGrund mit allen Teilen zugleich), Text → Code → Text verlustfrei, unbekannt bleibt „?“',
      bits >= 16 && !bad.length, (bad.length ? bad.join(' | ') + ' || ' : '') + namen.length + ' Marken in ' + bits + ' Bit (frei: ' + (bits - namen.length) + '), Gründe ' + Object.keys(A.GRUND).map(f => f + ' ' + A.GRUND[f].length).join(', ') + ', Hin- und Rückwege ' + wege);
  } catch (e) { check('C1a', 'Ablauf Bitraum läuft durch', false, kurz(e)); }

  /* ---------- C1c · Feinspur je Abschnitt mit der Sprungerkennung des Kerns ---------- */
  try {
    // /a/ auf G3 1 s, ohne Pause /a/ auf C3 1 s (−7 HT): ohne Naht ein gehaltenes Ereignis bei 1 s (ein Schnitt
    // zwischen zwei Tönen ist im Signal ein legato Sprung). Eine Naht genau dort ist eine Pause: kein Ereignis.
    const ton = concat([D.synthVowel(196, FA, BW5, 1.0, SR, { gain: 0.3 }), D.synthVowel(130.81, FA, BW5, 1.0, SR, { gain: 0.3 })]);
    { const z = noise(ton.length, 3e-4, 311); for (let i = 0; i < ton.length; i++) ton[i] += z[i]; }
    const lauf = async n => (await A.analyseTake(Float32Array.from(ton), SR, { hopS: 0.02, naehteS: n })).summary.spruenge;
    const bezug = await lauf([]), b0 = bezug.liste.filter(e => e.art === 'gehalten')[0];
    const bad = [], belege = [];
    if (!(bezug.gehalten === 1 && b0 && Math.abs(b0.halbtoene + 7) <= 1)) bad.push('Bezug ohne Naht: gehalten ' + bezug.gehalten + (b0 ? ', ' + b0.halbtoene.toFixed(1) + ' HT' : ''));
    // Nähte genau am Tonwechsel, einzeln, doppelt und dicht beieinander (10–30 ms, Abschnitte kürzer als ein Fenster).
    for (const n of [[1.0], [1.0, 1.01], [1.0, 1.03], [0.98, 1.0, 1.02], [1.0, 1.0]]) {
      const sp = await lauf(n), ueber = sp.liste.filter(e => e.startS - 0.2 < 1.0 && e.startS + e.dauerS > 0.8);
      belege.push(JSON.stringify(n) + ' g' + sp.gehalten + '/k' + sp.kante);
      if (sp.gehalten !== 0 || ueber.length) bad.push('Naht ' + JSON.stringify(n) + ': gehalten ' + sp.gehalten + ', Ereignisse am Wechsel ' + ueber.length);
    }
    // Nähte anderswo: am Anfang und Ende, mehrere in den ersten 0,1 s, doppelt, im zweiten Ton. Das Ereignis bleibt,
    // mit Weite und Stelle wie ohne Naht (die Zeit des Abschnitts wird auf den Take umgerechnet).
    // Stelle auf zwei Feinspur-Raster genau: Ein Abschnitt beginnt an der Naht, sein Raster ist um höchstens einen Schritt versetzt.
    const tolS = Math.max(0.02, 2 * D.FINE_HOP_S);
    for (const n of [[0.001], [0.01], [0.05], [0.03, 0.06, 0.09], [0.5, 0.5], [1.5, 1.52], [1.99], [1.999]]) {
      const sp = await lauf(n), g = sp.liste.filter(e => e.art === 'gehalten');
      belege.push(JSON.stringify(n) + ' g' + sp.gehalten + (g[0] ? '@' + g[0].startS.toFixed(2) : ''));
      if (!(b0 && g.length === 1 && Math.abs(g[0].halbtoene - b0.halbtoene) <= 0.5 && Math.abs(g[0].startS - b0.startS) <= tolS))
        bad.push('Naht ' + JSON.stringify(n) + ': ' + g.length + ' gehalten' + (g[0] ? ' ' + g[0].halbtoene.toFixed(1) + ' HT bei ' + g[0].startS.toFixed(2) + ' s' : '') + ' statt wie ohne Naht');
    }
    check('C1c', 'Feinspur und Sprungsuche je Abschnitt (B1) mit der Sprungerkennung des Kerns (A1): Naht am Tonwechsel (einzeln, doppelt, 10–30 ms dicht) ergibt kein Ereignis; Nähte am Rand, am Anfang gehäuft, im Ton lassen das legato Ereignis −7 HT an seiner Stelle (±0,02 s); keine Ausnahme bei Abschnitten kürzer als ein Fenster',
      !bad.length, (bad.length ? bad.join(' | ') + ' || ' : '') + 'Bezug ' + (b0 ? b0.halbtoene.toFixed(1) + ' HT bei ' + b0.startS.toFixed(2) + ' s' : '–') + ' | ' + belege.join(', '));
  } catch (e) { check('C1c', 'Ablauf Feinspur je Abschnitt läuft durch', false, kurz(e)); }

  /* ---------- C2: Gründe und Belege aus Kern 4.1 bis in Serie, CSV, Zusammenfassung und Anzeige ---------- */
  // Signalhilfen: Rosenberg-Quelle mit Tonverlauf, Jitter, Shimmer und Hauch; Rampen; rosa Raumrauschen; Frikativ.
  const VOK = {
    a: [[700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200]], e: [[450, 1900, 2550, 3300, 4200], [60, 90, 120, 150, 200]],
    o: [[450, 800, 2500, 3300, 4200], [70, 90, 120, 150, 200]], u: [[320, 800, 2400, 3300, 4200], [60, 90, 120, 150, 200]]
  };
  const lcg2 = seed => { let z = seed >>> 0 || 1; return () => { z = (z * 1664525 + 1013904223) >>> 0; return z / 4294967296; }; };
  const gauss = rnd => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const effW = (x, a, b) => { a = a || 0; b = b == null ? x.length : b; let p = 0; for (let i = a; i < b; i++) p += x[i] * x[i]; return Math.sqrt(p / Math.max(1, b - a)); };
  function quelle(o, v) {
    const n = Math.round(o.dur * SR), rnd = lcg2(o.seed || 7), fz = typeof o.f0 === 'function' ? o.f0 : () => o.f0;
    const flow = new Float64Array(n + 1), src = new Float64Array(n);
    let t0 = 0;
    while (t0 < o.dur) {
      let T = 1 / fz(t0); T *= 1 + (o.jit || 0) * (2 * rnd() - 1);
      const amp = 1 + (o.shim || 0) * (2 * rnd() - 1), To = 0.4 * T, Tc = 0.16 * T, i0 = Math.ceil(t0 * SR), i1 = Math.min(n + 1, Math.ceil((t0 + T) * SR));
      for (let i = i0; i < i1; i++) { const tt = i / SR - t0; flow[i] = amp * (tt < To ? 0.5 * (1 - Math.cos(Math.PI * tt / To)) : (tt < To + Tc ? Math.cos(Math.PI / 2 * (tt - To) / Tc) : 0)); }
      t0 += T;
    }
    for (let i = 0; i < n; i++) src[i] = flow[i + 1] - flow[i];
    const [F, B] = VOK[v], trakt = x => { let y = x; for (let m = 0; m < F.length; m++) y = D.resonate(y, F[m], B[m], SR); return y; };
    const y = trakt(src);
    if (o.hnr != null) {
      let fm = 0; for (let i = 0; i < n; i++) fm = Math.max(fm, flow[i]);
      const r2 = lcg2((o.seed || 7) * 31 + 5), nz = new Float64Array(n);
      for (let i = 0; i < n; i++) nz[i] = gauss(r2) * (0.3 + 0.7 * flow[i] / fm);
      const yn = trakt(nz), g = effW(y) / effW(yn) * Math.pow(10, -o.hnr / 20);
      for (let i = 0; i < n; i++) y[i] += g * yn[i];
    }
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i]));
    for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / mx;
    return y;
  }
  function rampen(x, ein, aus) {
    const y = Float64Array.from(x), a = Math.round(ein * SR), b = Math.round(aus * SR);
    for (let i = 0; i < a; i++) y[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / a);
    for (let i = 0; i < b; i++) y[y.length - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / b);
    return y;
  }
  function raum(x, snr, seed) {
    const n = x.length, rnd = lcg2(seed), nz = new Float64Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) { const w = gauss(rnd); b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; nz[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926; }
    const blk = 480, lv = []; for (let i = 0; i + blk <= n; i += blk) lv.push(effW(x, i, i + blk));
    const mxl = Math.max(...lv), sel = lv.filter(v => v > mxl * 0.0316), sR = Math.sqrt(sel.reduce((a, v) => a + v * v, 0) / sel.length);
    const g = sR * Math.pow(10, -snr / 20) / effW(nz), y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = x[i] + g * nz[i];
    return y;
  }
  const pause = sek => new Float64Array(Math.round(sek * SR));
  function frikativ(dur, art, seed, amp) {
    const n = Math.round(dur * SR), rnd = lcg2(seed), d = new Float64Array(n);
    let alt = 0; for (let i = 0; i < n; i++) { const w = gauss(rnd); d[i] = w - alt; alt = w; }
    const y = art === 's' ? D.resonate(d, 4800, 1500, SR) : D.resonate(d, 2700, 700, SR), g = amp / effW(y);
    for (let i = 0; i < n; i++) y[i] *= g;
    return y;
  }
  const stufen = (fs, d, gl) => t => {
    const k = Math.min(fs.length - 1, Math.floor(t / d)), tt = t - k * d;
    if (k > 0 && gl > 0 && tt < gl) { const a = fs[k - 1], b = fs[k], w = 0.5 - 0.5 * Math.cos(Math.PI * tt / gl); return a * Math.pow(b / a, w); }
    return fs[k];
  };
  /* Prüftake 7,35 s: Quarte legato /a/ (Rand, Wechsel), Quinte legato /o/ (Mischwert am Tonwechsel), /a/ bei 300 Hz
     (Teiltonabstand 250–375) und /u/ bei 420 Hz (über 375), Vokalwechsel /u/ → /e/, Hauch (SHR „rauschen“, Oktave
     offen), Frikative vor /a/ (Rauschanteil), im Raum mit 40 dB Abstand. */
  const SIG2 = raum(concat([
    pause(0.25),
    rampen(quelle({ f0: stufen([196, 262], 0.5, 0.02), dur: 1.0, jit: 0.005, seed: 3 }, 'a'), 0.005, 0.03), pause(0.2),
    rampen(quelle({ f0: stufen([220, 330], 0.4, 0.02), dur: 0.8, jit: 0.008, shim: 0.02, seed: 27000 }, 'o'), 0.03, 0.03), pause(0.2),
    rampen(quelle({ f0: 300, dur: 0.5, jit: 0.005, seed: 5 }, 'a'), 0.03, 0.03), pause(0.15),
    rampen(quelle({ f0: 420, dur: 0.4, jit: 0.005, seed: 6 }, 'u'), 0.03, 0.03), pause(0.15),
    rampen(concat([quelle({ f0: 110, dur: 0.4, seed: 7 }, 'u'), quelle({ f0: 110, dur: 0.4, seed: 8 }, 'e')]), 0.03, 0.03), pause(0.15),
    rampen(quelle({ f0: 110, dur: 0.5, jit: 0.008, shim: 0.02, hnr: 8, seed: 9 }, 'a'), 0.03, 0.03), pause(0.1),
    rampen(quelle({ f0: 220, dur: 0.9, jit: 0.008, shim: 0.02, hnr: 5, seed: 580 }, 'o'), 0.03, 0.03), pause(0.1),
    frikativ(0.1, 'sch', 11, 0.03), rampen(quelle({ f0: 130, dur: 0.35, seed: 12 }, 'a'), 0.005, 0.03),
    frikativ(0.1, 's', 13, 0.03), rampen(quelle({ f0: 130, dur: 0.35, seed: 14 }, 'a'), 0.005, 0.03),
    pause(0.25)]), 40, 99);
  // Die Felder und Codes aus dem Vertrag A2–A4; Slot-Gründe aus K2 und A3.
  const NEU_ZAHL = ['shrBoden', 'fensterPegelDb', 'fensterF0Lo', 'fensterF0Hi', 'teiltonHz', 'huellAbstandDb', 'fensterRauschAp', 'fensterRauschHochDb'];
  const NEU_CODE = ['f0Grund', 'shrGrund', 'd34Grund', 'd45Grund', 'sfrGrund', 'cppGrund'];
  const ABDECKUNG = ['f0:wechsel', 'f0:oktave', 'shr:rand', 'shr:wechsel', 'shr:rauschen', 'slot:teilton', 'slot:wechsel', 'slot:nummer', 'slot:verschmolzen',
    'd34:teilton', 'd45:teilton', 'sfr:rauschanteil', 'cpp:rauschanteil', 'teilton>375'];
  let ser2 = null, su2 = null, R2 = [];
  const f32 = v => Math.fround(v), gleich = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b;
  try {
    const res = await A.analyseTake(Float32Array.from(SIG2), SR, {});
    ser2 = res.series; su2 = res.summary;
    const TSR = D.TARGET_SR, ds = D.resample(Float32Array.from(SIG2), SR, TSR), hop = Math.round(0.010 * TSR), half = Math.round(0.03 * TSR);
    const floorDb = A.estimateFloor(ds, TSR, 0.010).db;
    for (let c = half; c + half <= ds.length; c += hop) R2.push(D.analyseAt(ds, TSR, c, { align: 'centre', floorDb, spreadMaxHz: D.SPREAD_MAX_HZ }));
  } catch (e) { check('C2a', 'Prüftake Kern 4.1 läuft durch', false, kurz(e)); }

  /* ---------- C2a: Serie und Sicherung ---------- */
  if (ser2) {
    const bad = [], z = {}, n = ser2.t.length, inc = k => { z[k] = (z[k] || 0) + 1; };
    if (n !== R2.length) bad.push(n + ' Rahmen in der Serie, ' + R2.length + ' nachgerechnet');
    for (const f of NEU_ZAHL) if (!(ser2[f] instanceof Float32Array)) bad.push(f + ' kein Float32Array');
    for (const f of NEU_CODE.concat(['slotTeilton', 'slotWechsel'])) if (!(ser2[f] instanceof Uint8Array)) bad.push(f + ' kein Uint8Array');
    if (!bad.length) for (let i = 0; i < n; i++) {
      const r = R2[i];
      for (const f of NEU_ZAHL) if (!gleich(ser2[f][i], f32(r[f]))) { if (bad.length < 6) bad.push(f + '[' + i + '] ' + ser2[f][i] + ' statt ' + r[f]); }
      for (const f of NEU_CODE) { const t = A.textAus(f, ser2[f][i]); if (t !== r[f]) { if (bad.length < 6) bad.push(f + '[' + i + '] „' + t + '“ statt „' + r[f] + '“'); } }
      // Unsicher steckt bei SFR und CPP im Code: Code ≠ 0 genau dann, wenn der Kern unsicher meldet.
      if (!!ser2.sfrGrund[i] !== !!r.sfrUnsure || !!ser2.cppGrund[i] !== !!r.cppUnsure) { if (bad.length < 6) bad.push('SFR/CPP unsicher [' + i + ']'); }
      for (let k = 0; k < 5; k++) { const t = A.slotGrundAus(ser2, i, k); if (t !== r.slotGrund[k]) { if (bad.length < 6) bad.push('Slot ' + (k + 1) + '[' + i + '] „' + t + '“ statt „' + r.slotGrund[k] + '“'); } }
      if (!r.voiced) continue;
      if (r.f0Grund) inc('f0:' + r.f0Grund);
      for (const t of String(r.shrGrund).split('+')) if (t) inc('shr:' + t);
      for (const g of r.slotGrund) if (g) inc('slot:' + g);
      if (r.d34Grund) inc('d34:' + r.d34Grund);
      if (r.d45Grund) inc('d45:' + r.d45Grund);
      if (r.sfrUnsure) inc('sfr:' + r.sfrGrund);
      if (r.cppUnsure) inc('cpp:' + r.cppGrund);
      if (r.teiltonHz > (D.TEILTON_SLOT_HZ || 375)) inc('teilton>375');
    }
    const fehlt = ABDECKUNG.filter(k => !(z[k] >= 1));
    check('C2a', 'Serie: Belege shrBoden, fensterPegelDb, fensterF0Lo/Hi, teiltonHz, huellAbstandDb, fensterRauschAp, fensterRauschHochDb (Float32) und Codes f0Grund, shrGrund, d34Grund, d45Grund, sfrGrund, cppGrund sowie Slot-Gründe aus den Masken — Rahmen für Rahmen gleich analyseAt; jeder Grund aus Kern 4.1 kommt im Prüftake vor',
      !bad.length && !fehlt.length, n + ' Rahmen, ' + JSON.stringify(z) + (fehlt.length ? ' — nicht abgedeckt: ' + fehlt.join(', ') : '') + (bad.length ? ' — ' + bad.join('; ') : ''));
    // Sicherung → Import: jedes neue Feld bitgleich (Float32 mit NaN, Codes und Masken exakt).
    const bad2 = [];
    try {
      const H2 = C.parseBackup(C.serializeBackup({ takes: [{ id: 'c2' }], series: { c2: ser2 }, refs: null, calibrations: [], settings: null })).series.c2;
      for (const f of NEU_ZAHL.concat(NEU_CODE, ['slotTeilton', 'slotWechsel'])) {
        const a = ser2[f], b = H2[f];
        if (!b || b.constructor !== a.constructor || b.length !== a.length) { bad2.push(f + ' fehlt oder anderer Typ'); continue; }
        const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
        for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) { bad2.push(f + ' Byte ' + i); break; }
      }
    } catch (e) { bad2.push('Ausnahme ' + kurz(e)); }
    check('C2a', 'Sicherung → Import: die neuen Belege, Codes und Slot-Masken kommen bitgleich zurück', !bad2.length, bad2.join('; ') || (NEU_ZAHL.length + NEU_CODE.length + 2) + ' Felder');
  }

  /* ---------- C2b: Rahmen- und Take-CSV ---------- */
  if (ser2) {
    const zeilen = (text, sep) => text.replace(/^﻿/, '').split('\r\n').filter(x => x !== '').map(x => x.split(sep));
    const zahl = (v, dec) => (typeof v === 'number' && isFinite(v) ? v : -99).toFixed(dec);
    const bit = f => r => !r.voiced ? '-99' : (f(r) ? '1' : '0'), text = f => r => r.voiced ? f(r) : '';
    const SOLL = [['teilton_hz', r => zahl(f32(r.teiltonHz), 2)], ['d34_grund', text(r => r.d34Grund)], ['d45_grund', text(r => r.d45Grund)], ['huell_abstand_db', r => zahl(f32(r.huellAbstandDb), 2)],
      ['shr_boden_db', r => zahl(f32(r.shrBoden), 2)], ['fenster_pegel_db', r => zahl(f32(r.fensterPegelDb), 2)], ['fenster_f0_lo_hz', r => zahl(f32(r.fensterF0Lo), 2)], ['fenster_f0_hi_hz', r => zahl(f32(r.fensterF0Hi), 2)],
      ['sfr_unsure', bit(r => r.sfrUnsure)], ['sfr_grund', text(r => r.sfrGrund)], ['cpp_unsure', bit(r => r.cppUnsure)], ['cpp_grund', text(r => r.cppGrund)],
      ['fenster_rausch_ap', r => zahl(f32(r.fensterRauschAp), 3)], ['fenster_rausch_hoch_db', r => zahl(f32(r.fensterRauschHochDb), 2)],
      ['f0_grund', text(r => r.f0Grund)], ['shr_grund', text(r => r.shrGrund)]];
    for (let k = 0; k < 5; k++) SOLL.push(['slot_grund' + (k + 1), text(r => r.slotGrund[k])]);
    const z = zeilen(C.framesToCsv(ser2, 'standard', V), ','), kopf = z[0], bad = [], texte = new Set();
    let geprueft = 0;
    for (const [k, f] of SOLL) {
      const c = kopf.indexOf(k);
      if (c < 0) { bad.push(k + ' fehlt'); continue; }
      for (let i = 0; i < R2.length; i++) {
        const want = f(R2[i]), got = z[i + 1] && z[i + 1][c];
        if (got !== want) { if (bad.length < 6) bad.push(k + '[' + i + '] ' + JSON.stringify(got) + ' statt ' + JSON.stringify(want)); } else geprueft++;
        if (/grund/.test(k) && want) for (const t of want.split('+')) texte.add(t);
      }
    }
    const sollTexte = ['wechsel', 'oktave', 'rand', 'rauschen', 'teilton', 'rauschanteil'].filter(t => !texte.has(t));
    check('C2b', 'Rahmen-CSV: teilton_hz, d34_grund, d45_grund, huell_abstand_db, shr_boden_db, fenster_pegel_db, fenster_f0_lo/hi_hz, sfr/cpp_unsure und _grund, fenster_rausch_ap, fenster_rausch_hoch_db, f0_grund, shr_grund und slot_grund1…5 Rahmen für Rahmen gleich analyseAt (Gründe als Text, stimmlos −99 bzw. leer)',
      !bad.length && geprueft === SOLL.length * R2.length && !sollTexte.length, geprueft + '/' + SOLL.length * R2.length + ' Zellen' + (sollTexte.length ? ', Texte fehlen: ' + sollTexte.join(',') : '') + (bad.length ? ' — ' + bad.join('; ') : ''));
    // Take-CSV: die neuen Anteile aus der Zusammenfassung; ältere Zusammenfassung ohne sie −99.
    const TS = [['sfr_unsure_share', su2.sfrUnsureShare], ['cpp_unsure_share', su2.cppUnsureShare], ['teilton_share', su2.teiltonShare], ['teilton_hoch_share', su2.teiltonHochShare]];
    for (let k = 0; k < 5; k++) TS.push(['f' + (k + 1) + '_teilton_share', su2.F[k] && su2.F[k].teiltonShare]);
    const t1 = zeilen(C.takesToCsv([{ code: 'C', summary: su2 }], 'standard'), ','), t2 = zeilen(C.takesToCsv([{ code: 'A', summary: { f0: { med: 110, n: 50 }, F: [{ med: 700, n: 50 }] } }], 'standard'), ','), badT = [];
    for (const [k, v] of TS) {
      const c = t1[0].indexOf(k);
      if (c < 0) { badT.push(k + ' fehlt'); continue; }
      if (t1[1][c] !== zahl(v, 3)) badT.push(k + ' ' + t1[1][c] + ' statt ' + zahl(v, 3));
      const c2 = t2[0].indexOf(k);
      if (c2 < 0 || t2[1][c2] !== '-99.000') badT.push('ältere Zusammenfassung ' + k + ' ' + (c2 < 0 ? 'fehlt' : t2[1][c2]));
    }
    const gemessen = TS.filter(e => typeof e[1] === 'number' && e[1] > 0).length;
    check('C2b', 'Take-CSV: sfr_unsure_share, cpp_unsure_share, teilton_share, teilton_hoch_share, f1…f5_teilton_share aus der Zusammenfassung (im Prüftake ≥ 6 davon > 0); ältere Zusammenfassung −99',
      !badT.length && gemessen >= 6, TS.map(([k, v]) => k + ' ' + zahl(v, 3)).join(', ') + (badT.length ? ' — ' + badT.join('; ') : ''));
  }

  /* ---------- C2c: Zusammenfassung ---------- */
  if (ser2) {
    const V2 = R2.filter(r => r.voiced), nv = V2.length, bad = [];
    const sfrS = A.stats(V2.filter(r => !r.sfrUnsure).map(r => f32(r.sfr))), cppS = A.stats(V2.filter(r => !r.cppUnsure).map(r => f32(r.cpp)));
    const sfrG = A.stats(V2.map(r => f32(r.sfr))), cppG = A.stats(V2.map(r => f32(r.cpp)));
    const nah = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || (typeof a === 'number' && Math.abs(a - b) < 1e-9);
    for (const k of ['med', 'q1', 'q3', 'n']) { if (!nah(su2.sfr[k], sfrS[k])) bad.push('sfr.' + k + ' ' + su2.sfr[k] + ' statt ' + sfrS[k]); if (!nah(su2.cpp[k], cppS[k])) bad.push('cpp.' + k + ' ' + su2.cpp[k] + ' statt ' + cppS[k]); }
    const TD = D.TEILTON_DIFF_HZ || 250, TSL = D.TEILTON_SLOT_HZ || 375;
    const soll = { sfrUnsureShare: V2.filter(r => r.sfrUnsure).length / nv, cppUnsureShare: V2.filter(r => r.cppUnsure).length / nv,
      teiltonShare: V2.filter(r => f32(r.teiltonHz) > TD).length / nv, teiltonHochShare: V2.filter(r => f32(r.teiltonHz) > TSL).length / nv };
    for (const k in soll) if (!nah(su2[k], soll[k])) bad.push(k + ' ' + su2[k] + ' statt ' + soll[k]);
    // Je Formant: Anteil der gültigen Rahmen im Median mit Teiltonabstand über 250 Hz.
    for (let k = 0; k < 5; k++) {
      const g = V2.filter(r => r.valid[k] && isFinite(r.F[k])), w = g.length ? g.filter(r => f32(r.teiltonHz) > TD).length / g.length : NaN;
      if (!nah(su2.F[k].teiltonShare, w)) bad.push('F' + (k + 1) + '.teiltonShare ' + su2.F[k].teiltonShare + ' statt ' + w);
    }
    // SFR je Halbton: Rahmen mit Rauschanteil verschieben den Median ihres Halbtons nicht.
    // Eine Ausnahme (etwa ein fehlendes Serienfeld) reißt dieses Kriterium, nicht das ganze Modul.
    try {
      const sN = A.makeSeries(6), mN = [[196, -10], [196, -12], [196, -14], [196, 20, 1], [196, 22, 1], [196, 24, 1]];
      if (!sN.sfrGrund) throw new Error('Serie ohne sfrGrund');
      mN.forEach(([f0, sfr, u], i) => { sN.t[i] = 0.01 * i; sN.f0[i] = f0; sN.sfr[i] = sfr; sN.flags[i] = A.FLAG.VOICED; sN.sfrGrund[i] = u ? A.codeAus('sfrGrund', 'rauschanteil') : 0; });
      const medN = A.normaliseSfr(sN), gr = medN && medN[Math.round(D.hzToMidi(196))];
      if (!(Math.abs(gr - (-12)) < 1e-6) || !(Math.abs(sN.sfrn[3] - 32) < 1e-4)) bad.push('SFR je Halbton: Median ' + gr + ' statt −12, Rahmen mit Rauschanteil ' + sN.sfrn[3] + ' statt 32');
    } catch (e) { bad.push('SFR je Halbton: ' + kurz(e)); }
    // Ältere Serie ohne die Codes und Belege: Anteile NaN (nicht 0 = „nichts ausgelassen“), Median über alle Rahmen wie damals.
    const alt = {}; for (const k in ser2) if (NEU_ZAHL.concat(NEU_CODE.slice(2), ['slotTeilton', 'slotWechsel']).indexOf(k) < 0) alt[k] = ser2[k];
    let sa = null; try { sa = A.summarise(alt, { hopS: 0.01, durationS: ser2.t.length * 0.01, floorDb: -70, floorSource: 'estimate', floorKnown: true }); } catch (e) { bad.push('ältere Serie: Ausnahme ' + kurz(e)); }
    if (sa) {
      for (const k of ['sfrUnsureShare', 'cppUnsureShare', 'teiltonShare', 'teiltonHochShare']) if (!Number.isNaN(sa[k])) bad.push('ältere Serie ' + k + ' ' + sa[k] + ' statt NaN');
      if (!nah(sa.sfr.n, sfrG.n) || !nah(sa.cpp.n, cppG.n)) bad.push('ältere Serie: SFR/CPP n ' + sa.sfr.n + '/' + sa.cpp.n + ' statt ' + sfrG.n + '/' + cppG.n);
    }
    // Entscheidend: gemischt käme ein anderer SFR- bzw. CPP-Wert heraus (sonst prüfte das Kriterium nichts).
    const abw = ['med', 'q1', 'q3'].map(k => Math.max(Math.abs(sfrG[k] - sfrS[k]), Math.abs(cppG[k] - cppS[k])));
    const entscheidend = sfrG.n !== sfrS.n && Math.max(...abw) > 0.5 && soll.sfrUnsureShare > 0.05 && soll.teiltonHochShare > 0.05;
    check('C2c', 'Zusammenfassung: SFR und CPP (Median, Quartile, n) nur aus Rahmen ohne Rauschanteil, Anteile daneben; Anteil Teiltonabstand über 250 und 375 Hz, je Formant im Median; SFR je Halbton ohne Rahmen mit Rauschanteil; ältere Serie NaN statt 0 und alle Rahmen wie damals',
      !bad.length && entscheidend, 'stimmhaft ' + nv + ', SFR n ' + sfrS.n + ' (gemischt ' + sfrG.n + '), SFR med/q1/q3 ' + [sfrS.med, sfrS.q1, sfrS.q3].map(v => v.toFixed(1)).join('/') + ' (gemischt ' + [sfrG.med, sfrG.q1, sfrG.q3].map(v => v.toFixed(1)).join('/') + '), CPP ' + [cppS.med, cppS.q1, cppS.q3].map(v => v.toFixed(1)).join('/') + ' (gemischt ' + [cppG.med, cppG.q1, cppG.q3].map(v => v.toFixed(1)).join('/') + '), Rauschanteil ' + soll.sfrUnsureShare.toFixed(3)
      + ', über 250 Hz ' + soll.teiltonShare.toFixed(3) + ', über 375 Hz ' + soll.teiltonHochShare.toFixed(3) + (bad.length ? ' — ' + bad.slice(0, 5).join('; ') : ''));
  }

  /* ---------- C2d: Hover, Detail und Liste (chronik.js in einer vm-Umgebung) ---------- */
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const ROOT = path.join(__dirname, '..', '..'), quelleDatei = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const tagFrei = h => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  if (ser2) {
    const bad = [], z = {}, inc = k => { z[k] = (z[k] || 0) + 1; };
    let CHR = null;
    try {
      const sb = { console: { log() { }, warn() { }, error() { } }, devicePixelRatio: 1 };
      sb.self = sb; sb.window = sb; vm.createContext(sb);
      for (const f of ['dsp.js', 'vowel.js', 'analysis.js', 'csv.js', 'chronik.js']) vm.runInContext(quelleDatei(f), sb, { filename: f });
      CHR = sb.VARECHRONIK;
    } catch (e) { bad.push('Ausnahme beim Laden ' + kurz(e)); }
    if (CHR) {
      const fmt = (v, d) => CHR.fmt(v, d);
      for (let i = 0; i < R2.length && bad.length < 8; i++) {
        const r = R2[i];
        if (!r.voiced) continue;
        let h = '';
        try { h = CHR.hoverText(ser2, i, D.SPREAD_MAX_HZ); } catch (e) { bad.push('Hover ' + i + ': ' + kurz(e)); break; }
        const rost = (h.match(/<span class="rust">[^<]*<\/span>/g) || []).map(tagFrei), alle = rost.join(' ‖ ');
        const teil = kopf => rost.find(x => x.startsWith(kopf)) || '';
        if (/Grund unbekannt|Grund nicht gespeichert/.test(tagFrei(h))) bad.push('t ' + i + ': unbekannter Grund — ' + tagFrei(h).slice(0, 160));
        if (r.f0Unsure && r.f0Grund === 'wechsel') { inc('f0 wechsel'); if (!teil('F0 ').includes('Grundton unsicher: Mischwert am Tonwechsel')) bad.push('t ' + i + ' F0 wechsel: „' + teil('F0 ') + '“'); }
        if (r.f0Unsure && r.f0Grund === 'oktave') { inc('f0 oktave'); if (!teil('F0 ').includes('Grundton unsicher: Reihe bei F0/2 teilweise belegt')) bad.push('t ' + i + ' F0 oktave: „' + teil('F0 ') + '“'); }
        if (r.shrUnsure) {
          const shr = teil('SHR ');
          for (const [t, w] of [['rand', 'Ein- oder Aussatz im Fenster (Pegelspanne ' + fmt(f32(r.fensterPegelDb)) + ' dB)'], ['wechsel', 'Tonwechsel im Fenster'], ['rauschen', 'kaum über dem Rauschen zwischen den Teiltönen (' + fmt(f32(r.shrBoden), 1) + ' dB), nur Obergrenze']])
            if (String(r.shrGrund).split('+').indexOf(t) >= 0) { inc('shr ' + t); if (!shr.includes(w)) bad.push('t ' + i + ' SHR ' + t + ': „' + shr + '“ ohne „' + w + '“'); }
        }
        for (let k = 0; k < 5; k++) {
          if (r.valid[k]) continue;
          const fk = teil('F' + (k + 1) + ' ');
          if (r.slotGrund[k] === 'teilton') { inc('slot teilton'); if (!fk.includes('Teiltonabstand ' + fmt(f32(r.teiltonHz)) + ' Hz zu groß')) bad.push('t ' + i + ' F' + (k + 1) + ' teilton: „' + fk + '“'); }
          if (r.slotGrund[k] === 'wechsel') { inc('slot wechsel'); if (!fk.includes('Vokalwechsel im Fenster')) bad.push('t ' + i + ' F' + (k + 1) + ' wechsel: „' + fk + '“'); }
        }
        if (!r.d34valid && r.d34Grund === 'teilton') { inc('d34 teilton'); if (!teil('ΔF3–4 ').includes('(Teiltonabstand ' + fmt(f32(r.teiltonHz)) + ' Hz zu groß, nicht messbar)')) bad.push('t ' + i + ' ΔF3–4: „' + teil('ΔF3–4 ') + '“'); }
        for (const [name, u] of [['SFR ', r.sfrUnsure], ['CPP ', r.cppUnsure]]) {
          const tt = teil(name);
          if (u) { inc(name.trim() + ' rauschanteil'); if (!tt.includes('(unsicher: Rauschanteil im Fenster)')) bad.push('t ' + i + ' ' + name + 'ohne Rost/Grund: „' + alle.slice(0, 100) + '“'); }
          else if (tt) bad.push('t ' + i + ' ' + name + 'sicher, aber in Rost: „' + tt + '“');
        }
      }
      const fehlt = ['f0 wechsel', 'f0 oktave', 'shr rand', 'shr wechsel', 'shr rauschen', 'slot teilton', 'slot wechsel', 'd34 teilton', 'SFR rauschanteil', 'CPP rauschanteil'].filter(k => !(z[k] >= 1));
      check('C2d', 'Hover: Grundton „Mischwert am Tonwechsel“ / „Reihe bei F0/2 teilweise belegt“, SHR „Ein- oder Aussatz“ / „Tonwechsel“ / „kaum über dem Rauschen …, nur Obergrenze“, Formant „Teiltonabstand N Hz zu groß“ / „Vokalwechsel im Fenster“, ΔF3–4 „nicht messbar“, SFR und CPP „Rauschanteil im Fenster“ — in Rost mit Beleg; sicheres SFR/CPP ohne Rost; nie „Grund unbekannt“',
        !bad.length && !fehlt.length, JSON.stringify(z) + (fehlt.length ? ' — nicht abgedeckt: ' + fehlt.join(', ') : '') + (bad.length ? ' — ' + bad.slice(0, 5).join(' | ') : ''));
      // Detail und Liste mit der Zusammenfassung des Prüftakes; ältere Zusammenfassung ohne die Anteile.
      const badD = [];
      try {
        const El = function () { this.innerHTML = ''; };
        El.prototype.querySelector = function () { return { addEventListener() { }, value: '', hidden: false, getContext: () => new Proxy({}, { get: () => () => { } }) }; };
        El.prototype.querySelectorAll = function () { return []; };
        const take = su => ({ id: 'c2', code: 'C', label: 'Prüftake', createdAt: '2026-03-02T09:00:00.000Z', durationS: 7, analysis: { kernelVersion: D.VERSION, gate: { f3MinHz: 2500 } }, summary: su });
        const kacheln = html => { const out = [], re = /<div class="stat([^"]*)"><span class="k">([\s\S]*?)<\/span><span class="v">([\s\S]*?)<\/span><\/div>/g; let m; while ((m = re.exec(html))) out.push({ klasse: m[1].trim(), k: tagFrei(m[2]), vHtml: m[3] }); return out; };
        const detail = su => { const d = new El(); CHR.renderDetail(d, take(su), null, {}, false, {}); return kacheln(d.innerHTML); };
        const ks = detail(su2), k = re => ks.find(x => re.test(x.k)) || { klasse: '?', vHtml: '' }, pz = x => CHR.prozentHtml(x);
        for (const [re, share] of [[/^SFR/, su2.sfrUnsureShare], [/^CPP/, su2.cppUnsureShare]])
          if (!k(re).vHtml.includes('<span class="rust">· Rauschanteil im Fenster in ' + pz(share) + ' % der Rahmen, nicht im Median</span>')) badD.push(re + ' „' + tagFrei(k(re).vHtml) + '“');
        const hl = k(/^Hohe Lage/);
        if (!hl.vHtml.includes('<span class="rust">Teiltonabstand über ' + (D.TEILTON_DIFF_HZ || 250) + ' Hz in ' + pz(su2.teiltonShare) + ' % der Rahmen') || !hl.vHtml.includes('über ' + (D.TEILTON_SLOT_HZ || 375) + ' Hz in ' + pz(su2.teiltonHochShare) + ' %: kein Formant messbar')) badD.push('Hohe Lage „' + tagFrei(hl.vHtml) + '“');
        for (let q = 0; q < 5; q++) {
          const f = su2.F[q], fk = k(new RegExp('^F' + (q + 1) + '$')), soll = f && f.teiltonShare > 0;
          if (soll !== fk.vHtml.includes('<span class="rust">· in ' + pz(f && f.teiltonShare) + ' % Teiltonabstand über')) badD.push('F' + (q + 1) + ' Teiltonanteil ' + (f && f.teiltonShare) + ': „' + tagFrei(fk.vHtml) + '“');
        }
        // Ältere Zusammenfassung: benannt, nicht in Rost, keine Kachel „Hohe Lage“.
        const alt = JSON.parse(JSON.stringify(su2)); for (const f of ['sfrUnsureShare', 'cppUnsureShare', 'teiltonShare', 'teiltonHochShare']) delete alt[f];
        const ka = detail(alt), sa = ka.find(x => /^SFR/.test(x.k)) || { vHtml: '' };
        if (!/ältere Auswertung: Rahmen mit Rauschanteil nicht getrennt/.test(sa.vHtml) || /rust/.test(sa.vHtml) || ka.some(x => /^Hohe Lage/.test(x.k))) badD.push('ältere Auswertung „' + tagFrei(sa.vHtml) + '“');
        // Liste: SFR mit dem Anteil in Rost.
        const div = new El(); CHR.renderList(div, [take(su2)], {}, {});
        const zellen = ((/<tr data-id="[^"]*">([\s\S]*?)<\/tr>/.exec(div.innerHTML) || [])[1] || '').split(/<\/td>/);
        if (!/class="rust small" title="Rauschanteil im Fenster in [^"]*"[^>]*>[^<]*% unsicher</.test(zellen[6] || '')) badD.push('Liste SFR „' + tagFrei(zellen[6] || '') + '“');
      } catch (e) { badD.push('Ausnahme ' + kurz(e)); }
      check('C2d', 'Detail und Liste: SFR und CPP mit „Rauschanteil im Fenster in N % der Rahmen, nicht im Median“ in Rost, Kachel „Hohe Lage“ mit den Anteilen über 250 und 375 Hz, je Formant der Anteil mit Teiltonabstand über 250 Hz; ältere Auswertung benannt ohne Rost; Liste SFR mit Anteil',
        !badD.length, badD.join(' | ') || 'SFR ' + CHR.prozent(su2.sfrUnsureShare) + ' %, über 250 Hz ' + CHR.prozent(su2.teiltonShare) + ' %, über 375 Hz ' + CHR.prozent(su2.teiltonHochShare) + ' %');
    }
  }

  /* ---------- C2e: live (app.js) und Ergebnis nach dem Take ---------- */
  {
    const els = {}, intervalle = [];
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
      getContext() { return new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => { }), set: (t, k, v) => { t[k] = v; return true; } }); }
      getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 600, height: 100 }; }
    }
    const el = id => els[id] || (els[id] = new El(id));
    let raf = null;
    const meta = new Map(), P = v => Promise.resolve(v);
    const store = { open: () => P(), putTake: () => P(), getTake: () => P(null), allTakes: () => P([]), deleteTake: () => P(), putSeries: () => P(), getSeries: () => P(null), putAudio: () => P(), getAudio: () => P(null),
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
      for (const f of ['dsp.js', 'vowel.js', 'analysis.js', 'csv.js', 'wav.js', 'calibration.js', 'korpus.js', 'chronik.js']) vm.runInContext(quelleDatei(f), ab, { filename: f });
      ab.VARESTORE = store; ab.VARERECORDER = { createRecorder: () => rec, listDevices: () => P([]) };
      vm.runInContext(quelleDatei('app.js'), ab, { filename: 'app.js' });
      const st = ab.VAREAPP.state;
      for (let w = 0; w < 500 && !st.settings; w++) await new Promise(r => setTimeout(r, 2));
      el('btn-mic').click();
      for (let w = 0; w < 500 && !(rec.active && raf); w++) await new Promise(r => setTimeout(r, 2));
      const DD = ab.VAREDSP, echt = DD.analyseAt, sig = DD.resample(DD.synthVowel(196, VOK.a[0], VOK.a[1], 0.4, 48000), 48000, DD.TARGET_SR);
      const basis = echt(sig, DD.TARGET_SR, sig.length - 1, { align: 'end', wantSpectrum: true, floorDb: -70 });
      let jetzt = 1000;
      const zeige = aenderung => {
        const fr = Object.assign({}, basis, aenderung);
        DD.analyseAt = () => fr;
        rec.samplesSeen += 1000; jetzt += 100; raf(jetzt);
        const kach = id => ({ unsure: /\bunsure\b/.test(el('st-' + id).className), text: el('v-' + id).textContent });
        return { f0: kach('f0'), f2: kach('f2'), f3: kach('f3'), d34: kach('d34'), d45: kach('d45'), sfr: kach('sfr'), shr: kach('shr'), cpp: kach('cpp'), hinweis: el('live-hints').textContent };
      };
      if (!(basis.voiced && basis.valid.every(Boolean) && basis.d34valid && !basis.sfrUnsure && !basis.cppUnsure && !basis.f0Unsure && !basis.shrUnsure)) bad.push('Grundrahmen nicht sauber');
      const pruef = (name, ok, kachel) => { if (!ok) bad.push(name + ': „' + kachel.text + '“' + (kachel.unsure ? ' (Rost)' : ' (ohne Rost)')); };
      let a = zeige({});
      pruef('sicheres SFR ohne Rost', !a.sfr.unsure && !/unsicher/.test(a.sfr.text), a.sfr); pruef('sicheres CPP ohne Rost', !a.cpp.unsure && !/unsicher/.test(a.cpp.text), a.cpp);
      a = zeige({ sfrUnsure: true, sfrGrund: 'rauschanteil', cppUnsure: true, cppGrund: 'rauschanteil' });
      pruef('SFR Rauschanteil', a.sfr.unsure && a.sfr.text.includes(' — unsicher: Rauschanteil im Fenster'), a.sfr); pruef('CPP Rauschanteil', a.cpp.unsure && a.cpp.text.includes(' — unsicher: Rauschanteil im Fenster'), a.cpp);
      belege.push('SFR „' + a.sfr.text + '“');
      a = zeige({ f0Unsure: true, f0Grund: 'wechsel', fensterF0Lo: 220, fensterF0Hi: 330 });
      pruef('F0 wechsel', a.f0.unsure && a.f0.text.includes('Grundton unsicher: Mischwert am Tonwechsel (Teilfenster 220–330 Hz)') && a.hinweis.includes('Mischwert am Tonwechsel'), a.f0);
      a = zeige({ f0Unsure: true, f0Grund: 'oktave', octaveAmbiguous: true });
      pruef('F0 oktave', a.f0.unsure && a.f0.text.includes('Grundton unsicher: Reihe bei F0/2 teilweise belegt, womöglich eine Oktave tiefer'), a.f0);
      a = zeige({ shr: -12, shrUnsure: true, shrGrund: 'rand+wechsel+rauschen', shrOther: NaN, fensterPegelDb: 15.2, fensterF0Lo: 196, fensterF0Hi: 262, shrBoden: -16.3 });
      pruef('SHR rand+wechsel+rauschen', a.shr.unsure && a.shr.text.includes('unsicher: Ein- oder Aussatz im Fenster (Pegelspanne 15 dB), Tonwechsel im Fenster (196–262 Hz), kaum über dem Rauschen zwischen den Teiltönen (-16.3 dB), nur Obergrenze'), a.shr);
      belege.push('SHR „' + a.shr.text + '“');
      const slot = (k, g) => { const v = basis.valid.slice(), u = basis.slotUnsure.slice(), sg = basis.slotGrund.slice(); v[k] = false; u[k] = true; sg[k] = g; return { valid: v, slotUnsure: u, slotGrund: sg, d34valid: v[2] && v[3], d45valid: v[3] && v[4] }; };
      a = zeige(Object.assign(slot(2, 'teilton'), { teiltonHz: 300 }));
      pruef('F3 teilton', a.f3.unsure && a.f3.text.includes(' — Teiltonabstand 300 Hz zu groß'), a.f3);
      a = zeige(slot(1, 'wechsel'));
      pruef('F2 wechsel', a.f2.unsure && a.f2.text.includes(' — Vokalwechsel im Fenster'), a.f2);
      a = zeige({ d34valid: false, d45valid: false, d34Grund: 'teilton', d45Grund: 'teilton', teiltonHz: 300 });
      pruef('ΔF3–4 teilton', a.d34.unsure && a.d34.text.includes(' — nicht messbar: Teiltonabstand 300 Hz zu groß'), a.d34);
      pruef('ΔF4–5 teilton', a.d45.unsure && a.d45.text.includes(' — nicht messbar: Teiltonabstand 300 Hz zu groß'), a.d45);
      belege.push('ΔF3–4 „' + a.d34.text + '“');
      ab.VAREDSP.analyseAt = echt;
    } catch (e) { bad.push('Ausnahme ' + kurz(e)); }
    check('C2e', 'Live: SFR und CPP mit Rauschanteil in Rost mit Grund, sicher ohne Rost; Grundton „Mischwert am Tonwechsel (Teilfenster …)“ und „Reihe bei F0/2 teilweise belegt“; SHR mit allen drei neuen Gründen samt Belegen; Formant „Teiltonabstand N Hz zu groß“ und „Vokalwechsel im Fenster“; ΔF3–4 und ΔF4–5 „nicht messbar: Teiltonabstand …“ — jeweils in Rost',
      !bad.length, bad.length ? bad.slice(0, 5).join(' | ') : belege.join(' | '));
    // Ergebnis gleich nach dem Take: Frikative vor /a/ auf G3-Nähe und /a/ bei 300 Hz.
    const badE = [];
    let erg = '';
    try {
      const st = ab.VAREAPP.state;
      const sigE = raum(concat([pause(0.2), frikativ(0.1, 's', 13, 0.03), rampen(quelle({ f0: 130, dur: 0.35, seed: 14 }, 'a'), 0.005, 0.03), pause(0.15),
        frikativ(0.1, 'sch', 11, 0.03), rampen(quelle({ f0: 130, dur: 0.35, seed: 12 }, 'a'), 0.005, 0.03), pause(0.15),
        rampen(quelle({ f0: 300, dur: 0.5, jit: 0.005, seed: 5 }, 'a'), 0.03, 0.03), pause(0.2)]), 40, 98);
      ab.VAREAPP.finishTake(Float32Array.from(sigE), SR);
      for (let w = 0; w < 30000 && !/Gespeichert als/.test(el('take-result').innerHTML); w += 5) await new Promise(r => setTimeout(r, 5));
      for (let w = 0; w < 2000 && st.busy; w += 5) await new Promise(r => setTimeout(r, 5));
      erg = el('take-result').innerHTML;
      if (!/<span class="rust">· Rauschanteil im Fenster in [^<]+ % der Rahmen, nicht im Median<\/span>/.test(erg)) badE.push('kein Rauschanteil in Rost');
      if (!/<span class="k">Hohe Lage<\/span><span class="v"><span class="rust">Teiltonabstand über \d+ Hz in [^<]+ % der Rahmen/.test(erg)) badE.push('keine Kachel „Hohe Lage“ in Rost');
    } catch (e) { badE.push('Ausnahme ' + kurz(e)); }
    intervalle.forEach(h => clearInterval(h));
    check('C2e', 'Ergebnis nach dem Take: SFR · SHR max · CPP mit dem Rauschanteil in Rost, Kachel „Hohe Lage“ mit dem Anteil über 250 Hz in Rost',
      !badE.length, badE.length ? badE.join(' | ') + ' — ' + tagFrei(erg).slice(0, 300) : tagFrei((/SFR · SHR max · CPP[\s\S]*?<\/div>/.exec(erg) || [''])[0]).slice(0, 200) + ' | ' + tagFrei((/Hohe Lage[\s\S]*?<\/div>/.exec(erg) || [''])[0]).slice(0, 160));
  }
};

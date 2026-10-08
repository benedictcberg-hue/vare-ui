/* Kriterien der Zusammenführung: Kern 4.1 (A1–A4, fix/kern2) und Oberfläche (B1–B3, fix/ui2) zusammen.
   Beide Seiten wurden getrennt gebaut und geprüft; hier steht, was erst im zusammengeführten Baum gilt.
   C1a: Bitraum der Serie. B1 belegt FLAG.NAHT, der Kern bringt neue Marken und Gründe (A2–A4), die noch
        durchgereicht werden: Jede Marke ist ein eigenes Bit im Serienfeld flags, jeder Grundcode passt in sein
        Serienfeld und erreicht CODE_UNBEKANNT nie, Hin- und Rückweg Text → Code → Text ist verlustfrei.
   C1b: Rahmen an einer Naht (B1) sind nicht gemessen — in jedem Serienfeld und jeder Spalte der Rahmen-CSV,
        auch in Feldern und Spalten, die später für neue Kernwerte hinzukommen.
   C1c: Feinspur und Sprungsuche je Abschnitt (B1) mit der Sprungerkennung des Kerns (A1): Nähte am Rand, doppelt,
        dicht beieinander, Abschnitte kürzer als ein Feinspurfenster; Ereignisse an ihrer Stelle im Take.
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
};

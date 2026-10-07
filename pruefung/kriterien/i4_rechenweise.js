/* I4 — Rechenweise: Kernversion, „Alle neu analysieren“, CSV für Excel DE, exakte Sicherung.
   „Vergleiche nur bei gleicher Rechenweise“ (Manual) hängt an der Kernversion: analysis.js unvergleichbar()
   vergleicht D.VERSION, die Chronik zeigt „älterer Kern“. K1 (Sprungzählung), K2 (Formantgültigkeit),
   K3 (Grundton) und K4 (SHR) haben den Kern geändert, die Version blieb 3.0.0 — alte und neue Takes galten
   als gleich gerechnet und speisten dieselben Referenzen.
   I4a Kernversion und Kern-Fingerabdruck. Die übrigen Teile folgen unten. */
'use strict';
const path = require('path'), crypto = require('crypto');

/* ---------- Kern-Fingerabdruck ----------
   Gleiche Versionsnummer muss gleiche Rechenweise heißen. Der Fingerabdruck rechnet einen festen Prüfsatz
   durch den Kern (resample, analyseAt alle 20 ms, pitchTrackFine, detectJumps) und hält das Ergebnis gerundet
   fest: Grundton, Formanten, Streuungen, Bandbreiten, Gültigkeit mit Gründen, Grundton- und SHR-Zweifel,
   SFR, CPP, H1−H2, dazu die ausgewiesenen Schwellen. Ein Stolperdraht, kein Beweis: Eine innere Konstante,
   die dsp.js nicht ausweist und die kein Prüffall kreuzt, bleibt unbemerkt.
   Die Prüfsignale erzeugt dieses Modul selbst, nicht dsp.js: eine Änderung am Prüfsignal-Generator des
   Kerns ist keine Änderung der Rechenweise. Je Prüffall ein kurzer SHA-256, damit ein Riss nennt, welcher
   Fall sich bewegt hat. */
const FA_SR = 48000;
function lcg(n, amp, seed) {
  let s = seed >>> 0; const out = new Float64Array(n);
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; out[i] = amp * ((s / 4294967296) * 2 - 1); }
  return out;
}
// Impulsfolge (Lage auf zwei Abtastwerte verteilt, damit die Periode nicht gerundet wird) durch Zweipol-
// Resonatoren in Reihe. wechsel ≠ 1: jeder zweite Impuls mit diesem Faktor (Periodenverdopplung).
function faVokal(f0, F, B, dur, wechsel) {
  const n = Math.round(dur * FA_SR), x = new Float64Array(n);
  for (let t = 0, k = 0; t < n - 1; t += FA_SR / f0, k++) {
    const i = Math.floor(t), fr = t - i, a = (wechsel && k % 2) ? wechsel : 1;
    x[i] += a * (1 - fr); x[i + 1] += a * fr;
  }
  let y = x;
  for (let j = 0; j < F.length; j++) {
    const r = Math.exp(-Math.PI * B[j] / FA_SR), c = 2 * r * Math.cos(2 * Math.PI * F[j] / FA_SR), z = new Float64Array(n);
    for (let i = 0; i < n; i++) z[i] = y[i] + (i > 0 ? c * z[i - 1] : 0) - (i > 1 ? r * r * z[i - 2] : 0);
    y = z;
  }
  let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(y[i]));
  for (let i = 0; i < n; i++) y[i] *= 0.3 / m;
  return y;
}
function faFolge(teile) {
  let n = 0; for (const t of teile) n += t.length;
  const o = new Float64Array(n); let p = 0; for (const t of teile) { o.set(t, p); p += t.length; }
  return o;
}
const FA_A = [[700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200]];
// Rauschen in festem Abstand (dB) unter den Effektivwert des Signals.
function faMitRauschen(x, abstandDb, seed) {
  let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i];
  const z = lcg(x.length, Math.sqrt(3 * e / x.length) * Math.pow(10, -abstandDb / 20), seed), y = Float64Array.from(x);
  for (let i = 0; i < y.length; i++) y[i] += z[i];
  return y;
}
function faPruefsatz() {
  const ENG = [[500, 1500, 1700, 2200, 3150], [70, 90, 90, 90, 100]];
  return [
    ['a 196', faVokal(196, FA_A[0], FA_A[1], 0.5)],
    ['i 196', faVokal(196, [300, 2200, 2900, 3500, 4300], [60, 100, 130, 160, 200], 0.5)],
    ['eng 196', faVokal(196, [500, 1500, 2450, 2800, 3150], [70, 90, 90, 90, 100], 0.5)],
    ['a 123,5', faVokal(123.5, FA_A[0], FA_A[1], 0.5)],
    ['F1 auf H2 349', faVokal(349, [700, 1300, 2500, 3300, 4200], [90, 100, 130, 160, 200], 0.5)],
    // Rauschen in drei Abständen: Rauschboden-Regel, Gipfelzahl und Lesarten wechseln hier zuerst.
    ['eng 110 Rauschen 20 dB', faMitRauschen(faVokal(110, ENG[0], ENG[1], 0.5), 20, 41)],
    ['eng 110 Rauschen 30 dB', faMitRauschen(faVokal(110, ENG[0], ENG[1], 0.5), 30, 42)],
    ['a 147 Rauschen 25 dB', faMitRauschen(faVokal(147, FA_A[0], FA_A[1], 0.5), 25, 44)],
    ['o 247 Rauschen 35 dB', faMitRauschen(faVokal(247, [500, 800, 2600, 2950, 4100], [70, 90, 120, 150, 200], 0.5), 35, 45)],
    ['o 310', faVokal(310, [450, 800, 2500, 3300, 4200], [70, 90, 120, 150, 200], 0.5)],
    ['Wechsel 150', faVokal(150, FA_A[0], FA_A[1], 0.5, 0.5)],
    ['Wechsel 98 schwach', faVokal(98, FA_A[0], FA_A[1], 0.5, 0.8)],
    ['F1 = 2·F0 175', faVokal(175, [350, 1400, 2500, 3300, 4200], [50, 90, 120, 150, 200], 0.5)]
  ];
}
function faZahl(v, d) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(d) : String(v); }
function faMaske(a) { return Array.isArray(a) ? a.map(x => (x ? 1 : 0)).join('') : String(a); }
function faListe(a, d) { return Array.isArray(a) ? a.map(v => faZahl(v, d)).join('/') : String(a); }
function faRahmen(r) {
  return [faZahl(r.f0, 1), faListe(r.F, 0), faMaske(r.valid), faMaske(r.slotUnsure), faListe(r.slotGrund), faMaske(r.rauschBoden),
    faListe(r.sdOrder, 0), faListe(r.sdWin, 0), faListe(r.BW, 0), r.d34valid ? 1 : 0, faZahl(r.ap, 3),
    r.octaveCorrected ? 1 : 0, r.octaveAmbiguous ? 1 : 0, String(r.f0Unsure), String(r.f0Grund), faZahl(r.f0Cep, 1),
    faZahl(r.shr, 1), faZahl(r.shrGrid, 0), String(r.shrUnsure), faZahl(r.shrKamm, 1), faZahl(r.shrZweitpuls, 2),
    faZahl(r.sfr, 1), faZahl(r.cpp, 1), faZahl(r.h1h2, 1)].join(' ');
}
// Liefert { Fall: Kurzhash } für den übergebenen Kern D.
function fingerabdruck(D) {
  const TSR = D.TARGET_SR, out = {};
  const kurz = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
  for (const [name, sig] of faPruefsatz()) {
    const ds = D.resample(sig, FA_SR, TSR);
    const z = [];
    for (let t = 0.08; t <= 0.42 + 1e-9; t += 0.02) z.push(faRahmen(D.analyseAt(ds, TSR, Math.round(t * TSR), {})));
    out[name] = kurz(z.join('\n'));
  }
  // Schwellen und Raster, die der Kern ausweist: Eine verschobene Schwelle ändert die Rechenweise, auch wenn
  // gerade kein Prüffall sie kreuzt. Die Versionsnummer selbst gehört nicht dazu.
  out['Konstanten'] = kurz(Object.keys(D).filter(k => k !== 'VERSION' && typeof D[k] !== 'function').sort().map(k => k + '=' + JSON.stringify(D[k])).join('\n'));
  // Sprungzählung (K1): Kiekser 50 ms, Atempause, Quinte gehalten — Ereignisse mit Art, Lage, Dauer, Weite.
  const ton = (f, s) => faVokal(f, FA_A[0], FA_A[1], s);
  const sprung = faFolge([ton(196, 0.5), ton(392, 0.05), ton(196, 0.4), lcg(Math.round(0.3 * FA_SR), 2e-4, 43), ton(262, 0.4), ton(392, 0.3), ton(262, 0.3)]);
  const ev = D.detectJumps(D.pitchTrackFine(D.resample(sprung, FA_SR, TSR), TSR, {}), {});
  out['Sprünge'] = kurz(ev.map(e => [e.art, faZahl(e.startS, 2), faZahl(e.dauerS, 2), faZahl(e.halbtoene, 1)].join(' ')).join('\n'));
  return out;
}
/* Aufgenommene Fingerabdrücke. '3.0.0' ist der Kern vor K1–K4 (Stand 98fbbb4), mit derselben Funktion
   gerechnet. Ändert sich ein Wert des Prüfsatzes, rechnet der Kern anders: Versionsnummer erhöhen und den
   neuen Fingerabdruck hier eintragen (der Riss nennt ihn) — nie einen alten Eintrag überschreiben. */
const FINGERABDRUCK = {
  '3.0.0': {
    'a 196': '026287c48052', 'i 196': 'd7789b2dbc8b', 'eng 196': '8df0d9e978a4', 'a 123,5': '3202a5a2c302',
    'F1 auf H2 349': '91de1e821280', 'eng 110 Rauschen 20 dB': 'd1177c74d7b5', 'eng 110 Rauschen 30 dB': '123732fa61c8', 'a 147 Rauschen 25 dB': '0baf9bf20b13',
    'o 247 Rauschen 35 dB': 'fe34aaa60fad', 'o 310': '2632220f1b24', 'Wechsel 150': '5c9174fe43fb', 'Wechsel 98 schwach': 'ceb6a4fe2970',
    'F1 = 2·F0 175': 'ad9204c10a9e', 'Sprünge': 'cd12a58b91be', 'Konstanten': '1db64265f4ec'
  },
  '4.0.0': {
    'a 196': 'dd8fa3cb2a17', 'i 196': 'a7487878a094', 'eng 196': '72cc581d2edd', 'a 123,5': 'c7d035ad7dc9',
    'F1 auf H2 349': 'e57e00ec6bae', 'eng 110 Rauschen 20 dB': 'f38b6da48aa1', 'eng 110 Rauschen 30 dB': '5d4db5286d99', 'a 147 Rauschen 25 dB': 'a87cf49d4e68',
    'o 247 Rauschen 35 dB': 'fde6d2591c70', 'o 310': '97d66c212a1a', 'Wechsel 150': 'dca6899fa53f', 'Wechsel 98 schwach': '53e14c134b8b',
    'F1 = 2·F0 175': '7adb35626bc7', 'Sprünge': '87381f612abb', 'Konstanten': '77ba6e2bb50e'
  }
};

module.exports = async function (H) {
  const { check, D, A, V } = H;
  const U = require(path.join(__dirname, 'u_oberflaeche.js')).hilfen;

  /* ---------- I4a: Kernversion ---------- */
  {
    // Rechenweise, wie app.js sie übergibt (Vorgaben); gespeichert wird das ganze Gatter wie in analyseTake.
    const AKT = { kernelVersion: D.VERSION, gate: { windowS: 0.30, sdF1Max: 50, sdF2Max: 100, minValidShare: 0.80, f3MinHz: 2500 }, spreadMaxHz: 130, hopS: 0.010 };
    const take = (id, kern) => ({ id, code: id, label: id, createdAt: '2026-03-02T09:00:00.000Z', durationS: 2, sampleRate: 48000,
      analysis: { kernelVersion: kern, hopS: 0.010, spreadMaxHz: 130, gate: V.createGate(AKT.gate).opts, analysedAt: '2026-03-02T09:00:00.000Z' },
      summary: { summaryVersion: A.SUMMARY_VERSION, F: [], perVowel: { a: { segments: 1, segmentsAmbiguous: 0, bestSegment: { d34Med: 800, startS: 0.5, lenS: 1, n: 90, ambiguousShare: 0 } } } } });
    // Ein Take aus dem Kern vor K1–K4 trägt „3.0.0“; derselbe Take mit der jetzigen Version zum Vergleich.
    const alt = take('ALT', '3.0.0'), neu = take('NEU', D.VERSION);
    const uvAlt = A.unvergleichbar(alt, AKT), uvNeu = A.unvergleichbar(neu, AKT);
    const refAlt = A.computeRefs([alt], {}, AKT), refNeu = A.computeRefs([neu], {}, AKT);
    const sb = U.chronikNeu(), CHR = sb.VARECHRONIK, h = { unvergleichbar: t => A.unvergleichbar(t, AKT) };
    const detail = t => { const d = new U.El(); CHR.renderDetail(d, t, null, {}, true, h); return d.innerHTML; };
    const zeile = t => { const d = new U.El(); CHR.renderList(d, [t], { [t.id]: true }, h); return U.listenZellen(d.innerHTML).join(''); };
    const dAlt = detail(alt), dNeu = detail(neu), lAlt = zeile(alt), lNeu = zeile(neu);
    check('I4a', 'Kernversion nach K1–K4: ein Take aus dem Kern 3.0.0 ist anders gerechnet — keine Referenz, „älterer Kern“ im Detail, „alt“ und „anders gerechnet“ in der Liste, Neu-Analyse mit dem jetzigen Kern angeboten; ein jetzt gerechneter Take nichts davon',
      D.VERSION !== '3.0.0' && uvAlt.startsWith('Kern 3.0.0 statt ' + D.VERSION) && uvNeu === '' && !refAlt.a && !!refNeu.a && refNeu.a.d34 === 800
      && /älterer Kern/.test(dAlt) && dAlt.indexOf('Neu analysieren (Kern ' + D.VERSION + ')') >= 0 && /Nicht als Referenz wählbar/.test(dAlt)
      && /<span class="tag rust">alt<\/span>/.test(lAlt) && />anders gerechnet</.test(lAlt)
      && !/älterer Kern/.test(dNeu) && !/Nicht als Referenz wählbar/.test(dNeu) && !/>alt</.test(lNeu) && !/anders gerechnet/.test(lNeu),
      'Kern ' + D.VERSION + ' | alt: „' + uvAlt + '“, Referenz ' + (refAlt.a ? refAlt.a.d34 : 'keine') + ', älterer Kern ' + /älterer Kern/.test(dAlt) + ' | neu: „' + uvNeu + '“, Referenz ' + (refNeu.a ? refNeu.a.d34 : 'keine'));

    const fa = fingerabdruck(D), soll = FINGERABDRUCK[D.VERSION];
    const anders = soll ? Object.keys(fa).filter(k => fa[k] !== soll[k]) : Object.keys(fa);
    const gleichAlt = Object.keys(FINGERABDRUCK).filter(v => v !== D.VERSION && FINGERABDRUCK[v] && Object.keys(fa).every(k => fa[k] === FINGERABDRUCK[v][k]));
    check('I4a', 'Kern-Fingerabdruck: Kern ' + D.VERSION + ' rechnet den Prüfsatz genau wie der Kern, der diese Nummer zuerst trug (sonst Version erhöhen und eintragen); keine andere Version rechnet gleich',
      !!soll && !anders.length && !gleichAlt.length,
      (soll ? (anders.length ? 'anders in: ' + anders.join(', ') : 'gleich') : 'keine Aufnahme für ' + D.VERSION) + (gleichAlt.length ? ' | rechnet wie ' + gleichAlt.join(', ') : '')
      + ' | jetzt ' + JSON.stringify(fa));
  }
};
module.exports.fingerabdruck = fingerabdruck;

/* VARE — Prüflauf (verbindlich). Aufruf: node test_dsp.js
   Synthetische Vokale mit bekannter Wahrheit gegen den Rechenkern. Exit-Code 1, sobald ein Kriterium
   reißt. Reißt eines, ist das ein Befund und keine Toleranzfrage — melden, nicht die Schwelle anheben.
   Keine Abhängigkeiten, läuft unter Node auf Windows und Linux. */
'use strict';
const D = require('./dsp.js'), V = require('./vowel.js'), A = require('./analysis.js'), C = require('./csv.js'), W = require('./wav.js');
const SR = 48000, TSR = D.TARGET_SR;
let fails = 0, passes = 0;
const lines = [];
function check(id, name, ok, detail) {
  const s = (ok ? 'PASS ' : 'FAIL ') + id.padEnd(5) + name + (detail ? '  [' + detail + ']' : '');
  lines.push(s); console.log(s);
  if (ok) passes++; else fails++;
}
const near = (a, b, tol) => isFinite(a) && Math.abs(a - b) <= tol;
const r0 = v => isFinite(v) ? v.toFixed(0) : '--';
const r1 = v => isFinite(v) ? v.toFixed(1) : '--';
const r2 = v => isFinite(v) ? v.toFixed(2) : '--';
const BW5 = [80, 90, 120, 150, 200];
function noise(n, amp, seed) {              // deterministisches Rauschen (LCG), Windows/Linux gleich
  let s = seed || 12345; const out = new Float64Array(n);
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; out[i] = amp * ((s / 4294967296) * 2 - 1); }
  return out;
}
function tone(f, sr, dur, amp) { const n = Math.round(dur * sr), y = new Float64Array(n); for (let i = 0; i < n; i++) y[i] = amp * Math.sin(2 * Math.PI * f * i / sr); return y; }
function concat(parts) { let n = 0; for (const p of parts) n += p.length; const out = new Float64Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
function scale(x, g) { const y = new Float64Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] * g; return y; }
function dbToLin(db) { return Math.pow(10, db / 20); }

console.log('=== VARE PRUEFLAUF, Kern ' + D.VERSION + ', Node ' + process.version + ', ' + process.platform + ' ===\n');

/* ---------- T1: Abnahmetabelle v16 ---------- */
const CASES = [
  { id: 'a-G3', label: '/a/ bei G3', f0: 196, F: [700, 1200, 2500, 3300, 4200], B: BW5, max: 60, v2: 55 },
  { id: 'i-G3', label: '/i/ bei G3', f0: 196, F: [300, 2200, 2900, 3500, 4300], B: [60, 100, 130, 160, 200], max: 100, v2: 93 },
  { id: 'u-G3', label: '/u/ bei G3', f0: 196, F: [320, 800, 2400, 3300, 4200], B: [60, 90, 120, 150, 200], max: 90, v2: 85 },
  { id: 'eng', label: 'Cluster eng', f0: 196, F: [500, 1500, 2450, 2800, 3150], B: [70, 90, 90, 90, 100], max: 90, v2: 68 },
  { id: 'weit', label: 'Cluster weit', f0: 196, F: [500, 1500, 2300, 3350, 4300], B: [70, 90, 130, 170, 220], max: 90, v2: 58 },
  { id: 'f4mod', label: 'f4 modal, F1 auf H2', f0: 349, F: [700, 1300, 2500, 3300, 4200], B: [90, 100, 130, 160, 200], max: 170, v2: 159 },
  { id: 'a-B2', label: '/a/ bei B2', f0: 123.5, F: [700, 1200, 2500, 3300, 4200], B: BW5, max: 30, v2: 26 },
  { id: 'f4f1', label: 'f4 F1/F0-Modus (nur Bericht)', f0: 349, F: [355, 1400, 2600, 3400, 4300], B: [70, 100, 130, 160, 200], max: null, v2: 136 }
];
console.log('T1  Abnahmetabelle: Einzelrahmen (2048 @ 48 kHz, wie v16) und analyseAt (Fenstersweep, 0,5-s-Take)');
console.log('    Fall                 Grenze  v2-Kern  Einzelrahmen  Fenstersweep   F (Sweep)                  sdOrder / sdWin (Sweep)');
const measured = {};
for (const c of CASES) {
  const sig = D.synthVowel(c.f0, c.F, c.B, 0.5, SR);
  const frame = sig.subarray(2000, 2000 + 2048);
  const r1f = D.analyse(frame, SR, {});
  const ds = D.resample(sig, SR, TSR);
  const r2 = D.analyseAt(ds, TSR, Math.round(0.25 * TSR), {});
  const e1 = Math.max(...r1f.F.map((v, i) => Math.abs(v - c.F[i])));
  const e2 = Math.max(...r2.F.map((v, i) => Math.abs(v - c.F[i])));
  measured[c.id] = { single: r1f, sweep: r2, e1, e2 };
  console.log('    ' + c.label.padEnd(20) + ' ' + String(c.max == null ? '--' : c.max).padStart(5) + '  ' + String(c.v2).padStart(7) + '  ' + r0(e1).padStart(12) + '  ' + r0(e2).padStart(12) + '   ' + r2.F.map(r0).join(' ').padEnd(26) + ' ' + r2.sdOrder.map(r0).join('/') + ' | ' + r2.sdWin.map(r0).join('/'));
  if (c.max != null) {
    check('T1', c.label + ' Einzelrahmen max. Fehler < ' + c.max + ' Hz', e1 < c.max, r0(e1) + ' Hz');
    check('T1', c.label + ' Fenstersweep max. Fehler < ' + c.max + ' Hz', e2 < c.max, r0(e2) + ' Hz');
    check('T1', c.label + ' F0 ' + c.f0 + ' Hz auf 1 %', near(r2.f0, c.f0, 0.01 * c.f0), r1(r2.f0));
    check('T1', c.label + ' alle fünf Formanten gültig (Sweep)', r2.valid.every(Boolean), r2.valid.map(v => v ? 1 : 0).join(''));
  }
}
console.log('');

/* ---------- T2: ΔF3–4 trennt eng von weit ---------- */
{
  const e = measured.eng.sweep, w = measured.weit.sweep, es = measured.eng.single, ws = measured.weit.single;
  check('T2', 'eng: dF3-4 innerhalb 120 Hz von 350 (Sweep)', near(e.d34, 350, 120), r0(e.d34));
  check('T2', 'weit: dF3-4 innerhalb 120 Hz von 1050 (Sweep)', near(w.d34, 1050, 120), r0(w.d34));
  check('T2', 'eng: dF3-4 innerhalb 120 Hz von 350 (Einzelrahmen)', near(es.F[3] - es.F[2], 350, 120), r0(es.F[3] - es.F[2]));
  check('T2', 'weit: dF3-4 innerhalb 120 Hz von 1050 (Einzelrahmen)', near(ws.F[3] - ws.F[2], 1050, 120), r0(ws.F[3] - ws.F[2]));
  check('T2', 'eng: F3 und F4 gelten als stabil (Slot-Zuordnung nach Naehe)', e.valid[2] && e.valid[3], 'sdOrder ' + r0(e.sdOrder[2]) + '/' + r0(e.sdOrder[3]));
  check('T2', 'eng: Ordnungsstreuung F3/F4 < 130 Hz (v2: 141/181)', e.sdOrder[2] < 130 && e.sdOrder[3] < 130, r0(e.sdOrder[2]) + '/' + r0(e.sdOrder[3]));
}

/* ---------- T3: Durchsatz ---------- */
{
  const sig = D.synthVowel(196, CASES[0].F, BW5, 1.0, SR), ds = D.resample(sig, SR, TSR);
  let n = 0; const t0 = Date.now(); let idx = Math.round(0.08 * TSR);
  while (Date.now() - t0 < 1500) { D.analyseAt(ds, TSR, idx, {}); n++; idx += 120; if (idx > ds.length - 1000) idx = Math.round(0.08 * TSR); }
  const fps = n / ((Date.now() - t0) / 1000);
  check('T3', 'Durchsatz analyseAt (voller Sweep) > 100 Rahmen/s', fps > 100, fps.toFixed(0) + ' Rahmen/s');
}

/* ---------- T4: FFT ---------- */
{
  const N = 64, re = noise(N, 1, 7), im = noise(N, 1, 9), re2 = Float64Array.from(re), im2 = Float64Array.from(im);
  D.fft(re2, im2);
  let maxErr = 0, ein = 0, eout = 0;
  for (let k = 0; k < N; k++) {
    let sr_ = 0, si = 0;
    for (let n = 0; n < N; n++) { const a = -2 * Math.PI * k * n / N; sr_ += re[n] * Math.cos(a) - im[n] * Math.sin(a); si += re[n] * Math.sin(a) + im[n] * Math.cos(a); }
    maxErr = Math.max(maxErr, Math.abs(sr_ - re2[k]), Math.abs(si - im2[k]));
    ein += re[k] * re[k] + im[k] * im[k]; eout += (re2[k] * re2[k] + im2[k] * im2[k]) / N;
  }
  check('T4', 'FFT gegen direkte DFT (N=64), max. Fehler < 1e-9', maxErr < 1e-9, maxErr.toExponential(2));
  check('T4', 'Parseval', near(ein, eout, 1e-9 * ein), '');
  const M = 256, r3 = new Float64Array(M), i3 = new Float64Array(M);
  for (let n = 0; n < M; n++) r3[n] = Math.cos(2 * Math.PI * 7 * n / M);
  D.fft(r3, i3);
  let best = 0; for (let k = 1; k < M / 2; k++) if (Math.hypot(r3[k], i3[k]) > Math.hypot(r3[best], i3[best])) best = k;
  check('T4', 'Ton auf Bin 7 landet auf Bin 7', best === 7, 'Bin ' + best);
  let thrown = false; try { D.fft(new Float64Array(100), new Float64Array(100)); } catch (e) { thrown = true; }
  check('T4', 'FFT lehnt Nicht-Zweierpotenz ab', thrown, '');
}

/* ---------- T5: Abtastratenwandlung je Eingangsrate ---------- */
for (const srIn of [44100, 48000, 96000]) {
  const dur = 0.5, amp = 0.5, ref = 20 * Math.log10(amp / Math.SQRT2);   // Effektivwert eines Sinus
  function lvl(f) { const ds = D.resample(tone(f, srIn, dur, amp), srIn, TSR); return D.rmsDb(ds.subarray(1000, ds.length - 1000)); }
  check('T5', srIn + ' Hz: 1 kHz Ton innerhalb 0,2 dB', near(lvl(1000), ref, 0.2), r2(lvl(1000) - ref) + ' dB');
  check('T5', srIn + ' Hz: 4,3 kHz Ton innerhalb 0,5 dB', near(lvl(4300), ref, 0.5), r2(lvl(4300) - ref) + ' dB');
  check('T5', srIn + ' Hz: 8 kHz Ton nach Wandlung um > 40 dB gedaempft (Alias bei 4 kHz)', lvl(8000) < ref - 40, r1(lvl(8000) - ref) + ' dB');
  const sp = D.spectrum(D.resample(tone(1000, srIn, dur, amp), srIn, TSR).subarray(1000, 1000 + Math.round(0.14 * TSR)), TSR);
  check('T5', srIn + ' Hz: Linienpegel 1 kHz im Spektrum innerhalb 0,2 dB (interpolierter Gipfel)', near(D.lineLevelDb(sp, 1000), 20 * Math.log10(amp), 0.2), r2(D.lineLevelDb(sp, 1000) - 20 * Math.log10(amp)) + ' dB');
}
{
  // Bruchverhältnis 44,1 kHz → 12 kHz: F5 muss erhalten bleiben (lineare Interpolation verlor es)
  const F = CASES[0].F, s48 = D.synthVowel(196, F, BW5, 1.0, SR, { gain: 0.3 }), s44 = D.resample(s48, SR, 44100);
  const rA = D.analyseAt(D.resample(s48, SR, TSR), TSR, 6000, {}), rB = D.analyseAt(D.resample(s44, 44100, TSR), TSR, 5500, {});
  check('T5', '44,1 kHz Weg: F5 gefunden und gueltig wie im 48-kHz-Weg', rB.valid[4] && near(rB.F[4], rA.F[4], 60), 'F5 ' + r0(rB.F[4]) + ' vs ' + r0(rA.F[4]) + ', gueltig ' + rB.valid.map(v => v ? 1 : 0).join(''));
  check('T5', '44,1 kHz Weg: F1..F4 innerhalb 40 Hz des 48-kHz-Wegs', [0, 1, 2, 3].every(k => near(rB.F[k], rA.F[k], 40)), rB.F.map(r0).join(' ') + ' vs ' + rA.F.map(r0).join(' '));
  // Interpolationsfehler: 5-kHz-Ton ueber 44,1 kHz gewandelt, Rest ausserhalb der Linie < -60 dB
  const sp5 = D.spectrum(D.resample(tone(4800, 44100, 0.5, 0.5), 44100, TSR).subarray(1000, 1000 + Math.round(0.14 * TSR)), TSR);
  let spur = -Infinity; for (let k = 20; k < sp5.db.length - 1; k++) { const f = k * sp5.df; if (Math.abs(f - 4800) > 150) spur = Math.max(spur, sp5.db[k]); }
  check('T5', '44,1 kHz Weg: Stoeranteile eines 4,8-kHz-Tons > 60 dB unter der Linie', spur < D.lineLevelDb(sp5, 4800) - 60, r1(spur - D.lineLevelDb(sp5, 4800)) + ' dB');
  const bank = D.lowpassBank(SR, TSR), lp = D.lowpassFor(SR, TSR); let e0 = 0; for (let i = 0; i < lp.length; i++) e0 = Math.max(e0, Math.abs(bank.bank[i] - lp[i]));
  check('T5', 'Polyphase Phase 0 = FIR-Tiefpass (bitidentisch bei 48 kHz)', e0 < 1e-15, e0.toExponential(1));
  const x = tone(1000, TSR, 0.1, 0.5), y = D.resample(x, TSR, TSR);
  let e = 0; for (let i = 0; i < x.length; i++) e = Math.max(e, Math.abs(x[i] - y[i]));
  check('T5', 'resample bei gleicher Rate ist Identitaet', e === 0, '');
}

/* ---------- T6: YIN ---------- */
{
  for (const f of [61.741, 98.003, 219.993]) {
    const p = D.detectF0(tone(f, TSR, 0.10, 0.5), TSR, 60, 500, 0.15);
    check('T6', 'Sinus ' + f + ' Hz auf 0,05 Hz', near(p.f0, f, 0.05), p.f0.toFixed(3));
  }
  const p440 = D.detectF0(tone(440, TSR, 0.10, 0.5), TSR, 60, 500, 0.15);
  check('T6', 'Sinus 440 Hz auf 0,5 Hz (v2: 441,69)', near(p440.f0, 440, 0.5), p440.f0.toFixed(2));
  // Teilerfehler (Periode = Vielfaches des Grundtons) entscheidet nicht die Differenzfunktion,
  // sondern die Teiltonreihe im Spektrum — geprüft wird deshalb der Rahmen, nicht detectF0 allein.
  const v98 = D.resample(D.synthVowel(98, [490, 1500, 2500, 3300, 4200], [30, 90, 120, 150, 200], 0.5, SR), SR, TSR);
  const r98 = D.analyseAt(v98, TSR, 3000, {});
  check('T6', 'Vokal 98 Hz mit engem F1 = 5·F0: Rahmen auf 1,5 Hz (roh: 493)', near(r98.f0, 98, 1.5), r98.f0.toFixed(2) + ' (Teiler ' + r98.subFactor + ', roh ' + D.detectF0(v98.subarray(2400, 2400 + 1200), TSR, 60, 500, 0.15).f0.toFixed(1) + ')');
  const v175 = D.resample(D.synthVowel(175, [350, 1400, 2500, 3300, 4200], [50, 90, 120, 150, 200], 0.5, SR), SR, TSR);
  const r175 = D.analyseAt(v175, TSR, 3000, {});
  check('T6', 'Vokal 175 Hz mit F1 = 2·F0: Rahmen auf 1,5 Hz (Oktavkontrolle der Spezifikation)', near(r175.f0, 175, 1.5), r175.f0.toFixed(2) + ' (Teiler ' + r175.subFactor + ')');
  // Der entscheidende Nachweis: kein Teilerfehler bei sauberen Vokalen über den ganzen Umfang.
  const VOW = [['a', [700, 1200, 2500, 3300, 4200], BW5], ['i', [300, 2200, 2900, 3500, 4300], [60, 100, 130, 160, 200]],
  ['u', [320, 800, 2400, 3300, 4200], [60, 90, 120, 150, 200]], ['o', [450, 800, 2500, 3300, 4200], [70, 90, 120, 150, 200]],
  ['e', [400, 1900, 2600, 3400, 4300], [60, 100, 130, 160, 200]], ['eng', [500, 1500, 2450, 2800, 3150], [70, 90, 90, 90, 100]]];
  let octBad = [], octN = 0;
  for (const [nm, F, B] of VOW) for (let f0 = 90; f0 <= 450; f0 += 10) {
    const r = D.analyseAt(D.resample(D.synthVowel(f0, F, B, 0.35, SR), SR, TSR), TSR, 2100, {});
    if (!r.voiced) continue;
    octN++;
    if (Math.abs(r.f0 - f0) / f0 > 0.03) octBad.push('/' + nm + '/ ' + f0 + '→' + r.f0.toFixed(0));
  }
  check('T6', 'kein Grundtonfehler ueber 6 Vokale x 37 Tonhoehen (90-450 Hz)', octBad.length === 0, octBad.length + '/' + octN + (octBad.length ? ': ' + octBad.slice(0, 6).join(' ') : ''));
  check('T6', 'fminEff wird gemeldet (0,10 s @ 12 kHz → 60 Hz)', near(p440.fminEff, 60, 0.01), r1(p440.fminEff));
}

/* ---------- T7: Oktavkontrolle ---------- */
{
  function spec(sig) { const ds = D.resample(sig, SR, TSR); return D.spectrum(ds.subarray(2400, 2400 + Math.round(0.14 * TSR)), TSR); }
  const clean = spec(D.synthVowel(196, CASES[0].F, BW5, 0.5, SR));
  const alt5 = spec(D.synthVowel(196, CASES[0].F, BW5, 0.5, SR, { altRatio: 0.5 }));
  const alt9 = spec(D.synthVowel(196, CASES[0].F, BW5, 0.5, SR, { altRatio: 0.9 }));
  const iG3 = spec(D.synthVowel(196, CASES[1].F, CASES[1].B, 0.5, SR));
  const f4 = spec(D.synthVowel(349, CASES[5].F, CASES[5].B, 0.5, SR));
  check('T7', 'Alternation 0,5 bei 196 Hz: Reihe bei f/2 erkannt', D.octaveCheck(alt5, 196), '');
  check('T7', 'sauberer /a/ 196 Hz: keine Reihe bei f/2', !D.octaveCheck(clean, 196), '');
  check('T7', 'sauberer /i/ 196 Hz: keine Reihe bei f/2', !D.octaveCheck(iG3, 196), '');
  check('T7', 'f4 modal (F1 auf H2, 349 Hz): keine Reihe bei f/2', !D.octaveCheck(f4, 349), '');
  console.log('    Bericht: Alternation 0,9 (Subharmonik ~ -25 dB) → Oktavkontrolle ' + (D.octaveCheck(alt9, 196) ? 'halbiert (Spec-Regel: Reihe > Rauschen + 8 dB)' : 'halbiert nicht'));
}

/* ---------- T8: SHR ---------- */
{
  function frame(sig) { const ds = D.resample(sig, SR, TSR); return D.analyseAt(ds, TSR, Math.round(0.25 * TSR), {}); }
  const clean = frame(D.synthVowel(196, CASES[0].F, BW5, 0.5, SR));
  const a9 = frame(D.synthVowel(196, CASES[0].F, BW5, 0.5, SR, { altRatio: 0.9 }));
  const a7 = frame(D.synthVowel(196, CASES[0].F, BW5, 0.5, SR, { altRatio: 0.7 }));
  check('T8', 'sauber: SHR < -30 dB', clean.shr < -30, r1(clean.shr));
  check('T8', 'Alternation 0,9: SHR -25,6 ± 3 dB, Raster 2·F0', near(a9.shr, -25.6, 3) && near(a9.shrGrid, 196, 4), r1(a9.shr) + ' dB, F0 ' + r1(a9.f0) + ', Raster ' + r0(a9.shrGrid));
  check('T8', 'Alternation 0,7: SHR -15,1 ± 3 dB, Raster 2·F0', near(a7.shr, -15.1, 3) && near(a7.shrGrid, 196, 4), r1(a7.shr) + ' dB, F0 ' + r1(a7.f0) + ', Raster ' + r0(a7.shrGrid));
}

/* ---------- T9: SFR ---------- */
{
  const n = Math.round(0.14 * TSR), x = new Float64Array(n); let num = 0, den = 0;
  for (let k = 1; k * 150 < 5500; k++) {
    const f = k * 150, a = 0.3 / k;
    for (let i = 0; i < n; i++) x[i] += a * Math.sin(2 * Math.PI * f * i / TSR + k);
    if (f >= 2400 && f < 3200) num += a * a; if (f < 2000) den += a * a;
  }
  const analytic = 10 * Math.log10(num / den), sp = D.spectrum(x, TSR), got = D.sfr(sp);
  check('T9', 'SFR gegen analytischen Wert innerhalb 1,5 dB', near(got, analytic, 1.5), r2(got) + ' vs ' + r2(analytic));
}

/* ---------- T10: CPP ---------- */
{
  const v = D.resample(D.synthVowel(196, CASES[0].F, BW5, 0.5, SR), SR, TSR), seg = v.subarray(2400, 2400 + Math.round(0.14 * TSR));
  const cv = D.cpp(D.spectrum(seg, TSR)).cpp;
  const cn = D.cpp(D.spectrum(noise(seg.length, 0.3, 5), TSR)).cpp;
  check('T10', 'CPP Vokal minus CPP Rauschen > 10 dB', cv - cn > 10, r1(cv) + ' vs ' + r1(cn));
  const seq = [0, -30, -20, -10].map(db => { const y = Float64Array.from(seg); if (db) { const nz = noise(y.length, 0.3 * dbToLin(db), 3); for (let i = 0; i < y.length; i++) y[i] += nz[i]; } return D.cpp(D.spectrum(y, TSR)).cpp; });
  check('T10', 'CPP faellt monoton mit zunehmendem Rauschen', seq[0] > seq[1] && seq[1] > seq[2] && seq[2] > seq[3], seq.map(r1).join(' > '));
  check('T10', 'Cepstrum-F0 stimmt mit 196 Hz auf 5 %', near(D.cpp(D.spectrum(seg, TSR)).f0, 196, 10), r1(D.cpp(D.spectrum(seg, TSR)).f0));
}

/* ---------- T11: VAD ---------- */
{
  const vowel = D.resample(D.synthVowel(196, CASES[0].F, BW5, 0.5, SR), SR, TSR);
  const mid = Math.round(0.25 * TSR), floorDb = -60;
  const lvl = D.rmsDb(vowel.subarray(mid - 600, mid + 600));
  const at = (sig, db) => D.analyseAt(scale(sig, dbToLin(db - lvl)), TSR, mid, { floorDb });
  check('T11', 'Stille -80 dBFS: unvoiced', !D.analyseAt(noise(vowel.length, 1e-4, 1), TSR, mid, { floorDb }).voiced, '');
  const nz = D.analyseAt(noise(vowel.length, 0.02, 2), TSR, mid, { floorDb });
  check('T11', 'Rauschen -40 dBFS: unvoiced (Aperiodizitaet)', !nz.voiced, 'ap ' + r2(nz.ap));
  check('T11', 'Vokal -20 dBFS ueber Boden -60: voiced', at(vowel, -20).voiced, '');
  check('T11', 'Vokal bei Boden + 6 dB: unvoiced', !at(vowel, -54).voiced, '');
  check('T11', 'Vokal bei Boden + 14 dB: voiced', at(vowel, -46).voiced, '');
}

/* ---------- T13: Vokalklassen ---------- */
{
  let ok = true; for (const c of V.CENTROIDS) { const r = V.classify(c.F1, c.F2); if (r.cls !== c.cls || r.d > 1e-9) ok = false; }
  check('T13', 'Zentroide bilden auf sich selbst ab', ok, '');
  const cases = [[700, 1200, 'a'], [300, 2200, 'i'], [320, 800, 'u'], [500, 1450, 'ɐ']];
  for (const [f1, f2, cls] of cases) check('T13', '(' + f1 + ', ' + f2 + ') → /' + cls + '/', V.classify(f1, f2).cls === cls, V.classify(f1, f2).cls);
  check('T13', 'NaN → keine Klasse', V.classify(NaN, 1000).cls === null, '');
}

/* ---------- T12b/c: Gatter mit synthetischen Rahmen ---------- */
{
  const g = V.createGate({});
  let st = null, s = 99;
  function rnd() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }
  for (let i = 0; i < 100; i++) st = g.update({ t: i * 0.01, voiced: true, F1: 700 + (rnd() - 0.5) * 10, F2: 1200 + (rnd() - 0.5) * 20, F3: 2500, valid1: rnd() > 0.15, valid2: true, d34: 800, d34valid: true });
  check('T12', 'Live-Gatter: 15 % ungueltige F1-Rahmen bleiben stabil /a/ mit Score', st.state === 'stabil' && st.cls === 'a' && st.score === 800, st.state + ' ' + st.cls + ' ' + st.reason);
  const g2 = V.createGate({}); let firstI = null, lastA = null, hadUeb = false;
  for (let i = 0; i < 200; i++) {
    const isI = i >= 100, r = g2.update({ t: i * 0.01, voiced: true, F1: isI ? 300 : 700, F2: isI ? 2200 : 1200, F3: 2900, valid1: true, valid2: true, d34: 600, d34valid: true });
    if (r.state === 'stabil' && r.cls === 'a') lastA = i * 0.01;
    if (i >= 100 && r.state === 'uebergang') hadUeb = true;
    if (r.state === 'stabil' && r.cls === 'i' && firstI === null) firstI = i * 0.01;
  }
  check('T12', 'Live-Gatter: harter Wechsel a→i ergibt Uebergang, dann stabil /i/ binnen windowS+holdS', hadUeb && firstI !== null && firstI <= 1.0 + V.DEFAULTS.windowS + V.DEFAULTS.holdS + 0.02, 'stabil /i/ ab ' + firstI + ' s, letztes /a/ ' + lastA);
  const g3 = V.createGate({}); let r3 = null;
  for (let i = 0; i < 60; i++) r3 = g3.update({ t: i * 0.01, voiced: true, F1: 500, F2: 1450, F3: 2100, valid1: true, valid2: true, d34: 500, d34valid: true });
  check('T12', 'Live-Gatter: F3 unter 2500 Hz → stabil, aber kein Score', r3.state === 'stabil' && !isFinite(r3.score) && /F3 zu tief/.test(r3.reason), r3.reason);
  const g4 = V.createGate({}); let r4 = null;
  for (let i = 0; i < 60; i++) r4 = g4.update({ t: i * 0.01, voiced: false, F1: NaN, F2: NaN, F3: NaN, valid1: false, valid2: false, d34: NaN, d34valid: false });
  check('T12', 'Live-Gatter: Stille → Pause', r4.state === 'pause', '');
}

/* ---------- T16: WAV ---------- */
{
  const x = tone(440, SR, 0.05, 0.9); x[0] = -1; x[1] = 1;
  const b16 = W.encode(x, SR, 'i16'), d16 = W.decode(b16); let e16 = 0; for (let i = 0; i < x.length; i++) e16 = Math.max(e16, Math.abs(d16.samples[i] - x[i]));
  check('T16', 'WAV 16 Bit Hin- und Rueckweg, Fehler < 1/32768', e16 < 1 / 32768 + 1e-9 && d16.sampleRate === SR && d16.channels === 1, e16.toExponential(2));
  const b32 = W.encode(x, SR, 'f32'), d32 = W.decode(b32); let e32 = 0; for (let i = 0; i < x.length; i++) e32 = Math.max(e32, Math.abs(d32.samples[i] - x[i]));
  check('T16', 'WAV Float32 exakt (auf Float32-Genauigkeit)', e32 < 1e-6 && d32.format === 'f32', e32.toExponential(2));
  const v = new DataView(b16);
  check('T16', 'WAV-Kopf: PCM=1, 1 Kanal, Rate, 16 Bit, data-Laenge', v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint32(24, true) === SR && v.getUint16(34, true) === 16 && v.getUint32(40, true) === x.length * 2, '');
  // 24 Bit, Stereo, von Hand gebaut
  const n = 4, buf = new ArrayBuffer(44 + n * 6), dv = new DataView(buf); const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 6, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, 44100, true); dv.setUint32(28, 44100 * 6, true); dv.setUint16(32, 6, true); dv.setUint16(34, 24, true); str(36, 'data'); dv.setUint32(40, n * 6, true);
  const vals = [0.5, -0.5, 0.25, -1]; let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) { let q = Math.round(vals[i] * 8388608); if (q > 8388607) q = 8388607; if (q < 0) q += 16777216; dv.setUint8(o, q & 255); dv.setUint8(o + 1, (q >> 8) & 255); dv.setUint8(o + 2, (q >> 16) & 255); o += 3; }
  const d24 = W.decode(buf); let e24 = 0; for (let i = 0; i < n; i++) e24 = Math.max(e24, Math.abs(d24.samples[i] - vals[i]));
  check('T16', 'WAV 24 Bit Stereo dekodiert (Monomischung)', e24 < 2e-7 && d24.sampleRate === 44100 && d24.channels === 2, e24.toExponential(2));
}

/* ---------- T17: Huellkurve FFT gegen direkte Summe ---------- */
{
  const v = D.resample(D.synthVowel(196, CASES[0].F, BW5, 0.5, SR), SR, TSR);
  const a = D.burg(D.hann(D.preemph(v.subarray(2400, 3600), 0.97)), 14), nB = 1025, env = D.lpcEnvelope(a, TSR, nB), df = (TSR / 2) / (nB - 1);
  let maxErr = 0;
  for (let i = 0; i < nB; i += 7) {
    const w = 2 * Math.PI * (i * df) / TSR; let re = 0, im = 0;
    for (let k = 0; k < a.length; k++) { re += a[k] * Math.cos(-w * k); im += a[k] * Math.sin(-w * k); }
    maxErr = Math.max(maxErr, Math.abs(env[i] - (-20 * Math.log10(Math.hypot(re, im) + 1e-15))));
  }
  check('T17', 'LPC-Huellkurve per FFT = direkte Summe (< 1e-6 dB)', maxErr < 1e-6, maxErr.toExponential(2));
}

/* ---------- T18: kleine Einheiten ---------- */
{
  check('T18', 'Formantgewinn 50 Hz neben F bei B = 80: -4,1 dB', near(D.formantGain(550, 500, 80), -4.08, 0.05), r2(D.formantGain(550, 500, 80)));
  check('T18', 'Rohrlaenge 500/1500/2500/3500 → 17,5 cm', near(D.tubeLength([500, 1500, 2500, 3500]).cm, 17.5, 0.01), r1(D.tubeLength([500, 1500, 2500, 3500]).cm));
  check('T18', 'Rohrlaenge mit < 2 gueltigen Abstaenden → NaN', !isFinite(D.tubeLength([500, 1500, NaN, NaN]).cm), '');
  const track = []; for (let i = 0; i < 100; i++) track.push(-20 - (i > 30 ? (i - 30) * 0.01 * 200 : 0));   // 200 dB/s Abfall ab Index 30
  check('T18', 'Ausklang 200 dB/s', near(D.decayRate(track, 0.01, 30), 200, 1e-6), r1(D.decayRate(track, 0.01, 30)));
  check('T18', 'Alternation 4,3/3,5/4,6/3,6 < 0,5', D.alternation([4.3, 3.5, 4.6, 3.6, 4.4, 3.5]) < 0.5, r2(D.alternation([4.3, 3.5, 4.6, 3.6, 4.4, 3.5])));
  check('T18', 'Drift ohne Alternation >= 0,5', D.alternation([4.0, 4.1, 4.2, 4.3, 4.2, 4.1]) >= 0.5, r2(D.alternation([4.0, 4.1, 4.2, 4.3, 4.2, 4.1])));
  check('T18', 'Polpaar: 0 dB bei f = 0, Maximum nahe F', near(D.polePairGainDb(0, 500, 80), 0, 1e-9) && D.polePairGainDb(500, 500, 80) > D.polePairGainDb(700, 500, 80) + 6, r1(D.polePairGainDb(500, 500, 80)));
  check('T18', 'Notenname 440 → A4, 196 → G3, 123,5 → B2', D.hzToNote(440) === 'A4' && D.hzToNote(196) === 'G3' && D.hzToNote(123.5) === 'B2', '');
  check('T18', 'Quantil Typ 7: [1,2,3,4] q25 = 1,75', near(D.quantile([1, 2, 3, 4], 0.25), 1.75, 1e-12), '');
  check('T18', 'Median ignoriert NaN', D.median([3, NaN, 1, 2]) === 2, '');
}

/* ---------- T19: H1*−H2* ---------- */
{
  function fr(F1, B1) { const v = D.resample(D.synthVowel(300, [F1, 1500, 2500, 3300, 4200], [B1, 90, 120, 150, 200], 0.5, SR), SR, TSR); return D.analyseAt(v, TSR, Math.round(0.25 * TSR), {}); }
  const a = fr(300, 60), b = fr(850, 80);
  const rawDiff = Math.abs(a.h1h2 - b.h1h2), corDiff = Math.abs(a.h1h2c - b.h1h2c);
  check('T19', 'F1 auf F0 vs F1 fern: roh > 6 dB auseinander', rawDiff > 6, r1(a.h1h2) + ' vs ' + r1(b.h1h2));
  check('T19', 'H1*-H2* nach Korrektur innerhalb 3 dB gleich (gleiche Quelle)', corDiff < 3, r1(a.h1h2c) + ' vs ' + r1(b.h1h2c) + ' (F1 ' + r0(a.F[0]) + '/' + r0(b.F[0]) + ', B1 ' + r0(a.BW[0]) + '/' + r0(b.BW[0]) + ')');
  check('T19', 'h1h2unsure bei F1 ≈ F0 gesetzt, bei F1 fern nicht', a.h1h2unsure && !b.h1h2unsure, '');
}

/* ---------- T15: CSV und Sicherung ---------- */
{
  const take = { id: 't1', code: 'A', label: 'A 3.9. 12:00', createdAt: '2026-09-03T12:00:00Z', durationS: 3.5, sampleRate: 48000, deviceLabel: 'Mikro; "USB"', calibrationId: null, vowelIntent: 'a', comment: 'Zeile 1\nZeile 2, mit "Zitat"; Ende', analysis: { kernelVersion: D.VERSION }, summary: { f0: { med: 196.123, q1: NaN, q3: 200, note: 'G3' }, F: [{ med: 700.04, q1: 690, q3: 710, n: 12 }], vowel: { dominant: 'a', dominantShare: 0.5 } } };
  const csv = C.takesToCsv([take], 'standard'), rows = csv.split('\r\n');
  function parseRow(line, sep) { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }
  const header = parseRow(rows[0], ','), body = rows.slice(1, -1).join('\r\n'), cells = parseRow(body, ',');
  const idx = k => header.indexOf(k);
  check('T15', 'CSV: Kopf und Zeile gleich lang', header.length === cells.length && header.length === C.TAKE_COLUMNS.length, header.length + '/' + cells.length);
  check('T15', 'CSV: Kommentar mit Zeilenumbruch, Komma, Anfuehrungszeichen kommt unversehrt zurueck', cells[idx('comment')] === take.comment, JSON.stringify(cells[idx('comment')]));
  check('T15', 'CSV: NaN → -99.00, null-Text → leer, Zahlen mit festen Nachkommastellen', cells[idx('f0_q1_hz')] === '-99.0' && cells[idx('calibration_id')] === '' && cells[idx('f0_med_hz')] === '196.1' && cells[idx('f1_n')] === '12', cells[idx('f0_q1_hz')] + '|' + cells[idx('calibration_id')] + '|' + cells[idx('f0_med_hz')]);
  const de = C.takesToCsv([take], 'excelde'), deRows = de.split('\r\n');
  check('T15', 'CSV Excel-DE: BOM, Semikolon, Dezimalkomma', de.charCodeAt(0) === 0xFEFF && deRows[0].indexOf(';') > 0 && parseRow(deRows.slice(1, -1).join('\r\n'), ';')[idx('f0_med_hz')] === '196,1', '');
  const series = A.makeSeries(5); series.f1[0] = 700.1234; series.f1[1] = NaN; series.gate[2] = 2; series.cls[3] = -1; series.flags[4] = 65; series.t[4] = 0.04;
  series.f2[0] = -0; series.f2[1] = Infinity; series.f2[2] = -Infinity; series.d34[3] = 1e-7; series.h1h2[4] = -12.3456789; series.nWin[4] = 0x7fff;
  const text = C.serializeBackup({ takes: [take], series: { t1: series }, refs: { a: { d34: 640 } }, calibrations: [{ id: 'c1' }], settings: { x: 1 }, kernelVersion: D.VERSION });
  const back = C.parseBackup(text);
  const s2 = back.series.t1;
  check('T15', 'Sicherung: Takes, Refs, Kalibrierungen, Einstellungen kommen zurueck', back.takes[0].id === 't1' && back.refs.a.d34 === 640 && back.calibrations[0].id === 'c1' && back.settings.x === 1, '');
  /* Seit Version 3 stehen Serien als Bytes in der Sicherung. Der frühere Prüfname „Werte auf 1e-3“ beschrieb
     Version 2 und ließ eine Rundung auf 0,001 durchgehen; geprüft wird jetzt jedes Feld mit Typ und Bytes. */
  const serFelder = Object.keys(series).filter(k => ArrayBuffer.isView(series[k])), bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  const serAnders = serFelder.filter(k => !(s2[k] && s2[k].constructor === series[k].constructor && bytes(s2[k]).equals(bytes(series[k]))));
  check('T15', 'Sicherung: jedes Serienfeld kommt mit seinem Typ bitgleich zurück (Float32 ungerundet, NaN, ±Infinity, −0)',
    serFelder.length >= 40 && !serAnders.length && s2.f1[0] === Math.fround(700.1234) && isNaN(s2.f1[1]) && Object.is(s2.f2[0], -0) && s2.f2[2] === -Infinity && s2.cls[3] === -1 && s2.flags[4] === 65,
    serFelder.length + ' Felder' + (serAnders.length ? ', abweichend: ' + serAnders.map(k => k + ' ' + Array.from(s2[k] || []).slice(0, 5).join('/')).join(', ') : '') + ' | f1[0] ' + s2.f1[0]);
  let bad = false; try { C.parseBackup('{"format":"x"}'); } catch (e) { bad = true; }
  check('T15', 'Sicherung: fremdes Format wird abgelehnt', bad, '');
  const fcsv = C.framesToCsv(series, 'standard', V).split('\r\n');
  check('T15', 'Rahmen-CSV: Kopf + 5 Zeilen, Gate als Wort', fcsv.length === 7 && parseRow(fcsv[3], ',')[2] === 'stabil' && parseRow(fcsv[1], ',')[0] === '0.000', fcsv[3].slice(0, 40));
}

/* ---------- T21: Slot-Zuordnung (Befunde des Review-Durchlaufs) ---------- */
{
  // Verschmolzenes F3/F4-Paar: beide Sweeps sehen denselben Buckel und sind sich einig — der Wert
  // ist trotzdem falsch (F5 rutscht in den F4-Slot). Wiederholbarkeit ist nicht Richtigkeit.
  const sig = D.synthVowel(196, [700, 1200, 2500, 2650, 4200], [80, 90, 140, 120, 200], 0.5, SR);
  const r = D.analyseAt(D.resample(sig, SR, TSR), TSR, 3000, {});
  check('T21', 'verschmolzenes F3/F4: weniger als 5 Resonanzen gefunden', r.nPeaksRef < 5, r.nPeaksRef + ' Gipfel');
  check('T21', 'verschmolzenes F3/F4: dF3-4 wird NICHT als gueltig gemeldet (roh 1614 statt 150)', !r.d34valid, 'd34 ' + r0(r.d34) + ', valid ' + r.valid.map(v => v ? 1 : 0).join(''));
  check('T21', 'verschmolzenes F3/F4: F1 und F2 bleiben gueltig', r.valid[0] && r.valid[1], r.F.slice(0, 2).map(r0).join(' '));
  // Hoher Grundton, kein Teilton nahe F2: F2 fehlt, alles darueber rutscht einen Slot herunter.
  const o310 = D.analyseAt(D.resample(D.synthVowel(310, [450, 800, 2500, 3300, 4200], [70, 90, 120, 150, 200], 0.5, SR), SR, TSR), TSR, 3000, {});
  check('T21', 'fehlendes F2 bei F0 310 Hz: dF3-4 nicht gueltig', !o310.d34valid, 'F ' + o310.F.map(r0).join(' ') + ' valid ' + o310.valid.map(v => v ? 1 : 0).join(''));
  check('T21', 'fehlendes F2 bei F0 310 Hz: Hinweis auf duenne Teiltonreihe', o310.sparseHarmonics && near(o310.harmonicPullHz, 155, 10), r1(o310.harmonicPullHz) + ' Hz');
  // Gegenprobe: bei vollstaendigen fuenf Resonanzen darf die Regel nichts wegnehmen.
  const ok = D.analyseAt(D.resample(D.synthVowel(196, CASES[0].F, BW5, 0.5, SR), SR, TSR), TSR, 3000, {});
  check('T21', 'Gegenprobe /a/ G3: fuenf Gipfel, alle Slots gueltig', ok.nPeaksRef >= 5 && ok.valid.every(Boolean) && ok.slotUnsure.every(v => !v), ok.nPeaksRef + ' Gipfel');
  check('T21', 'slotGapUnsure: vollstaendig → nichts unsicher; Luecke → ab Luecke unsicher',
    D.slotGapUnsure([700, 1200, 2500, 3300, 4200], 5).every(v => !v) &&
    D.slotGapUnsure([732, 1176, 2544, 4158, NaN], 4).join() === 'false,false,false,true,true', '');
}

/* ---------- T22: Teilerkontrolle und SHR-Regime ---------- */
{
  function fr(f0, F, B, o) { return D.analyseAt(D.resample(D.synthVowel(f0, F, B, 0.5, SR, o || {}), SR, TSR), TSR, 3000, {}); }
  // Der Fall, der die Spezifikation zur Oktavkontrolle motiviert: F1 auf H2 an der Registergrenze.
  const f4 = fr(349, [700, 1300, 2500, 3300, 4200], [90, 100, 130, 160, 200]);
  check('T22', 'f4 modal (F1 auf H2): kein Teilerfehler', near(f4.f0, 349, 4) && f4.subFactor === 1, r1(f4.f0) + ' Teiler ' + f4.subFactor);
  check('T22', 'f4 modal: SHR unter -25 dB, Raster = F0 (frueher faelschlich -10,5 dB bei Raster 2F0)', f4.shr < -25 && near(f4.shrGrid, f4.f0, 1), r1(f4.shr) + ' dB, Raster ' + r0(f4.shrGrid));
  check('T22', 'f4 modal: keine Oktav-Unsicherheit gemeldet', !f4.octaveAmbiguous && !f4.octaveCorrected, '');
  // Schwache Alternation darf die Note nicht wechseln (Spezifikation: unter -25 dB unauffaellig).
  const a97 = fr(150, CASES[0].F, BW5, { altRatio: 0.97 }), a90 = fr(150, CASES[0].F, BW5, { altRatio: 0.9 });
  check('T22', 'Alternation 0,97 (SHR ca. -37 dB): Grundton bleibt 150 Hz', near(a97.f0, 150, 2) && !a97.octaveCorrected, r1(a97.f0) + ' SHR ' + r1(a97.shr));
  check('T22', 'Alternation 0,9 (SHR ca. -26 dB): Grundton bleibt 150 Hz', near(a90.f0, 150, 2) && !a90.octaveCorrected, r1(a90.f0) + ' SHR ' + r1(a90.shr));
  check('T22', 'Alternation 0,9: SHR in der Groessenordnung -26 dB', near(a90.shr, -26, 6), r1(a90.shr));
  // Starke Alternation muss sich im SHR zeigen (Warnschwelle -15 dB der Spezifikation).
  const a70 = fr(150, CASES[0].F, BW5, { altRatio: 0.7 });
  check('T22', 'Alternation 0,7: SHR ueber -17 dB (Warnbereich)', a70.shr > -17, r1(a70.shr) + ' dB, Raster ' + r0(a70.shrGrid));
  // Sauberes Signal: kein Dauerhinweis
  const clean = fr(196, CASES[0].F, BW5);
  check('T22', 'sauberer Vokal: SHR unter -40 dB, keine Oktav-Unsicherheit', clean.shr < -40 && !clean.octaveAmbiguous, r1(clean.shr));
  check('T22', 'subMultipleTest m=2 entspricht der Oktavkontrolle der Spezifikation (vier Linien 1,3,5,7)',
    (() => { const sp = D.spectrum(D.resample(D.synthVowel(175, [350, 1400, 2500, 3300, 4200], [50, 90, 120, 150, 200], 0.5, SR), SR, TSR).subarray(2400, 2400 + 1680), TSR);
      const t = D.subMultipleTest(sp, 350.9, 2, 8, -20); return t.pass; })(), '');
}

/* ---------- T23: Prüfsignal-Generator ---------- */
{
  // Werden die Impulse auf ganze Abtastwerte gerundet, ist das Pruefsignal selbst nicht periodisch:
  // der Rundungsfehler wiederholt sich alle zwei Perioden und erzeugt genau die Subharmonische,
  // die der Kern finden soll. Dann pruefen alle Tests gegen ein verunreinigtes Signal.
  const sig = D.synthVowel(349, CASES[0].F, BW5, 0.5, SR);
  const sp = D.spectrum(D.resample(sig, SR, TSR).subarray(2400, 2400 + 1680), TSR);
  const sub = D.shrAgainst(sp, 349);
  check('T23', 'Synthese ist periodisch: keine Subharmonische ueber -40 dB bei 349 Hz', sub < -40, r1(sub) + ' dB');
  const p = D.detectF0(D.resample(sig, SR, TSR).subarray(2400, 2400 + 1200), TSR, 60, 500, 0.15);
  check('T23', 'Synthese: Aperiodizitaet unter 0,02', p.ap < 0.02, p.ap.toFixed(4));
}

/* ---------- T24: Rauschboden, Teilmengen, Take-Codes, Referenzen (Review-Durchlauf 2) ---------- */
{
  const noiseFloorDb = 20 * Math.log10(3e-4 / Math.sqrt(3)) + 10 * Math.log10(0.46 * TSR / (SR / 2));
  check('T24', 'estimateFloor mit Stille: Boden innerhalb 3 dB des echten Werts',
    (() => { const t = concat([noise(2 * SR, 3e-4, 5), D.synthVowel(196, CASES[0].F, BW5, 1.5, SR, { gain: 0.3 }), noise(2 * SR, 3e-4, 9)]);
      const e = A.estimateFloor(D.resample(t, SR, TSR), TSR, 0.01); return e.known && near(e.db, noiseFloorDb, 3); })(), '');
  check('T24', 'estimateFloor ohne Stille: Boden gilt als unbekannt',
    (() => { const a = D.synthVowel(196, CASES[0].F, BW5, 2, SR, { gain: 0.3 }), nz = noise(a.length, 3e-4, 3);
      for (let i = 0; i < a.length; i++) a[i] += nz[i];
      return A.estimateFloor(D.resample(a, SR, TSR), TSR, 0.01).known === false; })(), '');
  check('T24', 'Take-Codes: nextCodeIndex setzt nach Import fort', A.nextCodeIndex([{ code: 'A' }, { code: 'M' }, { code: 'AB' }], 0) === 28 && A.nextCodeIndex([], 5) === 5 && A.indexFromCode('A') === 0 && A.indexFromCode('AA') === 26, String(A.nextCodeIndex([{ code: 'A' }, { code: 'M' }, { code: 'AB' }], 0)));
  // Früher: „wird verworfen“ — dann trat still das Minimum der übrigen Takes an die Stelle des Pins.
  check('T24', 'computeRefs: angepinnte Referenz ohne ihren Take bleibt sichtbar (verwaist, mit Grund), aber ohne Zielmarke',
    (() => { const r = A.computeRefs([], { a: { d34: 640, takeId: 'weg', code: 'C', pinned: true } }).a;
      return !!r && r.verwaist === true && r.pinned === true && !isFinite(r.d34) && r.d34Zuletzt === 640 && /gelöscht/.test(r.grund); })(), '');
  check('T24', 'computeRefs: angepinnte Referenz wird aus dem aktuellen Bestsegment aufgefrischt',
    (() => { const t = { id: 'T1', code: 'A', createdAt: '2026', summary: { perVowel: { a: { bestSegment: { d34Med: 640, startS: 1, lenS: 1 } } } } };
      const r = A.computeRefs([t], { a: { d34: 640, takeId: 'T1', code: 'A', pinned: true } });
      return r.a && r.a.d34 === 640 && r.a.pinned === true; })(), '');
}

/* ---------- T25: Pausen, Vibrato, Bandbreiten, Gatterfuellstand (Review-Durchlauf 2) ---------- */
{
  // Clean-Silence: ein Pausenrahmen darf keine Formantzahlen tragen (Spezifikation: Sentinel -99,00)
  const sil = noise(TSR, 3e-4, 5);
  const q = D.analyseAt(sil, TSR, TSR / 2, { floorDb: -80 });
  check('T25', 'Pausenrahmen traegt keine Formanten, keine Gueltigkeit, kein dF3-4',
    !q.voiced && q.F.every(v => !isFinite(v)) && q.valid.every(v => !v) && !isFinite(q.d34) && !q.d34valid, q.F.map(r0).join(' '));
  check('T25', 'Pausenrahmen: audible=false, tonalButAperiodic=false', !q.audible && !q.tonalButAperiodic, '');

  // Vibrato: normale Bariton-Vibratotiefe darf keinen lauten Ton zur "Pause" machen
  function vibrato(f0, dev, rate, dur) {
    const n = Math.round(dur * SR), src = new Float64Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const f = f0 * (1 + dev * Math.sin(2 * Math.PI * rate * i / SR));
      ph += f / SR;
      if (ph >= 1) { ph -= 1; for (let j = 0; j < 6 && i + j < n; j++) src[i + j] += Math.cos(Math.PI * j / 12); }
    }
    let y = src;
    const F = CASES[0].F;
    for (let m = 0; m < F.length; m++) y = D.resonate(y, F[m], BW5[m], SR);
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i]));
    for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / mx;
    return y;
  }
  for (const f0 of [98, 123, 196]) {
    const ds = D.resample(vibrato(f0, 0.04, 5.5, 1.0), SR, TSR);
    let un = 0, tot = 0;
    for (let c = 1200; c + 1200 < ds.length; c += 120) { const fr = D.analyseAt(ds, TSR, c, { floorDb: -70 }); tot++; if (!fr.voiced) un++; }
    check('T25', 'Vibrato +-4 % bei ' + f0 + ' Hz: hoechstens 15 % der Rahmen unvoiced (vorher bis 54 %)', un / tot <= 0.15, un + '/' + tot);
  }

  // Bandbreite: interpolierte -3-dB-Breite, Artefaktmarke unter 40 Hz
  // Reines Rasterproblem: ein einzelnes Polpaar mit bekanntem B durch lpcEnvelope. Ohne
  // Interpolation der -3-dB-Kreuzungen war die Breite um 0 bis 2 Bins (bis 11,7 Hz) zu gross,
  // und zwar immer nach oben.
  const bwErr = [];
  for (const B of [30, 40, 60, 80, 100, 150, 200]) {
    const r = Math.exp(-Math.PI * B / TSR), th = 2 * Math.PI * 700 / TSR;
    const a = new Float64Array([1, -2 * r * Math.cos(th), r * r]);
    const pk = D.peaksFromEnvelope(D.lpcEnvelope(a, TSR, 1025), TSR, 3, 1.5)[0];
    if (pk) bwErr.push(pk.bw - B);
  }
  check('T25', 'Bandbreite eines bekannten Polpaars: Fehler unter 4 Hz (vorher bis 11 Hz, immer zu gross)',
    bwErr.length === 7 && Math.max.apply(null, bwErr.map(Math.abs)) < 4, bwErr.map(v => (v >= 0 ? '+' : '') + v.toFixed(1)).join(' '));
  const f4bw = D.analyseAt(D.resample(D.synthVowel(349, CASES[5].F, CASES[5].B, 0.5, SR), SR, TSR), TSR, 3000, {});
  check('T25', 'Bandbreiten unter 40 Hz werden als Artefakt gekennzeichnet', f4bw.bwArtifact.some(Boolean) && f4bw.h1h2cArtifact, f4bw.BW.map(r0).join(' ') + ' → ' + f4bw.bwArtifact.map(v => v ? 1 : 0).join(''));

  // Gatter: Mindestfuellstand, Hysterese, Stimmhaftigkeit des bewerteten Rahmens
  const g = V.createGate({});
  let st1 = null;
  for (let i = 0; i < 25; i++) st1 = g.update({ t: i * 0.04, voiced: true, F1: 700, F2: 1200, F3: 2600, valid1: true, valid2: true, d34: 555, d34valid: true });
  const afterGap = g.update({ t: 25 * 0.04 + 1.0, voiced: true, F1: 640, F2: 1200, F3: 2600, valid1: true, valid2: true, d34: 555, d34valid: true });
  check('T25', 'Gatter: ein einzelner Rahmen nach einer Luecke wird NICHT stabil', afterGap.state !== 'stabil' && !isFinite(afterGap.score), afterGap.state + ' — ' + afterGap.reason);
  const g2 = V.createGate({});
  let r2 = null;
  // Nur der letzte Rahmen stimmlos (2,5 % und damit unter minVoicedShare) — das Fenster gilt
  // weiter als stabil, aber dieser eine Rahmen darf keine Wertung bekommen.
  for (let i = 0; i < 40; i++) r2 = g2.update({ t: i * 0.01, voiced: i < 39, F1: 700, F2: 1200, F3: 2600, valid1: true, valid2: true, d34: 555, d34valid: true });
  check('T25', 'Gatter: stimmloser Rahmen bekommt keinen Score', !isFinite(r2.score) && /nicht stimmhaft/.test(r2.reason), r2.state + ' — ' + r2.reason);
  // Hysterese nach abgebrochenem Wechsel
  const g3 = V.createGate({});
  function fr3(t, i) { return { t: t, voiced: true, F1: i ? 300 : 700, F2: i ? 2200 : 1200, F3: 2900, valid1: true, valid2: true, d34: 600, d34valid: true }; }
  let t = 0, firstHold = null;
  for (let k = 0; k < 60; k++, t += 0.01) g3.update(fr3(t, false));
  for (let k = 0; k < 8; k++, t += 0.01) g3.update(fr3(t, true));     // kurzer Ausflug nach /i/
  for (let k = 0; k < 60; k++, t += 0.01) g3.update(fr3(t, false));   // zurueck zu /a/
  let sawHold = false, firstI = null;
  for (let k = 0; k < 80; k++, t += 0.01) { const r = g3.update(fr3(t, true)); if (r.state === 'uebergang') sawHold = true; if (r.state === 'stabil' && r.cls === 'i' && firstI === null) firstI = k; }
  check('T25', 'Gatter: Haltezeit gilt auch nach einem abgebrochenen Wechsel', sawHold && firstI !== null && firstI > 10, 'Uebergang gesehen ' + sawHold + ', stabil /i/ ab Rahmen ' + firstI);
}

/* ---------- T26: zweite Tonhoehenspur und Sprungerkennung ---------- */
{
  const FJ = CASES[0].F, BJ = BW5;
  const ton = (f, sek) => D.synthVowel(f, FJ, BJ, sek, SR, { gain: 0.3 });
  const spruenge = sig => D.detectJumps(D.pitchTrackFine(D.resample(sig, SR, TSR), TSR, {}), {});
  const gleit = (von, nach, dauerS, gesamtS) => {
    const n = Math.round(gesamtS * SR), o = new Float64Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const u = Math.min(1, Math.max(0, (i / SR - 0.5) / dauerS));
      const f = von * Math.pow(nach / von, u);
      ph += f / SR;
      if (ph >= 1) { ph -= 1; for (let j = 0; j < 6 && i + j < n; j++) o[i + j] += Math.cos(Math.PI * j / 12); }
    }
    let y = o;
    for (let m = 0; m < FJ.length; m++) y = D.resonate(y, FJ[m], BJ[m], SR);
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i]));
    for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / mx;
    return y;
  };
  check('T26', 'sauberer Ton: kein Sprung gemeldet', spruenge(ton(196, 2)).length === 0, '');
  const kurz = spruenge(concat([ton(196, 1), ton(392, 0.05), ton(196, 1)]));
  check('T26', 'Kiekser 50 ms wird gefunden und als Kante gefuehrt (Hauptspur sieht ihn nicht)',
    kurz.length === 1 && kurz[0].art === 'kante' && near(kurz[0].halbtoene, 12, 1), kurz.map(e => e.art + ' ' + r0(e.dauerS * 1000) + ' ms').join(' '));
  check('T26', 'Gegenprobe: dieselben 50 ms sind in der Hauptspur unsichtbar',
    (() => { const ds = D.resample(concat([ton(196, 1), ton(392, 0.05), ton(196, 1)]), SR, TSR);
      let hoch = 0;
      for (let c = 1200; c + 1200 < ds.length; c += 120) { const fr = D.analyseAt(ds, TSR, c, { floorDb: -70 }); if (fr.voiced && fr.f0 > 300) hoch++; }
      return hoch === 0; })(), '');
  for (const ms of [300, 500]) {
    const geh = spruenge(concat([ton(196, 1), ton(392, ms / 1000), ton(196, 1)]));
    check('T26', 'gehaltener Wechsel ' + ms + ' ms: als gehalten gefuehrt, Dauer auf 30 ms genau',
      geh.length === 1 && geh[0].art === 'gehalten' && near(geh[0].dauerS * 1000, ms, 30), geh.map(e => e.art + ' ' + r0(e.dauerS * 1000) + ' ms').join(' '));
  }
  const vag = spruenge(concat([ton(165, 1), ton(415, 0.4), ton(165, 0.6)]));
  check('T26', 'aufsteigender Wechsel ueber 16 Halbtoene: Richtung und Weite stimmen',
    vag.length === 1 && vag[0].richtung === 'auf' && near(vag[0].halbtoene, 16, 1) && vag[0].art === 'gehalten', vag.map(e => e.richtung + ' ' + r1(e.halbtoene) + ' HT').join(' '));
  const stac = spruenge(concat([ton(196, 0.4), ton(330, 0.04), ton(196, 0.2), ton(330, 0.04), ton(196, 0.2), ton(330, 0.04), ton(196, 0.4)]));
  check('T26', 'drei Staccato-Kanten je 40 ms: drei Kanten, kein gehaltener Wechsel',
    stac.length === 3 && stac.every(e => e.art === 'kante'), stac.length + ' Ereignisse');
  check('T26', 'Portamento ueber eine Quinte in 0,5 s ist kein Sprung', spruenge(gleit(196, 294, 0.5, 1.5)).length === 0, '');
  check('T26', 'Vibrato +-4 % ist kein Sprung',
    (() => { const n = Math.round(2 * SR), o = new Float64Array(n); let ph = 0;
      for (let i = 0; i < n; i++) { const f = 196 * (1 + 0.04 * Math.sin(2 * Math.PI * 5.5 * i / SR)); ph += f / SR; if (ph >= 1) { ph -= 1; for (let j = 0; j < 6 && i + j < n; j++) o[i + j] += Math.cos(Math.PI * j / 12); } }
      let y = o; for (let m = 0; m < FJ.length; m++) y = D.resonate(y, FJ[m], BJ[m], SR);
      let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i]));
      for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / mx;
      return spruenge(y).length === 0; })(), '');
}

/* ---------- T20: Kalibrierung ---------- */
{
  const K = require('./calibration.js');
  const a = D.synthVowel(196, CASES[0].F, BW5, 3.0, SR, { gain: 0.3 });
  const tail = new Float64Array(Math.round(1.0 * SR)), ring = D.synthVowel(196, CASES[0].F, BW5, 0.3, SR, { gain: 0.3 });
  for (let i = 0; i < ring.length; i++) tail[i] = ring[i] * Math.pow(10, -300 * (i / SR) / 20);   // 300 dB/s
  const s5 = noise(5 * SR, 3e-4, 5), s1 = noise(SR, 3e-4, 6);
  for (let i = 0; i < s1.length; i++) tail[i] += s1[i];
  const c = K.analyseCalibration(concat([s5, a, tail]), SR, { deviceLabel: 'test' });
  const floorExp = 20 * Math.log10(3e-4 / Math.sqrt(3)) + 10 * Math.log10(0.46 * TSR / (SR / 2));   // weißes Rauschen, nach Tiefpass auf 0,46·12 kHz
  check('T20', 'Kalibrierung: Rauschboden der Stille = Rauschleistung im Analyseband ± 1,5 dB', near(c.floorDb, floorExp, 1.5), r1(c.floorDb) + ' vs ' + r1(floorExp));
  check('T20', 'Kalibrierung: SNR > 50 dB, Band-SNR gemessen', c.snrDb > 50 && isFinite(c.bandSnr.sf) && isFinite(c.bandSnr.low), r1(c.snrDb) + ' / sf ' + r1(c.bandSnr.sf));
  check('T20', 'Kalibrierung: Ausklang 300 ± 30 dB/s', near(c.decayDbPerS, 300, 30), r0(c.decayDbPerS) + ' dB/s, ' + c.decayMs + ' ms');
  check('T20', 'Kalibrierung: /a/-Fingerabdruck F1..F3 innerhalb 60 Hz', [0, 1, 2].every(k => near(c.F[k], CASES[0].F[k], 60)), c.F.map(r0).join(' '));
  const c2 = Object.assign({}, c, { floorDb: c.floorDb + 8, snrDb: c.snrDb - 8, deviceLabel: 'anderes' });
  check('T20', 'Vergleich: Boden +8, SNR -8, anderes Geraet → 3 Warnungen; gleich → keine', K.compare(c, c2).length === 3 && K.compare(c, c).length === 0, K.compare(c, c2).join(' | '));
}

/* ---------- T12a/T14: ganze Takes ---------- */
(async () => {
  function glide(f0, FA, FB, dur) { const n = Math.round(dur * SR), out = new Float64Array(n), seg = 0.05, m = Math.round(seg * SR); for (let s = 0; s < n; s += m) { const u = s / n, fm = FA.map((v, i) => v + (FB[i] - v) * u), y = D.synthVowel(f0, fm, BW5, seg, SR); out.set(y.subarray(0, Math.min(m, n - s)), s); } return out; }
  const sil = noise(Math.round(0.5 * SR), 1e-3, 11);
  const takeA = concat([sil, D.synthVowel(196, CASES[0].F, BW5, 2.0, SR), sil]);
  const rA = await A.analyseTake(takeA, SR, {});
  const sA = rA.summary;
  check('T14', 'Take /a/ 2 s: validShare > 0,9', sA.validShare > 0.9, r2(sA.validShare));
  check('T14', 'Take /a/: Rauschboden geschaetzt < -55 dBFS, SNR > 30 dB', sA.floorDb < -55 && sA.snrDb > 30, r1(sA.floorDb) + ' / ' + r1(sA.snrDb));
  check('T14', 'Take /a/: Mediane F1..F5 innerhalb 60 Hz', sA.F.every((f, i) => near(f.med, CASES[0].F[i], 60)), sA.F.map(f => r0(f.med)).join(' '));
  check('T14', 'Take /a/: dF3-4 stabil innerhalb 120 Hz von 800', near(sA.d34stable.med, 800, 120), r0(sA.d34stable.med) + ' n=' + sA.d34stable.n);
  check('T14', 'Take /a/: Bestsegment /a/ vorhanden, Laenge > 1,5 s', sA.perVowel.a && sA.perVowel.a.bestSegment && sA.perVowel.a.bestSegment.lenS > 1.5 && sA.best.cls === 'a', JSON.stringify(sA.best));
  check('T14', 'Take /a/: Rohrlaenge aus F1..F4 ≈ 20,2 cm', near(sA.tubeCm, 35000 / (2 * ((1200 - 700) + (2500 - 1200) + (3300 - 2500)) / 3), 1.0), r1(sA.tubeCm));
  check('T14', 'Take /a/: Vokalanteil dominant a', sA.vowel.dominant === 'a' && sA.vowel.dominantShare > 0.9, JSON.stringify(sA.vowel));
  check('T14', 'Take /a/: keine Oktavkorrekturen', sA.octaveCorrectedShare === 0, r2(sA.octaveCorrectedShare));
  check('T14', 'Take /a/: SFR normiert hat Median 0 je Halbton', Math.abs(D.median(Array.from(rA.series.sfrn).filter(isFinite))) < 0.01, '');
  const takeG = concat([sil, D.synthVowel(196, CASES[0].F, BW5, 1.0, SR), glide(196, CASES[0].F, CASES[1].F, 0.3), D.synthVowel(196, CASES[1].F, CASES[1].B, 1.0, SR), sil]);
  const rG = await A.analyseTake(takeG, SR, {});
  const s = rG.series; let inGlide = 0, runs = [], cur = null;
  for (let k = 0; k < s.t.length; k++) {
    if (s.t[k] > 1.58 && s.t[k] < 1.72 && s.gate[k] === 2) inGlide++;
    const c = s.gate[k] === 2 ? s.cls[k] : -1;
    if (!cur || cur.c !== c) { if (cur) runs.push(cur); cur = { c, s: s.t[k], e: s.t[k] }; } else cur.e = s.t[k];
  }
  runs.push(cur); runs = runs.filter(x => x.c >= 0);
  check('T12', 'Offline-Gatter: kein stabiler Rahmen im Gleitkern 1,58–1,72 s', inGlide === 0, inGlide + ' Rahmen');
  check('T12', 'Offline-Gatter: zwei stabile Laeufe mit verschiedenen Klassen, erst /a/', runs.length === 2 && V.CENTROIDS[runs[0].c].cls === 'a' && runs[1].c !== runs[0].c, runs.map(x => V.CENTROIDS[x.c].cls + ' ' + x.s.toFixed(2) + '-' + x.e.toFixed(2)).join(' | '));
  check('T12', 'Offline-Gatter: /a/-Lauf deckt mindestens 0,7 s des 1-s-Vokals', runs.length && runs[0].e - runs[0].s >= 0.7, runs.length ? (runs[0].e - runs[0].s).toFixed(2) + ' s' : '');
  check('T12', 'Offline-Gatter: Segmente je Vokal mit Median dF3-4', rG.summary.segments.length === 2 && rG.summary.segments.every(x => isFinite(x.d34Med)), JSON.stringify(rG.summary.segments.map(x => x.cls + ':' + r0(x.d34Med))));
  const refs = A.computeRefs([{ id: 'x', code: 'A', createdAt: '2026-09-03', summary: rG.summary }]);
  check('T12', 'Referenzen je Vokal aus Chronik', refs.a && isFinite(refs.a.d34) && Object.keys(refs).length === 2, JSON.stringify(Object.keys(refs)));

  // T27 Schritt 0 aus dem Manual: Uhrzeit, Stelle in der Sitzung, Pause davor, Einsing-Status.
  {
    const CHR = require('./chronik.js').VARECHRONIK;
    const want = ['time_local', 'tz_offset_min', 'session_nr', 'session_id', 'take_in_session', 'pause_before_s', 'pause_same_session', 'warmup_state', 'warmup_min'];
    const keys = C.TAKE_COLUMNS.map(c => c.key), i0 = keys.indexOf('datetime_iso');
    check('T27', 'CSV: neun Schritt-0-Spalten direkt nach datetime_iso', want.every((k, j) => keys[i0 + 1 + j] === k), keys.slice(i0 + 1, i0 + 10).join(','));
    const voll = { code: 'A', createdAt: '2026-10-03T07:48:00.000Z', timeLocal: '09:48', tzOffsetMin: 120,
      sitzung: { nr: 3, id: 's-1', position: 4, pauseVorherS: 612.5, pauseSelbeSitzung: true, warmup: 'voll', warmupMin: 22 } };
    const L = C.takesToCsv([voll, { code: 'B', createdAt: 'x' }], 'standard').split('\n');
    const head = L[0].split(','), r1 = L[1].split(','), r2 = L[2].split(',');
    const val = (r, k) => r[head.indexOf(k)];
    check('T27', 'CSV: Werte kommen unverändert an', val(r1, 'time_local') === '09:48' && val(r1, 'tz_offset_min') === '120' && val(r1, 'take_in_session') === '4' && val(r1, 'pause_before_s') === '612.5' && val(r1, 'pause_same_session') === '1' && val(r1, 'warmup_state') === 'voll' && val(r1, 'warmup_min') === '22', want.map(k => val(r1, k)).join('|'));
    check('T27', 'CSV: fehlende Zahl = Sentinel, fehlender Text = leer, nichts geraten', val(r2, 'take_in_session') === '-99' && val(r2, 'pause_before_s') === '-99.0' && val(r2, 'warmup_min') === '-99' && val(r2, 'time_local') === '' && val(r2, 'warmup_state') === '', want.map(k => val(r2, k)).join('|'));
    const de = C.takesToCsv([voll], 'excelde').replace(/^﻿/, '').split(/\r?\n/);
    check('T27', 'CSV Excel DE: Pause mit Dezimalkomma', de[1].split(';')[de[0].split(';').indexOf('pause_before_s')] === '612,5', '');
    const z = CHR.kontextZeile(voll);
    check('T27', 'Anzeige: Uhrzeit, Stelle, Pause, Einsing-Status stehen da', /09:48/.test(z) && /Sitzung 3, Take 4/.test(z) && /Pause davor 10 min/.test(z) && /voll eingesungen, seit 22 min/.test(z), z.replace(/<[^>]+>/g, ''));
    const leer = CHR.kontextZeile({});
    check('T27', 'Anzeige: jede fehlende Angabe ist in Rost benannt', (leer.match(/class="rust"/g) || []).length === 4, leer.replace(/<[^>]+>/g, ''));
    const erster = CHR.kontextZeile({ timeLocal: '09:00', sitzung: { id: 's', nr: 1, position: 1, pauseVorherS: null } });
    check('T27', 'Anzeige: erster Take heißt erster Take, nicht Pause unbekannt', /erster Take/.test(erster) && !/Pause unbekannt/.test(erster), '');
    let fremd, ok = true;
    try { fremd = CHR.kontextZeile({ timeLocal: '<img src=x onerror=1>', tzOffsetMin: 'x', sitzung: { nr: '<b>', position: '"x', pauseVorherS: 'abc', warmup: 'constructor', warmupMin: {} } }); } catch (e) { ok = false; fremd = String(e); }
    check('T27', 'Import-Fremddaten: kein Absturz, nichts unmaskiert im HTML', ok && !/<img|<b>/.test(fremd) && !/function/.test(fremd), fremd.replace(/<[^>]+>/g, ''));
  }

  /* Weitere Kriterien stehen in eigenen Modulen unter pruefung/kriterien/, eine Datei je Bereich.
     Jedes Modul exportiert eine async-Funktion und bekommt die gemeinsamen Hilfen übergeben.
     Reihenfolge: alphabetisch nach Dateiname. Ein Modul, das wirft, zählt als gerissenes Kriterium. */
  {
    const fs = require('fs'), path = require('path');
    const KDIR = path.join(__dirname, 'pruefung', 'kriterien');
    const H = { check, near, r0, r1, r2, noise, tone, concat, scale, dbToLin, SR, TSR, BW5, CASES, D, V, A, C, W, glide };
    if (fs.existsSync(KDIR)) {
      for (const f of fs.readdirSync(KDIR).filter(n => /\.js$/.test(n)).sort()) {
        try { await require(path.join(KDIR, f))(H); }
        catch (e) { check('MOD', 'Kriterienmodul ' + f + ' läuft ohne Ausnahme', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
      }
    }
  }

  console.log('\n=== ERGEBNIS: ' + passes + ' bestanden, ' + fails + ' gerissen ===');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FEHLER im Prueflauf:', e); process.exit(2); });

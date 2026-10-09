/* Kriterien HB — Hochband 1.1 („Tröte“, hochband.js): Teiltonstruktur 4–6,5 kHz nach vare_hochband.py; 1.1 mit Oktavprüfung im Kamm.
   HB1 Rechenvorschrift gegen eine unabhängige Nachrechnung (Masken über alle Teiltöne, Bandsummen, Normierung);
   HB2 Trennschärfe: Vokal mit F6/F7 gegen denselben Vokal ohne, Rauschen ohne Linien ≈ 0 dB;
   HB3 feiner Grundton: Kamm findet den wahren Grundton innerhalb ±2 % um den Wert des Kerns, nicht darüber hinaus; Oktavprüfung (f0/2, 2·f0);
   HB4 Gatter und Kennwerte: laut, Rand, Boden, Grundton unsicher, Mindestzahlen, Verlauf — gegen eine von Hand gebaute Rahmenliste;
   HB5 Rauschboden aus den stillsten Blöcken, digitale Stille ausgenommen;
   HB6 analyseTake: Serie, Zusammenfassung, CSV (beide Dialekte, Paketnamen) und take.json tragen das Hochband; Pausen ohne Wert;
   HB7 andere Geräterate (44,1 kHz): gleiche Bänder in Hz, Wert in derselben Größenordnung.
   Prüfsignale mit allgemeinen Baritonwerten, keine Messwerte einer bestimmten Stimme. */
'use strict';
const path = require('path');
const HB = require(path.join(__dirname, '..', '..', 'hochband.js'));

module.exports = async function (H) {
  const { check, near, r1, r2, noise, concat, SR, BW5, D, A, C, V } = H;
  const kurz = e => String(e && e.stack || e).split('\n').slice(0, 2).join(' | ');
  const FA = [700, 1200, 2500, 3300, 4200], FA67 = FA.concat([5100, 5900]), BW67 = BW5.concat([200, 250]);
  const add = (a, b) => { const y = new Float64Array(a.length); for (let i = 0; i < a.length; i++) y[i] = a[i] + (b[i] || 0); return y; };
  const vokal = (f0, F, B, dur, sr, seed, rausch) => add(D.synthVowel(f0, F, B, dur, sr || SR, { gain: 0.5 }), noise(Math.round(dur * (sr || SR)), rausch == null ? 5e-4 : rausch, seed || 7));

  /* ---------- HB1: Nachrechnung ---------- */
  try {
    const sig = vokal(196, FA67, BW67, 0.5, SR, 3), W = HB.fensterLaenge(SR), N = HB.nfftTeilton(SR), start = 4000;
    const P = HB.leistung(sig, start, W, N), t = HB.teiltonRahmen(P, 196 * 1.004, SR, N);
    // Unabhängig: rohes |X|² über eine direkte DFT auf den Bins der Bänder wäre zu teuer; genommen wird D.spectrum (Hann, Nullauffüllung),
    // dessen pow sich von P nur um den konstanten Faktor (2/Σw)² unterscheidet — in Linie−Zwischenraum kürzt er sich.
    const sp = D.spectrum(sig.subarray(start, start + W), SR, N), df = SR / N;
    let bestS = -Infinity, bestC = NaN;
    for (let j = -20; j <= 20; j++) {
      const c = 196 * 1.004 * (1 + j * 0.001), kLo = Math.max(2, Math.ceil(500 / c)), kHi = Math.floor(3000 / c);
      if (kHi - kLo + 1 < 3) continue;
      let s = 0, n = 0;
      for (let k = kLo; k <= kHi; k++) { const ix = Math.round(k * c / df); if (ix >= sp.pow.length - 1) continue; s += Math.log(sp.pow[ix - 1] + sp.pow[ix] + sp.pow[ix + 1] + 1e-30); n++; }
      if (n && s / n > bestS) { bestS = s / n; bestC = c; }
    }
    const f = bestC, pos = []; for (let k = 1; k * f <= 7000; k++) pos.push(k * f);
    const band = (a, b) => { let lin = 0, zw = 0, nl = 0, nz = 0; for (let k = 0; k < sp.pow.length; k++) { const fr = k * df; if (fr < a || fr >= b) continue; let dist = Infinity; for (const p of pos) dist = Math.min(dist, Math.abs(fr - p)); if (dist <= 0.12 * f) { lin += sp.pow[k]; nl++; } else if (dist >= 0.30 * f) { zw += sp.pow[k]; nz++; } } return 10 * Math.log10(lin + 1e-30) - 10 * Math.log10(zw * nl / Math.max(nz, 1) + 1e-30); };
    const soll = { hb: band(4000, 6500), sf: band(2400, 3200), lo: band(300, 2000) }, ist = { hb: t.hbLin - t.hbZw, sf: t.sfLin - t.sfZw, lo: t.loLin - t.loZw };
    const d = Math.max(Math.abs(soll.hb - ist.hb), Math.abs(soll.sf - ist.sf), Math.abs(soll.lo - ist.lo));
    check('HB1', 'teiltonRahmen gegen Nachrechnung (Kamm ±2 % in 0,1-%-Schritten, Linie ±12 % f0 um k·f0 bis 7 kHz, Zwischenraum ≥ 30 % f0, Bandsummen, Zwischenraum auf Linienbins normiert): Linie−Zwischenraum je Band auf 1e-6 dB, f0 fein gleich',
      d < 1e-6 && Math.abs(t.f0Fein - bestC) < 1e-9, 'Abweichung ' + d.toExponential(1) + ' dB, f0 fein ' + r2(t.f0Fein) + ' vs ' + r2(bestC) + '; hb ' + r2(ist.hb) + ' sf ' + r2(ist.sf) + ' lo ' + r2(ist.lo));
    // Halbe-zu-gerade-Rundung wie numpy
    check('HB1', 'rint rundet wie numpy (halb zu gerade): 2,5→2, 3,5→4, 2,4999→2, 2,5001→3', HB.rint(2.5) === 2 && HB.rint(3.5) === 4 && HB.rint(2.4999) === 2 && HB.rint(2.5001) === 3, '');
    check('HB1', 'Fenster und FFT wie vare_hochband.py: 80 ms = 3840 Abtastwerte, Boden 4096, Teilton 8192 bei 48 kHz', HB.fensterLaenge(SR) === 3840 && HB.nfftBoden(SR) === 4096 && HB.nfftTeilton(SR) === 8192, '');
  } catch (e) { check('HB1', 'Nachrechnung läuft durch', false, kurz(e)); }

  /* ---------- HB2: Trennschärfe ---------- */
  try {
    const W = HB.fensterLaenge(SR), N = HB.nfftTeilton(SR);
    const mit = vokal(196, FA67, BW67, 0.6, SR, 5, 2e-3), ohne = vokal(196, FA, BW5, 0.6, SR, 5, 2e-3);
    const lz = sig => { const v = []; for (let s = 2000; s + W <= sig.length - 2000; s += 960) { const r = HB.rahmen(sig, SR, s, 196, NaN); v.push(r.hbLz); } return D.median(v); };
    const a = lz(mit), b = lz(ohne);
    check('HB2', 'Vokal mit F6/F7 (5100/5900 Hz) im Rauschen: Linie−Zwischenraum 4–6,5 kHz über 3 dB; ohne F6/F7 mindestens 3 dB weniger', a > 3 && b < a - 3, 'mit ' + r1(a) + ' dB, ohne ' + r1(b) + ' dB');
    const rz = noise(Math.round(0.6 * SR), 0.1, 9), v = []; for (let s = 2000; s + W <= rz.length - 2000; s += 960) { const tt = HB.teiltonRahmen(HB.leistung(rz, s, W, N), 196, SR, N); v.push(tt.hbLin - tt.hbZw); }
    check('HB2', 'weißes Rauschen ohne Linien: Linie−Zwischenraum 4–6,5 kHz innerhalb ±1 dB um 0', Math.abs(D.median(v)) < 1, r2(D.median(v)) + ' dB (Median über ' + v.length + ' Rahmen)');
    // Stimme gegen Zisch: Rauschen nur oberhalb 4 kHz hebt hbZw, nicht hbStimme; Linie−Zwischenraum fällt.
    const zisch = (() => { const n = noise(Math.round(0.6 * SR), 0.02, 11), y = new Float64Array(n.length); for (let i = 1; i < n.length; i++) y[i] = 0.5 * (n[i] - n[i - 1]); return y; })();
    const rA = HB.rahmen(mit, SR, 6000, 196, NaN), rB = HB.rahmen(add(mit, zisch), SR, 6000, 196, NaN);
    check('HB2', 'Hochtonrauschen dazu: Zischanteil (hb_zw) steigt um über 6 dB, Linie−Zwischenraum fällt, Linienpegel gegen das Stimmband bleibt innerhalb 1,5 dB', rB.hbZw > rA.hbZw + 6 && rB.hbLz < rA.hbLz - 3 && Math.abs(rB.hbStimme - rA.hbStimme) < 1.5,
      'hb_zw ' + r1(rA.hbZw) + ' → ' + r1(rB.hbZw) + ', hb_lz ' + r1(rA.hbLz) + ' → ' + r1(rB.hbLz) + ', hb_stimme ' + r1(rA.hbStimme) + ' → ' + r1(rB.hbStimme));
  } catch (e) { check('HB2', 'Trennschärfe läuft durch', false, kurz(e)); }

  /* ---------- HB3: feiner Grundton ---------- */
  try {
    const W = HB.fensterLaenge(SR), N = HB.nfftTeilton(SR), wahr = 200.5, sig = vokal(wahr, FA67, BW67, 0.4, SR, 13);
    const P = HB.leistung(sig, 3000, W, N), bad = [];
    for (const ab of [-0.015, -0.005, 0, 0.007, 0.018]) { const t = HB.teiltonRahmen(P, wahr * (1 + ab), SR, N); if (Math.abs(t.f0Fein / wahr - 1) > 0.0015) bad.push('Kern ' + (ab * 100).toFixed(1) + ' %: fein ' + r2(t.f0Fein)); }
    check('HB3', 'Kamm: Grundton des Kerns −1,5 … +1,8 % daneben → f0 fein innerhalb 0,15 % des wahren Werts (200,5 Hz)', !bad.length, bad.join('; ') || 'alle fünf Lagen');
    const weit = HB.teiltonRahmen(P, wahr * 1.04, SR, N);
    check('HB3', 'Kern 4 % daneben: der Kamm reicht nur ±2 %, f0 fein bleibt am Rand (≥ 2 % über dem wahren Wert) — der Kamm schärft, er korrigiert nicht', weit.f0Fein / wahr > 1.019, r2(weit.f0Fein));
    // 1.1: Oktavprüfung — eine Oktave zu hoch (H2 als Grundton) oder zu tief gelesen, der Kamm findet den wahren Grundton
    const rWahr = HB.teiltonOktav(P, wahr, SR, N), rHoch = HB.teiltonOktav(P, 2 * wahr, SR, N), rTief = HB.teiltonOktav(P, wahr / 2, SR, N), rOhne = HB.teiltonRahmen(P, 2 * wahr, SR, N);
    check('HB3', 'Oktavprüfung: Grundton eine Oktave zu hoch → Kandidat f0/2 gewinnt (oktav 1), Linie−Zwischenraum wie beim wahren Grundton (±0,5 dB); ohne Prüfung fiele er um über 6 dB',
      rWahr.oktav === 0 && rHoch.oktav === 1 && Math.abs((rHoch.hbLin - rHoch.hbZw) - (rWahr.hbLin - rWahr.hbZw)) < 0.5 && (rOhne.hbLin - rOhne.hbZw) < (rWahr.hbLin - rWahr.hbZw) - 6 && Math.abs(rHoch.f0Fein / wahr - 1) < 0.0015,
      'oktav ' + rWahr.oktav + '/' + rHoch.oktav + ', hb_lz wahr ' + r1(rWahr.hbLin - rWahr.hbZw) + ', korrigiert ' + r1(rHoch.hbLin - rHoch.hbZw) + ', ohne Prüfung ' + r1(rOhne.hbLin - rOhne.hbZw) + ', f0 fein ' + r2(rHoch.f0Fein));
    check('HB3', 'Oktavprüfung: Grundton eine Oktave zu tief → Kandidat 2·f0 gewinnt (oktav 2), Kamm um mehr als 6 dB besser', rTief.oktav === 2 && rTief.kamm > HB.teiltonRahmen(P, wahr / 2, SR, N).kamm + 6 && Math.abs(rTief.f0Fein / wahr - 1) < 0.0015, 'oktav ' + rTief.oktav + ', Kamm ' + r1(rTief.kamm) + ' vs ' + r1(HB.teiltonRahmen(P, wahr / 2, SR, N).kamm));
    check('HB3', 'Oktavprüfung am Rand: f0/2 unter 60 Hz bzw. 2·f0 über 600 Hz werden nicht geprüft (rahmen() mit 100 Hz bzw. 350 Hz liefert oktav 0 oder den zulässigen Kandidaten, keine Ausnahme)', (function () { try { const a = HB.rahmen(sig, SR, 3000, 100, NaN), b = HB.rahmen(sig, SR, 3000, 350, NaN); return !!a && !!b && a.oktav !== 1 && b.oktav !== 2; } catch (e) { return false; } })(), '');
    check('HB3', 'Grundton außerhalb 60–600 Hz oder Fenster außerhalb des Signals: rahmen() liefert null', HB.rahmen(sig, SR, 3000, 50, NaN) === null && HB.rahmen(sig, SR, 3000, 650, NaN) === null && HB.rahmen(sig, SR, sig.length - 100, 200, NaN) === null && HB.rahmen(sig, SR, -1, 200, NaN) === null, '');
  } catch (e) { check('HB3', 'feiner Grundton läuft durch', false, kurz(e)); }

  /* ---------- HB4: Gatter und Kennwerte ---------- */
  try {
    const R = [], mk = (t, pegel, lz, snr, sicher) => ({ t, pegel, hbLz: lz, sfLz: lz + 5, hbStimme: -30, hbZw: -36, sfStimme: -28, zwLo: -25, kamm: 15, snr, sicher });
    // Lauf 1: 0,00–1,98 s (100 Rahmen à 20 ms), Lauf 2 nach 200 ms Lücke: 2,18–3,16 s (50 Rahmen)
    for (let i = 0; i < 100; i++) R.push(mk(i * 0.02, -20, 6 + (i % 3), 20, true));
    for (let i = 0; i < 50; i++) R.push(mk(2.18 + i * 0.02, -20, 2, 20, true));
    R[10].pegel = -40; R[11].pegel = -35;             // leise (p95 − 12 = −32)
    R[20].snr = 3; R[21].snr = 5.9;                   // unter dem Boden
    R[30].sicher = false; R[31].sicher = false;       // Grundton unsicher
    const e = HB.kennwerte(R), k = e.kennwerte, g = e.gatter, G = HB.GATTER;
    const rand = []; for (let i = 0; i < R.length; i++) if (!(g[i] & G.KERN)) rand.push(i);
    // Rand: je Lauf die ersten und letzten 60 ms (strikt kleiner): Lauf 1 Rahmen 0–2 und 97–99, Lauf 2 Rahmen 100–102 und 147–149
    const randSoll = [0, 1, 2, 97, 98, 99, 100, 101, 102, 147, 148, 149];
    check('HB4', 'Rand: je Lauf (Lücke über 45 ms trennt) die ersten und letzten 60 ms ohne KERN-Bit, alle anderen mit', rand.join(',') === randSoll.join(','), rand.join(','));
    check('HB4', 'laut: Pegel unter p95 − 12 dB ohne LAUT-Bit (Rahmen 10, 11), sonst mit', !(g[10] & G.LAUT) && !(g[11] & G.LAUT) && (g[12] & G.LAUT) && (g[9] & G.LAUT), '');
    check('HB4', 'Boden: SNR unter 6 dB ohne SNR-Bit (Rahmen 20, 21), SNR 6 mit', !(g[20] & G.SNR) && !(g[21] & G.SNR) && (g[22] & G.SNR), '');
    check('HB4', 'Grundton unsicher: ohne SICHER-Bit und ohne KERNRAHMEN, aber als „sonst tauglich“ gezählt (f0UnsureShare)', !(g[30] & G.SICHER) && !(g[30] & G.KERNRAHMEN) && (g[32] & G.KERNRAHMEN) && near(k.f0UnsureShare, 2 / 134, 1e-9), r2(k.f0UnsureShare));
    const kern = []; for (let i = 0; i < R.length; i++) if (g[i] & G.KERNRAHMEN) kern.push(i);
    check('HB4', 'Kernrahmen = laut ∧ Kern ∧ SNR ∧ sicher: 150 − 12 Rand − 2 leise − 2 Boden − 2 unsicher = 132', kern.length === 132 && k.nKernLaut === 132 && k.nRahmen === 150, kern.length + ' / ' + k.nKernLaut);
    const lzKern = kern.map(i => R[i].hbLz);
    check('HB4', 'hb_lz = Median über die Kernrahmen, Anteil über 3 dB aus denselben Rahmen, Pegelgrenze = 95. Perzentil', near(k.hbLz, D.median(lzKern), 1e-9) && near(k.hbLzAnt3, lzKern.filter(v => v > 3).length / lzKern.length, 1e-9) && near(k.pegelMax, D.quantile(R.map(r => r.pegel), 0.95), 1e-9),
      r2(k.hbLz) + ' / ' + r2(k.hbLzAnt3) + ' / ' + r1(k.pegelMax));
    check('HB4', 'Verlauf: nur 10-s-Abschnitte mit mindestens 10 Kernrahmen, Text wie vare_hochband.py („0-10s +x.x“)', k.verlaufListe.length === 1 && k.verlaufListe[0].vonS === 0 && /^0-10s [+-]\d+\.\d$/.test(k.verlauf), JSON.stringify(k.verlauf));
    const wenig = HB.kennwerte(R.slice(0, 40)).kennwerte, kaum = HB.kennwerte(R.map(r => Object.assign({}, r, { snr: 1 }))).kennwerte;
    check('HB4', 'unter 50 Rahmen oder unter 30 Kernrahmen: alle Kennwerte NaN, Grund benannt (mit den Zahlen je Gatter), Rahmenzahlen bleiben', !isFinite(wenig.hbLz) && /zu wenige Rahmen/.test(wenig.grund) && wenig.nRahmen === 40 && !isFinite(kaum.hbLz) && /zu wenige laute Kernrahmen/.test(kaum.grund) && /über dem Boden 0/.test(kaum.grund) && kaum.nKernLaut === 0,
      wenig.grund + ' | ' + kaum.grund);
    check('HB4', 'Kurzzeile (zeile) nennt Linie−Zwischenraum, Anteil, Stimme, Zisch, SF-Band, Quellrauschen und Rahmenzahlen', /Linie−Zw \+\d/.test(HB.zeile(k)) && /Stimme -30\.0/.test(HB.zeile(k)) && /132\/150/.test(HB.zeile(k)) && /Hochband: zu wenige/.test(HB.zeile(wenig)), HB.zeile(k).slice(0, 120));
  } catch (e) { check('HB4', 'Gatter läuft durch', false, kurz(e)); }

  /* ---------- HB5: Rauschboden ---------- */
  try {
    const still = noise(Math.round(0.6 * SR), 3e-4, 21), laut = vokal(196, FA67, BW67, 2.0, SR, 23, 3e-4), nullen = new Float64Array(Math.round(0.5 * SR));
    const sig = concat([still, laut, nullen, still]);
    const b = HB.boden(sig, SR), ref = 20 * Math.log10(3e-4 / Math.sqrt(3));   // Effektivwert gleichverteilten Rauschens ±3e-4
    const nb = Math.floor(sig.length / HB.fensterLaenge(SR)), nOk = nb - Math.floor(nullen.length / HB.fensterLaenge(SR));
    check('HB5', 'Boden-RMS aus den stillsten 3 % der 80-ms-Blöcke (mindestens 5) innerhalb 1,5 dB des Rauschens; digitale Stille (−400 dB) zählt nicht; Blockzahl = max(5, ⌊0,03·Blöcke über −90 dBFS⌋)',
      near(b.rmsBoden, ref, 1.5) && b.nBloecke === Math.max(5, Math.floor(0.03 * nOk)) && b.rmsBoden > -90, 'RMS ' + r1(b.rmsBoden) + ' (Rauschen ' + r1(ref) + '), Blöcke ' + b.nBloecke + ' von ' + nb);
    check('HB5', 'Bandpegel des Bodens je Band endlich und unter dem der lauten Blöcke', isFinite(b.hb) && isFinite(b.lo) && b.hb < HB.block(sig, SR, still.length + 10000).hb - 20, r1(b.hb) + ' vs ' + r1(HB.block(sig, SR, still.length + 10000).hb));
    const ring = []; for (let i = 0; i < 200; i++) ring.push({ rms: -30 + (i % 7), hb: 10 }); for (let i = 0; i < 20; i++) ring.push({ rms: -70 - i * 0.1, hb: -40 + i }); ring.push({ rms: -400, hb: -300 });
    const bb = HB.bodenAusBloecken(ring);
    const bbSoll = D.median(ring.filter(x => x.rms > -90).sort((p, q) => p.rms - q.rms).slice(0, Math.max(5, Math.floor(0.03 * 220))).map(x => x.hb));   // 6 leiseste: hb −26 … −21 → −23,5
    check('HB5', 'bodenAusBloecken (Live-Ring): Median des Hochbands der ⌊0,03·n⌋ (mindestens 5) leisesten Blöcke über −90 dBFS; digitale Stille ausgenommen', near(bb, bbSoll, 1e-9) && near(bb, -23.5, 1e-9), r1(bb));
    check('HB5', 'bodenAusBloecken ohne Block über −90 dBFS: NaN, kein erfundener Boden', Number.isNaN(HB.bodenAusBloecken([{ rms: -400, hb: -300 }])) && Number.isNaN(HB.bodenAusBloecken([])), '');
  } catch (e) { check('HB5', 'Rauschboden läuft durch', false, kurz(e)); }

  /* ---------- HB6: analyseTake, Serie, CSV, Paket ---------- */
  try {
    const sil = noise(Math.round(0.4 * SR), 3e-4, 31), sig = concat([sil, vokal(196, FA67, BW67, 2.0, SR, 33, 3e-4), sil]);
    const r = await A.analyseTake(Float32Array.from(sig), SR, {}), s = r.series, h = r.summary.hochband, G = HB.GATTER;
    check('HB6', 'analyseTake: summary.hochband mit Version 1.1, hb_lz > 3 dB, Anteil über 3 dB > 0,8, Kernrahmen ≥ 30, Verlauf „0-10s“, meta.hochbandVersion', h && h.version === '1.1' && h.hbLz > 3 && h.hbLzAnt3 > 0.8 && h.nKernLaut >= 30 && /^0-10s/.test(h.verlauf) && r.meta.hochbandVersion === '1.1' && h.sampleRate === SR,
      h ? r1(h.hbLz) + ' dB, ' + h.nKernLaut + '/' + h.nRahmen + ', ' + h.verlauf : 'kein hochband');
    let pause = 0, pauseFalsch = 0, erst = -1, letzt = -1, kernOhneLaut = 0;
    for (let i = 0; i < s.t.length; i++) {
      const v = s.flags[i] & A.FLAG.VOICED;
      if (!v) { pause++; if (!Number.isNaN(s.hbLz[i]) || s.hbGatter[i] !== 0) pauseFalsch++; }
      else { if (erst < 0) erst = i; letzt = i; if ((s.hbGatter[i] & G.KERNRAHMEN) && !(s.hbGatter[i] & G.LAUT)) kernOhneLaut++; }
    }
    const randOhneKern = [erst, erst + 1, erst + 2, letzt - 2, letzt - 1, letzt].every(i => (s.hbGatter[i] & G.GERECHNET) && !(s.hbGatter[i] & G.KERN));
    const mitteKern = (s.hbGatter[Math.round((erst + letzt) / 2)] & G.KERNRAHMEN) !== 0;
    check('HB6', 'Serie: stimmlose Rahmen ohne Wert (NaN) und ohne Gatterbits; erste und letzte 60 ms des Laufs gerechnet, aber ohne KERN; Mitte Kernrahmen', pause > 10 && pauseFalsch === 0 && randOhneKern && mitteKern && kernOhneLaut === 0,
      'Pause ' + pause + ' (falsch ' + pauseFalsch + '), Rand ' + randOhneKern + ', Mitte ' + mitteKern);
    const felder = A.HB_FELDER.concat(['hbGatter', 'hbOktav']).filter(k => !(ArrayBuffer.isView(s[k]) && s[k].length === s.t.length));
    check('HB6', 'Serie trägt hbLz, sfLz, hbStimme, hbZw, sfStimme, zwLo, hbKamm, hbF0Fein, hbSnr, hbPegel, hbGatter, hbOktav in Rahmenlänge', !felder.length, felder.join(','));
    let okt = 0, oktFalsch = 0; for (let i = 0; i < s.t.length; i++) { if (s.hbGatter[i] & G.GERECHNET) { okt++; if (s.hbOktav[i] !== 0) oktFalsch++; } }
    check('HB6', 'sauberer Vokal mit richtigem Grundton: kein Rahmen auf f0/2 oder 2·f0 gesetzt (hbOktav 0), Anteile 0, geprüfter Grundton 196 Hz auf 1 %', okt > 50 && oktFalsch === 0 && h.oktavHalbShare === 0 && h.oktavDoppeltShare === 0 && near(h.f0GeprMed, 196, 2), 'gerechnet ' + okt + ', verschoben ' + oktFalsch + ', f0 geprüft ' + r1(h.f0GeprMed));
    for (const [d, sep] of [['standard', ','], ['excelde', ';'], ['chronik', ',']]) {
      const z = C.framesToCsv(s, d, V).replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(x => x.split(sep)), kopf = z[0];
      const name = d === 'chronik' ? 'hb_lz_b' : 'hb_lz', c = kopf.indexOf(name), ck = kopf.indexOf('hb_kernrahmen'), m = Math.round((erst + letzt) / 2), co = kopf.indexOf(d === 'chronik' ? 'oktav_b' : 'hb_oktav');
      if (co < 0 || z[m + 1][co] !== '0' || !(d === 'chronik' ? z[1][co] === '' : /^-99/.test(z[1][co]))) check('HB6', 'Rahmen-CSV ' + d + ': Spalte hb_oktav (Paket oktav_b) 0 in gerechneten Rahmen, fehlend in der Pause', false, 'Spalte ' + co + ' Werte „' + (co >= 0 ? z[m + 1][co] + '“/„' + z[1][co] : '') + '“');
      const wert = z[m + 1][c].replace(',', '.'), kern = z[m + 1][ck], pz = z[1][c], pk = z[1][ck];
      check('HB6', 'Rahmen-CSV ' + d + ': Spalte ' + name + ' trägt den Serienwert (Mitte), hb_kernrahmen 1; in der Pause ' + (d === 'chronik' ? 'leer' : '−99'),
        c >= 0 && ck >= 0 && near(parseFloat(wert), s.hbLz[m], d === 'chronik' ? 1e-6 : 0.0051) && kern === '1' && (d === 'chronik' ? (pz === '' && pk === '') : (/^-99/.test(pz) && /^-99/.test(pk))),
        name + '=' + wert + ' (Serie ' + r2(s.hbLz[m]) + '), Kern ' + kern + ', Pause „' + pz + '“/„' + pk + '“');
    }
    const take = { id: '20260903-1159-hb', code: 'A', label: 'hb', startedAt: '2026-09-03T09:59:00.000Z', durationS: sig.length / SR, sampleRate: SR, summary: r.summary, analysis: r.meta };
    const tj = C.takeJson(take), tcsv = C.takesToCsv([take], 'standard').split('\r\n'), hk = tcsv[0].split(','), hv = tcsv[1].split(',');
    const col = k => hv[hk.indexOf(k)];
    check('HB6', 'take.json: kennwerte.hochband mit allen Kennwerten und kein NaN; Take-CSV: hb_lz_med, hb_n_kern_laut, hb_verlauf, hb_oktav_halb_share, hb_f0_gepr_med_hz, hochband_version aus der Zusammenfassung',
      tj.kennwerte.hochband && near(tj.kennwerte.hochband.hbLz, h.hbLz, 1e-9) && !/NaN/.test(JSON.stringify(tj)) && near(parseFloat(col('hb_lz_med')), h.hbLz, 0.0051) && col('hb_n_kern_laut') === String(h.nKernLaut) && col('hb_verlauf').replace(/"/g, '') === h.verlauf && col('hochband_version') === '1.1' && col('hb_oktav_halb_share') === '0.000' && near(parseFloat(col('hb_f0_gepr_med_hz')), h.f0GeprMed, 0.051),
      'hb_lz_med ' + col('hb_lz_med') + ', n ' + col('hb_n_kern_laut') + ', Verlauf ' + col('hb_verlauf') + ', Version ' + col('hochband_version'));
    // Ältere Auswertung ohne Hochband: Spalten −99 bzw. leer, Serie ohne Felder → −99, Kachel bittet um Neu-Analyse
    const alt = { id: 'alt', code: 'B', createdAt: 'x', summary: { f0: { med: 100 } } }, acsv = C.takesToCsv([alt], 'standard').split('\r\n'), ak = acsv[0].split(','), av = acsv[1].split(',');
    const CH = require(path.join(__dirname, '..', '..', 'chronik.js')).VARECHRONIK;
    check('HB6', 'ältere Auswertung ohne Hochband: Take-CSV hb_lz_med −99, hb_verlauf leer; Kachel „neu analysieren“; Kachel mit Grund, wenn gerechnet, aber kein Kennwert', av[ak.indexOf('hb_lz_med')] === '-99.00' && av[ak.indexOf('hb_verlauf')] === '' && /neu analysieren/.test(CH.hochbandText(undefined)) && /zu wenige/.test(CH.hochbandText({ hbLz: NaN, grund: 'zu wenige Rahmen mit Hochband (3 < 50)' })),
      av[ak.indexOf('hb_lz_med')] + ' | ' + CH.hochbandText(undefined));
    // Kurzer Take unter 50 Rahmen: Zusammenfassung mit Grund, keine Ausnahme
    const kurzTake = await A.analyseTake(Float32Array.from(vokal(196, FA67, BW67, 0.5, SR, 35, 3e-4)), SR, {});
    check('HB6', 'kurzer Take (0,5 s): kein Kennwert, Grund „zu wenige Rahmen“ in summary.hochband.grund, keine Ausnahme', kurzTake.summary.hochband && !isFinite(kurzTake.summary.hochband.hbLz) && /zu wenige/.test(kurzTake.summary.hochband.grund), kurzTake.summary.hochband.grund);
    // Korpusmarken und Lage
    CH.setHochbandMarken({ hb_lz: [{ db: 2.1, text: 'Chronik p10' }, { db: 4.4, text: 'Chronik-Median' }, { db: 7.3, text: 'Chronik p90' }], sf_lz: [] });
    check('HB6', 'Lage zwischen Korpusmarken: unter p10 / zwischen Median und p90 / über p90; ohne Marken leer', /^unter „Chronik p10“$/.test(CH.hochbandLage(1, 'hb_lz')) && /^zwischen „Chronik-Median“ und „Chronik p90“$/.test(CH.hochbandLage(5, 'hb_lz')) && /^über „Chronik p90“$/.test(CH.hochbandLage(9, 'hb_lz')) && CH.hochbandLage(5, 'sf_lz') === '',
      CH.hochbandLage(5, 'hb_lz'));
    CH.setHochbandMarken(null);
    const KOm = require(path.join(__dirname, '..', '..', 'korpus.js')), ko = (KOm.VAREKORPUS || KOm).pruefeKorpus;   // korpus.js hängt sich unter Node an module.exports.VAREKORPUS
    if (ko) {
      const k = ko({ format: 'vare-korpus', version: 1, marken: { d34: [518], hb_lz: [{ db: 2.1, text: 'p10' }, 4.4, { db: 99 }, { db: 'x' }], sf_lz: [{ db: 9.7, text: 'Median' }] } });
      check('HB6', 'korpus.json: marken.hb_lz und marken.sf_lz werden gelesen ({ db, text } oder Zahl, −30…+40 dB), Unbrauchbares fällt heraus, d34 bleibt', k.hochband.hb_lz.length === 2 && k.hochband.hb_lz[1].db === 4.4 && k.hochband.sf_lz.length === 1 && k.marken.length === 1, JSON.stringify(k.hochband));
    }
  } catch (e) { check('HB6', 'analyseTake mit Hochband läuft durch', false, kurz(e)); }

  /* ---------- HB7: 44,1 kHz ---------- */
  try {
    const SR2 = 44100, sig48 = vokal(196, FA67, BW67, 1.2, SR, 41, 1e-3), sig44 = D.resample(sig48, SR, SR2);
    const W = HB.fensterLaenge(SR2), N = HB.nfftTeilton(SR2), a = [], b = [];
    for (let s = 4000; s + HB.fensterLaenge(SR) <= sig48.length - 4000; s += 4800) a.push(HB.rahmen(sig48, SR, s, 196, NaN).hbLz);
    for (let s = Math.round(4000 * SR2 / SR); s + W <= sig44.length - 4000; s += Math.round(4800 * SR2 / SR)) b.push(HB.rahmen(sig44, SR2, s, 196, NaN).hbLz);
    check('HB7', '44,1 kHz: Fenster 3528, FFT 4096/8192; Linie−Zwischenraum 4–6,5 kHz innerhalb 2 dB des 48-kHz-Wegs', W === 3528 && HB.nfftBoden(SR2) === 4096 && N === 8192 && near(D.median(b), D.median(a), 2), '48 kHz ' + r1(D.median(a)) + ' dB, 44,1 kHz ' + r1(D.median(b)) + ' dB');
  } catch (e) { check('HB7', '44,1 kHz läuft durch', false, kurz(e)); }
};

/* V-Kriterien: Live-Gatter (vowel.js createGate) im Vokalwechsel, bei Vibrato und kleinem Fenster.
   Live heißt hier wie in app.js tick(): je Takt die letzten 0,2 s, auf 12 kHz, analyseAt mit
   align 'end'. Testsignale mit allgemeinen Baritonwerten (98–250 Hz), Rauschabstand 40–60 dB. */
'use strict';
module.exports = async function (H) {
  const { check, D, V, SR, TSR, noise, BW5 } = H;

  // Formanten gleiten stetig: Resonatoren blockweise (5 ms) mit erhaltenem Zustand, Quelle mit
  // beliebigem Grundtonverlauf (Vibrato). Rauschen relativ zum Effektivwert.
  function synth(f0fn, Ffn, dur, B, snrDb, seed) {
    const n = Math.round(dur * SR), src = new Float64Array(n);
    let ph = 0.999;
    for (let i = 0; i < n; i++) { ph += f0fn(i / SR) / SR; if (ph >= 1) { ph -= 1; for (let j = 0; j < 6 && i + j < n; j++) src[i + j] += Math.cos(Math.PI * j / 12); } }
    const st = B.map(() => [0, 0]), y = new Float64Array(n), blk = Math.round(0.005 * SR);
    for (let s = 0; s < n; s += blk) {
      const F = Ffn(s / SR);
      let x = src.subarray(s, Math.min(n, s + blk));
      for (let m = 0; m < 5; m++) {
        const r = Math.exp(-Math.PI * B[m] / SR), th = 2 * Math.PI * F[m] / SR, a1 = 2 * r * Math.cos(th), a2 = -r * r, b0 = 1 - a1 - a2;
        const out = new Float64Array(x.length); let y1 = st[m][0], y2 = st[m][1];
        for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + a1 * y1 + a2 * y2; y2 = y1; y1 = v; out[i] = v; }
        st[m] = [y1, y2]; x = out;
      }
      y.set(x, s);
    }
    let mx = 0, e = 0;
    for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i]));
    for (let i = 0; i < n; i++) { y[i] = 0.3 * y[i] / mx; e += y[i] * y[i]; }
    const amp = Math.sqrt(e / n) * Math.pow(10, -snrDb / 20) * Math.sqrt(3), nz = noise(n, amp, seed);
    for (let i = 0; i < n; i++) y[i] += nz[i];
    return { y, floorDb: 20 * Math.log10(amp / Math.sqrt(3)) };
  }
  function live(sig, times) {
    const out = [], n02 = Math.round(0.2 * SR);
    for (const t of times) {
      const iEnd = Math.round(t * SR);
      if (iEnd - n02 < 0 || iEnd > sig.y.length) continue;
      const ds = D.resample(sig.y.subarray(iEnd - n02, iEnd), SR, TSR);
      const fr = D.analyseAt(ds, TSR, ds.length - 1, { align: 'end', floorDb: sig.floorDb });
      out.push({ t, voiced: fr.voiced, F1: fr.F[0], F2: fr.F[1], F3: fr.F[2], valid1: fr.valid[0], valid2: fr.valid[1], d34: fr.d34, d34valid: fr.d34valid });
    }
    return out;
  }
  const takt = (t0, t1, T) => { const o = []; for (let t = t0; t <= t1 + 1e-9; t += T) o.push(t); return o; };
  const vib = (f0, rate, cent) => t => f0 * Math.pow(2, cent / 1200 * Math.sin(2 * Math.PI * rate * t + 0.7));
  const med = a => D.median(a.filter(isFinite));
  const VOK = { a: [700, 1200, 2600, 3400, 4200], o: [380, 750, 2600, 2950, 4000], i: [300, 2200, 2900, 3500, 4300], e: [400, 2000, 2700, 3400, 4200], u: [320, 750, 2600, 3300, 4200], ɐ: [520, 1350, 2600, 3300, 4200] };
  const BV = { a: BW5, o: BW5, i: [60, 100, 130, 160, 200], e: [60, 100, 130, 160, 200], u: [60, 90, 120, 150, 200], ɐ: BW5 };
  // Toleranz, ab der ein Rahmen den stehenden Vokal verlässt: halbe Streuungsgrenze (Vorgabe 50/100 Hz)
  // oder 4,5 % — so weit schiebt Vibrato ±50 Cent einen am Teilton hängenden Formantwert (gemessen).
  const tolF1 = f => Math.max(25, 0.045 * f), tolF2 = f => Math.max(50, 0.045 * f);

  /* V1a: ein einzelner, gültig gemessener Rahmen am Fensterrand, der den Vokal verlässt.
     Vorher: „stabil /a/“ mit Wertung 500, weil seine Abweichung im Interdezilbereich kaum zählt. */
  {
    const g = V.createGate({});
    for (let i = 0; i <= 24; i++) g.update({ t: i * 0.042, voiced: true, F1: 700, F2: 1200, F3: 2600, valid1: true, valid2: true, d34: 800, d34valid: true });
    const r = g.update({ t: 25 * 0.042, voiced: true, F1: 640, F2: 1150, F3: 2600, valid1: true, valid2: true, d34: 500, d34valid: true });
    check('V1', 'Live-Gatter: Rahmen am Fensterrand mit F1 640 / F2 1150 nach 1 s /a/ 700/1200 bekommt keine Wertung, Grund sichtbar', !isFinite(r.score) && /verlässt den Vokal/.test(r.reason), r.state + ' /' + r.cls + '/ score ' + r.score + ' — ' + r.reason);
    const g2 = V.createGate({});
    for (let i = 0; i <= 24; i++) g2.update({ t: i * 0.042, voiced: true, F1: 700, F2: 1200, F3: 2600, valid1: true, valid2: true, d34: 800, d34valid: true });
    const r2 = g2.update({ t: 25 * 0.042, voiced: true, F1: NaN, F2: 1200, F3: 2600, valid1: false, valid2: true, d34: 520, d34valid: true });
    check('V1', 'Live-Gatter: Rahmen ohne eigenes F1 bekommt keine Wertung (ob er im Vokal steht, ist unprüfbar)', !isFinite(r2.score) && /fehlt/.test(r2.reason), r2.state + ' score ' + r2.score + ' — ' + r2.reason);
  }

  /* V1b: echte Live-Folge im Vokalwechsel. Ab dem ersten Rahmen, dessen eigenes F1/F2 mehr als die
     Toleranz vom stehenden Vokal abweicht, keine Wertung, bis er im neuen Vokal angekommen ist.
     Je Wechsel drei Gleitdauern, jeder Takt 33/42/50 ms einmal, mit und ohne Vibrato. */
  const FAELLE = {
    ao: [[0.15, 0.033, 110, 0], [0.3, 0.05, 147, 0], [0.5, 0.042, 98, 50]],
    ai: [[0.15, 0.042, 147, 50], [0.3, 0.033, 196, 0], [0.5, 0.05, 110, 0]],
    oa: [[0.15, 0.05, 110, 50], [0.3, 0.042, 110, 0], [0.5, 0.033, 147, 50]],
    eu: [[0.15, 0.033, 196, 0], [0.3, 0.05, 147, 50], [0.5, 0.042, 110, 0]]
  };
  const FENSTER_WECHSEL = [0.15, 0.3, 0.6];
  for (const p in FAELLE) {
    let verstoss = 0, beispiel = '', ohneGrund = 0, gewertetSteh = 0, folgen = 0, gewertetAb = 0;
    for (const [gl, T, f0, cent] of FAELLE[p]) {
      const g0 = 1.1, FA = VOK[p[0]], FB = VOK[p[1]], B = BV[p[0]].map((b, k) => (b + BV[p[1]][k]) / 2);
      const w = t => Math.min(1, Math.max(0, (t - g0) / gl));
      const sig = synth(vib(f0, 6, cent), t => FA.map((v, k) => v + (FB[k] - v) * w(t)), g0 + gl + 0.75, B, 60, Math.round(f0 * 10 + gl * 100));
      const frames = live(sig, takt(0.2, g0 + gl + 0.75, T));
      const stA = frames.filter(f => f.voiced && f.t > 0.6 && f.t <= g0), stB = frames.filter(f => f.voiced && f.t > g0 + gl + 0.35);
      const A1 = med(stA.map(f => f.F1)), A2 = med(stA.map(f => f.F2)), B1 = med(stB.map(f => f.F1)), B2 = med(stB.map(f => f.F2));
      for (const windowS of FENSTER_WECHSEL) {
        folgen++;
        const g = V.createGate({ windowS });
        let verlassen = false;
        for (const f of frames) {
          const r = g.update(f);
          if (f.t <= g0) { if (isFinite(r.score) && f.t > 0.7) gewertetSteh++; continue; }
          if (!verlassen && f.voiced && !(Math.abs(f.F1 - A1) <= tolF1(A1) && Math.abs(f.F2 - A2) <= tolF2(A2))) verlassen = true;
          if (isFinite(r.score) && !verlassen) gewertetAb++;
          if (!verlassen || (Math.abs(f.F1 - B1) <= tolF1(B1) && Math.abs(f.F2 - B2) <= tolF2(B2))) continue;
          if (isFinite(r.score)) { verstoss++; if (!beispiel) beispiel = 'Gleiten ' + gl + ' s, Takt ' + T * 1000 + ' ms, ' + f0 + ' Hz, Fenster ' + windowS + ' s, t = Gleitbeginn + ' + (f.t - g0).toFixed(3) + ' s: F1 ' + Math.round(f.F1) + ' (steht ' + Math.round(A1) + ') F2 ' + Math.round(f.F2) + ' (steht ' + Math.round(A2) + '), gewertet ' + Math.round(r.score) + ' Hz'; }
          else if (r.state === 'stabil' && !r.reason) ohneGrund++;
        }
      }
    }
    check('V1', 'Live-Wechsel /' + p[0] + '/→/' + p[1] + '/: ab dem ersten Rahmen, der den stehenden Vokal verlässt, keine Wertung bis zur Ankunft, Grund sichtbar (Gleiten 0,15/0,3/0,5 s, Takt 33/42/50 ms, Fenster ' + FENSTER_WECHSEL.join('/') + ' s)',
      verstoss === 0 && ohneGrund === 0 && gewertetSteh > 0,
      verstoss ? verstoss + ' Fehlwertungen, erste: ' + beispiel : folgen + ' Folgen, gewertet im stehenden Vokal ' + gewertetSteh + ', nach Gleitbeginn noch im Vokal ' + gewertetAb + (ohneGrund ? ', ohne Grund ' + ohneGrund : ''));
  }

  /* V1c: die Toleranz trägt realistisches Vibrato. Stehende Vokale mit Vibrato 6 Hz ±50 Cent und
     Wobble 3,5 Hz ±30 Cent, auch dort, wo der Formantwert am Teilton hängt (/a/-F1 und /ɐ/ bei
     250 Hz, /i/-F2 bei 220–250 Hz): kein Rahmen darf als „verlässt den Vokal“ gelten. */
  const FENSTER_VIBRATO = [0.3, 0.6];
  {
    let falsch = 0, gewertet = 0, beispiel = '';
    const leer = [];
    for (const [v, f0, snr] of [['a', 98, 40], ['a', 196, 40], ['a', 250, 40], ['ɐ', 250, 40], ['o', 196, 60], ['i', 220, 60], ['i', 250, 60]]) for (const [rate, cent] of [[6, 50], [3.5, 30]]) {
      const sig = synth(vib(f0, rate, cent), () => VOK[v], 2.0, BV[v], snr, f0 + rate * 7);
      const frames = live(sig, takt(0.2, 2.0, 0.042));
      for (const windowS of FENSTER_VIBRATO) {
        const g = V.createGate({ windowS }); let n = 0;
        for (const f of frames) { const r = g.update(f); if (isFinite(r.score)) n++; if (/verlässt|fehlt/.test(r.reason)) { falsch++; if (!beispiel) beispiel = '/' + v + '/ ' + f0 + ' Hz ' + rate + ' Hz ±' + cent + ' Cent, Fenster ' + windowS + ' s: ' + r.reason; } }
        gewertet += n; if (!n) leer.push('/' + v + '/ ' + f0 + ' Hz ' + rate + ' Hz, Fenster ' + windowS);
      }
    }
    check('V1', 'Live-Gatter: stehende Vokale mit Vibrato ±50 Cent und Wobble ±30 Cent (98–250 Hz) — kein Rahmen gilt als „verlässt den Vokal“, jede Folge gewertet (Fenster ' + FENSTER_VIBRATO.join('/') + ' s)',
      falsch === 0 && leer.length === 0, falsch ? falsch + ' Rahmen, erster: ' + beispiel : 'gewertet ' + gewertet + (leer.length ? ', ohne Wertung: ' + leer.join('; ') : ''));
  }

  /* V1d: Teiltonsprünge. Liegt der Formant zwischen zwei Teiltönen (/i/-F2 2200 und /e/-F2 2000 Hz
     bei 233 Hz), springt der Messwert im Takt des Vibratos um bis zu 6 % zwischen ihnen hin und her.
     Das ist Messunsicherheit des stehenden Vokals, kein Verlassen. */
  {
    let falsch = 0, gewertet = 0, beispiel = '';
    for (const v of ['i', 'e']) for (const [rate, cent] of [[5.5, 40], [3.5, 30]]) {
      const sig = synth(vib(233.1, rate, cent), () => VOK[v], 2.0, BV[v], 60, 233 + Math.round(rate * 7));
      const frames = live(sig, takt(0.2, 2.0, 0.042));
      for (const windowS of FENSTER_VIBRATO) {
        const g = V.createGate({ windowS });
        for (const f of frames) { const r = g.update(f); if (isFinite(r.score)) gewertet++; if (/verlässt|fehlt/.test(r.reason)) { falsch++; if (!beispiel) beispiel = '/' + v + '/ ' + rate + ' Hz ±' + cent + ' Cent, Fenster ' + windowS + ' s: ' + r.reason; } }
      }
    }
    check('V1', 'Live-Gatter: Teiltonsprünge bei 233 Hz (/i/, /e/, Vibrato ±40 Cent, Wobble ±30 Cent) gelten nicht als „verlässt den Vokal“', falsch === 0 && gewertet > 0, falsch ? falsch + ' Rahmen, erster: ' + beispiel : 'gewertet ' + gewertet);
  }
};

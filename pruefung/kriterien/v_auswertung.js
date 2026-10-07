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
  const FENSTER_VIBRATO = [0.15, 0.3, 0.6];
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

  /* V1e–g: kleines Fenster (Bericht 2, Befund 8). Live kommt höchstens alle 40–50 ms ein Rahmen; mit
     fünf geforderten Rahmen war 0,15 s nie stabil. Stehender Vokal mit leichtem Zittern (6 Hz). */
  const steh = t => ({ t, voiced: true, F1: 700 + 6 * Math.sin(2 * Math.PI * 6 * t), F2: 1200 + 10 * Math.sin(2 * Math.PI * 6 * t + 1), F3: 2600, valid1: true, valid2: true, d34: 700, d34valid: true });
  {
    const g = V.createGate({ windowS: 0.15 }); let r = null;
    for (let t = 0; t <= 0.3 + 1e-9; t += 0.05) r = g.update(steh(t));
    check('V1', 'Live-Gatter, Fenster 0,15 s, Takt 50 ms: stehender Vokal ist nach 0,3 s stabil und gewertet', r.state === 'stabil' && isFinite(r.score), r.state + ' — ' + r.reason);
  }
  {
    // Bildschirmtakt P, 20 % der Bilder fallen aus; app.js rechnet frühestens 40 ms nach dem letzten Rahmen.
    let s = 7; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const raf = (P, dur) => { const o = []; let last = -1e9; for (let t = 0; t <= dur; t += P) { if (rnd() < 0.2) continue; if (t - last >= 0.040 - 1e-9) { o.push(t); last = t; } } return o; };
    const verlust = (T, dur) => { const o = []; for (let t = 0; t <= dur; t += T) if (rnd() >= 0.2) o.push(t); return o; };
    const anteil = (ts, windowS) => { const g = V.createGate({ windowS }); let n = 0, st = 0; for (const t of ts) { const r = g.update(steh(100 + t)); if (t < 1) continue; n++; if (r.state === 'stabil' && isFinite(r.score)) st++; } return st / n; };
    let minRaf = 1, wRaf = '', minVerl = 1, wVerl = '';
    for (const windowS of [0.15, 0.2, 0.3, 0.45, 0.6]) {
      for (const [nm, P] of [['60 Hz', 1 / 60], ['120 Hz', 1 / 120], ['144 Hz', 1 / 144]]) { const a = anteil(raf(P, 20), windowS); if (a < minRaf) { minRaf = a; wRaf = 'Fenster ' + windowS + ' s, Bildschirm ' + nm; } }
      for (const T of [0.033, 0.042, 0.05]) { const a = anteil(verlust(T, 20), windowS); if (a < minVerl) { minVerl = a; wVerl = 'Fenster ' + windowS + ' s, Takt ' + T * 1000 + ' ms'; } }
    }
    check('V1', 'Live-Gatter, Fenster 0,15–0,60 s, 20 % ausgefallene Bildschirmbilder (60/120/144 Hz): mindestens 95 % der Rahmen stabil und gewertet', minRaf >= 0.95, 'kleinster Anteil ' + (100 * minRaf).toFixed(0) + ' % (' + wRaf + ')');
    check('V1', 'Live-Gatter, Fenster 0,15–0,60 s, Takt 33/42/50 ms, 20 % ganze Takte verloren: überwiegend stabil und gewertet', minVerl > 0.5, 'kleinster Anteil ' + (100 * minVerl).toFixed(0) + ' % (' + wVerl + ')');
  }

  /* ---------- V2: Bestwerte und Referenzen (analysis.js segments, summarise, computeRefs) ---------- */
  const { A } = H;
  // Ganzer Take wie in app.js: 0,4 s Raumrauschen, Vokal, 0,4 s Raumrauschen, Boden kalibriert.
  // 60 dB Abstand: bei 35–55 dB entsteht an diesen /a/-Takes derzeit kaum ein Segment (ΔF3–4 selten
  // gültig, Rechenkern) — hier geht es um die Zusammenfassung, nicht um den Kern.
  async function takeAus(id, f0, F, gate, snrDb) {
    const v = D.synthVowel(f0, F, BW5, 2.0, SR, { gain: 0.3 });
    let e = 0; for (let i = 0; i < v.length; i++) e += v[i] * v[i];
    const amp = Math.sqrt(e / v.length) * Math.pow(10, -(snrDb || 60) / 20) * Math.sqrt(3);
    const pad = Math.round(0.4 * SR), y = new Float64Array(v.length + 2 * pad), nz = noise(y.length, amp, 9);
    y.set(v, pad); for (let i = 0; i < y.length; i++) y[i] += nz[i];
    const r = await A.analyseTake(y, SR, { floorDb: 20 * Math.log10(amp / Math.sqrt(3)), gate: gate || {} });
    const m = r.meta;   // wie app.js analysisMeta
    return { id, code: id, label: id, createdAt: '2026-10-0' + id.length, summary: r.summary,
      analysis: { kernelVersion: D.VERSION, hopS: m.hopS, windowsS: m.windowsS, orders: m.orders, yinThresh: m.yinThresh, spreadMaxHz: m.spreadMaxHz, gate: m.gate, floorSource: m.floorSource } };
  }

  /* V2a: Grenzvokal /a/–/ɐ/ (Bericht 2, Befund 5). Ein gedecktes /a/, dessen Fenstermediane fast gleich
     weit von /a/ und /ɐ/ liegen, wurde still Bestwert und Referenz für /a/ — mit schmalerem ΔF3–4 als
     ein eindeutiges /a/. 147 Hz; eindeutig 600/1330 mit ΔF3–4 700, Grenze 525/1310 mit ΔF3–4 600. */
  const T_EIN = await takeAus('E', 147, [600, 1330, 2650, 3350, 4200]);
  const T_GRENZ = await takeAus('G', 147, [525, 1310, 2650, 3250, 4200]);
  {
    const s = T_GRENZ.summary, seg = s.segments.filter(x => x.ambiguousShare > 0.5);
    check('V2', 'Grenzvokal /a/–/ɐ/: das Segment trägt seinen Anteil zweideutiger Rahmen (ambiguousShare > 0,5), Vorbedingung',
      s.vowelAmbiguousShare > 0.5 && seg.length >= 1, 'vowelAmbiguousShare ' + s.vowelAmbiguousShare.toFixed(2) + ', Segmente ' + JSON.stringify(s.segments.map(x => x.cls + ':' + x.d34Med.toFixed(0) + '@' + x.ambiguousShare)));
    const pv = seg.length ? s.perVowel[seg[0].cls] : null;
    check('V2', 'Grenzvokal /a/–/ɐ/: zweideutiges Segment wird weder Bestsegment noch Bestwert, bleibt aber gezählt (segmentsAmbiguous)',
      seg.length >= 1 && pv && !pv.bestSegment && pv.segmentsAmbiguous >= 1 && !(s.best && s.best.cls === seg[0].cls), 'best ' + JSON.stringify(s.best) + ', perVowel ' + JSON.stringify(pv));
    const be = T_EIN.summary.perVowel.a && T_EIN.summary.perVowel.a.bestSegment;
    check('V2', 'Eindeutiges /a/: Bestsegment und Bestwert tragen ambiguousShare (≤ 0,5)',
      be && typeof be.ambiguousShare === 'number' && be.ambiguousShare <= 0.5 && T_EIN.summary.best && T_EIN.summary.best.ambiguousShare === be.ambiguousShare, JSON.stringify(be));
    const refs = A.computeRefs([T_GRENZ, T_EIN], {});
    check('V2', 'computeRefs: Referenz /a/ kommt aus dem eindeutigen Take, nicht aus dem schmaleren zweideutigen',
      refs.a && refs.a.takeId === 'E' && Object.keys(refs).every(k => refs[k].takeId === 'E'), JSON.stringify(refs));
  }
  /* V2b: Grenze der Regel an einer konstruierten Rahmenserie. Drei /a/-Läufe zu je 1 s, getrennt durch
     Pausen: genau 50 % zweideutig (zählt noch), 51 % zweideutig (zählt nicht), eindeutig. */
  {
    const n = 3 * 100 + 2 * 20, ser = A.makeSeries(n), ia = V.CLASS_INDEX.a;
    const lauf = [[0, 600, 50], [120, 550, 51], [240, 650, 0]];
    for (let i = 0; i < n; i++) { ser.t[i] = 0.01 * i; ser.gate[i] = 0; ser.cls[i] = -1; ser.score[i] = NaN; ser.flags[i] = 0; }
    for (const [i0, d34, nAmb] of lauf) for (let k = 0; k < 100; k++) {
      const i = i0 + k; ser.gate[i] = 2; ser.cls[i] = ia; ser.score[i] = d34; ser.d34[i] = d34;
      ser.flags[i] = A.FLAG.VOICED | A.FLAG.SCORE | A.FLAG.D34VALID | (k < nAmb ? A.FLAG.VOWELAMBIG : 0);
    }
    const s = A.summarise(ser, { hopS: 0.01, durationS: n * 0.01, floorDb: -90, floorSource: 'calibration', floorKnown: true });
    const sh = s.segments.map(x => x.ambiguousShare), b = s.perVowel.a && s.perVowel.a.bestSegment;
    check('V2', 'Segmente: ambiguousShare je Segment exakt (0,50 / 0,51 / 0); bei 0,51 kein Bestsegment, bei genau 0,50 noch',
      s.segments.length === 3 && Math.abs(sh[0] - 0.5) < 1e-9 && Math.abs(sh[1] - 0.51) < 1e-9 && sh[2] === 0 && b && b.d34Med === 600 && b.ambiguousShare === 0.5 && s.perVowel.a.segmentsAmbiguous === 1 && s.perVowel.a.segments === 3,
      'Anteile ' + sh.join('/') + ', Bestsegment ' + JSON.stringify(b));
  }
  /* V2c: eine gespeicherte oder importierte Zusammenfassung mit zweideutigem Bestsegment wird keine Referenz. */
  {
    const mk = (id, d34, amb) => ({ id, code: id, createdAt: '2026-10-01', summary: { perVowel: { a: { bestSegment: { d34Med: d34, startS: 1, lenS: 1, n: 100, ambiguousShare: amb } } } } });
    const refs = A.computeRefs([mk('X', 560, 0.8), mk('Y', 680, 0.1)], {});
    check('V2', 'computeRefs: Bestsegment mit ambiguousShare 0,8 aus einer gespeicherten Zusammenfassung wird keine Referenz', refs.a && refs.a.takeId === 'Y', JSON.stringify(refs));
  }

  /* V2d–i: angepinnte Referenz, die sich nicht mehr aus ihrem Take auffrischen lässt (Nebenbefund am
     Ende von Bericht 2, Übersicht B12). Vorher wurde aus der angepinnten 640 kommentarlos 910 aus
     einem anderen Take. Jetzt bleibt sie verwaist stehen: mit Grund, ohne d34 (keine Zielmarke). */
  const ohneZiel = r => !!r && r.verwaist === true && r.pinned === true && !isFinite(r.d34) && typeof r.grund === 'string' && r.grund.length > 10;
  {
    const T1 = { id: 'T1', code: 'A', createdAt: '1', summary: { perVowel: { a: { nStable: 0, segments: 0, segmentsAmbiguous: 0, bestSegment: null } } } };
    const T2 = { id: 'T2', code: 'B', createdAt: '2', summary: { perVowel: { a: { bestSegment: { d34Med: 910, startS: 0, lenS: 1, n: 100, ambiguousShare: 0 } } } } };
    const pin = { a: { d34: 640, takeId: 'T1', code: 'A', date: '1', startS: 2, lenS: 1, pinned: true } };
    const r = A.computeRefs([T1, T2], pin);
    check('V2', 'computeRefs: angepinnter Take ohne Bestsegment nach Neu-Analyse → Referenz bleibt verwaist mit Grund, nicht still 910 aus einem anderen Take',
      ohneZiel(r.a) && r.a.d34Zuletzt === 640 && r.a.takeId === 'T1' && /Take A/.test(r.a.grund) && /kein Bestsegment/.test(r.a.grund), JSON.stringify(r.a));
    const rj = JSON.parse(JSON.stringify(r)), r2 = A.computeRefs([T1, T2], rj);
    check('V2', 'Verwaiste Referenz nach JSON-Sicherung und erneuter Berechnung: weiter ohne Zahl (keine Marke bei 0 Hz), letzter Wert erhalten',
      !isFinite(rj.a.d34) && ohneZiel(r2.a) && r2.a.d34Zuletzt === 640, JSON.stringify(rj.a) + ' → ' + JSON.stringify(r2.a));
    const T1neu = { id: 'T1', code: 'A', createdAt: '1', summary: { perVowel: { a: { bestSegment: { d34Med: 700, startS: 1, lenS: 1.5, n: 150, ambiguousShare: 0 } } } } };
    const r3 = A.computeRefs([T1neu, T2], r2);
    check('V2', 'Verwaiste Referenz frischt sich auf, sobald ihr Take wieder ein Bestsegment hat',
      r3.a && r3.a.pinned === true && !r3.a.verwaist && r3.a.d34 === 700 && r3.a.takeId === 'T1', JSON.stringify(r3.a));
    const geloest = JSON.parse(JSON.stringify(r2)); geloest.a.pinned = false;   // wie app.js unpinRef
    const r4 = A.computeRefs([T1, T2], geloest);
    check('V2', 'Gelöste verwaiste Referenz: automatische Referenz aus den übrigen Takes', r4.a && r4.a.pinned === false && !r4.a.verwaist && r4.a.d34 === 910, JSON.stringify(r4.a));
    const r5 = A.computeRefs([T2], pin);
    check('V2', 'computeRefs: Take der angepinnten Referenz gelöscht → verwaist, nicht still durch einen anderen Take ersetzt',
      ohneZiel(r5.a) && /gelöscht/.test(r5.a.grund) && r5.a.code === 'A', JSON.stringify(r5.a));
    const T1amb = { id: 'T1', code: 'A', createdAt: '1', summary: { perVowel: { a: { bestSegment: { d34Med: 600, startS: 1, lenS: 1, n: 100, ambiguousShare: 0.8 } } } } };
    const r6 = A.computeRefs([T1amb, T2], pin);
    check('V2', 'computeRefs: angepinnter Take mit zweideutigem Bestsegment (gespeichert) → verwaist', ohneZiel(r6.a) && /zweideutig/.test(r6.a.grund), JSON.stringify(r6.a));
  }
  {
    // Echte Neu-Analyse: angepinnt war das /a/ eines Takes; die neue Auswertung findet dort nur noch
    // ein zweideutig zugeordnetes Segment (hier: der Grenzvokal unter derselben Id).
    const pin = A.computeRefs([T_EIN], {}); pin.a.pinned = true;
    const neu = Object.assign({}, T_GRENZ, { id: 'E', code: 'E' });
    const r = A.computeRefs([neu], pin);
    check('V2', 'Neu-Analyse ergibt nur ein zweideutiges Segment → angepinnte Referenz verwaist mit diesem Grund',
      ohneZiel(r.a) && /zweideutig/.test(r.a.grund) && isFinite(r.a.d34Zuletzt), JSON.stringify(r.a));
  }

  /* V2j–m: Referenz nur aus Takes gleicher Rechenweise (Bericht 2, Befund 2; Manual: „Vergleiche nur
     bei gleicher Rechenweise“). aktuell wie app.js es übergeben soll: Kern, Regler, Streuungsgrenze,
     Rahmenabstand. Ohne die Prüfung wurde das enge Cluster eines Takes, der mit F3-Regler 2000 lief
     (F3 2250, unterhalb des Sängerformantbands, physik §4), zur Zielmarke. */
  const AKTUELL = { kernelVersion: D.VERSION, gate: { windowS: 0.30, sdF1Max: 50, sdF2Max: 100, minValidShare: 0.80, f3MinHz: 2500 }, spreadMaxHz: 130, hopS: 0.010 };
  const uv = (t, a) => (A.unvergleichbar ? A.unvergleichbar(t, a) : '');
  {
    const L = await takeAus('L', 147, [700, 1200, 2250, 2800, 4200], { f3MinHz: 2000 });
    const N = await takeAus('N', 147, [700, 1200, 2650, 3400, 4200]);
    const bL = L.summary.perVowel.a && L.summary.perVowel.a.bestSegment, bN = N.summary.perVowel.a && N.summary.perVowel.a.bestSegment;
    const r = A.computeRefs([L, N], {}, AKTUELL);
    check('V2', 'computeRefs mit aktuellem Stand (F3 ≥ 2500): das schmalere Cluster eines Takes mit F3-Regler 2000 wird keine Referenz',
      bL && bN && bL.d34Med < bN.d34Med && r.a && r.a.takeId === 'N', 'Bestsegment L ' + (bL ? bL.d34Med.toFixed(0) : '–') + ', N ' + (bN ? bN.d34Med.toFixed(0) : '–') + ' → Referenz ' + JSON.stringify(r.a));
    const pin = A.computeRefs([L], {}); if (pin.a) pin.a.pinned = true;
    const rp = A.computeRefs([L, N], pin, AKTUELL);
    check('V2', 'Angepinnte Referenz aus dem Take mit F3-Regler 2000: verwaist mit benannter Abweichung, nicht still durch N ersetzt',
      !!pin.a && ohneZiel(rp.a) && rp.a.takeId === 'L' && /F3-Mindestwert 2000 statt 2500 Hz/.test(rp.a.grund), JSON.stringify(rp.a));
  }
  {
    // Jede Einstellung, die die Rechenweise trägt, einzeln verstellt — auch strenger als jetzt.
    const mit = (feld, wert) => { const t = JSON.parse(JSON.stringify(T_EIN)); if (feld === 'summaryVersion') delete t.summary.summaryVersion; else if (feld.startsWith('gate.')) t.analysis.gate[feld.slice(5)] = wert; else t.analysis[feld] = wert; return t; };
    const VAR = [['kernelVersion', '0.0.1', /Kern 0\.0\.1 statt/], ['summaryVersion', null, /Fassung 1 statt/], ['hopS', 0.005, /Rahmenabstand 0,005 statt 0,01 s/], ['spreadMaxHz', 250, /Streuung 250 statt 130 Hz/],
      ['gate.f3MinHz', 2700, /F3-Mindestwert 2700 statt 2500 Hz/], ['gate.windowS', 0.15, /Gatter-Fenster 0,15 statt 0,3 s/], ['gate.sdF1Max', 100, /F1-Bewegungsgrenze 100 statt 50 Hz/],
      ['gate.sdF2Max', 60, /F2-Bewegungsgrenze 60 statt 100 Hz/], ['gate.minValidShare', 0.6, /gültiger F1\/F2 0,6 statt 0,8/], ['gate.minFrames', 3, /Mindestzahl Rahmen im Fenster 3 statt 5/]];
    const falsch = [];
    for (const [feld, wert, muster] of VAR) {
      const t = mit(feld, wert), r = A.computeRefs([t], {}, AKTUELL), g = uv(t, AKTUELL);
      if (r.a || !muster.test(g)) falsch.push(feld + ' → ' + (r.a ? 'Referenz ' + r.a.d34.toFixed(0) : 'keine Referenz') + ' / „' + g + '“');
    }
    const basis = A.computeRefs([T_EIN], {}, AKTUELL);
    check('V2', 'Vergleichbarkeit: jede abweichende Einstellung (Kern, Fassung, Rahmenabstand, Streuungsgrenze, sechs Gatterwerte, auch strengere) schließt den Take aus und wird benannt',
      falsch.length === 0 && !!basis.a && uv(T_EIN, AKTUELL) === '', falsch.join(' | ') || 'Grundfall: ' + JSON.stringify(basis.a));
  }
  {
    // Nicht zu streng: nur-live wirksame Gatterwerte, fehlende Angaben in aktuell (wie analyseTake:
    // Vorgabe) und die Darstellung nach einer JSON-Sicherung ändern nichts an der Vergleichbarkeit.
    const t = JSON.parse(JSON.stringify(T_EIN));
    Object.assign(t.analysis.gate, { holdS: 0.3, minFramesLive: 4, frameTolShare: 0.7, frameVibRel: 0.1, refS: 1 });
    const ok = [['nur-live-Werte anders', t, AKTUELL], ['aktuell = {}', T_EIN, {}], ['aktuell nur mit Reglern', T_EIN, { gate: AKTUELL.gate }]];
    const falsch = ok.filter(([, tk, a]) => !A.computeRefs([tk], {}, a).a || uv(tk, a) !== '').map(([nm, tk, a]) => nm + ': „' + uv(tk, a) + '“');
    check('V2', 'Vergleichbarkeit: nur live wirksame Gatterwerte und fehlende Angaben in aktuell (gelten als Vorgabe) schließen nicht aus', falsch.length === 0, falsch.join(' | '));
  }

  /* ---------- V3: Zusammenfassung langer Takes, stabil-Anteil, Rauschboden ohne Stille (analysis.js) ---------- */

  /* V3a: lange Takes (Bericht 2, Befund 7). stats() nahm Minimum und Maximum mit Math.min.apply: jeder
     Wert ein Argument, ab etwa 125 000 Werten RangeError. Das sind 21 min bei 10 ms Raster oder 11 min
     bei 5 ms; app.js speicherte den Take dann nicht. 400 000 Werte = 67 min bei 10 ms.
     Geprüft in einem frischen Node-Prozess wie in einem frisch geladenen Tab: Hier im Prüflauf ist
     stats nach Tausenden Aufrufen optimiert übersetzt, und der optimierte Code stürzt an dieser
     Stelle nicht ab — der Fehler wäre im laufenden Prüflauf unsichtbar. */
  {
    const { spawnSync } = require('child_process'), path = require('path');
    const ANALYSE = path.join(__dirname, '..', '..', 'analysis.js');
    const kalt = code => {
      const r = spawnSync(process.execPath, ['-e', 'const A = require(' + JSON.stringify(ANALYSE) + ');\n' + code], { encoding: 'utf8', timeout: 120000 });
      const z = String(r.stdout || '').trim().split('\n').pop();
      try { return JSON.parse(z); } catch (e) { return { fehler: 'kein Ergebnis: ' + (String(r.stderr || '').split('\n').slice(0, 3).join(' | ') || z) }; }
    };
    const r1 = kalt(`
      const n = 400000, a = new Float64Array(n);
      for (let i = 0; i < n; i++) a[i] = -30 - (i % 977) * 0.05;
      a[123457] = -95.5; a[333333] = -3.25; a[5] = NaN; a[6] = Infinity;
      let out; try { const r = A.stats(a, true); out = { min: r.min, max: r.max, n: r.n }; } catch (e) { out = { fehler: e.constructor.name + ': ' + e.message }; }
      const leer = A.stats([NaN], true); out.leer = [String(leer.min), String(leer.max), leer.n].join('/');
      console.log(JSON.stringify(out));`);
    check('V3', 'stats über 400 000 Werte im frischen Prozess: kein Absturz, Minimum und Maximum exakt, nicht-endliche Werte übergangen',
      !r1.fehler && r1.min === -95.5 && r1.max === -3.25 && r1.n === 399998, r1.fehler || 'min ' + r1.min + ', max ' + r1.max + ', n ' + r1.n);
    check('V3', 'stats ohne endlichen Wert: Minimum und Maximum NaN, n 0', r1.leer === 'NaN/NaN/0', r1.leer || r1.fehler);
    // Derselbe Weg wie analyseTake: summarise über eine Serie mit 400 000 Rahmen (Pegel aller Rahmen
    // gehen in stats(…, true)). Nur jeder hundertste Rahmen stimmhaft, damit der Lauf kurz bleibt.
    const r2 = kalt(`
      const n = 400000, ser = A.makeSeries(n);
      for (let i = 0; i < n; i++) {
        ser.t[i] = 0.01 * i; ser.rms[i] = -40 - (i % 500) * 0.01; ser.gate[i] = 0; ser.cls[i] = -1; ser.score[i] = NaN; ser.flags[i] = 0;
        if (i % 100 === 0) { ser.flags[i] = A.FLAG.VOICED; ser.f0[i] = 147; ser.shr[i] = -20 - (i % 7); }
      }
      ser.rms[250000] = -88.5;
      let out; try { const s = A.summarise(ser, { hopS: 0.01, durationS: n * 0.01, floorDb: -90, floorSource: 'calibration', floorKnown: true }); out = { min: s.rms.min, max: s.rms.max, n: s.nFrames }; } catch (e) { out = { fehler: e.constructor.name + ': ' + e.message }; }
      console.log(JSON.stringify(out));`);
    check('V3', 'Zusammenfassung eines Takes mit 400 000 Rahmen (67 min bei 10 ms, 33 min bei 5 ms) im frischen Prozess: läuft durch, Pegel-Minimum und -Maximum stimmen',
      !r2.fehler && r2.min === Math.fround(-88.5) && r2.max === -40 && r2.n === 400000, r2.fehler || 'rms min ' + r2.min + ', max ' + r2.max);
  }

  /* V3b: stabil-Anteil (Bericht 2, Befund 6). Das Gatter lässt einen stimmlosen Rahmen in einem stabilen
     Fenster als 'stabil' stehen (ohne Wertung). summarise zählte ihn mit und teilte durch die stimmhaften
     Rahmen: bis 103 % „stabil“ in Anzeige und CSV; nStable und die Vokalanteile zählten Rahmen ohne
     Vokal. Definition jetzt: #(stabil ∧ stimmhaft) / #stimmhaft, dieselbe Menge für nStable, Anteile
     und vowelAmbiguousShare. */
  {
    // Konstruierte Serie: /a/ 100 stimmhaft + 40 stimmlos im stabilen Fenster (zweideutig markiert, wie
    // applyGate es aus der Fensterklasse setzt), /o/ 50 stimmhaft, davon 10 zweideutig.
    const ia = V.CLASS_INDEX.a, io = V.CLASS_INDEX.o, n = 190, ser = A.makeSeries(n);
    for (let i = 0; i < n; i++) {
      ser.t[i] = 0.01 * i; ser.rms[i] = -30; ser.score[i] = NaN; ser.gate[i] = 2;
      if (i < 140) { ser.cls[i] = ia; ser.flags[i] = (i % 7 < 2) ? A.FLAG.VOWELAMBIG : A.FLAG.VOICED | A.FLAG.SCORE | A.FLAG.D34VALID; if (ser.flags[i] & A.FLAG.VOICED) { ser.score[i] = 700; ser.d34[i] = 700; } }
      else { ser.cls[i] = io; ser.flags[i] = A.FLAG.VOICED | A.FLAG.SCORE | A.FLAG.D34VALID | (i < 150 ? A.FLAG.VOWELAMBIG : 0); ser.score[i] = 650; ser.d34[i] = 650; }
    }
    const s = A.summarise(ser, { hopS: 0.01, durationS: n * 0.01, floorDb: -90, floorSource: 'calibration', floorKnown: true });
    const nSt = Object.keys(s.perVowel).map(k => k + ':' + s.perVowel[k].nStable).join(' ');
    check('V3', 'stabil-Anteil = stabile UND stimmhafte Rahmen / stimmhafte Rahmen, nie über 1 (konstruierte Serie: 150 stimmhaft stabil, 40 stimmlos im stabilen Fenster)',
      s.stableShare === 1 && s.voicedShare === 150 / 190, 'stableShare ' + s.stableShare + ', voicedShare ' + s.voicedShare.toFixed(3));
    check('V3', 'nStable, Vokalanteile und vowelAmbiguousShare zählen nur stabile stimmhafte Rahmen',
      s.perVowel.a.nStable === 100 && s.perVowel.o.nStable === 50 && Math.abs(s.vowel.shares.a - 100 / 150) < 1e-12 && Math.abs(s.vowel.shares.o - 50 / 150) < 1e-12 &&
      Math.abs(s.vowel.dominantShare - 100 / 150) < 1e-12 && Math.abs(s.vowelAmbiguousShare - 10 / 150) < 1e-12,
      'nStable ' + nSt + ', Anteile ' + JSON.stringify(s.vowel.shares) + ', zweideutig ' + s.vowelAmbiguousShare.toFixed(3));
  }
  {
    // Echter Take: /a/ 98 Hz (tiefe Baritonlage), Vibrato 5,5 Hz ±40 Cent, drei kurze aperiodische
    // Aussetzer von 30 ms (Knarrlaut), Boden kalibriert, 50 dB Abstand. Einzelne stimmlose Rahmen
    // liegen dann in stabilen Fenstern.
    const sig = synth(vib(98, 5.5, 40), () => VOK.a, 2.5, BW5, 50, 21);
    let e = 0; for (let i = 0; i < sig.y.length; i++) e += sig.y[i] * sig.y[i];
    const eff = Math.sqrt(e / sig.y.length), m = Math.round(0.03 * SR);
    for (let k = 0; k < 3; k++) { const nz = noise(m, eff * Math.sqrt(3), 50 + k), i0 = Math.round((0.7 + 0.6 * k) * SR); for (let i = 0; i < m; i++) sig.y[i0 + i] = nz[i]; }
    const r = await A.analyseTake(sig.y, SR, { floorDb: sig.floorDb });
    const ser = r.series, s = r.summary; let st = 0, stv = 0, vo = 0, stvKl = 0;
    for (let i = 0; i < ser.t.length; i++) { const v = ser.flags[i] & A.FLAG.VOICED; if (v) vo++; if (ser.gate[i] === 2) { st++; if (v) { stv++; if (ser.cls[i] >= 0) stvKl++; } } }
    const sumN = Object.keys(s.perVowel).reduce((a, k) => a + s.perVowel[k].nStable, 0);
    check('V3', 'Take /a/ 98 Hz mit drei 30-ms-Aussetzern: stabil-Anteil = #(stabil ∧ stimmhaft) / #stimmhaft, Summe nStable = stabile stimmhafte Rahmen mit Klasse',
      st > stv && vo > 0 && s.stableShare === stv / vo && sumN === stvKl, 'stimmhaft ' + vo + ', stabil ' + st + ' (davon stimmlos ' + (st - stv) + '), stableShare ' + s.stableShare.toFixed(3) + ' (richtig ' + (stv / vo).toFixed(3) + '), Σ nStable ' + sumN);
    // Gleiche Rahmen, andere Zusammenfassung: ein Take aus Fassung 2 ist nicht gleich zusammengefasst.
    const alt = JSON.parse(JSON.stringify(T_EIN)); alt.summary.summaryVersion = 2;
    const g = uv(alt, AKTUELL);
    check('V3', 'Fassung der Zusammenfassung erhöht: ein Take aus Fassung 2 (stimmlose Rahmen als stabil gezählt) ist nicht vergleichbar, Grund benannt',
      A.SUMMARY_VERSION >= 3 && /Fassung 2 statt \d+ \(stimmlose Rahmen zählten als stabil/.test(g) && !A.computeRefs([alt], {}, AKTUELL).a, 'Fassung ' + A.SUMMARY_VERSION + ' — „' + g + '“');
  }

  /* V3c: Rauschboden ohne Stille und ohne Kalibrierung (Bericht 2, Befund 3). Der Boden ist dann
     unbekannt (T24). Früher galt q05 − 12 als Boden; die Stimmhaftigkeit verlangt Pegel > Boden + 12,
     also fielen die leisesten 5 % jedes Takes als Pause heraus, im Decrescendo dessen Ende. Gegenprobe
     ist derselbe Take mit dem echten Boden (wie nach einer Kalibrierung). */
  const { C } = H;
  {
    // Vokal fast ohne eigenes Rauschen (synth mit 300 dB Abstand), Hüllkurve in dB, dann Raumrauschen
    // mit festem Effektivwert dazu. Echter Boden = Pegel des Rauschens nach Wandlung auf 12 kHz.
    const mitBoden = (f0fn, dur, envDb, nzRms, seed) => {
      const v = synth(f0fn, () => VOK.a, dur, BW5, 300, seed).y, nz = noise(v.length, nzRms * Math.sqrt(3), seed + 1);
      for (let i = 0; i < v.length; i++) v[i] = v[i] * Math.pow(10, envDb(i / SR) / 20) + nz[i];
      return { y: v, boden: D.rmsDb(D.resample(nz, SR, TSR)) };
    };
    const FAELLE = [
      ['gehaltenes /a/ 147 Hz, Vibrato ±40 Cent', mitBoden(vib(147, 5.5, 40), 2.5, () => 0, 3e-4, 31)],
      ['Decrescendo 30 dB, /a/ 98 Hz', mitBoden(vib(98, 5.5, 0), 2.5, t => -30 * t / 2.5, 1e-4, 33)],
      ['Ausklang 30 dB in 0,3 s, /a/ 196 Hz', mitBoden(vib(196, 5.5, 0), 2.0, t => (t > 1.7 ? -30 * (t - 1.7) / 0.3 : 0), 1e-4, 35)]
    ];
    const falsch = [], info = [], erg = [];
    for (const [name, sig] of FAELLE) {
      const ru = await A.analyseTake(sig.y, SR, {}), rk = await A.analyseTake(sig.y, SR, { floorDb: sig.boden });
      erg.push({ ru, rk, boden: sig.boden });
      const fu = ru.series.flags, fk = rk.series.flags; let verl = 0, extra = 0, vk = 0, tVerl = '';
      for (let i = 0; i < fk.length; i++) {
        const a = fk[i] & A.FLAG.VOICED, b = fu[i] & A.FLAG.VOICED; if (a) vk++;
        if (a && !b) { verl++; if (!tVerl) tVerl = ' ab t = ' + ru.series.t[i].toFixed(2) + ' s'; } if (!a && b) extra++;
      }
      const su = ru.summary;
      if (verl || extra || su.floorKnown !== false || !Number.isNaN(su.snrDb) || vk === 0) falsch.push(name + ': ' + verl + ' verloren' + tVerl + ', ' + extra + ' zusätzlich, bekannt ' + su.floorKnown + ', SNR ' + su.snrDb);
      info.push(name + ' ' + (vk - verl) + '/' + vk);
    }
    check('V3', 'Ohne Stille und ohne Kalibrierung: gehaltener Vokal, Decrescendo und schneller Ausklang um 30 dB verlieren keinen stimmhaften Rahmen gegenüber dem echten Boden; Boden bleibt unbekannt, SNR NaN',
      falsch.length === 0, falsch.join(' | ') || info.join('; '));

    // Ein unbekannter Boden ist keine Zahl: Anzeige „–“, CSV −99. Die Arbeitsannahme steht getrennt da.
    const { ru, rk, boden } = erg[0], s = ru.summary;
    let minRms = Infinity; for (let i = 0; i < ru.series.rms.length; i++) if (ru.series.rms[i] < minRms) minRms = ru.series.rms[i];
    const L = C.takesToCsv([{ id: 'u', code: 'U', createdAt: '2026-10-07T10:00:00Z', summary: s }], 'standard').split('\n'), kopf = L[0].split(','), zeile = L[1].split(',');
    const feld = k => zeile[kopf.indexOf(k)];
    check('V3', 'Boden unbekannt: summary.floorDb NaN, CSV floor_dbfs −99 mit floor_source unknown; voicingFloorDb trägt die Arbeitsannahme 12 dB unter dem leisesten Rahmen',
      Number.isNaN(s.floorDb) && s.floorSource === 'unknown' && feld('floor_dbfs') === '-99.00' && feld('floor_source') === 'unknown' && isFinite(s.voicingFloorDb) && s.voicingFloorDb + 12 < minRms,
      'floorDb ' + s.floorDb + ', CSV ' + feld('floor_dbfs') + '/' + feld('floor_source') + ', voicingFloorDb ' + (isFinite(s.voicingFloorDb) ? s.voicingFloorDb.toFixed(1) : s.voicingFloorDb) + ', leisester Rahmen ' + minRms.toFixed(1));
    const sk = rk.summary;
    check('V3', 'Boden bekannt (kalibriert): floorDb wie bisher, voicingFloorDb gleich floorDb', sk.floorDb === boden && sk.voicingFloorDb === boden && sk.floorKnown === true, 'floorDb ' + sk.floorDb.toFixed(2) + ', voicingFloorDb ' + sk.voicingFloorDb);
  }
  {
    // Gegenseite: Rauschen ohne Stimme und ohne Stille wird nicht stimmhaft (die Pegelschwelle liegt
    // jetzt unter allem Gemessenen, es entscheidet die Periodizität).
    const farbig = (n, rms, art, seed) => {
      const w = noise(n, 1, seed), y = new Float64Array(n); let z = 0;
      for (let i = 0; i < n; i++) {
        if (art === 'weiß') y[i] = w[i];
        else if (art === 'rosa') { z = 0.877 * z + 0.123 * w[i]; y[i] = 4 * z + 0.15 * w[i]; }
        else if (art === 'braun') { z = 0.998 * z + 0.02 * w[i]; y[i] = z; }
        else y[i] = 0.6 * Math.sin(2 * Math.PI * 50 * i / SR) + 0.35 * Math.sin(2 * Math.PI * 100 * i / SR + 1) + 0.2 * Math.sin(2 * Math.PI * 150 * i / SR + 2) + 0.3 * w[i];
      }
      let e = 0; for (let i = 0; i < n; i++) e += y[i] * y[i]; const g = rms / Math.sqrt(e / n);
      for (let i = 0; i < n; i++) y[i] *= g;
      return y;
    };
    const falsch = [];
    for (const [art, db] of [['weiß', -60], ['weiß', -35], ['rosa', -50], ['braun', -50], ['Netzbrumm 50 Hz mit Rauschen', -45]]) {
      const r = await A.analyseTake(farbig(2 * SR, Math.pow(10, db / 20), art, 41), SR, {}), s = r.summary;
      if (s.voicedShare !== 0 || s.floorKnown !== false || !Number.isNaN(s.snrDb)) falsch.push(art + ' ' + db + ' dBFS: stimmhaft ' + (100 * s.voicedShare).toFixed(1) + ' %, bekannt ' + s.floorKnown + ', SNR ' + s.snrDb);
    }
    check('V3', 'Rauschen ohne Stimme und ohne Stille (weiß −60/−35, rosa, braun, Netzbrumm 50 Hz): kein Rahmen stimmhaft, Boden unbekannt, SNR NaN', falsch.length === 0, falsch.join(' | '));
  }
};

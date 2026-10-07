/* Kriterien der Nachprüfung, Rechenkern.
   A1: zweite Tonhöhenspur (pitchTrackFine) und Sprungerkennung (detectJumps) —
     A1a Oktavkontrolle der Feinspur (F1 ≈ 2·F0), A1b Mischrahmen, 1,5·F0 und Schwelle am legato Tonwechsel,
     A1c Atempause im Raum und mit Brumm, A1d Naht im Signal (digitale Stille, harter Schnitt).
   A2: SHR und Grundton an Rändern, Tonwechseln und bei Hauch (analyseAt: Fensterprobe, Zwischenpegel) —
     A2a Ränder, A2b Tonwechsel, A2c Take mit Melodie, A2d Hauch, A2e Verdopplung bleibt sichtbar,
     A2f stehende Töne ohne Fehlmarke, A2g Vertrag der Felder.
   Testsignale: allgemeine Baritonlage, synthetische Vokale mit bekannter Wahrheit. Zwei Quellen:
   Impulse (wie synthVowel) und Rosenberg-Puls mit Lippenabstrahlung, dazu Jitter, Shimmer und Rauschen.
   Reißt ein Kriterium, ist das ein Befund — Schwelle nicht anheben. */
'use strict';
module.exports = async function (H) {
  const { check, D, SR, TSR, r1 } = H;

  /* ---------- Signale ---------- */
  const VOK = {
    a: [[700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200]],
    e: [[450, 1900, 2550, 3300, 4200], [60, 90, 120, 150, 200]],
    o: [[450, 800, 2500, 3300, 4200], [70, 90, 120, 150, 200]],
    u: [[320, 800, 2400, 3300, 4200], [60, 90, 120, 150, 200]],
    oe: [[500, 1500, 2400, 2900, 4000], [60, 90, 120, 150, 200]],
    i: [[300, 2200, 2900, 3500, 4300], [60, 100, 130, 160, 200]]
  };
  const NAME = { a: '/a/', e: '/e/', o: '/o/', u: '/u/', oe: '/ø/', i: '/i/' };
  const HT = (f, n) => f * Math.pow(2, n / 12);
  function zufall(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  /* Stimmquelle mit F0-Verlauf fz(t), stetiger Phase und durchlaufenden Resonatoren (legato).
     art 'impuls': Impulse auf Bruchteile von Abtastwerten gesetzt; 'rosenberg': Rosenberg-Puls (Öffnung
     40 %, Schluss 16 %), abgeleitet (Lippenabstrahlung). jit/shim: relative Streuung je Periode. */
  function stimme(fz, dur, v, o) {
    o = o || {};
    const n = Math.round(dur * SR), src = new Float64Array(n), rnd = zufall(o.seed || 7), jit = o.jit || 0, shim = o.shim || 0;
    let t0 = 0;
    if (o.art === 'rosenberg') {
      const g = new Float64Array(n + 1);
      while (t0 < dur) {
        const T = (1 / fz(t0)) * (1 + jit * (2 * rnd() - 1)), A = 1 + shim * (2 * rnd() - 1), To = 0.4 * T, Tc = 0.16 * T;
        const i0 = Math.ceil(t0 * SR), i1 = Math.min(n, Math.floor((t0 + T) * SR));
        for (let i = i0; i < i1; i++) { const tt = i / SR - t0; g[i] = A * (tt < To ? 0.5 * (1 - Math.cos(Math.PI * tt / To)) : (tt < To + Tc ? Math.cos(Math.PI / 2 * (tt - To) / Tc) : 0)); }
        t0 += T;
      }
      for (let i = 0; i < n; i++) src[i] = g[i + 1] - g[i];
    } else {
      while (t0 * SR < n) {
        const pos = t0 * SR, i0 = Math.floor(pos), q = pos - i0, A = 1 + shim * (2 * rnd() - 1);
        for (let j = 0; j < 6; j++) { const w = A * Math.cos(Math.PI * j / 12); if (i0 + j < n) src[i0 + j] += w * (1 - q); if (i0 + j + 1 < n) src[i0 + j + 1] += w * q; }
        t0 += (1 / fz(t0)) * (1 + jit * (2 * rnd() - 1));
      }
    }
    let y = src; const [F, B] = VOK[v];
    for (let m = 0; m < F.length; m++) y = D.resonate(y, F[m], B[m], SR);
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i]));
    for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / mx;
    return y;
  }
  // Gaußsches Rauschen im Abstand snr dB unter dem Effektivwert des Signals
  function mitRauschen(x, snr, seed) {
    const rnd = zufall(seed); let p = 0; for (let i = 0; i < x.length; i++) p += x[i] * x[i];
    const a = Math.sqrt(p / x.length) * Math.pow(10, -snr / 20), y = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) { let u = 0; for (let k = 0; k < 12; k++) u += rnd(); y[i] = x[i] + a * (u - 6); }
    return y;
  }
  const vibrato = (fz, rate, cent, ph) => t => fz(t) * Math.pow(2, cent / 1200 * Math.sin(2 * Math.PI * rate * t + (ph || 0)));
  // Töne fs je d Sekunden, Kosinus-Gleiten gl Sekunden zwischen den Tönen
  const stufen = (fs, d, gl) => t => {
    const k = Math.min(fs.length - 1, Math.floor(t / d)), tt = t - k * d;
    if (k > 0 && gl > 0 && tt < gl) { const a = fs[k - 1], b = fs[k], w = 0.5 - 0.5 * Math.cos(Math.PI * tt / gl); return a * Math.pow(b / a, w); }
    return fs[k];
  };
  // wirklichkeitsnah: Jitter 1 %, Shimmer 2 %, Rauschen 40 dB
  const real = (fz, dur, v, art, seed) => mitRauschen(stimme(fz, dur, v, { art, jit: 0.01, shim: 0.02, seed }), 40, seed + 1000);
  const spur = sig => D.pitchTrackFine(D.resample(sig, SR, TSR), TSR, {});
  const ereig = sig => D.detectJumps(spur(sig), {});
  const kurz = e => e.length + (e.length ? ' [' + e.slice(0, 3).map(x => x.art + ' ' + Math.round(x.dauerS * 1000) + 'ms ' + r1(x.halbtoene) + 'HT@' + x.startS.toFixed(2)).join(', ') + (e.length > 3 ? ', …' : '') + ']' : '');
  function sammle(faelle) {
    let ok = 0; const bad = [];
    for (const f of faelle) { const e = ereig(f.sig); if (f.soll(e)) ok++; else bad.push(f.name + ': ' + kurz(e)); }
    return { ok, n: faelle.length, detail: ok + '/' + faelle.length + (bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : '') };
  }
  const keins = e => e.length === 0;
  let saat = 100;

  /* ---------- A1a: Oktavkontrolle der Feinspur ----------
     Liegt F1 nahe 2·F0, ist der zweite Teilton der stärkste, und YIN nimmt die halbe Periode: Die
     Feinspur stand im ganzen Ton eine Oktave zu hoch. Ein legato Ganztonschritt erschien als
     gehaltener Sprung von +14 HT, ein echter Kiekser in die Oktave blieb unsichtbar, weil die Spur schon
     dort stand. Betroffen ist die Mittellage des Baritons: /e/ /o/ /ø/ um 200–270 Hz, /a/ um 350 Hz. */
  {
    // Stehende Töne mit F1 ≈ 2·F0 (F0 = F1/2 · 2^(−1…+1 HT)): Anteil Rahmen innerhalb ±1 HT des Grundtons
    let schlecht = 1, schlechtName = '', n = 0;
    for (const v of ['e', 'o', 'oe', 'a', 'u']) for (const d of [-1, 0, 1]) for (const art of ['impuls', 'rosenberg']) {
      const f = HT(VOK[v][0][0] / 2, d), tr = spur(real(() => f, 0.5, v, art, saat++));
      let z = 0, m = 0;
      for (let k = 0; k < tr.t.length; k++) { if (tr.t[k] < 0.05 || tr.t[k] > 0.45) continue; m++; if (isFinite(tr.f0[k]) && Math.abs(12 * Math.log2(tr.f0[k] / f)) < 1) z++; }
      n++;
      if (z / m <= schlecht) { schlecht = z / m; schlechtName = NAME[v] + ' ' + Math.round(f) + ' Hz ' + art; }
    }
    check('A1a', 'Feinspur bei F1 ≈ 2·F0 (/e/ /o/ /ø/ /a/ /u/, Impuls und Rosenberg, Jitter 1 %, 40 dB): mindestens 95 % der Rahmen auf dem Grundton (±1 HT)',
      schlecht >= 0.95, n + ' Töne, schlechtester ' + schlechtName + ' ' + (100 * schlecht).toFixed(0) + ' %');
    // Legato-Ganztonschritte, Hauptspur und Feinspur müssen denselben Ton sehen: kein gehaltenes Ereignis
    const faelle = [];
    for (const [v, a, b] of [['e', 196, 220], ['e', 220, 247], ['oe', 207, 233], ['oe', 233, 262], ['o', 208, 233], ['a', 330, 370]]) for (const art of ['impuls', 'rosenberg'])
      faelle.push({ name: NAME[v] + ' ' + a + '→' + b + '→' + a + ' ' + art, sig: real(stufen([a, b, a], 0.4, 0.02), 1.2, v, art, saat++), soll: e => !e.some(x => x.art === 'gehalten') });
    let r = sammle(faelle);
    check('A1a', 'legato Ganzton auf /e/ /ø/ /o/ /a/ mit F1 ≈ 2·F0, je 0,4 s: kein gehaltener Sprung', r.ok === r.n, r.detail);
    // Kiekser 50 ms in die Oktave, auch dort, wo F1 auf dem zweiten Teilton liegt: genau eine Kante +12 ± 1 HT
    const kiek = [];
    for (const [a, v] of [[98, 'e'], [196, 'e'], [220, 'e'], [350, 'a']]) for (const art of ['impuls', 'rosenberg']) for (const vib of [0, 50]) {
      const fz0 = t => (t >= 0.6 && t < 0.65) ? 2 * a : a;
      kiek.push({ name: a + '→' + 2 * a + ' ' + NAME[v] + ' ' + art + (vib ? ' Vibrato' : ''), sig: real(vib ? vibrato(fz0, 6, vib, 1) : fz0, 1.2, v, art, saat++),
        soll: e => e.length === 1 && e[0].art === 'kante' && Math.abs(e[0].halbtoene - 12) <= 1 });
    }
    r = sammle(kiek);
    check('A1a', 'Kiekser 50 ms 98→196, 196→392, 220→440 auf /e/ und 350→700 auf /a/ (Impuls, Rosenberg, mit Vibrato): genau eine Kante +12 ± 1 HT', r.ok === r.n, r.detail);
    // Gehaltener Bruch +11/+14/+16 HT, 300 ms, auch auf /e/: gehalten, Weite ±1 HT
    const geh = [];
    for (const a of [98, 147, 196, 220]) for (const ht of [11, 14, 16]) for (const v of ['e', 'o']) {
      const fz = t => (t >= 0.6 && t < 0.9) ? HT(a, ht) : a;
      geh.push({ name: a + '+' + ht + ' ' + NAME[v], sig: real(fz, 1.4, v, 'rosenberg', saat++),
        soll: e => e.length === 1 && e[0].art === 'gehalten' && e[0].richtung === 'auf' && Math.abs(e[0].halbtoene - ht) <= 1 });
    }
    r = sammle(geh);
    check('A1a', 'gehaltener Bruch +11/+14/+16 HT, 300 ms, aus 98–220 Hz auf /e/ und /o/: ein gehaltenes Ereignis, Weite ±1 HT', r.ok === r.n, r.detail);
  }

  /* ---------- A1b: legato Tonwechsel ohne Restkante ----------
     Am Übergang enthält das 35-ms-Fenster beide Töne; YIN liefert dort oft die Oktave darüber oder
     darunter oder den gemeinsamen Unterton. Ohne Gegenmaßnahme blieb an fast jedem Tonwechsel eine
     Kante von ±11–13 HT über 10–30 ms. Dazu ragt ein Schritt knapp unter 5 HT mit Vibrato in jedem
     Zyklus über die Schwelle. Legato-Melodien mit Schritten bis 4 HT, um F1/2 und tiefer (dort liegt
     F1 bei /ø/ nahe 3·F0), mit und ohne Vibrato 6 Hz ±50 Cent: kein Ereignis. Schritte genau an der
     Schwelle (4,98 HT) prüft kein Kriterium: Dort entscheidet die Messgenauigkeit. */
  {
    const schritte = [0, 2, 4, 2, 0, -3, -1, 1, -2, 0, 3, -1, 0];
    const faelle = [];
    for (const v of ['a', 'e', 'o', 'u', 'oe', 'i']) for (const art of ['impuls', 'rosenberg']) for (const vib of [0, 50]) {
      for (const c of [VOK[v][0][0] / 2, 150]) {
        const fz0 = stufen(schritte.map(s => HT(c, s)), 0.35, 0.02);
        faelle.push({ name: NAME[v] + ' um ' + Math.round(c) + ' Hz ' + art + (vib ? ' Vibrato' : ''), sig: real(vib ? vibrato(fz0, 6, vib, 0.2) : fz0, 0.35 * schritte.length, v, art, saat++), soll: keins });
      }
    }
    for (const v of ['a', 'e', 'o']) for (const art of ['impuls', 'rosenberg'])
      faelle.push({ name: 'Ganzton 150→168 ' + NAME[v] + ' ' + art, sig: real(stufen([150, 168, 150, 168], 0.35, 0.02), 1.4, v, art, saat++), soll: keins });
    // Melodie der Mittellage ohne Gleiten, Schritte bis 3 HT (bei /ø/ liegt F1 um 165 Hz nahe 3·F0)
    const mittel = [131, 147, 165, 196, 165, 147, 131, 147, 165];
    for (const v of ['a', 'e', 'o', 'u', 'oe', 'i']) for (const art of ['impuls', 'rosenberg']) for (const vib of [0, 50]) {
      const fz0 = stufen(mittel, 0.4, 0);
      faelle.push({ name: 'Mittellage ' + NAME[v] + ' ' + art + (vib ? ' Vibrato' : ''), sig: real(vib ? vibrato(fz0, 6, vib, 0.3) : fz0, 0.4 * mittel.length, v, art, saat++), soll: keins });
    }
    const r = sammle(faelle);
    check('A1b', 'legato Melodien, Schritte 2–4 HT, sechs Vokale um F1/2, um 150 Hz und in der Mittellage, Impuls und Rosenberg, mit und ohne Vibrato: kein Ereignis', r.ok === r.n, r.detail);
    // F1 ≈ 3·F0: YIN nimmt dort auch 2/3 der Periode (Rahmen auf 1,5·F0)
    let schlecht = 1, schlechtName = '';
    for (const d of [-1, -0.5, 0, 0.5, 1]) for (const vib of [0, 50]) {
      const f = HT(VOK.oe[0][0] / 3, d), fz = vib ? vibrato(() => f, 6, vib, 0.4) : () => f, tr = spur(real(fz, 0.5, 'oe', 'impuls', saat++));
      let z = 0, m = 0;
      for (let k = 0; k < tr.t.length; k++) { if (tr.t[k] < 0.05 || tr.t[k] > 0.45) continue; m++; if (isFinite(tr.f0[k]) && Math.abs(12 * Math.log2(tr.f0[k] / fz(tr.t[k]))) < 1) z++; }
      if (z / m <= schlecht) { schlecht = z / m; schlechtName = Math.round(f) + ' Hz' + (vib ? ' Vibrato' : ''); }
    }
    check('A1b', 'Feinspur bei F1 ≈ 3·F0 (/ø/ 155–175 Hz, Impulsquelle, mit und ohne Vibrato): mindestens 95 % der Rahmen auf dem Grundton (±1 HT)',
      schlecht >= 0.95, 'schlechtester ' + schlechtName + ' ' + (100 * schlecht).toFixed(0) + ' %');
    // Gegenprobe: Ein Kiekser in die Oktave des neuen Tons genau beim Ankommen ist kein Mischwert
    const wechsel = [];
    for (const [a, st] of [[196, 2], [165, 3], [220, -4], [131, 2]]) for (const v of ['a', 'i']) for (const art of ['impuls', 'rosenberg']) for (const vib of [0, 50]) {
      const b = HT(a, st), fz0 = t => t < 0.6 ? a : (t < 0.65 ? 2 * b : b);
      wechsel.push({ name: a + '→' + Math.round(2 * b) + '→' + Math.round(b) + ' ' + NAME[v] + ' ' + art + (vib ? ' Vibrato' : ''), sig: real(vib ? vibrato(fz0, 6, vib, 0.2) : fz0, 1.2, v, art, saat++),
        soll: e => e.length === 1 && e[0].art === 'kante' && Math.abs(e[0].halbtoene - (12 + st)) <= 1.5 });
    }
    let rw = sammle(wechsel);
    check('A1b', 'Kiekser 50 ms in die Oktave des neuen Tons genau am legato Tonwechsel (±2–4 HT): genau eine Kante, Weite ±1,5 HT', rw.ok === rw.n, rw.detail);
    // Gegenprobe: kurze Ausflüge (+7/+12/+16 HT, 50 ms) mitten in einem Ton mit Vibrato bleiben Kanten
    const ausflug = [];
    for (const a of [110, 196]) for (const ht of [7, 12, 16]) for (const v of ['a', 'i']) for (const ph of [0, 2]) {
      const fz = vibrato(t => (t >= 0.6 && t < 0.65) ? HT(a, ht) : a, 6, 50, ph);
      ausflug.push({ name: a + '+' + ht + ' ' + NAME[v] + ' Phase ' + ph, sig: real(fz, 1.2, v, 'rosenberg', saat++), soll: e => e.length === 1 && e[0].art === 'kante' && Math.abs(e[0].halbtoene - ht) <= 1.5 });
    }
    rw = sammle(ausflug);
    check('A1b', 'Ausflug 50 ms (+7/+12/+16 HT) mitten in einem Ton mit Vibrato 6 Hz ±50 Cent: genau eine Kante, Weite ±1,5 HT', rw.ok === rw.n, rw.detail);
    // Schritte 4,7 und 4,8 HT mit Vibrato ±50 Cent: Der Ton bleibt unter 5 HT, nur die Spitzen des Vibratos nicht
    const nah = [];
    for (const ht of [4.7, 4.8]) for (const v of ['a', 'o', 'i']) for (const a of [110, 147, 196]) {
      const fz = vibrato(stufen([a, HT(a, ht), a, HT(a, -ht), a], 0.5, 0.03), 6, 50, 0.5);
      nah.push({ name: ht + ' HT ab ' + a + ' ' + NAME[v], sig: real(fz, 2.5, v, 'rosenberg', saat++), soll: keins });
    }
    const r2 = sammle(nah);
    check('A1b', 'legato Schritte 4,7 und 4,8 HT mit Vibrato ±50 Cent: kein Ereignis (gemessen wird die Lage des Tons, nicht die Vibratospitzen)', r2.ok === r2.n, r2.detail);
  }
  /* ---------- A1c: Atempause im Raum, Brumm ----------
     Nachhall setzt den alten Ton in der Atempause periodisch fort, Brumm über 70 Hz ebenso. Ohne
     Pegel überdauerte der Bezug die Pause, und die neue Phrase zählte als gehaltener Sprung (Befund
     N4). Raum: Direktschall plus exponentiell abklingendes Rauschen (RT60), Verhältnis direkt zu
     Nachhall DRR. Stimme um −19 dBFS, Raumrauschen 45 dB darunter. */
  {
    function raumantwort(rt60, drr, seed) {
      const L = Math.round(Math.min(2, 1.4 * rt60) * SR), h = new Float64Array(L), rnd = zufall(seed), d0 = Math.round(0.003 * SR);
      let e = 0;
      for (let i = d0; i < L; i++) { let u = 0; for (let k = 0; k < 12; k++) u += rnd(); h[i] = (u - 6) * Math.pow(10, -3 * (i - d0) / SR / rt60); e += h[i] * h[i]; }
      const g = Math.sqrt(Math.pow(10, -drr / 10) / e); for (let i = 0; i < L; i++) h[i] *= g; h[0] = 1; return h;
    }
    function falte(x, h) {   // Overlap-Add über die FFT des Kerns
      const N = D.nextPow2(2 * h.length), B = N - h.length + 1, y = new Float64Array(x.length + N);
      const hr = new Float64Array(N), hi = new Float64Array(N); hr.set(h); D.fft(hr, hi);
      for (let s0 = 0; s0 < x.length; s0 += B) {
        const re = new Float64Array(N), im = new Float64Array(N);
        for (let i = s0; i < Math.min(x.length, s0 + B); i++) re[i - s0] = x[i];
        D.fft(re, im);
        for (let k = 0; k < N; k++) { const a = re[k] * hr[k] - im[k] * hi[k], b = re[k] * hi[k] + im[k] * hr[k]; re[k] = a; im[k] = -b; }
        D.fft(re, im);
        for (let i = 0; i < N; i++) y[s0 + i] += re[i] / N;
      }
      return y.subarray(0, x.length);
    }
    function phrase(f, dur, v, seed, ansatzS) {
      const y = stimme(() => f, dur, v, { art: 'rosenberg', jit: 0.005, shim: 0.02, seed });
      const a = Math.round((ansatzS || 0.03) * SR), b = Math.round(0.06 * SR), n = y.length;
      for (let i = 0; i < n; i++) { let e = 1; if (i < a) e = i / a; if (n - i < b) e = Math.min(e, (n - i) / b); y[i] *= e; }
      return y;
    }
    const still = s => new Float64Array(Math.round(s * SR));
    function zweiPhrasen(f1, f2, pause, o) {
      const x = H.concat([still(0.3), phrase(f1, 1, o.v || 'a', 3, o.ansatz), still(pause), phrase(f2, 1, o.v || 'a', 9, o.ansatz), still(0.4)]);
      const y = o.rt ? falte(x, raumantwort(o.rt, o.drr, o.seed || 5)) : x;
      let e = 0; const a0 = Math.round(0.4 * SR), a1 = Math.round(1.2 * SR); for (let i = a0; i < a1; i++) e += y[i] * y[i];
      const g = Math.pow(10, -19 / 20) / Math.sqrt(e / (a1 - a0)), rnd = zufall(o.seed + 77 || 77), z = new Float64Array(y.length), nz = Math.pow(10, (-19 - 45) / 20);
      for (let i = 0; i < y.length; i++) { let u = 0; for (let k = 0; k < 12; k++) u += rnd(); z[i] = g * y[i] + nz * (u - 6); }
      if (o.brumm) {
        const [fb, db] = o.brumm; let eb = 0; const b = new Float64Array(z.length);
        for (let i = 0; i < z.length; i++) { let v = 0; for (let k = 1; k <= 8; k++) v += Math.sin(2 * Math.PI * k * fb * i / SR + k) / k; b[i] = v; eb += v * v; }
        const gb = Math.pow(10, db / 20) / Math.sqrt(eb / z.length); for (let i = 0; i < z.length; i++) z[i] += gb * b[i];
      }
      return z;
    }
    const paare = [[196, 294], [220, 147], [165, 247], [262, 175]];
    const raum = [], raumMild = [];
    // Pause 0,2 s bei RT60 0,8 s prüft dieses Kriterium nicht: dort reicht die Tiefe des Nachhalls nicht
    // sicher, siehe pauseTiefDb in dsp.js (offen).
    for (const [rt, drr] of [[0.3, 6], [0.4, 15], [0.5, 3], [0.8, 0], [0.8, 6]]) for (const p of [0.2, 0.3, 0.5]) if (p >= 0.3 || rt <= 0.5) paare.forEach(([a, b], k) => {
      const f = { name: 'RT60 ' + rt + ' DRR ' + drr + ' Pause ' + p + ' ' + a + '→' + b, sig: zweiPhrasen(a, b, p, { rt, drr, seed: 5 + k }) };
      raum.push(Object.assign({ soll: e => !e.some(x => x.art === 'gehalten') }, f));
      if (rt <= 0.6) raumMild.push(Object.assign({ soll: keins }, f));
    });
    let r = sammle(raum);
    check('A1c', 'Atempause 0,3/0,5 s im Raum (RT60 0,3–0,8 s, DRR 0–15 dB), 0,2 s bis RT60 0,5 s, neue Phrase auf anderem Ton: kein gehaltenes Ereignis', r.ok === r.n, r.detail);
    r = sammle(raumMild);
    check('A1c', 'dieselbe Atempause bei RT60 0,3–0,5 s: gar kein Ereignis (auch keine Kante im Ausklang)', r.ok === r.n, r.detail);
    // Brumm: Netz 50 Hz, Gleichrichter 100 Hz, 120 Hz, je mit Obertönen, im Vorlauf und in der Pause
    const brumm = [];
    for (const [fb, db] of [[50, -50], [100, -50], [100, -60], [100, -70], [120, -60]]) for (const p of [0.25, 0.8]) for (const gleich of [false, true]) for (const ans of [0.03, 0.2])
      paare.slice(ans > 0.1 ? 1 : 0, ans > 0.1 ? 2 : 1).forEach(([a, b], k) => brumm.push({ name: fb + ' Hz ' + db + ' dBFS Pause ' + p + (gleich ? ' gleicher Ton' : '') + ' Einsatz ' + ans * 1000 + ' ms ' + a, sig: zweiPhrasen(a, gleich ? a : b, p, { brumm: [fb, db], ansatz: ans, seed: 11 + k }), soll: keins }));
    r = sammle(brumm);
    check('A1c', 'Brumm 50/100/120 Hz mit Obertönen, −50 bis −70 dBFS (Stimme −19 dBFS), Vorlauf und Atempause 0,25/0,8 s, Einsatz 30/200 ms: kein Ereignis', r.ok === r.n, r.detail);
    // Ende zu Ende: Take im Raum durch analyseTake, Kalibrierboden gesetzt
    {
      const sig = zweiPhrasen(165, 247, 0.3, { rt: 0.4, drr: 6, seed: 21 });
      const res = await H.A.analyseTake(Float32Array.from(sig), SR, { floorDb: -64, yieldMs: 0 });
      const sp = res.summary.spruenge;
      check('A1c', 'Take im Raum (RT60 0,4 s, DRR 6 dB, Pause 0,3 s) durch analyseTake: gehalten 0, λ_gehalten 0', sp.gehalten === 0 && sp.lambdaGehalten === 0, 'gehalten ' + sp.gehalten + ', Kanten ' + sp.kante + ', λ_gehalten ' + sp.lambdaGehalten);
    }
    // Gegenproben: Pegel allein ist keine Pause
    const env = (y, g) => { const z = new Float64Array(y.length); for (let i = 0; i < y.length; i++) z[i] = y[i] * g(i / SR); return z; };
    const db = x => Math.pow(10, x / 20);
    const ton = (fz, dur, v, seed) => stimme(fz, dur, v, { art: 'rosenberg', jit: 0.01, shim: 0.02, seed });
    const rausch60 = s => { const rnd = zufall(5), y = new Float64Array(Math.round(s * SR)); for (let i = 0; i < y.length; i++) y[i] = 0.001 * (2 * rnd() - 1); return y; };
    const gegen = [];
    for (const a of [147, 196]) for (const dec of [6, 10, 14]) for (const gap of [0.04, 0.08]) for (const v of ['a', 'i'])
      gegen.push({ name: 'Decrescendo −' + dec + ' dB, Lücke ' + gap * 1000 + ' ms, ' + a + '+7 ' + NAME[v],
        sig: mitRauschen(H.concat([env(ton(() => a, 0.8, v, saat++), t => t < 0.6 ? 1 : db(-dec * Math.min(1, (t - 0.6) / 0.15))), rausch60(gap), ton(() => HT(a, 7), 0.5, v, saat++)]), 40, saat++),
        soll: e => e.length === 1 && e[0].art === 'gehalten' && Math.abs(e[0].halbtoene - 7) <= 1 });
    for (const a of [110, 196, 294]) for (const v of ['a', 'i']) {
      gegen.push({ name: 'Messa di voce ' + a + ' ' + NAME[v], sig: mitRauschen(env(ton(() => a, 2, v, saat++), t => db(-20 + 20 * Math.sin(Math.PI * t / 2))), 40, saat++), soll: keins });
      gegen.push({ name: 'Tremolo ±4 dB ' + a + ' ' + NAME[v], sig: mitRauschen(env(ton(() => a, 2, v, saat++), t => db(4 * Math.sin(2 * Math.PI * 5 * t))), 40, saat++), soll: keins });
      gegen.push({ name: 'Subito piano −15 dB ' + a + ' ' + NAME[v], sig: mitRauschen(env(ton(() => a, 2, v, saat++), t => t < 1 ? 1 : db(-15)), 40, saat++), soll: keins });
    }
    for (const a of [147, 196]) for (const pg of [-15, -25]) for (const v of ['a', 'o']) {
      const leise = env(ton(t => (t > 0.4 && t < 0.7) ? HT(a, 7) : ((t > 0.9 && t < 0.95) ? 2 * a : a), 1.4, v, saat++), () => db(pg));
      gegen.push({ name: 'leise Phrase ' + pg + ' dB nach lauter ' + a + ' ' + NAME[v], sig: mitRauschen(H.concat([ton(() => a, 1, v, saat++), still(0.4), leise]), 40, saat++),
        soll: e => e.length === 2 && e[0].art === 'gehalten' && Math.abs(e[0].halbtoene - 7) <= 1 && e[1].art === 'kante' && Math.abs(e[1].halbtoene - 12) <= 1 });
    }
    r = sammle(gegen);
    check('A1c', 'Gegenprobe Pegel: Decrescendo bis 14 dB vor Konsonantenlücke mit Sprung danach, Messa di voce, Tremolo, Subito piano, leise Phrase nach lauter: richtig gezählt', r.ok === r.n, r.detail);
  }
  /* ---------- A1d: Naht im Signal ----------
     Ein Aussetzer des Geräts liefert entweder digitale Stille (exakte Nullen) oder setzt das Signal ohne
     die fehlenden Abtastwerte zusammen (harter Sprung). Mitten in einem Ton darf beides keinen Sprung
     erzeugen; 100 ms Nullen zwischen zwei Tönen trennen wie eine Atempause (bisher gehaltener Sprung).
     Eine Naht zwischen zwei verschiedenen Tönen ohne Nullen sieht aus wie ein legato Sprung; deren
     Stellen kennt nur die Aufnahme (analysis.js). */
  {
    const nullen = (x, ab, dauer) => { const y = Float64Array.from(x); for (let i = Math.round(ab * SR); i < Math.round((ab + dauer) * SR) && i < y.length; i++) y[i] = 0; return y; };
    const schnitt = (x, ab, dauer) => H.concat([x.subarray(0, Math.round(ab * SR)), x.subarray(Math.round((ab + dauer) * SR))]);
    const keinGehalten = e => !e.some(x => x.art === 'gehalten');
    const mitte = [], zwischen = [];
    for (const f of [98, 165, 262]) for (const v of ['a', 'i']) for (const vib of [0, 50]) {
      const t = real(vib ? vibrato(() => f, 6, vib, 0.3) : () => f, 3, v, 'rosenberg', saat++);
      for (const d of [0.05, 0.1, 0.2]) mitte.push({ name: 'Nullen ' + d * 1000 + ' ms in ' + f + ' ' + NAME[v] + (vib ? ' Vibrato' : ''), sig: nullen(t, 1.2, d), soll: keinGehalten });
      mitte.push({ name: 'Schnitt in ' + f + ' ' + NAME[v] + (vib ? ' Vibrato' : ''), sig: schnitt(t, 1.07, 1.0137), soll: keinGehalten });
    }
    let r = sammle(mitte);
    check('A1d', 'Naht mitten im Ton (Nullen 50–200 ms oder harter Schnitt, 98–262 Hz, mit Vibrato): kein gehaltenes Ereignis', r.ok === r.n, r.detail);
    for (const [a, ht] of [[220, -7], [196, 7], [147, 12], [262, -5]]) for (const v of ['a', 'o']) for (const d of [0.09, 0.1, 0.15])
      zwischen.push({ name: a + (ht > 0 ? '+' : '') + ht + ' ' + NAME[v] + ' Nullen ' + d * 1000 + ' ms', sig: H.concat([real(() => a, 1.5, v, 'rosenberg', saat++), new Float64Array(Math.round(d * SR)), real(() => HT(a, ht), 1.5, v, 'rosenberg', saat++)]), soll: keins });
    r = sammle(zwischen);
    check('A1d', 'digitale Stille 90–150 ms zwischen zwei Tönen (±5…12 HT): kein Ereignis, die Nullen trennen wie eine Atempause', r.ok === r.n, r.detail);
  }

  /* ---------- A2: SHR und Grundton an Rändern, Tonwechseln und bei Hauch ----------
     SHR und die Gegenprobe des Grundtons rechnen auf dem Spektrum des längsten Fensters (0,14 s). Eine
     Pegelkante (Einsatz, Aussatz, Pause) oder ein zweiter Ton im Fenster legt Energie auf die halbzahligen
     Linien, ohne dass eine Subharmonische im Signal ist; bei Quarte und Quinte nimmt der Grundton den
     gemeinsamen Unterton an. Hauch (Rauschen in der Anregung) tut dasselbe mitten im Ton. Vorher galten
     alle diese Werte als sicher: SHR bis −8 dB an Kanten, bis 0 dB an Tonwechseln, bis −9 dB bei Hauch,
     Gold „über der Warnschwelle“ in der Zusammenfassung. Jetzt trägt der Rahmen shrUnsure mit eigenem
     Grund ('rand', 'wechsel', 'rauschen'), ein Mischwert des Grundtons f0Unsure ('wechsel').
     A2a Ränder, A2b Tonwechsel, A2c Take mit legato Melodie, A2d Hauch, A2e echte Verdopplung bleibt
     sichtbar, A2f stehende Töne ohne Fehlmarke, A2g Vertrag der Felder. */
  {
    const { TSR: T12, A } = H;
    let s2 = 20000;   // eigene Saat je Abschnitt: unabhängig davon, wie viele Signale A1 und die Abschnitte davor erzeugen
    const r1_ = v => isFinite(v) ? v.toFixed(1) : '--';
    const lcg2 = seed => { let z = seed >>> 0 || 1; return () => { z = (z * 1664525 + 1013904223) >>> 0; return z / 4294967296; }; };
    const gauss = rnd => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
    const effW = (x, a, b) => { a = a || 0; b = b == null ? x.length : b; let p = 0; for (let i = a; i < b; i++) p += x[i] * x[i]; return Math.sqrt(p / Math.max(1, b - a)); };
    /* Rosenberg-Quelle mit F0-Verlauf, Jitter/Shimmer, wahlweise Wechsel der Zyklen (altAmp: jeder zweite
       schwächer, altPer: Perioden T(1 ± a/2)) und Hauch mit exaktem HNR: periodischer Teil und
       flussmoduliertes Rauschen laufen getrennt durch denselben Trakt und werden gegeneinander skaliert. */
    function quelle(o, v) {
      const n = Math.round(o.dur * SR), rnd = lcg2(o.seed || 7), fz = typeof o.f0 === 'function' ? o.f0 : () => o.f0;
      const flow = new Float64Array(n + 1), src = new Float64Array(n);
      let t0 = 0, k = 0;
      while (t0 < o.dur) {
        let T = 1 / fz(t0);
        if (o.altPer) T *= (k % 2 ? 1 - o.altPer / 2 : 1 + o.altPer / 2);
        T *= 1 + (o.jit || 0) * (2 * rnd() - 1);
        let amp = 1 + (o.shim || 0) * (2 * rnd() - 1);
        if (o.altAmp && k % 2) amp *= 1 - o.altAmp;
        const To = 0.4 * T, Tc = 0.16 * T, i0 = Math.ceil(t0 * SR), i1 = Math.min(n + 1, Math.ceil((t0 + T) * SR));
        for (let i = i0; i < i1; i++) { const tt = i / SR - t0; flow[i] = amp * (tt < To ? 0.5 * (1 - Math.cos(Math.PI * tt / To)) : (tt < To + Tc ? Math.cos(Math.PI / 2 * (tt - To) / Tc) : 0)); }
        t0 += T; k++;
      }
      for (let i = 0; i < n; i++) src[i] = flow[i + 1] - flow[i];
      const [F, B] = VOK[v];
      const trakt = x => { let y = x; for (let m = 0; m < F.length; m++) y = D.resonate(y, F[m], B[m], SR); return y; };
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
    // Kosinusrampen ein/aus (s), 0 = harte Kante
    function rampen(x, ein, aus) {
      const y = Float64Array.from(x), a = Math.round(ein * SR), b = Math.round(aus * SR);
      for (let i = 0; i < a; i++) y[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / a);
      for (let i = 0; i < b; i++) y[y.length - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / b);
      return y;
    }
    // rosa Raumrauschen (Voss-McCartney-Näherung), snr dB unter dem Effektivwert der lauten 10-ms-Blöcke
    function raum(x, snr, seed) {
      const n = x.length, rnd = lcg2(seed), nz = new Float64Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) { const w = gauss(rnd); b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; nz[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926; }
      const blk = 480, lv = []; for (let i = 0; i + blk <= n; i += blk) lv.push(effW(x, i, i + blk));
      const mxl = Math.max(...lv), sel = lv.filter(v => v > mxl * 0.0316), sR = Math.sqrt(sel.reduce((a, v) => a + v * v, 0) / sel.length);
      const g = sR * Math.pow(10, -snr / 20) / effW(nz), y = new Float64Array(n);
      for (let i = 0; i < n; i++) y[i] = x[i] + g * nz[i];
      return y;
    }
    const pause = s => new Float64Array(Math.round(s * SR));
    // Rahmen wie analysis.js (align centre) an den Zeitpunkten ts (s); Boden fest −70 dBFS
    function rahmenBei(x, ts, extra) {
      const ds = D.resample(x, SR, T12), out = [];
      for (const t of ts) { const c = Math.round(t * T12); if (c - 840 < 0 || c + 840 > ds.length) continue; const r = D.analyseAt(ds, T12, c, Object.assign({ align: 'centre', floorDb: -70, orders: [14] }, extra || {})); r.t = t; out.push(r); }
      return out;
    }
    const zeiten = (a, b) => { const t = []; for (let x = a; x <= b + 1e-9; x += 0.01) t.push(+x.toFixed(3)); return t; };
    const hat = (r, g) => String(r.shrGrund).split('+').indexOf(g) >= 0;
    const unmarkiert25 = r => r.voiced && !r.shrUnsure && r.shr > -25;
    const zeig = r => 't ' + r.t.toFixed(2) + ' SHR ' + r1_(r.shr) + (r.shrUnsure ? ' [' + r.shrGrund + ']' : '') + ' F0 ' + r1_(r.f0) + (r.f0Unsure ? ' [' + r.f0Grund + ']' : '');

    /* A2a Ränder: harter oder weicher Einsatz und Aussatz nach Stille (Raumrauschen 40 dB). Das Fenster
       über der Kante zeigt die verbreiterten Linien als halbzahlige Energie (vorher bis −8 dB, sicher). */
    {
      s2 = 21000;
      const L = [], innen = [];
      for (const v of ['a', 'i']) for (const f0 of [98, 165, 262]) for (const art of ['impuls', 'rosenberg']) for (const rampe of [0, 0.03]) {
        const ton = art === 'impuls' ? stimme(() => f0, 0.8, v, { art, jit: 0.01, shim: 0.02, seed: s2++ }) : quelle({ f0, dur: 0.8, jit: 0.01, shim: 0.02, seed: s2++ }, v);
        const x = raum(H.concat([pause(0.4), rampen(ton, rampe, rampe), pause(0.4)]), 40, s2++);
        // Kanten bei 0,4 s und 1,2 s; Abstand der Rahmenmitte zur Kante (bei Rampen zum inneren Ende der Rampe)
        for (const r of rahmenBei(x, zeiten(0.3, 0.6).concat(zeiten(1.0, 1.3)))) {
          if (!r.voiced) continue;
          const nm = NAME[v] + ' ' + f0 + ' ' + art + (rampe ? ' Rampe 30 ms' : ' hart'), d = Math.min(Math.abs(r.t - 0.4), Math.abs(r.t - 1.2)), dInnen = Math.min(r.t - 0.4 - rampe, 1.2 - rampe - r.t);
          // Fenster (0,14 s) über der Kante bzw. Rampe
          if (dInnen < 0.07) L.push({ nm, r, d });
          if (dInnen >= 0.09) innen.push({ nm, r });
        }
      }
      const bad = L.filter(x => unmarkiert25(x.r)), nah = L.filter(x => x.d <= 0.05), ohneRand = nah.filter(x => !hat(x.r, 'rand')), falsch = innen.filter(x => hat(x.r, 'rand') || hat(x.r, 'wechsel'));
      check('A2a', 'harter und weicher Ein- und Aussatz (/a/ /i/, 98–262 Hz, Impuls und Rosenberg, Raumrauschen 40 dB): kein stimmhafter Rahmen, dessen Fenster die Kante überdeckt, mit SHR über −25 dB ohne shrUnsure; jeder Rahmen, dessen Mitte bis 50 ms von der Kante liegt, trägt den Grund \'rand\'',
        L.length >= 300 && bad.length === 0 && nah.length >= 100 && ohneRand.length === 0,
        'Rahmen ' + L.length + ', unmarkiert über −25 dB ' + bad.length + ', an der Kante ' + nah.length + ' davon ohne \'rand\' ' + ohneRand.length +
        (bad.length ? ' — ' + bad.slice(0, 3).map(x => x.nm + ' ' + zeig(x.r)).join(' | ') : '') + (ohneRand.length ? ' — ohne rand: ' + ohneRand.slice(0, 3).map(x => x.nm + ' ' + zeig(x.r) + ' Pegelspanne ' + r1_(x.r.fensterPegelDb)).join(' | ') : ''));
      check('A2a', 'derselbe Satz, Fenster ganz im Ton (Mitte mindestens 90 ms von der Kante): nie \'rand\' oder \'wechsel\'', innen.length >= 100 && falsch.length === 0,
        'Rahmen ' + innen.length + ', mit Fenstergrund ' + falsch.length + (falsch.length ? ' — ' + falsch.slice(0, 3).map(x => x.nm + ' ' + zeig(x.r) + ' Pegelspanne ' + r1_(x.r.fensterPegelDb)).join(' | ') : ''));
    }

    /* A2b Tonwechsel legato: Die Teiltöne des zweiten Tons fallen auf halbzahlige Linien des ersten. Fälle
       aus dem Befund (große Terz, Ganzton abwärts, Quinte 220→330 mit Unterton 110 Hz, 131→196 mit 65,5 Hz,
       Quarte 220→294, 165→208), dazu Halbton und Oktave. Vorher: SHR bis 0 dB ohne Marke, Unterton als
       sicherer Grundton. */
    {
      s2 = 22000;
      const PAARE = [[196, 247], [220, 196], [220, 330], [131, 196], [196, 294], [165, 208], [220, 294], [110, 104], [131, 262], [262, 131]];
      const L = [], kern = [], ruhig = [];
      for (const [a, b] of PAARE) for (const v of ['a', 'o', 'e']) for (const [gl, vib] of [[0.02, 0], [0.05, 0], [0.05, 40]]) {
        const fz0 = stufen([a, b], 0.6, gl), fz = vib ? vibrato(fz0, 5.5, vib, a) : fz0;
        const x = raum(rampen(quelle({ f0: fz, dur: 1.2, jit: 0.008, shim: 0.02, seed: s2++ }, v), 0.05, 0.05), 40, s2++);
        const nm = NAME[v] + ' ' + a + '→' + b + ' Gleiten ' + gl * 1000 + ' ms' + (vib ? ' Vibrato' : ''), lo = Math.min(a, b), hi = Math.max(a, b), ht = Math.abs(12 * Math.log2(b / a));
        for (const r of rahmenBei(x, zeiten(0.45, 0.8))) {
          if (!r.voiced) continue;
          const d = r.t < 0.6 ? 0.6 - r.t : Math.max(0, r.t - 0.6 - gl);   // Abstand zum Gleiten
          L.push({ nm, r, lo, hi });
          if (ht >= 4 && ht <= 7.5 && d <= 0.02) kern.push({ nm, r, gl });
          if (d >= 0.1) ruhig.push({ nm, r });
        }
      }
      const bad = L.filter(x => unmarkiert25(x.r));
      const f0aus = L.filter(x => !x.r.f0Unsure && (12 * Math.log2(x.r.f0 / x.lo) < -1 || 12 * Math.log2(x.r.f0 / x.hi) > 1));
      // Abdeckung bei raschem Gleiten (20 ms); bei 50 ms Gleiten ist ein Teilfenster oft selbst ein Glissando ohne
      // stehende Periode (YIN aperiodisch) — dort steht die Zahl nur im Bericht, SHR fängt dann der Zwischenpegel
      const kern20 = kern.filter(x => x.gl === 0.02), kern50 = kern.filter(x => x.gl === 0.05);
      const ohne = kern20.filter(x => !hat(x.r, 'wechsel')), ohne50 = kern50.filter(x => !hat(x.r, 'wechsel')), falsch = ruhig.filter(x => hat(x.r, 'wechsel') || hat(x.r, 'rand') || x.r.f0Grund === 'wechsel');
      check('A2b', 'legato Tonwechsel (±1…12 HT aus 104–262 Hz, /a/ /o/ /e/, Gleiten 20/50 ms, mit Vibrato, Rosenberg, 40 dB): kein Rahmen mit SHR über −25 dB ohne shrUnsure, kein Grundton mehr als 1 HT außerhalb der beiden Töne ohne f0Unsure',
        L.length >= 1500 && bad.length === 0 && f0aus.length === 0,
        'Rahmen ' + L.length + ', unmarkiert über −25 dB ' + bad.length + ', Grundton außerhalb ohne Marke ' + f0aus.length + ', Mischwert erkannt (f0Grund wechsel) ' + L.filter(x => x.r.f0Grund === 'wechsel').length +
        (bad.length ? ' — ' + bad.slice(0, 3).map(x => x.nm + ' ' + zeig(x.r)).join(' | ') : '') + (f0aus.length ? ' — ' + f0aus.slice(0, 3).map(x => x.nm + ' ' + zeig(x.r)).join(' | ') : ''));
      check('A2b', 'Schritte 4–7 HT, Gleiten 20 ms: Rahmen bis 20 ms um den Wechsel tragen zu mindestens 95 % den Grund \'wechsel\'; Rahmen 100 ms und weiter vom Wechsel nie \'wechsel\' oder \'rand\'',
        kern20.length >= 80 && ohne.length <= 0.05 * kern20.length && ruhig.length >= 500 && falsch.length === 0,
        'am Wechsel ' + (kern20.length - ohne.length) + '/' + kern20.length + ' (Bericht: Gleiten 50 ms ' + (kern50.length - ohne50.length) + '/' + kern50.length + '), abseits ' + ruhig.length + ' Rahmen, davon mit Fenstergrund ' + falsch.length +
        (ohne.length ? ' — ohne wechsel z. B. ' + ohne.slice(0, 3).map(x => x.nm + ' ' + zeig(x.r) + ' Teile ' + r1_(x.r.fensterF0Lo) + '–' + r1_(x.r.fensterF0Hi)).join(' | ') : '') +
        (falsch.length ? ' — abseits markiert: ' + falsch.slice(0, 3).map(x => x.nm + ' ' + zeig(x.r)).join(' | ') : ''));
    }

    /* A2c Take: legato Melodie wie im Befund (131-147-165-196-165-220-196-147-131 Hz, je 0,35 s, 40 ms
       Gleiten, Wobble, rosa Raumrauschen 40 dB) durch analyseTake. Vorher meldete die Zusammenfassung „SHR
       max“ −6 dB aus Rahmen, die als sicher galten — in Gold „über der Warnschwelle“. */
    {
      s2 = 23000;
      const toene = [131, 147, 165, 196, 165, 220, 196, 147, 131], F = A.FLAG, zeilen = [];
      let gut = true;
      for (const v of ['a', 'o']) {
        const fz = vibrato(stufen(toene, 0.35, 0.04), 3.5, 25, 1);
        const x = raum(H.concat([pause(0.2), rampen(quelle({ f0: fz, dur: toene.length * 0.35, jit: 0.008, shim: 0.02, seed: s2++ }, v), 0.06, 0.06), pause(0.2)]), 40, s2++);
        const res = await A.analyseTake(x, SR, {}), s = res.series;
        let n = 0, bad = 0, f0aus = 0, mx = -Infinity;
        for (let i = 0; i < s.t.length; i++) {
          if (!(s.flags[i] & F.VOICED)) continue;
          n++;
          if (!(s.flags[i] & F.SHRUNSURE) && s.shr[i] > -25) { bad++; mx = Math.max(mx, s.shr[i]); }
          if (!(s.flags[i] & F.F0UNSURE) && (12 * Math.log2(s.f0[i] / 131) < -1 || 12 * Math.log2(s.f0[i] / 220) > 1)) f0aus++;
        }
        const smax = res.summary.shr.max, ok = n > 200 && bad === 0 && f0aus === 0 && !(smax > -15);
        gut = gut && ok;
        zeilen.push(NAME[v] + ': stimmhaft ' + n + ', unmarkiert über −25 dB ' + bad + (bad ? ' (höchster ' + r1_(mx) + ')' : '') + ', Grundton außerhalb ohne Marke ' + f0aus + ', summary.shr.max ' + r1_(smax) + ' dB, shrUnsureShare ' + r1_(100 * res.summary.shrUnsureShare) + ' %');
      }
      check('A2c', 'Take mit legato Melodie (/a/ /o/, Wobble, 40 dB) durch analyseTake: kein stimmhafter Rahmen mit SHR über −25 dB ohne SHRUNSURE, kein Grundton außerhalb der Melodie ohne F0UNSURE, summary.shr.max höchstens −15 dB (keine Warnung in Gold)',
        gut, zeilen.join(' | '));
    }

    /* A2d Hauch: Rauschen in der Anregung legt Energie auf die halbzahligen Positionen wie überall
       zwischen den Linien. Vorher bei HNR 8 dB SHR bis −12 dB als sichere Warnung. Gezählt werden Rahmen
       mit richtigem Grundton (±3 %, ohne f0Unsure): ein falscher Grundton verschiebt das Raster, das prüft
       die Gegenprobe (K3), nicht SHR. Rahmen mit falschem, unmarkiertem Grundton stehen im Bericht. */
    {
      s2 = 24000;
      const L = [], fremd = [];
      for (const hnr of [5, 8, 12, 20]) for (const [v, f0] of [['a', 110], ['u', 85], ['o', 130], ['e', 220], ['a', 165], ['i', 98], ['o', 78], ['a', 247]]) {
        const x = raum(rampen(quelle({ f0, dur: 0.9, jit: 0.008, shim: 0.02, hnr, seed: s2++ }, v), 0.03, 0.03), 40, s2++);
        for (const r of rahmenBei(x, zeiten(0.2, 0.7))) {
          if (!r.voiced) continue;
          const recht = Math.abs(r.f0 / f0 - 1) < 0.03 && !r.f0Unsure, nm = NAME[v] + ' ' + f0 + ' HNR ' + hnr;
          if (recht) L.push({ nm, r }); else if (unmarkiert25(r)) fremd.push({ nm, r });
        }
      }
      const bad = L.filter(x => unmarkiert25(x.r)), rau = L.filter(x => hat(x.r, 'rauschen'));
      check('A2d', 'behauchte Stimme ohne Subharmonische (HNR 5/8/12/20 dB, /a/ /u/ /o/ /e/ /i/ 78–247 Hz, Rosenberg, Raumrauschen 40 dB), Rahmen mit richtigem Grundton: kein SHR über −25 dB ohne shrUnsure',
        L.length >= 800 && bad.length === 0,
        'Rahmen ' + L.length + ', unmarkiert über −25 dB ' + bad.length + ', \'rauschen\' ' + rau.length + (bad.length ? ' — ' + bad.slice(0, 3).map(x => x.nm + ' ' + zeig(x.r) + ' Boden ' + r1_(x.r.shrBoden)).join(' | ') : '') +
        '; Bericht: Rahmen mit falschem Grundton ohne f0Unsure und SHR über −25 dB ' + fremd.length + (fremd.length ? ' (' + fremd.slice(0, 3).map(x => x.nm + ' ' + zeig(x.r)).join(' | ') + ')' : ''));
      // Gegenprüfer-Fall durch analyseTake: 1,5 s, Rampen 30 ms, 0,3 s Raumrauschen davor und danach
      const zeilen = []; let gut = true;
      for (const [v, f0, hnr] of [['a', 110, 8], ['u', 85, 10]]) {
        const x = raum(H.concat([pause(0.3), rampen(quelle({ f0, dur: 1.5, jit: 0.008, shim: 0.02, hnr, seed: s2++ }, v), 0.03, 0.03), pause(0.3)]), 40, s2++);
        const res = await A.analyseTake(x, SR, {}), s = res.series, F = A.FLAG;
        let n = 0, ueber15 = 0;
        for (let i = 0; i < s.t.length; i++) if (s.flags[i] & F.VOICED) { n++; if (!(s.flags[i] & F.SHRUNSURE) && s.shr[i] > -15) ueber15++; }
        const smax = res.summary.shr.max;
        gut = gut && n > 100 && ueber15 === 0 && !(smax > -15);
        zeilen.push(NAME[v] + ' ' + f0 + ' Hz HNR ' + hnr + ': stimmhaft ' + n + ', unmarkiert über −15 dB ' + ueber15 + ', summary.shr.max ' + r1_(smax) + ', shrUnsureShare ' + r1_(100 * res.summary.shrUnsureShare) + ' %');
      }
      check('A2d', 'Take /a/ 110 Hz HNR 8 dB und /u/ 85 Hz HNR 10 dB durch analyseTake: kein Rahmen über −15 dB ohne SHRUNSURE, summary.shr.max höchstens −15 dB oder leer', gut, zeilen.join(' | '));
    }

    /* A2e Gegenprobe: echte Verdopplung (Testprofil: Amplitude oder Periode 8–14 %, dazu 30 %) bleibt
       sichtbar. Die neuen Gründe dürfen sie nicht zudecken: mitten im Ton nie 'rand' oder 'wechsel';
       'rauschen' trifft nur Rahmen, deren halbzahlige Linien sich keine 8 dB vom Zwischenpegel abheben. */
    {
      s2 = 25000;
      const L = [];
      for (const [art, a] of [['altAmp', 0.08], ['altAmp', 0.14], ['altAmp', 0.3], ['altPer', 0.08], ['altPer', 0.14]]) for (const [v, f0] of [['a', 110], ['o', 130], ['e', 165], ['a', 196], ['u', 147], ['i', 220]]) {
        const o = { f0, dur: 0.9, jit: 0.008, shim: 0.02, seed: s2++ }; o[art] = a;
        const x = raum(rampen(quelle(o, v), 0.03, 0.03), 40, s2++);
        for (const r of rahmenBei(x, zeiten(0.2, 0.7))) if (r.voiced) L.push({ nm: NAME[v] + ' ' + f0 + ' ' + art + ' ' + a, r });
      }
      const neu = r => hat(r, 'rand') || hat(r, 'wechsel') || hat(r, 'rauschen');
      const fenster = L.filter(x => hat(x.r, 'rand') || hat(x.r, 'wechsel'));
      const warn = L.filter(x => x.r.shr > -15), warnNeu = warn.filter(x => neu(x.r));
      const sicht = L.filter(x => x.r.shr > -25), sichtNeu = sicht.filter(x => neu(x.r));
      check('A2e', 'echte Verdopplung (Amplitude/Periode 8, 14, 30 %, sechs Vokale 110–220 Hz, Rosenberg, Raumrauschen 40 dB) mitten im Ton: nie \'rand\'/\'wechsel\'; von den Warnungen (SHR über −15 dB) tragen höchstens 10 %, von allen Werten über −25 dB höchstens 25 % einen neuen Grund',
        L.length >= 800 && fenster.length === 0 && warn.length >= 50 && warnNeu.length <= 0.1 * warn.length && sichtNeu.length <= 0.25 * sicht.length,
        'Rahmen ' + L.length + ', Fenstergrund ' + fenster.length + ', Warnungen ' + warn.length + ' davon mit neuem Grund ' + warnNeu.length + ', über −25 dB ' + sicht.length + ' davon mit neuem Grund ' + sichtNeu.length +
        (fenster.length ? ' — ' + fenster.slice(0, 3).map(x => x.nm + ' ' + zeig(x.r)).join(' | ') : '') + (warnNeu.length ? ' — z. B. ' + warnNeu.slice(0, 2).map(x => x.nm + ' ' + zeig(x.r) + ' Boden ' + r1_(x.r.shrBoden)).join(' | ') : ''));
    }

    /* A2f Gegenprobe gegen Fehlalarme: stehende saubere Töne 75–450 Hz (sechs Vokale, Impuls und Rosenberg,
       Rauschen 30/40 dB, Jitter 1/2 %, Vibrato 6 Hz ±50 Cent, Wobble 3,5 Hz ±40 Cent), Fenster ganz im Ton. */
    {
      s2 = 26000;
      const L = [];
      const add = (nm, x, f0) => { for (const r of rahmenBei(x, [0.2])) if (r.voiced) L.push({ nm, r, f0 }); };
      for (const v of ['a', 'e', 'o', 'u', 'oe', 'i']) for (let f0 = 75; f0 <= 450; f0 += 25) {
        const nm = NAME[v] + ' ' + f0;
        add(nm, stimme(() => f0, 0.4, v, { art: 'impuls', seed: s2++ }), f0);
        add(nm + ' Rosenberg Jitter 1 %', quelle({ f0, dur: 0.4, jit: 0.01, shim: 0.02, seed: s2++ }, v), f0);
        add(nm + ' Impuls Jitter 2 %', stimme(() => f0, 0.4, v, { art: 'impuls', jit: 0.02, shim: 0.02, seed: s2++ }), f0);
        add(nm + ' Rauschen 30 dB', mitRauschen(stimme(() => f0, 0.4, v, { art: 'rosenberg', seed: s2++ }), 30, s2++), f0);
        add(nm + ' Vibrato 6 Hz ±50 c', quelle({ f0: vibrato(() => f0, 6, 50, f0), dur: 0.4, jit: 0.005, seed: s2++ }, v), f0);
        add(nm + ' Wobble 3,5 Hz ±40 c', raum(stimme(vibrato(() => f0, 3.5, 40, f0), 0.4, v, { art: 'impuls', jit: 0.005, seed: s2++ }), 40, s2++), f0);
      }
      const fenster = L.filter(x => hat(x.r, 'rand') || hat(x.r, 'wechsel') || x.r.f0Grund === 'wechsel');
      const rau = L.filter(x => hat(x.r, 'rauschen')), rauFalsch = rau.filter(x => !(x.r.shr > -25));
      const recht = L.filter(x => Math.abs(x.r.f0 / x.f0 - 1) < 0.03 && !x.r.f0Unsure), neu = recht.filter(x => hat(x.r, 'rauschen'));
      check('A2f', 'stehende saubere Töne 75–450 Hz (sechs Vokale, Impuls/Rosenberg, Rauschen, Jitter 1/2 %, Vibrato ±50 c, Wobble): nie \'rand\', \'wechsel\' oder f0Grund \'wechsel\'; \'rauschen\' nur über −25 dB und bei höchstens 5 % der Rahmen mit richtigem Grundton',
        L.length >= 500 && fenster.length === 0 && rauFalsch.length === 0 && neu.length <= 0.05 * recht.length,
        'Rahmen ' + L.length + ', Fenstergrund ' + fenster.length + ', \'rauschen\' ' + rau.length + ' (bei richtigem Grundton ' + neu.length + '/' + recht.length + ')' +
        (fenster.length ? ' — ' + fenster.slice(0, 3).map(x => x.nm + ' ' + zeig(x.r) + ' Pegelspanne ' + r1_(x.r.fensterPegelDb) + ' Teile ' + r1_(x.r.fensterF0Lo) + '–' + r1_(x.r.fensterF0Hi)).join(' | ') : '') +
        (neu.length ? ' — \'rauschen\' z. B. ' + neu.slice(0, 3).map(x => x.nm + ' ' + zeig(x.r)).join(' | ') : ''));
    }

    /* A2g Vertrag der neuen Felder und Gründe (dsp.js analyseAt), nachgerechnet aus Spektrum und Signal:
       Zwischenpegel (shrBoden, 'rauschen') und Fensterprobe (fenster*, 'rand', 'wechsel', Mischwert). */
    {
      s2 = 27000;
      const ORD = ['kamm', 'zweitpuls', 'grundton', 'rand', 'wechsel', 'rauschen'];
      const proben = [];
      proben.push(raum(H.concat([pause(0.3), quelle({ f0: stufen([220, 330], 0.4, 0.02), dur: 0.8, jit: 0.008, shim: 0.02, seed: s2++ }, 'o'), pause(0.3)]), 40, s2++));
      proben.push(raum(H.concat([pause(0.3), quelle({ f0: 110, dur: 0.6, hnr: 8, jit: 0.008, shim: 0.02, seed: s2++ }, 'a'), pause(0.3)]), 40, s2++));
      proben.push(raum(H.concat([pause(0.3), quelle({ f0: 150, dur: 0.6, altAmp: 0.5, seed: s2++ }, 'a'), pause(0.3)]), 40, s2++));
      const R = [];
      for (const x of proben) {
        const ds = D.resample(x, SR, T12);
        for (let c = 900; c + 900 < ds.length; c += 60) R.push({ c, ds, r: D.analyseAt(ds, T12, c, { align: 'centre', floorDb: -70, orders: [14], wantSpectrum: true }) });
      }
      {
        const fehler = [], z = { rauschen: 0, stimmlos: 0, sicher: 0 };
        if (typeof D.shrBoden !== 'function') fehler.push('fehlt: shrBoden');
        else for (const { c, r } of R) {
          const e = [];
          if (!r.voiced) { z.stimmlos++; if (!(Number.isNaN(r.shrBoden) && r.shrGrund === '' && r.shrUnsure === false)) e.push('stimmlos nicht leer'); }
          else {
            const db = r.spectrumDb, sp = { db, sr: T12, df: T12 / (2 * (db.length - 1)), N: 2 * (db.length - 1) }, boden = D.shrBoden(sp, r.shrGrid);
            if (!(Math.abs(r.shrBoden - boden) < 1e-9)) e.push('shrBoden ' + r.shrBoden + ' statt ' + boden);
            const rau = r.shr > D.SHR_UNAUFFAELLIG_DB && !(r.shr - r.shrBoden >= D.SHR_RAUSCH_ABSTAND_DB);
            if (hat(r, 'rauschen') !== rau) e.push('rauschen ' + hat(r, 'rauschen') + ' statt ' + rau);
            if (r.shrUnsure !== (r.shrGrund !== '')) e.push('shrUnsure ' + r.shrUnsure + ' bei Grund „' + r.shrGrund + '“');
            const teile = r.shrGrund ? r.shrGrund.split('+') : [];
            if (!teile.every((t, i) => ORD.indexOf(t) >= 0 && (i === 0 || ORD.indexOf(t) > ORD.indexOf(teile[i - 1])))) e.push('Reihenfolge ' + r.shrGrund);
            if (hat(r, 'grundton') !== r.f0Unsure) e.push('grundton');
            if (rau) z.rauschen++; if (!r.shrUnsure) z.sicher++;
          }
          if (e.length) fehler.push('c ' + c + ': ' + e.join(', '));
        }
        check('A2g', 'Vertrag Zwischenpegel: shrBoden = Pegel an den Viertelpositionen des Rasters shrGrid gegen die ganzzahligen Linien; \'rauschen\' ⇔ SHR über −25 dB und weniger als 8 dB über shrBoden; Gründe in fester Reihenfolge, shrUnsure ⇔ Grund; stimmlos leer',
          !fehler.length && z.rauschen > 0 && z.stimmlos > 0 && z.sicher > 0, R.length + ' Rahmen, ' + JSON.stringify(z) + (fehler.length ? ' — ' + fehler.length + ' Fehler: ' + fehler.slice(0, 4).join(' | ') : ''));
      }
      {
        const fehler = [], z = { rand: 0, wechsel: 0, mischwert: 0, stimmlos: 0 };
        const fn = ['fensterProbe', 'fensterMischwert'].filter(k => typeof D[k] !== 'function');
        if (fn.length) fehler.push('fehlt: ' + fn.join(', '));
        else for (const { c, ds, r } of R) {
          const e = [];
          if (!r.voiced) { z.stimmlos++; if (!(Number.isNaN(r.fensterPegelDb) && Number.isNaN(r.fensterF0Lo) && Number.isNaN(r.fensterF0Hi))) e.push('stimmlos nicht leer'); }
          else {
            const fp = D.fensterProbe(ds.subarray(c - 840, c + 840), T12, 60, 500);
            if (!Object.is(r.fensterPegelDb, fp.pegelDb) || !Object.is(r.fensterF0Lo, fp.f0Lo) || !Object.is(r.fensterF0Hi, fp.f0Hi)) e.push('Fensterfelder');
            if (hat(r, 'rand') !== (fp.pegelDb >= D.FENSTER_RAND_DB)) e.push('rand');
            if (hat(r, 'wechsel') !== fp.wechsel) e.push('wechsel');
            if (r.f0Grund === 'wechsel' && !(fp.wechsel && D.fensterMischwert(fp, r.f0))) e.push('f0Grund wechsel ohne Mischwert');
            if (r.f0Grund === 'wechsel' && r.f0Korrektur) e.push('Mischwert und Korrektur');
            if (!r.f0Unsure && fp.wechsel && D.fensterMischwert(fp, r.f0)) e.push('Mischwert ohne f0Unsure');
            for (const k of ['rand', 'wechsel']) if (hat(r, k)) z[k]++;
            if (r.f0Grund === 'wechsel') z.mischwert++;
          }
          if (e.length) fehler.push('c ' + c + ': ' + e.join(', '));
        }
        check('A2g', 'Vertrag Fensterprobe: fensterPegelDb/fensterF0Lo/fensterF0Hi aus dem längsten Fenster; \'rand\' ⇔ Pegelspanne ab 12 dB; \'wechsel\' ⇔ Teilfenster (Hälften oder äußere 45 ms) unverträglich; f0Grund \'wechsel\' genau beim Mischwert, nie zusammen mit einer Korrektur; stimmlos leer',
          !fehler.length && z.rand > 0 && z.wechsel > 0 && z.mischwert > 0 && z.stimmlos > 0, R.length + ' Rahmen, ' + JSON.stringify(z) + (fehler.length ? ' — ' + fehler.length + ' Fehler: ' + fehler.slice(0, 4).join(' | ') : ''));
      }
    }
  }
};

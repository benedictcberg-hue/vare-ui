/* Kriterien der Nachprüfung, Rechenkern.
   A1: zweite Tonhöhenspur (pitchTrackFine) und Sprungerkennung (detectJumps) —
     A1a Oktavkontrolle der Feinspur (F1 ≈ 2·F0), A1b Mischrahmen, 1,5·F0 und Schwelle am legato Tonwechsel,
     A1c Atempause im Raum und mit Brumm.
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
};

/* Kriterien der Nachprüfung, Rechenkern.
   A1: zweite Tonhöhenspur (pitchTrackFine) und Sprungerkennung (detectJumps) —
     A1a Oktavkontrolle der Feinspur (F1 ≈ 2·F0), A1b Mischrahmen, 1,5·F0 und Schwelle am legato Tonwechsel,
     A1c Atempause im Raum und mit Brumm, A1d Naht im Signal (digitale Stille, harter Schnitt).
   A2: SHR und Grundton an Rändern, Tonwechseln und bei Hauch (analyseAt: Fensterprobe, Zwischenpegel) —
     A2a Ränder, A2b Tonwechsel, A2c Take mit Melodie, A2d Hauch, A2e Verdopplung bleibt sichtbar,
     A2f stehende Töne ohne Fehlmarke, A2g Vertrag der Felder.
   A3: Formanten nach dem Teiltonabstand (analyseAt: teiltonPruefen) —
     A3a ΔF3–4/ΔF4–5 über 250 Hz, A3b Slots über 375 Hz und Nummernrutsch, A3c Gipfelpaare, A3d unsicherer
     Grundton (2·F0), A3e Takes in hoher Lage, A3f Gegenprobe unter 250 Hz und Vertrag, A3g tiefes enges
     Cluster, das nur eine LPC-Ordnung trennt, A3h Vokalwechsel im Fenster.
   A4: Grundton bei starkem Hauch (analyseAt: Gegenprobe und Teilerkontrolle im Rauschen) —
     A4a hohe Lage (Befund N17), A4b Unterton in behauchter Stimme, A4c Oktave darüber bei teilweise belegter Reihe.
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
     40 %, Schluss 16 %), abgeleitet (Lippenabstrahlung). jit/shim: relative Streuung je Periode;
     FB: Formanten und Bandbreiten [F, B] statt der Werte von v. */
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
    let y = src; const [F, B] = o.FB || VOK[v];   // o.FB: eigene Formanten [F, B] statt des Vokals
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
  const hilfen = {};   // Signalhilfen eines Abschnitts, die ein späterer mitbenutzt (A2 → A4)

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
    hilfen.a2 = { quelle, rampen, raum, pause, rahmenBei };
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

    /* A2f (Fortsetzung) Schmaler F1 genau auf dem 3.–6. Teilton (tiefe Lage, wie K3): YIN nimmt in einzelnen
       Teilfenstern einen Nebendip bei 4/5 oder 5/6 der Periode (dn knapp unter 0,15). Das ist kein zweiter
       Ton; vorher galt jeder dritte Rahmen als 'wechsel', und die richtige Korrektur des Grundtons wurde als
       Mischwert verworfen. */
    {
      s2 = 26500;
      const L = [];
      const SAETZE = [[121, 5, 45], [97, 5, 30]];
      for (const f0 of [76, 95, 115, 133]) for (const m of [3, 4, 5, 6]) for (const b of [30, 45]) SAETZE.push([f0, m, b]);
      for (const [f0, m, b] of SAETZE) {
        const x = D.synthVowel(f0, [m * f0, 1250, 2500, 3300, 4200], [b, 90, 120, 150, 200], 0.6, SR);
        for (const r of rahmenBei(x, [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45])) if (r.voiced) L.push({ nm: f0 + ' Hz F1 = ' + m + '·F0 B1 ' + b, r, f0 });
      }
      const fenster = L.filter(x => hat(x.r, 'wechsel') || hat(x.r, 'rand') || x.r.f0Grund === 'wechsel'), falsch = L.filter(x => !(Math.abs(x.r.f0 / x.f0 - 1) < 0.03) && !x.r.f0Unsure);
      check('A2f', 'stehende Töne 76–133 Hz mit schmalem F1 (30/45 Hz) auf dem 3.–6. Teilton und Befund-Fälle 121/97 Hz: nie \'wechsel\', \'rand\' oder f0Grund \'wechsel\', kein falscher Grundton ohne f0Unsure',
        L.length >= 200 && fenster.length === 0 && falsch.length === 0,
        'Rahmen ' + L.length + ', Fenstergrund ' + fenster.length + ', falscher Grundton ohne Marke ' + falsch.length +
        (fenster.length ? ' — ' + fenster.slice(0, 3).map(x => x.nm + ' ' + zeig(x.r) + ' Teile ' + r1_(x.r.fensterF0Lo) + '–' + r1_(x.r.fensterF0Hi)).join(' | ') : '') +
        (falsch.length ? ' — ' + falsch.slice(0, 3).map(x => x.nm + ' ' + zeig(x.r)).join(' | ') : ''));
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

  /* ---------- A3: Formanten nach dem Teiltonabstand (analyseAt) ----------
     Über 250 Hz Grundton sieht die LPC-Hüllkurve die Resonanzen nur an wenigen Teiltönen. Ein Gipfel rastet
     auf einem Teilton ein oder entsteht zwischen ihnen, die Nummerierung rutscht, und alle Fenster und
     Ordnungen sehen dieselben Teiltöne: Die Sweeps streuen nicht (Befunde N3, N6, N14). Wahrheit sind die
     Formanten der Synthese. */
  {
    // Vokale nach dem Vokalmodell (wie Prüfsatz K2) und eine zweite Wahl (wie die Abnahmetabelle)
    const VH = {
      a: [[680, 1250, 2450, 3400, 4200], [80, 90, 120, 150, 200]], e: [[350, 2000, 2550, 3450, 4250], [60, 100, 130, 160, 200]],
      i: [[270, 2150, 2750, 3500, 4300], [60, 100, 130, 160, 200]], o: [[380, 750, 2400, 3350, 4150], [70, 90, 120, 150, 200]],
      u: [[300, 700, 2300, 3300, 4100], [60, 90, 120, 150, 200]]
    };
    const VB = {
      a: [[700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200]], e: [[400, 1900, 2600, 3400, 4300], [60, 100, 130, 160, 200]],
      i: [[300, 2200, 2900, 3500, 4300], [60, 100, 130, 160, 200]], o: [[450, 800, 2500, 3300, 4200], [70, 90, 120, 150, 200]],
      u: [[320, 800, 2400, 3300, 4200], [60, 90, 120, 150, 200]]
    };
    const ds = x => D.resample(x, SR, TSR);
    const fehler = (r, T, k) => Math.abs(r.F[k] - T[k]);
    const bits = a => a.map(b => b ? 1 : 0).join('');

    // Messsatz hohe Lage: 250–470 Hz, a/e/i/o/u, Impuls und Rosenberg, mit und ohne Vibrato, rauschfrei und 40 dB
    const S = [];
    {
      let sd = 3000;
      for (let f0 = 250; f0 <= 470; f0 += 20) for (const v of Object.keys(VH)) for (const art of ['impuls', 'rosenberg']) for (const vib of [false, true]) for (const snr of [null, 40]) {
        const fz = vib ? vibrato(() => f0, 6, 50, f0) : () => f0;
        let x = stimme(fz, 0.3, v, { art, FB: VH[v], seed: sd++ });
        if (snr != null) x = mitRauschen(x, snr, sd + 7000);
        const y = ds(x);
        for (const t of [0.12, 0.2]) { const r = D.analyseAt(y, TSR, Math.round(t * TSR), {}); if (r.voiced) S.push({ r, T: VH[v][0], name: art + (vib ? '+Vibrato' : '') + (snr != null ? '+40 dB' : '') + ' /' + v + '/ ' + f0 + ' Hz' }); }
      }
    }

    // A3a: ΔF3–4 und ΔF4–5 sind Differenzen zweier gezogener Lagen; über 250 Hz Teiltonabstand nicht gültig
    {
      let d34f = 0, d45f = 0, entsch = 0, entschFalsch = 0, ohneGrund = 0, unten34 = 0; const bsp = [], bspU = [];
      for (const { r, T, name } of S) {
        const e34 = Math.abs(r.d34 - (T[3] - T[2])), e45 = Math.abs(r.d45 - (T[4] - T[3])), hoch = r.teiltonHz > 250;
        if (hoch && r.d34valid && e34 > 120) { d34f++; if (bsp.length < 3) bsp.push(name + ' ΔF3–4 ' + Math.round(r.d34) + ' statt ' + (T[3] - T[2])); }
        if (hoch && r.d45valid && e45 > 120) { d45f++; if (bsp.length < 3) bsp.push(name + ' ΔF4–5 ' + Math.round(r.d45) + ' statt ' + (T[4] - T[3])); }
        if (hoch && isFinite(r.d34) && !(r.d34Grund === 'teilton' && !r.d34valid)) ohneGrund++;
        if (hoch && isFinite(r.d45) && !(r.d45Grund === 'teilton' && !r.d45valid)) ohneGrund++;
        if (hoch && r.valid[2] && r.valid[3]) { entsch++; if (e34 > 120) entschFalsch++; }
        // Vibrato-Täler des 250-Hz-Tons liegen unter der Grenze: dort gilt die Prüfung unter 250 Hz (offen)
        if (!hoch && r.d34valid && e34 > 120) { unten34++; if (bspU.length < 2) bspU.push(name + ' (F0 ' + Math.round(r.f0) + ') ΔF3–4 ' + Math.round(r.d34) + ' statt ' + (T[3] - T[2])); }
      }
      check('A3a', 'Messsatz hohe Lage 250–470 Hz (a/e/i/o/u, Impuls/Rosenberg, mit/ohne Vibrato, rauschfrei/40 dB): über 250 Hz Teiltonabstand kein gültiges ΔF3–4 oder ΔF4–5 über 120 Hz falsch, Grund \'teilton\' (mind. 20 Rahmen mit gültigem F3 und F4, in denen das entscheidet)',
        d34f === 0 && d45f === 0 && ohneGrund === 0 && entsch >= 20,
        S.length + ' Rahmen; falsch-gültig ΔF3–4 ' + d34f + ', ΔF4–5 ' + d45f + '; ohne Grund ' + ohneGrund + '; entscheidend ' + entsch + ' (davon ' + entschFalsch + ' über 120 Hz daneben)' +
        '; offen unter 250 Hz (Vibrato-Tal): ' + unten34 + (bspU.length ? ' ' + bspU.join(' | ') : '') + (bsp.length ? ' — ' + bsp.join(' | ') : ''));
    }

    // A3b: über 375 Hz (weniger Teiltöne im Analyseband als die höchste LPC-Ordnung Koeffizienten hat) kein
    // gültiger Slot; im ganzen Satz kein gültiger Slot über 300 Hz falsch (Nummernrutsch)
    {
      let obenGueltig = 0, obenGrund = 0, grob = 0, ueber130 = 0, halb = 0, gueltig = 0; const bsp = [], bspR = [];
      for (const { r, T, name } of S) for (let k = 0; k < 5; k++) {
        if (r.teiltonHz > 375 && isFinite(r.F[k])) { if (r.valid[k]) { obenGueltig++; if (bsp.length < 3) bsp.push(name + ' F' + (k + 1) + ' ' + Math.round(r.F[k]) + ' gültig'); } if (r.slotGrund[k] === 'teilton') obenGrund++; }
        if (!r.valid[k]) continue;
        gueltig++;
        const e = fehler(r, T, k);
        if (e > 300) { grob++; if (bsp.length < 3) bsp.push(name + ' F' + (k + 1) + ' ' + Math.round(r.F[k]) + ' statt ' + T[k]); }
        if (e > 130) { ueber130++; if (bspR.length < 2) bspR.push(name + ' F' + (k + 1) + ' ' + Math.round(r.F[k]) + ' statt ' + T[k]); }
        if (e > r.f0 / 2 + 30) halb++;
      }
      check('A3b', 'Messsatz hohe Lage: über 375 Hz Teiltonabstand kein gültiger Slot (Grund \'teilton\', mind. 500 Slots); kein gültiger Slot über 300 Hz falsch (Nummernrutsch)',
        obenGueltig === 0 && obenGrund >= 500 && grob === 0,
        'über 375 Hz gültig ' + obenGueltig + ', mit Grund teilton ' + obenGrund + '; gültige Slots ' + gueltig + ', über 300 Hz falsch ' + grob +
        '; offen bis 375 Hz (Teilton bis F0/2 daneben, Abnahmetabelle f4 modal): über 130 Hz falsch ' + ueber130 + ', über F0/2+30 Hz ' + halb + (bspR.length ? ' z. B. ' + bspR.join(' | ') : '') + (bsp.length ? ' — ' + bsp.join(' | ') : ''));
    }

    // A3c: Gipfelpaare näher als 1,5·F0. (1) Vertrag je Fenster nachgerechnet: Jeder Slot, dessen Nummer davon
    // abhängt, dass beide Gipfel Resonanzen sind, ist nicht gültig. (2) Formanten gemeinsam um ±4/8 % verschoben
    // (zweite Vokaltabelle, 320–370 Hz), damit sie verschieden zwischen den Teiltönen liegen: kein Nummernrutsch.
    {
      const V = [];
      for (const v of Object.keys(VB)) for (const art of ['impuls', 'rosenberg']) for (let f0 = 320; f0 <= 370; f0 += 10) for (const s of [0.92, 0.96, 1, 1.04, 1.08]) {
        const T = VB[v][0].map(x => x * s), y = ds(stimme(() => f0, 0.3, v, { art, FB: [T, VB[v][1]], seed: 9 }));
        const c = Math.round(0.15 * TSR), r = D.analyseAt(y, TSR, c, {});
        if (r.voiced) V.push({ r, T, y, c, name: art + ' /' + v + '/ ' + f0 + ' Hz ×' + s });
      }
      let entsch = 0, verletzt = 0, grob = 0, gueltig = 0; const bsp = [];
      for (const { r, T, y, c, name } of V) {
        for (let k = 0; k < 5; k++) if (r.valid[k]) { gueltig++; if (fehler(r, T, k) > 300) { grob++; if (bsp.length < 3) bsp.push(name + ' F' + (k + 1) + ' ' + Math.round(r.F[k]) + ' statt ' + Math.round(T[k])); } }
        if (!(r.teiltonHz > 250)) continue;
        const gesperrt = [false, false, false, false, false];
        for (const L of D.WINDOWS) {
          const n = Math.round(L * TSR), st = c - (n >> 1);
          if (st < 0 || st + n > y.length) continue;
          const w = D.analyseWindow(y.subarray(st, st + n), TSR, {}), fr = typeof D.teiltonFraglich === 'function' ? D.teiltonFraglich(w.peaks, r.teiltonHz) : null;
          if (!fr) continue;
          const mit = D.slotNumberUnsure(w.peaks, w.nOrders, fr), ohne = D.slotNumberUnsure(w.peaks, w.nOrders);
          for (let k = 0; k < 5; k++) if (mit[k] && !ohne[k]) gesperrt[k] = true;
        }
        for (let k = 0; k < 5; k++) if (gesperrt[k] && isFinite(r.F[k])) { entsch++; if (r.valid[k]) { verletzt++; if (bsp.length < 3) bsp.push(name + ' F' + (k + 1) + ' gültig trotz Gipfelpaar'); } }
      }
      check('A3c', 'Gipfelpaare näher als 1,5·F0 (320–370 Hz, Formanten um ±4/8 % verschoben, a/e/i/o/u, Impuls/Rosenberg): jeder Slot, dessen Nummer an dem Paar hängt, ist ungültig (mind. 50 entscheidende Slots); kein gültiger Slot über 300 Hz falsch',
        verletzt === 0 && entsch >= 50 && grob === 0,
        V.length + ' Rahmen, entscheidend ' + entsch + ', trotzdem gültig ' + verletzt + ', gültige Slots ' + gueltig + ', über 300 Hz falsch ' + grob + (bsp.length ? ' — ' + bsp.join(' | ') : ''));
    }

    // A3d: Ist der Grundton unsicher, gilt 2·F0 als Teiltonabstand. /i/ um 455–470 Hz mit Rauschen: YIN nimmt
    // die Unteroktave, die Gegenprobe reißt; ohne diese Regel galt F1 um 510 statt 270–300 Hz als gültig.
    {
      let treffer = 0, gueltig = 0, vertrag = 0, sd = 600; const bsp = [];
      for (const tab of [VH, VB]) for (const f0 of [455, 470]) for (const snr of [30, 40]) {
        const y = ds(mitRauschen(stimme(() => f0, 0.4, 'i', { art: 'impuls', FB: tab.i, jit: 0.01, shim: 0.02, seed: sd++ }), snr, sd + 1000));
        for (let t = 0.1; t <= 0.301; t += 0.05) {
          const r = D.analyseAt(y, TSR, Math.round(t * TSR), {});
          if (!r.voiced) continue;
          if (!(r.teiltonHz === (r.f0Unsure ? 2 * r.f0 : r.f0))) vertrag++;
          if (r.f0Unsure && Math.abs(r.f0 / (f0 / 2) - 1) < 0.06) {
            treffer++;
            const g = r.valid.filter(Boolean).length; gueltig += g;
            if (g && bsp.length < 3) bsp.push('/i/ ' + f0 + ' Hz, F0 ' + r1(r.f0) + ' unsicher: F ' + r.F.map(Math.round).join('/') + ' gültig ' + bits(r.valid));
          }
        }
      }
      check('A3d', 'unsicherer Grundton auf der Unteroktave (/i/ 455–470 Hz, Rauschen 30/40 dB): Teiltonabstand 2·F0, kein Slot gültig (mind. 3 solche Rahmen); teiltonHz = F0 bzw. 2·F0 bei unsicherem Grundton',
        treffer >= 3 && gueltig === 0 && vertrag === 0, treffer + ' Rahmen auf der Unteroktave, gültige Slots darin ' + gueltig + ', Vertrag verletzt ' + vertrag + (bsp.length ? ' — ' + bsp.join(' | ') : ''));
    }

    // A3e: Takes durch analyseTake. Gehaltene hohe Töne (Zielton eines aufsteigenden Bruchs, 410–470 Hz):
    // Zusammenfassung ohne falsche Formanten; Bruch 196 → 440 Hz: kein Rahmen am Zielton mit gültigem F1/F2.
    {
      const take = async (x) => (await H.A.analyseTake(x, SR, {}));
      // Rosenberg-Puls mit Öffnungsquotient oq (Anstieg 2/3, Abfall 1/3), abgeleitet
      function rosen(f0, F, B, oq, dur) {
        const n = Math.round(dur * SR), T = SR / f0, Tp = oq * T * 2 / 3, Tn = oq * T / 3, u = new Float64Array(n);
        for (let i = 0; i < n; i++) { const t = i % T; u[i] = t < Tp ? 0.5 * (1 - Math.cos(Math.PI * t / Tp)) : (t < Tp + Tn ? Math.cos(Math.PI * (t - Tp) / (2 * Tn)) : 0); }
        let y = new Float64Array(n); for (let i = 1; i < n; i++) y[i] = u[i] - u[i - 1];
        for (let m = 0; m < F.length; m++) y = D.resonate(y, F[m], B[m], SR);
        let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i]));
        for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / mx;
        return y;
      }
      const still = s => new Float64Array(Math.round(s * SR));
      const fehl = [];
      // /i/ 443 Hz, Rosenberg (Öffnung 0,7), 40 dB, mit Rauschen davor und danach (Befund N3)
      const si = (await take(mitRauschen(H.concat([still(0.3), rosen(443, [280, 2150, 2750, 3500, 4300], [60, 100, 130, 160, 200], 0.7, 1.2), still(0.3)]), 40, 32))).summary;
      if (!(si.F[1].n === 0 || Math.abs(si.F[1].med - 2150) <= 222)) fehl.push('/i/ 443: F2 ' + Math.round(si.F[1].med) + ' aus ' + si.F[1].n);
      if (!(si.d34.n === 0 || Math.abs(si.d34.med - 750) <= 150)) fehl.push('/i/ 443: ΔF3–4 ' + Math.round(si.d34.med) + ' aus ' + si.d34.n);
      // /u/ 440 Hz und /a/ 466 Hz, Impuls, 40 dB (Befund N14)
      for (const [f0, v, T] of [[440, 'u', [300, 700, 2400, 3300, 4200]], [466, 'a', [680, 1250, 2500, 3300, 4200]]]) {
        const s = (await take(mitRauschen(stimme(() => f0, 1.2, v, { art: 'impuls', FB: [T, VH[v][1]], seed: 40 + f0 }), 40, 41 + f0))).summary;
        for (let k = 0; k < 5; k++) if (s.F[k].n > 0 && Math.abs(s.F[k].med - T[k]) > 130) fehl.push('/' + v + '/ ' + f0 + ': F' + (k + 1) + ' ' + Math.round(s.F[k].med) + ' aus ' + s.F[k].n + ' statt ' + T[k]);
      }
      // Aufsteigender Bruch /a/ 196 → 440 Hz (gehalten 0,45 s), 40 dB
      const FA = [700, 1200, 2500, 3300, 4200], BA = [80, 90, 120, 150, 200];
      const ser = (await take(mitRauschen(H.concat([still(0.3), D.synthVowel(196, FA, BA, 1.0, SR), D.synthVowel(440, FA, BA, 0.45, SR), still(0.3)]), 40, 51))).series;
      let ziel = 0, zielGueltig = 0, tiefGueltig = 0;
      for (let i = 0; i < ser.t.length; i++) {
        if (ser.f0[i] > 420 && ser.f0[i] < 460) { ziel++; if (ser.valid[i] & 3) zielGueltig++; }
        if (ser.f0[i] > 185 && ser.f0[i] < 207 && (ser.valid[i] & 3) === 3) tiefGueltig++;
      }
      if (zielGueltig) fehl.push('Bruch 196 → 440 Hz: ' + zielGueltig + ' Rahmen am Zielton mit gültigem F1/F2');
      check('A3e', 'Takes: /i/ 443 Hz (Rosenberg, 40 dB) F2 und ΔF3–4 nicht gemessen oder richtig; /u/ 440 und /a/ 466 Hz kein falscher Formant in der Zusammenfassung; Bruch /a/ 196 → 440 Hz: am Zielton kein gültiges F1/F2, auf 196 Hz gültig',
        !fehl.length && ziel >= 30 && tiefGueltig >= 50, 'Zielton ' + ziel + ' Rahmen, davon F1/F2 gültig ' + zielGueltig + ', 196 Hz F1/F2 gültig ' + tiefGueltig + '; /i/ 443: F2 n ' + si.F[1].n + ', ΔF3–4 n ' + si.d34.n + (fehl.length ? ' — ' + fehl.join(' | ') : ''));
    }

    // A3f: Gegenprobe und Vertrag. Unter 250 Hz Teiltonabstand ändert die Regel nichts: kein Grund 'teilton',
    // ΔF3–4 gültig genau mit F3 und F4. teiltonFraglich direkt. Stimmlose Rahmen leer.
    {
      let n = 0, falsch = 0; const bsp = [];
      for (const v of Object.keys(VH)) for (const art of ['impuls', 'rosenberg']) for (const f0 of [98, 147, 196, 247]) for (const vib of [false, true]) {
        const y = ds(stimme(vib ? vibrato(() => f0, 6, 50, f0) : () => f0, 0.3, v, { art, FB: VH[v], seed: 70 + f0 }));
        for (const t of [0.12, 0.2]) {
          const r = D.analyseAt(y, TSR, Math.round(t * TSR), {});
          if (!r.voiced || r.teiltonHz > 250) continue;
          n++;
          const e = [];
          if (r.slotGrund.indexOf('teilton') >= 0) e.push('Grund teilton');
          if (r.d34Grund || r.d45Grund) e.push('d34Grund/d45Grund');
          if (r.d34valid !== (r.valid[2] && r.valid[3]) || r.d45valid !== (r.valid[3] && r.valid[4])) e.push('ΔF ungleich Slots');
          if (e.length) { falsch++; if (bsp.length < 3) bsp.push('/' + v + '/ ' + f0 + ' ' + art + ': ' + e.join(', ')); }
        }
      }
      const fr = (P, g) => { if (typeof D.teiltonFraglich !== 'function') return 'fehlt'; const x = D.teiltonFraglich(P, g); return x ? bits(x) : '-'; };
      const u1 = fr([300, 700, 2400, 3300], 300), u2 = fr([701, 1355, 2437, 3131, 4185], 349), u3 = fr([669, 2280, 2705, 3382, 4327], 340);
      const leer = D.analyseAt(ds(new Float64Array(Math.round(0.3 * SR))), TSR, Math.round(0.15 * TSR), {});
      const leerOk = Number.isNaN(leer.teiltonHz) && leer.d34Grund === '' && leer.d45Grund === '';
      check('A3f', 'Gegenprobe unter 250 Hz Teiltonabstand (a/e/i/o/u 98–247 Hz, Impuls/Rosenberg, Vibrato): kein Grund \'teilton\', ΔF3–4/ΔF4–5 gültig genau mit ihren Slots; teiltonFraglich: Paar unter 1,5·F0 fraglich, f4 modal nicht; Pause ohne Werte',
        n >= 70 && falsch === 0 && u1 === '1100' && u2 === '-' && u3 === '01100' && leerOk,
        n + ' Rahmen, abweichend ' + falsch + '; teiltonFraglich ' + [u1, u2, u3].join(' ') + '; Pause ' + (leerOk ? 'leer' : 'nicht leer') + (bsp.length ? ' — ' + bsp.join(' | ') : ''));
    }
  }

  /* ---------- A3g: tiefes enges Cluster, das nur eine LPC-Ordnung trennt ----------
     F3 1700 / F4 2000 Hz (physik.md §4, unter dem Sängerformantband) mit Rauschen: Ordnung 16 trennt beide,
     12 und 14 sehen einen gemeinsamen Gipfel. Die Zuordnung verteilte ihn auf beide Slots, ΔF3–4 schrumpfte
     auf 156–178 statt 300 Hz und galt als gültig. (1) Vertrag je Fenster aus den Gipfeln der Ordnungen
     nachgerechnet: Trennt nur die Referenzordnung ein Paar näher als 400 Hz, ist keiner der beiden Slots
     gültig. (2) Kein gültiges ΔF3–4 über 120 Hz falsch. Signale wie im Prüfsatz K2 (Impulsquelle, LCG-Rauschen
     weiß und rosa, Rauschabstand im Analyseband). */
  {
    const eff = x => { let p = 0; for (let i = 0; i < x.length; i++) p += x[i] * x[i]; return Math.sqrt(p / x.length); };
    function rosa(n, seed) {
      const w = H.noise(n, 1, seed), y = new Float64Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) { const v = w[i]; b0 = 0.99886 * b0 + v * 0.0555179; b1 = 0.99332 * b1 + v * 0.0750759; b2 = 0.96900 * b2 + v * 0.1538520; b3 = 0.86650 * b3 + v * 0.3104856; b4 = 0.55000 * b4 + v * 0.5329522; b5 = -0.7616 * b5 - v * 0.0168980; y[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + v * 0.5362; b6 = v * 0.115926; }
      return y;
    }
    function signal(F, B, f0, art, snr, seed) {
      const x48 = D.synthVowel(f0, F, B, 0.4, SR, { gain: 0.3 }), x = D.resample(x48, SR, TSR);
      const nz = D.resample(art === 'rosa' ? rosa(x48.length, seed) : H.noise(x48.length, 1, seed), SR, TSR);
      const g = eff(x) * Math.pow(10, -snr / 20) / eff(nz), y = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) y[i] = x[i] + g * nz[i];
      return y;
    }
    // Referenzordnung wie analyseWindow: die meisten Gipfel, bei Gleichstand 14, dann 12, dann 16
    function urteil(seg) {
      const win = D.hann(D.preemph(seg, 0.97)), O = D.ORDERS, per = O.map(o => D.formantsFromLPC(D.burg(win, o), TSR, 5));
      let ref = -1, best = -1;
      for (const o of [14, 12, 16]) { const c = O.indexOf(o); if (c >= 0 && per[c].length > best) { best = per[c].length; ref = c; } }
      const R = per[ref], allein = [false, false, false, false, false];
      for (let s = 0; s + 1 < Math.min(5, R.length); s++) {
        const gap = R[s + 1].f - R[s].f; if (!(gap < 400)) continue;
        const lo = R[s].f - gap / 2, hi = R[s + 1].f + gap / 2;
        if (!per.some((p, o) => o !== ref && p.filter(q => q.f >= lo && q.f <= hi).length >= 2)) { allein[s] = true; allein[s + 1] = true; }
      }
      return allein;
    }
    let n = 0, entsch = 0, verletzt = 0, d34 = 0, d34f = 0; const bsp = [];
    for (const [F1, F2] of [[680, 1250], [480, 1400]]) for (const F3 of [1700, 2000]) for (const f0 of [110, 147, 196]) for (const art of ['weiss', 'rosa']) for (const snr of [30, 40]) {
      const T = [F1, F2, F3, F3 + 300, 3050], y = signal(T, [70, 90, 100, 110, 160], f0, art, snr, 99);
      for (let i = 900; i + 900 <= y.length; i += 240) {
        const r = D.analyseAt(y, TSR, i, {}); if (!r.voiced) continue; n++;
        const gesperrt = [false, false, false, false, false];
        for (const L of D.WINDOWS) { const m = Math.round(L * TSR), st = i - (m >> 1); if (st < 0 || st + m > y.length) continue; urteil(y.subarray(st, st + m)).forEach((b, k) => { if (b) gesperrt[k] = true; }); }
        for (let k = 0; k < 5; k++) if (gesperrt[k] && isFinite(r.F[k])) { entsch++; if (r.valid[k]) { verletzt++; if (bsp.length < 3) bsp.push(T.join('/') + ' ' + f0 + ' ' + art + ' ' + snr + ' dB: F' + (k + 1) + ' gültig'); } }
        if (r.d34valid) { d34++; if (Math.abs(r.d34 - 300) > 120) { d34f++; if (bsp.length < 3) bsp.push(T.join('/') + ' ' + f0 + ' ' + art + ' ' + snr + ' dB: ΔF3–4 ' + Math.round(r.d34)); } }
      }
    }
    check('A3g', 'tiefes enges Cluster F3 1700/2000, ΔF3–4 300 Hz (98–196 Hz, Rauschen weiß/rosa 30/40 dB): ein Paar, das nur die Referenzordnung trennt, ist nicht gültig (mind. 20 entscheidende Slots); kein gültiges ΔF3–4 über 120 Hz falsch',
      verletzt === 0 && entsch >= 20 && d34f === 0, n + ' Rahmen, entscheidend ' + entsch + ', trotzdem gültig ' + verletzt + '; ΔF3–4 gültig ' + d34 + ', davon falsch ' + d34f + (bsp.length ? ' — ' + bsp.join(' | ') : ''));
  }

  /* ---------- A3h: Vokalwechsel im Fenster ----------
     Enthält schon das kürzeste Fenster einen Vokalwechsel, sind alle Gipfel Mischwerte, und alle Fenster
     sind sich einig: /a/ → /i/ bei 98 Hz ergab gültig F3 2281 (F2 des /i/), F4 2893, F5 3461. (1) Wechsel ohne
     Pause (neun Vokalpaare, 98–247 Hz, Rahmen alle 10 ms um die Grenze): kein gültiger Slot, der weder zum
     gleichnamigen Formanten des alten noch des neuen Vokals passt (± 130 Hz), kein solches ΔF3–4 (± 120 Hz).
     (2) Vertrag: huellAbstandDb = huellAbstand des kürzesten Fensters; über HUELL_WECHSEL_DB kein Slot
     gültig. (3) Gegenprobe: stehende Vokale (Impuls/Rosenberg, Jitter, Vibrato, Rauschen 30/40 dB) nie
     'wechsel'. */
  {
    const BW5 = [80, 90, 120, 150, 200];
    const VW = { a: [[700, 1200, 2500, 3300, 4200], BW5], i: [[300, 2200, 2900, 3500, 4300], [60, 100, 130, 160, 200]], u: [[320, 800, 2400, 3300, 4200], [60, 90, 120, 150, 200]],
      weit: [[500, 1500, 2300, 3350, 4300], [70, 90, 130, 170, 220]], o: [[450, 800, 2500, 3300, 4200], [70, 90, 120, 150, 200]], e: [[400, 1900, 2600, 3400, 4300], [60, 100, 130, 160, 200]] };
    const hatH = typeof D.huellAbstand === 'function', grenze = D.HUELL_WECHSEL_DB;
    let n = 0, falsch = 0, d34f = 0, wechsel = 0, vertrag = 0; const bsp = [];
    for (const [x, y] of [['a', 'i'], ['u', 'e'], ['o', 'a'], ['i', 'u'], ['weit', 'i'], ['e', 'o'], ['a', 'u'], ['i', 'e'], ['u', 'a']]) for (const f0 of [98, 110, 147, 196, 247]) {
      const ds = D.resample(H.concat([D.synthVowel(f0, VW[x][0], VW[x][1], 0.5, SR), D.synthVowel(f0, VW[y][0], VW[y][1], 0.5, SR)]), SR, TSR);
      for (let t = 0.40; t <= 0.60 + 1e-9; t += 0.01) {
        const c = Math.round(t * TSR), r = D.analyseAt(ds, TSR, c, { floorDb: -70 }); if (!r.voiced) continue; n++;
        const A = VW[x][0], B = VW[y][0];
        for (let k = 0; k < 5; k++) if (r.valid[k] && Math.abs(r.F[k] - A[k]) > 130 && Math.abs(r.F[k] - B[k]) > 130) { falsch++; if (bsp.length < 3) bsp.push(x + '→' + y + ' ' + f0 + ' Hz t ' + t.toFixed(2) + ' F' + (k + 1) + ' ' + Math.round(r.F[k])); }
        if (r.d34valid && Math.abs(r.d34 - (A[3] - A[2])) > 120 && Math.abs(r.d34 - (B[3] - B[2])) > 120) d34f++;
        if (r.slotGrund.indexOf('wechsel') >= 0) wechsel++;
        const m = Math.round(D.WINDOWS[0] * TSR), st = c - (m >> 1);
        const soll = hatH ? D.huellAbstand(ds.subarray(st, st + m), TSR) : NaN;
        if (!(Math.abs(r.huellAbstandDb - soll) < 1e-9) || (r.huellAbstandDb > grenze && r.valid.some(Boolean))) vertrag++;
      }
    }
    check('A3h', 'Vokalwechsel ohne Pause (neun Paare, 98–247 Hz): kein gültiger Slot, der zu keinem der beiden Vokale passt, kein solches ΔF3–4; Hüllkurvenabstand der Fensterhälften über der Grenze → kein Slot gültig (mind. 20 Rahmen mit Grund \'wechsel\')',
      falsch === 0 && d34f === 0 && vertrag === 0 && wechsel >= 20, n + ' Rahmen, falsch-gültig ' + falsch + ', ΔF3–4 ' + d34f + ', mit Grund wechsel ' + wechsel + ', Vertrag verletzt ' + vertrag + (bsp.length ? ' — ' + bsp.join(' | ') : ''));
    let m = 0, fehl = 0, mx = 0; const bspG = [];
    for (const v of ['a', 'e', 'i', 'o', 'u']) for (const art of ['impuls', 'rosenberg']) for (const f0 of [98, 147, 196, 247]) for (const vib of [false, true]) for (const snr of [30, 40]) {
      const fz = vib ? vibrato(() => f0, 6, 50, f0) : () => f0;
      const y = D.resample(mitRauschen(stimme(fz, 0.3, v, { art, FB: VW[v], jit: 0.01, shim: 0.02, seed: 300 + f0 }), snr, 301 + f0), SR, TSR);
      for (const t of [0.1, 0.15, 0.2]) {
        const r = D.analyseAt(y, TSR, Math.round(t * TSR), {}); if (!r.voiced) continue; m++;
        if (r.huellAbstandDb > mx) mx = r.huellAbstandDb;
        if (r.slotGrund.indexOf('wechsel') >= 0) { fehl++; if (bspG.length < 3) bspG.push('/' + v + '/ ' + f0 + ' ' + art + ' ' + snr + ' dB: ' + r1(r.huellAbstandDb) + ' dB'); }
      }
    }
    check('A3h', 'Gegenprobe: stehende Vokale (a/e/i/o/u 98–247 Hz, Impuls/Rosenberg, Jitter 1 %, Shimmer 2 %, Vibrato ±50 Cent, Rauschen 30/40 dB) nie \'wechsel\'',
      m >= 300 && fehl === 0, m + ' Rahmen, größter Hüllkurvenabstand ' + r1(mx) + ' dB, mit wechsel ' + fehl + (bspG.length ? ' — ' + bspG.join(' | ') : ''));
  }

  /* ---------- A4: Grundton bei starkem Hauch ----------
     Behauchte Stimme (Rauschen in der Anregung, exakter HNR) mit rosa Raumrauschen: YIN und Cepstrum nehmen
     gemeinsam einen Unterton, und die Gegenprobe bestand, weil die Teiltonreihe den Abstand von 20 dB im
     Rauschen nie erreicht (Befund N17 und dieselbe Klasse in der Mittellage). Wahrheit ist der Grundton der
     Synthese; „daneben“ heißt mehr als 3 % (eine Marke ist f0Unsure oder octaveAmbiguous). */
  const { quelle: q4, rampen: rampen4, raum: raum4, pause: pause4, rahmenBei: rahmen4 } = hilfen.a2;
  const zeiten4 = (a, b, d) => { const t = []; for (let x = a; x <= b + 1e-9; x += d) t.push(+x.toFixed(3)); return t; };
  const name4 = (r, v, rest) => NAME[v] + ' ' + rest + ' t ' + r.t.toFixed(2) + ': f0 ' + r1(r.f0) + ' (YIN ' + r1(r.f0Yin) + ', Cepstrum ' + r1(r.f0Cep) + ')' + (r.f0Korrektur ? ' korrigiert' : '');
  const markiert4 = r => r.f0Unsure || r.octaveAmbiguous;

  /* A4a Hohe Lage (Befund N17): Qualitätseinbruch am oberen Ende eines Bruchs, hier über den ganzen Ton gehalten.
     YIN und Cepstrum nahmen gemeinsam f0/4 bis f0/7 (404 Hz → 101 Hz), oder die Korrektur setzte einen
     Unterton. /e/ mit F1 ≈ F0 steht 3–6 % zu hoch ohne Marke — kein Unterton, ein anderer Mechanismus (offen,
     im Bericht). */
  {
    let s4 = 40000; const R = [], E = [];
    for (const v of ['i', 'u', 'e']) for (const f0 of [404, 413, 425, 440, 449, 452, 458, 466]) for (const hnr of [5, 6]) for (const snr of [30, 35]) for (let sd = 0; sd < 2; sd++) {
      const x = raum4(H.concat([pause4(0.2), rampen4(q4({ f0, dur: 0.6, jit: 0.015, shim: 0.03, hnr, seed: s4++ }, v), 0.02, 0.02), pause4(0.15)]), snr, s4++);
      for (const r of rahmen4(x, zeiten4(0.28, 0.72, 0.02))) if (r.voiced) { r.soll = f0; r.nm = name4(r, v, f0 + ' HNR ' + hnr + ' SNR ' + snr); (v === 'e' ? E : R).push(r); }
    }
    const daneben = r => Math.abs(r.f0 / r.soll - 1) > 0.03, ohne = R.filter(r => daneben(r) && !markiert4(r)), korr = R.filter(r => daneben(r) && r.f0Korrektur);
    const unterE = E.filter(r => daneben(r) && !markiert4(r) && r.f0 < 0.8 * r.soll), nahE = E.filter(r => daneben(r) && !markiert4(r) && r.f0 >= 0.8 * r.soll), korrE = E.filter(r => daneben(r) && r.f0Korrektur);
    check('A4a', 'hohe Lage mit starkem Hauch (Befund N17: /i/ /u/ 404–466 Hz, Rosenberg, HNR 5/6 dB, Jitter 1,5 %, Shimmer 3 %, rosa Raumrauschen 30/35 dB): kein Grundton mehr als 3 % neben dem Sollton ohne f0Unsure oder octaveAmbiguous, keine Korrektur auf einen falschen Wert; bei /e/ kein Unterton ohne Marke',
      R.length >= 1500 && ohne.length === 0 && korr.length === 0 && unterE.length === 0,
      R.length + ' Rahmen /i/ /u/, daneben ohne Marke ' + ohne.length + ', falsch korrigiert ' + korr.length + ', /e/ Unterton ohne Marke ' + unterE.length +
      (ohne.length + korr.length + unterE.length ? ' — ' + ohne.concat(korr, unterE).slice(0, 4).map(r => r.nm).join(' | ') : '') +
      '; offen: /e/ (F1 ≈ F0) 3–6 % zu hoch ohne Marke ' + nahE.length + ', dorthin korrigiert ' + korrE.length + ' von ' + E.length + (nahE.length ? ', z. B. ' + nahE[0].nm : ''));
  }

  /* A4b Unterton in behauchter Stimme: /a e i o u/ 98–247 Hz, HNR 5/8/12 dB. Vorher standen 28 % der Rahmen auf
     f0/2 … f0/7 ohne Marke, dazu Korrekturen auf einen Unterton. Rest an der Nachweisgrenze (Rauschspitzen täuschen
     die Reihe vor, oder die bekannten Linien ragen kaum 8 dB heraus) steht im Bericht. */
  {
    let s4 = 41000; const R = [];
    for (const hnr of [5, 8, 12]) for (const v of ['a', 'e', 'i', 'o', 'u']) for (const f0 of [98, 110, 123, 139, 156, 175, 196, 220, 247]) {
      const x = raum4(rampen4(q4({ f0, dur: 0.9, jit: 0.008, shim: 0.02, hnr, seed: s4++ }, v), 0.03, 0.03), 40, s4++);
      for (const r of rahmen4(x, zeiten4(0.2, 0.7, 0.02))) if (r.voiced) { r.soll = f0; r.nm = name4(r, v, f0 + ' HNR ' + hnr); R.push(r); }
    }
    const unterton = r => { for (let k = 2; k <= 7; k++) if (Math.abs(k * r.f0 / r.soll - 1) <= 0.03) return true; return false; };
    const richtig = R.filter(r => Math.abs(r.f0 / r.soll - 1) <= 0.03), unter = R.filter(unterton);
    const ohne = unter.filter(r => !markiert4(r)), korr = unter.filter(r => r.f0Korrektur), fehl = richtig.filter(r => r.f0Grund === 'teiltonreihe');
    check('A4b', 'behauchte Stimme (Rosenberg, HNR 5/8/12 dB, /a e i o u/ 98–247 Hz, Raumrauschen 40 dB), Grundton auf einem Unterton (f0/2 … f0/7): höchstens 1 % ohne f0Unsure oder octaveAmbiguous (vorher 28 %), keiner durch die Korrektur dorthin gesetzt; richtige Grundtöne höchstens zu 0,5 % mit Grund \'teiltonreihe\'',
      R.length >= 3000 && unter.length >= 300 && ohne.length <= 0.01 * unter.length && korr.length === 0 && fehl.length <= 0.005 * richtig.length,
      R.length + ' Rahmen, richtig ' + richtig.length + ' (davon \'teiltonreihe\' ' + fehl.length + '), Unterton ' + unter.length + ', ohne Marke ' + ohne.length + ', dorthin korrigiert ' + korr.length +
      (ohne.length ? ' — offen (Nachweisgrenze): ' + ohne.slice(0, 4).map(r => r.nm).join(' | ') : '') + (korr.length ? ' — ' + korr.slice(0, 3).map(r => r.nm).join(' | ') : ''));
  }

  /* A4c Oktave darüber: Im Hauch steht von der ungeraden Reihe bei f/2 nur der tiefe Teil über dem Rauschen; die
     Teilerkontrolle teilte nicht und meldete nichts, YIN oder die Korrektur blieben auf 2·F0 (/o/ /e/ mit F1 nahe
     2·F0). Jetzt „Oktave offen“ (octaveAmbiguous). Der Anteil richtiger Grundtöne mit dieser Marke steht im
     Bericht (er stammt überwiegend aus dem schmalen Band −25…−20 dB, das es schon vorher gab). */
  {
    let s4 = 42000; const R = [];
    for (const v of ['o', 'e']) for (const f0 of [196, 208, 220, 233]) for (const hnr of [5, 8]) for (const vib of [0, 40]) for (let sd = 0; sd < 2; sd++) {
      const fz = vib ? vibrato(() => f0, 5.5, vib, sd) : () => f0;
      const x = raum4(rampen4(q4({ f0: fz, dur: 0.9, jit: 0.008, shim: 0.02, hnr, seed: s4++ }, v), 0.03, 0.03), 40, s4++);
      for (const r of rahmen4(x, zeiten4(0.2, 0.7, 0.02))) if (r.voiced) { r.soll = fz(r.t); r.nm = name4(r, v, f0 + ' HNR ' + hnr + (vib ? ' Vibrato' : '')); R.push(r); }
    }
    const hoch = R.filter(r => Math.abs(r.f0 / (2 * r.soll) - 1) <= 0.03), richtig = R.filter(r => Math.abs(r.f0 / r.soll - 1) <= 0.03);
    const ohne = hoch.filter(r => !markiert4(r)), korr = hoch.filter(r => r.f0Korrektur), amb = richtig.filter(r => r.octaveAmbiguous);
    check('A4c', 'behauchte Stimme mit F1 nahe 2·F0 (/o/ /e/ 196–233 Hz, HNR 5/8 dB, mit Vibrato, Raumrauschen 40 dB), Grundton eine Oktave zu hoch: jeder trägt octaveAmbiguous oder f0Unsure, keiner durch die Korrektur dorthin gesetzt',
      R.length >= 1000 && hoch.length >= 30 && ohne.length === 0 && korr.length === 0,
      R.length + ' Rahmen, Oktave zu hoch ' + hoch.length + ', ohne Marke ' + ohne.length + ', dorthin korrigiert ' + korr.length + (ohne.length + korr.length ? ' — ' + ohne.concat(korr).slice(0, 4).map(r => r.nm).join(' | ') : '') +
      '; Bericht: richtige Grundtöne mit „Oktave offen“ ' + amb.length + ' von ' + richtig.length);
  }
};

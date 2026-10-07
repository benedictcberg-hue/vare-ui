/* Kriterien der Nachprüfung, Rechenkern.
   A1: zweite Tonhöhenspur (pitchTrackFine) und Sprungerkennung (detectJumps) —
     A1a Oktavkontrolle der Feinspur (F1 ≈ 2·F0).
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
};

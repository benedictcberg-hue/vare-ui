/* Kriterien K1: zweite Tonhöhenspur (pitchTrackFine) und Sprungerkennung (detectJumps).
   Kriterien K2: Formant-Nummerierung und Gültigkeit im Fenstersweep (analyseAt).
   Testsignale: allgemeine Baritonlage 75–470 Hz, synthetische Vokale mit bekannter Wahrheit.
   Reißt ein Kriterium, ist das ein Befund — Schwelle nicht anheben. */
'use strict';
module.exports = async function (H) {
  const { check, D, SR, TSR, noise, concat, r0, r1 } = H;

  /* ---------- Signale ---------- */
  const VOK = {
    a: [[700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200]],
    o: [[450, 800, 2500, 3300, 4200], [70, 90, 120, 150, 200]],
    u: [[320, 800, 2400, 3300, 4200], [60, 90, 120, 150, 200]],
    i: [[300, 2200, 2900, 3500, 4300], [60, 100, 130, 160, 200]]
  };
  const ton = (f, s, v) => D.synthVowel(f, VOK[v || 'a'][0], VOK[v || 'a'][1], s, SR, { gain: 0.3 });
  const HT = (f, n) => f * Math.pow(2, n / 12);
  const still = s => new Float64Array(Math.round(s * SR));
  // Rauschen mit Effektivwert db dBFS (gleichverteiltes LCG-Rauschen: Effektivwert = Amplitude/√3)
  const rausch = (s, db, seed) => noise(Math.round(s * SR), Math.pow(10, db / 20) * Math.sqrt(3), seed || 77);
  // Ton mit beliebigem F0-Verlauf fHz(t): Impulse auf Bruchteile von Abtastwerten gesetzt (wie synthVowel)
  function tonF(fHz, s, v, amp) {
    const n = Math.round(s * SR), src = new Float64Array(n); let ph = 0;
    for (let i = 0; i < n; i++) {
      const f = fHz(i / SR), nph = ph + f / SR;
      if (nph >= 1) {
        const pos = i + (1 - ph) / (f / SR), i0 = Math.floor(pos), q = pos - i0, g = amp ? amp(i / SR) : 1;
        for (let j = 0; j < 6; j++) { const w = g * Math.cos(Math.PI * j / 12); if (i0 + j < n) src[i0 + j] += w * (1 - q); if (i0 + j + 1 < n) src[i0 + j + 1] += w * q; }
        ph = nph - 1;
      } else ph = nph;
    }
    let y = src; const [F, B] = VOK[v || 'a'];
    for (let m = 0; m < F.length; m++) y = D.resonate(y, F[m], B[m], SR);
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i]));
    for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / mx;
    return y;
  }
  const vib = (f, s, v, rate, cent, phase) => tonF(t => f * Math.pow(2, cent / 1200 * Math.sin(2 * Math.PI * rate * t + (phase || 0))), s, v);
  const pegel = (x, db) => { const g = Math.pow(10, db / 20), y = new Float64Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] * g; return y; };
  // weißes Rauschen im Abstand snr dB zum Effektivwert des Signals
  const mitRauschen = (x, snr, seed) => { let p = 0; for (let i = 0; i < x.length; i++) p += x[i] * x[i];
    const nz = noise(x.length, Math.sqrt(p / x.length) * Math.pow(10, -snr / 20) * Math.sqrt(3), seed), y = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) y[i] = x[i] + nz[i]; return y; };
  const spur = sig => D.pitchTrackFine(D.resample(sig, SR, TSR), TSR, {});
  const ereig = (sig, jo) => D.detectJumps(spur(sig), jo || {});
  const kurz = e => e.length + (e.length ? ' [' + e.slice(0, 3).map(x => x.art + ' ' + r0(x.dauerS * 1000) + 'ms ' + r1(x.halbtoene) + 'HT@' + x.startS.toFixed(2)).join(', ') + (e.length > 3 ? ', …' : '') + ']' : '');
  // Sammelprüfung: zählt Fälle, nennt die ersten Abweichungen
  function sammle(faelle) {
    let ok = 0; const bad = [];
    for (const f of faelle) { const e = ereig(f.sig, f.jo); if (f.soll(e)) ok++; else bad.push(f.name + ': ' + kurz(e)); }
    return { ok, n: faelle.length, detail: ok + '/' + faelle.length + (bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : '') };
  }
  const keins = e => e.length === 0;

  /* ---------- K1b: Atempause beginnt neu, kurze Lücken behalten den Bezug ---------- */
  {
    // Neue Phrase nach einer Atempause auf anderem Ton (±5…12 HT): kein Sprung.
    const paare = [[196, 7], [220, -7], [147, 5], [196, 12], [165, -12], [247, -5], [294, -12], [98, 9], [110, 10], [82, 12]];
    for (const p of [0.2, 0.3, 0.5, 1.0]) {
      const faelle = [];
      for (const art of ['Stille', 'Rauschen -70 dBFS']) for (const [a, n] of paare)
        faelle.push({ name: a + (n > 0 ? '+' : '') + n + ' ' + art, sig: concat([ton(a, 1), art === 'Stille' ? still(p) : rausch(p, -70), ton(HT(a, n), 1)]), soll: keins });
      const r = sammle(faelle);
      check('K1b', 'Atempause ' + String(p).replace('.', ',') + ' s (Stille oder Rauschen), neue Phrase ±5…12 HT: kein Sprung', r.ok === r.n, r.detail);
    }
    // Konsonantenlücken 20–60 ms innerhalb der Phrase löschen den Bezug nicht.
    const luecken = [];
    for (const g of [0.02, 0.03, 0.04, 0.05, 0.06]) for (const art of ['Stille', 'Rauschen -40 dBFS']) luecken.push([g, art, s => art === 'Stille' ? still(s) : rausch(s, -40, 99)]);
    let r = sammle(luecken.map(([g, art, lu]) => ({ name: 'Lücke ' + g * 1000 + ' ms ' + art,
      sig: concat([ton(196, 0.6), lu(g), ton(392, 0.3), ton(196, 0.6)]),
      soll: e => e.length === 1 && e[0].art === 'gehalten' && Math.abs(e[0].halbtoene - 12) <= 1 })));
    check('K1b', 'Konsonantenlücke 20–60 ms, danach gehaltener Sprung +12 HT: Bezug bleibt, genau ein gehaltenes Ereignis', r.ok === r.n, r.detail);
    r = sammle(luecken.map(([g, art, lu]) => ({ name: 'Lücke ' + g * 1000 + ' ms ' + art,
      sig: concat([ton(196, 0.6), lu(g), ton(392, 0.05), ton(196, 0.6)]),
      soll: e => e.length === 1 && e[0].art === 'kante' && Math.abs(e[0].halbtoene - 12) <= 1 })));
    check('K1b', 'Konsonantenlücke 20–60 ms, danach Kiekser 50 ms: genau eine Kante +12 HT', r.ok === r.n, r.detail);
    r = sammle(luecken.map(([g, art, lu]) => ({ name: 'Lücke ' + g * 1000 + ' ms ' + art,
      sig: concat([ton(196, 0.6), lu(g), ton(294, 0.3), lu(g), ton(294, 0.3), lu(g), ton(294, 0.3)]),
      soll: e => e.length === 1 && e[0].art === 'gehalten' })));
    check('K1b', 'G3, dann drei Silben auf D4 mit Konsonantenlücken: ein gehaltenes Ereignis, nicht eines je Silbe', r.ok === r.n, r.detail);
    r = sammle(luecken.map(([g, art, lu]) => ({ name: 'Lücke ' + g * 1000 + ' ms ' + art, sig: concat([ton(196, 0.6), lu(g), ton(196, 0.6)]), soll: keins })));
    check('K1b', 'gleicher Ton nach Konsonantenlücke: kein Sprung', r.ok === r.n, r.detail);
    // Staccato: Töne 50–70 ms, Lücken 30–80 ms
    const stacGleich = [], stacWechsel = [];
    for (const tl of [0.05, 0.06, 0.07]) for (const gl of [0.03, 0.05, 0.08]) for (const [lo, hi] of [[196, 330], [147, 294]]) {
      const t1 = [ton(lo, 0.5)], t2 = [ton(lo, 0.5)]; let aus = 0;
      for (let k = 0; k < 8; k++) { t1.push(still(gl), ton(lo, tl)); const hoch = k % 2 === 0; if (hoch) aus++; t2.push(still(gl), ton(hoch ? hi : lo, tl)); }
      t1.push(still(gl), ton(lo, 0.3)); t2.push(still(gl), ton(lo, 0.3));
      const nm = lo + '/' + hi + ' Ton ' + tl * 1000 + ' ms Lücke ' + gl * 1000 + ' ms';
      stacGleich.push({ name: nm, sig: concat(t1), soll: keins });
      stacWechsel.push({ name: nm, sig: concat(t2), soll: e => e.length === aus && e.every(x => x.art === 'kante') });
    }
    r = sammle(stacGleich);
    check('K1b', 'Staccato auf einem Ton (Töne 50–70 ms, Lücken 30–80 ms): kein Sprung', r.ok === r.n, r.detail);
    r = sammle(stacWechsel);
    check('K1b', 'Staccato im Wechsel (Ausflug je zweiter Ton): eine Kante je Ausflug, keine gehaltene', r.ok === r.n, r.detail);
    // Randprüfung: Rahmen mit Ton-Rand im Fenster sind markiert, f0 und ap bleiben roh stehen
    const tr = spur(concat([ton(98, 0.5), still(0.3)]));
    let randAmEnde = 0, randMitte = 0, roh = true;
    const rand = tr.rand || [];
    for (let k = 0; k < tr.t.length; k++) {
      if (rand[k] && tr.t[k] > 0.48 && tr.t[k] < 0.52) randAmEnde++;
      if (rand[k] && tr.t[k] > 0.1 && tr.t[k] < 0.4) randMitte++;
      if (rand[k] && !(typeof tr.f0[k] === 'number' && typeof tr.ap[k] === 'number')) roh = false;
    }
    check('K1b', 'Feinspur: Rahmen mit Tonende im Fenster sind als Rand markiert, im stehenden Ton keiner; Messwerte bleiben roh', randAmEnde > 0 && randMitte === 0 && roh, 'Rand am Ende ' + randAmEnde + ', im Ton ' + randMitte);
  }

  /* ---------- K1a: Feinspur über den ganzen Baritonbereich 75–470 Hz ---------- */
  {
    // Raster: 75–130 Hz in Halbtönen, darüber in Ganztönen bis 470 Hz
    const raster = [];
    for (let k = 0; 75 * Math.pow(2, k / 12) <= 130.5; k++) raster.push(75 * Math.pow(2, k / 12));
    for (let k = 1; 130 * Math.pow(2, 2 * k / 12) <= 471; k++) raster.push(130 * Math.pow(2, 2 * k / 12));
    const VS = ['a', 'o', 'u', 'i'];
    // Richtige F0 in der Feinspur: Anteil der Rahmen innerhalb 1 HT der Wahrheit, schlechtester Ton
    let schlecht = 1, schlechtName = '';
    for (const f of raster.filter(x => x < 125)) for (const v of VS) {
      const tr = spur(ton(f, 1, v)); let r = 0;
      for (let k = 0; k < tr.t.length; k++) if (isFinite(tr.f0[k]) && tr.ap[k] < 0.45 && Math.abs(12 * Math.log2(tr.f0[k] / f)) < 1) r++;
      if (r / tr.t.length <= schlecht) { schlecht = r / tr.t.length; schlechtName = r0(f) + ' Hz /' + v + '/'; }
    }
    check('K1a', 'Feinspur 75–120 Hz, Vokale a/o/u/i: mindestens 95 % der Rahmen mit richtiger F0 (±1 HT)', schlecht >= 0.95, 'schlechtester Ton ' + schlechtName + ' ' + (100 * schlecht).toFixed(0) + ' %');
    const arten = [
      ['stehend', (f, v) => ton(f, 2, v)],
      ['Vibrato 6 Hz ±50 Cent', (f, v) => vib(f, 2, v, 6, 50)],
      ['Wobble 3,5 Hz ±30 Cent', (f, v) => vib(f, 2, v, 3.5, 30, 1)]
    ];
    for (const [art, gen] of arten) {
      const faelle = [];
      for (const f of raster) for (const v of VS) faelle.push({ name: r0(f) + ' Hz /' + v + '/', sig: gen(f, v), soll: keins });
      const r = sammle(faelle);
      check('K1a', 'Töne 75–470 Hz ' + art + ', a/o/u/i, je 2 s: kein Sprung', r.ok === r.n, r.detail);
    }
    // Robustheit: Rauschen 30/40 dB, Jitter 1 % mit Shimmer 5 %, Tremolo ±3 dB, Gerät mit 44,1 kHz
    {
      let lcg = 99; const rnd = () => { lcg = (lcg * 1664525 + 1013904223) >>> 0; return lcg / 4294967296 * 2 - 1; };
      const jitter = (f, s, v) => { const n = Math.round(s * SR), src = new Float64Array(n); let pos = 0;
        while (pos < n) { const T = SR / f * (1 + 0.01 * rnd()), g = 1 + 0.05 * rnd(), i0 = Math.floor(pos), q = pos - i0;
          for (let j = 0; j < 6; j++) { const w = g * Math.cos(Math.PI * j / 12); if (i0 + j < n) src[i0 + j] += w * (1 - q); if (i0 + j + 1 < n) src[i0 + j + 1] += w * q; } pos += T; }
        let y = src; const [F, B] = VOK[v]; for (let m = 0; m < F.length; m++) y = D.resonate(y, F[m], B[m], SR);
        let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i])); for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / mx; return y; };
      const faelle = [];
      for (const f of [75, 98, 123, 165, 220, 294, 392, 466]) for (const v of ['a', 'i']) {
        faelle.push({ name: f + ' /' + v + '/ SNR 30', sig: mitRauschen(ton(f, 2, v), 30, f + 1), soll: keins });
        faelle.push({ name: f + ' /' + v + '/ SNR 40', sig: mitRauschen(ton(f, 2, v), 40, f + 2), soll: keins });
        faelle.push({ name: f + ' /' + v + '/ Jitter', sig: jitter(f, 2, v), soll: keins });
        faelle.push({ name: f + ' /' + v + '/ Tremolo', sig: tonF(() => f, 2, v, t => Math.pow(10, 3 / 20 * Math.sin(2 * Math.PI * 5 * t))), soll: keins });
      }
      let r = sammle(faelle);
      const r44 = faelle.length; let ok44 = 0; const bad44 = [];
      for (const f of [75, 98, 123, 165, 220, 294, 392, 466]) { const e = D.detectJumps(D.pitchTrackFine(D.resample(D.resample(ton(f, 2, 'o'), SR, 44100), 44100, TSR), TSR, {}), {}); if (!e.length) ok44++; else bad44.push(f + ' Hz: ' + kurz(e)); }
      check('K1a', 'stehende Töne mit Rauschen (SNR 30/40 dB), Jitter/Shimmer, Tremolo: kein Sprung', r.ok === r.n, r.detail);
      check('K1a', 'stehende Töne, Gerät mit 44,1 kHz: kein Sprung', ok44 === 8, ok44 + '/8' + (bad44.length ? ' — ' + bad44.slice(0, 2).join(' | ') : ''));
    }
    // Kiekser 50 ms: genau eine Kante, +12 ± 1 HT
    const kiek1 = e => e.length === 1 && e[0].art === 'kante' && Math.abs(e[0].halbtoene - 12) <= 1;
    for (const [a, b] of [[98, 196], [196, 392], [350, 700]]) {
      const faelle = VS.map(v => ({ name: '/' + v + '/', sig: concat([ton(a, 1, v), ton(b, 0.05, v), ton(a, 1, v)]), soll: kiek1 }));
      for (const db of [-12, -6, 6, 12]) faelle.push({ name: 'Kiekser ' + (db > 0 ? '+' : '') + db + ' dB', sig: concat([ton(a, 1), pegel(ton(b, 0.05), db), ton(a, 1)]), soll: kiek1 });
      const r = sammle(faelle);
      check('K1a', 'Kiekser 50 ms ' + a + ' → ' + b + ' → ' + a + ' Hz (a/o/u/i, auch ±6/±12 dB Pegelsprung): genau eine Kante +12 ± 1 HT', r.ok === r.n, r.detail);
    }
    {
      const faelle = [];
      for (const [a, b] of [[75, 150], [82, 165], [110, 220], [123, 247], [262, 523], [440, 880], [470, 940]]) for (const v of VS)
        faelle.push({ name: a + '→' + b + ' /' + v + '/', sig: concat([ton(a, 1, v), ton(b, 0.05, v), ton(a, 1, v)]), soll: kiek1 });
      const r = sammle(faelle);
      check('K1a', 'Kiekser 50 ms aus 75–470 Hz, Oktavflip bis 940 Hz: genau eine Kante +12 ± 1 HT', r.ok === r.n, r.detail);
    }
    // gehaltene Wechsel aufwärts +11 und +16 HT, 300 ms: gehalten, Weite ±1 HT, Dauer ±30 ms
    {
      const faelle = [];
      for (const a of [82, 98, 123, 147, 165, 175, 196, 220, 247]) for (const ht of [11, 16]) for (const v of VS)
        faelle.push({ name: a + '+' + ht + ' /' + v + '/', sig: concat([ton(a, 1, v), ton(HT(a, ht), 0.3, v), ton(a, 1, v)]),
          soll: e => e.length === 1 && e[0].art === 'gehalten' && e[0].richtung === 'auf' && Math.abs(e[0].halbtoene - ht) <= 1 && Math.abs(e[0].dauerS - 0.3) <= 0.03 });
      const r = sammle(faelle);
      check('K1a', 'gehaltener Wechsel +11/+16 HT, 300 ms, aus 82–247 Hz: gehalten, aufwärts, Weite ±1 HT, Dauer ±30 ms', r.ok === r.n, r.detail);
    }
    // Weite: Randrahmen (Mischfenster) dürfen Weite und Richtung nicht bestimmen
    {
      const faelle = [];
      for (const a of [82, 98, 147, 196, 220, 247]) for (const ht of [11, 12, 16]) for (const d of [0.05, 0.3]) for (const v of ['a', 'u', 'i'])
        faelle.push({ name: a + '+' + ht + ' ' + d * 1000 + ' ms /' + v + '/', sig: concat([ton(a, 0.6, v), ton(HT(a, ht), d, v), ton(a, 0.6, v)]),
          soll: e => e.length === 1 && Math.abs(e[0].halbtoene - ht) <= 1 && e[0].nachHz > 0 && Math.abs(12 * Math.log2(e[0].nachHz / HT(a, ht))) <= 1 });
      const r = sammle(faelle);
      check('K1a', 'Weite und Zielton eines Sprungs (Kiekser und gehalten, +11/+12/+16 HT): genau ein Ereignis, ±1 HT', r.ok === r.n, r.detail);
    }
    // tiefe Lage: Kiekser nach Konsonantenlücke, Staccato 110/165 Hz
    {
      const faelle = [];
      for (const g of [0.02, 0.04, 0.06]) for (const art of ['Stille', 'Rauschen']) {
        const lu = art === 'Stille' ? still(g) : rausch(g, -40, 99);
        faelle.push({ name: 'Lücke ' + g * 1000 + ' ms ' + art, sig: concat([ton(98, 0.6), lu, ton(196, 0.05), ton(98, 0.6)]), soll: kiek1 });
      }
      for (const tl of [0.05, 0.07]) for (const gl of [0.03, 0.08]) {
        const t2 = [ton(110, 0.5)]; let aus = 0;
        for (let k = 0; k < 8; k++) { const hoch = k % 2 === 0; if (hoch) aus++; t2.push(still(gl), ton(hoch ? 165 : 110, tl)); }
        t2.push(still(gl), ton(110, 0.3));
        faelle.push({ name: 'Staccato 110/165 ' + tl * 1000 + '/' + gl * 1000, sig: concat(t2), soll: e => e.length === aus && e.every(x => x.art === 'kante') });
      }
      const r = sammle(faelle);
      check('K1a', 'tiefe Lage: Kiekser 98 → 196 Hz nach Konsonantenlücke, Staccato 110/165 Hz: richtig gezählt', r.ok === r.n, r.detail);
    }
    // Portamento in tiefer Lage ist kein Sprung (T26 prüft 196 → 294 Hz)
    {
      const gleit = (a, b, d, v) => tonF(t => a * Math.pow(b / a, Math.min(1, Math.max(0, (t - 0.5) / d))), 1.5, v);
      const faelle = [];
      for (const [a, b] of [[98, 147], [82, 123], [110, 165], [294, 440]]) for (const v of ['a', 'i']) faelle.push({ name: a + '→' + b + ' /' + v + '/', sig: gleit(a, b, 0.5, v), soll: keins });
      const r = sammle(faelle);
      check('K1a', 'Portamento über eine Quinte in 0,5 s, auch in tiefer Lage: kein Sprung', r.ok === r.n, r.detail);
    }
  }

  /* ---------- K1c: Bruch mit Qualitätseinbruch am Übergang wird richtig gezählt ---------- */
  /* Simulierter aufsteigender Bruch (aus 165–247 Hz nach 415–466 Hz, gehalten 300 ms): zwischen altem
     und neuem Ton 30–60 ms vokalgefiltertes Rauschen oder stark aperiodische Impulse (Jitter ±30 %,
     Shimmer ±50 %) mit dem Pegel des Tons. Soll: genau ein gehaltenes Ereignis in Richtung des
     Sprungs, kein gehaltenes in Gegenrichtung. Bewertet wird nur die Zählung, nicht ob es ein Bruch ist. */
  const rmsOf = x => { let p = 0; for (let i = 0; i < x.length; i++) p += x[i] * x[i]; return Math.sqrt(p / x.length); };
  const aufPegel = (x, r) => { const g = r / rmsOf(x), y = new Float64Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] * g; return y; };
  const filt = (x, v) => { let y = x; const [F, B] = VOK[v]; for (let m = 0; m < F.length; m++) y = D.resonate(y, F[m], B[m], SR); return y; };
  let lcgB = 4242; const rndB = () => { lcgB = (lcgB * 1664525 + 1013904223) >>> 0; return lcgB / 4294967296 * 2 - 1; };
  const rauschStueck = (s, v, pg, seed) => aufPegel(filt(noise(Math.round(s * SR), 1, seed), v), pg);
  const aperStueck = (s, f, v, pg) => { const n = Math.round(s * SR), src = new Float64Array(n); let pos = 0;
    while (pos < n) { const T = SR / f * (1 + 0.3 * rndB()), g = 1 + 0.5 * rndB(), i0 = Math.floor(pos), q = pos - i0;
      for (let k = 0; k < 6; k++) { const w = g * Math.cos(Math.PI * k / 12); if (i0 + k < n) src[i0 + k] += w * (1 - q); if (i0 + k + 1 < n) src[i0 + k + 1] += w * q; } pos += T; }
    return aufPegel(filt(src, v), pg); };
  const brueche = [];
  for (const v of ['a', 'o', 'i']) for (const [a, b] of [[165, 415], [175, 415], [196, 440], [220, 440], [247, 466]]) for (const d of [0.03, 0.045, 0.06]) {
    const A = ton(a, 0.6, v), pg = rmsOf(A);
    brueche.push({ a, b, v, d, art: 'Rauschen', sig: concat([A, rauschStueck(d, v, pg, 1000 + a), ton(b, 0.3, v), ton(a, 0.6, v)]) });
    brueche.push({ a, b, v, d, art: 'aperiodisch', sig: concat([A, aperStueck(d, Math.sqrt(a * b), v, pg), ton(b, 0.3, v), ton(a, 0.6, v)]) });
  }
  {
    const faelle = brueche.map(x => { const ht = 12 * Math.log2(x.b / x.a); return { name: x.art + ' ' + x.a + '→' + x.b + ' /' + x.v + '/ ' + x.d * 1000 + ' ms', sig: x.sig,
      soll: e => e.filter(y => y.art === 'gehalten').length === 1 && e.some(y => y.art === 'gehalten' && Math.abs(y.halbtoene - ht) <= 1) }; });
    const r = sammle(faelle);
    check('K1c', 'Bruch mit 30–60 ms Rauschen oder aperiodischen Impulsen am Übergang: genau ein gehaltenes Ereignis in Sprungrichtung', r.ok === r.n, r.detail);
  }
  {
    // Grenze zum Portamento: langsames Gleiten bleibt Tonbewegung
    const faelle = [];
    for (const [ht, d] of [[12, 0.3], [7, 0.2], [5, 0.15]]) for (const a of [110, 147, 196, 220]) for (const v of ['a', 'o', 'i'])
      faelle.push({ name: ht + ' HT in ' + d * 1000 + ' ms ab ' + a + ' /' + v + '/', sig: tonF(t => t < 0.6 ? a : (t < 0.6 + d ? HT(a, ht * (t - 0.6) / d) : HT(a, ht)), 1.4, v), soll: keins });
    const r = sammle(faelle);
    check('K1c', 'Gleiten über eine Oktave in 300 ms, eine Quinte in 200 ms, eine Quarte in 150 ms: kein Sprung', r.ok === r.n, r.detail);
  }

  /* ---------- K1d: Belegfelder ohne Urteil ---------- */
  {
    const kiek = (a, b, v) => concat([ton(a, 1, v), ton(b, 0.05, v), ton(a, 1, v)]);
    const geh = (a, ht, v) => concat([ton(a, 1, v), ton(HT(a, ht), 0.3, v), ton(a, 1, v)]);
    const proben = [];
    for (const v of ['a', 'i']) {
      for (const [a, b] of [[98, 196], [196, 392], [350, 700], [110, 440]]) proben.push({ name: 'Kiekser ' + a + '→' + b + ' /' + v + '/', sig: kiek(a, b, v), oktave: true, direkt: true });
      for (const [a, ht] of [[196, 11], [165, 16], [98, 11], [220, 7]]) proben.push({ name: 'gehalten ' + a + '+' + ht + ' /' + v + '/', sig: geh(a, ht, v), oktave: false, direkt: true });
      for (const g of [0.04, 0.06]) proben.push({ name: 'Lücke ' + g * 1000 + ' ms vor 196+12 /' + v + '/', sig: concat([ton(196, 0.6, v), still(g), ton(392, 0.3, v), ton(196, 0.6, v)]), oktave: true, luecke: g });
      for (const a of [147, 196]) proben.push({ name: 'Portamento 60 ms ' + a + '+12 /' + v + '/', sig: tonF(t => t < 0.6 ? a : (t < 0.66 ? HT(a, 12 * (t - 0.6) / 0.06) : HT(a, 12)), 1.2, v), oktave: true, gleit: 0.06 });
    }
    let felder = 0, okt = 0, ueDirekt = 0, ueLuecke = 0, ueGleit = 0, apGleich = 0, n = 0, nD = 0, nL = 0, nG = 0, urteil = 0;
    const bad = [], badO = [], badA = [], badU = [];
    for (const p of proben) {
      const tr = spur(p.sig), e = D.detectJumps(tr, {});
      if (e.length !== 1) { bad.push(p.name + ': ' + kurz(e)); continue; }
      const x = e[0]; n++;
      if (typeof x.uebergangMs === 'number' && typeof x.apSpitze === 'number' && typeof x.oktave === 'boolean') felder++;
      if (Object.keys(x).some(k => /bruch|register/i.test(k))) urteil++;
      if (x.oktave === p.oktave) okt++; else badO.push(p.name + ': oktave ' + x.oktave + ' bei ' + r1(x.halbtoene) + ' HT');
      let mx = -Infinity; for (let k = 0; k < tr.t.length; k++) if (Math.abs(tr.t[k] - x.startS) <= 0.05 + 1e-9) mx = Math.max(mx, tr.ap[k]);
      if (x.apSpitze === mx) apGleich++; else badA.push(p.name + ': apSpitze ' + x.apSpitze + ' statt ' + mx);
      if (p.direkt) { nD++; if (x.uebergangMs <= 25) ueDirekt++; else badU.push(p.name + ': uebergangMs ' + x.uebergangMs); }
      if (p.luecke) { nL++; if (x.uebergangMs >= 1000 * p.luecke && x.apSpitze >= 1) ueLuecke++; else badU.push(p.name + ': uebergangMs ' + x.uebergangMs + ' apSpitze ' + x.apSpitze); }
      if (p.gleit) { nG++; if (x.uebergangMs >= 40 && x.uebergangMs <= 90) ueGleit++; else badU.push(p.name + ': uebergangMs ' + x.uebergangMs); }
    }
    const det = b => b.length ? ' — ' + b.slice(0, 3).join(' | ') : '';
    check('K1d', 'jedes Ereignis trägt uebergangMs, apSpitze (Zahl) und oktave (ja/nein), kein Urteilsfeld', n === proben.length && felder === n && urteil === 0, felder + '/' + proben.length + det(bad));
    check('K1d', 'oktave: Kiekser +12/+24 HT ja, gehaltene +7/+11/+16 HT nein', okt === n && n === proben.length, okt + '/' + proben.length + det(bad.concat(badO)));
    check('K1d', 'apSpitze = größte Aperiodizität der Feinspur in ±50 ms um den Einsatz', apGleich === n && n === proben.length, apGleich + '/' + proben.length + det(bad.concat(badA)));
    check('K1d', 'uebergangMs: direkter Sprung ≤ 25 ms; Lücke 40/60 ms davor zählt mit (apSpitze 1); Portamento 60 ms: 40–90 ms', ueDirekt === nD && ueLuecke === nL && ueGleit === nG && n === proben.length,
      'direkt ' + ueDirekt + '/' + nD + ', Lücke ' + ueLuecke + '/' + nL + ', Portamento ' + ueGleit + '/' + nG + det(bad.concat(badU)));
    // Der Detektor entscheidet keinen Registerbruch: ein legato gesungener Melodiesprung bleibt ein gehaltenes Ereignis
    const leg = ereig(concat([ton(220, 0.6), ton(330, 0.6)]));
    check('K1d', 'legato Melodiesprung +7 HT ohne Pause: ein gehaltenes Ereignis, keine Bruch-Entscheidung im Detektor', leg.length === 1 && leg[0].art === 'gehalten' && Math.abs(leg[0].halbtoene - 7) <= 1, kurz(leg));
  }

  /* ---------- K2: Formant-Nummerierung (peaksFromEnvelope, analyseAt, Lesarten der Gipfel) ---------- */
  {
    // Prüfsatz K2: Vokale a/e/i/o/u, F1/F2 nach dem Vokalmodell (vowel.js), F3–F5 baritontypisch;
    // Grundton 98/147/196/247 Hz; Rahmen alle 20 ms. Rauschen deterministisch (LCG, feste Samen).
    const V2 = {
      a: [[680, 1250, 2450, 3400, 4200], [80, 90, 120, 150, 200]],
      e: [[350, 2000, 2550, 3450, 4250], [60, 100, 130, 160, 200]],
      i: [[270, 2150, 2750, 3500, 4300], [60, 100, 130, 160, 200]],
      o: [[380, 750, 2400, 3350, 4150], [70, 90, 120, 150, 200]],
      u: [[300, 700, 2300, 3300, 4100], [60, 90, 120, 150, 200]]
    };
    const F0S = [98, 147, 196, 247];
    // Glottisquelle mit natürlichem Gefälle: Rosenberg-Puls (Öffnungsquotient 0,6), Abstrahlung als Differenz
    function rosenberg(f0, F, B, s) {
      const n = Math.round(s * SR), g = new Float64Array(n), T = SR / f0, Tp = 0.6 * T * 2 / 3, Tn = 0.6 * T / 3;
      for (let i = 0; i < n; i++) { const t = i % T; g[i] = t < Tp ? 0.5 * (1 - Math.cos(Math.PI * t / Tp)) : (t < Tp + Tn ? Math.cos(Math.PI * (t - Tp) / (2 * Tn)) : 0); }
      let y = new Float64Array(n); for (let i = 1; i < n; i++) y[i] = g[i] - g[i - 1];
      for (let m = 0; m < F.length; m++) y = D.resonate(y, F[m], B[m], SR);
      let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i]));
      for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / mx;
      return y;
    }
    // rosa Rauschen: Filter nach P. Kellet auf dem LCG-Rauschen des Prüflaufs
    function rosa(n, seed) {
      const w = noise(n, 1, seed), y = new Float64Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) { const v = w[i]; b0 = 0.99886 * b0 + v * 0.0555179; b1 = 0.99332 * b1 + v * 0.0750759; b2 = 0.96900 * b2 + v * 0.1538520; b3 = 0.86650 * b3 + v * 0.3104856; b4 = 0.55000 * b4 + v * 0.5329522; b5 = -0.7616 * b5 - v * 0.0168980; y[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + v * 0.5362; b6 = v * 0.115926; }
      return y;
    }
    const eff = x => { let p = 0; for (let i = 0; i < x.length; i++) p += x[i] * x[i]; return Math.sqrt(p / x.length); };
    // c: { v, f0, f6?, ros?, art?: 'weiss'|'rosa', snr?, seed?, F?, B? }. SNR im Analyseband (nach der Wandlung)
    // gemessen. F/B ersetzen den Vokal (Cluster-Fälle in K2d).
    function signal(c) {
      const [F, B] = c.F ? [c.F, c.B] : V2[c.v], FF = c.f6 ? F.concat([c.f6]) : F, BB = c.f6 ? B.concat([250]) : B;
      const x48 = c.ros ? rosenberg(c.f0, FF, BB, 0.4) : D.synthVowel(c.f0, FF, BB, 0.4, SR, { gain: 0.3 });
      const x = D.resample(x48, SR, TSR);
      if (c.snr == null) return x;
      const nz = D.resample(c.art === 'rosa' ? rosa(x48.length, c.seed) : noise(x48.length, 1, c.seed), SR, TSR);
      const g = eff(x) * Math.pow(10, -c.snr / 20) / eff(nz), y = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) y[i] = x[i] + g * nz[i];
      return y;
    }
    const name = c => (c.F ? c.F.join('/') : '/' + c.v + '/') + ' ' + c.f0 + (c.f6 ? ' F6 ' + c.f6 : '') + (c.ros ? ' Rosenberg' : '') + (c.snr != null ? ' ' + c.art + ' ' + c.snr + ' dB' : '');
    // Auswertung je Teilsatz: falsch-gültige Slots (> 130 Hz), davon Nummernvertauschungen (Wert liegt bei
    // einem Nachbarformanten oder F6), F1-Slot mit F2, falsch-gültige ΔF3–4 (> 120 Hz)
    function auswerten(faelle) {
      const z = { n: 0, gueltig: [0, 0, 0, 0, 0], falsch: 0, falsch345: 0, nummer: 0, f1f2: 0, d34: 0, d34falsch: 0, alle: 0, bsp: [], nV: {}, f2V: {} };
      for (const c of faelle) {
        const x = signal(c), T = c.F || V2[c.v][0];
        for (let i = 900; i + 900 <= x.length; i += 240) {
          const r = D.analyseAt(x, TSR, i, {}); if (!r.voiced) continue;
          z.n++; if (r.valid.every(Boolean)) z.alle++;
          z.nV[c.v] = (z.nV[c.v] || 0) + 1; if (r.valid[1]) z.f2V[c.v] = (z.f2V[c.v] || 0) + 1;
          for (let k = 0; k < 5; k++) {
            if (!r.valid[k]) continue;
            z.gueltig[k]++;
            const e = Math.abs(r.F[k] - T[k]); if (e <= 130) continue;
            z.falsch++; if (k >= 2) z.falsch345++;
            if ([T[k - 1], T[k + 1], c.f6].some(t => t && Math.abs(r.F[k] - t) <= 130)) z.nummer++;
            if (k === 0 && Math.abs(r.F[0] - T[1]) <= 130) z.f1f2++;
            if (z.bsp.length < 3) z.bsp.push(name(c) + ' t ' + (i / TSR).toFixed(2) + ' F' + (k + 1) + ' ' + r0(r.F[k]) + ' (Soll ' + T[k] + ')');
          }
          if (r.d34valid) { z.d34++; if (Math.abs(r.d34 - (T[3] - T[2])) > 120) { z.d34falsch++; if (z.bsp.length < 3) z.bsp.push(name(c) + ' ΔF3–4 ' + r0(r.d34) + ' (Soll ' + (T[3] - T[2]) + ')'); } }
        }
      }
      return z;
    }
    const satz = { sauber: [], f6: [], f6ros: [], rauschen: [], rauschenRos: [] };
    for (const v of Object.keys(V2)) for (const f0 of F0S) {
      satz.sauber.push({ v, f0 });
      for (const f6 of [4400, 4600, 4800]) satz.f6.push({ v, f0, f6 });
      for (const f6 of [4400, 4800]) satz.f6ros.push({ v, f0, f6, ros: true });
      for (const art of ['weiss', 'rosa']) for (const snr of [30, 40, 50]) {
        satz.rauschen.push({ v, f0, art, snr, seed: 11 });
        satz.rauschenRos.push({ v, f0, art, snr, seed: 37, ros: true });
      }
    }
    const E = {}; for (const k of Object.keys(satz)) E[k] = auswerten(satz[k]);
    const det = z => z.n + ' Rahmen' + (z.bsp.length ? ' — ' + z.bsp.join(' | ') : '');

    // K2a: Fälle aus Bericht 1 Befund 1. (a) F3/F4 verschmolzen und F6 im Band: fünf Gipfel, aber F5 im F4-Slot.
    const ra = D.analyseAt(D.resample(D.synthVowel(196, [700, 1200, 2500, 2650, 4000, 4600], [80, 90, 140, 120, 200, 250], 0.5, SR), SR, TSR), TSR, 3000, {});
    check('K2a', 'F3/F4 verschmolzen und F6 bei 4600 Hz: ΔF3–4 nicht gültig oder richtig (150 ± 120 Hz)', !ra.d34valid || Math.abs(ra.d34 - 150) <= 120, 'ΔF3–4 ' + r0(ra.d34) + ', gültig ' + ra.valid.map(v => v ? 1 : 0).join(''));
    // (b) tiefe Lage, F3–F5 eng, weißes Rauschen 50 dB: Rauschgipfel an der Filterkante als fünfter Gipfel
    const sb = D.synthVowel(95.5, [729, 982, 2061, 2297, 2580], [54, 110, 170, 182, 279], 0.4, SR, { gain: 0.3 });
    { const nz = noise(sb.length, Math.pow(10, D.rmsDb(sb) / 20) * Math.pow(10, -50 / 20) * Math.sqrt(3), 325); for (let i = 0; i < sb.length; i++) sb[i] += nz[i]; }
    const rb = D.analyseAt(D.resample(sb, SR, TSR), TSR, 2400, {});
    check('K2a', 'tiefe Lage 95,5 Hz, F3–F5 eng, weißes Rauschen 50 dB: ΔF3–4 nicht gültig oder richtig (236 ± 120 Hz)', !rb.d34valid || Math.abs(rb.d34 - 236) <= 120, 'ΔF3–4 ' + r0(rb.d34) + ', F ' + rb.F.map(r0).join(' '));
    // Nummerierung über den Prüfsatz: kein gültiger Slot trägt einen anderen Formanten
    const num = ['f6', 'f6ros', 'rauschen', 'rauschenRos'].reduce((s, k) => s + E[k].nummer, 0), num1 = E.rauschen.f1f2 + E.rauschenRos.f1f2 + E.f6ros.f1f2;
    check('K2a', 'Prüfsatz K2 (F6 4400–4800 Hz, Rauschen 30/40/50 dB, Rosenberg): kein gültiger Slot trägt einen Nachbarformanten oder F6', num === 0,
      num + ' Vertauschungen — ' + ['f6', 'f6ros', 'rauschen', 'rauschenRos'].map(k => k + ' ' + E[k].nummer).join(', '));
    check('K2a', 'fehlende tiefste Resonanz: kein gültiger F1-Slot trägt F2 (Prüfsatz K2)', num1 === 0, num1 + ' Rahmen');
    // Lesarten direkt: der unterste Gipfel kann F2 sein, wenn alle Gipfel darüber auch eine Stufe höher passen
    const lu = (P, n) => typeof D.slotNumberUnsure === 'function' ? D.slotNumberUnsure(P, n || P.map(() => 3)).map(v => v ? 1 : 0).join('') : 'fehlt';
    const l1 = lu([794, 2522, 3299, 4432]), l2 = lu([380, 750, 2400, 3350, 4150]), l3 = lu([680, 1250, 2450, 3400]), l4 = lu([738, 1174, 2553, 3933, 4432], [3, 3, 3, 3, 1]);
    // l3/l4: Seit F4 ab 1900 Hz zulässig ist (tiefe enge Cluster, K2d), kann der dritte Gipfel ohne sichtbares
    // F5 auch F4 sein; F3 ist dann ebenfalls unsicher.
    check('K2a', 'Lesarten: unterster Gipfel 794 Hz über F3-tauglichen Gipfeln → alles unsicher; /o/ vollständig → sicher; /a/ ohne F5 → F3/F4 unsicher; F6 nur in einer Ordnung → F3–F5 unsicher',
      l1 === '11110' && l2 === '00000' && l3 === '00110' && l4 === '00111', [l1, l2, l3, l4].join(' '));
    // Gegenproben: saubere Vokale verlieren nichts
    check('K2a', 'Gegenprobe: saubere Vokale a/e/i/o/u, 98–247 Hz: alle fünf Formanten in jedem Rahmen gültig', E.sauber.alle === E.sauber.n && E.sauber.n > 0, E.sauber.alle + '/' + E.sauber.n);
    check('K2a', 'Gegenprobe: mit F6 4400–4800 Hz bleibt ΔF3–4 in mindestens 90 % der Rahmen gültig', E.f6.d34 >= 0.9 * E.f6.n, E.f6.d34 + '/' + E.f6.n);

    // K2b: Formant im Rauschboden. Läuft die Hüllkurve über einem Gipfel in den Rauschboden, bestimmt das
    // Rauschen seine Lage; alle Fenster sehen dasselbe Rauschen und wiederholen den Fehler.
    check('K2b', 'Rosenberg-Quelle mit weißem/rosa Rauschen 30/40/50 dB: kein gültiger Slot über 130 Hz falsch, kein gültiges ΔF3–4 über 120 Hz falsch',
      E.rauschenRos.falsch === 0 && E.rauschenRos.d34falsch === 0, 'Slots ' + E.rauschenRos.falsch + ', ΔF3–4 ' + E.rauschenRos.d34falsch + ' falsch; ' + det(E.rauschenRos));
    check('K2b', 'Impulsquelle mit weißem/rosa Rauschen 30/40/50 dB: kein gültiges F3–F5 über 130 Hz falsch, kein gültiges ΔF3–4 über 120 Hz falsch',
      E.rauschen.falsch345 === 0 && E.rauschen.d34falsch === 0, 'F3–F5 ' + E.rauschen.falsch345 + ', ΔF3–4 ' + E.rauschen.d34falsch + ' falsch; ' + det(E.rauschen));
    // Gegenprobe: Vibrato verschmiert hohe Teiltöne, ist aber kein Rauschen
    {
      let n = 0, alle = 0;
      for (const v of ['a', 'i', 'o', 'u']) for (const f0 of F0S) for (const [rate, cent] of [[6, 50], [4, 30]]) {
        const x = D.resample(vib(f0, 0.4, v, rate, cent), SR, TSR);
        for (let i = 900; i + 900 <= x.length; i += 240) { const r = D.analyseAt(x, TSR, i, {}); if (!r.voiced) continue; n++; if (r.valid.every(Boolean)) alle++; }
      }
      check('K2b', 'Gegenprobe: saubere Vokale mit Vibrato (6 Hz ±50 Cent, 4 Hz ±30 Cent): alle fünf Formanten in mindestens 95 % der Rahmen gültig', n > 0 && alle >= 0.95 * n, alle + '/' + n);
    }

    // K2c: verschmolzene oder umstrittene Gipfel. Richtig nummeriert, aber zwei Resonanzen in einem Gipfel:
    // /u/ 196 Hz mit Rauschen (F1 300 + F2 700 Hz bei 440–460 Hz), F5 4100 + F6 4400 Hz (Rosenberg, 247 Hz).
    check('K2c', 'Impulsquelle mit weißem/rosa Rauschen 30/40/50 dB, auch F1/F2 verschmolzen: kein gültiger Slot über 130 Hz falsch',
      E.rauschen.falsch === 0 && E.rauschen.d34falsch === 0, 'Slots ' + E.rauschen.falsch + ', ΔF3–4 ' + E.rauschen.d34falsch + ' falsch; ' + det(E.rauschen));
    check('K2c', 'Rosenberg-Quelle mit F6 4400/4800 Hz: kein gültiger Slot über 130 Hz falsch, kein gültiges ΔF3–4 über 120 Hz falsch',
      E.f6ros.falsch === 0 && E.f6ros.d34falsch === 0, 'Slots ' + E.f6ros.falsch + ', ΔF3–4 ' + E.f6ros.d34falsch + ' falsch; ' + det(E.f6ros));
    const lm = (P, n, bw, fr) => typeof D.slotMergeUnsure === 'function' ? D.slotMergeUnsure(P, n, bw, fr).map(v => v ? 1 : 0).join('') : 'fehlt';
    const m1 = lm([455, 2311, 3466, 4557], [3, 3, 3, 3], [300, 200, 150, 180], []), m2 = lm([282, 690, 2249, 3281, 4237], [3, 3, 3, 3, 3], [80, 140, 160, 250, 80], [3960]),
      m3 = lm([406, 732, 2320, 3265], [3, 1, 3, 3], [140, 180, 120, 200], []), m4 = lm([680, 1250, 2450, 3400, 4200], [3, 3, 3, 3, 3], [90, 100, 130, 160, 210], []);
    check('K2c', 'Verschmelzung direkt: breiter F1 ohne F2 → F1 unsicher; andere Ordnung trennt F5/F6 → F5 unsicher; F2 nur in einer Ordnung → F1 unsicher; /a/ vollständig → nichts',
      m1 === '10000' && m2 === '00001' && m3 === '10000' && m4 === '00000', [m1, m2, m3, m4].join(' '));
    // Ziel der Aufgabe K2 als ein Kriterium über den ganzen Prüfsatz
    const teile = ['sauber', 'f6', 'f6ros', 'rauschen', 'rauschenRos'], fs = teile.reduce((a, k) => a + E[k].falsch, 0), fd = teile.reduce((a, k) => a + E[k].d34falsch, 0);
    check('K2c', 'Prüfsatz K2 ganz (rauschfrei mit F6 4400–4800 Hz; weißes/rosa Rauschen 30/40/50 dB; Rosenberg-Quelle): kein gültiger Slot über 130 Hz, kein gültiges ΔF3–4 über 120 Hz falsch',
      fs === 0 && fd === 0, 'Slots ' + fs + ', ΔF3–4 ' + fd + ' falsch in ' + teile.reduce((a, k) => a + E[k].n, 0) + ' Rahmen; gültige ΔF3–4 ' + teile.map(k => k + ' ' + E[k].d34 + '/' + E[k].n).join(', '));

    // K2d: tiefe enge Cluster unterhalb des Sängerformantbands (physik.md §4): F3 1700–2400 Hz, ΔF3–4 300–600 Hz.
    // Mit F4 erst ab 2600 Hz galten sie als unmöglich (alle Slots ungültig), und mit Rauschen war die Lesart
    // „F1 fehlt“ ausgeschlossen: F3 stand gültig im F2-Slot.
    const cl = (F1, F2, F3, d) => [F1, F2, F3, F3 + d, Math.max(3050, F3 + d + 800)], BCL = [70, 90, 100, 110, 160];
    const satzD = { sauber: [], rausch: [] }; let jd = 0;
    for (const [F1, F2] of [[680, 1250], [480, 1400], [380, 750]]) for (const F3 of [1700, 2000, 2200, 2400]) for (const d of [300, 450, 600]) {
      satzD.sauber.push({ F: cl(F1, F2, F3, d), B: BCL, f0: [110, 147, 196][jd++ % 3] });
      // F1/F2 eng beieinander (/o/): hier geht F1 im Rauschen verloren
      if (F1 === 380) for (const f0 of [110, 147, 196]) satzD.rausch.push({ F: cl(F1, F2, F3, d), B: BCL, f0, art: 'weiss', snr: 40, seed: 99 });
    }
    const ED = { sauber: auswerten(satzD.sauber), rausch: auswerten(satzD.rausch) };
    check('K2d', 'tiefe enge Cluster sauber (F3 1700–2400, ΔF3–4 300–600 Hz): kein gültiger Wert falsch, F1/F2 in mindestens 90 %, ΔF3–4 in mindestens 80 % der Rahmen gültig',
      ED.sauber.falsch === 0 && ED.sauber.d34falsch === 0 && Math.min(ED.sauber.gueltig[0], ED.sauber.gueltig[1]) >= 0.9 * ED.sauber.n && ED.sauber.d34 >= 0.8 * ED.sauber.n,
      'gültig F1–F5 ' + ED.sauber.gueltig.join('/') + ', ΔF3–4 ' + ED.sauber.d34 + ' von ' + ED.sauber.n + ' Rahmen; falsch ' + ED.sauber.falsch + '/' + ED.sauber.d34falsch + (ED.sauber.bsp.length ? ' — ' + ED.sauber.bsp.join(' | ') : ''));
    check('K2d', 'tiefe enge Cluster mit /o/-F1/F2, weißes Rauschen 40 dB: kein gültiger Slot über 130 Hz falsch, kein gültiges ΔF3–4 über 120 Hz falsch',
      ED.rausch.falsch === 0 && ED.rausch.d34falsch === 0, 'Slots ' + ED.rausch.falsch + ', ΔF3–4 ' + ED.rausch.d34falsch + ' falsch; ' + det(ED.rausch));
    // direkt: tiefes enges Cluster ist eine zulässige Lesart; ein fremder Gipfel unter dem untersten verschiebt alles darüber
    const n1 = lu([725, 1240, 2050, 2498, 3248]), n2 = lm([774, 1989, 2283, 3619, 4505], [3, 3, 3, 3, 3], [130, 110, 120, 150, 200], [448]);
    check('K2d', 'Lesarten: Cluster F3 2050 / F4 2498 / F5 3248 → sicher; andere Ordnung sieht 448 Hz unter dem untersten Gipfel 774 Hz → alle Slots unsicher',
      n1 === '00000' && n2 === '11111', n1 + ' ' + n2);
    // Verschmelzungsverdacht nur, wenn die fehlende Resonanz nach den Slotgrenzen im Gipfel stecken kann: /o/ mit
    // F2 770 Hz (in Ordnung 12 breit), Lesart „F3 fehlt“ → F3 liegt nicht unter 1600 Hz, F2 bleibt sicher
    const n3 = lm([433, 772, 2594, 2923], [3, 3, 3, 1], [461, 449, 162, 123], []);
    const fOU = (E.rauschen.f2V.o || 0) + (E.rauschen.f2V.u || 0), nOU = (E.rauschen.nV.o || 0) + (E.rauschen.nV.u || 0);
    check('K2d', 'Verschmelzungsverdacht nur in Reichweite der fehlenden Resonanz: /o/ 433/772/2594/2923 → F2 sicher; Rauschteil /o/ /u/ (Impulsquelle): F2 in mindestens 70 % der Rahmen gültig',
      n3 === '00100' && fOU >= 0.7 * nOU, n3 + ', F2 gültig ' + fOU + '/' + nOU);
  }
};

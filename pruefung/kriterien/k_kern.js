/* Kriterien K1: zweite Tonhöhenspur (pitchTrackFine) und Sprungerkennung (detectJumps).
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
};

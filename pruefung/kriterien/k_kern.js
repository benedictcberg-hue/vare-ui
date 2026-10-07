/* Kriterien K1: zweite Tonhöhenspur (pitchTrackFine) und Sprungerkennung (detectJumps).
   Kriterien K2: Formant-Nummerierung und Gültigkeit im Fenstersweep (analyseAt).
   Kriterien K3: Grundton im Fenstersweep (analyseAt): Untergrenze der Teilerkontrolle, Gegenprobe, Korrektur.
   Kriterien K4: SHR-Raster F0 oder 2·F0 (analyseAt): Zweifel sichtbar, beide Werte ausgewiesen.
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

  /* ---------- K3: Grundton im Fenstersweep (analyseAt) ---------- */
  {
    const roh = (f0, F, B, s, o) => D.resample(D.synthVowel(f0, F, B, s, SR, o || {}), SR, TSR);
    const VOK6 = [['a', [700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200]], ['i', [300, 2200, 2900, 3500, 4300], [60, 100, 130, 160, 200]],
      ['u', [320, 800, 2400, 3300, 4200], [60, 90, 120, 150, 200]], ['o', [450, 800, 2500, 3300, 4200], [70, 90, 120, 150, 200]],
      ['e', [400, 1900, 2600, 3400, 4300], [60, 100, 130, 160, 200]], ['eng', [500, 1500, 2450, 2800, 3150], [70, 90, 90, 90, 100]]];
    const effW = x => { let p = 0; for (let i = 0; i < x.length; i++) p += x[i] * x[i]; return Math.sqrt(p / x.length); };
    // Netzbrumm 50 Hz mit ungeraden Oberwellen, Pegel db relativ zum Effektivwert des Tons
    function mitBrumm(x, db) {
      const b = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) { const t = i / SR; b[i] = Math.sin(2 * Math.PI * 50 * t) + 0.5 * Math.sin(2 * Math.PI * 150 * t + 1) + 0.3 * Math.sin(2 * Math.PI * 250 * t + 2); }
      const g = effW(x) * Math.pow(10, db / 20) / effW(b), y = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) y[i] = x[i] + g * b[i];
      return y;
    }

    /* K3a: Die Teilerkontrolle teilt nie unter 60 Hz (Spezifikation: YIN-Bereich 60–500 Hz). Eine
       Reihe darunter, die zum Teilen reichen würde, macht die Oktave unsicher statt still zu teilen. */
    {
      const ds = roh(121, [605, 1250, 2500, 3300, 4200], [45, 90, 120, 150, 200], 1.2);
      let n = 0, unter = 0; const vals = {};
      for (let c = 1200; c + 1200 < ds.length; c += 120) { const r = D.analyseAt(ds, TSR, c, {}); if (!r.voiced) continue; n++; if (!(r.f0 >= 60)) unter++; vals[r1(r.f0)] = (vals[r1(r.f0)] || 0) + 1; }
      check('K3a', '121 Hz mit engem F1 = 5·F0: kein Rahmen unter 60 Hz (vorher 30,2 Hz in 82 von 100 Rahmen)', n > 0 && unter === 0,
        unter + '/' + n + ' unter 60 Hz; Werte ' + Object.keys(vals).map(k => k + '×' + vals[k]).join(' '));
      let okPd = 0; const badPd = [];
      for (const f0 of [80, 110]) for (const [v, F, B] of VOK6) {
        const r = D.analyseAt(roh(f0, F, B, 0.5, { altRatio: 0.5 }), TSR, 3000, {});
        if (r.voiced && r.f0 >= 60 && Math.abs(r.f0 / f0 - 1) < 0.03 && r.octaveAmbiguous && r.octaveUnterGrenze) okPd++; else badPd.push('/' + v + '/ ' + f0 + ': ' + r1(r.f0) + (r.octaveAmbiguous ? ' unsicher' : '') + (r.octaveUnterGrenze ? ' unterGrenze' : ''));
      }
      check('K3a', 'starke Periodenverdopplung bei 80/110 Hz (Reihe bei 40/55 Hz): Grundton bleibt im Messbereich, Oktave als unsicher gemeldet (octaveUnterGrenze)', okPd === 12,
        okPd + '/12' + (badPd.length ? ' — ' + badPd.slice(0, 4).join(' | ') : ''));
      let nB = 0, unterB = 0; const badB = [];
      for (const [v, F, B] of VOK6.slice(0, 4)) for (let f0 = 90; f0 <= 130; f0 += 1.7) for (const db of [-25, -20]) {
        const r = D.analyseAt(D.resample(mitBrumm(D.synthVowel(f0, F, B, 0.35, SR), db), SR, TSR), TSR, 2100, { orders: [14] });
        if (!r.voiced) continue; nB++;
        if (!(r.f0 >= 60)) { unterB++; badB.push('/' + v + '/ ' + f0.toFixed(1) + ' Brumm ' + db + ' dB: ' + r1(r.f0)); }
      }
      check('K3a', 'Netzbrumm 50 Hz (−25/−20 dB, mit 150/250 Hz) bei Tönen 90–130 Hz, a/i/u/o: kein Grundton unter 60 Hz', nB > 0 && unterB === 0,
        unterB + '/' + nB + (badB.length ? ' — ' + badB.slice(0, 3).join(' | ') : ''));
    }

    /* K3b: Gegenprobe des Grundtons. Jeder falsche Grundton (mehr als 3 % neben der Wahrheit) trägt
       f0Unsure oder octaveAmbiguous; ein richtiger trägt f0Unsure nie. Die großen Sätze laufen mit nur
       einer LPC-Ordnung: Grundton, Cepstrum und Gegenprobe hängen nicht vom Ordnungssweep ab (eigenes
       Kriterium unten), das spart mehr als die Hälfte der Rechenzeit. */
    const SCHNELL = { orders: [14] };
    const lcg = seed => { let z = seed >>> 0; return () => { z = (z * 1664525 + 1013904223) >>> 0; return z / 4294967296; }; };
    const mitSnr = (x, snr, seed, nz) => { nz = nz || noise(x.length, 1, seed); const g = effW(x) * Math.pow(10, -snr / 20) / effW(nz), y = new Float64Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] + g * nz[i]; return y; };
    function rosa(n, seed) {
      const w = noise(n, 1, seed), y = new Float64Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) { const v = w[i]; b0 = 0.99886 * b0 + v * 0.0555179; b1 = 0.99332 * b1 + v * 0.0750759; b2 = 0.96900 * b2 + v * 0.1538520; b3 = 0.86650 * b3 + v * 0.3104856; b4 = 0.55000 * b4 + v * 0.5329522; b5 = -0.7616 * b5 - v * 0.0168980; y[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + v * 0.5362; b6 = v * 0.115926; }
      return y;
    }
    // Impulsfolge aus Zeitpunkten (s) und Amplituden durch die Resonatoren, Impulse auf Bruchteile von Abtastwerten
    function pulse(times, amps, s, F, B) {
      const n = Math.round(s * SR), src = new Float64Array(n);
      for (let k = 0; k < times.length; k++) {
        const pos = times[k] * SR, i0 = Math.floor(pos), q = pos - i0;
        for (let j = 0; j < 6; j++) { const w = amps[k] * Math.cos(Math.PI * j / 12); if (i0 + j < n) src[i0 + j] += w * (1 - q); if (i0 + j + 1 < n) src[i0 + j + 1] += w * q; }
      }
      let y = src; for (let m = 0; m < F.length; m++) y = D.resonate(y, F[m], B[m], SR);
      let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i]));
      for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / mx;
      return y;
    }
    // F0-Verlauf fHz(t), Jitter j (relativ, gleichverteilt je Periode), Samen
    function verlauf(fHz, s, F, B, j, seed) {
      const rnd = lcg(seed || 1), times = [], amps = []; let t = 0;
      while (t < s) { times.push(t); amps.push(1); t += (1 + (j || 0) * (2 * rnd() - 1)) / fHz(t); }
      return pulse(times, amps, s, F, B);
    }
    // Periodenverdopplung (Testprofil): Zyklen alternieren um a (art 'amp': jeder zweite Impuls schwächer,
    // 'per': Perioden abwechselnd T(1 + a/2), T(1 − a/2)); ab t1 klingt jeder zweite Impuls bis t2 auf 0 aus,
    // danach exakt f0/2.
    function verdopplung(f0, a, art, F, B, s, t1, t2) {
      const T = 1 / f0, times = [], amps = []; let t = 0, k = 0;
      while (t < s) {
        let g = 1;
        if (k % 2) { if (art === 'amp') g = 1 - a; if (t >= t1) g *= Math.max(0, 1 - (t - t1) / (t2 - t1)); }
        if (g > 0) { times.push(t); amps.push(g); }
        t += art === 'per' ? T * (k % 2 ? 1 - a / 2 : 1 + a / 2) : T; k++;
      }
      return pulse(times, amps, s, F, B);
    }
    function rosenberg(f0, F, B, s) {
      const n = Math.round(s * SR), g = new Float64Array(n), T = SR / f0, Tp = 0.6 * T * 2 / 3, Tn = 0.6 * T / 3;
      for (let i = 0; i < n; i++) { const t = i % T; g[i] = t < Tp ? 0.5 * (1 - Math.cos(Math.PI * t / Tp)) : (t < Tp + Tn ? Math.cos(Math.PI * (t - Tp) / (2 * Tn)) : 0); }
      let y = new Float64Array(n); for (let i = 1; i < n; i++) y[i] = g[i] - g[i - 1];
      for (let m = 0; m < F.length; m++) y = D.resonate(y, F[m], B[m], SR);
      let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i]));
      for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / mx;
      return y;
    }
    /* Auswertung. faelle: { name, sig (48 kHz), frames: [Index bei 12 kHz], wahr(c) → [lo, hi] Hz, ok?(r, c) }.
       Liefert je Rahmen das Ergebnis, damit spätere Kriterien dieselben Rahmen nutzen. */
    function rahmen(faelle, opts) {
      const out = [];
      for (const f of faelle) {
        const ds = D.resample(f.sig(), SR, TSR);
        for (const c of f.frames) {
          const r = D.analyseAt(ds, TSR, c, opts || {});
          if (!r.voiced) continue;
          const [lo, hi] = f.wahr ? f.wahr(c) : [NaN, NaN], richtig = v => f.ok ? f.ok({ f0: v }, c) : (v >= 0.97 * lo && v <= 1.03 * hi);
          out.push({ name: f.name + '@' + (c / TSR).toFixed(2) + ' s', r, ok: richtig(r.f0), okYin: richtig(r.f0Yin), lo, hi });
        }
      }
      return out;
    }
    function bilanz(R) {
      const falsch = R.filter(x => !x.ok), unm = falsch.filter(x => !(x.r.f0Unsure || x.r.octaveAmbiguous)), fehl = R.filter(x => x.ok && x.r.f0Unsure);
      const bsp = unm.slice(0, 3).map(x => 'unmarkiert ' + x.name + ' ' + r1(x.r.f0) + ' Hz statt ' + r1(x.lo) + ' (Cepstrum ' + r1(x.r.f0Cep) + ')')
        .concat(fehl.slice(0, 3).map(x => 'fehlmarkiert ' + x.name + ' ' + r1(x.r.f0) + ' Hz (' + x.r.f0Grund + ', Cepstrum ' + r1(x.r.f0Cep) + ')'));
      return { n: R.length, falsch: falsch.length, unm: unm.length, fehl: fehl.length,
        txt: 'Rahmen ' + R.length + ', falsch ' + falsch.length + ', davon unmarkiert ' + unm.length + '; richtig als unsicher ' + fehl.length + (bsp.length ? ' — ' + bsp.join(' | ') : '') };
    }
    const fest = f0 => () => [f0, f0];
    const fenster = c => { const a = []; for (let k = c; k + 1200 < Math.round(1.2 * TSR); k += 120) a.push(k); return a; };

    // Befund-Fälle aus Bericht 1: enger Cluster bei 348 Hz, F2–F4-Cluster bei 192 Hz, schmaler F1 auf dem 5. Teilton
    const BEFUND = [[348.2, [500, 1500, 2450, 2800, 3150], [70, 90, 90, 90, 100]], [192.2, [743, 2072, 2338, 2586, 4161], [49, 102, 110, 199, 224]],
      [121, [605, 1250, 2500, 3300, 4200], [45, 90, 120, 150, 200]], [97, [485, 1250, 2500, 3300, 4200], [30, 90, 120, 150, 200]]];
    const R_befund = rahmen(BEFUND.map(([f0, F, B]) => ({ name: f0 + ' Hz', sig: () => D.synthVowel(f0, F, B, 1.2, SR), frames: fenster(1200), wahr: fest(f0) })), SCHNELL);
    // Zufallssatz: plausible Baritonvokale, F0 75–450 Hz, fester Samen; die ersten 200 zusätzlich mit weißem Rauschen 40 dB
    const rnd = lcg(4711), U = (a, b) => a + (b - a) * rnd(), ZUF = [];
    for (let t = 0; t < 600; t++) {
      const f0 = U(75, 450), F1 = U(280, 800), F2 = U(Math.max(F1 + 250, 750), 2300), F3 = U(Math.max(F2 + 200, 1800), 3000), F4 = F3 + U(150, 1000), F5 = U(F4 + 250, Math.max(F4 + 300, 4500));
      ZUF.push({ t, f0, F: [F1, F2, F3, F4, F5], B: [U(35, 100), U(50, 130), U(70, 200), U(90, 220), U(120, 300)] });
    }
    const R_zuf = rahmen(ZUF.map(z => ({ name: 'Z' + z.t, sig: () => D.synthVowel(z.f0, z.F, z.B, 0.4, SR, { gain: 0.3 }), frames: [2400], wahr: fest(z.f0) })), SCHNELL);
    const R_zuf40 = rahmen(ZUF.slice(0, 200).map(z => ({ name: 'Z' + z.t + ' SNR 40', sig: () => mitSnr(D.synthVowel(z.f0, z.F, z.B, 0.4, SR, { gain: 0.3 }), 40, 1000 + z.t), frames: [2400], wahr: fest(z.f0) })), SCHNELL);
    // tiefe Lage: schmaler F1 genau auf dem 3.–6. Teilton
    const TIEF = [];
    for (let f0 = 76; f0 <= 133; f0 += 6) for (let k = 3; k <= 6; k++) for (const B1 of [30, 45]) for (const F2 of [1000, 1500]) {
      if (k * f0 < 250 || k * f0 > 760) continue;
      TIEF.push({ name: f0 + ' Hz F1 = ' + k + '·F0 B1 ' + B1 + ' F2 ' + F2, sig: () => D.synthVowel(f0, [k * f0, F2, 2500, 3300, 4200], [B1, 90, 120, 150, 200], 0.6, SR, { gain: 0.3 }), frames: [2400, 4200], wahr: fest(f0) });
    }
    const R_tief = rahmen(TIEF, SCHNELL);
    // sechs Vokale 75–450 Hz in Schritten von 2,73 Hz; dazu je Tonhöhe ein Rahmen mit Vibrato, abwechselnd
    // 6 Hz ±50 Cent und 4 Hz ±30 Cent, die Vibratophase wandert mit der Tonhöhe
    const VOKF = [], VIB = [];
    for (const [v, F, B] of VOK6) for (let i = 0, f0 = 75; f0 <= 450.01; i++, f0 += 2.73) {
      VOKF.push({ name: '/' + v + '/ ' + f0.toFixed(1), sig: () => D.synthVowel(f0, F, B, 0.35, SR), frames: [2100], wahr: fest(f0) });
      const [rate, cent] = i % 2 ? [4, 30] : [6, 50], ph = 2.1 * i;
      const fHz = t => f0 * Math.pow(2, cent / 1200 * Math.sin(2 * Math.PI * rate * t + ph));
      VIB.push({ name: '/' + v + '/ ' + f0.toFixed(1) + ' Vibrato ' + rate + ' Hz ±' + cent + ' c', sig: () => verlauf(fHz, 0.35, F, B), frames: [2100],
        wahr: c => { let lo = Infinity, hi = 0; for (let t = c / TSR - 0.05; t <= c / TSR + 0.05; t += 0.001) { const f = fHz(t); lo = Math.min(lo, f); hi = Math.max(hi, f); } return [lo, hi]; } });
    }
    const R_vok = rahmen(VOKF, SCHNELL), R_vib = rahmen(VIB, SCHNELL);
    // Periodenverdopplung nach Testprofil: f0 oder f0/2 (Teilung nach der Spezifikation), im Ausklang ab 1,0 s exakt f0/2
    const PD = [];
    for (const [v, F, B] of VOK6.slice(0, 4)) for (const f0 of [130, 165, 196, 247]) for (const art of ['amp', 'per']) for (const a of [0.08, 0.11, 0.14])
      PD.push({ name: '/' + v + '/ ' + f0 + ' Hz ' + art + ' ' + a, sig: () => verdopplung(f0, a, art, F, B, 1.6, 0.6, 1.0), frames: [2400, 4200, 6000, 9600, 14400, 16800],
        wahr: () => [f0 / 2, f0], ok: (r, c) => c >= 1.0 * TSR + 840 ? Math.abs(r.f0 / (f0 / 2) - 1) < 0.03 : (Math.abs(r.f0 / f0 - 1) < 0.03 || Math.abs(r.f0 / (f0 / 2) - 1) < 0.03) });
    const R_pd = rahmen(PD, SCHNELL);
    // Belastung: weißes und rosa Rauschen 30 dB, Rosenberg-Quelle, Jitter 1 %, Netzbrumm −30 dB
    const LAST = [];
    for (const [v, F, B] of VOK6) for (let f0 = 77; f0 <= 450; f0 += 19.9) {
      const sv = () => D.synthVowel(f0, F, B, 0.35, SR), nm = '/' + v + '/ ' + f0.toFixed(1);
      LAST.push({ name: nm + ' weiß 30 dB', sig: () => mitSnr(sv(), 30, Math.round(f0 * 7)), frames: [2100], wahr: fest(f0) });
      LAST.push({ name: nm + ' rosa 30 dB', sig: () => { const x = sv(); return mitSnr(x, 30, 0, rosa(x.length, Math.round(f0 * 3))); }, frames: [2100], wahr: fest(f0) });
      LAST.push({ name: nm + ' Rosenberg', sig: () => rosenberg(f0, F, B, 0.35), frames: [2100], wahr: fest(f0) });
      LAST.push({ name: nm + ' Jitter 1 %', sig: () => verlauf(() => f0, 0.35, F, B, 0.01, Math.round(f0 * 13)), frames: [2100], wahr: fest(f0) });
      LAST.push({ name: nm + ' Brumm −30 dB', sig: () => mitBrumm(sv(), -30), frames: [2100], wahr: fest(f0) });
    }
    const R_last = rahmen(LAST, SCHNELL);

    const bB = bilanz(R_befund), bZ = bilanz(R_zuf.concat(R_zuf40)), bT = bilanz(R_tief), bV = bilanz(R_vok), bVib = bilanz(R_vib), bP = bilanz(R_pd), bL = bilanz(R_last);
    check('K3b', 'Befund-Fälle 348/192/121/97 Hz (enger Cluster, F2–F4-Cluster, F1 = 5·F0), je 100 Rahmen: jeder falsche Grundton trägt f0Unsure oder octaveAmbiguous',
      bB.n === 400 && bB.unm === 0, bB.txt);
    check('K3b', 'Zufallssatz 600 Baritonvokale (F0 75–450 Hz, Samen 4711), 200 davon mit weißem Rauschen 40 dB: jeder falsche Grundton markiert, kein richtiger als unsicher',
      bZ.n >= 780 && bZ.unm === 0 && bZ.fehl === 0, bZ.txt);
    check('K3b', 'tiefe Lage 76–133 Hz, schmaler F1 (30/45 Hz) auf dem 3.–6. Teilton: jeder falsche Grundton markiert, kein richtiger als unsicher',
      bT.n > 0 && bT.unm === 0 && bT.fehl === 0, bT.txt);
    check('K3b', 'sechs Vokale 75–450 Hz in Schritten von 2,73 Hz: richtiger Grundton nie als unsicher markiert, falscher immer',
      bV.n === 828 && bV.fehl === 0 && bV.unm === 0, bV.txt);
    check('K3b', 'sechs Vokale 75–450 Hz mit Vibrato 6 Hz ±50 Cent und 4 Hz ±30 Cent: richtiger Grundton nie als unsicher markiert, falscher immer',
      bVib.n >= 800 && bVib.fehl === 0 && bVib.unm === 0, bVib.txt);
    check('K3b', 'Periodenverdopplung (Amplitude oder Periode 8–14 %) mit Ausklang auf exakt f0/2: Grundton f0 oder f0/2, im Ausklang f0/2, nie f0Unsure',
      bP.n >= 570 && bP.falsch === 0 && R_pd.every(x => !x.r.f0Unsure), bP.txt);
    check('K3b', 'Rauschen 30 dB (weiß, rosa), Rosenberg-Quelle, Jitter 1 %, Netzbrumm −30 dB: jeder falsche Grundton markiert, kein richtiger als unsicher',
      bL.n >= 550 && bL.unm === 0 && bL.fehl === 0, bL.txt);
    // Vertrag: f0Cep ist der Cepstrum-Grundton (auf 1 % bei sauberen Vokalen), unstimmhaft NaN und f0Unsure false
    let cepOk = 0, cepN = 0;
    for (const x of R_vok) { cepN++; if (Math.abs(x.r.f0Cep / x.lo - 1) <= 0.01 || Math.abs(x.r.f0Cep * 2 / x.lo - 1) <= 0.01 || Math.abs(x.r.f0Cep * 3 / x.lo - 1) <= 0.01) cepOk++; }
    const stille = D.analyseAt(noise(TSR, 3e-4, 5), TSR, TSR / 2, { floorDb: -80 });
    check('K3b', 'f0Cep: Cepstrum-Grundton (oder sein ganzzahliger Unterton bis 1/3) auf 1 % bei den sechs Vokalen; Pause: f0Cep NaN, f0Unsure false',
      cepOk === cepN && cepN > 0 && !stille.voiced && Number.isNaN(stille.f0Cep) && stille.f0Unsure === false, cepOk + '/' + cepN);
    // Prüfgrundlage der schnellen Sätze: Grundtonfelder mit einer Ordnung gleich wie mit dem vollen Sweep
    let gleich = 0, nG = 0;
    for (const z of ZUF.slice(0, 40)) {
      const ds = D.resample(D.synthVowel(z.f0, z.F, z.B, 0.6, SR, { gain: 0.3 }), SR, TSR), a = D.analyseAt(ds, TSR, 2400, {}), b = D.analyseAt(ds, TSR, 2400, SCHNELL);
      nG++; if (a.f0 === b.f0 && a.f0Unsure === b.f0Unsure && a.f0Grund === b.f0Grund && (a.f0Cep === b.f0Cep) && a.octaveAmbiguous === b.octaveAmbiguous && a.subFactor === b.subFactor) gleich++;
    }
    check('K3b', 'Grundton, f0Cep, f0Unsure und Teilerkontrolle hängen nicht vom LPC-Ordnungssweep ab (Grundlage der schnellen Prüfsätze)', gleich === nG, gleich + '/' + nG);

    /* K3c: Korrektur. Ein Kandidat ersetzt den YIN-Wert nur, wenn Cepstrum, eigene Teiltonreihe,
       Teilerkontrolle und Reihenkontrast zusammenpassen; der alte Wert bleibt in f0Yin sichtbar. */
    const art = R => { const a = {}; for (const x of R) if (x.r.f0Korrektur) a[x.r.f0Korrektur] = (a[x.r.f0Korrektur] || 0) + 1; return Object.keys(a).map(k => k + ' ' + a[k]).join(', ') || 'keine'; };
    const befOk = R_befund.filter(x => x.ok).length, befKor = R_befund.filter(x => !x.okYin && x.r.f0Korrektur && x.r.f0Yin !== x.r.f0).length, befYinFalsch = R_befund.filter(x => !x.okYin).length;
    const befBad = R_befund.filter(x => !x.ok).slice(0, 3).map(x => x.name + ' ' + r1(x.r.f0) + ' Hz (YIN ' + r1(x.r.f0Yin) + ', Cepstrum ' + r1(x.r.f0Cep) + ')');
    check('K3c', 'Befund-Fälle 348/192/121/97 Hz: Grundton in allen 400 Rahmen richtig (±3 %), jeder falsche YIN-Wert sichtbar korrigiert (f0Korrektur, alter Wert in f0Yin)',
      befOk === 400 && befKor === befYinFalsch && befYinFalsch > 0,
      'richtig ' + befOk + '/400, YIN falsch ' + befYinFalsch + ', korrigiert ' + befKor + ' (' + art(R_befund) + ')' + (befBad.length ? ' — ' + befBad.join(' | ') : ''));
    const tiefOk = R_tief.filter(x => x.ok).length;
    check('K3c', 'tiefe Lage 76–133 Hz, schmaler F1 auf dem 3.–6. Teilton: Grundton in jedem Rahmen richtig', tiefOk === R_tief.length && R_tief.length > 0,
      tiefOk + '/' + R_tief.length + ', YIN falsch ' + R_tief.filter(x => !x.okYin).length + ' (' + art(R_tief) + ')');
    const ALLE = R_befund.concat(R_zuf, R_zuf40, R_tief, R_vok, R_vib, R_pd, R_last);
    const korr = ALLE.filter(x => x.r.f0Korrektur), korrFalsch = korr.filter(x => !x.ok), korrOhneNot = ALLE.filter(x => x.okYin && x.r.f0Korrektur);
    const yinFalsch = ALLE.filter(x => !x.okYin).length, nachher = ALLE.filter(x => !x.ok).length;
    check('K3c', 'Korrektur nur, wo der YIN-Wert falsch war, und dann immer richtig (alle K3b-Sätze, auch Periodenverdopplung und Belastung)',
      korrFalsch.length === 0 && korrOhneNot.length === 0 && korr.length > 0 && ALLE.filter(x => x.r.f0Korrektur && (x.r.f0Unsure || !isFinite(x.r.f0Yin))).length === 0,
      'Rahmen ' + ALLE.length + ', YIN falsch ' + yinFalsch + ', korrigiert ' + korr.length + ' (' + art(ALLE) + '), danach falsch ' + nachher + ' (alle markiert, siehe K3b); falsch korrigiert ' + korrFalsch.length + ', ohne Not ' + korrOhneNot.length +
      korrFalsch.concat(korrOhneNot).slice(0, 3).map(x => ' — ' + x.name + ' ' + r1(x.r.f0Yin) + ' → ' + r1(x.r.f0)).join(''));
    // Die Art benennt die Probe, die den Ausschlag gab; bei 'teiltonreihe' ist der neue Wert genau 2·f0Yin oder 3·f0Yin
    const artBad = korr.filter(x => !(x.r.f0Korrektur === 'cepstrum' || (x.r.f0Korrektur === 'teiltonreihe' && [2, 3].some(m => Math.abs(x.r.f0 / (m * x.r.f0Yin) - 1) < 1e-9))));
    const faktor = {}; for (const x of korr) if (x.r.f0Korrektur === 'teiltonreihe') { const k = '×' + Math.round(x.r.f0 / x.r.f0Yin); faktor[k] = (faktor[k] || 0) + 1; }
    check('K3c', 'f0Korrektur ist \'teiltonreihe\' (neuer Wert genau 2× oder 3× f0Yin) oder \'cepstrum\' (YIN-Dip an der Cepstrum-Periode), nichts anderes',
      artBad.length === 0 && korr.length > 0, korr.length + ' Korrekturen, Art ' + art(ALLE) + ', Faktor ' + JSON.stringify(faktor) + (artBad.length ? ' — ' + artBad.slice(0, 3).map(x => x.name + ' ' + x.r.f0Korrektur + ' ' + r1(x.r.f0Yin) + ' → ' + r1(x.r.f0)).join(' | ') : ''));
  }

  /* ---------- K4: SHR-Raster (analyseAt) ---------- */
  {
    const BW5 = [80, 90, 120, 150, 200];
    const VOK5 = [['a', [700, 1200, 2500, 3300, 4200], BW5], ['i', [300, 2200, 2900, 3500, 4300], [60, 100, 130, 160, 200]],
      ['u', [320, 800, 2400, 3300, 4200], [60, 90, 120, 150, 200]], ['o', [450, 800, 2500, 3300, 4200], [70, 90, 120, 150, 200]],
      ['e', [400, 1900, 2600, 3400, 4300], [60, 100, 130, 160, 200]]];
    const VOK6 = VOK5.concat([['eng', [500, 1500, 2450, 2800, 3150], [70, 90, 90, 90, 100]]]);
    const SCHNELL = { orders: [14] };
    const ds = x => D.resample(x, SR, TSR);
    const effW = x => { let p = 0; for (let i = 0; i < x.length; i++) p += x[i] * x[i]; return Math.sqrt(p / x.length); };
    const mitSnr = (x, snr, seed) => { const nz = noise(x.length, 1, seed), g = effW(x) * Math.pow(10, -snr / 20) / effW(nz), y = new Float64Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] + g * nz[i]; return y; };
    const lcg = seed => { let z = seed >>> 0; return () => { z = (z * 1664525 + 1013904223) >>> 0; return z / 4294967296; }; };
    function pulse(times, amps, s, F, B) {
      const n = Math.round(s * SR), src = new Float64Array(n);
      for (let k = 0; k < times.length; k++) {
        const pos = times[k] * SR, i0 = Math.floor(pos), q = pos - i0;
        for (let j = 0; j < 6; j++) { const w = amps[k] * Math.cos(Math.PI * j / 12); if (i0 + j < n) src[i0 + j] += w * (1 - q); if (i0 + j + 1 < n) src[i0 + j + 1] += w * q; }
      }
      let y = src; for (let m = 0; m < F.length; m++) y = D.resonate(y, F[m], B[m], SR);
      let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i]));
      for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / mx;
      return y;
    }
    // F0-Verlauf fHz(t), Jitter j (relativ, gleichverteilt je Periode)
    function verlauf(fHz, s, F, B, j, seed) {
      const rnd = lcg(seed || 1), times = [], amps = []; let t = 0;
      while (t < s) { times.push(t); amps.push(1); t += (1 + (j || 0) * (2 * rnd() - 1)) / fHz(t); }
      return pulse(times, amps, s, F, B);
    }
    function rosenberg(f0, F, B, s) {
      const n = Math.round(s * SR), g = new Float64Array(n), T = SR / f0, Tp = 0.6 * T * 2 / 3, Tn = 0.6 * T / 3;
      for (let i = 0; i < n; i++) { const t = i % T; g[i] = t < Tp ? 0.5 * (1 - Math.cos(Math.PI * t / Tp)) : (t < Tp + Tn ? Math.cos(Math.PI * (t - Tp) / (2 * Tn)) : 0); }
      let y = new Float64Array(n); for (let i = 1; i < n; i++) y[i] = g[i] - g[i - 1];
      for (let m = 0; m < F.length; m++) y = D.resonate(y, F[m], B[m], SR);
      let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(y[i]));
      for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / mx;
      return y;
    }
    const zeig = r => r1(r.shr) + ' dB (Raster ' + r0(r.shrGrid) + ', F0 ' + r1(r.f0) + ')' + (r.shrUnsure ? ' unsicher [' + r.shrGrund + '], anderes Raster ' + r1(r.shrOther) : '') + ', Kamm ' + r1(r.shrKamm);
    // höherer der ausgewiesenen Werte: bei Rasterzweifel der Wert auf dem Raster mit Subharmonischen
    const hoch = r => (r.shrUnsure && isFinite(r.shrOther)) ? Math.max(r.shr, r.shrOther) : r.shr;
    const unaufUnmarkiert = r => !r.shrUnsure && r.shr < -25, warnUnmarkiert = r => !r.shrUnsure && r.shr > -15;

    /* K4a: Starke Periodenverdopplung (jeder zweite Impuls schwächer) erscheint nie ungekennzeichnet als
       unauffällig. Vorher folgte das Raster der Periodenwahl: nahm YIN direkt die doppelte Periode, stand
       SHR auf dem Raster der halben Impulsrate (150 Hz, altRatio 0,5: −48,7 statt −10,0 dB). */
    {
      const r = D.analyseAt(ds(D.synthVowel(150, VOK5[0][1], BW5, 0.5, SR, { altRatio: 0.5 })), TSR, 3000, {});
      check('K4a', 'Befund 3: /a/ 150 Hz, jeder zweite Impuls halb so stark: SHR über −15 dB oder unsicher mit anderem Raster über −15 dB (vorher −48,7 dB unauffällig)',
        r.shr > -15 || (r.shrUnsure === true && r.shrOther > -15), zeig(r));
      let nR = 0, okR = 0, stumm = 0; const badR = [], aReihen = [];
      for (const [v, F, B] of VOK5) for (const f0 of [100, 150, 196, 247]) {
        const w = [0.9, 0.7, 0.5, 0.3].map(a => ({ a, r: D.analyseAt(ds(D.synthVowel(f0, F, B, 0.5, SR, { altRatio: a })), TSR, 3000, {}) })).filter(x => { if (!x.r.voiced) stumm++; return x.r.voiced; });
        nR++;
        if (v === 'a') aReihen.push(f0 + ' Hz: ' + w.map(x => r1(x.r.shr) + (x.r.shrUnsure ? '(' + r1(x.r.shrOther) + ')' : '')).join(' '));
        const steigt = w.length >= 3 && w.every((x, i) => i === 0 || hoch(x.r) > hoch(w[i - 1].r)), stark = w.every(x => x.a > 0.6 || !unaufUnmarkiert(x.r));
        if (steigt && stark) okR++; else badR.push('/' + v + '/ ' + f0 + ': ' + w.map(x => x.a + '→' + r1(x.r.shr) + (x.r.shrUnsure ? '(' + r1(x.r.shrOther) + ')' : '')).join(' '));
      }
      check('K4a', 'Alternation 0,9/0,7/0,5/0,3 bei 100/150/196/247 Hz, Vokale a/i/u/o/e: der höhere ausgewiesene SHR steigt mit der Alternation, starke Alternation (≤ 0,6) nie unmarkiert unter −25 dB',
        okR === nR, okR + '/' + nR + ' Reihen' + (stumm ? ', stimmlose Rahmen ausgelassen ' + stumm : '') + '; /a/ shr (anderes Raster): ' + aReihen.join(' | ') + (badR.length ? ' — ' + badR.slice(0, 4).join(' | ') : ''));
      const L = []; let i = 0;
      for (const [v, F, B] of VOK5) for (let f0 = 100; f0 <= 260; f0 += 12.6) for (const a of [0.3, 0.4, 0.5, 0.6]) {
        const x = D.synthVowel(f0, F, B, 0.35, SR, { altRatio: a }), nm = '/' + v + '/ ' + f0.toFixed(1) + ' a ' + a;
        for (const [sig, zus] of [[x, ''], [mitSnr(x, (i++) % 2 ? 30 : 40, 500 + i), (i % 2 ? ' SNR 30' : ' SNR 40')]]) {
          const r = D.analyseAt(ds(sig), TSR, 2100, SCHNELL);
          if (r.voiced) L.push({ nm: nm + zus, r });
        }
      }
      const bad = L.filter(x => unaufUnmarkiert(x.r));
      check('K4a', 'Alternation 0,3–0,6, Vokale a/i/u/o/e, 100–260 Hz, rauschfrei und mit Rauschen 30/40 dB: kein Rahmen unmarkiert unter −25 dB',
        L.length >= 500 && bad.length === 0, 'Rahmen ' + L.length + ', markiert ' + L.filter(x => x.r.shrUnsure).length + ', unmarkiert unauffällig ' + bad.length +
        (bad.length ? ' — ' + bad.slice(0, 3).map(x => x.nm + ': ' + zeig(x.r)).join(' | ') : ''));
    }

    /* K4b: Sauberer Ton mit F1 auf dem 2. Teilton warnt nicht unmarkiert. Vorher galt jede Teilung der
       Teilerkontrolle als Verdopplung: 175 Hz, F1 350 Hz → −12,4 dB statt −72,3 dB. Und Gegenprobe gegen
       „alles unsicher“: saubere Töne tragen den Zweifel fast nie. */
    const SAUBER = [];
    {
      const r = D.analyseAt(ds(D.synthVowel(175, [350, 1400, 2500, 3300, 4200], [50, 90, 120, 150, 200], 0.5, SR)), TSR, 3000, {});
      check('K4b', 'Befund 4: 175 Hz sauber, F1 = 350 Hz (B1 50): SHR unter −25 dB oder unsicher (vorher −12,4 dB Warnung)',
        r.shr <= -25 || r.shrUnsure === true, zeig(r));
      const L = [];
      for (const B1 of [50, 60, 70, 90]) for (let f0 = 150; f0 <= 360; f0 += 10) for (const off of [-20, 0, 20]) {
        const r2 = D.analyseAt(ds(D.synthVowel(f0, [2 * f0 + off, 1400, 2500, 3300, 4200], [B1, 90, 120, 150, 200], 0.35, SR)), TSR, 2100, SCHNELL);
        if (r2.voiced) L.push({ nm: f0 + ' Hz F1 ' + (2 * f0 + off) + ' B1 ' + B1, r: r2, f0 });
      }
      const bad = L.filter(x => warnUnmarkiert(x.r));
      check('K4b', 'F1 = 2·F0 (±20 Hz), F0 150–360 Hz, B1 50–90 Hz, sauber: kein Rahmen mit SHR über −15 dB ohne shrUnsure',
        L.length === 264 && bad.length === 0, 'Rahmen ' + L.length + ', Teilerkorrektur ' + L.filter(x => x.r.subFactor === 2).length + ', unmarkierte Warnung ' + bad.length +
        (bad.length ? ' — ' + bad.slice(0, 3).map(x => x.nm + ': ' + zeig(x.r)).join(' | ') : ''));
      for (const x of L) SAUBER.push(x);
      const add = (nm, sig, f0, c) => { const r2 = D.analyseAt(ds(sig), TSR, c || 2100, SCHNELL); if (r2.voiced) SAUBER.push({ nm, r: r2, f0 }); };
      for (const [v, F, B] of VOK6) for (let f0 = 75; f0 <= 450; f0 += 7.4) add('/' + v + '/ ' + f0.toFixed(1), D.synthVowel(f0, F, B, 0.35, SR), f0);
      for (const [v, F, B] of VOK6) for (let f0 = 77; f0 <= 450; f0 += 19.9) {
        const sv = () => D.synthVowel(f0, F, B, 0.35, SR), nm = '/' + v + '/ ' + f0.toFixed(1);
        add(nm + ' weiß 30 dB', mitSnr(sv(), 30, Math.round(f0 * 7)), f0);
        add(nm + ' weiß 40 dB', mitSnr(sv(), 40, Math.round(f0 * 5)), f0);
        add(nm + ' Rosenberg', rosenberg(f0, F, B, 0.35), f0);
        add(nm + ' Jitter 1 %', verlauf(() => f0, 0.35, F, B, 0.01, Math.round(f0 * 13)), f0);
        add(nm + ' Jitter 2 %', verlauf(() => f0, 0.35, F, B, 0.02, Math.round(f0 * 17)), f0);
        add(nm + ' Vibrato 6 Hz ±50 c', verlauf(t => f0 * Math.pow(2, 50 / 1200 * Math.sin(2 * Math.PI * 6 * t + f0)), 0.35, F, B), f0);
        add(nm + ' Wobble 3,5 Hz ±30 c', verlauf(t => f0 * Math.pow(2, 30 / 1200 * Math.sin(2 * Math.PI * 3.5 * t + f0)), 0.35, F, B), f0);
      }
      const rnd = lcg(4712), U = (a, b) => a + (b - a) * rnd();
      for (let t = 0; t < 200; t++) {
        const f0 = U(75, 450), F1 = U(280, 800), F2 = U(Math.max(F1 + 250, 750), 2300), F3 = U(Math.max(F2 + 200, 1800), 3000), F4 = F3 + U(150, 1000), F5 = U(F4 + 250, Math.max(F4 + 300, 4500));
        const sig = D.synthVowel(f0, [F1, F2, F3, F4, F5], [U(35, 100), U(50, 130), U(70, 200), U(90, 220), U(120, 300)], 0.4, SR, { gain: 0.3 });
        add('Zufall ' + t + ' ' + f0.toFixed(1), t % 2 ? sig : mitSnr(sig, 35, 900 + t), f0, 2400);
      }
      const recht = SAUBER.filter(x => Math.abs(x.r.f0 / x.f0 - 1) < 0.03 && !x.r.f0Unsure), warn = SAUBER.filter(x => warnUnmarkiert(x.r)), zw = recht.filter(x => x.r.shrUnsure);
      check('K4b', 'saubere Töne (6 Vokale 75–450 Hz, F1 = 2·F0, Rauschen 30/40 dB, Rosenberg, Jitter 1/2 %, Vibrato, Wobble, 200 Zufallsvokale): keine unmarkierte Warnung, Rasterzweifel in höchstens 1 % der Rahmen mit richtigem Grundton',
        SAUBER.length >= 1500 && warn.length === 0 && zw.length <= 0.01 * recht.length,
        'Rahmen ' + SAUBER.length + ', unmarkierte Warnung ' + warn.length + ', Rasterzweifel ' + zw.length + '/' + recht.length +
        (zw.length ? ' (' + zw.slice(0, 4).map(x => x.nm + ' [' + x.r.shrGrund + ']').join(', ') + ')' : '') + (warn.length ? ' — ' + warn.slice(0, 3).map(x => x.nm + ': ' + zeig(x.r)).join(' | ') : ''));
    }

    /* K4d: Vertrag der SHR-Felder. shr steht auf shrGrid (F0 oder 2·F0); shrOther ist genau dann eine Zahl,
       wenn das Raster zweifelhaft ist, und steht auf dem anderen Raster; shrUnsure = Rasterzweifel oder
       unsicherer Grundton; Hauptwert 2·F0 nur mit Kammbeleg, bei deutlichem Kamm immer. */
    {
      const proben = [];
      const nimm = (nm, sig, c, opts) => { const x = ds(sig); proben.push({ nm, x, c, r: D.analyseAt(x, TSR, c, Object.assign({ wantSpectrum: true }, opts || {})) }); };
      for (const [v, F, B] of VOK5) for (const f0 of [100, 150, 196, 247, 330]) for (const a of [1, 0.7, 0.5, 0.3]) nimm('/' + v + '/ ' + f0 + ' a ' + a, D.synthVowel(f0, F, B, 0.35, SR, { altRatio: a }), 2100);
      for (const f0 of [175, 230]) nimm('F1 = 2·F0 ' + f0, D.synthVowel(f0, [2 * f0, 1400, 2500, 3300, 4200], [50, 90, 120, 150, 200], 0.35, SR), 2100);
      nimm('eng 246 Hz', D.synthVowel(246, VOK6[5][1], VOK6[5][2], 0.35, SR), 2100);
      nimm('Pause', noise(Math.round(0.35 * SR), 3e-4, 5), 2100, { floorDb: -80 });
      const fehler = [];
      let nZw = 0, n2 = 0, nG = 0;
      for (const p of proben) {
        const r = p.r, e = [];
        if (!r.voiced) {
          if (!(Number.isNaN(r.shr) && r.shrUnsure === false && Number.isNaN(r.shrOther) && r.shrGrund === '' && Number.isNaN(r.shrKamm))) e.push('stimmlos nicht leer');
        } else {
          const db = r.spectrumDb, sp = { db, sr: TSR, df: TSR / (2 * (db.length - 1)), N: 2 * (db.length - 1) }, f0 = r.f0, in2 = 2 * f0 <= 500;
          const zweifel = isFinite(r.shrOther), aufZwei = r.shrGrid === 2 * f0;
          if (!(r.shrGrid === f0 || aufZwei)) e.push('Raster ' + r.shrGrid);
          if (!(Math.abs(r.shr - D.shrAgainst(sp, r.shrGrid)) < 1e-9)) e.push('shr nicht auf shrGrid');
          if (zweifel && !(Math.abs(r.shrOther - D.shrAgainst(sp, aufZwei ? f0 : 2 * f0)) < 1e-9)) e.push('shrOther nicht auf dem anderen Raster');
          if (!zweifel && aufZwei) e.push('2·F0 ohne Zweifel');
          if (r.shrUnsure !== (zweifel || r.f0Unsure)) e.push('shrUnsure ' + r.shrUnsure);
          if ((r.shrGrund.indexOf('grundton') >= 0) !== r.f0Unsure) e.push('Grund ' + r.shrGrund);
          if (in2) {
            const k = D.kammKontrast(sp, 2 * f0);
            if (!(Math.abs(r.shrKamm - k) < 1e-9)) e.push('shrKamm ' + r1(r.shrKamm) + ' statt ' + r1(k));
            if (k <= D.SHR_KAMM_RASTER_DB && !aufZwei) e.push('deutlicher Kamm ohne Raster 2·F0');
            if (aufZwei && !(k <= D.SHR_KAMM_ZWEIFEL_DB)) e.push('Raster 2·F0 ohne Kamm');
            if ((r.shrGrund.indexOf('kamm') >= 0) !== (k <= D.SHR_KAMM_ZWEIFEL_DB)) e.push('Grund kamm ' + r.shrGrund);
          } else if (zweifel || aufZwei || !Number.isNaN(r.shrKamm)) e.push('2·F0 über fmax, trotzdem Raster 2·F0 erwogen');
          if (zweifel) nZw++; if (aufZwei) n2++; if (!in2) nG++;
        }
        if (e.length) fehler.push(p.nm + ': ' + e.join(', '));
      }
      check('K4d', 'Vertrag: shr auf shrGrid ∈ {F0, 2·F0}; shrOther nur bei Rasterzweifel, dann auf dem anderen Raster; shrUnsure = Zweifel oder f0Unsure; Kamm ≤ ' + D.SHR_KAMM_RASTER_DB + ' dB → Raster 2·F0, Raster 2·F0 nur mit Kamm ≤ ' + D.SHR_KAMM_ZWEIFEL_DB + ' dB; 2·F0 über 500 Hz → kein Zweifel; stimmlos leer',
        fehler.length === 0 && nZw > 0 && n2 > 0 && nG > 0, proben.length + ' Proben, Zweifel ' + nZw + ', Raster 2·F0 ' + n2 + ', 2·F0 über 500 Hz ' + nG + (fehler.length ? ' — ' + fehler.slice(0, 4).join(' | ') : ''));
      // Prüfgrundlage der schnellen Sätze: SHR-Felder hängen nicht vom LPC-Ordnungssweep ab
      let gleich = 0;
      for (const p of proben.slice(0, 40)) {
        const b = D.analyseAt(p.x, TSR, p.c, SCHNELL), a = p.r;
        if (['shr', 'shrGrid', 'shrUnsure', 'shrOther', 'shrGrund', 'shrKamm'].every(k => Object.is(a[k], b[k]))) gleich++;
      }
      check('K4d', 'SHR-Felder hängen nicht vom LPC-Ordnungssweep ab (Grundlage der schnellen Prüfsätze)', gleich === 40, gleich + '/40');
    }
  }
};

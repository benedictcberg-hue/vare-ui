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
    for (let k = 0; k < tr.t.length; k++) {
      if (tr.rand[k] && tr.t[k] > 0.48 && tr.t[k] < 0.52) randAmEnde++;
      if (tr.rand[k] && tr.t[k] > 0.1 && tr.t[k] < 0.4) randMitte++;
      if (tr.rand[k] && !(typeof tr.f0[k] === 'number' && typeof tr.ap[k] === 'number')) roh = false;
    }
    check('K1b', 'Feinspur: Rahmen mit Tonende im Fenster sind als Rand markiert, im stehenden Ton keiner; Messwerte bleiben roh', randAmEnde > 0 && randMitte === 0 && roh, 'Rand am Ende ' + randAmEnde + ', im Ton ' + randMitte);
  }
};

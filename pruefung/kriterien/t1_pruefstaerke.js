/* P1 — Prüfstärke Rechenkern und Gatter.
   Die bestehenden Kriterien prüfen meist, dass saubere Vokale gültig sind. Ob eine Regel der
   Spezifikation tatsächlich entscheidet, prüfen sie kaum: man konnte die Sweep-Streuung, die
   Pegel- und Aperiodizitätsschwelle oder die Gatter-Haltezeit streichen, und alles blieb grün.
   Jedes Kriterium hier prüft eine Entscheidung (gültig, stimmhaft, stabil) an Rahmen, bei denen
   genau diese Regel den Ausschlag gibt, und verlangt, dass es solche Rahmen überhaupt gibt —
   sonst wäre ein „keine Verletzung“ wertlos.
   Grenzwerte stehen hier als Zahl der Spezifikation, nicht aus dem geprüften Code gelesen: sonst
   ändert eine falsche Konstante Prüfling und Prüfung zugleich. */
'use strict';

module.exports = async function (H) {
  const { check, r0, r2, noise, concat, scale, dbToLin, SR, TSR, CASES, D, V, A, C } = H;

  const SPREAD_MAX = 130;      // spec_v16: gültig nur, wenn beide Sweeps unter 130 Hz streuen
  const AP_MAX = 0.45;         // spec_v16, Clean-Silence-Protokoll: Aperiodizität < 0,45
  const LEVEL_OVER_FLOOR = 12; // spec_v16: Pegel über Rauschboden + 12 dB
  const HOLD_S = 0.15;         // vowel.js: Hysterese beim Klassenwechsel, als fest dokumentiert

  const VOW = {
    a: [CASES[0].F, CASES[0].B], i: [CASES[1].F, CASES[1].B], u: [CASES[2].F, CASES[2].B], weit: [CASES[4].F, CASES[4].B],
    o: [[450, 800, 2500, 3300, 4200], [70, 90, 120, 150, 200]], e: [[400, 1900, 2600, 3400, 4300], [60, 100, 130, 160, 200]]
  };
  const synth = (f0, v, dur, opt) => D.synthVowel(f0, VOW[v][0], VOW[v][1], dur, SR, opt);

  /* ---------- Gültigkeit: beide Sweeps unter 130 Hz, Slot-Lücke über alle Fenster ---------- */
  {
    // Fenster wie in analyseAt (zentriert), damit das Urteil jedes einzelnen Fensters über die
    // Nummerierung unabhängig zusammengeführt werden kann: veto[k] = irgendein Fenster hält Slot k für
    // unsicher (Lesarten oder Verschmelzung), haupt[k] = das Hauptfenster allein.
    function fensterUrteil(ds, c) {
      const veto = [false, false, false, false, false], haupt = [false, false, false, false, false];
      for (const L of D.WINDOWS) {
        const n = Math.round(L * TSR), st = c - (n >> 1);
        if (st < 0 || st + n > ds.length) continue;
        const w = D.analyseWindow(ds.subarray(st, st + n), TSR, {});
        for (let k = 0; k < 5; k++) {
          const u = !!(w.slotUnsure[k] || (w.slotMerged && w.slotMerged[k]));
          if (u) veto[k] = true;
          if (u && Math.abs(L - D.MAIN_WINDOW) < 1e-9) haupt[k] = true;
        }
      }
      return { veto, haupt };
    }
    function frame(ds, c) {
      const r = D.analyseAt(ds, TSR, c, { floorDb: -70 });
      return r.voiced ? { r, uMin: fensterUrteil(ds, c) } : null;
    }
    // Korpus W: Vokalwechsel ohne Pause. Rahmen um die Grenze sehen in den vier Fensterlängen
    // verschieden viel vom zweiten Vokal — der Fenstersweep streut dort, der Ordnungssweep kaum.
    // Seit der Rechenkern die Nummerierung jedes Fensters nach Lesarten prüft und mehrdeutige Slots über
    // alle Fenster sperrt, sind die meisten dieser Rahmen schon dadurch unsicher; bei 4 Paaren und 3
    // Grundtönen blieben 5 Slots, an denen die Fensterstreuung allein entscheidet. Daher 6 Paare und
    // 5 Grundtöne (98–262 Hz); die Eigenschaft und die Mindestzahlen sind unverändert.
    const W = [];
    for (const [x, y] of [['a', 'i'], ['u', 'e'], ['o', 'a'], ['i', 'u'], ['weit', 'i'], ['e', 'o']]) for (const f0 of [98, 110, 147, 196, 262]) {
      const ds = D.resample(concat([synth(f0, x, 0.5), synth(f0, y, 0.5)]), SR, TSR);
      for (let j = 0; j <= 20; j++) { const f = frame(ds, Math.round((0.40 + 0.01 * j) * TSR)); if (f) W.push(f); }
    }
    // Korpus O: stationäre Vokale in hoher Lage. Alle Fenster sehen dasselbe (Fenstersweep 0),
    // aber die LPC-Ordnungen rasten auf verschiedenen Teiltönen ein — dort entscheidet allein
    // die Ordnungsstreuung.
    const O = [];
    for (const v of ['a', 'i', 'u', 'o', 'e', 'weit']) for (let f0 = 330; f0 <= 470; f0 += 10) {
      const f = frame(D.resample(synth(f0, v, 0.3), SR, TSR), Math.round(0.15 * TSR)); if (f) O.push(f);
    }
    // Korpus B: stationäre Vokale mit einem breiten Formanten (F2 oder F3 mit 600 Hz Bandbreite, etwa bei
    // Nasalierung), 98–247 Hz. Die Ordnungen legen den breiten Gipfel verschieden (Streuung 130–195 Hz),
    // die Fenster sind sich einig. Seit der Rechenkern über 375 Hz Grundton keinen Slot mehr gelten lässt
    // und darunter Gipfelpaare enger als 1,5·F0 sperrt (Teiltonabstand), entscheidet die Ordnungsstreuung
    // in Korpus O kaum noch (1 Slot statt mindestens 3); Korpus B trägt die Prüfung. Eigenschaft und
    // Mindestzahl sind unverändert.
    const B = [];
    for (const v of ['a', 'u', 'weit']) for (const kw of [1, 2]) for (const f0 of [98, 123, 147, 175, 196, 220, 247]) {
      const bw = VOW[v][1].slice(); bw[kw] = 600;
      const f = frame(D.resample(D.synthVowel(f0, VOW[v][0], bw, 0.3, SR), SR, TSR), Math.round(0.15 * TSR)); if (f) B.push(f);
    }
    // „Rest gültig“: alle übrigen Bedingungen der Gültigkeit erfüllt — dann entscheidet die geprüfte Regel.
    const rest = (r, k) => isFinite(r.F[k]) && r.nWin[k] >= 3 && r.nOrders[k] >= 2 && !r.slotUnsure[k];
    function tally(frames, decisive, wrong) {
      let dec = 0, bad = 0;
      const ex = [];
      for (const { r, uMin } of frames) for (let k = 0; k < 5; k++) {
        if (decisive(r, k, uMin)) dec++;
        if (r.valid[k] && wrong(r, k, uMin)) { bad++; if (ex.length < 3) ex.push('F' + (k + 1) + '=' + r0(r.F[k]) + ' sdWin ' + r0(r.sdWin[k]) + ' sdOrder ' + r0(r.sdOrder[k])); }
      }
      return { dec, bad, ex };
    }

    const w = tally(W, (r, k) => rest(r, k) && r.sdOrder[k] < SPREAD_MAX && r.sdWin[k] >= SPREAD_MAX, (r, k) => !(r.sdWin[k] < SPREAD_MAX));
    check('P1a', 'Vokalwechsel: kein Slot mit Fenstersweep-Streuung >= 130 Hz gilt als gueltig (mind. 10 entscheidende Slots)',
      w.dec >= 10 && w.bad === 0, 'entscheidend ' + w.dec + ', trotzdem gueltig ' + w.bad + (w.ex.length ? ': ' + w.ex.join('; ') : ''));

    const o = tally(O.concat(W, B), (r, k) => rest(r, k) && r.sdWin[k] < SPREAD_MAX && r.sdOrder[k] >= SPREAD_MAX, (r, k) => !(r.sdOrder[k] < SPREAD_MAX));
    check('P1b', 'hohe Lage 330-470 Hz, Vokalwechsel und breite Formanten (98-247 Hz): kein Slot mit Ordnungsstreuung >= 130 Hz gilt als gueltig (mind. 3 entscheidende Slots)',
      o.dec >= 3 && o.bad === 0, 'entscheidend ' + o.dec + ', trotzdem gueltig ' + o.bad + (o.ex.length ? ': ' + o.ex.join('; ') : ''));

    // Die Grenze selbst: eine Streuung knapp über 130 Hz ist ebenso ungültig wie eine grobe.
    const big = (r, k) => Math.max(r.sdWin[k], r.sdOrder[k]);
    const g = tally(O.concat(W), (r, k) => rest(r, k) && big(r, k) >= SPREAD_MAX && big(r, k) < 400, (r, k) => big(r, k) >= SPREAD_MAX && big(r, k) < 400);
    check('P1c', 'Streuung zwischen 130 und 400 Hz: Slot ungueltig, die Grenze liegt bei 130 Hz (mind. 10 entscheidende Slots)',
      g.dec >= 10 && g.bad === 0, 'entscheidend ' + g.dec + ', trotzdem gueltig ' + g.bad + (g.ex.length ? ': ' + g.ex.join('; ') : ''));

    // Nummerierung über alle Fenster: hält irgendein Fenster des Sweeps die Nummer eines Slots für
    // unsicher, ist der Slot nicht gültig — auch wenn das Hauptfenster eindeutig ist.
    // Früher: Lückenregel mit dem Minimum der Gipfelzahl über die Fenster („größte Lücke, alles darüber
    // unsicher“). Der Rechenkern prüft seit der Zusammenführung Lesarten statt der größten Lücke; die
    // Lückenregel riet dort falsch: /weit/→/i/ bei 98 Hz, Fenster 0,06 s mit vier Gipfeln, größte Lücke
    // über F1 — dabei kann 520 Hz nur F1 und 1484 Hz nur F2 sein (gültig, wahr 1500). Gemessen 6 solche
    // Slots, alle richtig (Fehler 16–82 Hz). Geprüft wird weiter die Zusammenführung über die Fenster.
    const s = tally(W.concat(O), (r, k, u) => isFinite(r.F[k]) && r.nWin[k] >= 3 && r.nOrders[k] >= 2 && big(r, k) < SPREAD_MAX && !(r.rauschBoden && r.rauschBoden[k]) && u.veto[k] && !u.haupt[k],
      (r, k, u) => u.veto[k]);
    check('P1d', 'Nummerierung in irgendeinem Fenster des Sweeps unsicher: Slot nicht gueltig, auch wenn das Hauptfenster eindeutig ist (mind. 10 entscheidende Slots)',
      s.dec >= 10 && s.bad === 0, 'nur ueber die uebrigen Fenster entscheidbar ' + s.dec + ', trotzdem gueltig ' + s.bad + (s.ex.length ? ': ' + s.ex.join('; ') : ''));
  }

  /* ---------- Stimmhaftigkeit: Pegel > Boden + 12 dB und Aperiodizität < 0,45 ---------- */
  // Rauschboden immer ausdrücklich übergeben: die Kriterien prüfen die VAD, nicht estimateFloor.
  {
    // Sauberer Vokal (Aperiodizität ~0), Pegel im Hauptfenster exakt eingestellt: hier entscheidet nur der Pegel.
    const v = D.resample(synth(196, 'a', 0.5), SR, TSR), mid = Math.round(0.25 * TSR);
    const lvl = D.rmsDb(v.subarray(mid - Math.round(D.MAIN_WINDOW * TSR / 2), mid + Math.round(D.MAIN_WINDOW * TSR / 2)));
    const wrong = [];
    let n = 0;
    for (const floorDb of [-60, -45]) for (let d = 8.5; d <= 15.51; d += 0.5) {
      if (Math.abs(d - LEVEL_OVER_FLOOR) < 0.25) continue;   // genau auf der Grenze entscheidet die Rundung
      const r = D.analyseAt(scale(v, dbToLin(floorDb + d - lvl)), TSR, mid, { floorDb });
      const soll = d > LEVEL_OVER_FLOOR;
      n++;
      if (r.voiced !== soll || r.audible !== soll) wrong.push('Boden ' + floorDb + ' +' + d + ' dB: stimmhaft ' + r.voiced);
    }
    check('P1e', 'Pegelleiter Boden +8,5 ... +15,5 dB (Boden -60 und -45): stimmhaft genau oberhalb Boden + 12 dB',
      wrong.length === 0 && n === 28, n + ' Stufen, falsch ' + wrong.length + (wrong.length ? ': ' + wrong.slice(0, 4).join('; ') : ''));

    // Vokal und weißes Rauschen gleichzeitig, beide weit über dem Boden. Rauschen 2 dB über dem
    // Vokal ergibt eine Aperiodizität um 0,55-0,65: laut, mit Grundton, aber nicht stimmhaft.
    // Entscheidend sind Rahmen im mäßig aperiodischen Bereich 0,45-0,70, den eine zu lockere
    // Schwelle noch als Stimme durchließe.
    function mix(f0, noiseDb, seed) {
      const vv = D.resample(synth(f0, 'a', 0.8), SR, TSR), nz = noise(vv.length, 1, seed);
      const gv = dbToLin(-20 - D.rmsDb(vv)), gn = dbToLin(noiseDb - D.rmsDb(nz)), y = new Float64Array(vv.length);
      for (let i = 0; i < y.length; i++) y[i] = vv[i] * gv + nz[i] * gn;
      return y;
    }
    function scan(noiseDb) {
      const o = { n: 0, voiced: 0, dec: 0, bad: 0, aps: [] };
      for (const [f0, seed] of [[110, 31], [196, 37]]) {
        const y = mix(f0, noiseDb, seed);
        for (let c = 900; c + 900 < y.length; c += 120) {
          const r = D.analyseAt(y, TSR, c, { floorDb: -70 });
          o.n++; o.aps.push(r.ap);
          if (r.voiced) o.voiced++;
          if (r.audible && r.ap >= AP_MAX && r.ap < 0.70) o.dec++;
          if (r.voiced && !(r.ap < AP_MAX && r.rmsDb > -70 + LEVEL_OVER_FLOOR)) o.bad++;
        }
      }
      o.aps.sort((p, q) => p - q);
      o.apMed = o.aps[o.aps.length >> 1];
      return o;
    }
    const hi = scan(-18);
    check('P1f', 'Vokal -20 dBFS mit Rauschen -18 dBFS (Aperiodizitaet 0,45-0,70): kein Rahmen stimmhaft (mind. 20 entscheidende Rahmen)',
      hi.dec >= 20 && hi.bad === 0 && hi.voiced === 0, 'entscheidend ' + hi.dec + '/' + hi.n + ', stimmhaft ' + hi.voiced + ', ap-Median ' + r2(hi.apMed));
    const lo = scan(-24);
    check('P1g', 'Gegenprobe: derselbe Vokal mit Rauschen -24 dBFS (Aperiodizitaet unter 0,45) bleibt stimmhaft (>= 90 %)',
      lo.voiced >= 0.9 * lo.n && lo.bad === 0, 'stimmhaft ' + lo.voiced + '/' + lo.n + ', ap-Median ' + r2(lo.apMed));
  }

  /* ---------- ΔF3–4 stabil: nur gewertete Rahmen (F3 >= 2500 Hz) ---------- */
  {
    // Tiefes enges Cluster (Physik §4): stabil und mit gültigem F3/F4, aber F3 unter 2500 Hz.
    // Es darf in „ΔF3–4 stabil“ nicht auftauchen — sonst steht ein enger Abstand als Erfolg da.
    const sil = noise(Math.round(0.3 * SR), 1e-3, 11);
    const take = concat([sil, D.synthVowel(196, [500, 1500, 2200, 2700, 3900], [70, 90, 100, 110, 150], 1.5, SR), sil]);
    const res = await A.analyseTake(take, SR, { floorDb: -60 });
    const s = res.summary, se = res.series;
    let stab = 0;
    for (let i = 0; i < se.t.length; i++) if (se.gate[i] === 2 && (se.flags[i] & A.FLAG.D34VALID)) stab++;
    const L = C.takesToCsv([{ code: 'P', createdAt: 'x', summary: s }], 'standard').split('\n');
    const head = L[0].split(','), row = L[1].split(',');
    const med = row[head.indexOf('d34_stable_med')], nn = row[head.indexOf('d34_stable_n')];
    check('P1h', 'tiefes enges Cluster (F3 2200 Hz): kein dF3-4 stabil, CSV -99.0 und n 0 (mind. 50 stabile Rahmen mit gueltigem dF3-4)',
      stab >= 50 && s.d34stable.n === 0 && !isFinite(s.d34stable.med) && med === '-99.0' && nn === '0',
      'stabil mit gueltigem dF3-4 ' + stab + ', d34stable n ' + s.d34stable.n + ', CSV ' + med + ' / ' + nn + ', F3-Median ' + r0(s.F[2].med));

    // Dieselbe Regel an einer konstruierten Reihe, unabhängig vom Rechenkern: jeder zweite stabile
    // Rahmen hat F3 unter 2500 Hz und damit keinen Score, aber ein gültiges ΔF3–4.
    const n = 40, ser = A.makeSeries(n), want = [];
    for (let i = 0; i < n; i++) {
      const tief = i % 2 === 1;
      ser.t[i] = i * 0.01; ser.f0[i] = 196; ser.rms[i] = -20; ser.gate[i] = 2; ser.cls[i] = V.CLASS_INDEX.a; ser.valid[i] = 31;
      ser.flags[i] = A.FLAG.VOICED | A.FLAG.D34VALID | (tief ? 0 : A.FLAG.SCORE);
      ser.f1[i] = 700; ser.f2[i] = 1200; ser.f3[i] = tief ? 2200 : 2700; ser.f4[i] = tief ? 2600 : 3500; ser.f5[i] = 4200;
      ser.d34[i] = ser.f4[i] - ser.f3[i]; ser.score[i] = tief ? NaN : ser.d34[i];
      if (!tief) want.push(ser.score[i]);
    }
    const su = A.summarise(ser, { hopS: 0.01, durationS: n * 0.01, floorDb: -60, floorSource: 'calibration', floorKnown: true, gate: V.createGate({}).opts });
    check('P1i', 'dF3-4 stabil zaehlt nur gewertete Rahmen: 20 von 40 stabilen, Median aus diesen',
      su.d34stable.n === want.length && su.d34stable.med === D.median(want), 'n ' + su.d34stable.n + ' (soll ' + want.length + '), Median ' + r0(su.d34stable.med) + ' (soll ' + r0(D.median(want)) + ')');
  }

  /* ---------- Live-Gatter: Haltezeit und Kandidatenverfall ---------- */
  {
    // Referenz ist dasselbe Gatter mit holdS = 0: es meldet „stabil“, sobald das Fenster die neue
    // Klasse zeigt. Das Standardgatter muss danach noch mindestens HOLD_S warten. So hängt die
    // Prüfung nicht davon ab, wie schnell das Fenster selbst umschlägt.
    const HOP = 0.01, HOLD_FRAMES = Math.round(HOLD_S / HOP);
    const fr = (t, i) => ({ t, voiced: true, F1: i ? 300 : 700, F2: i ? 2200 : 1200, F3: 2900, valid1: true, valid2: true, d34: 600, d34valid: true });
    function run(gate, plan) {
      let t = 0;
      const o = { firstI: null, excI: 0 };
      plan.forEach((ph, pi) => {
        for (let j = 0; j < ph[1]; j++, t += HOP) {
          const r = gate.update(fr(t, ph[0]));
          const isI = r.state === 'stabil' && r.cls === 'i';
          if (pi === plan.length - 1) { if (isI && o.firstI === null) o.firstI = j; }
          else if (isI) o.excI++;
        }
      });
      return o;
    }
    const both = plan => ({ std: run(V.createGate({}), plan), ref: run(V.createGate({ holdS: 0 }), plan) });
    const diff = x => (x.std.firstI !== null && x.ref.firstI !== null) ? x.std.firstI - x.ref.firstI : NaN;

    const hart = both([[false, 100], [true, 120]]);
    check('P1j', 'Gatter, harter Wechsel a->i: stabil /i/ fruehestens 0,15 s nachdem das Fenster /i/ meldet',
      diff(hart) >= HOLD_FRAMES, 'Fenster meldet /i/ ab Rahmen ' + hart.ref.firstI + ', stabil ab ' + hart.std.firstI + ' (Abstand ' + diff(hart) + ', soll >= ' + HOLD_FRAMES + ')');

    // Abgebrochener Wechsel: 0,30 s /i/ genügt, damit das Fenster kurz /i/ meldet und ein Kandidat
    // entsteht. Nach der Rückkehr zu /a/ muss er verfallen; beim echten Wechsel läuft die Haltezeit neu.
    const plan = [[false, 60], [true, 30], [false, 60], [true, 120]];
    const ab = both(plan);
    check('P1k', 'Gatter, nach abgebrochenem Wechsel: Haltezeit 0,15 s gilt beim naechsten Wechsel neu (Kandidat verfaellt)',
      ab.ref.excI > 0 && diff(ab) >= HOLD_FRAMES, 'Ausflug vom Fenster gemeldet ' + ab.ref.excI + ' Rahmen; Fenster meldet /i/ ab ' + ab.ref.firstI + ', stabil ab ' + ab.std.firstI + ' (Abstand ' + diff(ab) + ')');
    check('P1l', 'Gatter: ein Ausflug, den das Fenster kuerzer als 0,15 s meldet, wird nie stabil',
      ab.ref.excI > 0 && ab.ref.excI < HOLD_FRAMES && ab.std.excI === 0, 'Fenster meldet /i/ ' + ab.ref.excI + ' Rahmen, Standardgatter stabil /i/ ' + ab.std.excI + ' Rahmen');
  }
};

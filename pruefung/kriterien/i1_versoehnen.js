/* I1 — Kriterien nach der Zusammenführung der Arbeitsstände (Rechenkern, Auswertung, Oberfläche, Prüfstärke).
   I1a: Nummerierung über die Fenster. Seit der Rechenkern die Lückenregel durch Lesarten ersetzt hat
   (slotNumberUnsure), prüft jedes Fenster nur, ob seine eigenen Gipfel eindeutig nummeriert sind. An
   einem Vokalwechsel sieht ein kurzes Fenster nur den neuen Vokal mit vier Gipfeln, die längeren sehen
   dazu einen Gipfel des alten Vokals und zählen eine Stufe höher: derselbe Gipfel heißt dort F4, hier F5.
   Der F5-Slot hatte im kurzen Fenster keinen Wert, also keinen Einspruch, und F5 galt mit drei Fenstern
   als gültig (gemessen F5 3488 statt 4300 Hz). Geprüft wird unabhängig von den Lesarten: Führt irgendein
   Fenster den Wert eines Slots (± 130 Hz, die Gültigkeitsgrenze der Sweeps) unter einer anderen Nummer,
   ist die Nummerierung nicht eindeutig und der Slot nicht gültig. */
'use strict';
module.exports = async function (H) {
  const { check, r0, concat, SR, TSR, D } = H;
  const SPREAD_MAX = 130;   // spec_v16: Gültigkeitsgrenze beider Sweeps
  const VOW = {
    a: [[700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200]], i: [[300, 2200, 2900, 3500, 4300], [60, 100, 130, 160, 200]],
    u: [[320, 800, 2400, 3300, 4200], [60, 90, 120, 150, 200]], e: [[400, 1900, 2600, 3400, 4300], [60, 100, 130, 160, 200]],
    weit: [[500, 1500, 2300, 3350, 4300], [70, 90, 130, 170, 220]]
  };
  {
    let entscheidend = 0, gueltig = 0, rahmen = 0;
    const bsp = [];
    for (const [x, y] of [['a', 'i'], ['u', 'e'], ['i', 'u'], ['weit', 'i']]) for (const f0 of [98, 110, 147, 196, 220]) {
      const ds = D.resample(concat([D.synthVowel(f0, VOW[x][0], VOW[x][1], 0.5, SR), D.synthVowel(f0, VOW[y][0], VOW[y][1], 0.5, SR)]), SR, TSR);
      for (let j = 0; j <= 24; j++) {
        const c = Math.round((0.44 + 0.005 * j) * TSR), r = D.analyseAt(ds, TSR, c, { floorDb: -70 });
        if (!r.voiced) continue;
        rahmen++;
        // Fenster wie in analyseAt (zentriert), jedes für sich
        const win = D.WINDOWS.map(L => { const n = Math.round(L * TSR), st = c - (n >> 1); return D.analyseWindow(ds.subarray(st, st + n), TSR, {}); });
        for (let k = 0; k < 5; k++) {
          if (!isFinite(r.F[k])) continue;
          if (!win.some(w => w.F.some((f, m) => m !== k && Math.abs(f - r.F[k]) <= SPREAD_MAX))) continue;
          entscheidend++;
          if (r.valid[k]) { gueltig++; if (bsp.length < 3) bsp.push(x + '→' + y + ' ' + f0 + ' Hz, t ' + (0.44 + 0.005 * j).toFixed(3) + ' s: F' + (k + 1) + ' = ' + r0(r.F[k]) + ' (F' + (k + 1) + ' der Vokale ' + VOW[x][0][k] + ' / ' + VOW[y][0][k] + ')'); }
        }
      }
    }
    check('I1a', 'Vokalwechsel (4 Paare, 98–220 Hz, alle 5 ms): kein Slot gültig, dessen Wert ein Fenster des Sweeps unter anderer Nummer führt (mind. 50 entscheidende Slots)',
      entscheidend >= 50 && gueltig === 0, rahmen + ' Rahmen, entscheidend ' + entscheidend + ', trotzdem gültig ' + gueltig + (bsp.length ? ': ' + bsp.join('; ') : ''));
  }
};

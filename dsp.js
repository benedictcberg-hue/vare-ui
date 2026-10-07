/* VARE — Rechenkern v3
   Reines JavaScript, keine Abhängigkeiten. Läuft im Browser (window.VAREDSP) und unter Node (module.exports).
   Alle Frequenzen in Hz, alle Pegel in dB. Jede Zahl, die hier herauskommt, ist ein Messwert oder NaN —
   nie ein geglätteter Ersatz. Die Darstellung entscheidet, wie sie NaN zeigt (Sentinel −99,00 = „Pause“).

   Verbindliche Entscheidungen (siehe docs/spec_v16.md und docs/physik.md):
   - Formanten als Gipfel auf der LPC-Hüllkurve, keine Wurzelsuche.
   - Analysefrequenz 12000 Hz, Preemphase 0,97, Hann, Burg-LPC, Ordnungssweep 12/14/16.
   - Fensterlängensweep 0,06/0,08/0,10/0,14 s; gültig nur, wenn beide Sweeps unter 130 Hz streuen.
   - F0 über YIN (Schwelle 0,15, 60–500 Hz), Oktavkontrolle über das Spektrum.
   - SFR = 2400–3200 Hz minus 0–2000 Hz. SHR halbzahlige gegen ganzzahlige Teiltöne, k = 1..8,
     auf dem Raster F0 oder 2·F0; ist das Raster zweifelhaft, stehen beide Werte da (shrUnsure). */
(function (root) {
  'use strict';

  var VERSION = '3.0.0';
  var TARGET_SR = 12000;          // Nyquist 6000 Hz, F5 bleibt im Durchlassband
  var ORDERS = [12, 14, 16];      // Ordnungssweep
  var WINDOWS = [0.06, 0.08, 0.10, 0.14]; // Fensterlängensweep in s
  var MAIN_WINDOW = 0.10;         // Fenster für F0, Pegel, Bandbreiten und Ordnungsstreuung
  var SPREAD_MAX_HZ = 130;        // Gültigkeitsgrenze beider Sweeps
  var SLOT_TOL_HZ = 400;          // Zuordnung Gipfel → Slot über Ordnungen hinweg
  var MERGED_BW_HZ = 250;
  /* Obergrenze für Formantgipfel. Der Wandlungs-Tiefpass (Grenze 0,46·12000 Hz) lässt bis 4,6 kHz alles
     durch (−0,07 dB) und dämpft ab 4,8 kHz merklich (−0,4 dB; 5 kHz −1 dB; 5,5 kHz −5,7 dB). Darüber
     formt der Filter die Hüllkurve, nicht das Ansatzrohr: die Preemphase hebt Rauschen an, der Filter
     senkt es wieder, dazwischen entsteht bei 4,9–5,2 kHz ein Scheingipfel. F5 liegt beim Bariton bei
     3,9–4,3 kHz (spec_v16). Gemessen auf dem Prüfsatz K2 (Vokale a/e/i/o/u, 98–247 Hz, mit F6, mit
     Rauschen, mit Rosenberg-Quelle), falsch-gültige Slots im Rauschteil (Rahmen alle 20 ms):
     - nur diese Grenze, sonst alter Kern: ohne Grenze 1206, mit 5000 Hz 764, mit 4800 Hz 780;
     - mit allen Regeln dieses Kerns: ohne Grenze 19 (dazu tiefe enge Cluster mit Rauschen 115),
       mit 5000 Hz 0, mit 4800 Hz 0. 4800 und 5000 Hz sind gleichwertig; 4800 Hz hält Abstand zur
       Filterflanke. 4600 Hz kostet gültige F5, wenn F6 im Band liegt (710 statt 728 von 780). */
  var F_PEAK_MAX_HZ = 4800;
  /* Grenzen je Slot F1…F6 für die Nummerierungsprüfung (deutungen). Bewusst weit: sie schließen nur
     Lesarten aus, die es bei einer Männerstimme nicht gibt, sie unterscheiden keine Vokale.
     - F1 bis 1100 Hz: offenes /a/ liegt auch in hoher Lage unter 900 Hz.
     - F2 ab 550 Hz: das tiefste F2 des Vokalmodells (vowel.js) hat /u/ mit 700 Hz, gemessen 690–735 Hz;
       F1 der geschlossenen Vokale liegt mit 270–380 Hz darunter. Das ist die Grenze für „der unterste
       Gipfel kann nicht F1 sein“: unter 550 Hz ist er F1. Darüber ist er nur dann sicher F1, wenn die
       Gipfel darüber nicht als F3, F4 … gelesen werden können (bei /a/ steht F2 um 1250 Hz, und das
       kann kein F3 sein).
     - F3 1600–3500 Hz, F4 1900–4500 Hz: enge Cluster unterhalb des Sängerformantbands kommen beim
       Bariton vor (physik.md §4, „Falle“: F3 bis hinab um 1700 Hz, ΔF3–4 um 500 Hz; Abnahmetabelle:
       enger Fall 350 Hz). Die Grenzen liegen um die Messunsicherheit (~100 Hz) darunter. Mit F3 ab
       1700 und F4 ab 2600 Hz galt ein solches Cluster als unmöglich: ohne zulässige Lesart waren alle
       fünf Slots ungültig, auch F1 und F2 (sauber, F3 1700–2200, ΔF3–4 300–450 Hz: 663 von 1404
       Rahmen mit gültigem ΔF3–4, jetzt 1235). Mit Rauschen war die richtige Lesart „F1 fehlt“
       ausgeschlossen, F3 stand gültig im F2-Slot. Preis: Ist F5 nicht zu sehen, kann der dritte
       Gipfel auch F4 sein; F3 gilt dann als unsicher, bei /e/ (F2 2000, F3 2550 Hz) auch F2
       (Rauschteil des Prüfsatzes, Impulsquelle: gültige F3 1036 → 72, F2 1114 → 820).
     - F5 ab 3000 Hz: der engste Fall der Abnahmetabelle (Cluster eng, F5 3150 Hz) bleibt zulässig.
     - F6 ab 4450 Hz: 11·c/(4·L) für ein Rohr bis 21,6 cm. F5 bei 4300 Hz (Abnahmetabelle /i/ und
       Cluster weit) darf nicht als F6 gelesen werden. */
  var SLOT_LO = [0, 550, 1600, 1900, 3000, 4450];
  var SLOT_HI = [1100, 2800, 3500, 4500, F_PEAK_MAX_HZ, Infinity];
  /* Ein Formant ist nur gemessen, wenn die Hüllkurve oberhalb seines Gipfels bis zur Obergrenze um
     mindestens DROP_MIN_DB unter seinen Pegel fällt. Ohne Rauschen fällt sie hinter dem obersten
     Formanten steil ab. Mit Mikrofonrauschen läuft sie in einen flachen Boden (nach der Preemphase
     steigt weißes Rauschen sogar an); liegt ein Gipfel kaum darüber, bestimmt das Rauschen seine Lage,
     und alle Fenster und Ordnungen wiederholen denselben Fehler, weil sie dieselben Abtastwerte sehen.
     Gemessen (Median über Fenster und Ordnungen): saubere Vokale mindestens 21 dB, mit Vibrato 30 dB;
     die Slots, die bei SNR 30–50 dB falsch und trotzdem gültig waren, höchstens 5,3 dB. */
  var DROP_MIN_DB = 10;
  var BW_ARTIFACT_HZ = 40;        // physik.md 2.4: LPC-Bandbreiten darunter sind Artefakt, keine Messung         // ab hier gilt ein Gipfel als verschmolzen (zwei Formanten in einem)
  var SENTINEL = -99;             // Darstellung für „keine Messung“
  var SPEED_OF_SOUND_CM_S = 35000;
  var NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function hzToMidi(f) { return 69 + 12 * Math.log2(f / 440); }
  function hzToNote(f) {
    if (!isFinite(f) || f <= 0) return '--';
    var m = Math.round(hzToMidi(f));
    return NOTES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }
  function cents(f, fref) { return 1200 * Math.log2(f / fref); }

  /* ---------- Statistik ---------- */

  function finite(v) {
    var out = [];
    for (var i = 0; i < v.length; i++) if (isFinite(v[i])) out.push(v[i]);
    return out;
  }
  function median(v) {
    var s = finite(v);
    if (!s.length) return NaN;
    s.sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
  }
  function spread(v) {                       // Standardabweichung (Population), NaN unter 2 Werten
    var s = finite(v);
    if (s.length < 2) return NaN;
    var m = 0, i;
    for (i = 0; i < s.length; i++) m += s[i];
    m /= s.length;
    var q = 0;
    for (i = 0; i < s.length; i++) q += (s[i] - m) * (s[i] - m);
    return Math.sqrt(q / s.length);
  }
  function quantile(v, p) {                  // Typ 7 (linear), wie pandas.Series.quantile
    var s = finite(v);
    if (!s.length) return NaN;
    s.sort(function (a, b) { return a - b; });
    var h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
    return s[lo] + (s[hi] - s[lo]) * (h - lo);
  }
  function mad(v) {                          // robuste Streuung: 1,4826 · Median der Absolutabweichungen
    var s = finite(v);
    if (s.length < 2) return NaN;
    var m = median(s), a = new Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = Math.abs(s[i] - m);
    return 1.4826 * median(a);
  }
  function sentinel(v) { return isFinite(v) ? v : SENTINEL; }

  /* ---------- FFT (Radix 2, in place) ---------- */

  var twCache = {};
  function twiddles(n) {
    var t = twCache[n];
    if (t) return t;
    var c = new Float64Array(n >> 1), s = new Float64Array(n >> 1);
    for (var k = 0; k < (n >> 1); k++) { var a = -2 * Math.PI * k / n; c[k] = Math.cos(a); s[k] = Math.sin(a); }
    return (twCache[n] = { c: c, s: s });
  }
  function isPow2(n) { return n > 0 && (n & (n - 1)) === 0; }
  function nextPow2(n) { var p = 1; while (p < n) p <<= 1; return p; }

  function fft(re, im) {
    var n = re.length;
    if (n < 2) return;
    if (!isPow2(n)) throw new Error('fft: Länge muss Zweierpotenz sein, ist ' + n);
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    var tw = twiddles(n);
    for (var len = 2; len <= n; len <<= 1) {
      var half = len >> 1, step = n / len;
      for (var i0 = 0; i0 < n; i0 += len) {
        for (var k = 0; k < half; k++) {
          var wr = tw.c[k * step], wi = tw.s[k * step];
          var a = i0 + k, b = a + half;
          var xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  /* ---------- Vorverarbeitung ---------- */

  var hannCache = {};
  function hannWindow(n) {
    var w = hannCache[n];
    if (w) return w;
    w = new Float64Array(n);
    for (var i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    return (hannCache[n] = w);
  }
  function hann(x) {
    var n = x.length, w = hannWindow(n), y = new Float64Array(n);
    for (var i = 0; i < n; i++) y[i] = x[i] * w[i];
    return y;
  }
  function preemph(x, a) {
    var y = new Float64Array(x.length);
    y[0] = x[0];
    for (var i = 1; i < x.length; i++) y[i] = x[i] - a * x[i - 1];
    return y;
  }
  function rmsDb(x) {
    var s = 0;
    for (var i = 0; i < x.length; i++) s += x[i] * x[i];
    return 20 * Math.log10(Math.sqrt(s / Math.max(1, x.length)) + 1e-12);
  }

  // Linearphasiger FIR-Tiefpass (Fenstermethode, Hamming), gebaut je Eingangsrate.
  function makeLowpass(cutoffNorm, taps) {
    var h = new Float64Array(taps), mid = (taps - 1) / 2, sum = 0;
    for (var i = 0; i < taps; i++) {
      var n = i - mid;
      var s = (n === 0) ? 2 * cutoffNorm : Math.sin(2 * Math.PI * cutoffNorm * n) / (Math.PI * n);
      var w = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (taps - 1));
      h[i] = s * w; sum += h[i];
    }
    for (var j = 0; j < taps; j++) h[j] /= sum;
    return h;
  }
  function tapsFor(srIn) { var taps = Math.round(81 * srIn / 48000); if (taps % 2 === 0) taps++; return Math.max(21, taps); }
  var lpCache = {};
  function lowpassFor(srIn, srOut) {
    var key = srIn + '>' + srOut;
    if (lpCache[key]) return lpCache[key];
    return (lpCache[key] = makeLowpass(0.46 * srOut / srIn, tapsFor(srIn)));
  }

  /* Polyphasenbank für Bruchverhältnisse: dieselbe gefensterte Sinc-Funktion, um fr = ph/PHASES
     Abtastwerte verschoben ausgewertet. Phase 0 ist bitidentisch mit lowpassFor(). Ohne diese Bank
     erzeugt lineare Interpolation bei 44,1 kHz → 12 kHz einen Fehler nur ~24 dB unter dem Signal
     bei 5 kHz, der die Täler zwischen F4 und F5 zuschüttet und F5 unter die Prominenzschwelle drückt. */
  var PHASES = 64, bankCache = {};
  function lowpassBank(srIn, srOut) {
    var key = srIn + '>' + srOut;
    if (bankCache[key]) return bankCache[key];
    var taps = tapsFor(srIn), fc = 0.46 * srOut / srIn, mid = (taps - 1) / 2, bank = new Float64Array((PHASES + 1) * taps);
    for (var ph = 0; ph <= PHASES; ph++) {
      var fr = ph / PHASES, sum = 0, base = ph * taps, i;
      for (i = 0; i < taps; i++) {
        var n = i - mid - fr;
        var s = (Math.abs(n) < 1e-12) ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n);
        var w = Math.max(0, 0.54 + 0.46 * Math.cos(2 * Math.PI * n / (taps - 1)));
        bank[base + i] = s * w; sum += s * w;
      }
      for (i = 0; i < taps; i++) bank[base + i] /= sum;
    }
    return (bankCache[key] = { taps: taps, mid: (taps - 1) >> 1, bank: bank });
  }

  /* Abtastratenwandlung: gefensterte Sinc-Interpolation (Grenze 0,46·srOut) an genau den Stellen,
     die die Ausgabe braucht. Ganzzahlige Verhältnisse (48 k → 12 k) nutzen nur Phase 0 und liefern
     exakt das Ergebnis des FIR-Tiefpasses. */
  function resample(x, srIn, srOut) {
    if (srIn === srOut) return Float64Array.from(x);
    var ratio = srIn / srOut, n = Math.floor(x.length / ratio), out = new Float64Array(n), N = x.length;
    if (srIn < srOut) {                       // Hochtasten: kein Tiefpass nötig, lineare Interpolation
      for (var u = 0; u < n; u++) {
        var pu = u * ratio, iu = Math.floor(pu), fu = pu - iu;
        out[u] = (iu + 1 < N) ? x[iu] * (1 - fu) + x[iu + 1] * fu : x[iu];
      }
      return out;
    }
    var B = lowpassBank(srIn, srOut), taps = B.taps, mid = B.mid, bank = B.bank;
    for (var j = 0; j < n; j++) {
      var p = j * ratio, i0 = Math.floor(p), fr = p - i0, phf = fr * PHASES, ph0 = Math.floor(phf), a = phf - ph0;
      if (ph0 >= PHASES) { ph0 = PHASES - 1; a = 1; }
      var b0 = ph0 * taps, b1 = b0 + taps, k0 = Math.max(0, mid - i0), k1 = Math.min(taps, N + mid - i0), acc = 0;
      if (a < 1e-12) { for (var k = k0; k < k1; k++) acc += x[i0 + k - mid] * bank[b0 + k]; }
      else { for (var q = k0; q < k1; q++) acc += x[i0 + q - mid] * ((1 - a) * bank[b0 + q] + a * bank[b1 + q]); }
      out[j] = acc;
    }
    return out;
  }

  /* ---------- Burg-LPC ---------- */

  function burg(x, order) {
    var N = x.length, a = new Float64Array(order + 1);
    a[0] = 1;
    var f = Float64Array.from(x), b = Float64Array.from(x);
    for (var m = 1; m <= order; m++) {
      var num = 0, den = 0;
      for (var i = m; i < N; i++) {
        num += b[i - 1] * f[i];
        den += f[i] * f[i] + b[i - 1] * b[i - 1];
      }
      var k = (den > 1e-20) ? (-2 * num / den) : 0;
      var an = Float64Array.from(a);
      for (var j = 1; j <= m; j++) an[j] = a[j] + k * a[m - j];
      a = an;
      for (var t = N - 1; t >= m; t--) {
        var fv = f[t] + k * b[t - 1];
        b[t] = b[t - 1] + k * f[t];
        f[t] = fv;
      }
    }
    return a;
  }

  /* ---------- LPC-Hüllkurve und Gipfel ---------- */

  /* |1/A(e^{jw})| in dB auf dem Raster w_i = pi·i/(nBins−1). Ist 2·(nBins−1) eine Zweierpotenz,
     liefert die FFT exakt dieselben Werte wie die direkte Summe — nur ~20× schneller. */
  function lpcEnvelope(a, sr, nBins) {
    var env = new Float64Array(nBins), M = 2 * (nBins - 1), i;
    if (isPow2(M) && M >= a.length) {
      var re = new Float64Array(M), im = new Float64Array(M);
      for (i = 0; i < a.length; i++) re[i] = a[i];
      fft(re, im);
      for (i = 0; i < nBins; i++) env[i] = -20 * Math.log10(Math.hypot(re[i], im[i]) + 1e-15);
      return env;
    }
    var df = (sr / 2) / (nBins - 1);
    for (i = 0; i < nBins; i++) {
      var w = 2 * Math.PI * (i * df) / sr, r = 0, q = 0;
      for (var k = 0; k < a.length; k++) { r += a[k] * Math.cos(-w * k); q += a[k] * Math.sin(-w * k); }
      env[i] = -20 * Math.log10(Math.hypot(r, q) + 1e-15);
    }
    return env;
  }

  /* Gipfel mit Prominenz, parabolisch verfeinert. Bandbreite aus der −3-dB-Breite. */
  function peaksFromEnvelope(env, sr, nMax, minProm) {
    var nBins = env.length, df = (sr / 2) / (nBins - 1), cand = [];
    var fTop = Math.min(sr / 2 - 250, F_PEAK_MAX_HZ), iTop = Math.min(nBins - 1, Math.round(fTop / df));
    for (var i = 2; i < nBins - 2; i++) {
      if (env[i] <= env[i - 1] || env[i] < env[i + 1]) continue;
      var l = i, r = i;
      while (l > 0 && env[l - 1] < env[l]) l--;
      while (r < nBins - 1 && env[r + 1] < env[r]) r++;
      var prom = env[i] - Math.max(env[l], env[r]);
      if (prom < minProm) continue;
      var A = env[i - 1], B = env[i], C = env[i + 1], den = A - 2 * B + C;
      var sh = (Math.abs(den) > 1e-12) ? Math.max(-1, Math.min(1, 0.5 * (A - C) / den)) : 0;
      var f = (i + sh) * df;
      /* −3-dB-Breite mit interpolierten Kreuzungen. Ohne Interpolation ist die Breite immer um
         0 bis 2 Bins (bis 11,7 Hz) zu groß — bei einer F1-Bandbreite von 30 Hz sind das +37 %,
         und die Zahl geht in die Bandbreitenkorrektur von H1*−H2* ein. */
      var half = B - 3, lo = i, hi = i;
      while (lo > 0 && env[lo] > half) lo--;
      while (hi < nBins - 1 && env[hi] > half) hi++;
      var loX = lo, hiX = hi;
      if (lo < i && env[lo + 1] !== env[lo]) loX = lo + (half - env[lo]) / (env[lo + 1] - env[lo]);
      if (hi > i && env[hi - 1] !== env[hi]) hiX = hi - (half - env[hi]) / (env[hi - 1] - env[hi]);
      var bw = (hiX - loX) * df;
      if (!(f > 120 && f < fTop)) continue;
      // Abfall der Hüllkurve vom Gipfel bis zu ihrem tiefsten Punkt darüber (bis zur Obergrenze)
      var tief = env[i];
      for (var b = i + 1; b <= iTop; b++) if (env[b] < tief) tief = env[b];
      cand.push({ f: f, bw: bw, amp: env[i], prom: prom, bwArtifact: bw < BW_ARTIFACT_HZ, drop: env[i] - tief });
    }
    cand.sort(function (p, q) { return q.prom - p.prom; });
    var keep = cand.slice(0, nMax);
    keep.sort(function (p, q) { return p.f - q.f; });
    return keep;
  }

  function formantsFromLPC(a, sr, nMax) {
    return peaksFromEnvelope(lpcEnvelope(a, sr, 1025), sr, nMax, 1.5);
  }

  /* Ein Fenster (bereits auf TARGET_SR): Ordnungssweep mit Zuordnung nach Nähe.
     Referenz ist die Ordnung mit den meisten Gipfeln (Gleichstand: 14, dann 12, dann 16).
     Gipfel der anderen Ordnungen werden dem nächsten Referenz-Slot zugeordnet (Toleranz 400 Hz),
     jeder Slot je Ordnung höchstens einmal. So kann ein verschmolzener Gipfel bei Ordnung 16
     die Slots nicht mehr verschieben. */
  function analyseWindow(seg, sr, opts) {
    opts = opts || {};
    var orders = opts.orders || ORDERS;
    var win = hann(preemph(seg, 0.97));
    var per = [], o;
    for (o = 0; o < orders.length; o++) per.push(formantsFromLPC(burg(win, orders[o]), sr, 5));
    var prefer = [orders.indexOf(14), orders.indexOf(12), orders.indexOf(16)];
    var refIdx = -1, best = -1;
    for (var pi = 0; pi < prefer.length; pi++) { var c = prefer[pi]; if (c >= 0 && per[c].length > best) { best = per[c].length; refIdx = c; } }
    for (o = 0; o < orders.length; o++) if (per[o].length > best) { best = per[o].length; refIdx = o; }
    var fremd = [], bwMax = [NaN, NaN, NaN, NaN, NaN], slots = [[], [], [], [], []], drops = [[], [], [], [], []], bwSlot = [NaN, NaN, NaN, NaN, NaN], bwArt = [false, false, false, false, false];
    var bwOrder = orders.indexOf(14) >= 0 ? orders.indexOf(14) : refIdx;
    if (refIdx >= 0) {
      var ref = per[refIdx], nSlots = Math.min(5, ref.length);
      for (o = 0; o < orders.length; o++) {
        var assign = new Array(nSlots);
        if (o === refIdx) {
          for (var s0 = 0; s0 < nSlots; s0++) assign[s0] = ref[s0];
        } else {
          var pairs = [];
          for (var s = 0; s < nSlots; s++) for (var p = 0; p < per[o].length; p++) {
            var d = Math.abs(per[o][p].f - ref[s].f);
            if (d <= SLOT_TOL_HZ) pairs.push({ d: d, s: s, p: p });
          }
          pairs.sort(function (u, v) { return u.d - v.d; });
          var usedP = {};
          for (var q = 0; q < pairs.length; q++) {
            var pr = pairs[q];
            if (assign[pr.s] || usedP[pr.p]) continue;
            assign[pr.s] = per[o][pr.p]; usedP[pr.p] = true;
          }
          for (var pu = 0; pu < per[o].length; pu++) if (!usedP[pu]) fremd.push(per[o][pu].f);
        }
        for (var s1 = 0; s1 < nSlots; s1++) {
          if (!assign[s1]) continue;
          slots[s1].push(assign[s1].f); drops[s1].push(assign[s1].drop);
          if (!(assign[s1].bw <= bwMax[s1])) bwMax[s1] = assign[s1].bw;
          if (o === bwOrder) { bwSlot[s1] = assign[s1].bw; bwArt[s1] = !!assign[s1].bwArtifact; }
        }
      }
    }
    var F = [], sdOrder = [], nOrders = [], merged = [], refF = [];
    for (var k = 0; k < 5; k++) {
      F.push(median(slots[k])); sdOrder.push(spread(slots[k])); nOrders.push(slots[k].length);
      merged.push(isFinite(bwSlot[k]) && bwSlot[k] > MERGED_BW_HZ);
    }
    if (refIdx >= 0) for (var r = 0; r < per[refIdx].length; r++) refF.push(per[refIdx][r].f);
    return { F: F, sdOrder: sdOrder, nOrders: nOrders, BW: bwSlot, bwArtifact: bwArt, merged: merged,
      nPeaksRef: refIdx >= 0 ? per[refIdx].length : 0, refOrder: refIdx >= 0 ? orders[refIdx] : NaN,
      slotUnsure: slotNumberUnsure(refF, nOrders), slotMerged: slotMergeUnsure(refF, nOrders, bwMax, fremd), drops: drops };
  }

  /* Zuordnung Gipfel → Slot ist eine Annahme, keine Messung: der k-te gefundene Gipfel gilt als Fk.
     Findet die Referenzordnung weniger als fünf Resonanzen, fehlt eine — dann stimmt die Nummerierung
     oberhalb der Lücke nicht mehr, und ΔF3–4 wäre der Abstand zwischen zwei falsch benannten Formanten.
     Die Lücke liegt beim größten Abstand zwischen benachbarten gefundenen Gipfeln; alles darüber gilt
     als unsicher. Ohne diese Prüfung meldet der Kern einen verschmolzenen F3/F4-Buckel als ΔF3–4 von
     1614 Hz statt 150 Hz — und zwar „gültig“, weil alle Sweeps denselben Fehler wiederholen.
     Wiederholbarkeit ist nicht Richtigkeit.
     Nur noch im Einzelrahmen-Aufruf analyse(); der Fenstersweep prüft mit slotNumberUnsure. */
  function slotGapUnsure(F, nPeaksRef) {
    var unsure = [false, false, false, false, false];
    if (nPeaksRef >= 5) return unsure;
    var idx = [];
    for (var k = 0; k < 5; k++) if (isFinite(F[k])) idx.push(k);
    if (idx.length < 2) {
      for (var j = 0; j < 5; j++) unsure[j] = !isFinite(F[j]) ? false : (j > (idx.length ? idx[0] : -1));
      return unsure;
    }
    var worst = 0, worstAt = idx[0];
    for (var i = 0; i + 1 < idx.length; i++) {
      var gap = F[idx[i + 1]] - F[idx[i]];
      if (gap > worst) { worst = gap; worstAt = idx[i]; }
    }
    for (var s = worstAt + 1; s < 5; s++) unsure[s] = true;
    return unsure;
  }

  /* Nummerierungsprüfung im Fenstersweep. Die Regel „größte Lücke“ (slotGapUnsure) greift nur bei
     weniger als fünf Gipfeln und rät, wo die fehlende Resonanz liegt. Zwei Fälle gehen damit durch:
     - Ein zusätzlicher Gipfel (F6 eines langen Rohres oder Rauschen an der Filterkante) macht die Zahl
       wieder fünf: F3/F4 verschmolzen + F6 ergibt ΔF3–4 1380 statt 150 Hz, gültig.
     - Fehlt die tiefste Resonanz, gibt es keine Lücke darunter: F2 steht im F1-Slot, gültig.
     Stattdessen werden alle Lesarten der Gipfel einer Referenzordnung durchgespielt:
     - jeder Gipfel ist ein Formant F1…F6, aufsteigend, innerhalb der Slotgrenzen SLOT_LO/SLOT_HI;
     - höchstens eine Resonanz fehlt, an beliebiger Stelle, auch unter dem untersten Gipfel; bei fünf
       Gipfeln ist der oberste dann F6;
     - ein Gipfel, den nur eine Ordnung findet, kann auch ein Scheingipfel sein (Lesart ohne ihn).
     P: Gipfelfrequenzen der Referenzordnung (aufsteigend), nOrd: Zahl der Ordnungen je Slot.
     Jede Lesart: slot[k] = Index des Gipfels, der als F(k+1) gelesen wird (−1: keiner); use = die
     Gipfel, die als Resonanz zählen; fehlt = Stelle in use, vor der eine Resonanz fehlt (use.length:
     über dem obersten; −1: keine fehlt). */
  function deutungen(P, nOrd) {
    var n = Math.min(5, P.length), frei = [], deut = [], i;
    for (i = 0; i < n; i++) if (!(nOrd[i] >= 2)) frei.push(i);
    for (var mask = 0; mask < (1 << frei.length); mask++) {
      var use = [];
      for (i = 0; i < n; i++) { var u = frei.indexOf(i); if (u < 0 || !(mask & (1 << u))) use.push(i); }
      var m = use.length;
      for (var j = 0; j <= m; j++) {                     // j < m: eine Resonanz fehlt vor use[j]
        var slot = [-1, -1, -1, -1, -1, -1], ok = true;
        for (var q = 0; q < m && ok; q++) {
          var s = q + (j < m && q >= j ? 1 : 0), f = P[use[q]];
          if (s > 5 || (j === m && s > 4) || f < SLOT_LO[s] || f > SLOT_HI[s]) ok = false;
          else slot[s] = use[q];
        }
        if (ok) deut.push({ slot: slot, use: use, fehlt: j < m ? j : (m < 5 ? m : -1) });
      }
    }
    return deut;
  }
  /* Verschmolzen oder umstritten: der k-te Gipfel ist richtig nummeriert, kann aber zwei Resonanzen in
     einem sein. Gemessen bei /u/ 196 Hz mit Rauschen: F1 300 und F2 700 Hz verschmelzen zu einem Gipfel
     bei 440–460 Hz, F1 gilt als gültig und liegt 150 Hz daneben. Bei F5 4100 / F6 4400 Hz (Rosenberg-
     Quelle, 247 Hz) steht der gemeinsame Gipfel 140 Hz über F5. Drei Anzeichen, je Fenster:
     - Eine zulässige Lesart lässt neben dem Gipfel eine Resonanz fehlen (auch über dem obersten), die
       fehlende Resonanz kann nach den Slotgrenzen höchstens SLOT_TOL_HZ von ihm entfernt liegen, und
       der Gipfel ist in irgendeiner Ordnung breiter als MERGED_BW_HZ. Gesungene Bandbreiten liegen bei
       F1 40–80, F2 60–120, F3 100–200 Hz (physik.md 2.4). Ohne die Entfernungsbedingung galt F2 eines
       /o/ (770 Hz) als verschmolzen, sobald die Lesart „F3 fehlt“ zulässig war, obwohl F3 nicht unter
       SLOT_LO[2] liegen kann; die Breite kam von Ordnung 12 (Live-Pfad, /o/ 110 Hz, Rauschen 60 dB).
     - Eine andere Ordnung findet einen zusätzlichen Gipfel innerhalb SLOT_TOL_HZ: sie trennt, was die
       Referenz zusammenfasst. Dann stehen auch alle Gipfel darüber eine Stufe zu tief, sie sind
       ebenso unsicher (gemessen: /o/-artiges F1 380 / F2 750 mit tiefem engem Cluster und Rauschen
       40 dB, F1 fehlt der Referenz, eine andere Ordnung sieht ihn bei 450 Hz; F3 stand gültig im
       F2-Slot). Liegt er weiter weg, fehlt der Referenz eine Resonanz: alles darüber ist unsicher.
     - Ein Nachbargipfel innerhalb SLOT_TOL_HZ wird nur von einer Ordnung gesehen: die anderen Ordnungen
       haben ihn in diesen Gipfel gezogen.
     bwMax: größte Bandbreite je Slot über alle Ordnungen; fremd: Frequenzen der Gipfel anderer
     Ordnungen, die keinem Slot zugeordnet wurden. */
  function slotMergeUnsure(P, nOrd, bwMax, fremd) {
    var n = Math.min(5, P.length), uns = [false, false, false, false, false], deut = deutungen(P, nOrd), i, k;
    for (i = 0; i < deut.length; i++) {
      var d = deut[i], nb = [];
      if (d.fehlt < 0) continue;
      if (d.fehlt > 0) nb.push(d.use[d.fehlt - 1]);
      if (d.fehlt < d.use.length) nb.push(d.use[d.fehlt]);
      for (k = 0; k < nb.length; k++) {
        var X = P[nb[k]], nah2 = X + SLOT_TOL_HZ >= SLOT_LO[d.fehlt] && X - SLOT_TOL_HZ <= SLOT_HI[d.fehlt];
        if (nah2 && bwMax[nb[k]] > MERGED_BW_HZ) uns[nb[k]] = true;
      }
    }
    for (i = 0; i < (fremd || []).length; i++) {
      var g = fremd[i], nah = -1, dmin = Infinity;
      for (k = 0; k < n; k++) if (Math.abs(P[k] - g) < dmin) { dmin = Math.abs(P[k] - g); nah = k; }
      if (nah >= 0 && dmin <= SLOT_TOL_HZ) { for (k = nah; k < n; k++) uns[k] = true; }
      else for (k = 0; k < n; k++) if (P[k] > g) uns[k] = true;
    }
    for (i = 0; i < n; i++) if (!(nOrd[i] >= 2)) {
      for (k = i - 1; k <= i + 1; k += 2) if (k >= 0 && k < n && Math.abs(P[k] - P[i]) <= SLOT_TOL_HZ) uns[k] = true;
    }
    return uns;
  }

  // Slot k ist sicher, wenn jede zulässige Lesart den k-ten Gipfel als F(k+1) liest. Ist keine Lesart
  // zulässig, ist alles unsicher.
  function slotNumberUnsure(P, nOrd) {
    var n = Math.min(5, P.length), uns = [false, false, false, false, false], deut = deutungen(P, nOrd), i, k;
    if (!deut.length) return [true, true, true, true, true];
    for (k = 0; k < n; k++) for (i = 0; i < deut.length; i++) if (deut[i].slot[k] !== k) uns[k] = true;
    return uns;
  }

  /* ---------- F0: YIN mit kumulativer mittlerer Normierung ---------- */

  /* dn(τ) = d(τ)·τ / Σ_{1..τ} d — die Normierung beginnt bei τ = 1, nicht bei tauMin.
     Danach das reine YIN-Kriterium: der erste Dip unter der Schwelle, parabolisch verfeinert.
     Eine frühere Zusatzregel („liegt ein späterer Dip tiefer, gilt der spätere“) ist entfernt:
     sie sollte den Fall „enger F1 auf dem 5. Teilton“ retten, halbierte aber bei 11 % sauberer
     synthetischer Vokale den Grundton — ein echter Ton ist auch bei der doppelten Periode
     periodisch, und die Differenzfunktion kann beides nicht trennen. Ob der gefundene Wert ein
     Vielfaches des echten Grundtons ist, entscheidet die Teiltonreihe im Spektrum
     (subMultipleInfo), wie es die Spezifikation für die Oktavkontrolle vorschreibt. */
  function detectF0(x, sr, fmin, fmax, thresh) {
    fmin = fmin || 60; fmax = fmax || 500; thresh = (thresh == null) ? 0.15 : thresh;
    var N = x.length, tauMax = Math.min(Math.floor(sr / fmin), N >> 1), tauMin = Math.max(2, Math.floor(sr / fmax));
    if (tauMax <= tauMin + 2) return { f0: NaN, ap: 1, tau: NaN, dips: [], fminEff: NaN };
    var W = N - tauMax, d = new Float64Array(tauMax + 1), dn = new Float64Array(tauMax + 1);
    for (var tau = 1; tau <= tauMax; tau++) {
      var s = 0;
      for (var i = 0; i < W; i++) { var dd = x[i] - x[i + tau]; s += dd * dd; }
      d[tau] = s;
    }
    dn[0] = 1;
    var run = 0;
    for (var t = 1; t <= tauMax; t++) { run += d[t]; dn[t] = (run > 1e-20) ? d[t] * t / run : 1; }
    var dips = [];
    for (var u = tauMin; u < tauMax; u++) if (dn[u] < dn[u - 1] && dn[u] <= dn[u + 1]) dips.push({ tau: u, dn: dn[u] });
    var best = -1, first = -1;
    for (var q = 0; q < dips.length; q++) if (dips[q].dn < thresh) { first = q; break; }
    if (first >= 0) {
      best = dips[first].tau;
    } else {
      var mn = Infinity;
      for (var v2 = tauMin; v2 < tauMax; v2++) if (dn[v2] < mn) { mn = dn[v2]; best = v2; }
    }
    var ti = best;
    if (best > 1 && best < tauMax) {
      var A = dn[best - 1], B = dn[best], C = dn[best + 1], den = A - 2 * B + C;
      if (Math.abs(den) > 1e-12) ti = best + Math.max(-1, Math.min(1, 0.5 * (A - C) / den));
    }
    /* detectF0 sagt nicht, ob die gefundene Periode zwei Anregungen enthält: bei starker
       Periodenverdopplung liegt dn(T) über der Schwelle, und YIN nimmt direkt 2T. Das SHR-Raster
       entscheidet deshalb shr() aus eigenen Belegen, nicht aus der Periodenwahl. */
    return { f0: sr / ti, ap: dn[best], tau: ti, dips: dips, fminEff: sr / tauMax, dn: dn };
  }

  /* ---------- Spektrum und Spektralmaße ---------- */

  /* Hann-gefenstertes Spektrum, Nullauffüllung auf N (Zweierpotenz). db[k] ist der Pegel einer
     Sinuskomponente in dBFS (Vollaussteuerung = 0 dB), pow[k] die zugehörige Amplitude². */
  function spectrum(x, sr, N) {
    N = N || nextPow2(Math.max(x.length, 2048));
    var re = new Float64Array(N), im = new Float64Array(N), w = hannWindow(x.length), wsum = 0, i;
    for (i = 0; i < x.length; i++) { re[i] = x[i] * w[i]; wsum += w[i]; }
    fft(re, im);
    var nb = (N >> 1) + 1, pow = new Float64Array(nb), db = new Float64Array(nb), g = 2 / wsum;
    for (i = 0; i < nb; i++) {
      var a = Math.hypot(re[i], im[i]) * g;
      pow[i] = a * a;
      db[i] = 10 * Math.log10(pow[i] + 1e-20);
    }
    return { db: db, pow: pow, df: sr / N, N: N, sr: sr, len: x.length };
  }

  // Pegel einer Linie bei f: Maximum in ±max(1 Bin, 1 % f), parabolisch über die Nachbarbins
  // verfeinert (sonst bis 0,5 dB Scalloping-Verlust, wenn die Linie zwischen zwei Bins liegt).
  function lineLevelDb(spec, f) {
    if (!(f > 0) || f >= spec.sr / 2) return NaN;
    var tol = Math.max(spec.df, 0.01 * f);
    var lo = Math.max(1, Math.round((f - tol) / spec.df)), hi = Math.min(spec.db.length - 1, Math.round((f + tol) / spec.df));
    var m = -Infinity, mi = -1;
    for (var k = lo; k <= hi; k++) if (spec.db[k] > m) { m = spec.db[k]; mi = k; }
    if (mi > 0 && mi < spec.db.length - 1) {
      var A = spec.db[mi - 1], B = spec.db[mi], C = spec.db[mi + 1], den = A - 2 * B + C;
      if (den < -1e-9 && A < B && C <= B) m = B - 0.125 * (A - C) * (A - C) / den;
    }
    return m;
  }
  function linePow(spec, f) { var L = lineLevelDb(spec, f); return isFinite(L) ? Math.pow(10, L / 10) : 0; }

  // Rauschreferenz zwischen den Linien des Rasters g: Median aller Bins in [(m+0,3)g, (m+0,7)g], m = 1..8.
  function noiseRefDb(spec, g) {
    var vals = [];
    for (var m = 1; m <= 8; m++) {
      var lo = Math.round((m + 0.3) * g / spec.df), hi = Math.round((m + 0.7) * g / spec.df);
      if (hi >= spec.db.length) break;
      for (var k = lo; k <= hi; k++) vals.push(spec.db[k]);
    }
    return median(vals);
  }

  /* Teilerkontrolle (verallgemeinerte Oktavkontrolle). Die Spezifikation verlangt für den Faktor 2:
     existiert bei f/2 eine ungerade Teiltonreihe (1·, 3·, 5·, 7· f/2) mehr als 8 dB über dem
     Zwischenrauschen, ist f/2 der echte Grundton. Dieselbe Frage stellt sich für jeden Teiler m:
     die Periodenmessung liefert ein Vielfaches des Grundtons, wenn bei f/m zusätzliche Linien
     stehen, die keine Vielfachen von f sind. Geprüft werden m = 2..5 — der Fall „enger F1 auf dem
     5. Teilton“ ist ein Teiler 5, kein Oktavfehler.

     Zwei Kriterien, beide nötig:
     (a) Die zusätzlichen Linien müssen über dem Zwischenrauschen liegen (Spezifikation, 8 dB).
     (b) Sie müssen auch gegenüber den schon bekannten Linien bei f und 2f stark sein (Grenze
         −20 dB, zwischen den beiden SHR-Schwellen der Spezifikation). Ohne (b) hängt das Ergebnis
         am Rauschboden: bei sauberem Signal ist die Referenz nur der Leckageboden des Hann-Fensters,
         und schon eine Subharmonische 38 dB unter den Teiltönen (Amplitudenwechsel 0,97, hörbar
         nichts) würde die angezeigte Note halbieren — dasselbe Signal mit Mikrofonrauschen nicht.
     Dazwischen wird nicht stillschweigend geteilt, sondern ambiguous gemeldet.

     Untergrenze: geteilt wird nie unter F0_MIN_HZ (Spezifikation: YIN-Bereich 60–500 Hz). Ohne
     sie wurde ein 151-Hz-Fehlwert (Periode 4/5 T bei 121 Hz) mit m = 5 auf 30,2 Hz geteilt.
     Erfüllt eine Reihe unter der Grenze die Teilungsbedingungen, ist die Periode wirklich länger,
     aber nicht im Messbereich: dann ambiguous mit unterGrenze, nicht still der höhere Wert.
     Unter 30 Hz Linienabstand trennt das 0,14-s-Hann-Fenster (Hauptkeule ±14 Hz) die Linien nicht. */
  var OCTAVE_ODD_EVEN_DB = -20;
  var SUB_MULTIPLE_MAX = 5;
  var F0_MIN_HZ = 60;

  /* Linien k·g, k = 1..4m: die Vielfachen von m (m·g, 2m·g, 3m·g, 4m·g) sind die bekannten, die übrigen
     die neuen. Für m = 2 sind die neuen genau die 1·, 3·, 5·, 7· g der Spezifikation. Liefert die
     mittlere Höhe der neuen Linien über dem Zwischenrauschen und gegen die bekannten (dB) und wie
     viele neue Linien mehr als marginDb über dem Zwischenrauschen liegen. */
  function teiltonreihe(spec, g, m, marginDb) {
    var out = { newMinusNoise: NaN, newMinusOld: NaN, above: 0, nNew: 0 };
    var ref = noiseRefDb(spec, g);
    if (!isFinite(ref)) return out;
    var sumNew = 0, nNew = 0, above = 0, sumOld = 0, nOld = 0, k, L;
    for (k = 1; k <= 4 * m; k++) {
      L = lineLevelDb(spec, k * g);
      if (!isFinite(L)) continue;
      if (k % m === 0) { sumOld += L; nOld++; }
      else { sumNew += L; nNew++; if (L > ref + marginDb) above++; }
    }
    if (nNew < 3 || nOld < 2) return out;
    out.newMinusNoise = sumNew / nNew - ref;
    out.newMinusOld = sumNew / nNew - sumOld / nOld;
    out.above = above; out.nNew = nNew;
    return out;
  }

  function subMultipleTest(spec, f, m, marginDb, oddEvenDb) {
    var out = { m: m, pass: false, ambiguous: false, unterGrenze: false, newMinusNoise: NaN, newMinusOld: NaN };
    var g = f / m;
    if (!(g >= 30)) return out;
    var t = teiltonreihe(spec, g, m, marginDb);
    if (!isFinite(t.newMinusNoise)) return out;
    out.newMinusNoise = t.newMinusNoise;
    out.newMinusOld = t.newMinusOld;
    if (!(out.newMinusNoise > marginDb && t.above >= Math.max(3, Math.ceil(0.6 * t.nNew)))) return out;
    /* Unsicher ist nur das schmale Band, in dem die Spezifikation die Subharmonische überhaupt für
       nennenswert hält (SHR über −25 dB), sie aber noch nicht zum Teilen reicht. Darunter ist das
       Signal sauber — ein Dauerhinweis „Oktave unsicher“ bei jedem gesunden Ton wäre kein ehrlicher
       Messwert, sondern Lärm. */
    if (out.newMinusOld <= oddEvenDb) { out.ambiguous = out.newMinusOld > oddEvenDb - 5; out.unterGrenze = out.ambiguous && g < F0_MIN_HZ; return out; }
    if (g < F0_MIN_HZ) { out.ambiguous = true; out.unterGrenze = true; return out; }
    out.pass = true;
    return out;
  }

  /* Liefert den größten Teiler m (2..5), für den die Teiltonreihe bei f/m belegt ist. */
  function subMultipleInfo(spec, f, marginDb, oddEvenDb, maxM) {
    marginDb = (marginDb == null) ? 8 : marginDb;
    oddEvenDb = (oddEvenDb == null) ? OCTAVE_ODD_EVEN_DB : oddEvenDb;
    maxM = maxM || SUB_MULTIPLE_MAX;
    var best = { m: 1, halve: false, ambiguous: false, unterGrenze: false, newMinusNoise: NaN, newMinusOld: NaN };
    for (var m = maxM; m >= 2; m--) {
      var t = subMultipleTest(spec, f, m, marginDb, oddEvenDb);
      if (t.pass) return { m: m, halve: true, ambiguous: false, unterGrenze: false, newMinusNoise: t.newMinusNoise, newMinusOld: t.newMinusOld };
      if (t.ambiguous && !best.ambiguous) best = { m: 1, halve: false, ambiguous: true, unterGrenze: t.unterGrenze, newMinusNoise: t.newMinusNoise, newMinusOld: t.newMinusOld };
    }
    return best;
  }
  function octaveInfo(spec, f, marginDb, oddEvenDb) {
    var t = subMultipleTest(spec, f, 2, (marginDb == null) ? 8 : marginDb, (oddEvenDb == null) ? OCTAVE_ODD_EVEN_DB : oddEvenDb);
    return { halve: t.pass, ambiguous: t.ambiguous, oddMinusNoise: t.newMinusNoise, oddMinusEven: t.newMinusOld };
  }
  function octaveCheck(spec, f, marginDb) { return octaveInfo(spec, f, marginDb).halve; }

  // SHR gegen ein Raster g: 10·log10(ΣP((k−½)g) / ΣP(k·g)), k = 1..8.
  function shrAgainst(spec, g) {
    var ps = 0, ph = 0;
    for (var k = 1; k <= 8; k++) { ps += linePow(spec, (k - 0.5) * g); ph += linePow(spec, k * g); }
    return 10 * Math.log10((ps + 1e-20) / (ph + 1e-20));
  }
  /* SHR-Raster: F0 oder 2·F0. Bei Periodenverdopplung ist F0 die halbe Impulsrate (die wahre
     Periode enthält zwei Anregungen); die Subharmonischen sind dann die ungeraden Teiltöne von F0,
     das Raster ist 2·F0. Dasselbe Linienbild entsteht bei einem sauberen Ton, dessen F1 auf H2 liegt
     (physik.md §7.5: spektral allein nicht entscheidbar). Das frühere Raster subFactor·F0 folgte
     der Periodenwahl und war in beide Richtungen falsch: nahm YIN direkt 2T, galt die stärkste
     Verdopplung als unauffällig (150 Hz, jeder zweite Impuls halb so stark: −48,7 statt −10,0 dB);
     korrigierte die Teilerkontrolle einen Oktavfehler bei F1 = 2·F0, warnte ein sauberer Ton
     (175 Hz: −12,4 statt −72,3 dB).
     Deshalb zwei Belege für eine Impulsrate 2·F0, beide unabhängig von der Periodenwahl:
     - Kamm: Bei Amplitudenwechsel liegt jede ungerade Linie gleich weit unter ihren geraden
       Nachbarn (20·log10((1−a)/(1+a))). Ein Formant hebt nur einzelne Linien, der Median über acht
       Linien bleibt fast unberührt — anders als die Leistungssumme des SHR, die eine einzige
       Formantlinie beherrscht. Gemessen auf sauberen Vokalen (auch F1 = 2·F0, drei Formanten auf
       geraden Teiltönen, Rauschen 30 dB, Rosenberg, Jitter, Vibrato, Zufallsformanten): höchstens
       −5,5 dB tief; Amplitudenwechsel 0,3: −5,7 bis −6,6 dB, 0,4: ab −7,6 dB.
     - Zweite Anregung: Das LPC-Restsignal hat bei einem Ton eine Anregung je Periode, bei
       Verdopplung zwei. Höchste normierte Autokorrelation bei 0,35–0,65 der Periode; das erfasst
       auch Periodenwechsel (Zyklen T(1 ± a/2)), die keinen Kamm bilden (Kamm dort −5 bis +6 dB).
       Gemessen auf denselben sauberen Sätzen höchstens 0,243; Periodenwechsel 8–14 % rauschfrei in
       309 von 336 Rahmen über 0,3. Rauschen senkt die normierte Korrelation: bei SNR 40 dB liegt
       noch etwa die Hälfte darüber, bei 30 dB knapp ein Drittel. Mittenbegrenzung des Restsignals
       und das Verhältnis zur Korrelation bei der ganzen Periode trennten im Rauschen besser, ergaben
       aber auf sauberen Signalen Ausreißer bis 0,45 bzw. 1,9 (Rosenberg-Quelle); verworfen.
     Liegt einer der Belege vor, ist das Raster zweifelhaft: beide Werte werden ausgewiesen (zweifel,
     other). Hauptwert ist das Raster 2·F0 nur bei deutlichem Kamm oder bei Kamm und zweiter
     Anregung zusammen; sonst F0. Ohne Beleg gilt F0 ohne Zweifel. Ist 2·F0 > fmax, gibt es keine
     Impulsrate 2·F0 im Messbereich. Die Zyklusalternation selbst (physik.md §6) misst der Kern nicht;
     er entscheidet deshalb nie sicher auf Verdopplung. */
  var SHR_KAMM_ZWEIFEL_DB = -4, SHR_KAMM_RASTER_DB = -6, SHR_ZWEITPULS_MIN = 0.3;
  var SHR_REST_ORDNUNG = 16;      // höchste Ordnung des Sweeps; mit 14 lagen 295 statt 309 von 336 Periodenwechsel-Rahmen über 0,3

  // Median über k = 1..8 von L((k−½)·g) − Mittel(L((k−1)·g), L(k·g)) in dB; für k = 1 nur L(g)
  function kammKontrast(spec, g) {
    var d = [];
    for (var k = 1; k <= 8; k++) {
      var Ls = lineLevelDb(spec, (k - 0.5) * g), Lh = lineLevelDb(spec, k * g), Ll = (k > 1) ? lineLevelDb(spec, (k - 1) * g) : NaN;
      if (!isFinite(Ls) || !isFinite(Lh)) continue;
      d.push(Ls - (isFinite(Ll) ? (Ll + Lh) / 2 : Lh));
    }
    return d.length >= 4 ? median(d) : NaN;
  }

  // Zweite Anregung je Periode 1/f0: LPC-Restsignal (Preemphase, Burg auf dem Hann-gefensterten
  // Ausschnitt, inverses Filter auf dem ungefensterten), höchste normierte Autokorrelation bei 0,35–0,65·T.
  function zweitpuls(seg, sr, f0) {
    var x = preemph(seg, 0.97), ord = SHR_REST_ORDNUNG, P = sr / f0, lo = Math.floor(0.35 * P), hi = Math.ceil(0.65 * P), i, k;
    if (!(lo >= 1) || x.length - ord < 2 * hi) return NaN;
    var a = burg(hann(x), ord), e = new Float64Array(x.length - ord), best = -Infinity;
    for (i = ord; i < x.length; i++) { var s = x[i]; for (k = 1; k <= ord; k++) s += a[k] * x[i - k]; e[i - ord] = s; }
    for (var L = lo; L <= hi; L++) {
      var c = 0, p = 0, q = 0;
      for (i = 0; i + L < e.length; i++) { c += e[i] * e[i + L]; p += e[i] * e[i]; q += e[i + L] * e[i + L]; }
      var r = c / Math.sqrt(p * q + 1e-30);
      if (r > best) best = r;
    }
    return best;
  }

  // seg: Zeitausschnitt bei sr (Hauptfenster) für die zweite Anregung; fmax: obere Grenze der Impulsrate
  function shr(spec, f0, seg, sr, fmax) {
    var sF = shrAgainst(spec, f0), out = { shr: sF, grid: f0, other: NaN, zweifel: false, grund: '', kamm: NaN, zweitpuls: NaN };
    if (!(2 * f0 <= (fmax || 500))) return out;
    out.kamm = kammKontrast(spec, 2 * f0);
    out.zweitpuls = seg ? zweitpuls(seg, sr, f0) : NaN;
    var kamm = out.kamm <= SHR_KAMM_ZWEIFEL_DB, zweit = out.zweitpuls >= SHR_ZWEITPULS_MIN;
    if (!kamm && !zweit) return out;
    var s2 = shrAgainst(spec, 2 * f0);
    out.zweifel = true;
    out.grund = kamm && zweit ? 'kamm+zweitpuls' : (kamm ? 'kamm' : 'zweitpuls');
    if (out.kamm <= SHR_KAMM_RASTER_DB || (kamm && zweit)) { out.shr = s2; out.grid = 2 * f0; out.other = sF; }
    else out.other = s2;
    return out;
  }

  function bandPow(spec, fLo, fHi) {
    var lo = Math.max(1, Math.ceil(fLo / spec.df)), hi = Math.min(spec.pow.length - 1, Math.ceil(fHi / spec.df) - 1), s = 0;
    for (var k = lo; k <= hi; k++) s += spec.pow[k];
    return s;
  }
  function bandDb(spec, fLo, fHi) { return 10 * Math.log10(bandPow(spec, fLo, fHi) + 1e-20); }
  // SFR = Bandpegel 2400–3200 minus 0–2000 Hz (ohne Gleichanteil).
  function sfr(spec) { return bandDb(spec, 2400, 3200) - bandDb(spec, 0, 2000); }

  /* CPP: Cepstrum des dB-Spektrums; Gipfel in der Quefrenz 1/fmax..1/fmin (2–16,7 ms) über der
     Regressionsgeraden desselben Bereichs. Eigene Skala (15–34 dB), nicht Praat-CPPS.
     f0Fein: Grundton aus demselben Gipfel, parabolisch verfeinert. Ganzzahlige Quefrenz allein ist bei
     450 Hz auf ±1,5 % genau, zu grob für die Gegenprobe des Grundtons. NaN, wenn der Gipfel am Rand des
     Suchbereichs liegt: dann gibt es im Bereich keinen Gipfel, nur einen Abhang. */
  function cpp(spec, fmin, fmax) {
    fmin = fmin || 60; fmax = fmax || 500;
    var N = spec.N, re = new Float64Array(N), im = new Float64Array(N), k;
    for (k = 0; k <= (N >> 1); k++) re[k] = spec.db[k];
    for (k = 1; k < (N >> 1); k++) re[N - k] = spec.db[k];
    fft(re, im);
    var qmin = Math.round(spec.sr / fmax), qmax = Math.min(N >> 1, Math.round(spec.sr / fmin));
    var n = qmax - qmin + 1, sx = 0, sy = 0, sxx = 0, sxy = 0, cdb = new Float64Array(n), peak = -Infinity, qp = qmin;
    for (k = 0; k < n; k++) {
      var q = qmin + k, c = 20 * Math.log10(Math.abs(re[q]) / N + 1e-20);
      cdb[k] = c; sx += q; sy += c; sxx += q * q; sxy += q * c;
      if (c > peak) { peak = c; qp = q; }
    }
    var b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
    var f0Fein = NaN;
    if (qp > qmin && qp < qmax) {
      var kp = qp - qmin, A = cdb[kp - 1], B = cdb[kp], C = cdb[kp + 1], den = A - 2 * B + C;
      f0Fein = spec.sr / (qp + ((Math.abs(den) > 1e-12) ? Math.max(-0.5, Math.min(0.5, 0.5 * (A - C) / den)) : 0));
    }
    return { cpp: peak - (a + b * qp), f0: spec.sr / qp, f0Fein: f0Fein };
  }

  /* ---------- Gegenprobe des Grundtons ---------- */

  /* YIN nimmt den ersten Dip unter der Schwelle, und nur an ganzzahligen Verzögerungen. Ein enger
     Formantcluster oder ein schmaler F1 auf einem Teilton erzeugt Nebendips im Abstand einer
     Formantschwingung; liegt die Periode zwischen zwei Abtastwerten, steigt dn(T) über die Schwelle,
     und dn(2T) bleibt darunter. Gemessen: 348 Hz mit engem F3–F5 → 174 Hz, 192 Hz mit F2–F4-Cluster →
     210 Hz, 97 Hz mit F1 = 5·F0 → 244 Hz, jeweils in allen Rahmen und ohne Marke. Wiederholbar, aber
     falsch. Die Teilerkontrolle kann nur nach unten und nur ganzzahlig zurückrechnen.
     Deshalb zwei Gegenproben, beide nötig (einzeln abgeschaltet: ohne Cepstrum bleiben die
     nicht ganzzahligen Fehler unmarkiert, ohne Teiltonreihe die Fälle, in denen YIN und Cepstrum
     denselben Unterton liefern, und Jitter-Fälle):
     (1) Teiltonreihe des gemeldeten Werts selbst: Liegen die Linien bei k·f0, k kein Vielfaches von
         m (m = 2, 3), im Mittel 20 dB oder mehr unter den Vielfachen von m, ist f0 ein Unterton —
         dieselbe Grenze, die die Teilerkontrolle für eine neue Reihe verlangt (OCTAVE_ODD_EVEN_DB).
     (2) Cepstrum (unabhängige Periodenschätzung auf dem 0,14-s-Fenster): Es muss auf dieselbe Periode
         zeigen (±0,5 HT) oder auf ein Vielfaches q·T (q bis 5, Rahmonik). Bei einem Vielfachen
         entscheidet die Teiltonreihe bei f0Cep: steht dort eine echte Reihe (nicht mehr als 20 dB unter
         den bekannten Linien), ist der YIN-Wert ein Vielfaches des Grundtons. Zwischen 0,5 und 1 HT
         (Vibrato: YIN misst auf etwa vier Perioden, das Cepstrum auf 0,14 s; bei ±50 Cent bis
         0,46 HT Abstand gemessen) zählt, ob das Cepstrum auf denselben YIN-Dip zeigt.
     Was davon reißt, steht in grund: 'teiltonreihe', 'cepstrum' oder 'kein cepstrum' (kein Gipfel
     im Suchbereich, also keine Gegenprobe möglich). */
  var F0_CEP_TOL_HT = 0.5, F0_CEP_GRAU_HT = 1.0, F0_RAHMONIK_MAX = 5;

  function naechsterDip(dips, tau) {
    var bi = -1, bd = Infinity;
    for (var i = 0; i < dips.length; i++) { var d = Math.abs(dips[i].tau - tau); if (d < bd) { bd = d; bi = i; } }
    return bi;
  }

  // tauY: Periode des gemeldeten Werts in Abtastwerten (subFactor · YIN-Verzögerung), dips: YIN-Dips
  function f0Gegenprobe(spec, f0, fCep, tauY, dips, sr) {
    var out = { unsure: false, grund: '', aufM: 0 };
    for (var m = 2; m <= 3 && !out.aufM; m++) {
      var t = teiltonreihe(spec, f0, m, 8);
      if (isFinite(t.newMinusOld) && t.newMinusOld <= OCTAVE_ODD_EVEN_DB) { out.unsure = true; out.grund = 'teiltonreihe'; out.aufM = m; }
    }
    if (!isFinite(fCep)) { out.unsure = true; if (!out.grund) out.grund = 'kein cepstrum'; return out; }
    var q, bq = 1, bd = Infinity;
    for (q = 1; q <= F0_RAHMONIK_MAX; q++) { var d = Math.abs(12 * Math.log2(q * fCep / f0)); if (d < bd) { bd = d; bq = q; } }
    var passt = bd <= F0_CEP_TOL_HT;
    if (!passt && bd <= F0_CEP_GRAU_HT && dips && dips.length) passt = naechsterDip(dips, sr / (bq * fCep)) === naechsterDip(dips, tauY);
    if (passt && bq > 1) {
      var r = teiltonreihe(spec, fCep, bq, 8);
      passt = !(isFinite(r.newMinusOld) && r.newMinusOld > OCTAVE_ODD_EVEN_DB);
    }
    if (!passt) { out.unsure = true; if (!out.grund) out.grund = 'cepstrum'; }
    return out;
  }

  /* Korrektur nach gerissener Gegenprobe. Kandidaten: m·f0 (m = 2 oder 3), wenn die eigene Teiltonreihe
     für dieses m gerissen ist (art 'teiltonreihe': YIN lag eine Oktave oder Duodezime zu tief), und der
     YIN-Dip an der Cepstrum-Periode (art 'cepstrum': YIN hatte einen Nebendip gewählt). Ein Kandidat
     ersetzt den YIN-Wert nur, wenn alles zusammenpasst:
     - das Cepstrum bestätigt ihn direkt (±0,5 HT), er besteht die Gegenprobe selbst, und die
       Teilerkontrolle teilt ihn nicht und meldet keine Unsicherheit;
     - nach unten im ganzzahligen Verhältnis (f0/q) nur mit voller Teilerprüfung auf seinem eigenen
       Raster (8 dB über dem Zwischenrauschen, 20 dB-Grenze) — sonst würde aus einem Cepstrum, das auf
       einer Rahmonik sitzt, eine falsche Teilung (gemessen: 444 → 89 Hz bei rosa Rauschen 20 dB);
     - nach oben im ganzzahligen Verhältnis (q·f0) nur, wenn die Teiltonreihe von f0 für genau dieses q
       gerissen ist;
     - seine Teiltonreihe hebt sich mindestens F0_KORR_KONTRAST_DB deutlicher vom Zwischenrauschen ab
       als die des YIN-Werts (gemessen bei allen richtigen Korrekturen: mindestens 8 dB).
     Sonst bleibt der YIN-Wert stehen, markiert. */
  var F0_KORR_KONTRAST_DB = 6;

  // mittlere Höhe der Linien k·g, k = 1..8, über dem Zwischenrauschen des Rasters g (dB)
  function reihenKontrast(spec, g) {
    var ref = noiseRefDb(spec, g), sum = 0, n = 0;
    for (var k = 1; k <= 8; k++) { var L = lineLevelDb(spec, k * g); if (isFinite(L)) { sum += L; n++; } }
    return n ? sum / n - ref : NaN;
  }

  function f0Korrektur(spec, f0, fCep, gp, p, sr, fmax) {
    var cand = [], i;
    if (gp.aufM) cand.push({ f: gp.aufM * f0, art: 'teiltonreihe' });
    if (isFinite(fCep) && p.dn) {
      var tc = sr / fCep, bi = naechsterDip(p.dips, tc);
      if (bi >= 0 && Math.abs(p.dips[bi].tau - tc) <= 0.03 * tc + 1 && p.dips[bi].dn < 0.45) {
        var u = p.dips[bi].tau, A = p.dn[u - 1], B = p.dn[u], C = p.dn[u + 1], den = A - 2 * B + C;
        cand.push({ f: sr / (u + ((Math.abs(den) > 1e-12) ? Math.max(-1, Math.min(1, 0.5 * (A - C) / den)) : 0)), art: 'cepstrum' });
      }
    }
    var k0 = reihenKontrast(spec, f0);
    for (i = 0; i < cand.length; i++) {
      var cf = cand[i].f;
      if (!(cf >= F0_MIN_HZ && cf <= fmax)) continue;
      if (!(Math.abs(12 * Math.log2(fCep / cf)) <= F0_CEP_TOL_HT)) continue;
      var s2 = subMultipleInfo(spec, cf);
      if (s2.halve || s2.ambiguous) continue;
      if (f0Gegenprobe(spec, cf, fCep, sr / cf, p.dips, sr).unsure) continue;
      var ab = 0, auf = 0;
      for (var q = 2; q <= SUB_MULTIPLE_MAX; q++) {
        if (Math.abs(12 * Math.log2(q * cf / f0)) <= F0_CEP_TOL_HT) ab = q;
        if (Math.abs(12 * Math.log2(cf / (q * f0))) <= F0_CEP_TOL_HT) auf = q;
      }
      if (ab) {
        var t = teiltonreihe(spec, cf, ab, 8);
        if (!(t.newMinusNoise > 8 && t.above >= Math.max(3, Math.ceil(0.6 * t.nNew)) && t.newMinusOld > OCTAVE_ODD_EVEN_DB)) continue;
      }
      if (auf && gp.aufM !== auf) continue;
      if (!(reihenKontrast(spec, cf) >= k0 + F0_KORR_KONTRAST_DB)) continue;
      return { f0: cf, art: cand[i].art, oddEvenDb: s2.newMinusOld };
    }
    return null;
  }

  function h1h2(spec, f0) { return lineLevelDb(spec, f0) - lineLevelDb(spec, 2 * f0); }

  /* Betragsgang eines Polpaars (F, B) bei f, auf 0 dB bei f = 0 normiert (Iseli/Alwan). */
  function polePairGainDb(f, F, B, fs) {
    fs = fs || TARGET_SR;
    B = Math.max(40, Math.min(400, B));
    var r = Math.exp(-Math.PI * B / fs), th = 2 * Math.PI * F / fs, w = 2 * Math.PI * f / fs;
    var num = 1 - 2 * r * Math.cos(th) + r * r;
    var d1 = 1 - 2 * r * Math.cos(w - th) + r * r, d2 = 1 - 2 * r * Math.cos(w + th) + r * r;
    return 20 * Math.log10(num / Math.sqrt(d1 * d2));
  }
  /* H1*−H2*: Filterbeitrag der Polpaare F1–F3 bei F0 und 2·F0 herausgerechnet. */
  function h1h2Corrected(h1, h2, f0, F, BW, fs) {
    var g1 = 0, g2 = 0;
    for (var i = 0; i < 3; i++) {
      if (!isFinite(F[i])) return NaN;
      var b = isFinite(BW[i]) ? BW[i] : 100;
      g1 += polePairGainDb(f0, F[i], b, fs); g2 += polePairGainDb(2 * f0, F[i], b, fs);
    }
    return (h1 - g1) - (h2 - g2);
  }

  // Formantgewinn (Lorentz-Näherung) für die Simulation: 10·log10(1/(1+r²)), r = (f−F)/(B/2).
  function formantGain(f, F, B) { var r = (f - F) / (B / 2); return 10 * Math.log10(1 / (1 + r * r)); }

  /* Rohrlängenschätzung aus dem mittleren Abstand benachbarter gültiger Formanten F1..F4.
     Modellgröße (gleichförmiges Rohr), keine Messung — so beschriften. */
  function tubeLength(F, valid) {
    var diffs = [];
    for (var k = 0; k < 3; k++) {
      var ok = (!valid || (valid[k] && valid[k + 1])) && isFinite(F[k]) && isFinite(F[k + 1]);
      if (ok) diffs.push(F[k + 1] - F[k]);
    }
    if (diffs.length < 2) return { cm: NaN, dF: NaN, n: diffs.length };
    var m = 0; for (var i = 0; i < diffs.length; i++) m += diffs[i];
    m /= diffs.length;
    return { cm: SPEED_OF_SOUND_CM_S / (2 * m), dF: m, n: diffs.length };
  }

  /* Ausklang nach Phrasenende: (L_{+60 ms} − L_{+160 ms}) / 0,1 s in dB/s. track = RMS-Verlauf in dB. */
  function decayRate(track, hopS, endIdx) {
    var i60 = endIdx + Math.round(0.06 / hopS), i160 = endIdx + Math.round(0.16 / hopS);
    if (i160 >= track.length || i60 < 0) return NaN;
    return (track[i60] - track[i160]) / 0.1;
  }

  /* Alternation der Zyklusdauern: mean|T_{i+2} − T_i| / mean|T_{i+1} − T_i| < 0,5 → Periodenverdopplung. */
  function alternation(periods) {
    if (!periods || periods.length < 4) return NaN;
    var a = 0, b = 0, na = 0, nb = 0;
    for (var i = 0; i + 1 < periods.length; i++) { b += Math.abs(periods[i + 1] - periods[i]); nb++; }
    for (var j = 0; j + 2 < periods.length; j++) { a += Math.abs(periods[j + 2] - periods[j]); na++; }
    if (nb === 0 || b / nb < 1e-9) return NaN;
    return (a / na) / (b / nb);
  }

  /* ---------- Vollständige Analyse an einer Stelle: Fenstersweep + Spektralmaße ---------- */

  function emptyFrame() {
    var nan5 = [NaN, NaN, NaN, NaN, NaN];
    return {
      voiced: false, f0: NaN, note: '--', ap: 1, rmsDb: NaN,
      F: nan5.slice(), sdOrder: nan5.slice(), sdWin: nan5.slice(), BW: nan5.slice(),
      nOrders: [0, 0, 0, 0, 0], nWin: [0, 0, 0, 0, 0], valid: [false, false, false, false, false], merged: [false, false, false, false, false],
      slotUnsure: [false, false, false, false, false], slotGrund: ['', '', '', '', ''], rauschBoden: [false, false, false, false, false], bwArtifact: [false, false, false, false, false], nPeaksRef: 0,
      audible: false, tonalButAperiodic: false,
      d34: NaN, d45: NaN, d34valid: false, d45valid: false, f1f0: NaN, nearestHarmonic: NaN,
      sfr: NaN, shr: NaN, shrGrid: NaN, shrUnsure: false, shrOther: NaN, shrGrund: '', shrKamm: NaN, shrZweitpuls: NaN, cpp: NaN, h1h2: NaN, h1h2c: NaN, h1h2unsure: false,
      octaveCorrected: false, octaveAmbiguous: false, octaveUnterGrenze: false, octaveOddEvenDb: NaN, subFactor: 1, h1h2cArtifact: false,
      f0Unsure: false, f0Grund: '', f0Cep: NaN, f0Yin: NaN, f0Korrektur: '',
      harmonicPullHz: NaN, sparseHarmonics: false,
      dips: [], fminEff: NaN, nWindows: 0, spectrumDb: null
    };
  }

  /* ds: Signal bereits auf TARGET_SR. idx: Mittelpunkt (align 'centre') oder letzter Index (align 'end').
     opts: { align, floorDb, windows, orders, spreadMaxHz, yinThresh, fmin, fmax, wantSpectrum } */
  function analyseAt(ds, sr, idx, opts) {
    opts = opts || {};
    var windows = opts.windows || WINDOWS, smax = opts.spreadMaxHz || SPREAD_MAX_HZ;
    var floorDb = (opts.floorDb != null) ? opts.floorDb : -67;
    var out = emptyFrame(), segs = [], w, n, start, k;
    for (w = 0; w < windows.length; w++) {
      n = Math.round(windows[w] * sr);
      start = (opts.align === 'end') ? idx + 1 - n : idx - (n >> 1);
      if (start < 0 || start + n > ds.length) continue;
      segs.push({ L: windows[w], seg: ds.subarray(start, start + n) });
    }
    out.nWindows = segs.length;
    if (!segs.length) return out;
    var main = segs[0], longest = segs[0], shortest = segs[0], i;
    for (i = 1; i < segs.length; i++) {
      if (Math.abs(segs[i].L - MAIN_WINDOW) < Math.abs(main.L - MAIN_WINDOW)) main = segs[i];
      if (segs[i].L > longest.L) longest = segs[i];
      if (segs[i].L < shortest.L) shortest = segs[i];
    }
    /* Erst Pegel und Periodizität, dann erst der Formantsweep. Vorher lief der Sweep immer und
       lieferte auch für Pausenrahmen Formantzahlen, die in Rahmen-CSV und Chronik landeten —
       entgegen dem Clean-Silence-Protokoll der Spezifikation (in Pausen Sentinel −99,00).
       Nebenbei kostet eine Pause jetzt einen Bruchteil der Rechenzeit. */
    out.rmsDb = rmsDb(main.seg);
    var audible = out.rmsDb > floorDb + 12;
    /* YIN-Fenster an die Tonhöhe anpassen: Mit festen 0,10 s wandert der Grundton bei normalem
       Vibrato (±4 %, 5,5 Hz) innerhalb des Fensters so weit, dass der Dip verflacht — bei 98 Hz
       galten 54 % der Rahmen als unvoiced, obwohl der Pegel 50 dB über dem Rauschboden lag.
       Erst grob messen, dann mit rund vier Perioden nachmessen. */
    var p = detectF0(main.seg, sr, opts.fmin || 60, opts.fmax || 500, opts.yinThresh);
    if (isFinite(p.f0) && p.f0 > 0) {
      var wantS = Math.max(shortest.L, Math.min(main.L, 4.2 / p.f0));
      if (wantS < main.L - 1e-6) {
        var nAdapt = Math.round(wantS * sr), startA = (opts.align === 'end') ? idx + 1 - nAdapt : idx - (nAdapt >> 1);
        if (startA >= 0 && startA + nAdapt <= ds.length) {
          var pA = detectF0(ds.subarray(startA, startA + nAdapt), sr, opts.fmin || 60, opts.fmax || 500, opts.yinThresh);
          if (isFinite(pA.f0) && pA.ap < p.ap) p = pA;
        }
      }
    }
    out.ap = p.ap; out.dips = p.dips; out.fminEff = p.fminEff;
    out.audible = audible;
    out.voiced = isFinite(p.f0) && p.ap < 0.45 && audible;
    out.tonalButAperiodic = audible && !out.voiced;
    var spec = spectrum(longest.seg, sr);
    if (opts.wantSpectrum) out.spectrumDb = spec.db;
    if (!out.voiced) return out;

    var perWin = [];
    for (i = 0; i < segs.length; i++) perWin.push(analyseWindow(segs[i].seg, sr, opts));
    var mainRes = perWin[segs.indexOf(main)];
    out.nPeaksRef = mainRes.nPeaksRef;
    for (k = 0; k < 5; k++) {
      var vals = [];
      for (i = 0; i < perWin.length; i++) if (isFinite(perWin[i].F[k])) vals.push(perWin[i].F[k]);
      out.F[k] = median(vals); out.sdWin[k] = spread(vals); out.nWin[k] = vals.length;
      out.sdOrder[k] = mainRes.sdOrder[k]; out.BW[k] = mainRes.BW[k]; out.nOrders[k] = mainRes.nOrders[k]; out.merged[k] = mainRes.merged[k];
      out.bwArtifact[k] = !!mainRes.bwArtifact[k];
    }
    // Slot-Nummerierung prüfen, bevor Gültigkeit vergeben wird: ist die Lesart mehrdeutig, ist der Wert
    // vielleicht ein anderer Formant — auch wenn alle Sweeps denselben Wert wiederholen. Jedes Fenster
    // prüft seine eigene Referenzordnung; ist es in einem Fenster mehrdeutig, ist es der Median auch.
    for (i = 0; i < perWin.length; i++) for (k = 0; k < 5; k++) {
      if (perWin[i].slotUnsure[k]) { out.slotUnsure[k] = true; out.slotGrund[k] = 'nummer'; }
      else if (perWin[i].slotMerged[k]) { out.slotUnsure[k] = true; if (!out.slotGrund[k]) out.slotGrund[k] = 'verschmolzen'; }
    }
    // Formant im Rauschboden: Median des Hüllkurvenabfalls über alle Fenster und Ordnungen
    for (k = 0; k < 5; k++) {
      var dr = [];
      for (i = 0; i < perWin.length; i++) dr = dr.concat(perWin[i].drops[k]);
      out.rauschBoden[k] = dr.length > 0 && !(median(dr) >= DROP_MIN_DB);
    }
    for (k = 0; k < 5; k++) {
      out.valid[k] = isFinite(out.F[k]) && out.nWin[k] >= 3 && out.sdWin[k] < smax && out.nOrders[k] >= 2 && out.sdOrder[k] < smax && !out.slotUnsure[k] && !out.rauschBoden[k];
    }
    out.d34 = out.F[3] - out.F[2]; out.d45 = out.F[4] - out.F[3];
    out.d34valid = out.valid[2] && out.valid[3]; out.d45valid = out.valid[3] && out.valid[4];

    var f0 = p.f0;
    var sub = subMultipleInfo(spec, f0);
    out.octaveCorrected = sub.halve; out.octaveAmbiguous = sub.ambiguous; out.octaveUnterGrenze = sub.unterGrenze; out.octaveOddEvenDb = sub.newMinusOld;
    out.subFactor = sub.halve ? sub.m : 1;
    if (sub.halve) f0 = f0 / sub.m;
    var cp = cpp(spec, opts.fmin || 60, opts.fmax || 500);
    out.f0Cep = cp.f0Fein;
    var gp = f0Gegenprobe(spec, f0, out.f0Cep, out.subFactor * p.tau, p.dips, sr);
    out.f0Yin = f0; out.f0Unsure = gp.unsure; out.f0Grund = gp.grund;
    var kor = gp.unsure ? f0Korrektur(spec, f0, out.f0Cep, gp, p, sr, opts.fmax || 500) : null;
    if (kor) {
      // Korrigierter Wert besteht alle Proben: nicht unsicher, aber sichtbar korrigiert (f0Korrektur, f0Yin)
      f0 = kor.f0; out.subFactor = 1; out.octaveCorrected = false; out.octaveAmbiguous = false; out.octaveUnterGrenze = false; out.octaveOddEvenDb = kor.oddEvenDb;
      out.f0Unsure = false; out.f0Grund = ''; out.f0Korrektur = kor.art;
    }
    out.f0 = f0; out.note = hzToNote(f0);
    // Bei hohem Grundton rastet ein LPC-Gipfel auf dem nächsten Teilton ein: die Lage eines
    // Formanten ist dann nur bis auf etwa ±F0/2 bestimmt, egal wie einig die Sweeps sind.
    out.harmonicPullHz = f0 / 2;
    out.sparseHarmonics = f0 > 250;
    // SHR-Raster F0 oder 2·F0 aus eigenen Belegen (shr); ein unsicherer Grundton macht auch SHR unsicher
    var sh = shr(spec, f0, main.seg, sr, opts.fmax || 500);
    out.shr = sh.shr; out.shrGrid = sh.grid; out.shrOther = sh.other; out.shrKamm = sh.kamm; out.shrZweitpuls = sh.zweitpuls;
    out.shrUnsure = sh.zweifel || out.f0Unsure;
    out.shrGrund = out.f0Unsure ? (sh.grund ? sh.grund + '+' : '') + 'grundton' : sh.grund;
    out.sfr = sfr(spec);
    out.cpp = cp.cpp;
    out.h1h2 = h1h2(spec, f0);
    if (isFinite(out.F[0])) {
      out.f1f0 = out.F[0] / f0; out.nearestHarmonic = Math.max(1, Math.round(out.f1f0));
      // Eine Bandbreite unter 40 Hz ist ein Artefakt (physik.md 2.4) — dann lieber den
      // physiologischen Richtwert als eine Zahl, die das Fenster künstlich eng macht.
      var b1 = (isFinite(out.BW[0]) && !out.bwArtifact[0]) ? out.BW[0] : 80;
      out.h1h2unsure = Math.abs(out.F[0] - f0) < 1.5 * b1 || Math.abs(out.F[0] - 2 * f0) < 1.5 * b1;
      if (out.valid[0] && out.valid[1] && out.valid[2]) {
        // h1h2Corrected begrenzt die Bandbreiten bereits auf 40–400 Hz (Iseli/Alwan); hier also
        // die gemessenen Werte durchreichen und nur vermerken, dass eine davon ein Artefakt war.
        out.h1h2c = h1h2Corrected(lineLevelDb(spec, f0), lineLevelDb(spec, 2 * f0), f0, out.F, out.BW, sr);
        out.h1h2cArtifact = out.bwArtifact[0] || out.bwArtifact[1] || out.bwArtifact[2];
      }
    }
    /* Eine spektrale Erkennung der Periodenverdopplung wurde geprüft und verworfen: das Verhältnis
       gerader zu ungeraden Teiltönen erreicht bei sauberen Vokalen bis +87 dB (ungerade Teiltöne
       fallen in Spektraltäler) und bei echter Alternation nur +0,8 dB — die Verteilungen überlappen
       vollständig. Das Physik-Skript sagt es (§7.5): spektral allein gibt es Fehlalarme, sicher ist
       nur die Zyklusalternation. Die wird hier nicht gemessen; der Kern verspricht sie auch nicht.
       Kamm und zweite Anregung (shr) entscheiden deshalb nur, ob das SHR-Raster zweifelhaft ist und
       welcher der beiden ausgewiesenen Werte vorn steht, nie sicher auf Verdopplung. */
    return out;
  }

  /* Kompatibler Einzelrahmen-Aufruf (v16-Prüflauf): ein Fenster, kein Fenstersweep.
     frame: beliebige Rate sr (typisch 2048 Werte bei 48 kHz). */
  function analyse(frame, sr, opts) {
    opts = opts || {};
    var level = rmsDb(frame);
    var ds = resample(frame, sr, TARGET_SR);
    var p = detectF0(ds, TARGET_SR, opts.fmin || 60, opts.fmax || 500, opts.yinThresh);
    var floorDb = (opts.floorDb != null) ? opts.floorDb : -67;
    var voiced = isFinite(p.f0) && p.ap < 0.45 && level > floorDb + 12;
    var w = analyseWindow(ds, TARGET_SR, opts);
    var ratio = NaN, nearest = NaN;
    if (voiced && isFinite(w.F[0]) && p.f0 > 0) { ratio = w.F[0] / p.f0; nearest = Math.max(1, Math.round(ratio)); }
    return {
      voiced: voiced, f0: voiced ? p.f0 : NaN, note: voiced ? hzToNote(p.f0) : '--',
      ap: p.ap, rmsDb: level, F: w.F, SD: w.sdOrder, BW: w.BW, nOrders: w.nOrders, merged: w.merged, refOrder: w.refOrder,
      nPeaksRef: w.nPeaksRef, slotUnsure: slotGapUnsure(w.F, w.nPeaksRef),
      f1f0: ratio, nearestHarmonic: nearest, windowSweep: false
    };
  }

  /* ---------- Zweite Tonhöhenspur: kurze Ereignisse ---------- */

  /* Die Hauptspur misst F0 auf einem Fenster von mindestens 60 ms. Ein Kiekser von 50 ms füllt
     ein solches Fenster nie und verschwindet dadurch vollständig — gemessen: ein Oktavsprung von
     50 ms ergibt null auffällige Rahmen, ab 90 ms ist er sauber zu sehen. Praat hat denselben
     blinden Fleck aus einem anderen Grund (Glättung des Tonhöhenverlaufs).
     Deshalb eine zweite Spur mit kurzem Fenster. Sie misst nur grob, taugt nicht für Formanten
     und nicht für feine Tonhöhenarbeit — sie beantwortet eine einzige Frage: war da ein Sprung?
     Fenster, Untergrenze und Tiefpass sind gemessen (Bariton 75–470 Hz, Kiekser bis rund 940 Hz):
     - FINE_FMIN 70 Hz: tauMax = sr/fmin muss länger sein als die Periode des tiefsten Tons samt
       Vibrato (75 Hz − 50 Cent = 72,8 Hz). Mit der früheren Untergrenze 120 Hz war die Spur darunter
       blind (98 Hz: 0 % richtige F0, Kiekser unsichtbar; 117 Hz: 29 Scheinsprünge in 2 s).
     - FINE_WINDOW_S 35 ms: lässt bei 75 Hz noch 1,5 Perioden für den Vergleich. 30 ms (auch mit
       fmin 80) ergibt Scheinsprünge bei 75–80 Hz; 40 ms dehnt Staccato-Kanten über 90 ms.
     - FINE_LOWPASS_HZ vor YIN: YIN vergleicht nur ganzzahlige Verzögerungen. Liegt die Periode nahe
       einem halben Abtastwert (bei 12 kHz etwa 25,5 → 470 Hz), stören die hohen Formanten den
       Vergleich bei T, und YIN nimmt 2T — gemessen bei /i/ 410–470 Hz mit Vibrato. Der Grundton bis
       940 Hz bleibt im Durchlassband.
     Randprüfung: Liegt ein Tonanfang oder -ende im Fenster (Energie einer Fensterhälfte unter
     FINE_EDGE_RATIO der anderen), misst YIN die Kante statt der Periode — gemessen am Phrasenende
     650 Hz statt 98 Hz, im Staccato Läufe, die vor dem Ton beginnen. Solche Rahmen sind in rand
     markiert und gelten in detectJumps als stimmlos; f0 und ap bleiben unverändert stehen. */
  var FINE_WINDOW_S = 0.035, FINE_HOP_S = 0.005, FINE_FMIN = 70, FINE_LOWPASS_HZ = 1500, FINE_EDGE_RATIO = 0.1;

  // Nullphasige FIR-Filterung mit symmetrischem Kern: verschiebt keine Zeitmarken der Spur.
  function firSymmetric(x, h) {
    var N = x.length, taps = h.length, mid = (taps - 1) >> 1, y = new Float64Array(N);
    for (var i = 0; i < N; i++) {
      var k0 = Math.max(0, mid - i), k1 = Math.min(taps, N + mid - i), a = 0;
      for (var k = k0; k < k1; k++) a += h[k] * x[i + k - mid];
      y[i] = a;
    }
    return y;
  }

  function pitchTrackFine(ds, sr, opts) {
    opts = opts || {};
    var winS = opts.windowS || FINE_WINDOW_S, hopS = opts.hopS || FINE_HOP_S;
    var fmin = opts.fmin || FINE_FMIN, fmax = opts.fmax || 900;
    var lpHz = (opts.lowpassHz == null) ? FINE_LOWPASS_HZ : opts.lowpassHz;
    var randR = (opts.edgeRatio == null) ? FINE_EDGE_RATIO : opts.edgeRatio;
    var x = (lpHz > 0) ? firSymmetric(ds, makeLowpass(lpHz / sr, 2 * Math.round(16 * sr / 12000) + 1)) : ds;
    var n = Math.round(winS * sr), hop = Math.max(1, Math.round(hopS * sr)), h2 = n >> 1;
    var cs = new Float64Array(x.length + 1), k;
    for (k = 0; k < x.length; k++) cs[k + 1] = cs[k] + x[k] * x[k];
    var m = 0, c;
    for (c = n >> 1; c + (n >> 1) <= ds.length; c += hop) m++;
    var t = new Float64Array(m), f0 = new Float64Array(m), ap = new Float64Array(m), rand = new Uint8Array(m), i = 0;
    for (c = n >> 1; c + (n >> 1) <= ds.length && i < m; c += hop, i++) {
      var s0 = c - (n >> 1), p = detectF0(x.subarray(s0, s0 + n), sr, fmin, fmax, opts.yinThresh);
      var e1 = cs[s0 + h2] - cs[s0], e2 = cs[s0 + n] - cs[s0 + h2];
      t[i] = c / sr; f0[i] = p.f0; ap[i] = p.ap;
      rand[i] = (randR > 0 && Math.min(e1, e2) < randR * Math.max(e1, e2)) ? 1 : 0;
    }
    return { t: t, f0: f0, ap: ap, rand: rand, hopS: hopS, windowS: winS, fmin: fmin, lowpassHz: lpHz };
  }

  /* Weite eines Laufs: Median der größten Gruppe von Rahmen, die auf ±1 HT übereinstimmen.
     Die Randrahmen eines Laufs mischen alten und neuen Ton im Fenster und liefern Oktav- oder
     Quintfehler. Das frühere Maximum griff genau diese: gemessen 23 HT für einen Sprung von 11 HT
     bei 98 Hz und −12 statt +11 HT bei 147 Hz; der Median aller Rahmen ergab −7 statt +12 HT bei
     einem Kiekser 470 → 940 Hz. */
  function kernGruppe(v) {
    var best = NaN, bestN = -1, bestD = Infinity;
    for (var a = 0; a < v.length; a++) {
      var z = 0, d = 0;
      for (var b = 0; b < v.length; b++) { var x = Math.abs(v[b] - v[a]); if (x <= 1) { z++; d += x; } }
      if (z > bestN || (z === bestN && d < bestD)) { bestN = z; bestD = d; best = v[a]; }
    }
    return best;
  }

  /* Sprünge in der kurzen Spur: Läufe, die mindestens minSemitones von der ruhigen Umgebung
     abweichen. Die Einteilung beschreibt nur Tonhöhe und Dauer, sie urteilt nicht:
       'kante'    — Tonsprung ≥ minSemitones, kürzer als holdMs (Silbenkante, Staccato, Kiekser)
       'gehalten' — Tonsprung ≥ minSemitones, gehalten ≥ holdMs
     Auch ein legato gesungener Melodiesprung (Quarte bis Oktave) ist 'gehalten'. Ob ein Ereignis
     ein Registerbruch ist, entscheidet der Bericht nach dem Manual (Qualitätseinbruch am Übergang),
     nicht dieser Detektor. Dafür trägt jedes Ereignis Belege ohne Wertung:
       uebergangMs — Abstand der Rahmenmitten vom letzten Rahmen am Bezugston (±quietSemitones, höchstens
                     referenceS vor dem Einsatz) bis zum ersten Rahmen am neuen Ton (±quietSemitones um
                     nachHz); Auflösung hopS, kurze Lücken eingeschlossen; NaN, wenn einer fehlt
       apSpitze    — größte Aperiodizität (YIN-dn, kann über 1 liegen) aller Rahmen in ±50 ms um den
                     Einsatz, stimmlose und Randrahmen eingeschlossen
       oktave      — |halbtoene| liegt innerhalb 0,7 HT von 12 oder 24
     An synthetischen Signalen trennen apSpitze und uebergangMs legato Sprünge und Übergänge mit
     Rauschen nicht sauber: Die Verteilungen überlappen. Sie sind Material, keine Entscheidung.
     Die Grenze 90 ms ist übernommen, nicht gemessen; sie ist über opts.holdMs änderbar. */
  function detectJumps(track, opts) {
    opts = opts || {};
    var minSt = (opts.minSemitones == null) ? 5 : opts.minSemitones;
    var holdS = (opts.holdMs == null ? 90 : opts.holdMs) / 1000;
    var apMax = (opts.apMax == null) ? 0.45 : opts.apMax;
    var backS = (opts.referenceS == null) ? 0.20 : opts.referenceS;
    var ruheSt = (opts.quietSemitones == null) ? 2 : opts.quietSemitones;
    var maxOnset = (opts.maxOnsetFrames == null) ? 4 : opts.maxOnsetFrames;
    var minRef = (opts.minRefFrames == null) ? 3 : opts.minRefFrames;
    var pauseS = (opts.pauseMs == null ? 120 : opts.pauseMs) / 1000;
    var glideAp = (opts.glideApMax == null) ? 0.15 : opts.glideApMax;
    var n = track.t.length, back = Math.max(3, Math.round(backS / track.hopS));
    var pauseFr = Math.max(1, Math.round(pauseS / track.hopS));
    var ruhe = [], events = [], run = null, seitRuhe = 0, luecke = 0, i;

    /* Der Bezug gilt erst, wenn mindestens minRef Rahmen auf ±quietSemitones um ihren Median
       übereinstimmen. Sonst wird ein einzelner Fehlrahmen am Toneinsatz (Oktavfehler im ersten
       Fenster) zum Bezug, und der ganze folgende Ton erscheint als gehaltener Sprung. */
    function bezug() {
      if (ruhe.length < minRef) return NaN;
      var m = median(ruhe), z = 0;
      for (var k = 0; k < ruhe.length; k++) if (Math.abs(12 * Math.log2(ruhe[k] / m)) < ruheSt) z++;
      return z >= minRef ? m : NaN;
    }
    function gueltig(k) { return isFinite(track.f0[k]) && track.ap[k] < apMax && !(track.rand && track.rand[k]); }
    for (i = 0; i < n; i++) {
      if (!gueltig(i)) {
        /* Eine kurze stimmlose Lücke (Konsonant, Staccato) unterbricht weder den Bezug noch einen
           laufenden Sprung. Erst eine Pause ab pauseMs trennt Phrasen: Der Lauf endet, der Bezug wird
           verworfen — eine neue Phrase auf anderem Ton ist kein Sprung. Gemessen (Feinspur, Rahmen
           als stimmlos gezählt): 20 ms löscht den Bezug schon bei Konsonanten von 30–60 ms, in
           Staccato-Lücken und bei 30–60 ms Rauschen am Übergang eines Bruchs; dann wird der neue Ton
           zum Bezug und die Rückkehr erscheint als gehaltener Sprung in Gegenrichtung. 90–200 ms
           bestehen alle geprüften Fälle; 120 ms hält Abstand zu den längsten Lücken (80 ms) und zur
           kürzesten Atempause (200 ms). */
        if (++luecke >= pauseFr) {
          if (run) { if (run.dauerFrames >= 2) events.push(run); run = null; }
          ruhe = []; seitRuhe = 0;
        }
        continue;
      }
      luecke = 0;
      /* Bezug sind die ruhigen Rahmen VOR dem Ereignis. Während eines Laufs wird er eingefroren —
         wandert er mit, endet ein gehaltener Sprung nach rund 80 ms von selbst und wird als Kante
         gemeldet. Das ist derselbe Fehler, der gehaltene Registerwechsel unsichtbar macht. */
      var ref = run ? run.ref : bezug();
      var st = (isFinite(ref) && ref > 0) ? 12 * Math.log2(track.f0[i] / ref) : NaN;
      var drueber = isFinite(st) && Math.abs(st) >= minSt;

      if (run) {
        if (drueber) {
          run.bis = track.t[i]; run.iBis = i; run.dauerFrames++; run.sts.push(st); run.fs.push(track.f0[i]); run.zurueck = 0;
        } else if (++run.zurueck >= 2) {
          /* Zurück beim Bezug erst nach zwei Rahmen: Ein einzelner Mischrahmen am Rand eines lauten
             Kieksers beendete den Lauf sonst mittendrin. Ein Lauf aus einem einzigen Rahmen ist ein
             Messfehler am Übergang und wird verworfen, ohne den Bezug zu löschen. Nach einer Kante ist
             die Stimme zurück am Bezugston, der Bezug bleibt; erst nach einem gehaltenen Wechsel wird
             er neu aufgebaut. Gemessen: Wurde der Bezug nach jedem Lauf gelöscht, machte ein
             Fehlrahmen am Übergang den neuen Ton zum Bezug, und die Rückkehr erschien als gehaltener
             Sprung in Gegenrichtung (+16 HT gesungen, −16 HT über 580 ms gemeldet). */
          if (run.dauerFrames >= 2) {
            events.push(run);
            if (run.bis - run.von + track.hopS >= holdS) { ruhe = []; seitRuhe = 0; }
          }
          run = null;
        }
      } else if (drueber) {
        /* Ein Sprung muss schnell einsetzen. Ein Portamento erreicht dieselbe Weite, aber über
           Hunderte Millisekunden — das ist Tonbewegung, kein Wechsel. */
        if (seitRuhe <= maxOnset) run = { von: track.t[i], bis: track.t[i], iVon: i, iBis: i, ref: ref, dauerFrames: 1, sts: [st], fs: [track.f0[i]], zurueck: 0 };
      }
      if (!run) {
        /* seitRuhe zählt nur Rahmen mit sicherer Periode (ap unter der YIN-Schwelle 0,15). Unsichere
           Rahmen in einem rauen Übergang sind kein Beleg für ein Gleiten — gemessen: Bei einem
           simulierten Bruch mit 60 ms aperiodischem Übergang hoben sie seitRuhe über maxOnset, der
           neue Ton wurde Bezug, und die Rückkehr erschien als gehaltener Sprung in Gegenrichtung
           (−15 statt +15 HT, 575 ms; ohne diese Regel 7 von 1440 simulierten Brüchen, mit ihr 0).
           Ein langsames Portamento hat ap ≤ 0,06, auch mit Rauschen bei 5 dB. Preis: Schnelles Gleiten
           macht die Rahmen im 35-ms-Fenster selbst unsicher und zählt dann häufiger als Sprung
           (Oktave in 150 ms: 6 von 12 statt 1 von 12; ab 300 ms keiner). uebergangMs zeigt die Dauer. */
        if (isFinite(st) && Math.abs(st) < ruheSt) { ruhe.push(track.f0[i]); seitRuhe = 0; }
        else { ruhe.push(track.f0[i]); if (track.ap[i] < glideAp) seitRuhe++; }
        if (ruhe.length > back) ruhe.shift();
      }
    }
    if (run && run.dauerFrames >= 2) events.push(run);

    return events.map(function (e) {
      var dauer = e.bis - e.von + track.hopS, kern = kernGruppe(e.sts), hs = [], fz = [], k;
      for (k = 0; k < e.sts.length; k++) if (Math.abs(e.sts[k] - kern) <= 1) { hs.push(e.sts[k]); fz.push(e.fs[k]); }
      var h = median(hs), ziel = median(fz), ah = Math.abs(h), tB = NaN, tZ = NaN, apS = -Infinity;
      for (k = e.iVon - 1; k >= 0 && track.t[k] >= e.von - backS - 1e-9; k--) {
        if (gueltig(k) && Math.abs(12 * Math.log2(track.f0[k] / e.ref)) < ruheSt) { tB = track.t[k]; break; }
      }
      for (k = e.iVon; k <= e.iBis; k++) {
        if (gueltig(k) && Math.abs(12 * Math.log2(track.f0[k] / ziel)) < ruheSt) { tZ = track.t[k]; break; }
      }
      for (k = e.iVon; k >= 0 && track.t[k] >= e.von - 0.05 - 1e-9; k--) if (track.ap[k] > apS) apS = track.ap[k];
      for (k = e.iVon + 1; k < n && track.t[k] <= e.von + 0.05 + 1e-9; k++) if (track.ap[k] > apS) apS = track.ap[k];
      return { startS: e.von, dauerS: dauer, halbtoene: h, richtung: h > 0 ? 'auf' : 'ab',
        vonHz: e.ref, nachHz: ziel, art: dauer >= holdS ? 'gehalten' : 'kante',
        uebergangMs: (isFinite(tB) && isFinite(tZ)) ? Math.round((tZ - tB) * 1e6) / 1e3 : NaN,   // ms, auf µs gerundet (Gleitkommarest)
        apSpitze: isFinite(apS) ? apS : NaN,
        oktave: Math.abs(ah - 12) <= 0.7 || Math.abs(ah - 24) <= 0.7 };
    });
  }

  /* ---------- Synthese für Prüfsignale (Glottisimpulse durch Zweipol-Resonatoren) ---------- */

  function resonate(x, f, bw, sr) {
    var r = Math.exp(-Math.PI * bw / sr), th = 2 * Math.PI * f / sr;
    var a1 = 2 * r * Math.cos(th), a2 = -r * r, b0 = 1 - a1 - a2;
    var y = new Float64Array(x.length), y1 = 0, y2 = 0;
    for (var i = 0; i < x.length; i++) { var v = b0 * x[i] + a1 * y1 + a2 * y2; y2 = y1; y1 = v; y[i] = v; }
    return y;
  }
  /* opts.altRatio < 1: jeder zweite Impuls schwächer (Periodenverdopplung). opts.gain: Spitzenwert (0,7).
     Die Impulse werden auf Bruchteile von Abtastwerten gesetzt (lineare Verteilung auf die beiden
     Nachbarstellen). Auf ganze Abtastwerte gerundet wäre das Prüfsignal selbst nicht periodisch:
     die Rundung erzeugt einen Zittereffekt, der sich alle zwei Perioden wiederholt — also genau die
     Subharmonische, die der Kern finden soll. Prüfsignale müssen sauber sein, sonst prüfen sie nichts. */
  function synthVowel(f0, forms, bws, dur, sr, opts) {
    opts = opts || {};
    var n = Math.round(dur * sr), src = new Float64Array(n), T = sr / f0, alt = (opts.altRatio == null) ? 1 : opts.altRatio;
    for (var k = 0; k * T < n; k++) {
      var pos = k * T, i0 = Math.floor(pos), fr = pos - i0, g = (k % 2) ? alt : 1;
      for (var j = 0; j < 6; j++) {
        var v = g * Math.cos(Math.PI * j / 12);
        if (i0 + j < n) src[i0 + j] += v * (1 - fr);
        if (i0 + j + 1 < n) src[i0 + j + 1] += v * fr;
      }
    }
    var y = src;
    for (var m = 0; m < forms.length; m++) y = resonate(y, forms[m], bws[m], sr);
    var mx = 0;
    for (var q = 0; q < n; q++) mx = Math.max(mx, Math.abs(y[q]));
    var gain = (opts.gain == null) ? 0.7 : opts.gain;
    for (var p = 0; p < n; p++) y[p] = gain * y[p] / mx;
    return y;
  }

  var api = {
    VERSION: VERSION, TARGET_SR: TARGET_SR, ORDERS: ORDERS, WINDOWS: WINDOWS, MAIN_WINDOW: MAIN_WINDOW,
    SPREAD_MAX_HZ: SPREAD_MAX_HZ, SLOT_TOL_HZ: SLOT_TOL_HZ, MERGED_BW_HZ: MERGED_BW_HZ, BW_ARTIFACT_HZ: BW_ARTIFACT_HZ, SENTINEL: SENTINEL, OCTAVE_ODD_EVEN_DB: OCTAVE_ODD_EVEN_DB, F0_MIN_HZ: F0_MIN_HZ,
    analyse: analyse, analyseAt: analyseAt, analyseWindow: analyseWindow,
    detectF0: detectF0, resample: resample, burg: burg, lpcEnvelope: lpcEnvelope, peaksFromEnvelope: peaksFromEnvelope,
    formantsFromLPC: formantsFromLPC, fft: fft, spectrum: spectrum, lineLevelDb: lineLevelDb, noiseRefDb: noiseRefDb,
    octaveCheck: octaveCheck, octaveInfo: octaveInfo, subMultipleInfo: subMultipleInfo, subMultipleTest: subMultipleTest, teiltonreihe: teiltonreihe, f0Gegenprobe: f0Gegenprobe, f0Korrektur: f0Korrektur, reihenKontrast: reihenKontrast, F0_KORR_KONTRAST_DB: F0_KORR_KONTRAST_DB,
    F0_CEP_TOL_HT: F0_CEP_TOL_HT, F0_CEP_GRAU_HT: F0_CEP_GRAU_HT, F0_RAHMONIK_MAX: F0_RAHMONIK_MAX, slotGapUnsure: slotGapUnsure, slotNumberUnsure: slotNumberUnsure, slotMergeUnsure: slotMergeUnsure, F_PEAK_MAX_HZ: F_PEAK_MAX_HZ, SLOT_LO: SLOT_LO, SLOT_HI: SLOT_HI, DROP_MIN_DB: DROP_MIN_DB, shr: shr, shrAgainst: shrAgainst, kammKontrast: kammKontrast, zweitpuls: zweitpuls,
    SHR_KAMM_ZWEIFEL_DB: SHR_KAMM_ZWEIFEL_DB, SHR_KAMM_RASTER_DB: SHR_KAMM_RASTER_DB, SHR_ZWEITPULS_MIN: SHR_ZWEITPULS_MIN, SHR_REST_ORDNUNG: SHR_REST_ORDNUNG, sfr: sfr, bandDb: bandDb, cpp: cpp, h1h2: h1h2,
    h1h2Corrected: h1h2Corrected, polePairGainDb: polePairGainDb, formantGain: formantGain, tubeLength: tubeLength,
    decayRate: decayRate, alternation: alternation, rmsDb: rmsDb, hann: hann, hannWindow: hannWindow, preemph: preemph,
    median: median, spread: spread, quantile: quantile, mad: mad, sentinel: sentinel, hzToNote: hzToNote, hzToMidi: hzToMidi, cents: cents,
    nextPow2: nextPow2, pitchTrackFine: pitchTrackFine, detectJumps: detectJumps,
    FINE_WINDOW_S: FINE_WINDOW_S, FINE_HOP_S: FINE_HOP_S, FINE_FMIN: FINE_FMIN, FINE_LOWPASS_HZ: FINE_LOWPASS_HZ, FINE_EDGE_RATIO: FINE_EDGE_RATIO, synthVowel: synthVowel, resonate: resonate, lowpassFor: lowpassFor, lowpassBank: lowpassBank,
    _burg: burg, _formantsFromLPC: formantsFromLPC, _detectF0: detectF0, _resample: resample
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VAREDSP = api;
})(typeof self !== 'undefined' ? self : this);

/* VARE — Hochband 1.0: Teiltonstruktur im Band 4–6,5 kHz („Tröte“, F6/F7).
   Reines JavaScript (ES5), braucht nur dsp.js (FFT, Hann-Fenster, Median, Quantil). Browser: window.VAREHOCHBAND,
   Node: module.exports. Dieselbe Rechenvorschrift wie vare_hochband.py (Chronik-Standard 2.8, Tabellen frames_teilton,
   take_boden_baender, takes_hochband) — Fensterlänge, Bänder, Kamm, Linien- und Zwischenraum-Masken, Gatter und Kennwerte
   sind dort festgelegt und hier nicht verhandelbar. Jede Änderung, die einen Rahmenwert ändert, erhöht VERSION.

   Je stimmhaftem Rahmen (80 ms Hann, Geräterate, keine Wandlung auf 12 kHz — der Kern sieht nur bis 6 kHz):
   - f0 fein: Kamm über die Teiltöne 500–3000 Hz, ±2 % um den Grundton des Kerns in Schritten von 0,1 %; Maß ist der
     mittlere Logarithmus der Leistung auf drei Bins um jede Linie. Der Kamm findet keinen Grundton, er schärft ihn.
   - Linie = Bins höchstens 12 % f0 von einem Teilton k·f0 (k bis 7000 Hz) entfernt; Zwischenraum = Bins mindestens 30 % f0
     von jeder Linie entfernt. Dazwischen zählt nichts.
   - je Band 300–2000 (lo), 2400–3200 (sf), 4000–6500 Hz (hb): Linienpegel = Summe der Linienbins; Zwischenraumpegel =
     Summe der Zwischenraumbins, auf die Zahl der Linienbins normiert (gleich viele Bins, also vergleichbar).
   - Linie − Zwischenraum (hb_lz): Teiltonstruktur im Hochband. 0 dB = Rauschen (kein Unterschied zwischen Linie und
     Lücke), hohe Werte = die Resonanzen F6/F7 tragen Teiltöne. Kettenrobust (gleiche Kette im Zähler und Nenner).
   - hb_stimme = Hochband-Linien gegen Linien 300–2000 Hz, hb_zw = Hochband-Zwischenraum gegen dieselben Linien (Zisch-
     und Atemanteil): beides kettenabhängig, nur innerhalb eines Tages und Geräts vergleichen. sf_lz und sf_stimme ebenso
     für das Sängerformantband, zw_lo = Zwischenraum im Stimmband gegen dessen Linien (Rauschen in der Quelle).
   Rauschboden je Band: die stillsten 3 % der 80-ms-Blöcke der ganzen Aufnahme (mindestens 5, digitale Stille unter
   −90 dBFS ausgenommen), FFT 4096 bei 48 kHz; die Teiltonrechnung nutzt FFT 8192. Beide Spektren sind rohe |X|²-Summen
   ohne Fensternormierung — in Differenzen kürzt sich das; gegen den Boden (SNR) steht das 8192er-Spektrum mit doppelt so
   vielen Bins im Band, also rund 3 dB höher. So steht es in vare_hochband.py, und so bleibt es, damit die Werte gleich sind.
   Kennwerte eines Takes nur aus lauten Kernrahmen: Pegel innerhalb 12 dB unter dem 95. Perzentil der Rahmenpegel
   (RMS des ungefensterten 80-ms-Ausschnitts, wie frames.rms der Chronik), mindestens 60 ms von Anfang und Ende eines
   stimmhaften Laufs entfernt (Lücke über 45 ms trennt Läufe), Hochband mindestens 6 dB über dem Boden. Unter 12 dB unter
   dem Maximum ist das Hochband Rauschen (Linie − Zwischenraum um 0); an den Rändern steht es bis 5 dB höher (These 33).
   Dazu, nur hier: Rahmen mit unsicherem Grundton (dsp.js f0Unsure) zählen nicht zu den Kernrahmen — eine Oktave daneben
   macht jede zweite Linie zum Zwischenraum, und der Wert fällt. Die Chronik kennt die Marke nicht; der Anteil steht daneben.
   Mindestens 50 Rahmen und 30 Kernrahmen, sonst kein Kennwert (der Grund steht da). */
(function (root) {
  'use strict';
  var D = (typeof module !== 'undefined' && module.exports) ? require('./dsp.js') : root.VAREDSP;

  var VERSION = '1.0';
  var FENSTER_S = 0.08;                                   // 3840 Abtastwerte bei 48 kHz
  var BAENDER = { lo: [300, 2000], sf: [2400, 3200], hb: [4000, 6500], hb2: [6500, 8000] };
  var F0_MIN_HZ = 60, F0_MAX_HZ = 600;                    // Rahmen der Chronik: f0 BETWEEN 60 AND 600
  var KAMM_LO_HZ = 500, KAMM_HI_HZ = 3000, KAMM_SCHRITT = 0.001, KAMM_WEITE = 20;   // ±2 % in 0,1-%-Schritten
  var LINIE = 0.12, ZWISCHENRAUM = 0.30, TEILTON_MAX_HZ = 7000;
  var LAUT_DB = 12, LAUT_QUANTIL = 0.95, RAND_S = 0.06, LUECKE_S = 0.045, SNR_MIN_DB = 6;
  var STILLE_DBFS = -90, BODEN_ANTEIL = 0.03, BODEN_MIN_BLOECKE = 5;
  var MIN_RAHMEN = 50, MIN_KERN = 30, VERLAUF_S = 10, VERLAUF_MIN_RAHMEN = 10, LZ_SCHWELLE_DB = 3;
  // Bits in gatter je Rahmen (Serie hbGatter, CSV hb_laut/hb_kern/hb_snr_ok/hb_f0_sicher/hb_kernrahmen).
  var GATTER = { GERECHNET: 1, LAUT: 2, KERN: 4, SNR: 8, SICHER: 16, KERNRAHMEN: 32 };

  function fensterLaenge(sr) { return Math.floor(FENSTER_S * sr + 1e-6); }
  function nfftBoden(sr) { return D.nextPow2(fensterLaenge(sr)); }    // 4096 bei 44,1 und 48 kHz
  function nfftTeilton(sr) { return 2 * nfftBoden(sr); }               // 8192

  // |X|² des Hann-gefensterten Ausschnitts x[start, start+W), mit Nullen auf N aufgefüllt — roh wie np.fft.rfft.
  function leistung(x, start, W, N) {
    var re = new Float64Array(N), im = new Float64Array(N), w = D.hannWindow(W), i;
    for (i = 0; i < W; i++) re[i] = x[start + i] * w[i];
    D.fft(re, im);
    var nb = (N >> 1) + 1, P = new Float64Array(nb);
    for (i = 0; i < nb; i++) P[i] = re[i] * re[i] + im[i] * im[i];
    return P;
  }
  // Bandpegel: Summe der Bins mit a ≤ k·df < b, in dB (rohe Leistung).
  function bandDb(P, sr, N, band) {
    var df = sr / N, k0 = Math.max(0, Math.floor(band[0] / df) - 1), k1 = Math.min(P.length - 1, Math.ceil(band[1] / df) + 1), s = 0;
    for (var k = k0; k <= k1; k++) { var f = k * df; if (f >= band[0] && f < band[1]) s += P[k]; }
    return 10 * Math.log10(s + 1e-30);
  }
  function rms(x, start, W) {
    var s = 0;
    for (var i = 0; i < W; i++) { var v = x[start + i]; s += v * v; }
    return Math.sqrt(s / W);
  }
  // Rahmenpegel wie frames.rms der Chronik (vare_standard.py: 20·log10(RMS + 1e-12)).
  function rmsDbfs(x, start, W) { return 20 * Math.log10(rms(x, start, W) + 1e-12); }
  // Runden wie numpy (halb zu gerade): np.round(k·c/df) in vare_hochband.py.
  function rint(v) { var f = Math.floor(v), d = v - f; return d > 0.5 ? f + 1 : (d < 0.5 ? f : (f % 2 === 0 ? f : f + 1)); }

  /* ---------- Rauschboden je Band ---------- */

  /* Die stillsten Blöcke der Aufnahme: nicht überlappende 80-ms-Blöcke ab 0, RMS in dBFS; Blöcke bis −90 dBFS sind digitale
     Stille und zählen nicht; genommen werden die k = max(5, 3 % der übrigen) leisesten. Je Band der Median ihrer Bandpegel
     (FFT nfftBoden). Liefert { lo, sf, hb, hb2, rmsBoden, nBloecke, N, W }; alles NaN, wenn die Aufnahme kürzer als ein Block ist. */
  function boden(x, sr) {
    var W = fensterLaenge(sr), N = nfftBoden(sr), nb = Math.floor(x.length / W), db = new Float64Array(nb), idx = [], nOk = 0, i, name;
    // Blockpegel wie vare_hochband.py boden(): 20·log10(RMS + 1e-20); digitale Stille wird so −400 dB und fällt heraus.
    for (i = 0; i < nb; i++) { db[i] = 20 * Math.log10(rms(x, i * W, W) + 1e-20); idx.push(i); if (db[i] > STILLE_DBFS) nOk++; }
    var k = Math.max(BODEN_MIN_BLOECKE, Math.floor(BODEN_ANTEIL * nOk + 1e-9));
    idx.sort(function (a, b) { var da = db[a] > STILLE_DBFS ? db[a] : Infinity, dbb = db[b] > STILLE_DBFS ? db[b] : Infinity; return (da - dbb) || (a - b); });
    idx = idx.slice(0, k);
    var werte = {}, pegelListe = [];
    for (name in BAENDER) werte[name] = [];
    for (i = 0; i < idx.length; i++) {
      var P = leistung(x, idx[i] * W, W, N);
      for (name in BAENDER) werte[name].push(bandDb(P, sr, N, BAENDER[name]));
      pegelListe.push(db[idx[i]]);
    }
    var out = { rmsBoden: D.median(pegelListe), nBloecke: idx.length, N: N, W: W };
    for (name in BAENDER) out[name] = D.median(werte[name]);
    return out;
  }
  /* Dieselbe Regel über eine Liste schon gerechneter Blöcke [{ rms, hb }] (Live-Ring in app.js): Median des Hochband-Pegels
     der k leisesten Blöcke über −90 dBFS. NaN ohne Blöcke. */
  function bodenAusBloecken(bloecke) {
    var ok = [], i;
    for (i = 0; i < bloecke.length; i++) if (bloecke[i] && bloecke[i].rms > STILLE_DBFS && isFinite(bloecke[i].hb)) ok.push(bloecke[i]);
    if (!ok.length) return NaN;
    ok.sort(function (a, b) { return a.rms - b.rms; });
    var k = Math.max(BODEN_MIN_BLOECKE, Math.floor(BODEN_ANTEIL * ok.length + 1e-9)), hb = [];
    for (i = 0; i < Math.min(k, ok.length); i++) hb.push(ok[i].hb);
    return D.median(hb);
  }
  // Ein Block für den Live-Ring: RMS (dBFS) und Hochband-Bandpegel (roh, FFT nfftBoden) des Ausschnitts x[start, start+W).
  function block(x, sr, start) {
    var W = fensterLaenge(sr), N = nfftBoden(sr);
    if (start < 0 || start + W > x.length) return null;
    return { rms: rmsDbfs(x, start, W), hb: bandDb(leistung(x, start, W, N), sr, N, BAENDER.hb) };
  }

  /* ---------- Teiltonlinien und Zwischenraum je Rahmen ---------- */

  /* P: rohes Leistungsspektrum (nfftTeilton), f0: Grundton des Kerns. Liefert { f0Fein, kamm, loLin, loZw, sfLin, sfZw, hbLin, hbZw }
     (alle Pegel roh in dB) oder null, wenn der Kamm nichts findet. */
  function teiltonRahmen(P, f0, sr, N) {
    var df = sr / N, nb = P.length, best = -Infinity, fBest = NaN, j, k;
    for (j = -KAMM_WEITE; j <= KAMM_WEITE; j++) {
      var c = f0 * (1 + j * KAMM_SCHRITT), kLo = Math.max(2, Math.ceil(KAMM_LO_HZ / c)), kHi = Math.floor(KAMM_HI_HZ / c);
      if (kHi - kLo + 1 < 3) continue;
      var s = 0, n = 0;
      for (k = kLo; k <= kHi; k++) {
        var ix = rint(k * c / df);
        if (ix >= nb - 1) continue;
        s += Math.log(P[ix - 1] + P[ix] + P[ix + 1] + 1e-30); n++;
      }
      if (n && s / n > best) { best = s / n; fBest = c; }
    }
    if (!isFinite(fBest)) return null;
    var f = fBest, nPos = Math.floor(TEILTON_MAX_HZ / f), linTol = LINIE * f, zwTol = ZWISCHENRAUM * f;
    var namen = ['lo', 'sf', 'hb'], lin = [0, 0, 0], zw = [0, 0, 0], nLin = [0, 0, 0], nZw = [0, 0, 0], kl = 0, kz = 0, nkl = 0, nkz = 0, b;
    for (k = 0; k < nb; k++) {
      var fr = k * df, h = Math.round(fr / f);
      if (h < 1) h = 1; else if (h > nPos) h = nPos;
      var dist = Math.abs(fr - h * f), istLin = dist <= linTol, istZw = dist >= zwTol;
      if (!istLin && !istZw) continue;
      if (fr >= KAMM_LO_HZ && fr < KAMM_HI_HZ) { if (istLin) { kl += P[k]; nkl++; } else { kz += P[k]; nkz++; } }
      for (b = 0; b < 3; b++) {
        var band = BAENDER[namen[b]];
        if (fr >= band[0] && fr < band[1]) { if (istLin) { lin[b] += P[k]; nLin[b]++; } else { zw[b] += P[k]; nZw[b]++; } }
      }
    }
    var out = { f0Fein: f, kamm: (nkl && nkz) ? 10 * Math.log10((kl / nkl) / (kz / nkz + 1e-30) + 1e-30) : NaN };
    for (b = 0; b < 3; b++) {
      out[namen[b] + 'Lin'] = 10 * Math.log10(lin[b] + 1e-30);
      out[namen[b] + 'Zw'] = 10 * Math.log10(zw[b] * nLin[b] / Math.max(nZw[b], 1) + 1e-30);
    }
    return out;
  }

  /* Ein Rahmen aus den Abtastwerten x (bei sr): 80 ms ab start, Grundton f0 des Kerns, Hochband-Boden bodenHb (roh, aus boden().hb
     oder bodenAusBloecken; NaN erlaubt → snr NaN). Liefert null, wenn f0 außerhalb 60–600 Hz liegt oder das Fenster nicht in x passt.
     Sonst { f0Fein, kamm, pegel (dBFS), hbLz, sfLz, hbStimme, hbZw, sfStimme, zwLo, hbGes, snr }. */
  function rahmen(x, sr, start, f0, bodenHb) {
    var W = fensterLaenge(sr), N = nfftTeilton(sr);
    if (!(f0 >= F0_MIN_HZ && f0 <= F0_MAX_HZ) || !(start >= 0) || start + W > x.length) return null;
    var t = teiltonRahmen(leistung(x, start, W, N), f0, sr, N);
    if (!t) return null;
    var hbGes = 10 * Math.log10(Math.pow(10, t.hbLin / 10) + Math.pow(10, t.hbZw / 10));
    return { f0Fein: t.f0Fein, kamm: t.kamm, pegel: rmsDbfs(x, start, W),
      hbLz: t.hbLin - t.hbZw, sfLz: t.sfLin - t.sfZw, hbStimme: t.hbLin - t.loLin, hbZw: t.hbZw - t.loLin, sfStimme: t.sfLin - t.loLin, zwLo: t.loZw - t.loLin,
      hbGes: hbGes, snr: isFinite(bodenHb) ? hbGes - bodenHb : NaN };
  }

  /* ---------- Kennwerte eines Takes ---------- */

  function leer() {
    return { version: VERSION, nRahmen: 0, nKernLaut: 0, nLaut: 0, nKern: 0, nSnr: 0, nSicher: 0,
      hbLz: NaN, hbLzAnt3: NaN, hbStimme: NaN, hbZw: NaN, sfLz: NaN, sfStimme: NaN, zwLo: NaN, hbSnr: NaN, kamm: NaN, pegelMax: NaN,
      f0UnsureShare: NaN, verlauf: '', verlaufListe: [], grund: '' };
  }
  function vorz(v) { return (v >= 0 ? '+' : '') + v.toFixed(1); }
  function spalte(R, feld, K) { var out = []; for (var i = 0; i < K.length; i++) out.push(R[K[i]][feld]); return out; }

  /* R: gerechnete Rahmen in Zeitfolge, je { t, pegel, hbLz, sfLz, hbStimme, hbZw, sfStimme, zwLo, kamm, snr, sicher }.
     Liefert { kennwerte, gatter } — gatter: Uint8Array je Eintrag von R mit den Bits GATTER. */
  function kennwerte(R) {
    var n = R.length, out = leer(), gatter = new Uint8Array(n), i, a, b;
    out.nRahmen = n;
    if (n < MIN_RAHMEN) { out.grund = 'zu wenige Rahmen mit Hochband (' + n + ' < ' + MIN_RAHMEN + ')'; return { kennwerte: out, gatter: gatter }; }
    var pegel = spalte(R, 'pegel', range(n)), pmax = D.quantile(pegel, LAUT_QUANTIL);
    out.pegelMax = pmax;
    // Läufe: eine Lücke über 45 ms trennt; Rand = die ersten und letzten 60 ms eines Laufs.
    var start = 0;
    for (i = 1; i <= n; i++) {
      if (i < n && !(R[i].t - R[i - 1].t > LUECKE_S)) continue;
      var t0 = R[start].t, t1 = R[i - 1].t;
      for (a = start; a < i; a++) {
        var g = GATTER.GERECHNET;
        if (R[a].pegel > pmax - LAUT_DB) g |= GATTER.LAUT;
        if (!(R[a].t - t0 < RAND_S || t1 - R[a].t < RAND_S)) g |= GATTER.KERN;
        if (R[a].snr >= SNR_MIN_DB) g |= GATTER.SNR;
        if (R[a].sicher !== false) g |= GATTER.SICHER;
        if ((g & 30) === 30) g |= GATTER.KERNRAHMEN;
        gatter[a] = g;
      }
      start = i;
    }
    var K = [], ohneSicher = 0;
    for (i = 0; i < n; i++) {
      if (gatter[i] & GATTER.LAUT) out.nLaut++;
      if (gatter[i] & GATTER.KERN) out.nKern++;
      if (gatter[i] & GATTER.SNR) out.nSnr++;
      if (gatter[i] & GATTER.SICHER) out.nSicher++;
      if ((gatter[i] & 14) === 14) { if (gatter[i] & GATTER.SICHER) K.push(i); else ohneSicher++; }
    }
    out.nKernLaut = K.length;
    out.f0UnsureShare = (K.length + ohneSicher) ? ohneSicher / (K.length + ohneSicher) : NaN;
    if (K.length < MIN_KERN) {
      out.grund = 'zu wenige laute Kernrahmen (' + K.length + ' < ' + MIN_KERN + '; laut ' + out.nLaut + ', Kern ' + out.nKern + ', über dem Boden ' + out.nSnr + ', Grundton sicher ' + out.nSicher + ' von ' + n + ')';
      return { kennwerte: out, gatter: gatter };
    }
    var lz = spalte(R, 'hbLz', K), ueber = 0;
    for (i = 0; i < lz.length; i++) if (lz[i] > LZ_SCHWELLE_DB) ueber++;
    out.hbLz = D.median(lz); out.hbLzAnt3 = ueber / lz.length;
    out.hbStimme = D.median(spalte(R, 'hbStimme', K)); out.hbZw = D.median(spalte(R, 'hbZw', K));
    out.sfLz = D.median(spalte(R, 'sfLz', K)); out.sfStimme = D.median(spalte(R, 'sfStimme', K));
    out.zwLo = D.median(spalte(R, 'zwLo', K)); out.hbSnr = D.median(spalte(R, 'snr', K)); out.kamm = D.median(spalte(R, 'kamm', K));
    // Verlauf: Median von hb_lz je 10 s, nur Abschnitte mit mindestens 10 Kernrahmen.
    var tMax = R[n - 1].t, teile = [];
    for (i = 0; i < n; i++) if (R[i].t > tMax) tMax = R[i].t;
    for (a = 0; a <= Math.floor(tMax); a += VERLAUF_S) {
      var w = [];
      for (b = 0; b < K.length; b++) { var tt = R[K[b]].t; if (tt >= a && tt < a + VERLAUF_S) w.push(R[K[b]].hbLz); }
      if (w.length >= VERLAUF_MIN_RAHMEN) { var m = D.median(w); out.verlaufListe.push({ vonS: a, bisS: a + VERLAUF_S, hbLz: m, n: w.length }); teile.push(a + '-' + (a + VERLAUF_S) + 's ' + vorz(m)); }
    }
    out.verlauf = teile.join(' | ');
    return { kennwerte: out, gatter: gatter };
  }
  function range(n) { var r = []; for (var i = 0; i < n; i++) r.push(i); return r; }

  // Kurzzeile wie vare_hochband.py (zeile): für Ergebnisanzeige und Notiz.
  function zeile(k) {
    if (!k || !isFinite(k.hbLz)) return 'Hochband: ' + (k && k.grund ? k.grund : 'nicht gerechnet');
    return 'Hochband F6/F7 Linie−Zw ' + vorz(k.hbLz) + ' dB (' + Math.round(100 * k.hbLzAnt3) + ' % über 3 dB) | Stimme ' + vorz(k.hbStimme) + ' | Zisch ' + vorz(k.hbZw)
      + ' | SF-Band Linie−Zw ' + vorz(k.sfLz) + ', Stimme ' + vorz(k.sfStimme) + ' | Quellrauschen ' + vorz(k.zwLo) + ' | laute Kernrahmen ' + k.nKernLaut + '/' + k.nRahmen
      + (k.verlauf ? ' | Verlauf ' + k.verlauf : '');
  }

  var api = { VERSION: VERSION, FENSTER_S: FENSTER_S, BAENDER: BAENDER, F0_MIN_HZ: F0_MIN_HZ, F0_MAX_HZ: F0_MAX_HZ, GATTER: GATTER,
    LAUT_DB: LAUT_DB, LAUT_QUANTIL: LAUT_QUANTIL, RAND_S: RAND_S, LUECKE_S: LUECKE_S, SNR_MIN_DB: SNR_MIN_DB, STILLE_DBFS: STILLE_DBFS,
    BODEN_ANTEIL: BODEN_ANTEIL, BODEN_MIN_BLOECKE: BODEN_MIN_BLOECKE, MIN_RAHMEN: MIN_RAHMEN, MIN_KERN: MIN_KERN, LZ_SCHWELLE_DB: LZ_SCHWELLE_DB,
    KAMM_SCHRITT: KAMM_SCHRITT, KAMM_WEITE: KAMM_WEITE, LINIE: LINIE, ZWISCHENRAUM: ZWISCHENRAUM, TEILTON_MAX_HZ: TEILTON_MAX_HZ,
    fensterLaenge: fensterLaenge, nfftBoden: nfftBoden, nfftTeilton: nfftTeilton, leistung: leistung, bandDb: bandDb, rint: rint,
    boden: boden, bodenAusBloecken: bodenAusBloecken, block: block, teiltonRahmen: teiltonRahmen, rahmen: rahmen, kennwerte: kennwerte, leer: leer, zeile: zeile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VAREHOCHBAND = api;
})(typeof self !== 'undefined' ? self : this);

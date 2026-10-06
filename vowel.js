/* VARE — Vokalklassen und Stabilitätsgatter
   Läuft im Browser (window.VAREVOWEL) und unter Node (module.exports). Keine Abhängigkeiten.

   Die Zentroide sind ein MODELL (deutsche Langvokale, erwachsene männliche Sprecher, gerundet nach
   Sendlmeier/Seebode 2006 und Pätzold/Simpson 1997) — keine Messung an diesem Sänger. Sie dienen nur
   dazu, „gleicher Vokal“ von „anderer Vokal“ zu trennen. Die Chronik kann sie später durch eigene
   Mediane je Vokalabsicht ersetzen (refs.centroidsPersonal). */
(function (root) {
  'use strict';

  var CENTROIDS = [
    { cls: 'i', F1: 270, F2: 2150 },
    { cls: 'e', F1: 350, F2: 2000 },
    { cls: 'ɛ', F1: 500, F2: 1750 },
    { cls: 'a', F1: 680, F2: 1250 },
    { cls: 'ɔ', F1: 520, F2: 900 },
    { cls: 'o', F1: 380, F2: 750 },
    { cls: 'u', F1: 300, F2: 700 },
    { cls: 'y', F1: 280, F2: 1650 },
    { cls: 'ø', F1: 370, F2: 1450 },
    { cls: 'ɐ', F1: 480, F2: 1400 }     // neutral / gedeckt — der gedeckte Sänger-/a/ landet meist hier
  ];
  var CLASS_INDEX = {};
  CENTROIDS.forEach(function (c, i) { CLASS_INDEX[c.cls] = i; });

  // Toleranzen in logarithmischer Skala: 15 % auf F1, 12 % auf F2 — ein Artikulationsschritt zählt
  // bei 300 Hz genauso wie bei 700 Hz.
  var TOL_F1 = 0.15, TOL_F2 = 0.12;

  function classify(F1, F2, centroids) {
    centroids = centroids || CENTROIDS;
    if (!isFinite(F1) || !isFinite(F2) || F1 <= 0 || F2 <= 0) return { cls: null, idx: -1, d: NaN, second: null, margin: NaN, ambiguous: true };
    var best = null, second = null;
    for (var i = 0; i < centroids.length; i++) {
      var c = centroids[i];
      var a = Math.log(F1 / c.F1) / TOL_F1, b = Math.log(F2 / c.F2) / TOL_F2;
      var d = Math.sqrt(a * a + b * b);
      if (!best || d < best.d) { second = best; best = { cls: c.cls, idx: i, d: d }; }
      else if (!second || d < second.d) second = { cls: c.cls, idx: i, d: d };
    }
    var margin = second ? second.d / Math.max(best.d, 1e-9) : Infinity;
    return { cls: best.cls, idx: best.idx, d: best.d, second: second ? second.cls : null, margin: margin, ambiguous: margin < 1.25 };
  }

  function median(v) {
    var s = [];
    for (var i = 0; i < v.length; i++) if (isFinite(v[i])) s.push(v[i]);
    if (!s.length) return NaN;
    s.sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
  }
  /* Streuung als Interdezilbereich (q90 − q10): unempfindlich gegen einzelne Ausreißer, aber
     empfindlich, sobald mehr als 10 % der Rahmen sich bewegen — MAD würde bis 50 % übersehen. */
  function idr(v) {
    var s = [];
    for (var i = 0; i < v.length; i++) if (isFinite(v[i])) s.push(v[i]);
    if (s.length < 2) return NaN;
    s.sort(function (a, b) { return a - b; });
    function q(p) { var h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h); return s[lo] + (s[hi] - s[lo]) * (h - lo); }
    return q(0.9) - q(0.1);
  }

  var DEFAULTS = {
    windowS: 0.30,          // Regler 0,15–0,60
    sdF1Max: 50,            // Regler 20–150 Hz (Interdezilbereich q90−q10 von F1 im Fenster)
    sdF2Max: 100,           // Regler 40–300 Hz
    minValidShare: 0.80,    // Regler 0,5–1,0: Anteil der stimmhaften Rahmen mit gültigem F1 und F2
    f3MinHz: 2500,          // Regler 2000–3000: darunter zählt ein enges Cluster nicht (Physik-Skript §4, §10)
    minVoicedShare: 0.9,    // fest
    classShare: 0.8,        // fest: Anteil der gültigen Rahmen mit der Fensterklasse
    holdS: 0.15,            // fest: Hysterese beim Klassenwechsel
    minFrames: 5,           // fest: so viele Rahmen muss das Fenster mindestens enthalten
    minFillShare: 0.6,      // fest: und mindestens so viel von windowS abdecken
    // Live: der gewertete Rahmen muss selbst noch im Vokal stehen (frameLeaves)
    frameTolShare: 0.5,     // fest: Band um den Fenstermedian, Anteil von sdF1Max bzw. sdF2Max …
    frameVibRel: 0.045,     // fest: … oder dieser Anteil des Medians, je nachdem, was größer ist
    refS: 0.6,              // fest: Bezug „was der Vokal zuvor gezeigt hat“: Rahmen der letzten refS …
    refLagS: 0.1,           // fest: … ohne die jüngsten refLagS …
    refMinSpanS: 0.4,       // fest: … gilt erst, wenn er so lange reicht …
    refMarginHz: 20         // fest: … und erlaubt so viel über seine Spanne hinaus
  };

  function entry(fr, centroids) {
    var ok = !!(fr.voiced && fr.valid1 && fr.valid2 && isFinite(fr.F1) && isFinite(fr.F2));
    return { t: fr.t, voiced: !!fr.voiced, ok: ok, F1: fr.F1, F2: fr.F2, F3: fr.F3, d34: fr.d34, d34valid: !!fr.d34valid,
      ambiguous: ok ? classify(fr.F1, fr.F2, centroids).ambiguous : false,
      cls: ok ? classify(fr.F1, fr.F2, centroids).cls : null };
  }
  function res(state, cls, score, reason, m1, m2) {
    return { state: state, cls: cls, score: score, reason: reason || '', F1med: m1 == null ? NaN : m1, F2med: m2 == null ? NaN : m2 };
  }

  /* Die eine Prüffunktion für ein Fenster aus Rahmen-Einträgen (entry). Liefert
     { state: 'pause'|'uebergang'|'stabil', cls, reason, F1med, F2med } — ohne Hysterese, ohne Score. */
  function evaluateWindow(win, opts) {
    var voiced = 0, valid = 0, f1 = [], f2 = [], i;
    /* Ein Fenster, das kaum Rahmen enthält, kann nicht „stabil“ heißen: bei einem einzigen Rahmen
       liefert der Interdezilbereich NaN, und NaN > Grenze ist false — beide Bewegungsprüfungen
       galten damit als bestanden. Nach jeder Lücke (Registerkarte im Hintergrund, Kalibrierung,
       Mikrofonwechsel) wurde so aus einem einzelnen Rahmen sofort wieder „stabil“ mit Wertung. */
    if (win.length < opts.minFrames) return res('uebergang', null, NaN, 'zu wenige Rahmen (' + win.length + ')');
    var span = win[win.length - 1].t - win[0].t;
    if (span < opts.windowS * opts.minFillShare) return res('uebergang', null, NaN, 'Fenster erst ' + span.toFixed(2) + ' s voll');
    for (i = 0; i < win.length; i++) {
      if (!win[i].voiced) continue;
      voiced++;
      if (win[i].ok) { valid++; f1.push(win[i].F1); f2.push(win[i].F2); }
    }
    if (!voiced) return res('pause', null, NaN, 'Pause');
    if (voiced / win.length < opts.minVoicedShare) return res('uebergang', null, NaN, 'stimmlos dazwischen');
    if (valid / voiced < opts.minValidShare) return res('uebergang', null, NaN, 'F1/F2 unsicher');
    var s1 = idr(f1), s2 = idr(f2), m1 = median(f1), m2 = median(f2);
    if (s1 > opts.sdF1Max) return res('uebergang', null, NaN, 'F1 bewegt sich (' + s1.toFixed(0) + ' Hz)', m1, m2);
    if (s2 > opts.sdF2Max) return res('uebergang', null, NaN, 'F2 bewegt sich (' + s2.toFixed(0) + ' Hz)', m1, m2);
    var c = classify(m1, m2, opts.centroids), same = 0;
    for (i = 0; i < win.length; i++) if (win[i].ok && win[i].cls === c.cls) same++;
    if (same / valid < opts.classShare) return res('uebergang', null, NaN, 'Vokal uneindeutig', m1, m2);
    return res('stabil', c.cls, NaN, '', m1, m2);
  }
  function scoreFor(e, opts) {
    // Der Rahmen, dem das Urteil gilt, muss selbst stimmhaft sein — sonst stünde eine Wertung in
    // einer Zeile, die gleichzeitig „Pause“ meldet.
    if (!e.voiced) return { score: NaN, reason: 'Rahmen selbst nicht stimmhaft' };
    if (!e.d34valid || !isFinite(e.d34)) return { score: NaN, reason: 'F3/F4 unsicher' };
    if (!(e.F3 >= opts.f3MinHz)) return { score: NaN, reason: 'F3 zu tief (' + Math.round(e.F3) + ' Hz)' };
    return { score: e.d34, reason: '' };
  }
  /* Steht der gewertete Rahmen selbst noch im Vokal? Im nachlaufenden Fenster ist der neueste Rahmen
     der Rand: im Interdezilbereich zählt seine Abweichung bei sieben Rahmen nur mit 0,4. Ein
     beginnender Vokalwechsel blieb so „stabil /a/“ und gewertet — mit einem schrumpfenden Cluster,
     das wie Fortschritt aussah. Zwei Bänder, beide müssen halten:
     1. Fenstermedian ± max(halbe Streuungsgrenze, 4,5 %). Die halbe Grenze ist das Band, das das
        Fenster selbst einhalten muss. Vibrato ±50 Cent schiebt jeden Teilton um ±2,9 %, ein am
        Teilton hängender Formantwert wandert mit — an stehenden Vokalen 85–250 Hz (SNR 30–60 dB)
        gemessen bis 3,5 % auf F2 (/i/: über 60 Hz) und bis 4,0 % auf F1 (/a/ bei 250 Hz).
     2. Spanne dessen, was der Vokal von t − refS bis t − refLagS gezeigt hat, ± refMarginHz. Die
        jüngsten 0,1 s fehlen, weil diese Rahmen ihr Analysefenster (bis 0,14 s) mit dem geprüften
        teilen und einen beginnenden Wechsel schon mittragen. Die Spanne enthält das Vibrato des
        Takes selbst; gemessen überschritt ein stehender Rahmen sie um höchstens 17 Hz (auch bei
        unregelmäßigem Vibrato und ±1–2 % Formantmitbewegung). Das Band fängt den Wechsel früh, wo
        Band 1 zu weit ist, und hält bei kurzem Fenster, dessen Median langsamen Wechseln folgt. Es
        gilt erst, wenn der Bezug 0,4 s überdeckt (Vokalanfang, nach einer Pause).
     Ohne eigenes F1/F2 lässt sich das nicht prüfen, dann keine Wertung. */
  function frameLeaves(e, r, hist, opts) {
    if (!isFinite(e.F1) || !isFinite(e.F2)) return 'F1/F2 dieses Rahmens fehlt';
    var t1 = Math.max(opts.frameTolShare * opts.sdF1Max, opts.frameVibRel * r.F1med);
    var t2 = Math.max(opts.frameTolShare * opts.sdF2Max, opts.frameVibRel * r.F2med);
    if (!(Math.abs(e.F1 - r.F1med) <= t1)) return 'Rahmen verlässt den Vokal (F1 ' + Math.round(e.F1) + ' Hz, Fenster ' + Math.round(r.F1med) + ' ± ' + Math.round(t1) + ')';
    if (!(Math.abs(e.F2 - r.F2med) <= t2)) return 'Rahmen verlässt den Vokal (F2 ' + Math.round(e.F2) + ' Hz, Fenster ' + Math.round(r.F2med) + ' ± ' + Math.round(t2) + ')';
    var lo1 = Infinity, hi1 = -Infinity, lo2 = Infinity, hi2 = -Infinity, ta = Infinity, tb = -Infinity, i, x, m = opts.refMarginHz;
    for (i = 0; i < hist.length; i++) {
      x = hist[i];
      if (!x.ok || x.t > e.t - opts.refLagS || x.t < e.t - opts.refS) continue;
      if (x.F1 < lo1) lo1 = x.F1; if (x.F1 > hi1) hi1 = x.F1;
      if (x.F2 < lo2) lo2 = x.F2; if (x.F2 > hi2) hi2 = x.F2;
      if (x.t < ta) ta = x.t; if (x.t > tb) tb = x.t;
    }
    if (!(tb - ta >= opts.refMinSpanS)) return '';
    if (e.F1 < lo1 - m || e.F1 > hi1 + m) return 'Rahmen verlässt den Vokal (F1 ' + Math.round(e.F1) + ' Hz, zuvor ' + Math.round(lo1) + '–' + Math.round(hi1) + ' ± ' + m + ')';
    if (e.F2 < lo2 - m || e.F2 > hi2 + m) return 'Rahmen verlässt den Vokal (F2 ' + Math.round(e.F2) + ' Hz, zuvor ' + Math.round(lo2) + '–' + Math.round(hi2) + ' ± ' + m + ')';
    return '';
  }
  function mergeOpts(o) {
    var opts = {};
    for (var k in DEFAULTS) opts[k] = (o && o[k] != null) ? o[k] : DEFAULTS[k];
    opts.centroids = (o && o.centroids) || CENTROIDS;
    return opts;
  }

  /* LIVE: nachlaufendes Fenster [t − windowS, t] mit Hysterese beim Klassenwechsel (holdS).
     update(frame) mit frame = { t, voiced, F1, F2, F3, valid1, valid2, d34, d34valid } liefert
     { state, cls, score, reason, F1med, F2med }. score = ΔF3–4 nur im Zustand stabil, nur bei
     gültigem F3/F4, nur bei F3 ≥ f3MinHz und nur, wenn der Rahmen selbst noch im Vokal steht. */
  function createGate(o) {
    var opts = mergeOpts(o), ring = [], hist = [], curCls = null, candCls = null, candSince = NaN;
    function reset() { ring = []; hist = []; curCls = null; candCls = null; candSince = NaN; }
    function update(fr) {
      var e = entry(fr, opts.centroids);
      ring.push(e); hist.push(e);
      while (ring.length && ring[0].t < fr.t - opts.windowS) ring.shift();
      while (hist.length && hist[0].t < fr.t - Math.max(opts.windowS, opts.refS)) hist.shift();
      var r = evaluateWindow(ring, opts);
      if (r.state === 'pause') { curCls = null; candCls = null; return r; }
      if (r.state === 'uebergang') { r.cls = curCls; return r; }
      // Kandidat verfällt, sobald das Fenster wieder die alte Klasse meldet. Sonst wäre die
      // Haltezeit beim nächsten Wechsel längst abgelaufen und die Umschaltung erfolgte sofort.
      if (r.cls === curCls) { candCls = null; candSince = NaN; }
      if (r.cls !== curCls) {
        if (candCls !== r.cls) { candCls = r.cls; candSince = fr.t; }
        if (fr.t - candSince < opts.holdS) return res('uebergang', curCls, NaN, 'Übergang → /' + r.cls + '/', r.F1med, r.F2med);
        curCls = r.cls; candCls = null;
      }
      var sc = scoreFor(e, opts);
      var weg = isFinite(sc.score) ? frameLeaves(e, r, hist, opts) : '';
      if (weg) sc = { score: NaN, reason: weg };
      var out = res('stabil', curCls, sc.score, sc.reason, r.F1med, r.F2med);
      // Liegt die Fensterklasse dicht an der Grenze zur Nachbarklasse, ist die Zuordnung eine
      // Entscheidung, keine Messung — dann gehört das neben den Wert.
      var cw = classify(r.F1med, r.F2med, opts.centroids);
      out.ambiguous = cw.ambiguous; out.second = cw.second; out.margin = cw.margin;
      if (cw.ambiguous && !out.reason) out.reason = 'Vokal dicht an /' + cw.second + '/';
      return out;
    }
    return { update: update, reset: reset, opts: opts };
  }

  /* OFFLINE: zentriertes Fenster [t − windowS/2, t + windowS/2], keine Hysterese — die Aufnahme
     liegt vollständig vor, also darf jeder Rahmen mit Blick nach vorn und zurück beurteilt werden.
     frames: Array wie bei update(). Liefert ein Array gleicher Länge mit { state, cls, score, reason }. */
  function gateOffline(frames, o) {
    var opts = mergeOpts(o), n = frames.length, es = new Array(n), out = new Array(n), lo = 0, hi = 0, i;
    for (i = 0; i < n; i++) es[i] = entry(frames[i], opts.centroids);
    var half = opts.windowS / 2;
    for (i = 0; i < n; i++) {
      while (lo < n && es[lo].t < es[i].t - half) lo++;
      while (hi < n && es[hi].t <= es[i].t + half) hi++;
      var r = evaluateWindow(es.slice(lo, hi), opts);
      if (r.state === 'stabil') {
        var sc = scoreFor(es[i], opts); r.score = sc.score; r.reason = sc.reason;
        var cw = classify(r.F1med, r.F2med, opts.centroids);
        r.ambiguous = cw.ambiguous; r.second = cw.second; r.margin = cw.margin;
      }
      out[i] = r;
    }
    return out;
  }

  var api = { CENTROIDS: CENTROIDS, CLASS_INDEX: CLASS_INDEX, DEFAULTS: DEFAULTS, classify: classify, createGate: createGate, gateOffline: gateOffline, evaluateWindow: evaluateWindow, idr: idr, TOL_F1: TOL_F1, TOL_F2: TOL_F2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VAREVOWEL = api;
})(typeof self !== 'undefined' ? self : this);

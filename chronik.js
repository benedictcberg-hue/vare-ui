/* VARE — Chronik: Liste, Referenzen, Detailansicht mit Zeitspuren (nur Browser).
   Zeichnet auf Canvas. Ungültige Messwerte werden hohl in Rost gezeichnet, nie geglättet. */
(function (root) {
  'use strict';
  var D = root.VAREDSP, V = root.VAREVOWEL, A = root.VAREANALYSIS;
  /* Die Marken auf der ΔF3–4-Spur sind persönliche Bestwerte und stehen deshalb nicht im Code.
     app.js setzt sie, sobald korpus.json aus dem privaten Repo gelesen ist. */
  var MARKEN = [];
  function setMarken(liste) { MARKEN = (liste || []).filter(function (m) { return m && isFinite(m.hz); }); }

  var COL = { bg: '#0C1410', panel: '#14201A', line: '#24352C', ink: '#E8EDE7', muted: '#8FA396', gold: '#C9A227', rust: '#A85A3C' };
  var MONO = '12px Consolas, "Cascadia Mono", "DejaVu Sans Mono", monospace';

  /* Gemessen heißt: eine endliche Zahl. null ist keine 0 — isFinite(null) ist wahr, und eine ältere
     Sicherung (Version 1) trägt jeden nicht gemessenen Wert als null (Bericht 4, Befund 5). */
  function zahl(v) { return typeof v === 'number' && isFinite(v); }
  function fmt(v, dec) { if (v == null || !isFinite(v)) return '–'; var s = v.toFixed(dec == null ? 0 : dec); return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateShort(iso) { var d = new Date(iso); if (isNaN(d.getTime())) return iso || ''; return d.getDate() + '.' + (d.getMonth() + 1) + '. ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function setupCanvas(cv, cssH) {
    var dpr = root.devicePixelRatio || 1, w = cv.clientWidth || 600;
    cv.width = Math.round(w * dpr); cv.height = Math.round(cssH * dpr); cv.style.height = cssH + 'px';
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, cssH);
    return { ctx: ctx, w: w, h: cssH };
  }
  function statRange(s) { return s && zahl(s.med) ? fmt(s.med) + ' [' + fmt(s.q1) + '–' + fmt(s.q3) + ']' : '–'; }
  function statRangeShare(summary, s) {
    if (!s || !zahl(s.med)) return '–';
    var sh = validShareOf(summary, s);
    return statRange(s) + ' · gültig in ' + fmt(sh * 100) + ' %';
  }

  /* F1–F5: Median als Punkt, Quartilspanne als Balken, 0–4500 Hz, Sängerformantband hinterlegt. */
  /* Anteil der stimmhaften Rahmen, in denen dieser Formant überhaupt gültig war. Ohne ihn sah ein
     Formant, der nur in 12 % der Rahmen auflösbar war, stabiler aus als einer mit 99 % — die
     Ungültigkeit fällt aus Median und Quartilen vollständig heraus. */
  function validShareOf(summary, st) {
    if (st && st.share != null) return st.share;
    var v = (summary && summary.voicedShare && summary.nFrames) ? Math.round(summary.voicedShare * summary.nFrames) : 0;
    return (v && st) ? st.n / v : 1;
  }
  function drawFormantBars(cv, summary, cssH) {
    var c = setupCanvas(cv, cssH || 28), ctx = c.ctx, w = c.w, h = c.h, fmax = 4500;
    var x = function (f) { return f / fmax * w; };
    ctx.fillStyle = 'rgba(201,162,39,0.12)'; ctx.fillRect(x(2400), 0, x(3200) - x(2400), h);
    for (var k = 0; k < 5; k++) {
      var s = summary && summary.F && summary.F[k];
      if (!s || !zahl(s.med)) continue;
      var weak = s.n < 10 || validShareOf(summary, s) < 0.5;
      if (weak) { ctx.strokeStyle = COL.rust; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.strokeRect(x(s.q1), h / 2 - 4, Math.max(2, x(s.q3) - x(s.q1)), 8); ctx.setLineDash([]); }
      else { ctx.fillStyle = COL.line; ctx.fillRect(x(s.q1), h / 2 - 4, Math.max(2, x(s.q3) - x(s.q1)), 8); }
      ctx.beginPath(); ctx.arc(x(s.med), h / 2, 4, 0, 2 * Math.PI);
      if (weak) { ctx.strokeStyle = COL.rust; ctx.lineWidth = 1.5; ctx.stroke(); } else { ctx.fillStyle = COL.gold; ctx.fill(); }
    }
  }

  /* Drei Zustände wie live (app.js, setStat): Rost heißt „Messwert trägt nicht“ oder „fehlt“. Ein
     sicher gemessener Befund — F3 unter dem Mindestwert, SHR über der Warnschwelle, gehaltene
     Tonsprünge — steht in Gold ohne Strich (Klasse befund). Sonst hieße dieselbe Farbe zweierlei
     (Bericht 3, Befund 7). */
  var SHR_WARN_DB = -15;   // Warnschwelle aus der Spezifikation
  // Der F3-Mindestwert, mit dem DIESER Take gerechnet wurde, nicht der heutige Regler; null, wenn nicht gespeichert.
  function f3Schwelle(take) { var g = take && take.analysis && take.analysis.gate; return (g && zahl(g.f3MinHz)) ? g.f3MinHz : null; }
  // F3 der stabilen Rahmen liegt sicher gemessen unter dem Mindestwert des Takes: { f3, schwelle } oder null.
  function f3Unter(take) {
    var f = take && take.summary && take.summary.f3stable, thr = f3Schwelle(take);
    return (f && f.n > 0 && zahl(f.med) && thr != null && f.med < thr) ? { f3: f.med, schwelle: thr } : null;
  }
  function shrBefund(s) { return !!(s && s.shr && zahl(s.shr.max) && s.shr.max > SHR_WARN_DB); }

  function renderRefs(el, refs, handlers) {
    var keys = Object.keys(refs || {}).sort();
    if (!keys.length) { el.innerHTML = '<p class="muted small">Noch keine Referenz — die erste stabile Aufnahme mit gültigem ΔF3–4 (F3 ≥ Mindestwert) setzt sie je Vokal.</p>'; return; }
    var h = '<table><thead><tr><th>Vokal</th><th class="num">ΔF3–4 (Hz)</th><th>Take</th><th>Stelle</th><th></th></tr></thead><tbody>';
    keys.forEach(function (k) {
      var r = refs[k];
      h += '<tr><td class="mono">/' + esc(k) + '/</td><td class="num">' + fmt(r.d34) + '</td><td>' + esc(r.code || '') + ' · ' + esc(dateShort(r.date)) + (r.pinned ? ' <span class="tag gold">angepinnt</span>' : '') + '</td><td class="mono small">' + fmt(r.startS, 1) + ' s, ' + fmt(r.lenS, 1) + ' s</td><td>' +
        (r.pinned ? '<button data-act="unpin" data-cls="' + esc(k) + '">Lösen</button>' : '') + '</td></tr>';
    });
    el.innerHTML = h + '</tbody></table>';
    el.querySelectorAll('button[data-act="unpin"]').forEach(function (b) { b.addEventListener('click', function () { handlers.unpinRef(b.getAttribute('data-cls')); }); });
  }

  function renderList(el, takes, audioIds, handlers) {
    if (!takes.length) { el.innerHTML = '<p class="muted">Noch keine Takes. Aufnahme → Mikrofon starten → Kalibrieren → Take starten.</p>'; return; }
    var h = '<table><thead><tr><th>Take</th><th>Vokal<br><span class="small">Absicht / gemessen</span></th><th class="num">F0</th><th class="spalte-breit">F1–F5 Median, Quartile</th><th class="num">ΔF3–4 stabil</th><th class="num">F3 stabil</th><th class="num">SFR</th><th class="num">SHR max</th><th class="num">gültig</th><th>Kern</th><th></th></tr></thead><tbody>';
    takes.forEach(function (t) {
      var s = t.summary || {}, old = t.analysis && t.analysis.kernelVersion !== D.VERSION, thr = f3Schwelle(t), f3u = f3Unter(t);
      h += '<tr data-id="' + esc(t.id) + '">' +
        '<td><a href="#/take/' + esc(t.id) + '"><strong>' + esc(t.code) + '</strong> ' + esc(t.label) + '</a><br><span class="small muted">' + esc(dateShort(t.createdAt)) + ' · ' + fmt(t.durationS, 1) + ' s</span></td>' +
        '<td class="mono">' + esc(t.vowelIntent || '–') + ' / ' + esc(s.vowel && s.vowel.dominant || '–') + '</td>' +
        '<td class="num">' + (s.f0 ? fmt(s.f0.med) + ' ' + esc(s.f0.note) : '–') + '</td>' +
        '<td><canvas class="bars" height="28"></canvas></td>' +
        '<td class="num">' + (s.d34stable && s.d34stable.n ? statRange(s.d34stable) : (f3u ? '<span class="muted" title="nicht gewertet: F3 stabil unter dem Mindestwert dieses Takes">–</span>' : '<span class="rust">–</span>')) + '</td>' +
        '<td class="num">' + (s.f3stable && s.f3stable.n ? (f3u ? '<span class="befund" title="unter dem F3-Mindestwert ' + fmt(thr) + ' Hz dieses Takes, ΔF3–4 dort nicht gewertet">' : (thr == null ? '<span title="F3-Mindestwert dieses Takes nicht gespeichert">' : '<span>')) + fmt(s.f3stable.med) + '</span>' : '–') + '</td>' +
        '<td class="num">' + (s.sfr ? fmt(s.sfr.med, 1) : '–') + '</td>' +
        '<td class="num">' + (s.shr ? (shrBefund(s) ? '<span class="befund" title="über der Warnschwelle ' + String(SHR_WARN_DB).replace('-', '−') + ' dB">' : '<span>') + fmt(s.shr.max, 1) + '</span>' : '–') + '</td>' +
        '<td class="num">' + fmt((s.validShare || 0) * 100) + ' %</td>' +
        '<td class="small">' + esc(t.analysis && t.analysis.kernelVersion || '?') + (old ? ' <span class="tag rust">alt</span>' : '') + '</td>' +
        '<td class="actions"><button data-act="csv">CSV</button>' + (audioIds[t.id] ? '<button data-act="wav">WAV</button><button data-act="re">Neu analysieren</button>' : '') + '<button data-act="del" class="danger">Löschen</button></td></tr>';
    });
    el.innerHTML = h + '</tbody></table>';
    el.querySelectorAll('tr[data-id]').forEach(function (tr) {
      var id = tr.getAttribute('data-id'), take = takes.filter(function (t) { return t.id === id; })[0];
      drawFormantBars(tr.querySelector('canvas.bars'), take.summary, 28);
      tr.querySelectorAll('button[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          var act = b.getAttribute('data-act');
          if (act === 'csv') handlers.rowCsv(take); else if (act === 'wav') handlers.downloadWav(take); else if (act === 're') handlers.reanalyse(take); else if (act === 'del') handlers.remove(take);
        });
      });
    });
  }

  /* Vier Spuren: F0 · F1–F5 · ΔF3–4 mit Gatterzustand und Referenz · Vokal-/Gültigkeitsstreifen. */
  function drawLanes(cv, series, refs, hoverIdx) {
    var n = series.t.length, T = n ? series.t[n - 1] : 1, c = setupCanvas(cv, 420), ctx = c.ctx, w = c.w;
    var L = 46, R = 70, pw = w - L - R, lanes = [[10, 90], [110, 250], [270, 370], [385, 415]];
    var xt = function (t) { return L + t / Math.max(T, 0.001) * pw; };
    function axis(lane, label, ymin, ymax, ticks) {
      ctx.strokeStyle = COL.line; ctx.strokeRect(L, lane[0], pw, lane[1] - lane[0]);
      ctx.fillStyle = COL.muted; ctx.font = MONO; ctx.textAlign = 'left'; ctx.fillText(label, L + 4, lane[0] + 12);
      ctx.textAlign = 'right';
      ticks.forEach(function (v) { var y = lane[1] - (v - ymin) / (ymax - ymin) * (lane[1] - lane[0]); ctx.fillText(String(v), L - 4, y + 4); ctx.strokeStyle = COL.line; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); });
      return function (v) { return lane[1] - (v - ymin) / (ymax - ymin) * (lane[1] - lane[0]); };
    }
    var i, x, y;
    // Spur 1: F0
    var y0 = axis(lanes[0], 'F0 Hz', 60, 500, [100, 200, 300, 400]);
    for (i = 0; i < n; i++) {
      if (!(series.flags[i] & A.FLAG.VOICED)) continue;
      x = xt(series.t[i]); y = y0(Math.max(60, Math.min(500, series.f0[i])));
      ctx.fillStyle = (series.flags[i] & A.FLAG.OCTAVE) ? COL.rust : COL.ink; ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    // Spur 2: Formanten
    var y1 = axis(lanes[1], 'F1–F5 Hz', 0, 5000, [1000, 2000, 3000, 4000]);
    ctx.fillStyle = 'rgba(201,162,39,0.10)'; ctx.fillRect(L, y1(3200), pw, y1(2400) - y1(3200));
    for (i = 0; i < n; i++) {
      if (!(series.flags[i] & A.FLAG.VOICED)) continue;
      x = xt(series.t[i]);
      for (var k = 1; k <= 5; k++) {
        var f = series['f' + k][i];
        if (!isFinite(f)) continue;
        y = y1(Math.min(5000, f));
        if (series.valid[i] & (1 << (k - 1))) { ctx.fillStyle = COL.gold; ctx.fillRect(x - 1, y - 1, 2, 2); }
        else { ctx.strokeStyle = COL.rust; ctx.lineWidth = 1; ctx.strokeRect(x - 1.5, y - 1.5, 3, 3); }
      }
    }
    // Spur 3: ΔF3–4
    var y2 = axis(lanes[2], 'ΔF3–4 Hz', 0, 1600, [500, 1000, 1500]);
    for (i = 0; i < n; i++) {
      var g = series.gate[i];
      if (g === 0) continue;
      x = xt(series.t[i]);
      ctx.fillStyle = g === 2 ? 'rgba(201,162,39,0.10)' : 'rgba(168,90,60,0.12)';
      ctx.fillRect(x - pw / n / 2, lanes[2][0], Math.max(1, pw / n + 0.5), lanes[2][1] - lanes[2][0]);
    }
    // Marken kommen aus dem privaten Korpus, nicht aus dem Code — siehe setMarken.
    MARKEN.forEach(function (m) { ctx.strokeStyle = COL.line; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(L, y2(m.hz)); ctx.lineTo(L + pw, y2(m.hz)); ctx.stroke(); ctx.setLineDash([]); });
    var shown = {};
    for (i = 0; i < n; i++) if (series.cls[i] >= 0) shown[V.CENTROIDS[series.cls[i]].cls] = true;
    ctx.textAlign = 'left'; ctx.font = MONO;
    Object.keys(shown).forEach(function (cls) {
      var r = refs && refs[cls]; if (!r || !zahl(r.d34)) return;
      ctx.strokeStyle = COL.gold; ctx.setLineDash([6, 3]); ctx.beginPath(); ctx.moveTo(L, y2(r.d34)); ctx.lineTo(L + pw, y2(r.d34)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = COL.gold; ctx.fillText('/' + cls + '/ ' + fmt(r.d34), L + pw + 4, y2(r.d34) + 4);
    });
    for (i = 0; i < n; i++) {
      x = xt(series.t[i]);
      if ((series.flags[i] & A.FLAG.D34VALID) && isFinite(series.d34[i])) { ctx.fillStyle = COL.muted; ctx.fillRect(x - 1, y2(Math.min(1600, Math.max(0, series.d34[i]))) - 1, 2, 2); }
      if (isFinite(series.score[i])) { ctx.fillStyle = COL.gold; ctx.fillRect(x - 1.5, y2(Math.min(1600, series.score[i])) - 1.5, 3, 3); }
    }
    // Spur 4: Vokalstreifen
    ctx.strokeStyle = COL.line; ctx.strokeRect(L, lanes[3][0], pw, lanes[3][1] - lanes[3][0]);
    var runStart = 0;
    for (i = 1; i <= n; i++) {
      var same = i < n && series.gate[i] === series.gate[runStart] && series.cls[i] === series.cls[runStart];
      if (same) continue;
      var g0 = series.gate[runStart], xa = xt(series.t[runStart]), xb = xt(series.t[i - 1]) + 1;
      ctx.fillStyle = g0 === 2 ? COL.gold : (g0 === 1 ? COL.rust : COL.line);
      ctx.fillRect(xa, lanes[3][0] + 6, Math.max(1, xb - xa), lanes[3][1] - lanes[3][0] - 12);
      if (g0 === 2 && series.cls[runStart] >= 0 && xb - xa > 14) { ctx.fillStyle = COL.bg; ctx.font = MONO; ctx.textAlign = 'center'; ctx.fillText(V.CENTROIDS[series.cls[runStart]].cls, (xa + xb) / 2, lanes[3][1] - 10); }
      runStart = i;
    }
    ctx.fillStyle = COL.muted; ctx.font = MONO; ctx.textAlign = 'left'; ctx.fillText('Gold = stabil, Rost = Übergang, grau = Pause', L + 4, lanes[3][0] - 2);
    // Zeitachse
    ctx.textAlign = 'center';
    for (var s = 0; s <= T; s += (T > 30 ? 10 : (T > 10 ? 5 : 1))) { ctx.fillText(s + ' s', xt(s), 419); }
    if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < n) { x = xt(series.t[hoverIdx]); ctx.strokeStyle = COL.ink; ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, 415); ctx.stroke(); }
    return { L: L, pw: pw, T: T };
  }

  function hoverText(series, i) {
    var v = function (col, dec) { return fmt(series[col][i], dec); }, valid = function (k) { return (series.valid[i] & (1 << k)) ? '' : '?'; };
    return 't ' + v('t', 2) + ' s · ' + ['Pause', 'Übergang', 'stabil'][series.gate[i]] + (series.cls[i] >= 0 ? ' /' + V.CENTROIDS[series.cls[i]].cls + '/' : '') +
      ' · F0 ' + v('f0', 1) + ((series.flags[i] & A.FLAG.OCTAVE) ? ' (Oktave korrigiert)' : '') +
      ' · F1 ' + v('f1') + valid(0) + ' F2 ' + v('f2') + valid(1) + ' F3 ' + v('f3') + valid(2) + ' F4 ' + v('f4') + valid(3) + ' F5 ' + v('f5') + valid(4) +
      ' · ΔF3–4 ' + v('d34') + (isFinite(series.score[i]) ? ' (gewertet)' : '') + (series.slotUnsure && series.slotUnsure[i] ? ' [Zuordnung unsicher, ' + (series.nPeaks ? series.nPeaks[i] : '?') + ' Resonanzen]' : '') + ' · SFR ' + v('sfr', 1) + ' · SHR ' + v('shr', 1) + ' · CPP ' + v('cpp', 1) + ' · H1−H2 ' + v('h1h2', 1) + ((series.flags[i] & A.FLAG.H1H2UNSURE) ? ' (filtergetrieben)' : '') + ' · ' + v('rms', 1) + ' dBFS';
  }

  function summaryGrid(s, take) {
    function cell(k, v, unsure, befund) { return '<div class="stat' + (unsure ? ' unsure' : (befund ? ' befund' : '')) + '"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }
    var thr = f3Schwelle(take), f3u = f3Unter(take);
    // Schlüssel und Zahlen aus einer importierten Sicherung sind Fremddaten: maskieren bzw. durch
    // fmt() schicken, sonst landet beliebiges HTML in der Detailansicht.
    var per = s.perVowel || {}, perTxt = Object.keys(per).map(function (k) { return '/' + esc(k) + '/ ' + (per[k].bestSegment ? fmt(per[k].bestSegment.d34Med) : '–'); }).join(' · ') || '–';
    return '<div class="grid">' +
      cell('Dauer · Rahmen', fmt(take.durationS, 1) + ' s · ' + fmt(s.nFrames)) +
      cell('stimmhaft · gültig · stabil', fmt(s.voicedShare * 100) + ' · ' + fmt(s.validShare * 100) + ' · ' + fmt(s.stableShare * 100) + ' %') +
      cell('F0 Median [q1–q3]', statRange(s.f0) + ' ' + esc(s.f0 && s.f0.note || '')) +
      cell('F1', statRangeShare(s, s.F && s.F[0]), s.F && s.F[0] && validShareOf(s, s.F[0]) < 0.5) + cell('F2', statRangeShare(s, s.F && s.F[1]), s.F && s.F[1] && validShareOf(s, s.F[1]) < 0.5) + cell('F3', statRangeShare(s, s.F && s.F[2]), s.F && s.F[2] && validShareOf(s, s.F[2]) < 0.5) + cell('F4', statRangeShare(s, s.F && s.F[3]), s.F && s.F[3] && validShareOf(s, s.F[3]) < 0.5) + cell('F5', statRangeShare(s, s.F && s.F[4]), s.F && s.F[4] && validShareOf(s, s.F[4]) < 0.5) +
      cell('ΔF3–4 alle gültigen', statRange(s.d34)) +
      // Keine Wertung, weil F3 sicher unter dem Mindestwert liegt, ist ein Befund, kein unsicherer Wert.
      ((s.d34stable && s.d34stable.n) ? cell('ΔF3–4 stabil, F3 ≥ ' + (thr != null ? fmt(thr) + ' Hz' : 'Minimum'), statRange(s.d34stable) + ' n=' + fmt(s.d34stable.n))
        : f3u ? cell('ΔF3–4 stabil, F3 ≥ ' + fmt(thr) + ' Hz', 'nicht gewertet: F3 stabil im Median ' + fmt(f3u.f3) + ' Hz, unter dem Mindestwert ' + fmt(f3u.schwelle) + ' Hz dieses Takes', false, true)
        : cell('ΔF3–4 stabil, F3 ≥ ' + (thr != null ? fmt(thr) + ' Hz' : 'Minimum'), '<span class="rust">keine gewerteten Rahmen</span>')) +
      cell('Bestes Segment je Vokal', perTxt) + cell('ΔF4–5', statRange(s.d45)) +
      cell('SFR dB', statRange(s.sfr)) + cell('SHR dB (Median / max)', (s.shr ? fmt(s.shr.med, 1) + ' / ' + fmt(s.shr.max, 1) : '–'), false, shrBefund(s)) +
      cell('CPP dB (eigene Skala)', statRange(s.cpp)) + cell('H1−H2 · H1*−H2*', fmt(s.h1h2 && s.h1h2.med, 1) + ' · ' + fmt(s.h1h2c && s.h1h2c.med, 1) + ' (' + fmt((s.h1h2 && s.h1h2.unsureShare || 0) * 100) + ' % filtergetrieben)', s.h1h2 && s.h1h2.unsureShare > 0.5) +
      cell('Pegel dBFS (Median / max)', fmt(s.rms && s.rms.med, 1) + ' / ' + fmt(s.rms && s.rms.max, 1)) + cell('Rauschboden · SNR', fmt(s.floorDb, 1) + ' dBFS (' + esc(s.floorSource === 'calibration' ? 'kalibriert' : (s.floorSource === 'unknown' ? 'unbekannt, keine Stille im Take' : 'geschätzt')) + ') · ' + (zahl(s.snrDb) ? fmt(s.snrDb, 1) + ' dB' : 'nicht messbar') + '', s.floorSource !== 'calibration') +
      cell('Rohrlänge (Modell)', (s.tube && s.tube.n >= 20 ? fmt(s.tubeCm, 1) + ' cm [' + fmt(s.tube.q1, 1) + '–' + fmt(s.tube.q3, 1) + ']' : '– (zu wenige Rahmen mit vier gültigen Formanten)'), !(s.tube && s.tube.n >= 20)) +
      cell('Oktave korrigiert · unsicher', fmt((s.octaveCorrectedShare || 0) * 100) + ' · ' + fmt((s.octaveAmbiguousShare || 0) * 100) + ' %', s.octaveCorrectedShare > 0.05 || s.octaveAmbiguousShare > 0.2) +
      cell('Slot-Zuordnung unsicher', fmt((s.slotUnsureShare || 0) * 100) + ' % der Rahmen', s.slotUnsureShare > 0.2) +
      /* Gezählt wird nur Weite und Dauer. Ein legato gesungener Melodiesprung erfüllt dieselbe
         Bedingung wie ein Registerbruch; ob es einer ist, zeigt erst ein Qualitätseinbruch am
         Übergang. Deshalb neutrale Namen, nicht „Registerwechsel“. */
      cell('Tonsprünge ≥ 5 HT, gehalten ≥ 90 ms', s.spruenge ? fmt(s.spruenge.gehalten) + ' (λ ' + fmt(s.spruenge.lambdaGehalten, 3) + ' /s)' : '– (ältere Auswertung)', false, !!(s.spruenge && s.spruenge.gehalten > 0)) +
      cell('kurze Kanten unter 90 ms', s.spruenge ? fmt(s.spruenge.kante) + ' (λ ' + fmt(s.spruenge.lambdaKante, 3) + ' /s)' : '– (ältere Auswertung)') +
      '</div>';
  }

  /* Schritt 0 aus dem Manual, als Zeile: Wanduhrzeit, Stelle in der Sitzung, Pause davor,
     Einsing-Status. Was nicht angegeben wurde, steht als Fehlt da und wird nicht beschönigt. */
  var WARMUP_TEXT = { kalt: 'kalt, nicht eingesungen', kurz: 'kurz eingesungen', voll: 'voll eingesungen', nachpause: 'nach Pause wieder angewärmt' };
  /* Zahlen aus einer importierten Sicherung sind Fremddaten: ein Text an der Stelle einer
     Zahl darf die Seite nicht abwerfen und nicht ungeprüft ins HTML. */
  function num(v) { if (v == null || v === '' || typeof v === 'boolean') return null; var n = Number(v); return isFinite(n) ? n : null; }
  function dauerText(sek) {
    sek = num(sek);
    if (sek == null) return null;
    if (sek < 90) return Math.round(sek) + ' s';
    if (sek < 5400) return Math.round(sek / 60) + ' min';
    return (sek / 3600).toFixed(1) + ' h';
  }
  function kontextZeile(take) {
    var si = take.sitzung || {}, teile = [];
    var tz = num(take.tzOffsetMin), nr = num(si.nr), pos = num(si.position), wmin = num(si.warmupMin);
    teile.push(take.timeLocal ? 'Uhrzeit <span class="mono">' + esc(take.timeLocal) + '</span>'
      + (tz == null ? '' : ' <span class="muted">(UTC' + (tz >= 0 ? '+' : '−') + fmt(Math.abs(tz) / 60, 1) + ')</span>')
      : '<span class="rust">Uhrzeit fehlt</span>');
    teile.push(nr != null && pos != null
      ? 'Sitzung ' + fmt(nr) + ', Take ' + fmt(pos) + ' darin'
      : '<span class="rust">Stelle in der Sitzung fehlt</span>');
    var d = dauerText(si.pauseVorherS);
    teile.push(d ? 'Pause davor ' + d + (si.pauseSelbeSitzung === false ? ' <span class="muted">(über eine Sitzungsgrenze)</span>' : '')
      : (si.pauseVorherS === null && si.id ? 'erster Take' : '<span class="rust">Pause unbekannt</span>'));
    teile.push(si.warmup ? esc(Object.prototype.hasOwnProperty.call(WARMUP_TEXT, si.warmup) ? WARMUP_TEXT[si.warmup] : si.warmup) + (wmin == null ? '' : ', seit ' + fmt(wmin) + ' min')
      : '<span class="rust">Einsing-Status nicht angegeben</span>');
    return teile.join(' · ');
  }

  function renderDetail(el, take, series, refs, hasAudio, handlers) {
    var s = take.summary || {}, old = take.analysis && take.analysis.kernelVersion !== D.VERSION;
    var intents = [''].concat(V.CENTROIDS.map(function (c) { return c.cls; }));
    el.innerHTML = '<div class="panel"><a href="#/chronik">← Chronik</a>' +
      '<h2>' + esc(take.code) + ' <span id="d-label-view">' + esc(take.label) + '</span></h2>' +
      '<div class="small muted">' + esc(dateShort(take.createdAt)) + ' · ' + esc(take.deviceLabel || '') + ' · ' + fmt(take.sampleRate) + ' Hz · Kern ' + esc(take.analysis && take.analysis.kernelVersion || '?') + (old ? ' <span class="tag rust">älterer Kern</span>' : '') + (s.floorSource === 'calibration' ? ' · kalibriert' : ' · <span class="rust">Rauschboden ' + (s.floorSource === 'unknown' ? 'unbekannt' : 'geschätzt') + '</span>') + '</div>' +
      '<div class="small">' + kontextZeile(take) + '</div>' +
      '<div class="row"><label>Bezeichnung <input type="text" id="d-label" value="' + esc(take.label) + '" size="24"></label>' +
      '<label>Vokalabsicht <select id="d-intent">' + intents.map(function (v) { return '<option value="' + esc(v) + '"' + (v === (take.vowelIntent || '') ? ' selected' : '') + '>' + (v ? '/' + esc(v) + '/' : '–') + '</option>'; }).join('') + '</select></label>' +
      '<label>Einsing-Status <select id="d-warmup">' +
        [''].concat(Object.keys(WARMUP_TEXT)).map(function (v) { return '<option value="' + esc(v) + '"' + (v === ((take.sitzung && take.sitzung.warmup) || '') ? ' selected' : '') + '>' + (v ? esc(WARMUP_TEXT[v]) : '– nicht angegeben') + '</option>'; }).join('') +
      '</select></label>' +
      '<label>seit (min) <input type="number" id="d-warmup-min" min="0" max="600" step="1" size="4" value="' + (take.sitzung && take.sitzung.warmupMin != null ? esc(String(take.sitzung.warmupMin)) : '') + '"></label>' +
      '<button id="d-save">Speichern</button></div>' +
      '<label>Kommentar <textarea id="d-comment">' + esc(take.comment || '') + '</textarea></label></div>' +
      '<div class="panel">' + summaryGrid(s, take) + '</div>' +
      '<div class="panel"><canvas id="d-lanes" height="420"></canvas><div id="d-hover" class="mono small muted hover-zeile">Maus über die Spuren bewegen.</div></div>' +
      '<div class="panel actions"><button id="d-frames">Rahmen-CSV</button><button id="d-row">CSV-Zeile</button>' + (hasAudio ? '<button id="d-wav">WAV</button><button id="d-re">Neu analysieren (Kern ' + esc(D.VERSION) + ')</button>' : '<span class="small muted">kein Audio gespeichert — Neu-Analyse nicht möglich</span> ') +
      Object.keys(s.perVowel || {}).map(function (k) { return s.perVowel[k].bestSegment ? '<button data-pin="' + esc(k) + '">Als Referenz für /' + esc(k) + '/ anpinnen</button>' : ''; }).join('') +
      '<button id="d-del" class="danger">Take löschen</button></div>' +
      (take.history && take.history.length ? '<div class="panel small muted">Frühere Auswertungen: ' + take.history.map(function (h) { return esc(h.kernelVersion) + ' (' + esc(dateShort(h.analysedAt)) + ')'; }).join(', ') + '</div>' : '');
    var cv = el.querySelector('#d-lanes'), geo = null, hover = el.querySelector('#d-hover');
    function redraw(idx) { geo = drawLanes(cv, series, refs, idx); }
    if (series) redraw(null); else cv.hidden = true;
    if (series) cv.addEventListener('mousemove', function (ev) {
      var rect = cv.getBoundingClientRect(), t = (ev.clientX - rect.left - geo.L) / geo.pw * geo.T, n = series.t.length;
      var idx = Math.max(0, Math.min(n - 1, Math.round(t / Math.max(geo.T, 1e-6) * (n - 1))));
      hover.textContent = hoverText(series, idx); redraw(idx);
    });
    el.querySelector('#d-save').addEventListener('click', function () {
      var wm = el.querySelector('#d-warmup-min').value.trim(), n = wm === '' ? null : Number(wm);
      handlers.saveEdit(take, {
        label: el.querySelector('#d-label').value.trim(), vowelIntent: el.querySelector('#d-intent').value,
        comment: el.querySelector('#d-comment').value, warmup: el.querySelector('#d-warmup').value,
        warmupMin: (n != null && isFinite(n) && n >= 0) ? n : null
      });
    });
    el.querySelector('#d-frames').addEventListener('click', function () { handlers.frameCsv(take, series); });
    el.querySelector('#d-row').addEventListener('click', function () { handlers.rowCsv(take); });
    if (hasAudio) { el.querySelector('#d-wav').addEventListener('click', function () { handlers.downloadWav(take); }); el.querySelector('#d-re').addEventListener('click', function () { handlers.reanalyse(take); }); }
    el.querySelectorAll('button[data-pin]').forEach(function (b) { b.addEventListener('click', function () { handlers.pinRef(b.getAttribute('data-pin'), take); }); });
    el.querySelector('#d-del').addEventListener('click', function () { handlers.remove(take); });
  }

  root.VARECHRONIK = { setMarken: setMarken, kontextZeile: kontextZeile, WARMUP_TEXT: WARMUP_TEXT, validShareOf: validShareOf, renderRefs: renderRefs, renderList: renderList, renderDetail: renderDetail, drawLanes: drawLanes, drawFormantBars: drawFormantBars, setupCanvas: setupCanvas, zahl: zahl, f3Schwelle: f3Schwelle, f3Unter: f3Unter, shrBefund: shrBefund, fmt: fmt, esc: esc, dateShort: dateShort, COL: COL, MONO: MONO };
})(typeof self !== 'undefined' ? self : this);

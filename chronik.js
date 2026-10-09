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
  /* Note zu einem Grundton, nur zu einem gemessenen: ohne Wert liefert dsp.js hzToNote „--“, ein Text, wo nichts
     gemessen ist. Fehlend heißt hier „–“ wie bei jedem anderen Wert (in der CSV leer). Roh, nicht maskiert. */
  function noteText(hz, note) { return (zahl(hz) && note && note !== '--') ? String(note) : ''; }
  function statRange(s) { return s && zahl(s.med) ? fmt(s.med) + ' [' + fmt(s.q1) + '–' + fmt(s.q3) + ']' : '–'; }
  function statRangeShare(summary, s) {
    if (!s || !zahl(s.med)) return '–';
    return statRange(s) + ' · ' + formantBeleg(summary, s);
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
  /* Schwach belegt: in weniger als der Hälfte der stimmhaften Rahmen gültig oder weniger als 10 gültige Rahmen.
     Eine Regel für Liste, Detail und Take-Ergebnis — vorher zeigte das Ergebnis direkt nach dem Take denselben
     Median ohne Marke, den das Detail in Rost führte (Befund N8). Ein fehlender Formant ist es auch. */
  function formantSchwach(summary, f) { return !f || !(f.n >= 10) || validShareOf(summary, f) < 0.5; }
  // Woraus der Median stammt, als Text: Anteil gültiger Rahmen, bei weniger als 10 auch ihre Zahl.
  function formantBeleg(summary, f) {
    return 'gültig in ' + prozentHtml(validShareOf(summary, f)) + ' %' + (f && zahl(f.n) && f.n > 0 && f.n < 10 ? ', n = ' + fmt(f.n) : '');
  }
  function drawFormantBars(cv, summary, cssH) {
    var c = setupCanvas(cv, cssH || 28), ctx = c.ctx, w = c.w, h = c.h, fmax = 4500;
    var x = function (f) { return f / fmax * w; };
    ctx.fillStyle = 'rgba(201,162,39,0.12)'; ctx.fillRect(x(2400), 0, x(3200) - x(2400), h);
    for (var k = 0; k < 5; k++) {
      var s = summary && summary.F && summary.F[k];
      if (!s || !zahl(s.med)) continue;
      var weak = formantSchwach(summary, s);
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

  /* Grundton und SHR: Was der Rechenkern über einen Wert weiß (dsp.js analyseAt: f0Unsure, f0Grund,
     f0Korrektur, octaveUnterGrenze, shrUnsure, shrGrund), in Worten — live, im Detail und im Hover gleich.
     Ein unsicherer Grundton steht in Rost mit Grund, und mit ihm alles, was aus ihm abgeleitet ist. Ein
     korrigierter Grundton ist sicher (Teilerkontrolle oder Gegenprobe), aber nicht der YIN-Wert: Das
     steht dabei, ohne Rost. Die Texte bestehen aus festen Wörtern und Zahlen. */
  /* Kern 4.1: 'wechsel' = Mischwert zweier Töne am Tonwechsel (Belege: tiefster und höchster Ton der Teilfenster),
     'oktave' = die Reihe bei F0/2 ist teilweise belegt, der Ton kann eine Oktave tiefer liegen. */
  function f0GrundText(grund, f0Cep, lo, hi) {
    if (grund === 'teiltonreihe') return 'eigene Teiltonreihe fehlt, vermutlich ein Unterton';
    if (grund === 'cepstrum') return 'Cepstrum zeigt ' + (zahl(f0Cep) ? fmt(f0Cep, 1) + ' Hz' : 'eine andere Periode');
    if (grund === 'kein cepstrum') return 'keine Gegenprobe möglich';
    if (grund === 'wechsel') return 'Mischwert am Tonwechsel' + (zahl(lo) && zahl(hi) ? ' (Teilfenster ' + fmt(lo) + '–' + fmt(hi) + ' Hz)' : '');
    if (grund === 'oktave') return 'Reihe bei F0/2 teilweise belegt, womöglich eine Oktave tiefer';
    return 'Grund unbekannt';
  }
  function f0KorrText(art, f0Yin) {
    return 'korrigiert aus ' + fmt(f0Yin, 1) + ' Hz, ' + (art === 'teiltonreihe' ? 'Teiltonreihe' : (art === 'cepstrum' ? 'Cepstrum' : 'Art unbekannt'));
  }
  // octaveAmbiguous: die Teilerkontrolle konnte nicht entscheiden; octaveUnterGrenze: sie hätte unter 60 Hz geteilt.
  function oktavText(unterGrenze) {
    return unterGrenze ? 'Reihe unter ' + fmt((D && D.F0_MIN_HZ) || 60) + ' Hz, nicht geteilt — Oktave unsicher' : 'Subharmonische nahe der Schwelle — Oktave unsicher';
  }
  /* Kern 4.1 (Fensterprobe, Zwischenpegel): 'rand' = Ein- oder Aussatz im Fenster (Pegelspanne der 20-ms-Blöcke),
     'wechsel' = Tonwechsel im Fenster (Töne der Teilfenster), 'rauschen' = SHR kaum über dem Pegel zwischen den
     Teiltönen (Hauch): Der Wert ist dann nur eine Obergrenze. b = { pegelDb, f0Lo, f0Hi, boden }, fehlend erlaubt. */
  function shrGrundText(grund, kamm, zweitpuls, b) {
    var t = [], teile = String(grund || '').split('+');
    b = b || {};
    for (var i = 0; i < teile.length; i++) {
      if (teile[i] === 'kamm') t.push('Kamm ' + fmt(kamm, 1) + ' dB');
      else if (teile[i] === 'zweitpuls') t.push('zweite Anregung ' + fmt(zweitpuls, 2));
      else if (teile[i] === 'grundton') t.push('Grundton unsicher');
      else if (teile[i] === 'rand') t.push('Ein- oder Aussatz im Fenster' + (zahl(b.pegelDb) ? ' (Pegelspanne ' + fmt(b.pegelDb) + ' dB)' : ''));
      else if (teile[i] === 'wechsel') t.push('Tonwechsel im Fenster' + (zahl(b.f0Lo) && zahl(b.f0Hi) ? ' (' + fmt(b.f0Lo) + '–' + fmt(b.f0Hi) + ' Hz)' : ''));
      else if (teile[i] === 'rauschen') t.push('kaum über dem Rauschen zwischen den Teiltönen' + (zahl(b.boden) ? ' (' + fmt(b.boden, 1) + ' dB)' : '') + ', nur Obergrenze');
      else if (teile[i]) t.push('Grund unbekannt');
    }
    return t.length ? t.join(', ') : 'Grund unbekannt';
  }
  /* Warum ein Formant nicht gültig ist, in kurzen Worten — live (app.js) und im Hover gleich, damit dieselbe
     Ursache überall gleich heißt. dsp.js analyseAt gibt einen Formanten nur frei mit Wert, in mindestens 3
     Fenstern und 2 Ordnungen, Streuung über Fenster und über Ordnungen unter der Grenze, eindeutiger Nummer
     (slotGrund leer) und Gipfel über dem Rauschboden. Genannt wird jeder zutreffende Grund, nicht nur der
     erste: am tiefen engen Cluster im Rauschen trifft oft „Nummer mehrdeutig“ und „im Rauschboden“ zugleich.
     g = { F, grund ('', 'nummer', 'verschmolzen', '?'), rauschBoden, sdWin, sdOrder, smax, nWin, nOrders };
     null heißt nicht gespeichert. Die Serie kennt nOrders nicht: Unter 2 Werten ist die Streuung NaN, daraus folgt
     „in weniger als 2 Ordnungen“. nWin steht seit B2 in der Serie; ältere Serien kennen es nicht: Dann folgt
     „nur in einem Fenster“ aus der Streuung, und „nur in 2 Fenstern“ ist das, was übrig bleibt, wenn sonst nichts
     die Ungültigkeit erklärt. Ältere Serien kennen rauschBoden und den Unterschied nummer/verschmolzen nicht:
     dann „Grund nicht gespeichert“, kein erfundener. Kern 4.1: 'teilton' = Teiltöne zu weit auseinander, der Gipfel
     sitzt womöglich auf einem Teilton statt auf der Resonanz (g.teiltonHz, A3); 'wechsel' = Vokalwechsel im Fenster. */
  function teiltonText(hz) { return 'Teiltonabstand ' + (zahl(hz) ? fmt(hz) + ' Hz ' : '') + 'zu groß'; }
  function formantGruende(g) {
    if (!zahl(g.F)) return ['nicht gefunden'];
    var t = [], smax = zahl(g.smax) ? g.smax : NaN;
    if (g.grund === 'nummer') t.push('Nummer mehrdeutig');
    else if (g.grund === 'verschmolzen') t.push('zwei Resonanzen in einem Gipfel möglich');
    else if (g.grund === 'teilton') t.push(teiltonText(g.teiltonHz));
    else if (g.grund === 'wechsel') t.push('Vokalwechsel im Fenster');
    else if (g.grund) t.push('Zuordnung unsicher, Grund nicht gespeichert');
    if (g.rauschBoden === true) t.push('im Rauschboden');
    if (zahl(g.sdWin) && g.sdWin >= smax) t.push('Streuung über Fenster ' + fmt(g.sdWin) + ' Hz');
    if (zahl(g.sdOrder) && g.sdOrder >= smax) t.push('Streuung über Ordnungen ' + fmt(g.sdOrder) + ' Hz');
    var nWin = zahl(g.nWin) ? g.nWin : (zahl(g.sdWin) ? null : 1);
    if (nWin === 1) t.push('nur in einem Fenster'); else if (nWin === 2) t.push('nur in 2 Fenstern');
    var nOrd = zahl(g.nOrders) ? g.nOrders : (zahl(g.sdOrder) ? null : 0);
    if (nOrd !== null && nOrd < 2) t.push('in weniger als 2 Ordnungen');
    if (!t.length) {
      var bekannt = g.rauschBoden != null && zahl(smax);
      t.push(g.nWin == null ? (bekannt ? 'nur in 2 Fenstern' : 'Grund nicht gespeichert') : 'Grund unbekannt');
    }
    return t;
  }
  /* LPC-Bandbreiten unter 40 Hz sind Artefakt, keine Messung (physik.md 2.4). Das macht die Frequenz nicht
     ungültig und ist darum kein Grund oben, steht aber neutral dabei: Die Bandbreite geht in H1*−H2* ein. */
  var BW_ARTEFAKT_HZ = (D && D.BW_ARTIFACT_HZ) || 40;
  var BANDBREITE_TEXT = 'Bandbreite unter ' + BW_ARTEFAKT_HZ + ' Hz';
  /* H1*−H2* rechnet mit den Bandbreiten von F1–F3. War eine davon Artefakt, ging sie auf 40 Hz begrenzt ein (physik.md
     7.2). Neutral dabei, wie die Bandbreite am Formanten: die Begrenzung ist die festgelegte Rechenweise; liegt F1
     nahe H1 oder H2, wo die Bandbreite stark wirkt, ist H1−H2 ohnehin als filtergetrieben markiert. */
  var H1C_BW_TEXT = 'H1*−H2* mit ' + BANDBREITE_TEXT + ' gerechnet (auf ' + BW_ARTEFAKT_HZ + ' Hz begrenzt)';
  function h1cBwArtefakt(series, i) {
    var w = function (c) { var a = series[c]; return a ? a[i] : NaN; };
    return zahl(w('h1h2c')) && (w('bw1') < BW_ARTEFAKT_HZ || w('bw2') < BW_ARTEFAKT_HZ || w('bw3') < BW_ARTEFAKT_HZ);
  }
  // Anteil der Rahmen im H1*−H2*-Median, die eine Artefakt-Bandbreite enthielten; ältere Auswertungen kennen ihn nicht.
  function h1cBwZusatz(s) {
    var h = s && s.h1h2c;
    if (!h || !zahl(h.med)) return '';
    if (!Object.prototype.hasOwnProperty.call(h, 'bwArtefaktShare')) return ' <span class="small muted">(ältere Auswertung: Anteil mit Bandbreite unter ' + BW_ARTEFAKT_HZ + ' Hz nicht gespeichert)</span>';
    return zahl(h.bwArtefaktShare) && h.bwArtefaktShare > 0 ? ' · H1*−H2* in ' + prozentHtml(h.bwArtefaktShare) + ' % der Rahmen mit ' + BANDBREITE_TEXT + ' gerechnet (auf ' + BW_ARTEFAKT_HZ + ' Hz begrenzt)' : '';
  }

  // Anteil in Prozent; ein kleiner, aber vorhandener Anteil heißt „< 1“, nicht „0“. Ins HTML nur maskiert.
  function prozent(x) { return (x > 0 && x < 0.01) ? '< 1' : fmt(x * 100); }
  function prozentHtml(x) { return esc(prozent(x)); }
  /* Zusammenfassung: F0 und SHR stammen nur aus sicheren Rahmen (analysis.js summarise). Wie viele
     ausgelassen wurden, steht daneben in Rost; ältere Auswertungen haben diese Trennung nicht. */
  var AELTER = ' <span class="small muted">(ältere Auswertung: unsichere Rahmen nicht getrennt)</span>';
  function f0Zusatz(s) {
    if (!zahl(s.f0UnsureShare)) return AELTER;
    return s.f0UnsureShare > 0 ? ' <span class="rust">· Grundton unsicher in ' + prozentHtml(s.f0UnsureShare) + ' % der Rahmen, nicht im Median</span>' : '';
  }
  function f0Unsicher(s) { return zahl(s.f0UnsureShare) && (s.f0UnsureShare > 0.5 || (s.voicedShare > 0 && !(s.f0 && s.f0.n > 0))); }
  function shrZusatz(s) {
    if (!zahl(s.shrUnsureShare)) return AELTER;
    if (!(s.shrUnsureShare > 0)) return '';
    return ' <span class="rust">· unsicher in ' + prozentHtml(s.shrUnsureShare) + ' %: bis ' + fmt(s.shrUnsureMax, 1) + ' dB' + (zahl(s.shrOtherMax) ? ', anderes Raster bis ' + fmt(s.shrOtherMax, 1) + ' dB' : '') + '</span>';
  }
  function shrUnsicher(s) { return zahl(s.shrUnsureShare) && s.shrUnsureShare > 0.5; }
  /* SFR und CPP: Rahmen mit Rauschanteil im Fenster (Kern 4.1, Grund 'rauschanteil': Konsonant oder Hauch neben dem
     Vokal) stehen nicht im Median; ihr Anteil in Rost daneben. Ältere Auswertungen trennen sie nicht. */
  var RAUSCHANTEIL_TEXT = 'Rauschanteil im Fenster';
  function rauschText(grund) { return grund === 'rauschanteil' ? RAUSCHANTEIL_TEXT : 'Grund unbekannt'; }
  function rauschZusatz(x) {
    if (!zahl(x)) return ' <span class="small muted">(ältere Auswertung: Rahmen mit Rauschanteil nicht getrennt)</span>';
    return x > 0 ? ' <span class="rust">· ' + RAUSCHANTEIL_TEXT + ' in ' + prozentHtml(x) + ' % der Rahmen, nicht im Median</span>' : '';
  }
  /* Teiltonabstand über 250 Hz (Grundton, bei unsicherem 2·F0): ΔF3–4 und ΔF4–5 sind dort nicht messbar, ein Formant
     nur auf etwa ± halben Abstand; über 375 Hz ist kein Formant messbar (dsp.js TEILTON_DIFF_HZ, TEILTON_SLOT_HZ). */
  var TT_DIFF = (D && D.TEILTON_DIFF_HZ) || 250, TT_SLOT = (D && D.TEILTON_SLOT_HZ) || 375;
  function teiltonZusatz(f) {
    return f && zahl(f.teiltonShare) && f.teiltonShare > 0 ? ' <span class="rust">· in ' + prozentHtml(f.teiltonShare) + ' % Teiltonabstand über ' + TT_DIFF + ' Hz: nur auf etwa ± halben Abstand genau</span>' : '';
  }
  function hoheLage(s) {
    if (!zahl(s.teiltonShare) || !(s.teiltonShare > 0)) return '';
    return 'Teiltonabstand über ' + TT_DIFF + ' Hz in ' + prozentHtml(s.teiltonShare) + ' % der Rahmen: ΔF3–4 und ΔF4–5 dort nicht messbar, Formanten nur auf etwa ± halben Abstand genau'
      + (zahl(s.teiltonHochShare) && s.teiltonHochShare > 0 ? ' · über ' + TT_SLOT + ' Hz in ' + prozentHtml(s.teiltonHochShare) + ' %: kein Formant messbar' : '');
  }
  function listeUnsicher(x, was) {
    return (zahl(x) && x > 0) ? ' <span class="rust small" title="' + was + ' in ' + prozentHtml(x) + ' % der stimmhaften Rahmen, nicht im Wert">' + prozentHtml(x) + ' % unsicher</span>' : '';
  }

  /* Anteil zweideutig zugeordneter Rahmen (Vokal nahe der Grenze zum Nachbarn) neben einem
     Bestsegment oder einer Referenz: Die Zahl ist gemessen, ihr Vokal aber teils unsicher. */
  function zweideutigText(share) { return (zahl(share) && share > 0) ? ' <span class="rust small">zweideutig ' + fmt(share * 100) + ' %</span>' : ''; }
  // Takes, die anders gerechnet sind als jetzt eingestellt, zählen nicht als Referenz: { Vokal: Anzahl }.
  function uebergangenText(ueb) {
    var ks = Object.keys(ueb || {}).filter(function (c) { return ueb[c] > 0; }).sort();
    if (!ks.length) return '';
    return 'Nicht als Referenz gezählt, weil anders gerechnet als jetzt eingestellt: ' + ks.map(function (c) { return '/' + esc(c) + '/ ' + fmt(ueb[c]) + (ueb[c] === 1 ? ' Take' : ' Takes'); }).join(', ')
      + '. Nach einer Neu-Analyse mit den jetzigen Einstellungen (nur mit gespeichertem Audio) zählen sie wieder.';
  }
  /* Eine verwaiste Referenz ist angepinnt, lässt sich aus ihrem Take aber nicht mehr auffrischen
     (computeRefs in analysis.js: verwaist, grund, kein d34). Sie bleibt sichtbar, mit Grund, und ist
     keine Zielmarke. Neutral, denn das ist kein Messwert. grund nennt Codes aus Fremddaten: maskieren. */
  function renderRefs(el, refs, handlers, uebergangen) {
    var keys = Object.keys(refs || {}).sort(), ueb = uebergangenText(uebergangen);
    if (!keys.length) { el.innerHTML = '<p class="muted small">' + (ueb ? 'Keine Referenz. ' + ueb : 'Noch keine Referenz — die erste stabile Aufnahme mit gültigem ΔF3–4 (F3 ≥ Mindestwert) setzt sie je Vokal.') + '</p>'; return; }
    var h = '<table><thead><tr><th>Vokal</th><th class="num">ΔF3–4 (Hz)</th><th>Take</th><th>Stelle</th><th></th></tr></thead><tbody>';
    keys.forEach(function (k) {
      var r = refs[k];
      if (!r) return;
      var verwaist = !!r.verwaist;
      h += '<tr><td class="mono">/' + esc(k) + '/</td><td class="num">' + (verwaist ? '–' : fmt(r.d34) + zweideutigText(r.ambiguousShare)) + '</td><td>' + esc(r.code || '') + ' · ' + esc(dateShort(r.date)) + (r.pinned ? ' <span class="tag gold">angepinnt</span>' : '') +
        (verwaist ? '<br><span class="small">verwaist: ' + esc(r.grund || 'Grund nicht angegeben') + (zahl(r.d34Zuletzt) ? ' · zuletzt ' + fmt(r.d34Zuletzt) + ' Hz' : '') + ' — keine Zielmarke</span>' : '') +
        '</td><td class="mono small">' + fmt(r.startS, 1) + ' s, ' + fmt(r.lenS, 1) + ' s</td><td>' +
        (r.pinned ? '<button data-act="unpin" data-cls="' + esc(k) + '">Lösen</button>' : '') + '</td></tr>';
    });
    el.innerHTML = h + '</tbody></table>' + (ueb ? '<p class="small muted">' + ueb + '</p>' : '');
    el.querySelectorAll('button[data-act="unpin"]').forEach(function (b) { b.addEventListener('click', function () { handlers.unpinRef(b.getAttribute('data-cls')); }); });
  }

  /* Zeile unter der Live-Anzeige. Verwaist: kein Wert, keine Differenz, der Grund. uebergangen: Zahl der
     Takes mit diesem Vokal, die anders gerechnet sind — dann setzt nicht „die erste Aufnahme“ sie. */
  function refZeile(cls, ref, score, uebergangen) {
    if (!cls) return '';
    if (ref && ref.verwaist) return 'Referenz /' + cls + '/ verwaist: ' + (ref.grund || 'Grund nicht angegeben') + (zahl(ref.d34Zuletzt) ? ' (zuletzt ' + fmt(ref.d34Zuletzt) + ' Hz)' : '') + ' — keine Zielmarke';
    if (ref && zahl(ref.d34)) return 'Referenz /' + cls + '/: ' + fmt(ref.d34) + ' Hz (' + ref.code + ', ' + dateShort(ref.date) + ')' + (zahl(score) ? ' — live ' + fmt(score) + ' (' + (score - ref.d34 >= 0 ? '+' : '') + fmt(score - ref.d34) + ')' : '');
    return 'keine Referenz für /' + cls + '/ — ' + (uebergangen > 0 ? uebergangen + (uebergangen === 1 ? ' Take ist' : ' Takes sind') + ' anders gerechnet als jetzt eingestellt und ' + (uebergangen === 1 ? 'zählt' : 'zählen') + ' nicht (neu analysieren)' : 'die erste stabile Aufnahme setzt sie');
  }

  function renderList(el, takes, audioIds, handlers) {
    if (!takes.length) { el.innerHTML = '<p class="muted">Noch keine Takes. Aufnahme → Mikrofon starten → Kalibrieren → Take starten.</p>'; return; }
    var h = '<table><thead><tr><th>Take</th><th>Vokal<br><span class="small">Absicht / gemessen</span></th><th class="num">F0</th><th class="spalte-breit">F1–F5 Median, Quartile</th><th class="num">ΔF3–4 stabil</th><th class="num">F3 stabil</th><th class="num">SFR</th><th class="num">SHR max</th><th class="num">gültig</th><th>Kern</th><th></th></tr></thead><tbody>';
    takes.forEach(function (t) {
      var s = t.summary || {}, old = t.analysis && t.analysis.kernelVersion !== D.VERSION, thr = f3Schwelle(t), f3u = f3Unter(t);
      var uv = (handlers && typeof handlers.unvergleichbar === 'function') ? handlers.unvergleichbar(t) : '';
      h += '<tr data-id="' + esc(t.id) + '">' +
        '<td><a href="#/take/' + esc(t.id) + '"><strong>' + esc(t.code) + '</strong> ' + esc(t.label) + '</a><br><span class="small muted">' + esc(dateShort(t.startedAt || t.createdAt)) + ' · ' + fmt(t.durationS, 1) + ' s' + (/^\d{8}-\d{4}-/.test(String(t.id)) ? ' · <span class="mono">' + esc(t.id) + '</span>' : '') + '</span>'
          + (A.lueckenhaft(t) ? ' <span class="tag rust" title="' + esc(lueckenText(t)) + '">Signallücke</span>' : '') + '</td>' +
        '<td class="mono">' + esc(t.vowelIntent || '–') + ' / ' + esc(s.vowel && s.vowel.dominant || '–') + '</td>' +
        '<td class="num">' + (s.f0 ? fmt(s.f0.med) + (noteText(s.f0.med, s.f0.note) ? ' ' + esc(s.f0.note) : '') + listeUnsicher(s.f0UnsureShare, 'Grundton unsicher') : '–') + '</td>' +
        '<td><canvas class="bars" height="28"></canvas></td>' +
        '<td class="num">' + (s.d34stable && s.d34stable.n ? statRange(s.d34stable) : (f3u ? '<span class="muted" title="nicht gewertet: F3 stabil unter dem Mindestwert dieses Takes">–</span>' : '<span class="rust">–</span>')) + '</td>' +
        '<td class="num">' + (s.f3stable && s.f3stable.n ? (f3u ? '<span class="befund" title="unter dem F3-Mindestwert ' + fmt(thr) + ' Hz dieses Takes, ΔF3–4 dort nicht gewertet">' : (thr == null ? '<span title="F3-Mindestwert dieses Takes nicht gespeichert">' : '<span>')) + fmt(s.f3stable.med) + '</span>' : '–') + '</td>' +
        '<td class="num">' + (s.sfr ? fmt(s.sfr.med, 1) + listeUnsicher(s.sfrUnsureShare, RAUSCHANTEIL_TEXT) : '–') + '</td>' +
        '<td class="num">' + (s.shr ? (shrBefund(s) ? '<span class="befund" title="über der Warnschwelle ' + String(SHR_WARN_DB).replace('-', '−') + ' dB">' : '<span>') + fmt(s.shr.max, 1) + '</span>' + listeUnsicher(s.shrUnsureShare, 'SHR-Raster oder Grundton unsicher') : '–') + '</td>' +
        '<td class="num">' + fmt((s.validShare || 0) * 100) + ' %</td>' +
        '<td class="small">' + esc(t.analysis && t.analysis.kernelVersion || '?') + (old ? ' <span class="tag rust">alt</span>' : '') + (uv ? ' <span class="tag" title="' + esc(uv) + '">anders gerechnet</span>' : '') + '</td>' +
        '<td class="actions"><button data-act="csv">CSV</button><button data-act="paket" title="ZIP: WAV, take.json, frames.csv, ereignisse.csv">Paket</button>' + (audioIds[t.id] ? '<button data-act="wav">WAV</button><button data-act="re">Neu analysieren</button>' : '') + '<button data-act="del" class="danger">Löschen</button></td></tr>';
    });
    el.innerHTML = h + '</tbody></table>';
    el.querySelectorAll('tr[data-id]').forEach(function (tr) {
      var id = tr.getAttribute('data-id'), take = takes.filter(function (t) { return t.id === id; })[0];
      drawFormantBars(tr.querySelector('canvas.bars'), take.summary, 28);
      tr.querySelectorAll('button[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          var act = b.getAttribute('data-act');
          if (act === 'csv') handlers.rowCsv(take); else if (act === 'paket') handlers.paket(take); else if (act === 'wav') handlers.downloadWav(take); else if (act === 're') handlers.reanalyse(take); else if (act === 'del') handlers.remove(take);
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
    /* Spur 1: F0. Rost hohl = unsicher (Gegenprobe gerissen oder Oktave offen), wie ungültige Formanten.
       Gold = korrigiert (Teilerkontrolle oder Gegenprobe): sicher, aber nicht der YIN-Wert. Früher stand
       ausgerechnet die Korrektur in Rost und der unsichere Wert hell wie jeder andere. */
    var y0 = axis(lanes[0], 'F0 Hz · Gold korrigiert · Rost hohl unsicher', 60, 500, [100, 200, 300, 400]);
    var F0UNS = A.FLAG.F0UNSURE | A.FLAG.OCTAMBIG, F0KOR = A.FLAG.OCTAVE | A.FLAG.F0KORR;
    for (i = 0; i < n; i++) {
      if (!(series.flags[i] & A.FLAG.VOICED)) continue;
      x = xt(series.t[i]); y = y0(Math.max(60, Math.min(500, series.f0[i])));
      if (series.flags[i] & F0UNS) { ctx.strokeStyle = COL.rust; ctx.lineWidth = 1; ctx.strokeRect(x - 1.5, y - 1.5, 3, 3); }
      else { ctx.fillStyle = (series.flags[i] & F0KOR) ? COL.gold : COL.ink; ctx.fillRect(x - 1, y - 1, 2, 2); }
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

  /* Ablesung unter dem Cursor als HTML: Unsicheres in Rost mit Grund (Grundton, SHR, H1−H2 bei
     unsicherem Grundton, ungültige Formanten und ΔF3–4), Korrigiertes mit altem Wert ohne Rost. Fehlt ein
     Feld (ältere Serie), steht „–“. Jeder Text geht durch esc(). smax: Streuungsgrenze, mit der der Take
     gerechnet wurde (take.analysis.spreadMaxHz); ohne sie lässt sich Streuung nicht als Grund nennen. */
  function hoverText(series, i, smax) {
    var wert = function (col) { var a = series[col]; return a ? a[i] : NaN; };
    var v = function (col, dec) { return fmt(wert(col), dec); }, valid = function (k) { return (series.valid[i] & (1 << k)) ? '' : '?'; };
    var fl = series.flags[i], F = A.FLAG, rost = function (t) { return '<span class="rust">' + esc(t) + '</span>'; };
    var grund = function (feld) { var a = series[feld]; return a ? A.textAus(feld, a[i]) : ''; };
    var f0z = [];
    if (fl & F.F0UNSURE) f0z.push('Grundton unsicher: ' + f0GrundText(grund('f0Grund'), wert('f0Cep'), wert('fensterF0Lo'), wert('fensterF0Hi')));
    if (fl & F.OCTAMBIG) f0z.push(oktavText(fl & F.OCTUNTER));
    var f0 = f0z.length ? rost('F0 ' + v('f0', 1) + ' (' + f0z.join('; ') + ')') : esc('F0 ' + v('f0', 1));
    if (fl & F.F0KORR) f0 += esc(' (' + f0KorrText(grund('f0Korrektur'), wert('f0Yin')) + ')');
    else if (fl & F.OCTAVE) f0 += ' (Oktave korrigiert)';
    var shr = 'SHR ' + v('shr', 1);
    if (fl & F.SHRUNSURE) {
      var g = wert('shrGrid'), f0v = wert('f0'), anders = (zahl(g) && g > 1.5 * f0v) ? f0v : 2 * f0v;
      shr = rost(shr + ' (Raster ' + fmt(g) + ' Hz)' + (zahl(wert('shrOther')) ? ' / ' + v('shrOther', 1) + ' (Raster ' + fmt(anders) + ' Hz)' : '') + ', unsicher: ' + shrGrundText(grund('shrGrund'), wert('shrKamm'), wert('shrZweitpuls'),
        { pegelDb: wert('fensterPegelDb'), f0Lo: wert('fensterF0Lo'), f0Hi: wert('fensterF0Hi'), boden: wert('shrBoden') }));
    } else shr = esc(shr);
    var h12 = 'H1−H2 ' + v('h1h2', 1) + ((fl & F.H1H2UNSURE) ? ' (filtergetrieben)' : '') + ' · H1*−H2* ' + v('h1h2c', 1) + (h1cBwArtefakt(series, i) ? ' (' + BANDBREITE_TEXT + ', auf ' + BW_ARTEFAKT_HZ + ' Hz begrenzt)' : '');
    h12 = (fl & F.F0UNSURE) ? rost(h12 + ' (Grundton unsicher)') : esc(h12);
    /* Formanten: ein ungültiger Wert in Rost mit seinen Gründen (formantGruende, wie live). Der Grund je
       Slot kommt aus den Masken der Serie (slotUnsure, slotVerschmolzen, rauschBoden); in Pausen gibt es
       keinen Wert und keinen Grund. */
    var stimmhaft = !!(fl & F.VOICED);
    var formant = function (k) {
      var txt = 'F' + (k + 1) + ' ' + v('f' + (k + 1));
      if (!stimmhaft) return esc(txt + valid(k));
      var bw = wert('bw' + (k + 1)), bwT = (zahl(bw) && bw < BW_ARTEFAKT_HZ) ? esc(' (' + BANDBREITE_TEXT + ')') : '';
      if (series.valid[i] & (1 << k)) return esc(txt) + bwT;
      // Grund aus den Masken (analysis.js slotGrundAus: auch 'teilton' und 'wechsel', ältere Serien '?').
      var b = 1 << k, sg = A.slotGrundAus(series, i, k);
      // Fensterzahl aus der Serie (analysis.js nWin); ältere Serien kennen sie nicht (null), dann wird sie erschlossen.
      var gr = formantGruende({ F: wert('f' + (k + 1)), grund: sg, teiltonHz: wert('teiltonHz'), rauschBoden: series.rauschBoden ? !!(series.rauschBoden[i] & b) : null,
        sdWin: wert('sdw' + (k + 1)), sdOrder: wert('sdo' + (k + 1)), smax: smax, nWin: A.nWinAus ? A.nWinAus(series, i, k) : null, nOrders: null });
      return rost(txt + '? (' + gr.join(', ') + ')') + bwT;
    };
    var d34 = 'ΔF3–4 ' + v('d34') + (isFinite(series.score[i]) ? ' (gewertet)' : '');
    // ΔF3–4 nicht messbar bei Teiltonabstand über 250 Hz (d34Grund 'teilton'): den Grund nennen.
    d34 = (stimmhaft && !(fl & F.D34VALID)) ? rost(d34 + '?' + (grund('d34Grund') === 'teilton' ? ' (' + teiltonText(wert('teiltonHz')) + ', nicht messbar)' : '')) : esc(d34);
    // SFR und CPP mit Rauschanteil im Fenster (Code ≠ 0): in Rost mit Grund.
    var rauschWert = function (name, col, feld) {
      var t = name + ' ' + v(col, 1), c = series[feld] ? series[feld][i] : 0;
      return (stimmhaft && c) ? rost(t + ' (unsicher: ' + rauschText(grund(feld)) + ')') : esc(t);
    };
    // Ein Rahmen an einer Naht ist keine Pause, sondern eine Stelle ohne Signal: sagen, nicht still „Pause“.
    if (F.NAHT && (fl & F.NAHT)) return esc('t ' + v('t', 2) + ' s · ') + rost('Signallücke: Rahmen an einer Naht, nicht gemessen, als Pause gewertet');
    return esc('t ' + v('t', 2) + ' s · ' + ['Pause', 'Übergang', 'stabil'][series.gate[i]] + (series.cls[i] >= 0 ? ' /' + V.CENTROIDS[series.cls[i]].cls + '/' : '')) + ' · ' + f0 +
      ' · ' + [0, 1, 2, 3, 4].map(formant).join(' ') + ' · ' + d34 + ' · ' + rauschWert('SFR', 'sfr', 'sfrGrund') +
      ' · ' + shr + ' · ' + rauschWert('CPP', 'cpp', 'cppGrund') + ' · ' + h12 + esc(' · ' + v('rms', 1) + ' dBFS');
  }

  /* Signallücken eines Takes als Satz (app.js signalLuecken, recorder.js): wo, wie lang, was daraus folgt.
     '' ohne Lücke; ältere Takes ohne Prüfung haben keine Angabe und bekommen keinen Satz. */
  function sek(x) { return zahl(x) ? fmt(x, 1).replace('.', ',') + ' s' : '? s'; }
  function lueckenText(take) {
    var l = take && take.signalLuecken;
    if (!l || !l.length) return '';
    var teile = l.map(function (x) {
      return x.art === 'anfang' ? 'am Anfang fehlen ' + sek(x.dauerS) : x.art === 'ende' ? 'am Ende fehlen ' + sek(x.dauerS) : 'bei ' + sek(x.beiS) + ' fehlen ' + sek(x.dauerS);
    });
    return 'Signal unterbrochen: ' + teile.join(', ') + '. Die Teile stoßen ohne Pause aneinander; jede Naht gilt als Pause. Take lückenhaft, keine Referenz.';
  }
  /* Bestes Segment eines Vokals; ein Segment, dessen Rahmen überwiegend zweideutig zugeordnet sind,
     wird nicht Bestsegment (analysis.js) — dann sagen, warum hier keins steht. */
  function bestSegmentText(k, pv) {
    var b = pv && pv.bestSegment;
    if (b) return '/' + esc(k) + '/ ' + fmt(b.d34Med) + zweideutigText(b.ambiguousShare);
    return '/' + esc(k) + '/ –' + ((pv && pv.segmentsAmbiguous > 0) ? ' <span class="small">(nur zweideutig zugeordnete Segmente)</span>' : '');
  }
  /* Rauschboden: Als Zahl steht nur ein gemessener Boden (Kalibrierung oder Stille im Take). Ohne Stille ist er
     unbekannt, und die Stimmhaftigkeit wurde gegen eine Annahme geprüft (analysis.js voicingFloorDb: 24 dB
     unter dem leisesten Rahmen, also Schwelle 12 dB darunter). Die steht neutral in einer eigenen Kachel, als
     Schwelle, nicht als Boden und nicht in Rost: Sie ist kein unsicherer Messwert, sondern eine genannte
     Annahme. Ältere Auswertungen ohne voicingFloorDb trugen die Annahme in floorDb (vor V3: q05 − 12). */
  function stimmBoden(s) { return zahl(s.voicingFloorDb) ? s.voicingFloorDb : (s.voicingFloorDb == null && zahl(s.floorDb) ? s.floorDb : NaN); }
  function summaryGrid(s, take) {
    function cell(k, v, unsure, befund) { return '<div class="stat' + (unsure ? ' unsure' : (befund ? ' befund' : '')) + '"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }
    var thr = f3Schwelle(take), f3u = f3Unter(take);
    // Schlüssel und Zahlen aus einer importierten Sicherung sind Fremddaten: maskieren bzw. durch
    // fmt() schicken, sonst landet beliebiges HTML in der Detailansicht.
    var per = s.perVowel || {}, perTxt = Object.keys(per).map(function (k) { return bestSegmentText(k, per[k]); }).join(' · ') || '–';
    return '<div class="grid">' +
      cell('Dauer · Rahmen', fmt(take.durationS, 1) + ' s · ' + fmt(s.nFrames)) +
      cell('stimmhaft · gültig · stabil', fmt(s.voicedShare * 100) + ' · ' + fmt(s.validShare * 100) + ' · ' + fmt(s.stableShare * 100) + ' %') +
      cell('F0 Median [q1–q3]', statRange(s.f0) + (s.f0 && noteText(s.f0.med, s.f0.note) ? ' ' + esc(s.f0.note) : '') + f0Zusatz(s), f0Unsicher(s)) +
      [0, 1, 2, 3, 4].map(function (k) { var f = s.F && s.F[k]; return cell('F' + (k + 1), statRangeShare(s, f) + teiltonZusatz(f), formantSchwach(s, f)); }).join('') +
      (hoheLage(s) ? cell('Hohe Lage', '<span class="rust">' + hoheLage(s) + '</span>', s.teiltonShare > 0.5) : '') +
      cell('ΔF3–4 alle gültigen', statRange(s.d34)) +
      // Keine Wertung, weil F3 sicher unter dem Mindestwert liegt, ist ein Befund, kein unsicherer Wert.
      ((s.d34stable && s.d34stable.n) ? cell('ΔF3–4 stabil, F3 ≥ ' + (thr != null ? fmt(thr) + ' Hz' : 'Minimum'), statRange(s.d34stable) + ' n=' + fmt(s.d34stable.n))
        : f3u ? cell('ΔF3–4 stabil, F3 ≥ ' + fmt(thr) + ' Hz', 'nicht gewertet: F3 stabil im Median ' + fmt(f3u.f3) + ' Hz, unter dem Mindestwert ' + fmt(f3u.schwelle) + ' Hz dieses Takes', false, true)
        : cell('ΔF3–4 stabil, F3 ≥ ' + (thr != null ? fmt(thr) + ' Hz' : 'Minimum'), '<span class="rust">keine gewerteten Rahmen</span>')) +
      cell('Bestes Segment je Vokal', perTxt) +
      (zahl(s.vowelAmbiguousShare) ? cell('Vokal zweideutig zugeordnet', fmt(s.vowelAmbiguousShare * 100) + ' % der stabilen Rahmen', s.vowelAmbiguousShare > 0.5) : '') +
      cell('ΔF4–5', statRange(s.d45)) +
      // SHR: Median und Maximum aus Rahmen ohne Rasterzweifel; Warnung (Gold) nur daraus, nie aus einem unsicheren Wert.
      cell('SFR dB', statRange(s.sfr) + rauschZusatz(s.sfrUnsureShare), zahl(s.sfrUnsureShare) && s.sfrUnsureShare > 0.5) + cell('SHR dB (Median / max)', (s.shr ? fmt(s.shr.med, 1) + ' / ' + fmt(s.shr.max, 1) : '–') + shrZusatz(s), shrUnsicher(s), shrBefund(s)) +
      cell('CPP dB (eigene Skala)', statRange(s.cpp) + rauschZusatz(s.cppUnsureShare), zahl(s.cppUnsureShare) && s.cppUnsureShare > 0.5) + cell('H1−H2 · H1*−H2*', fmt(s.h1h2 && s.h1h2.med, 1) + ' · ' + fmt(s.h1h2c && s.h1h2c.med, 1) + ' (' + fmt((s.h1h2 && s.h1h2.unsureShare || 0) * 100) + ' % filtergetrieben'
        + (zahl(s.f0UnsureShare) && s.f0UnsureShare > 0 ? ', ohne ' + prozentHtml(s.f0UnsureShare) + ' % mit unsicherem Grundton' : '') + ')' + h1cBwZusatz(s), s.h1h2 && s.h1h2.unsureShare > 0.5) +
      cell('Pegel dBFS (Median / max)', fmt(s.rms && s.rms.med, 1) + ' / ' + fmt(s.rms && s.rms.max, 1)) + cell('Rauschboden · SNR', fmt(s.floorSource === 'unknown' ? NaN : s.floorDb, 1) + ' dBFS (' + esc(s.floorSource === 'calibration' ? 'kalibriert' : (s.floorSource === 'unknown' ? 'unbekannt, keine Stille im Take' : 'geschätzt')) + ') · ' + (zahl(s.snrDb) ? fmt(s.snrDb, 1) + ' dB' : 'nicht messbar') + '', s.floorSource !== 'calibration') +
      (s.floorSource === 'unknown' ? cell('Stimmschwelle', 'angenommen: ' + fmt(stimmBoden(s) + 12, 1) + ' dBFS (Boden unbekannt, kein Messwert)') : '') +
      cell('Rohrlänge (Modell)', (s.tube && s.tube.n >= 20 ? fmt(s.tubeCm, 1) + ' cm [' + fmt(s.tube.q1, 1) + '–' + fmt(s.tube.q3, 1) + ']' : '– (zu wenige Rahmen mit vier gültigen Formanten)'), !(s.tube && s.tube.n >= 20)) +
      /* Korrigiert ist kein Zweifel: Teilerkontrolle und Gegenprobe liefern einen geprüften Wert. Rost nur,
         wenn die Oktave in vielen Rahmen offen ist. Früher machten schon 5 % Korrekturen die Kachel rostig. */
      cell('Grundton korrigiert · Oktave unsicher', prozentHtml(s.octaveCorrectedShare || 0) + (zahl(s.f0KorrekturShare) && s.f0KorrekturShare > 0 ? ' (Gegenprobe ' + prozentHtml(s.f0KorrekturShare) + ')' : '') + ' · ' + prozentHtml(s.octaveAmbiguousShare || 0) + ' %', s.octaveAmbiguousShare > 0.2) +
      cell('Slot-Zuordnung unsicher', fmt((s.slotUnsureShare || 0) * 100) + ' % der Rahmen', s.slotUnsureShare > 0.2) +
      /* Gezählt wird nur Weite und Dauer. Ein legato gesungener Melodiesprung erfüllt dieselbe
         Bedingung wie ein Registerbruch; ob es einer ist, zeigt erst ein Qualitätseinbruch am
         Übergang. Deshalb neutrale Namen, nicht „Registerwechsel“. */
      /* Bei einer Signallücke ist offen, was in der Lücke gesungen wurde: die Zahl gilt nur für das Aufgenommene. */
      cell('Tonsprünge ≥ 5 HT, gehalten ≥ 90 ms', (s.spruenge ? fmt(s.spruenge.gehalten) + ' (λ ' + fmt(s.spruenge.lambdaGehalten, 3) + ' /s)' : '– (ältere Auswertung)') + (A.lueckenhaft(take) ? ' — nur das Aufgenommene, Take lückenhaft' : ''),
        A.lueckenhaft(take), !!(s.spruenge && s.spruenge.gehalten > 0)) +
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

  /* Ein Eintrag der Historie ist { analysis, summary }: die ganze frühere Auswertung (app.js,
     reanalyse). Gelesen wurden aber h.kernelVersion und h.analysedAt, also stand „ ()“ da
     (Bericht 3, Befund 8). Ältere Einträge mit den Feldern direkt bleiben lesbar; was fehlt, heißt
     „?“ bzw. „Zeitpunkt unbekannt“ statt einer leeren Klammer. */
  function historieText(h) {
    var a = (h && h.analysis) || h || {}, wann = a.analysedAt ? dateShort(a.analysedAt) : '';
    return esc(a.kernelVersion || '?') + ' (' + (wann ? esc(wann) : 'Zeitpunkt unbekannt') + ')';
  }

  /* Stichpunkte zum Take (Formular) im Detail: aktuelle Fassung in den Feldern, frühere Fassungen lesbar darunter. Werte sind
     Nutzereingaben, ggf. aus einer importierten Sicherung: maskiert. */
  var HALTUNGEN = ['', 'stehend', 'sitzend gerade', 'sitzend', 'liegend', 'gehend', 'frei'];
  var JA_NEIN = ['offen', 'ja', 'nein'];
  function angabenAktuell(take) {
    var a = take.angaben || {};
    return { titel: a.titel != null ? a.titel : (take.label || ''), haltung: a.haltung || '', ort: a.ort || '', kette: a.kette || '', gefuehl: a.gefuehl || '',
      notiz: a.notiz != null ? a.notiz : (take.comment || ''), biphonation: a.biphonation || 'offen', periodenverdopplung: a.periodenverdopplung || 'offen', zeit: a.zeit || null };
  }
  function auswahl(id, werte, wert, texte) {
    return '<select id="' + id + '">' + werte.map(function (v) { return '<option value="' + esc(v) + '"' + (v === wert ? ' selected' : '') + '>' + esc(texte ? texte(v) : (v || '– nicht angegeben')) + '</option>'; }).join('') + '</select>';
  }
  function fassungText(a) {
    var t = [];
    ['titel', 'haltung', 'ort', 'kette', 'gefuehl', 'notiz'].forEach(function (k) { if (a && a[k]) t.push(k + ' „' + esc(a[k]) + '“'); });
    if (a && a.biphonation && a.biphonation !== 'offen') t.push('Biphonation ' + esc(a.biphonation));
    if (a && a.periodenverdopplung && a.periodenverdopplung !== 'offen') t.push('Periodenverdopplung ' + esc(a.periodenverdopplung));
    return (a && a.zeit ? esc(dateShort(a.zeit)) : 'Zeitpunkt unbekannt') + ': ' + (t.join(', ') || 'keine Angaben');
  }
  function renderDetail(el, take, series, refs, hasAudio, handlers) {
    var s = take.summary || {}, old = take.analysis && take.analysis.kernelVersion !== D.VERSION, ang = angabenAktuell(take), fassungen = take.angabenVersionen || [];
    // Eine Referenz gilt nur unter gleicher Rechenweise; app.js sagt, ob dieser Take jetzt vergleichbar ist.
    var uv = (handlers && typeof handlers.unvergleichbar === 'function') ? handlers.unvergleichbar(take) : '';
    var intents = [''].concat(V.CENTROIDS.map(function (c) { return c.cls; }));
    el.innerHTML = '<div class="panel"><a href="#/chronik">← Chronik</a>' +
      '<p id="d-veraltet" class="rust" hidden></p>' +   // app.js: inzwischen neu analysiert (Nachweis N9)
      '<h2>' + esc(take.code) + ' <span id="d-label-view">' + esc(take.label) + '</span></h2>' +
      '<div class="small muted">' + esc(dateShort(take.createdAt)) + ' · ' + esc(take.deviceLabel || '') + ' · ' + fmt(take.sampleRate) + ' Hz · Kern ' + esc(take.analysis && take.analysis.kernelVersion || '?') + (old ? ' <span class="tag rust">älterer Kern</span>' : '') + (s.floorSource === 'calibration' ? ' · kalibriert' : ' · <span class="rust">Rauschboden ' + (s.floorSource === 'unknown' ? 'unbekannt' : 'geschätzt') + '</span>') + '</div>' +
      '<div class="small">' + kontextZeile(take) + '</div>' +
      (A.lueckenhaft(take) ? '<div class="small rust">' + esc(lueckenText(take)) + '</div>' : '') +
      '<div class="small muted">ID <span class="mono">' + esc(take.id) + '</span>' + (take.startedAt ? ' · Start ' + esc(take.timeLocal || '') + ' · Ende ' + esc(take.timeLocalEnd || '') : '') + '</div>' +
      '<div class="formular">' +
      '<label for="d-label">Titel <span class="pflicht">Pflicht</span></label><input type="text" id="d-label" value="' + esc(ang.titel) + '">' +
      '<label for="d-intent">Vokalabsicht <span class="optional">optional</span></label><select id="d-intent">' + intents.map(function (v) { return '<option value="' + esc(v) + '"' + (v === (take.vowelIntent || '') ? ' selected' : '') + '>' + (v ? '/' + esc(v) + '/' : '–') + '</option>'; }).join('') + '</select>' +
      '<label for="d-haltung">Haltung <span class="optional">optional</span></label>' + auswahl('d-haltung', HALTUNGEN, ang.haltung) +
      '<label for="d-ort">Ort <span class="optional">optional</span></label><input type="text" id="d-ort" value="' + esc(ang.ort) + '">' +
      '<label for="d-kette">Kette-Zusatz <span class="optional">optional</span></label><input type="text" id="d-kette" value="' + esc(ang.kette) + '" placeholder="Hülle, Kabel, Abstand, Mikro">' +
      '<label for="d-gefuehl">Gefühl <span class="optional">optional</span></label><input type="text" id="d-gefuehl" value="' + esc(ang.gefuehl) + '">' +
      '<label for="d-comment">Notiz <span class="optional">optional</span></label><textarea id="d-comment">' + esc(ang.notiz) + '</textarea>' +
      '<label for="d-biphonation">Biphonation manuell <span class="optional">optional</span></label>' + auswahl('d-biphonation', JA_NEIN, ang.biphonation, function (v) { return v; }) +
      '<label for="d-perioden">Periodenverdopplung manuell <span class="optional">optional</span></label>' + auswahl('d-perioden', JA_NEIN, ang.periodenverdopplung, function (v) { return v; }) +
      '<label for="d-warmup">Einsing-Status <span class="optional">optional</span></label><select id="d-warmup">' +
        [''].concat(Object.keys(WARMUP_TEXT)).map(function (v) { return '<option value="' + esc(v) + '"' + (v === ((take.sitzung && take.sitzung.warmup) || '') ? ' selected' : '') + '>' + (v ? esc(WARMUP_TEXT[v]) : '– nicht angegeben') + '</option>'; }).join('') +
      '</select>' +
      '<label for="d-warmup-min">Minuten seit Einsingbeginn <span class="optional">optional</span></label><input type="number" id="d-warmup-min" min="0" max="600" step="1" value="' + (take.sitzung && take.sitzung.warmupMin != null ? esc(String(take.sitzung.warmupMin)) : '') + '">' +
      '</div>' +
      '<div class="row"><button id="d-save">Speichern (neue Fassung)</button><span class="small muted">' + (ang.zeit ? 'Stand der Angaben ' + esc(dateShort(ang.zeit)) : 'Angaben ohne Zeitstempel (älterer Take)') + (fassungen.length ? ' · ' + fassungen.length + (fassungen.length === 1 ? ' frühere Fassung' : ' frühere Fassungen') : '') + '</span></div>' +
      (fassungen.length ? '<details class="small muted"><summary>Frühere Fassungen der Angaben</summary><ul class="fassungen">' + fassungen.slice().reverse().map(function (a) { return '<li>' + fassungText(a) + '</li>'; }).join('') + '</ul></details>' : '') +
      '</div>' +
      '<div class="panel">' + summaryGrid(s, take) + '</div>' +
      '<div class="panel"><canvas id="d-lanes" height="420"></canvas><div id="d-hover" class="mono small muted hover-zeile">Maus über die Spuren bewegen.</div></div>' +
      '<div class="panel actions"><button id="d-frames">Rahmen-CSV</button><button id="d-row">CSV-Zeile</button><button id="d-paket" title="ZIP: WAV, take.json, frames.csv, ereignisse.csv">Paket</button><button id="d-ablegen" title="take.json, frames.csv.gz, ereignisse.csv nach data/takes/<id>/ im privaten Repo">Ins Repo</button>' + (hasAudio ? '<button id="d-wav">WAV</button><button id="d-re">Neu analysieren (Kern ' + esc(D.VERSION) + ')</button>' : '<span class="small muted">kein Audio gespeichert — Neu-Analyse nicht möglich</span> ') +
      (uv ? '<span class="small muted">Nicht als Referenz wählbar — anders gerechnet als jetzt eingestellt: ' + esc(uv) + '.</span> '
        : A.lueckenhaft(take) ? '<span class="small muted">Nicht als Referenz wählbar — Signallücke im Take.</span> '
        : Object.keys(s.perVowel || {}).map(function (k) { return s.perVowel[k].bestSegment ? '<button data-pin="' + esc(k) + '">Als Referenz für /' + esc(k) + '/ anpinnen</button>' : ''; }).join('')) +
      '<button id="d-del" class="danger">Take löschen</button></div>' +
      (take.history && take.history.length ? '<div class="panel small muted">Frühere Auswertungen: ' + take.history.map(historieText).join(', ')
        + (take.reanalysisNote ? ' · bei der letzten Neu-Analyse geändert: ' + esc(take.reanalysisNote) : '') + '</div>' : '');
    var cv = el.querySelector('#d-lanes'), geo = null, hover = el.querySelector('#d-hover');
    function redraw(idx) { geo = drawLanes(cv, series, refs, idx); }
    if (series) redraw(null); else cv.hidden = true;
    if (series) cv.addEventListener('mousemove', function (ev) {
      var rect = cv.getBoundingClientRect(), t = (ev.clientX - rect.left - geo.L) / geo.pw * geo.T, n = series.t.length;
      var idx = Math.max(0, Math.min(n - 1, Math.round(t / Math.max(geo.T, 1e-6) * (n - 1))));
      hover.innerHTML = hoverText(series, idx, take.analysis && take.analysis.spreadMaxHz); redraw(idx);
    });
    el.querySelector('#d-save').addEventListener('click', function () {
      var wm = el.querySelector('#d-warmup-min').value.trim(), n = wm === '' ? null : Number(wm);
      var q = function (id) { return el.querySelector(id).value; };
      handlers.saveEdit(take, {
        label: q('#d-label').trim(), vowelIntent: q('#d-intent'),
        comment: q('#d-comment'), warmup: q('#d-warmup'),
        warmupMin: (n != null && isFinite(n) && n >= 0) ? n : null,
        angaben: { titel: q('#d-label').trim(), haltung: q('#d-haltung'), ort: q('#d-ort'), kette: q('#d-kette'), gefuehl: q('#d-gefuehl'), notiz: q('#d-comment'), biphonation: q('#d-biphonation'), periodenverdopplung: q('#d-perioden') }
      });
    });
    el.querySelector('#d-frames').addEventListener('click', function () { handlers.frameCsv(take, series); });
    el.querySelector('#d-row').addEventListener('click', function () { handlers.rowCsv(take); });
    el.querySelector('#d-paket').addEventListener('click', function () { handlers.paket(take); });
    el.querySelector('#d-ablegen').addEventListener('click', function () { handlers.ablegen(take); });
    if (hasAudio) { el.querySelector('#d-wav').addEventListener('click', function () { handlers.downloadWav(take); }); el.querySelector('#d-re').addEventListener('click', function () { handlers.reanalyse(take); }); }
    el.querySelectorAll('button[data-pin]').forEach(function (b) { b.addEventListener('click', function () { handlers.pinRef(b.getAttribute('data-pin'), take); }); });
    el.querySelector('#d-del').addEventListener('click', function () { handlers.remove(take); });
  }

  root.VARECHRONIK = { setMarken: setMarken, angabenAktuell: angabenAktuell, fassungText: fassungText, HALTUNGEN: HALTUNGEN, kontextZeile: kontextZeile, lueckenText: lueckenText, WARMUP_TEXT: WARMUP_TEXT, validShareOf: validShareOf, formantSchwach: formantSchwach, formantBeleg: formantBeleg, noteText: noteText, bestSegmentText: bestSegmentText, renderRefs: renderRefs, renderList: renderList, renderDetail: renderDetail, drawLanes: drawLanes, drawFormantBars: drawFormantBars, setupCanvas: setupCanvas, refZeile: refZeile, zahl: zahl, f3Schwelle: f3Schwelle, f3Unter: f3Unter, shrBefund: shrBefund, f0GrundText: f0GrundText, f0KorrText: f0KorrText, oktavText: oktavText, shrGrundText: shrGrundText, teiltonText: teiltonText, rauschText: rauschText, rauschZusatz: rauschZusatz, hoheLage: hoheLage, RAUSCHANTEIL_TEXT: RAUSCHANTEIL_TEXT, f0Zusatz: f0Zusatz, f0Unsicher: f0Unsicher, shrZusatz: shrZusatz, shrUnsicher: shrUnsicher, formantGruende: formantGruende, BANDBREITE_TEXT: BANDBREITE_TEXT, H1C_BW_TEXT: H1C_BW_TEXT, prozent: prozent, prozentHtml: prozentHtml, hoverText: hoverText, fmt: fmt, esc: esc, dateShort: dateShort, COL: COL, MONO: MONO };
})(typeof self !== 'undefined' ? self : this);

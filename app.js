/* VARE — Verdrahtung: Routen, Mikrofon, Live-Schleife, Kalibrierung, Take, Chronik, Export/Import.
   Reines Browser-Skript. Rechnet im requestAnimationFrame (25 Hz), Offline-Analyse in Häppchen. */
(function () {
  'use strict';
  var D = window.VAREDSP, KO = window.VAREKORPUS, V = window.VAREVOWEL, A = window.VAREANALYSIS, C = window.VARECSV, W = window.VAREWAV, S = window.VARESTORE, K = window.VARECAL, R = window.VARERECORDER, CH = window.VARECHRONIK;
  var $ = function (id) { return document.getElementById(id); };
  var TSR = D.TARGET_SR, COL = CH.COL, MONO = CH.MONO;

  function hintText() {
    return 'Gestrichelt in Rost = Messwert unsicher: Streuung über Ordnungen oder Fensterlängen ≥ '
      + (st.settings ? st.settings.spreadMaxHz : 130) + ' Hz, Nummer mehrdeutig, zwei Resonanzen in einem Gipfel möglich oder Formant im Rauschboden — der Grund steht neben der Zahl. Gold ohne Strich = sicher gemessen, aber Befund. '
      + 'H1−H2 ist bei F1 ≈ F0 filtergetrieben und erlaubt keine Quellaussage.';
  }
  var SETTINGS_DEFAULT = { windowS: 0.30, sdF1Max: 50, sdF2Max: 100, minValidShare: 0.80, f3MinHz: 2500, smooth: 0.35, spreadMaxHz: 130, hopS: 0.010, storeAudio: true, audioFormat: 'i16', csvDialect: 'standard', requireCal: true, minTakeS: 1.0 };
  var SETTING_DEFS = [
    { key: 'windowS', label: 'Gatter-Fenster (s) — Vorgabe 0,30', min: 0.15, max: 0.60, step: 0.05, dec: 2 },
    { key: 'sdF1Max', label: 'F1 darf sich im Fenster bewegen (Hz, q90−q10) — Vorgabe 50', min: 20, max: 150, step: 5 },
    { key: 'sdF2Max', label: 'F2 darf sich im Fenster bewegen (Hz) — Vorgabe 100', min: 40, max: 300, step: 10 },
    { key: 'minValidShare', label: 'Mindestanteil gültiger F1/F2 im Fenster — Vorgabe 0,80', min: 0.5, max: 1, step: 0.05, dec: 2 },
    { key: 'f3MinHz', label: 'F3 mindestens (Hz), sonst keine ΔF3–4-Wertung — Vorgabe 2500', min: 2000, max: 3000, step: 50 },
    { key: 'smooth', label: 'Glättung der Formantanzeige (Faktor, 1 = keine) — Vorgabe 0,35', min: 0.1, max: 1, step: 0.05, dec: 2 },
    { key: 'spreadMaxHz', label: 'Gültigkeitsgrenze Streuung (Hz) — Vorgabe 130, bitte nicht anheben', min: 60, max: 250, step: 10 },
    { key: 'hopS', label: 'Rahmenabstand Offline-Analyse (s) — Vorgabe 0,010', min: 0.005, max: 0.05, step: 0.005, dec: 3 },
    { key: 'storeAudio', type: 'check', label: 'Audio (WAV) mit speichern — nötig für Neu-Analyse nach Kernänderungen' },
    { key: 'audioFormat', type: 'select', options: [['i16', '16 Bit (5,8 MB/min bei 48 kHz)'], ['f32', 'Float32 (11,5 MB/min)']], label: 'WAV-Format' },
    { key: 'csvDialect', type: 'select', options: [['standard', 'Standard: Komma, Punkt (pandas)'], ['excelde', 'Excel DE: Semikolon, Dezimalkomma, Text gegen Formeln geschützt (Apostroph)']], label: 'CSV-Dialekt' },
    { key: 'requireCal', type: 'check', label: 'Kalibrierung vor dem ersten Take dieser Sitzung erzwingen' }
  ];

  var st = { korpus: null, touched: {}, lastSeen: -1, lastSeenAt: 0, noSignalWarned: false, settings: null, rec: null, gate: null, refs: {}, refsUebergangen: {}, cal: null, calSession: false, takes: [], takesGeladen: false, kontextFehler: null, audioIds: {}, rmsRing: [], hist: [], smooth: [NaN, NaN, NaN, NaN, NaN], lastValid: [false, false, false, false, false], lastCls: null, taking: false, calRunning: false, busy: false, lastTick: 0, raf: 0, timer: 0, statusEl: null, sitzung: null, ctxTimer: 0, pendingCtx: null, offen: [], inArbeit: {} };

  /* ---------- Hilfen ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function uuid() { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); var s = ''; for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16); return s; }
  function codeFromIndex(n) { var s = ''; n = n + 1; while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
  function defaultLabel(code, d) { return code + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '. ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function stamp(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()); }
  /* Schritt 0 aus dem Manual verlangt die Uhrzeit, nicht den Zeitstempel. createdAt ist UTC —
     wer im Sommer um 9:48 singt, findet dort 07:48. Die Wanduhrzeit und der Abstand zu UTC
     werden deshalb getrennt mitgeschrieben, damit beides nachprüfbar bleibt. */
  function wallClock(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function tzOffsetMin(d) { return -d.getTimezoneOffset(); }
  function dauerText(sek) {
    if (sek == null || !isFinite(sek)) return '–';
    if (sek < 90) return Math.round(sek) + ' s';
    if (sek < 5400) return Math.round(sek / 60) + ' min';
    return (sek / 3600).toFixed(1) + ' h';
  }
  function fmt(v, dec) { return CH.fmt(v, dec); }
  function download(name, blob) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function status(msg, warn) {
    if (!st.statusEl) { st.statusEl = document.createElement('div'); st.statusEl.className = 'notice'; st.statusEl.setAttribute('role', 'status'); document.querySelector('main').insertBefore(st.statusEl, document.querySelector('main').firstChild); }
    st.statusEl.hidden = !msg; st.statusEl.textContent = msg || ''; st.statusEl.className = 'notice' + (warn ? ' warn' : '');
  }
  function bytesText(b) { return b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' kB'; }
  function gateOpts() { var s = st.settings; return { windowS: s.windowS, sdF1Max: s.sdF1Max, sdF2Max: s.sdF2Max, minValidShare: s.minValidShare, f3MinHz: s.f3MinHz }; }
  /* Rechenweise, mit der ein Take JETZT analysiert würde. Eine Referenz ist die Zielmarke für das,
     was jetzt gemessen wird, und stammt deshalb nur aus Takes, die genauso gerechnet sind (Manual:
     „Vergleiche nur bei gleicher Rechenweise“; analysis.js computeRefs und unvergleichbar). */
  function rechenweise() { var s = st.settings; return { kernelVersion: D.VERSION, gate: gateOpts(), spreadMaxHz: s.spreadMaxHz, hopS: s.hopS }; }
  // '' = vergleichbar; sonst die Abweichungen als Text. Ein Rechenkern ohne diese Prüfung meldet nichts.
  function unvergleichbar(take, akt) { return typeof A.unvergleichbar === 'function' ? A.unvergleichbar(take, akt || rechenweise()) : ''; }
  function b64FromBuffer(buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  function blobFromB64(b64, type) { var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: type || 'audio/wav' }); }

  /* ---------- Einstellungen ---------- */
  function loadSettings() {
    return S.getMeta('settings', {}).then(function (saved) {
      st.settings = {}; for (var k in SETTINGS_DEFAULT) st.settings[k] = (saved && saved[k] != null) ? saved[k] : SETTINGS_DEFAULT[k];
      st.touched = (saved && saved.__touched) || {};
      st.gate = V.createGate(gateOpts());
    }).catch(function () { st.settings = Object.assign({}, SETTINGS_DEFAULT); st.gate = V.createGate(gateOpts()); });
  }
  var saveTimer = 0;
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var o = {}; for (var k in st.settings) o[k] = st.settings[k];
      o.__touched = st.touched;
      S.setMeta('settings', o).catch(function () { });
    }, 300);
  }
  function renderSettings() {
    var el = $('settings'); el.innerHTML = '';
    SETTING_DEFS.forEach(function (d) {
      var wrap = document.createElement('div'), v = st.settings[d.key];
      if (d.type === 'check') {
        wrap.innerHTML = '<label class="inline"><input type="checkbox" id="s-' + d.key + '"' + (v ? ' checked' : '') + '> ' + d.label + '</label>';
        wrap.querySelector('input').addEventListener('change', function (e) { st.settings[d.key] = e.target.checked; st.touched[d.key] = true; saveSettings(); updateTakeButton(); });
      } else if (d.type === 'select') {
        wrap.innerHTML = '<label>' + d.label + ' <select id="s-' + d.key + '">' + d.options.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>';
        wrap.querySelector('select').addEventListener('change', function (e) { st.settings[d.key] = e.target.value; st.touched[d.key] = true; saveSettings(); });
      } else {
        wrap.className = 'setting';
        wrap.innerHTML = '<label for="s-' + d.key + '">' + d.label + '</label><output id="o-' + d.key + '">' + Number(v).toFixed(d.dec || 0) + '</output><input type="range" id="s-' + d.key + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + v + '" class="voll">';
        wrap.querySelector('input').addEventListener('input', function (e) {
          st.settings[d.key] = parseFloat(e.target.value); st.touched[d.key] = true; wrap.querySelector('output').textContent = Number(st.settings[d.key]).toFixed(d.dec || 0);
          st.gate = V.createGate(gateOpts()); saveSettings(); $('live-hints').textContent = hintText(); refsSpaeter();
        });
      }
      el.appendChild(wrap);
    });
  }

  /* Welche Takes als Referenz zählen, hängt an den Reglern. Nach einer Änderung neu bestimmen, sonst
     bliebe die Zielmarke eines jetzt anders gerechneten Takes stehen. Verzögert wie saveSettings. */
  var refsTimer = 0;
  function refsSpaeter() {
    clearTimeout(refsTimer);
    refsTimer = setTimeout(function () {
      if (!st.takesGeladen) return;
      recomputeRefs().then(function () { if (location.hash === '#/chronik') refreshChronik(); }).catch(function () { });
    }, 300);
  }

  /* ---------- Routen ---------- */
  function route() {
    var h = location.hash || '#/aufnahme', m = /^#\/take\/(.+)$/.exec(h);
    $('view-aufnahme').hidden = !(h === '#/aufnahme' || h === '#/');
    $('view-chronik').hidden = h !== '#/chronik';
    $('view-take').hidden = !m;
    $('nav-aufnahme').setAttribute('aria-current', $('view-aufnahme').hidden ? 'false' : 'page');
    $('nav-chronik').setAttribute('aria-current', $('view-chronik').hidden ? 'false' : 'page');
    if (h === '#/chronik') refreshChronik();
    if (m) openDetail(decodeURIComponent(m[1]));
  }

  /* ---------- Mikrofon ---------- */
  function fillDevices() {
    R.listDevices().then(function (ds) {
      var sel = $('mic-device'), cur = sel.value; sel.innerHTML = '<option value="">Standard</option>';
      ds.forEach(function (d, i) { var o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || ('Mikrofon ' + (i + 1)); sel.appendChild(o); });
      sel.value = cur;
    }).catch(function () { });
  }
  // Mikrofon aus und alles, was davon abhängt, im selben Zug: Knopf, Kalibrieren, Take, Live-Felder.
  function mikrofonAus(grund) {
    return st.rec.stop().then(function () { $('btn-mic').textContent = 'Mikrofon starten'; $('mic-info').textContent = 'kein Mikrofon aktiv'; cancelAnimationFrame(st.raf); updateTakeButton(); $('btn-cal').disabled = true; st.hist = []; drawHist(); freezeLive(grund); });
  }
  function micToggle() {
    if (st.rec && st.rec.active) {
      if (st.taking) { status('Erst den Take beenden.', true); return; }
      if (st.calRunning) { status('Erst die Kalibrierung abwarten.', true); return; }
      mikrofonAus('Mikrofon aus');
      return;
    }
    var rec = R.createRecorder();
    $('btn-mic').disabled = true;
    rec.start($('mic-device').value || null).then(function (info) {
      st.rec = rec; $('btn-mic').disabled = false; $('btn-mic').textContent = 'Mikrofon stoppen';
      var rateTxt = (info.trackSampleRate && info.trackSampleRate !== info.sampleRate)
        ? ('Gerät ' + info.trackSampleRate + ' Hz → Kontext ' + info.sampleRate + ' Hz') : (info.sampleRate + ' Hz');
      $('mic-info').textContent = info.deviceLabel + ' · ' + rateTxt + ' · ' + info.capture;
      /* Eine Kalibrierung gilt nur für die Kette, mit der sie gemessen wurde. Nach einem Gerätewechsel
         stünde sonst der Rauschboden des alten Geräts als „kalibriert“ da, und Takes trügen dessen
         calibrationId: SNR und Stimmschwelle bezögen sich auf das falsche Mikrofon. */
      var abw = ketteAbweichung(st.cal, info);
      if (abw.length) {
        st.cal = null; st.calSession = false; renderCalStatus(abw);
        status('Kalibrierung verworfen: ' + abw.join(' · ') + '. Bitte mit diesem Gerät neu kalibrieren.', true);
      }
      if (info.trackSampleRate && info.trackSampleRate < 16000) status('Das Gerät liefert nur ' + info.trackSampleRate + ' Hz (Freisprechprofil eines Bluetooth-Headsets?). Oberhalb von ' + Math.round(info.trackSampleRate / 2) + ' Hz ist dann nichts mehr messbar — F3 bis F5 sind damit wertlos.', true);
      var on = [];
      if (info.echoCancellation === true) on.push('Echo-Unterdrückung'); if (info.noiseSuppression === true) on.push('Rauschunterdrückung'); if (info.autoGainControl === true) on.push('automatische Verstärkung');
      $('notice-flags').hidden = !on.length;
      $('notice-flags').textContent = on.length ? 'Der Browser bearbeitet das Signal (' + on.join(', ') + ' aktiv). Diese Messungen sind dann nicht belastbar — anderes Gerät oder Browsereinstellung prüfen.' : '';
      $('btn-cal').disabled = false; updateTakeButton(); fillDevices();
      st.rmsRing = []; st.hist = []; st.lastTick = 0; st.gate.reset();
      st.raf = requestAnimationFrame(tick);
    }).catch(function (e) { $('btn-mic').disabled = false; status('Mikrofon: ' + (e && e.message || e), true); });
  }

  /* ---------- Live-Schleife ---------- */
  /* Rauschboden live. Kalibriert: der gemessene Boden. Sonst dieselbe Regel wie offline (A.bodenAusPegeln,
     Vertrag V3), angewandt auf den Ringpuffer: die Pegel der 0,10-s-Fenster der letzten 10 s (250 Takte zu
     40 ms) statt aller Rahmen eines Takes. Liegen darin zwischen Stille und Stimme 10 dB Lücke (Stille
     mindestens 5 %, also 0,5 s), ist der Boden aus der Stille geschätzt. Sonst ist er unbekannt: Die
     Stimmschwelle liegt dann 12 dB unter dem leisesten Pegel und heißt „angenommen“, und über stimmhaft
     entscheidet die Periodizität. Früher galt hier min(q05, q50 − 20), die Schwelle lag also bei q50 − 8 dB:
     Der leise Teil eines Decrescendo ohne Pause davor galt live als „Pause“ (nachgebildet: 36 dB in 8 s, ab
     rund 16 dB unter dem Anfang jeder Takt) — derselbe Fehler, den V3 offline behoben hat (Bericht 4, M19).
     Übertragen ist alles bis auf eins: Ein Take kennt alle seine Rahmen, live gibt es nur die Vergangenheit.
     Der gerade gemessene Rahmen kommt erst nach der Entscheidung in den Puffer. Sonst läge die Schwelle stets
     unter ihm, und schon der erste Takt einer Atempause hieße nicht „Pause“. Dafür ist nach mehr als 10 s
     Gesang der Boden zu Beginn einer Pause unbekannt, bis 0,5 s Stille im Puffer liegen; solche Takte stehen
     als „kein Periodenbezug“ da, nicht als Ton. Die Untergrenze von 5 % bleibt: Darunter würde ein einzelner
     leiser Konsonant zum „bekannten“ Boden, und die Schwelle schnitte leise Stimme ab. */
  function floorNow() {
    if (st.cal) return { db: st.cal.floorDb, src: 'kalibriert' };
    var b = A.bodenAusPegeln(st.rmsRing);
    return { db: b.db, src: b.known ? 'geschätzt' : 'angenommen' };
  }
  function tick(now) {
    st.raf = requestAnimationFrame(tick);
    if (!st.rec || !st.rec.active || st.calRunning) return;
    if (now - st.lastTick < 40) return;
    st.lastTick = now;
    /* Nachweis, dass überhaupt noch Abtastwerte ankommen. „active“ heißt nur, dass ein AudioContext
       existiert — wechselt Windows das Ausgabegerät oder schläft der Kontext ein, friert der
       Ringpuffer ein und die letzte Messung stünde unverändert als Live-Wert auf dem Schirm. */
    var seen = st.rec.samplesSeen;
    if (seen !== st.lastSeen) { st.lastSeen = seen; st.lastSeenAt = now; }
    else if (now - (st.lastSeenAt || now) > 300) {
      freezeLive('kein Signal vom Mikrofon — Gerät oder Ausgabegerät gewechselt?');
      if (st.taking && !st.noSignalWarned) { st.noSignalWarned = true; status('Kein Signal vom Mikrofon — dem laufenden Take fehlt ein Stück. Er wird mit der Lücke gespeichert, als lückenhaft gekennzeichnet und zählt nicht als Referenz.', true); }
      return;
    }
    st.noSignalWarned = false;
    var sr = st.rec.sampleRate, slice = st.rec.latest(0.2);
    if (slice.length < Math.round(0.19 * sr)) return;
    var ds = D.resample(slice, sr, TSR), fl = floorNow();
    var fr = D.analyseAt(ds, TSR, ds.length - 1, { align: 'end', floorDb: fl.db, spreadMaxHz: st.settings.spreadMaxHz, wantSpectrum: true });
    st.rmsRing.push(fr.rmsDb); if (st.rmsRing.length > 250) st.rmsRing.shift();
    var t = now / 1000;
    var gs = st.gate.update({ t: t, voiced: fr.voiced, F1: fr.F[0], F2: fr.F[1], F3: fr.F[2], valid1: fr.valid[0], valid2: fr.valid[1], d34: fr.d34, d34valid: fr.d34valid });
    // Nur stimmhafte Rahmen in den Verlauf: dsp.js füllt F und valid auch in Pausen, und ein
    // Formantpunkt aus Raumgeräusch sah in der 20-s-Spur genauso aus wie ein Messwert.
    st.hist.push({ t: t, f2: fr.voiced ? fr.F[1] : NaN, f3: fr.voiced ? fr.F[2] : NaN,
      f0x2: fr.voiced ? 2 * fr.f0 : NaN, v2: fr.voiced && fr.valid[1], v3: fr.voiced && fr.valid[2], u0: !!(fr.voiced && fr.f0Unsure) });
    while (st.hist.length && st.hist[0].t < t - 20) st.hist.shift();
    renderLive(fr, gs, fl);
  }
  var STAT_KEYS = ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'd34', 'd45', 'sfr', 'shr', 'cpp', 'h1h2', 'tube', 'floor'];
  /* Alles, was eine Messung zeigt, sichtbar einfrieren — in einem Zug, damit es nicht wieder
     auseinanderläuft. Nach „Mikrofon stoppen“ und während der Kalibrierung blieben sonst die
     letzten Zahlen in Gold stehen, als würden sie weiter gemessen. */
  function freezeLive(reason) {
    STAT_KEYS.forEach(function (k) { setStat(k, 'Pause', false, true); });
    st.smooth = [NaN, NaN, NaN, NaN, NaN]; st.lastValid = [false, false, false, false, false]; st.lastCls = null;
    setGateWord('pause', null, reason);
    var fl = floorNow();
    drawLevel(NaN, fl.db, fl.src);
    drawD34({ state: 'pause', score: NaN, reason: reason }, null);
    drawSpec({ voiced: false, F: [], valid: [], BW: [], spectrumDb: null }, null);
    $('live-ref').textContent = '';
    $('live-hints').textContent = hintText();
  }

  function setGateWord(state, cls, reason) {
    var el = $('gate-state'); el.className = state;
    el.textContent = state === 'pause' ? 'Pause' : state === 'uebergang' ? 'Übergang' : 'stabil /' + cls + '/';
    $('gate-reason').textContent = reason || '';
  }
  /* Drei Zustände, nicht zwei: Rost und gestrichelt heißt „Messwert trägt nicht“. Ein Befund, der
     sicher gemessen ist und trotzdem Aufmerksamkeit braucht — F3 unter dem Zielwert, SHR über der
     Warnschwelle —, bekommt Gold ohne Strich. Sonst heißt dieselbe Markierung zweierlei. */
  /* rost: ein Teil des Werts, der unsicher ist, obwohl der Rest der Kachel trägt — F1/F0 bei unsicherem
     Grundton neben einem gültigen F1. Er steht in Rost mit Strich dahinter, die Kachel bleibt, wie sie ist. */
  function setStat(id, text, unsure, frozen, note, rost) {
    var el = $('st-' + id), v = $('v-' + id); el.className = 'stat' + (unsure ? ' unsure' : (note ? ' befund' : '')) + (frozen ? ' frozen' : '');
    v.textContent = text;
    if (rost) { var sp = document.createElement('span'); sp.className = 'rust unsicher-teil'; sp.textContent = rost; v.appendChild(sp); }
  }
  function renderLive(fr, gs, fl) {
    drawLevel(fr.rmsDb, fl.db, fl.src);
    // Ein angenommener Boden ist kein Messwert: keine Rauschboden-Zahl, sondern die angenommene Stimmschwelle.
    if (fl.src === 'angenommen') setStat('floor', 'unbekannt · Stimmschwelle angenommen: ' + fmt(fl.db + 12, 1) + ' dBFS', true);
    else setStat('floor', fmt(fl.db, 1) + ' dBFS (' + (fl.src === 'geschätzt' ? 'geschätzt aus Stille' : fl.src) + ')', fl.src !== 'kalibriert');
    var cls = gs.state === 'stabil' ? gs.cls : null;
    if (cls !== st.lastCls || gs.state === 'pause') { st.smooth = [NaN, NaN, NaN, NaN, NaN]; st.lastValid = [false, false, false, false, false]; }
    st.lastCls = cls;
    setGateWord(gs.state, gs.cls, gs.reason);
    if (fr.tonalButAperiodic) {
      // Lauter Ton, aber kein Periodenbezug — das ist etwas anderes als Stille und darf nicht
      // „Pause“ heißen. Alle abgeleiteten Werte bleiben leer, der Pegel wird weiter gezeigt.
      STAT_KEYS.forEach(function (k) { if (k !== 'floor') setStat(k, '–', true); });
      /* Mit angenommenem Boden liegt die Schwelle absichtlich unter allem Gemessenen: „über der Schwelle“
         heißt dann nicht „Ton“, und Stille ist von Geräusch nicht zu trennen. Gesagt wird nur, was feststeht;
         meldet das Gatter Pause, bleibt es dabei. */
      var ang = fl.src === 'angenommen', wort = (ang && gs.state === 'pause') ? 'pause' : 'uebergang';
      setGateWord(wort, null, ang ? 'kein Periodenbezug (' + fmt(fr.rmsDb, 1) + ' dBFS) — Stille oder Geräusch? Ohne Kalibrierung und ohne Stille ist der Boden unbekannt'
        : 'Ton, aber kein Periodenbezug (' + fmt(fr.rmsDb, 1) + ' dBFS) — Vibrato, Knarren oder Geräusch?');
      drawD34({ state: wort, score: NaN, reason: 'kein Periodenbezug' }, null); drawSpec(fr, null); drawHist(); $('live-ref').textContent = '';
      return;
    }
    if (!fr.voiced) {
      STAT_KEYS.forEach(function (k) { if (k !== 'floor') setStat(k, 'Pause', false, true); });
      st.smooth = [NaN, NaN, NaN, NaN, NaN]; st.lastValid = [false, false, false, false, false];
      drawD34(gs, null); drawSpec(fr, null); drawHist(); $('live-ref').textContent = '';
      return;
    }
    /* Die Glättung darf keine Lücke überbrücken: war ein Formant zwischendurch ungültig, ist der
       alte Wert kein Nachbar mehr, und ein Mischwert aus beiden stünde ungestrichelt in Gold da.
       Nach einer Lücke oder einem Sprung über die Streuungsgrenze beginnt sie neu. */
    var a = st.settings.smooth, disp = [];
    for (var k = 0; k < 5; k++) {
      if (fr.valid[k]) {
        if (!st.lastValid[k] || !isFinite(st.smooth[k]) || Math.abs(fr.F[k] - st.smooth[k]) > st.settings.spreadMaxHz) st.smooth[k] = fr.F[k];
        else st.smooth[k] = a * fr.F[k] + (1 - a) * st.smooth[k];
      }
      st.lastValid[k] = !!fr.valid[k];
      disp.push(fr.valid[k] ? st.smooth[k] : fr.F[k]);
    }
    /* Grundton: Rost nur, wenn er unsicher ist — Gegenprobe gerissen (f0Unsure, mit Grund) oder Oktave
       offen (octaveAmbiguous; unter 60 Hz nicht geteilt eigens benannt). Korrigiert (Teilerkontrolle oder
       Gegenprobe) ist ein geprüfter Wert: sichtbar mit dem alten Wert, aber nicht rostig. Früher stand
       gerade die Korrektur in Rost. Die Note hängt am Grundton und steht in derselben Kachel. */
    var f0z = [], f0Uns = !!(fr.f0Unsure || fr.octaveAmbiguous);
    if (fr.f0Unsure) f0z.push('Grundton unsicher: ' + CH.f0GrundText(fr.f0Grund, fr.f0Cep));
    if (fr.octaveAmbiguous) f0z.push(CH.oktavText(fr.octaveUnterGrenze));
    if (fr.f0Korrektur) f0z.push(CH.f0KorrText(fr.f0Korrektur, fr.f0Yin));
    else if (fr.octaveCorrected) f0z.push('Teiler ' + fr.subFactor + ' aus Teiltonreihe');
    setStat('f0', fmt(fr.f0, 1) + ' Hz ' + fr.note + (f0z.length ? ' (' + f0z.join('; ') + ')' : ''), f0Uns);
    /* Warum ein Formant ungültig ist, gehört neben die Zahl — „Nummer mehrdeutig“ heißt etwas anderes als
       „Streuung“: im ersten Fall ist womöglich der falsche Formant gemeint. Früher stand hier „Zuordnung
       unsicher, nur N Resonanzen“, auch bei fünf Gipfeln und bei einem verschmolzenen Gipfel, und ein Formant
       im Rauschboden hieß „Streuung“. Jetzt alle zutreffenden Gründe aus denselben Feldern, aus denen dsp.js
       valid bildet, mit denselben Worten wie im Hover (CH.formantGruende). Rost bleibt über !valid. */
    function why(k) {
      var g = fr.valid[k] ? [] : CH.formantGruende({ F: fr.F[k], grund: fr.slotGrund ? fr.slotGrund[k] : (fr.slotUnsure[k] ? '?' : ''), rauschBoden: fr.rauschBoden ? !!fr.rauschBoden[k] : null,
        sdWin: fr.sdWin[k], sdOrder: fr.sdOrder[k], smax: st.settings.spreadMaxHz, nWin: fr.nWin[k], nOrders: fr.nOrders[k] });
      return (g.length ? ' — ' + g.join(', ') : '') + (fr.bwArtifact && fr.bwArtifact[k] ? ' · ' + CH.BANDBREITE_TEXT : '');
    }
    // F1 kommt aus der LPC und trägt für sich; F1/F0 und der nächste Teilton hängen am Grundton.
    var f1f0 = fmt(fr.f1f0, 2) + ' (H' + fmt(fr.nearestHarmonic) + ')';
    if (fr.f0Unsure) setStat('f1', fmt(fr.F[0]) + ' Hz' + why(0) + ' · ', !fr.valid[0], false, false, f1f0 + ' Grundton unsicher');
    else setStat('f1', fmt(fr.F[0]) + ' Hz · ' + f1f0 + why(0), !fr.valid[0]);
    setStat('f2', fmt(disp[1]) + ' Hz' + why(1), !fr.valid[1]);
    // Rost heißt „Messwert trägt nicht“. „F3 unter dem Zielwert“ ist eine sichere Messung und
    // gehört in den Text, nicht in die Warnfarbe.
    var f3Low = isFinite(fr.F[2]) && fr.F[2] < st.settings.f3MinHz;
    setStat('f3', fmt(disp[2]) + ' Hz' + why(2) + (f3Low ? ' · unter ' + st.settings.f3MinHz + ', nicht gewertet' : ''), !fr.valid[2], false, fr.valid[2] && f3Low);
    setStat('f4', fmt(disp[3]) + ' Hz' + why(3), !fr.valid[3]);
    setStat('f5', fmt(disp[4]) + ' Hz' + why(4), !fr.valid[4]);
    setStat('d34', fmt(fr.d34) + ' Hz' + (isFinite(gs.score) ? ' gewertet' : ' — nicht gewertet' + (gs.reason ? ': ' + gs.reason : '')), !fr.d34valid, false, fr.d34valid && !isFinite(gs.score));
    setStat('d45', fmt(fr.d45) + ' Hz', !fr.d45valid);
    setStat('sfr', fmt(fr.sfr, 1) + ' dB', false);
    /* SHR über der Warnschwelle ist ein Befund (Ventrikularfalten), keine Messunsicherheit — aber nur,
       wenn das Raster feststeht. Ist es zweifelhaft oder der Grundton unsicher (shrUnsure), stehen beide
       Werte mit ihrem Raster in Rost, mit dem Grund, und es gibt keine Warnung: Welcher Wert gilt, ist
       offen (physik.md §7.5). Der andere Wert fehlt, wenn nur der Grundton die Unsicherheit trägt. */
    if (fr.shrUnsure) {
      var anders = fr.shrGrid > fr.f0 * 1.5 ? fr.f0 : 2 * fr.f0;
      setStat('shr', fmt(fr.shr, 1) + ' dB (Raster ' + fmt(fr.shrGrid) + ' Hz)' + (CH.zahl(fr.shrOther) ? ' · ' + fmt(fr.shrOther, 1) + ' dB (Raster ' + fmt(anders) + ' Hz)' : '')
        + ' — unsicher: ' + CH.shrGrundText(fr.shrGrund, fr.shrKamm, fr.shrZweitpuls), true);
    } else setStat('shr', fmt(fr.shr, 1) + ' dB' + (fr.shrGrid > fr.f0 * 1.5 ? ' (Raster ' + fmt(fr.shrGrid) + ' Hz = ' + D.hzToNote(fr.shrGrid) + ')' : ''), false, false, fr.shr > -15);
    setStat('cpp', fmt(fr.cpp, 1) + ' dB', false);
    // H1−H2 und H1*−H2* lesen die Linien bei F0 und 2·F0: mit dem Grundton unsicher.
    setStat('h1h2', fmt(fr.h1h2, 1) + ' · ' + fmt(fr.h1h2c, 1) + ' dB' + (fr.h1h2unsure ? ' (filtergetrieben)' : '') + (fr.f0Unsure ? ' (Grundton unsicher)' : ''), fr.h1h2unsure || fr.f0Unsure);
    var hint = $('live-hints'), hinweis = fr.sparseHarmonics ? 'Grundton über 250 Hz: zwischen den Teiltönen liegt kein Messpunkt, ein Formant kann bis zu ±' + fmt(fr.harmonicPullHz) + ' Hz auf dem nächsten Teilton einrasten. Die Streuung der Sweeps zeigt das nicht an.' : hintText();
    hint.textContent = (fr.f0Unsure ? 'Grundton unsicher (' + CH.f0GrundText(fr.f0Grund, fr.f0Cep) + '): Note, F1/F0, Teiltonleiter, SHR und H1−H2 hängen an ihm. ' : '') + hinweis;
    var tl = D.tubeLength(fr.F, fr.valid);
    setStat('tube', isFinite(tl.cm) ? fmt(tl.cm, 1) + ' cm (ΔF ' + fmt(tl.dF) + ')' : '– (zu wenig stabile Formanten)', !isFinite(tl.cm));
    var ref = cls ? st.refs[cls] : null;
    // Eine verwaiste Referenz hat keinen Wert: keine Zielmarke, keine Differenz, dafür der Grund.
    $('live-ref').textContent = CH.refZeile(cls, ref, gs.score, cls ? (st.refsUebergangen[cls] || 0) : 0);
    drawD34(gs, ref); drawSpec(fr, disp); drawHist();
  }
  // Pegelbalken mit Boden und Stimmschwelle. Ist der Boden nur angenommen, steht kein Bodenstrich da, nur die Schwelle.
  function drawLevel(rms, floor, src) {
    var c = CH.setupCanvas($('level-canvas'), 40), ctx = c.ctx, w = c.w, x = function (db) { return (Math.max(-80, Math.min(0, db)) + 80) / 80 * w; };
    var ang = src === 'angenommen';
    ctx.fillStyle = COL.line; ctx.fillRect(0, 12, w, 16);
    if (isFinite(rms)) { ctx.fillStyle = rms > -3 ? COL.rust : COL.ink; ctx.fillRect(0, 12, x(rms), 16); }
    if (!ang) { ctx.strokeStyle = COL.muted; ctx.beginPath(); ctx.moveTo(x(floor), 6); ctx.lineTo(x(floor), 34); ctx.stroke(); }
    ctx.strokeStyle = COL.rust; ctx.beginPath(); ctx.moveTo(x(floor + 12), 6); ctx.lineTo(x(floor + 12), 34); ctx.stroke();
    ctx.fillStyle = COL.muted; ctx.font = MONO; ctx.textAlign = 'right'; ctx.fillText(fmt(rms, 1) + ' dBFS', w - 4, 10); ctx.textAlign = 'left';
    ctx.fillText(ang ? 'Boden unbekannt · Stimmschwelle angenommen ' + fmt(floor + 12, 0) + ' dBFS' : 'Boden ' + fmt(floor, 0) + ' · Stimmschwelle +12 dB', 4, 10);
  }
  function drawD34(gs, ref) {
    var c = CH.setupCanvas($('d34-canvas'), 56), ctx = c.ctx, w = c.w, x = function (v) { return Math.max(0, Math.min(w, v / 1600 * w)); };
    ctx.fillStyle = COL.line; ctx.fillRect(0, 26, w, 6);
    ctx.font = MONO; ctx.fillStyle = COL.muted; ctx.textAlign = 'center';
    (st.korpus && st.korpus.marken || []).forEach(function (m) { ctx.fillRect(x(m.hz) - 1, 20, 2, 18); ctx.fillText(String(m.hz), x(m.hz), 52); });
    if (ref && !ref.verwaist && CH.zahl(ref.d34)) { ctx.fillStyle = COL.gold; ctx.beginPath(); ctx.moveTo(x(ref.d34), 18); ctx.lineTo(x(ref.d34) - 6, 8); ctx.lineTo(x(ref.d34) + 6, 8); ctx.closePath(); ctx.fill(); ctx.textAlign = x(ref.d34) < 60 ? 'left' : 'right'; ctx.fillText('Ref ' + fmt(ref.d34) + ' ', x(ref.d34) + (x(ref.d34) < 60 ? 8 : -8), 12); }
    if (isFinite(gs.score)) { ctx.fillStyle = COL.gold; ctx.fillRect(x(gs.score) - 2, 14, 4, 30); ctx.textAlign = x(gs.score) > w - 70 ? 'right' : 'left'; ctx.fillText(fmt(gs.score) + ' Hz', x(gs.score) + (x(gs.score) > w - 70 ? -8 : 8), 12); }
    else { ctx.fillStyle = gs.state === 'pause' ? COL.muted : COL.rust; ctx.textAlign = 'left'; ctx.fillText(gs.state === 'pause' ? 'Pause' : (gs.state === 'uebergang' ? 'Übergang — keine Wertung' : 'stabil, aber ' + gs.reason), 4, 14); }
  }
  function drawSpec(fr, disp) {
    var c = CH.setupCanvas($('spec-canvas'), 170), ctx = c.ctx, w = c.w, h = c.h, x = function (f) { return f / 5000 * w; };
    ctx.fillStyle = 'rgba(201,162,39,0.10)'; ctx.fillRect(x(2400), 0, x(3200) - x(2400), h);
    ctx.font = MONO; ctx.fillStyle = COL.muted; ctx.textAlign = 'center';
    for (var f = 1000; f <= 4000; f += 1000) { ctx.fillRect(x(f), h - 14, 1, 4); ctx.fillText(f + '', x(f), h - 2); }
    if (fr.spectrumDb) {
      ctx.strokeStyle = COL.line; ctx.beginPath();
      var df = TSR / 2048, nb = Math.min(fr.spectrumDb.length, Math.floor(5000 / df));
      for (var k = 1; k < nb; k++) { var y = h - 18 - (Math.max(-100, Math.min(0, fr.spectrumDb[k])) + 100) / 100 * (h - 40); if (k === 1) ctx.moveTo(x(k * df), y); else ctx.lineTo(x(k * df), y); }
      ctx.stroke();
    }
    if (!fr.voiced) { ctx.fillStyle = COL.muted; ctx.textAlign = 'left'; ctx.fillText('Pause', 6, 14); return; }
    // Teiltonleiter aus dem Grundton: ist er unsicher, ist es die Leiter auch — Rost, und es steht dabei.
    var leiterU = !!fr.f0Unsure;
    for (var m = 1; m * fr.f0 < 5000; m++) { ctx.fillStyle = leiterU ? COL.rust : ((m === fr.nearestHarmonic) ? COL.gold : COL.muted); ctx.fillRect(x(m * fr.f0) - (m === fr.nearestHarmonic ? 1.5 : 0.5), 8, m === fr.nearestHarmonic ? 3 : 1, 34); }
    ctx.fillStyle = leiterU ? COL.rust : COL.muted; ctx.textAlign = 'left'; ctx.fillText('Teiltöne ' + fmt(fr.f0, 1) + ' Hz, H' + fr.nearestHarmonic + ' an F1' + (leiterU ? ' — Grundton unsicher' : ''), 6, 52);
    for (var i = 0; i < 5; i++) {
      var F = disp ? disp[i] : fr.F[i];
      if (!isFinite(F)) continue;
      var bw = Math.max(6, x(isFinite(fr.BW[i]) ? fr.BW[i] : 60)), xc = x(F), yb = 70 + i * 16;
      if (fr.valid[i]) { ctx.fillStyle = COL.gold; ctx.fillRect(xc - bw / 2, yb, bw, 10); }
      else { ctx.strokeStyle = COL.rust; ctx.setLineDash([3, 3]); ctx.strokeRect(xc - bw / 2, yb, bw, 10); ctx.setLineDash([]); }
      ctx.fillStyle = fr.valid[i] ? COL.ink : COL.rust; ctx.textAlign = 'left'; ctx.fillText('F' + (i + 1) + ' ' + fmt(F), xc + bw / 2 + 3, yb + 9);
    }
    function bracket(i, j, y) {
      if (!(fr.valid[i] && fr.valid[j])) return;
      var a = x(disp ? disp[i] : fr.F[i]), b = x(disp ? disp[j] : fr.F[j]);
      ctx.strokeStyle = COL.gold; ctx.beginPath(); ctx.moveTo(a, y); ctx.lineTo(a, y + 6); ctx.lineTo(b, y + 6); ctx.lineTo(b, y); ctx.stroke();
      // Die Klammer darf an der geglätteten Bandlage hängen, die ZAHL muss die rohe sein — sonst
      // stehen für dieselbe Größe zwei verschiedene Werte gleichzeitig auf dem Schirm.
      ctx.fillStyle = COL.gold; ctx.textAlign = 'center'; ctx.fillText('Δ ' + fmt(fr.F[j] - fr.F[i]) + ' Hz', (a + b) / 2, y + 16);
    }
    bracket(2, 3, 150); bracket(3, 4, 132);
  }
  function drawHist() {
    var c = CH.setupCanvas($('hist-canvas'), 140), ctx = c.ctx, w = c.w, h = c.h, now = st.hist.length ? st.hist[st.hist.length - 1].t : 0;
    var x = function (t) { return w - (now - t) / 20 * w; }, y = function (f) { return h - 12 - Math.max(0, Math.min(4000, f)) / 4000 * (h - 20); };
    ctx.font = MONO; ctx.fillStyle = COL.muted; ctx.textAlign = 'left';
    [1000, 2000, 3000].forEach(function (f) { ctx.fillStyle = COL.line; ctx.fillRect(0, y(f), w, 1); ctx.fillStyle = COL.muted; ctx.fillText(f + '', 2, y(f) - 2); });
    ctx.fillText('F3 gold · F2 hell · 2·F0 grau · hohl = instabil — letzte 20 s', 2, 10);
    for (var i = 0; i < st.hist.length; i++) {
      var e = st.hist[i], xx = x(e.t);
      if (isFinite(e.f0x2)) { if (e.u0) { ctx.strokeStyle = COL.rust; ctx.strokeRect(xx - 1.5, y(e.f0x2) - 1.5, 3, 3); } else { ctx.fillStyle = COL.muted; ctx.fillRect(xx - 1, y(e.f0x2) - 1, 2, 2); } }
      if (isFinite(e.f2)) { if (e.v2) { ctx.fillStyle = COL.ink; ctx.fillRect(xx - 1, y(e.f2) - 1, 2, 2); } else { ctx.strokeStyle = COL.rust; ctx.strokeRect(xx - 1.5, y(e.f2) - 1.5, 3, 3); } }
      if (isFinite(e.f3)) { if (e.v3) { ctx.fillStyle = COL.gold; ctx.fillRect(xx - 1.5, y(e.f3) - 1.5, 3, 3); } else { ctx.strokeStyle = COL.rust; ctx.strokeRect(xx - 1.5, y(e.f3) - 1.5, 3, 3); } }
    }
  }

  /* ---------- Kalibrierung ---------- */
  /* Was die Seite über die Kette weiß: Gerät (Kennung und Name), Abtastrate von Kontext und Gerät,
     Bearbeitung durch den Browser. Weicht eins davon von der Kalibrierung ab, ist es eine andere
     Kette. Dasselbe Mikrofon einmal über „Standard“ und einmal über seinen Namen gewählt gilt dabei
     auch als anders — lieber einmal zu oft kalibrieren als mit fremdem Boden messen. */
  var KETTE_BEARBEITUNG = [['echoCancellation', 'Echo-Unterdrückung'], ['noiseSuppression', 'Rauschunterdrückung'], ['autoGainControl', 'automatische Verstärkung']];
  function anAus(v) { return v === true ? 'an' : v === false ? 'aus' : 'unbekannt'; }
  function ketteAbweichung(cal, info) {
    var w = [];
    if (!cal || !info) return w;
    if ((cal.deviceId || '') !== (info.deviceId || '') || (cal.deviceLabel || '') !== (info.deviceLabel || '')) w.push('anderes Gerät („' + (cal.deviceLabel || '?') + '“ → „' + (info.deviceLabel || '?') + '“)');
    if (cal.sampleRate !== info.sampleRate) w.push('Abtastrate ' + cal.sampleRate + ' → ' + info.sampleRate + ' Hz');
    if ((cal.trackSampleRate || null) !== (info.trackSampleRate || null)) w.push('Geräte-Abtastrate ' + (cal.trackSampleRate || '?') + ' → ' + (info.trackSampleRate || '?') + ' Hz');
    var f = cal.captureFlags || {};
    KETTE_BEARBEITUNG.forEach(function (k) { if (f[k[0]] !== info[k[0]]) w.push(k[1] + ' ' + anAus(f[k[0]]) + ' → ' + anAus(info[k[0]])); });
    return w;
  }
  function renderCalStatus(warnings) {
    var c = st.cal, el = $('cal-status');
    if (!c) { el.innerHTML = (warnings && warnings.length ? 'Kalibrierung verworfen — sie gilt nur für Gerät und Einstellungen, mit denen sie gemessen wurde.' : 'Noch keine Kalibrierung in dieser Sitzung.') + (st.settings.requireCal ? ' <span class="rust">Ohne Kalibrierung ist kein Take möglich.</span>' : ''); }
    else el.innerHTML = 'Kalibriert ' + CH.esc(CH.dateShort(c.createdAt)) + ' · ' + CH.esc(c.deviceLabel) + ' · Rauschboden <span class="mono">' + fmt(c.floorDb, 1) + ' dBFS</span> · /a/ <span class="mono">' + fmt(c.levelDb, 1) + ' dBFS</span> · SNR <span class="mono">' + fmt(c.snrDb, 1) + ' dB</span> (Band 2,4–3,2 kHz <span class="mono">' + fmt(c.bandSnr && c.bandSnr.sf, 1) + ' dB</span>) · Ausklang <span class="mono">' + fmt(c.decayDbPerS, 0) + ' dB/s</span> · F1–F3 des /a/ <span class="mono">' + (c.F || []).slice(0, 3).map(function (v) { return fmt(v); }).join(' / ') + '</span>' + (c.snrDb < 30 ? ' <span class="rust">SNR unter 30 dB — Messungen im Sängerformantband unsicher.</span>' : '');
    $('cal-warnings').innerHTML = warnings && warnings.length ? 'Kette gegenüber der letzten Kalibrierung verändert: ' + warnings.map(CH.esc).join(' · ') : '';
  }
  function calibrate() {
    if (!st.rec || !st.rec.active || st.calRunning || st.taking) return;
    freezeLive('Kalibrierung läuft');
    st.calRunning = true; $('btn-cal').disabled = true; $('cal-progress').hidden = false; updateTakeButton();
    var phases = K.PHASES, t0 = performance.now(), total = K.totalSeconds();
    st.rec.beginTake();
    var iv = setInterval(function () {
      var el = (performance.now() - t0) / 1000, acc = 0, cur = null, left = 0;
      for (var i = 0; i < phases.length; i++) { if (el < acc + phases[i].seconds) { cur = phases[i]; left = acc + phases[i].seconds - el; break; } acc += phases[i].seconds; }
      if (cur) { $('cal-progress').textContent = cur.label + ' — noch ' + left.toFixed(1) + ' s'; var flK = floorNow(); drawLevel(st.rec.latest(0.1).length ? D.rmsDb(st.rec.latest(0.1)) : NaN, flK.db, flK.src); }
      if (el >= total + 0.1 || !st.rec || !st.rec.active) {
        clearInterval(iv);
        if (!st.rec || !st.rec.active) { st.calRunning = false; $('btn-cal').disabled = true; $('cal-progress').hidden = true; status('Kalibrierung abgebrochen — Mikrofon nicht mehr aktiv.', true); updateTakeButton(); return; }
        Promise.resolve(st.rec.endTake()).then(kalibrierungAuswerten);
      }
    }, 100);
    function kalibrierungAuswerten(take) {
      if (take.durationS < total - 0.3) {
        st.calRunning = false; $('btn-cal').disabled = false; $('cal-progress').hidden = true; updateTakeButton();
        status('Kalibrierung abgebrochen (' + take.durationS.toFixed(1).replace('.', ',') + ' s von ' + total + ' s aufgenommen) — nicht übernommen.', true);
        return;
      }
      $('cal-progress').textContent = 'Auswertung …';
      setTimeout(function () {
        try {
          var info = st.rec.info, rec = K.analyseCalibration(take.samples, take.sampleRate, { deviceLabel: info.deviceLabel, deviceId: info.deviceId, createdAt: new Date().toISOString(), id: 'cal-' + uuid() });
          rec.captureFlags = { echoCancellation: info.echoCancellation, noiseSuppression: info.noiseSuppression, autoGainControl: info.autoGainControl };
          // Gehört zur Kette (ketteAbweichung): ein Headset im Freisprechprofil liefert eine andere Rate.
          rec.trackSampleRate = info.trackSampleRate || null;
          /* Eine Kalibrierung, die keine Zahlen hergibt, darf nicht als Bezug gelten: sonst
             rechnet jeder Take danach gegen einen Rauschboden, den es nicht gibt. */
          var fehlt = [];
          if (!isFinite(rec.floorDb)) fehlt.push('Rauschboden');
          if (!isFinite(rec.levelDb) || !rec.nVoiced) fehlt.push('/a/ nicht erkannt');
          if (!isFinite(rec.snrDb)) fehlt.push('SNR');
          if (fehlt.length) {
            st.calRunning = false; $('btn-cal').disabled = false; $('cal-progress').hidden = true; updateTakeButton();
            status('Kalibrierung unbrauchbar (' + fehlt.join(', ') + ') — nicht übernommen. Lauter singen, näher ans Mikrofon, Ablauf wiederholen.', true);
            return;
          }
          S.allCalibrations().then(function (all) {
            var prev = all.filter(function (c) { return c.deviceLabel === rec.deviceLabel; })[0] || all[0] || null;
            var warnings = K.compare(prev, rec);
            st.cal = rec; st.calSession = true; st.rmsRing = [];
            return S.putCalibration(rec).then(function () { renderCalStatus(warnings); });
          }).catch(function (e) { status('Kalibrierung konnte nicht gespeichert werden: ' + e.message, true); }).then(function () {
            st.calRunning = false; $('btn-cal').disabled = false; $('cal-progress').hidden = true; updateTakeButton();
          });
        } catch (e) { st.calRunning = false; $('btn-cal').disabled = false; $('cal-progress').hidden = true; status('Kalibrierung fehlgeschlagen: ' + e.message, true); updateTakeButton(); }
      }, 20);
    }
  }

  /* ---------- Take ---------- */
  function updateTakeButton() {
    /* Ohne gelesene Chronik kennt die Seite weder die Stelle in der Sitzung noch die Pause davor —
       ein Take davor bekäme „Take 1, erster Take“, obwohl es längst Takes gibt. */
    var s = st.settings || SETTINGS_DEFAULT, kontext = st.takesGeladen && !!st.sitzung;
    var ok = st.rec && st.rec.active && !st.calRunning && !st.busy && kontext && (!s.requireCal || st.calSession);
    $('btn-take').disabled = !ok && !st.taking;
    $('take-hint').textContent = st.kontextFehler ? 'Chronik nicht lesbar (' + st.kontextFehler + ') — Stelle in der Sitzung und Pause wären unbekannt, deshalb kein Take. Seite neu laden.'
      : !st.rec || !st.rec.active ? 'Mikrofon starten, dann kalibrieren, dann Take.'
      : !kontext ? 'Chronik wird gelesen …'
      : (s.requireCal && !st.calSession ? 'Kalibrierung ist Pflicht (Einstellungen: abschaltbar, aber dann fehlt der Bezug für SNR und Rauschboden).' : '');
  }
  /* ---------- Schritt 0: Sitzungskontext ---------- */
  /* Das Manual verlangt vier Angaben, bevor eine Zahl etwas bedeutet: Uhrzeit, wo im Verlauf
     der Sitzung der Take liegt, wie lange die Pause davor war, und ob überhaupt eingesungen
     wurde. Drei davon kann die Seite selbst wissen, eine muss der Nutzer sagen. Was er nicht
     sagt, wird nicht geraten — es bleibt leer und steht in der CSV als Sentinel. */
  function ladeSitzung() {
    return S.getMeta('sitzung', null).then(function (v) {
      if (v && v.id) { st.sitzung = v; return v; }
      st.sitzung = { nr: 1, id: uuid(), startedAt: new Date().toISOString(), warmup: '', warmupMin: null, warmupMinAt: null, warmupAngabeAt: null, letztePos: 0 };
      return S.setMeta('sitzung', st.sitzung).then(function () { return st.sitzung; });
    });
  }
  function speichereSitzung() { return st.sitzung ? S.setMeta('sitzung', st.sitzung) : Promise.resolve(); }
  function sitzungsTakes() {
    if (!st.sitzung) return [];
    return st.takes.filter(function (t) { return t.sitzung && t.sitzung.id === st.sitzung.id; });
  }
  /* Die Position kommt aus einem Zähler der Sitzung, nicht aus der Anzahl ihrer Takes: nach dem
     Löschen ergäbe „Anzahl + 1“ eine Nummer, die es schon gibt. Die gespeicherten Takes zählen mit,
     damit auch ein verlorener Zähler (Meta gelöscht, Sicherung eingespielt) nichts doppelt vergibt. */
  function naechstePosition() {
    var m = st.sitzung ? Number(st.sitzung.letztePos) || 0 : 0;
    sitzungsTakes().forEach(function (t) { var p = Number(t.sitzung.position); if (isFinite(p) && p > m) m = p; });
    return m + 1;
  }
  /* Erst nach dem Speichern weiterzählen: ein verworfener oder gescheiterter Take belegt keine
     Nummer. Gehört der Take zu einer Sitzung, die während seiner Analyse beendet wurde, bleibt der
     Zähler der neuen Sitzung unberührt. */
  function zaehlerFortschreiben(ctx, ende) {
    if (!st.sitzung || !ctx || ctx.id !== st.sitzung.id) return Promise.resolve();
    var p = Number(ctx.position);
    if (!isFinite(p)) return Promise.resolve();
    st.sitzung.letztePos = Math.max(Number(st.sitzung.letztePos) || 0, p);
    st.sitzung.letztesEnde = ende;
    return speichereSitzung().catch(function () { });
  }
  function letzterTake() {
    var best = null;
    st.takes.forEach(function (t) { if (!best || String(t.createdAt) > String(best.createdAt)) best = t; });
    return best;
  }
  /* Pause vor diesem Take: Abstand zur UHRZEIT DES ENDES des letzten Takes, nicht zu seinem
     Beginn — sonst zählt die Singzeit des letzten Takes als Pause mit. */
  function pauseSeitLetztem(jetzt) {
    var t = letzterTake(), ende = t && t.createdAt ? Date.parse(t.createdAt) : NaN;
    var selbe = !!(t && t.sitzung && st.sitzung && t.sitzung.id === st.sitzung.id);
    /* Ein gelöschter Take wurde trotzdem gesungen. Das Ende des zuletzt gespeicherten Takes dieser
       Sitzung steht deshalb beim Zähler und gilt, wenn es später liegt als der jüngste noch
       vorhandene Take — sonst wüchse die Pause durch Löschen. */
    var eigen = st.sitzung ? Date.parse(st.sitzung.letztesEnde) : NaN;
    if (isFinite(eigen) && !(eigen <= ende)) { ende = eigen; selbe = true; }
    if (!isFinite(ende)) return { sek: null, selbeSitzung: null };
    var sek = (jetzt.getTime() - ende) / 1000;
    if (!(sek >= 0)) return { sek: null, selbeSitzung: null };
    return { sek: sek, selbeSitzung: selbe };
  }
  /* Einsing-Angaben beschreiben einen Zustand, der verfliegt. Die Minuten seit Einsingbeginn laufen
     deshalb mit: gespeichert wird die Eingabe samt Zeitpunkt, jeder Take rechnet die Minute seines
     Starts. Liegen letzte Eingabe und letzter Take mehr als drei Stunden zurück, ist es eine andere
     Übungseinheit: eine Übungssitzung dauert selten über zwei Stunden, und nach Stunden ohne Singen
     ist auch „voll eingesungen“ abgeklungen. Dann werden die Angaben geleert, und die Seite sagt
     warum — still weitergeführt landete „voll eingesungen, seit 15 min“ im nächsten Tag. */
  var EINSING_GUELTIG_MS = 3 * 3600 * 1000;
  function einsingMinuten(jetzt) {
    var s = st.sitzung;
    if (!s || s.warmupMin == null || !isFinite(s.warmupMin) || !(Number(s.warmupMinAt) > 0)) return null;
    var d = (jetzt.getTime() - Number(s.warmupMinAt)) / 60000;
    // Uhr zurückgestellt: lieber keine Zahl als eine erfundene.
    if (!(d >= 0)) return null;
    return Math.round((s.warmupMin + d) * 10) / 10;
  }
  function einsingHinweis(text) { var el = $('ctx-hinweis'); el.textContent = text || ''; el.hidden = !text; }
  function einsingPruefen(jetzt) {
    var s = st.sitzung;
    if (!s || (!s.warmup && s.warmupMin == null)) return;
    var ref = Number(s.warmupAngabeAt) || 0, t = letzterTake(), te = t ? Date.parse(t.createdAt) : NaN, le = Date.parse(s.letztesEnde);
    if (isFinite(te) && te > ref) ref = te;
    if (isFinite(le) && le > ref) ref = le;
    if (ref > 0 && jetzt.getTime() - ref <= EINSING_GUELTIG_MS) {
      // Ältere Daten: Minuten ohne Zeitpunkt der Eingabe können nicht mitlaufen.
      if (s.warmupMin != null && !(Number(s.warmupMinAt) > 0)) {
        s.warmupMin = null; $('ctx-warmup-min').value = ''; speichereSitzung().catch(function () { });
        einsingHinweis('Minuten seit Einsingbeginn waren ohne Zeitpunkt der Eingabe gespeichert und können nicht mitlaufen — geleert, bitte neu angeben.');
      }
      return;
    }
    s.warmup = ''; s.warmupMin = null; s.warmupMinAt = null; s.warmupAngabeAt = null;
    $('ctx-warmup').value = ''; $('ctx-warmup-min').value = ''; speichereSitzung().catch(function () { });
    einsingHinweis('Einsing-Angaben geleert: ' + (ref > 0 ? 'letzte Eingabe und letzter Take liegen ' + dauerText((jetzt.getTime() - ref) / 1000) + ' zurück' : 'unbekannt, wann sie eingegeben wurden')
      + '. Vermutlich beginnt hier eine neue Sitzung — „Neue Sitzung beginnen“ und den Einsing-Status neu angeben.');
  }
  function kontextJetzt(jetzt) {
    var p = pauseSeitLetztem(jetzt);
    return {
      id: st.sitzung ? st.sitzung.id : null,
      nr: st.sitzung ? st.sitzung.nr : null,
      startedAt: st.sitzung ? st.sitzung.startedAt : null,
      position: st.sitzung ? naechstePosition() : null,
      pauseVorherS: p.sek,
      pauseSelbeSitzung: p.selbeSitzung,
      warmup: (st.sitzung && st.sitzung.warmup) || '',
      warmupMin: einsingMinuten(jetzt)
    };
  }
  function renderKontext() {
    // Vor dem Lesen der Chronik wäre jede Nummer geraten.
    if (!st.sitzung || !st.takesGeladen) return;
    var jetzt = new Date();
    einsingPruefen(jetzt);
    var k = kontextJetzt(jetzt);
    // Das Feld zeigt den laufenden Stand — außer jemand tippt gerade darin.
    var fm = $('ctx-warmup-min');
    if (document.activeElement !== fm) fm.value = k.warmupMin == null ? '' : String(Math.round(k.warmupMin));
    $('ctx-session-nr').textContent = String(k.nr);
    $('ctx-position').textContent = String(k.position);
    var el = $('ctx-pause');
    el.textContent = k.pauseVorherS == null ? '– (erster Take)'
      : dauerText(k.pauseVorherS) + (k.pauseSelbeSitzung === false ? ' (letzter Take aus einer früheren Sitzung)' : '');
  }
  function neueSitzung() {
    var nr = (st.sitzung && st.sitzung.nr ? st.sitzung.nr : 0) + 1;
    st.sitzung = { nr: nr, id: uuid(), startedAt: new Date().toISOString(), warmup: '', warmupMin: null, warmupMinAt: null, warmupAngabeAt: null, letztePos: 0 };
    $('ctx-warmup').value = ''; $('ctx-warmup-min').value = ''; einsingHinweis('');
    /* Eine neue Sitzung heißt: andere Kette, anderer Raum, anderes Mikrofon-Gain. Die alte
       Kalibrierung darf dafür nicht mehr gelten, sonst wird SNR gegen gestern gerechnet. */
    st.calSession = false; st.cal = null;
    speichereSitzung().then(function () {
      renderKontext(); updateTakeButton(); renderCalStatus([]);
      status('Sitzung ' + nr + ' begonnen. Die Kalibrierung gilt nicht mehr — bitte neu kalibrieren.');
    });
  }

  function takeToggle() {
    if (!st.taking) {
      if ($('btn-take').disabled) return;
      /* Der Kontext wird im Moment des Starts festgehalten, nicht beim Speichern — sonst
         zählte die Dauer des Takes selbst zur Pause davor. */
      var jetzt = new Date();
      einsingPruefen(jetzt);
      st.pendingCtx = kontextJetzt(jetzt);
      st.taking = true; st.rec.beginTake(); $('btn-take').textContent = 'Take beenden'; $('btn-take').className = 'danger'; $('take-result').innerHTML = '';
      st.timer = setInterval(function () { $('take-timer').textContent = fmt(st.rec.recordedSeconds, 1) + ' s'; }, 100);
      return;
    }
    clearInterval(st.timer); st.taking = false; $('btn-take').textContent = 'Take starten'; $('btn-take').className = 'primary';
    /* Alles, was zu diesem Take gehört, wird JETZT festgehalten. Die Analyse dauert Sekunden; wer
       währenddessen schon den nächsten Take beschriftet, eine neue Sitzung beginnt oder das Gerät
       wechselt, darf damit nicht den gerade gesungenen Take umschreiben. Danach sind die Felder
       frei für den nächsten Take. */
    var feld = takeAngaben(new Date());
    st.pendingCtx = null; $('take-label').value = ''; $('take-comment').value = '';
    // Der Recorder schließt den Take mit kurzem Nachlauf ab (recorder.js endTake); bis dahin kein neuer Take.
    st.busy = true; updateTakeButton();
    Promise.resolve(st.rec.endTake()).then(function (take) {
      if (take.durationS < st.settings.minTakeS) {
        st.busy = false; updateTakeButton();
        status('Take zu kurz (' + take.durationS.toFixed(1) + ' s) — nicht gespeichert.', true);
        if (!$('take-label').value && !$('take-comment').value) { $('take-label').value = feld.label; $('take-comment').value = feld.comment; }
        return;
      }
      /* Signallücken gehören zum Take: Sie werden mit ihm gespeichert, die Analyse wertet jede Naht als Pause,
         und der Take ist überall als lückenhaft gekennzeichnet (Befund N7). Ein Recorder, der nichts über
         Lücken sagt, liefert null: unbekannt, nicht „keine“. */
      feld.signalLuecken = take.luecken ? take.luecken : null;
      finishTake(take.samples, take.sampleRate, feld);
    });
  }
  function takeAngaben(jetzt) {
    var info = (st.rec && st.rec.info) || {}, cal = st.cal, s = st.settings;
    return {
      ende: jetzt, label: $('take-label').value.trim(), comment: $('take-comment').value, vowelIntent: $('take-intent').value,
      sitzung: st.pendingCtx || kontextJetzt(jetzt), calibrationId: cal ? cal.id : null,
      info: { trackSampleRate: info.trackSampleRate || null, deviceLabel: info.deviceLabel || '', deviceId: info.deviceId || '',
        echoCancellation: info.echoCancellation, noiseSuppression: info.noiseSuppression, autoGainControl: info.autoGainControl, capture: info.capture },
      storeAudio: !!s.storeAudio, audioFormat: s.audioFormat,
      opts: { floorDb: cal ? cal.floorDb : null, gate: gateOpts(), spreadMaxHz: s.spreadMaxHz, hopS: s.hopS, yieldMs: 0 }
    };
  }
  function fehlerText(e) { return (e && (e.message || e.name)) || String(e); }
  // Stellen im Signal, an denen Abtastwerte fehlen und die Teile aneinanderstoßen (analysis.js o.naehteS).
  function nahtStellen(luecken) { return (luecken || []).filter(function (l) { return l && l.art === 'naht' && typeof l.beiS === 'number'; }).map(function (l) { return l.beiS; }); }
  function lueckeSumme(luecken) { if (!luecken) return null; var s = 0; luecken.forEach(function (l) { if (l && isFinite(l.dauerS)) s += l.dauerS; }); return s; }
  function wavRettenKnopf(box, text, name, blob) {
    var b = document.createElement('button'); b.className = 'danger'; b.textContent = text;
    b.addEventListener('click', function () { download(name, blob()); });
    box.appendChild(b);
  }
  /* Angaben eines Takes, wie sie vor der Analyse mit dem WAV gesichert werden (storage.js putPending): alles, was
     finishTake braucht, um die Analyse nach einem Neuladen genau so fortzusetzen, wie sie begonnen hätte. */
  function offenSatz(id, feld, sr, n) {
    var a = {}; for (var k in feld) a[k] = feld[k];
    a.ende = feld.ende.toISOString();
    return { id: id, createdAt: a.ende, durationS: n / sr, sampleRate: sr, angaben: a };
  }
  function angabenAus(o) { var f = {}, a = o.angaben || {}; for (var k in a) f[k] = a[k]; f.ende = new Date(a.ende || o.createdAt); return f; }
  /* offen = { id }: Die Aufnahme liegt schon gesichert in IndexedDB (Fortsetzen nach dem Neuladen). */
  function finishTake(samples, sr, feld, offen) {
    feld = feld || takeAngaben(new Date());
    st.busy = true; updateTakeButton();
    var prog = $('take-progress'); prog.hidden = false; prog.innerHTML = '<div class="skeleton"></div><div class="small muted" id="take-progress-text">' + (offen ? 'Analyse …' : 'Aufnahme wird gesichert …') + '</div>';
    var now = feld.ende, info = feld.info, wav = null, audioFehler = null, take = null, id = offen ? offen.id : uuid();
    var gesichert = !!offen, vorabText = null;
    st.inArbeit[id] = true;
    // Das WAV wird einmal erzeugt und für Sicherung, Ablage und Rettung verwendet.
    function wavBlob() { if (!wav) wav = new Blob([W.encode(samples, sr, feld.audioFormat)], { type: 'audio/wav' }); return wav; }
    /* Erst sichern, dann rechnen. Die Analyse dauert bei einem ganzen Lied Minuten; bis dahin lag die Aufnahme
       nur im Arbeitsspeicher, und Neuladen oder Schließen verwarf sie still. Jetzt liegt sie vorher mit allen
       Angaben in IndexedDB und wird nach dem Neuladen angeboten (offeneAnzeigen). Scheitert die Sicherung,
       wird trotzdem gerechnet — und gesagt, dass die Seite bis dahin offen bleiben muss. Die Stelle in der
       Sitzung gilt ab hier als vergeben: Die Aufnahme ist gesungen und gesichert. */
    var vorab = offen ? Promise.resolve() : S.putPending(offenSatz(id, feld, sr, samples.length), { sampleRate: sr, format: feld.audioFormat, blob: wavBlob() }).then(function () {
      // Erst wenn auch der Zähler gespeichert ist, beginnt die Analyse: nach einem Neuladen mitten in ihr ist
      // die Stelle dieser Aufnahme sonst wieder frei und ginge an den nächsten Take.
      gesichert = true; return zaehlerFortschreiben(feld.sitzung, now.toISOString());
    }, function (e) {
      vorabText = 'Aufnahme nicht vorab gesichert (' + fehlerText(e) + ') — bis die Analyse fertig ist, liegt sie nur im Speicher dieser Seite. Seite nicht schließen.';
      status(vorabText, true);
    });
    var opts = {}; for (var ok in feld.opts) opts[ok] = feld.opts[ok];
    opts.naehteS = nahtStellen(feld.signalLuecken);
    vorab.then(function () {
      return A.analyseTake(samples, sr, opts, function (done, total) { var t = $('take-progress-text'); if (t) t.textContent = 'Analyse ' + done + ' / ' + total + ' Rahmen'; });
    }).then(function (res) {
      return Promise.all([S.getMeta('nextCode', 0), S.allTakes()]).then(function (rr) {
        var n = A.nextCodeIndex(rr[1], rr[0]);
        var code = codeFromIndex(n), label = feld.label || defaultLabel(code, now);
        take = {
          id: id, schemaVersion: 1, code: code, label: label, comment: feld.comment, createdAt: now.toISOString(),
          durationS: samples.length / sr, sampleRate: sr, trackSampleRate: info.trackSampleRate,
          deviceLabel: info.deviceLabel, deviceId: info.deviceId, channelCount: 1,
          captureFlags: { echoCancellation: info.echoCancellation, noiseSuppression: info.noiseSuppression, autoGainControl: info.autoGainControl, capture: info.capture },
          timeLocal: wallClock(now), tzOffsetMin: tzOffsetMin(now),
          sitzung: feld.sitzung,
          vowelIntent: feld.vowelIntent, calibrationId: feld.calibrationId,
          analysis: analysisMeta(res.meta, now), history: [], summary: res.summary, hasAudio: feld.storeAudio,
          // Signallücken: [] = keine, null = unbekannt (Recorder ohne Lückenerkennung). Summe in Sekunden für die CSV.
          signalLuecken: feld.signalLuecken || null, signalLueckeS: lueckeSumme(feld.signalLuecken)
        };
        /* Take, Rahmenverlauf und WAV in einer Transaktion (storage.js putTakeSeries); die vorab gesicherte
           Aufnahme verlässt pending im selben Zug, ihr WAV bleibt (oder geht, wenn kein Audio gespeichert werden
           soll). Liegt kein WAV vorab, kommt es jetzt dazu. Scheitert die Transaktion mit dem WAV — bei knappem
           Speicher zuerst, es ist der größte Brocken —, werden Take und Verlauf ohne WAV gespeichert, und die
           Meldung sagt genau das. Früher hieß es dann „NICHT gespeichert“, obwohl Take und Verlauf in der
           Chronik standen; wer der Meldung glaubte, sang den Take ein zweites Mal. */
        var extra = { offenErledigt: gesichert, audioLoeschen: gesichert && !feld.storeAudio };
        if (feld.storeAudio && !gesichert) extra.audio = { sampleRate: sr, format: feld.audioFormat, blob: wavBlob() };
        return S.putTakeSeries(take, res.series, extra).catch(function (e) {
          if (!extra.audio) throw e;
          audioFehler = e; take.hasAudio = false; extra.audio = null;
          return S.putTakeSeries(take, res.series, extra);
        }).then(function () { zaehlerFortschreiben(take.sitzung, take.createdAt); })
          .then(function () { return S.setMeta('nextCode', n + 1); }).then(function () { return recomputeRefs(); }).then(function () {
            S.persist().catch(function () { });
            renderTakeResult(take);
            if (audioFehler) {
              status('Take ' + take.code + ' gespeichert, das WAV nicht (' + fehlerText(audioFehler) + ') — eine Neu-Analyse dieses Takes ist nicht möglich. Das WAV jetzt sichern: Knopf unter dem Ergebnis.', true);
              wavRettenKnopf($('take-result'), 'WAV dieses Takes sichern', 'vare-' + take.code + '-' + stamp(now) + '.wav', wavBlob);
            } else if (vorabText && st.statusEl && st.statusEl.textContent === vorabText) status('');
          });
      });
    }).catch(function (e) {
      /* Ist die Analyse fertig und nur das Speichern scheitert (Speicherplatz, privater Modus), liegt die
         Aufnahme gesichert in pending (dann wird sie oben zum Fortsetzen angeboten) oder nur noch im
         Arbeitsspeicher dieser Seite. In beiden Fällen ein Weg, sie zu retten, statt sie mit einer
         Fehlermeldung verschwinden zu lassen. */
      if (gesichert) status('NICHT gespeichert (' + fehlerText(e) + ') — die Aufnahme ist im Browser gesichert und steht oben unter „Unvollendete Analyse“.', true);
      else {
        status('NICHT gespeichert (' + fehlerText(e) + ') — die Aufnahme liegt nur noch im Speicher dieser Seite.', true);
        // Bezeichnung und Kommentar wurden beim Stopp geleert; stehen dort noch keine neuen, kommen sie zurück.
        if (!$('take-label').value && !$('take-comment').value) { $('take-label').value = feld.label; $('take-comment').value = feld.comment; }
      }
      var box = $('take-result'); box.innerHTML = '';
      wavRettenKnopf(box, 'Aufnahme als WAV retten', 'vare-ungespeichert-' + stamp(now) + '.wav', wavBlob);
    }).then(function () { delete st.inArbeit[id]; prog.hidden = true; st.busy = false; updateTakeButton(); return offeneAnzeigen(); });
  }
  /* Aufnahmen, deren Analyse nicht gespeichert ist — die Seite wurde während der Analyse neu geladen oder
     geschlossen, oder das Speichern scheiterte. Sie werden angeboten: fortsetzen (rechnen und speichern wie
     ein Take), das WAV sichern oder verwerfen. Was diese Seite gerade selbst rechnet, steht nicht dabei. */
  function offeneAnzeigen() {
    return S.allPending().then(function (liste) {
      st.offen = liste.filter(function (o) { return !st.inArbeit[o.id]; });
      var box = $('offene-analysen');
      if (!st.offen.length) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      box.innerHTML = '<strong>Unvollendete Analyse' + (st.offen.length > 1 ? 'n' : '') + ':</strong> Diese Aufnahmen sind im Browser gesichert, aber noch nicht ausgewertet; in der Chronik stehen sie noch nicht.'
        + st.offen.map(function (o) {
          var a = o.angaben || {};
          return '<div class="row"><span>' + CH.esc(CH.dateShort(o.createdAt)) + ' · ' + fmt(o.durationS, 1) + ' s' + (a.label ? ' · „' + CH.esc(a.label) + '“' : '') + '</span>'
            + '<button data-offen="weiter" data-id="' + CH.esc(o.id) + '">Analyse fortsetzen</button>'
            + '<button data-offen="wav" data-id="' + CH.esc(o.id) + '">WAV sichern</button>'
            + '<button data-offen="weg" data-id="' + CH.esc(o.id) + '" class="danger">Verwerfen</button></div>';
        }).join('');
    }).catch(function (e) { status('Unvollendete Analysen nicht lesbar: ' + fehlerText(e), true); });
  }
  function offenAktion(act, id) {
    var o = (st.offen || []).filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    if (act === 'wav') { S.getAudio(id).then(function (a) { if (a) download('vare-unvollendet-' + stamp(new Date(o.createdAt)) + '.wav', a.blob); else status('Zu dieser Aufnahme ist kein WAV gespeichert.', true); }); return; }
    if (act === 'weg') {
      if (!window.confirm('Aufnahme vom ' + CH.dateShort(o.createdAt) + ' endgültig verwerfen? Sie ist nicht ausgewertet und steht nicht in der Chronik.')) return;
      S.deletePending(id).then(offeneAnzeigen).catch(function (e) { status('Verwerfen fehlgeschlagen: ' + fehlerText(e), true); });
      return;
    }
    if (act !== 'weiter') return;
    if (st.busy || st.taking) { status('Erst Take, Analyse oder Neu-Analyse abwarten.', true); return; }
    S.getAudio(id).then(function (a) {
      if (!a) throw new Error('kein WAV zu dieser Aufnahme gespeichert');
      return a.blob.arrayBuffer().then(function (buf) {
        var dec = W.decode(buf);
        if (location.hash !== '#/aufnahme') location.hash = '#/aufnahme';
        finishTake(dec.samples, dec.sampleRate, angabenAus(o), { id: id });
      });
    }).catch(function (e) { status('Fortsetzen fehlgeschlagen: ' + fehlerText(e), true); });
  }
  function analysisMeta(meta, now) {
    return { kernelVersion: D.VERSION, hopS: meta.hopS, windowsS: meta.windowsS, orders: meta.orders, yinThresh: meta.yinThresh, spreadMaxHz: meta.spreadMaxHz, gate: meta.gate, floorSource: meta.floorSource, analysedAt: now.toISOString() };
  }
  function renderTakeResult(take) {
    var s = take.summary, per = s.perVowel || {}, f3u = CH.f3Unter(take);
    var luecke = CH.lueckenText(take);
    $('take-result').innerHTML = '<div class="notice">Gespeichert als <strong>' + CH.esc(take.code) + '</strong> ' + CH.esc(take.label) + ' · <a href="#/take/' + CH.esc(take.id) + '">Detail</a></div>' +
      (luecke ? '<div class="notice warn"><span class="rust">' + CH.esc(luecke) + '</span></div>' : '') +
      '<div class="small">' + CH.kontextZeile(take) + '</div>' +
      '<div class="grid">' +
      // F0 und SHR max aus sicheren Rahmen; der Rest steht in Rost daneben (wie im Detail).
      '<div class="stat' + (CH.f0Unsicher(s) ? ' unsure' : '') + '"><span class="k">F0</span><span class="v">' + fmt(s.f0.med) + ' Hz ' + CH.esc(s.f0.note) + CH.f0Zusatz(s) + '</span></div>' +
      '<div class="stat"><span class="k">F1–F5 Median</span><span class="v">' + s.F.map(function (f) { return fmt(f.med); }).join(' · ') + '</span></div>' +
      // Ohne Wertung, weil F3 sicher unter dem Mindestwert liegt: Befund, nicht Rost (wie in der Chronik).
      '<div class="stat' + (s.d34stable.n ? '' : (f3u ? ' befund' : ' unsure')) + '"><span class="k">ΔF3–4 stabil (n)</span><span class="v">' + (s.d34stable.n ? fmt(s.d34stable.med) + ' Hz (' + s.d34stable.n + ')' : (f3u ? 'nicht gewertet: F3 ' + fmt(f3u.f3) + ' Hz unter ' + fmt(f3u.schwelle) + ' Hz' : 'keine gewerteten Rahmen')) + '</span></div>' +
      '<div class="stat"><span class="k">Bestes Segment je Vokal</span><span class="v">' + (Object.keys(per).map(function (k) { return '/' + k + '/ ' + (per[k].bestSegment ? fmt(per[k].bestSegment.d34Med) : '–'); }).join(' · ') || '–') + '</span></div>' +
      '<div class="stat"><span class="k">SFR · SHR max · CPP</span><span class="v">' + fmt(s.sfr.med, 1) + ' · ' + fmt(s.shr.max, 1) + ' · ' + fmt(s.cpp.med, 1) + CH.shrZusatz(s) + '</span></div>' +
      '<div class="stat' + (s.floorSource === 'calibration' ? '' : ' unsure') + '"><span class="k">stimmhaft · gültig · stabil · SNR</span><span class="v">' + fmt(s.voicedShare * 100) + ' · ' + fmt(s.validShare * 100) + ' · ' + fmt(s.stableShare * 100) + ' % · ' + fmt(s.snrDb, 1) + ' dB</span></div>' +
      '</div>';
  }

  /* ---------- Chronik ---------- */
  function recomputeRefs() {
    // Wer die Takes neu liest, zeigt auch Schritt 0 neu: sonst stünde nach Take, Löschen oder
    // Import bis zur nächsten halben Minute die alte Nummer da.
    return S.allTakes().then(function (takes) { st.takes = takes; renderKontext(); return S.getMeta('refs', {}); }).then(function (prev) {
      var akt = rechenweise(), ueb = {};
      st.refs = A.computeRefs(st.takes, prev, akt);
      // Je Vokal: wie viele Takes mit Bestsegment übergangen sind, weil sie anders gerechnet sind.
      st.takes.forEach(function (t) {
        var per = t.summary && t.summary.perVowel;
        if (!per || !unvergleichbar(t, akt)) return;
        for (var c in per) if (per[c] && per[c].bestSegment) ueb[c] = (ueb[c] || 0) + 1;
      });
      st.refsUebergangen = ueb;
      return S.setMeta('refs', st.refs);
    });
  }
  function refreshChronik() {
    Promise.all([S.allTakes(), S.audioIds(), S.getMeta('refs', {}), S.estimate(), S.persisted()]).then(function (r) {
      st.takes = r[0]; st.audioIds = {}; (r[1] || []).forEach(function (id) { st.audioIds[id] = true; }); st.refs = r[2] || {};
      var est = r[3];
      $('chronik-storage').textContent = (est ? 'Belegt ' + bytesText(est.usage || 0) + ' von ' + bytesText(est.quota || 0) : '') + (r[4] ? ' · dauerhaft' : ' · Speicher nicht als dauerhaft markiert (Browser darf bei Platznot löschen — JSON-Sicherung anlegen)') + ' · ' + st.takes.length + ' Takes';
      CH.renderRefs($('refs-table'), st.refs, handlers, st.refsUebergangen);
      CH.renderList($('takes-list'), st.takes, st.audioIds, handlers);
      renderKontext();
    }).catch(function (e) { $('takes-list').innerHTML = '<p class="rust">Chronik nicht lesbar: ' + CH.esc(e && e.message || e) + '</p>'; });
  }
  /* Eine Neu-Analyse, gemeinsam für „Neu analysieren“ und „Alle neu analysieren“: Audio lesen, mit der
     jetzigen Rechenweise auswerten, die ganze alte Auswertung in die Historie (nicht nur zwei Felder: sonst
     ist nicht mehr nachvollziehbar, mit welchen Schwellen der alte Wert entstand). Geschrieben wird der Take,
     wie er JETZT in der Chronik steht — Bezeichnung oder Kommentar können sich während der Analyse geändert
     haben; ist er inzwischen gelöscht, wird nichts geschrieben. abbrechen: siehe analysis.js analyseTake.
     Liefert { take, geaendert }. */
  function neuAuswerten(id, fortschritt, abbrechen) {
    return S.getTake(id).then(function (t0) {
      if (!t0) throw new Error('Take nicht mehr vorhanden');
      return Promise.all([S.getAudio(id), t0.calibrationId ? S.allCalibrations() : Promise.resolve([])]).then(function (r) {
        var a = r[0], cal = r[1].filter(function (c) { return c.id === t0.calibrationId; })[0] || null;
        if (!a) throw new Error('kein Audio gespeichert');
        return a.blob.arrayBuffer().then(function (buf) {
          var dec = W.decode(buf);
          // Die Nähte des Takes gelten auch bei jeder Neu-Analyse als Pause: das WAV enthält sie.
          return A.analyseTake(dec.samples, dec.sampleRate, { floorDb: cal ? cal.floorDb : null, gate: gateOpts(), spreadMaxHz: st.settings.spreadMaxHz, hopS: st.settings.hopS, abbrechen: abbrechen, naehteS: nahtStellen(t0.signalLuecken) }, fortschritt);
        });
      });
    }).then(function (res) {
      /* Lesen, Historie anhängen, Take und Rahmenverlauf schreiben: eine Transaktion. Getrennt geschrieben,
         stand nach einem Abbruch zwischen beiden eine neue Zusammenfassung neben dem alten Verlauf. */
      var geaendert = [];
      return S.updateTakeSeries(id, function (take) {
        var neu = analysisMeta(res.meta, new Date()), alt = take.analysis || {};
        geaendert = [];
        take.history = (take.history || []).concat([{ analysis: take.analysis, summary: take.summary }]);
        if (alt.gate && neu.gate && alt.gate.f3MinHz !== neu.gate.f3MinHz) geaendert.push('F3-Mindestwert ' + alt.gate.f3MinHz + ' → ' + neu.gate.f3MinHz + ' Hz');
        if (alt.spreadMaxHz !== neu.spreadMaxHz) geaendert.push('Streuungsgrenze ' + alt.spreadMaxHz + ' → ' + neu.spreadMaxHz + ' Hz');
        if (alt.hopS !== neu.hopS) geaendert.push('Rahmenabstand ' + alt.hopS + ' → ' + neu.hopS + ' s');
        if (alt.kernelVersion !== neu.kernelVersion) geaendert.push('Kern ' + alt.kernelVersion + ' → ' + neu.kernelVersion);
        take.summary = res.summary; take.analysis = neu; take.reanalysisNote = geaendert.join(', ');
        return take;
      }, res.series).then(function (take) {
        if (!take) throw new Error('Take während der Neu-Analyse gelöscht');
        return { take: take, geaendert: geaendert };
      });
    });
  }
  function takeName(t) { return t.code + ' (' + CH.dateShort(t.createdAt) + ')'; }
  /* „Alle neu analysieren“: jeder Take mit gespeichertem Audio nacheinander, genau wie die Einzel-Neu-Analyse.
     Takes ohne Audio lassen sich nicht neu rechnen: Sie werden genannt und bleiben, wie sie sind — anders
     gerechnet, wenn sie es waren. Abbrechen wirkt vor dem nächsten Block, auch mitten in einem Take; dieser
     bleibt dann unverändert, die schon fertigen bleiben neu. Danach werden die Referenzen neu bestimmt. */
  var alleLauf = null;
  /* Während des Laufs keine Sicherung und kein Import: Ein Export hielte einen Zwischenstand fest (halb alte,
     halb neue Takes), ein Import fügte Takes hinzu, die der Lauf nicht mehr rechnet. Knöpfe gesperrt, und
     wer die Funktion trotzdem erreicht, bekommt den Grund statt eines halben Ergebnisses. */
  var SPERR_KNOEPFE = ['btn-export-csv', 'btn-export-json', 'btn-import-json'];
  function alleSperre(an) { SPERR_KNOEPFE.forEach(function (id) { $(id).disabled = an; }); }
  function gesperrtImLauf() {
    if (!alleLauf) return false;
    status('Während „Alle neu analysieren“ läuft, sind Export und Import gesperrt — den Lauf abwarten oder abbrechen.', true);
    return true;
  }
  function alleNeuAnalysieren() {
    if (st.busy || st.taking) { status('Erst Take, Analyse oder Neu-Analyse abwarten.', true); return; }
    var box = $('reanalyse-all'), text = $('reanalyse-all-text'), knopf = $('btn-reanalyse-all'), stopp = $('btn-reanalyse-abbruch');
    Promise.all([S.allTakes(), S.audioIds()]).then(function (r) {
      var mitAudio = {}; (r[1] || []).forEach(function (id) { mitAudio[id] = true; });
      var liste = r[0].filter(function (t) { return mitAudio[t.id]; }).reverse(), ohne = r[0].filter(function (t) { return !mitAudio[t.id]; }).reverse();
      var sek = liste.reduce(function (a, t) { return a + (t.durationS || 0); }, 0);
      // Ohne Audio: nennen, und sagen, ob sie anders gerechnet bleiben.
      var ohneText = function () {
        if (!ohne.length) return '';
        var anders = ohne.filter(function (t) { return unvergleichbar(t); });
        return ' Ohne Audio, nicht neu zu rechnen: ' + ohne.map(takeName).join(', ') + '.'
          + (anders.length ? ' Davon bleiben anders gerechnet: ' + anders.map(function (t) { return takeName(t) + ' — ' + unvergleichbar(t); }).join('; ') + '.' : '');
      };
      if (!liste.length) { box.hidden = false; text.textContent = 'Kein Take mit gespeichertem Audio — nichts neu zu analysieren.' + ohneText(); stopp.hidden = true; return; }
      if (!window.confirm('Alle ' + liste.length + ' Takes mit Audio (zusammen ' + dauerText(sek) + ') mit Kern ' + D.VERSION + ' und den jetzigen Einstellungen neu analysieren? Die bisherige Auswertung bleibt je Take in der Historie.'
        + (ohne.length ? ' ' + ohne.length + ' Takes ohne Audio bleiben, wie sie sind.' : ''))) return;
      var lauf = alleLauf = { abbruch: false }, neu = [], fehl = [], i = 0;
      st.busy = true; updateTakeButton(); alleSperre(true);
      knopf.disabled = true; stopp.hidden = false; stopp.disabled = false; box.hidden = false;
      var zeige = function (t, done, total) { text.textContent = 'Neu-Analyse ' + i + ' von ' + liste.length + ': ' + takeName(t) + (total ? ' — ' + done + ' / ' + total + ' Rahmen' : ' …'); };
      function naechster() {
        if (lauf.abbruch || i >= liste.length) return Promise.resolve();
        var t = liste[i++];
        zeige(t, 0, 0);
        return neuAuswerten(t.id, function (done, total) { zeige(t, done, total); }, function () { return lauf.abbruch; })
          .then(function (x) { neu.push(x.take); }, function (e) { if (!(e && e.abgebrochen)) fehl.push(takeName(t) + ': ' + (e && e.message || e)); })
          .then(function () { if (location.hash === '#/chronik') refreshChronik(); return naechster(); });
      }
      return naechster().then(recomputeRefs).then(function () {
        var rest = liste.length - neu.length - fehl.length;
        var msg = (lauf.abbruch ? 'Neu-Analyse abgebrochen: ' : 'Alle neu analysiert: ') + neu.length + ' von ' + liste.length + ' Takes mit Kern ' + D.VERSION + ' neu gerechnet'
          + (neu.length ? ' (' + neu.map(function (t) { return t.code; }).join(', ') + ')' : '') + '.'
          + (lauf.abbruch && rest ? ' ' + rest + ' unverändert: ' + liste.slice(liste.length - rest).map(takeName).join(', ') + '.' : '')
          + (fehl.length ? ' Fehlgeschlagen, unverändert: ' + fehl.join('; ') + '.' : '') + ohneText() + ' Referenzen neu bestimmt.';
        text.textContent = msg; status(msg, lauf.abbruch || fehl.length > 0 || ohne.some(function (t) { return unvergleichbar(t); }));
      }).catch(function (e) { text.textContent = 'Neu-Analyse gestoppt: ' + (e && e.message || e); status(text.textContent, true); })
        .then(function () { st.busy = false; alleLauf = null; alleSperre(false); knopf.disabled = false; stopp.hidden = true; updateTakeButton(); if (location.hash === '#/chronik') refreshChronik(); });
    }).catch(function (e) { status('Chronik nicht lesbar: ' + (e && e.message || e), true); });
  }
  function alleAbbrechen() {
    if (!alleLauf) return;
    alleLauf.abbruch = true; $('btn-reanalyse-abbruch').disabled = true;
    $('reanalyse-all-text').textContent += ' — wird abgebrochen';
  }
  var handlers = {
    rowCsv: function (take) { download('vare-' + take.code + '-' + stamp(new Date(take.createdAt)) + '.csv', new Blob([C.takesToCsv([take], st.settings.csvDialect)], { type: 'text/csv;charset=utf-8' })); },
    frameCsv: function (take, series) { if (!series) return; download('vare-' + take.code + '-rahmen.csv', new Blob([C.framesToCsv(series, st.settings.csvDialect, V)], { type: 'text/csv;charset=utf-8' })); },
    downloadWav: function (take) { S.getAudio(take.id).then(function (a) { if (a) download('vare-' + take.code + '-' + stamp(new Date(take.createdAt)) + '.wav', a.blob); }); },
    reanalyse: function (take) {
      if (st.busy) { status('Gerade läuft eine Analyse — Neu-Analyse von ' + take.code + ' danach.', true); return; }
      st.busy = true; status('Neu-Analyse von ' + take.code + ' …');
      neuAuswerten(take.id, null, null).then(function (x) { return recomputeRefs().then(function () { return x.geaendert; }); })
        .then(function (geaendert) { status('Neu analysiert: ' + take.code + (geaendert && geaendert.length ? ' — geändert: ' + geaendert.join(', ') : ' (gleiche Einstellungen)')); st.busy = false; route(); })
        .catch(function (e) { st.busy = false; status('Neu-Analyse fehlgeschlagen: ' + (e && e.message || e), true); });
    },
    remove: function (take) {
      if (!window.confirm('Take ' + take.code + ' „' + take.label + '“ endgültig löschen?')) return;
      S.deleteTake(take.id).then(recomputeRefs).then(function () { if (/^#\/take\//.test(location.hash)) location.hash = '#/chronik'; else refreshChronik(); });
    },
    unvergleichbar: function (take) { return unvergleichbar(take); },
    unpinRef: function (cls) { if (st.refs[cls]) { st.refs[cls].pinned = false; } S.setMeta('refs', st.refs).then(recomputeRefs).then(refreshChronik); },
    pinRef: function (cls, take) {
      var b = take.summary && take.summary.perVowel && take.summary.perVowel[cls] && take.summary.perVowel[cls].bestSegment;
      if (!b) return;
      var uv = unvergleichbar(take);
      if (uv) { status('Nicht angepinnt: Take ' + take.code + ' ist anders gerechnet als jetzt eingestellt (' + uv + '). Erst neu analysieren.', true); return; }
      if (A.lueckenhaft(take)) { status('Nicht angepinnt: Take ' + take.code + ' hat eine Signallücke — eine unvollständige Aufnahme ist keine Referenz.', true); return; }
      st.refs[cls] = { d34: b.d34Med, takeId: take.id, code: take.code, label: take.label, date: take.createdAt, startS: b.startS, lenS: b.lenS, pinned: true };
      // Gleich neu bestimmen: computeRefs prüft den Pin wie jeden anderen (z. B. zweideutiges Bestsegment).
      S.setMeta('refs', st.refs).then(recomputeRefs).then(function () {
        var r = st.refs[cls];
        if (r && r.verwaist) status('Referenz /' + cls + '/ angepinnt, aber verwaist: ' + r.grund, true);
        else status('Referenz /' + cls + '/ angepinnt: ' + fmt(r ? r.d34 : b.d34Med) + ' Hz aus ' + take.code);
        route();
      });
    },
    /* take ist der Stand beim Öffnen des Details. Zurückgeschrieben wird nicht er, sondern der Take, wie er
       JETZT gespeichert ist, mit den Notizfeldern — sonst machte eine Notiz eine inzwischen gelaufene
       Neu-Analyse rückgängig (Kern, Historie, Zusammenfassung), und der neue Rahmenverlauf stünde neben der
       alten Zusammenfassung. Lesen und Schreiben in einer Transaktion (storage.js updateTake). */
    saveEdit: function (take, edit) {
      S.updateTake(take.id, function (t) {
        t.label = edit.label || t.label; t.vowelIntent = edit.vowelIntent; t.comment = edit.comment;
        /* Einsing-Status darf nachgetragen werden — er fällt beim Singen oft hinten runter.
           Die gerechneten Felder (Uhrzeit, Stelle, Pause) bleiben unberührt: die kann man
           nicht nachträglich wissen, und geraten werden sie nicht. */
        if (edit.warmup !== undefined) {
          if (!t.sitzung) t.sitzung = { id: null, nr: null, startedAt: null, position: null, pauseVorherS: null, pauseSelbeSitzung: null, warmup: '', warmupMin: null };
          t.sitzung.warmup = edit.warmup || ''; t.sitzung.warmupMin = edit.warmupMin;
        }
        return t;
      }).then(function (t) {
        if (!t) throw new Error('Take ' + take.code + ' ist nicht mehr in der Chronik');
        return recomputeRefs();
      }).then(function () { status('Gespeichert.'); route(); })
        .catch(function (e) { status('Nicht gespeichert: ' + (e && e.message || e), true); });
    }
  };
  function openDetail(id) {
    var el = $('take-detail'); el.innerHTML = '<div class="skeleton"></div>';
    Promise.all([S.getTake(id), S.getSeries(id), S.hasAudio(id), S.getMeta('refs', {})]).then(function (r) {
      if (!r[0]) { el.innerHTML = '<p class="rust">Take nicht gefunden. <a href="#/chronik">Chronik</a></p>'; return; }
      st.refs = r[3] || {};
      CH.renderDetail(el, r[0], r[1], st.refs, r[2], handlers);
    }).catch(function (e) { el.innerHTML = '<p class="rust">' + CH.esc(e && e.message || e) + '</p>'; });
  }
  function exportCsv() { if (gesperrtImLauf()) return; S.allTakes().then(function (takes) { download('vare-chronik-' + stamp(new Date()) + '.csv', new Blob([C.takesToCsv(takes, st.settings.csvDialect)], { type: 'text/csv;charset=utf-8' })); }); }
  function exportJson() {
    if (gesperrtImLauf()) return;
    var offenZahl = 0;
    Promise.all([S.allTakes(), S.allCalibrations(), S.getMeta('refs', {}), S.audioIds(), S.allPending()]).then(function (r) {
      /* Nur das WAV von Takes: Unvollendete Aufnahmen (pending) liegen mit ihrem WAV im selben Laden, gehören
         aber nicht in die Sicherung der Chronik. Dass sie fehlen, wird nach dem Sichern gesagt. */
      var takes = r[0], withAudio = false, takeIds = {};
      takes.forEach(function (t) { takeIds[t.id] = true; });
      var ids = (r[3] || []).filter(function (id) { return takeIds[id]; });
      offenZahl = (r[4] || []).length;
      var seriesP = Promise.all(takes.map(function (t) { return S.getSeries(t.id); }));
      var audioP = Promise.resolve({});
      if (ids.length) {
        return Promise.all(ids.map(function (id) { return S.getAudio(id); })).then(function (auds) {
          var bytes = auds.reduce(function (a, b) { return a + (b ? b.bytes : 0); }, 0);
          /* Die ganze Sicherung entsteht in einem einzigen JSON.stringify. Chrome und Edge können
             höchstens 2^29−24 ≈ 537 Mio. Zeichen in einem String halten; Base64 braucht 4 Zeichen
             je 3 Byte, also ist bei etwa 70 Minuten 16-Bit-Audio Schluss. Vorher sagen, statt
             hinterher mit „Invalid string length“ zu scheitern. */
          var b64Chars = Math.ceil(bytes / 3) * 4, MAXCHARS = 450e6;
          if (b64Chars > MAXCHARS) {
            withAudio = false;
            status('Audio kann nicht mitgesichert werden: ' + bytesText(bytes) + ' ergeben ' + Math.round(b64Chars / 1e6) + ' Mio. Zeichen, der Browser hält höchstens ' + Math.round(MAXCHARS / 1e6) + ' Mio. in einer Datei (etwa 70 min 16-Bit-Audio). Die Sicherung enthält nur die Messwerte; die WAVs einzeln über die Chronik sichern.', true);
          } else withAudio = window.confirm('Audio mitsichern? ' + ids.length + ' WAV-Dateien, etwa ' + bytesText(bytes * 1.37) + ' zusätzlich. (Abbrechen = nur Messwerte)');
          if (withAudio) audioP = Promise.all(auds.map(function (a) { return a.blob.arrayBuffer().then(function (buf) { return [a.takeId, b64FromBuffer(buf)]; }); })).then(function (pairs) { var o = {}; pairs.forEach(function (p) { o[p[0]] = p[1]; }); return o; });
          return [takes, r[1], r[2], seriesP, audioP];
        });
      }
      return [takes, r[1], r[2], seriesP, audioP];
    }).then(function (x) {
      return Promise.all([x[3], x[4]]).then(function (sa) {
        var series = {}; x[0].forEach(function (t, i) { if (sa[0][i]) series[t.id] = sa[0][i]; });
        var text = C.serializeBackup({ takes: x[0], series: series, refs: x[2], calibrations: x[1], settings: st.settings, kernelVersion: D.VERSION, exportedAt: new Date().toISOString(), audio: sa[1] });
        download('vare-sicherung-' + stamp(new Date()) + '.json', new Blob([text], { type: 'application/json' }));
        if (offenZahl) status('Sicherung ohne ' + offenZahl + (offenZahl === 1 ? ' unvollendete Aufnahme' : ' unvollendete Aufnahmen') + ' (oben unter „Unvollendete Analyse“): erst fortsetzen oder das WAV einzeln sichern.', true);
      });
    }).catch(function (e) { status('Sicherung fehlgeschlagen: ' + (e && e.message || e), true); });
  }
  function importJson(file) {
    if (gesperrtImLauf()) return;
    file.text().then(function (text) {
      var b = C.parseBackup(text), added = 0, skipped = 0, doppelt = [];
      return S.allTakes().then(function (existing) {
        var have = {}, codeDa = {}; existing.forEach(function (t) { have[t.id] = true; codeDa['c:' + t.code] = true; });
        var chain = Promise.resolve();
        b.takes.forEach(function (t) {
          if (have[t.id]) { skipped++; return; }
          added++;
          /* Eine Sicherung aus einem anderen Browser oder von einer anderen Adresse kann Codes tragen,
             die es hier schon gibt. Umbenannt wird nicht — der Code steht in CSV-Exporten und Notizen —,
             aber die Doppelung wird gesagt statt still hingenommen. */
          if (codeDa['c:' + t.code]) doppelt.push(t.code);
          codeDa['c:' + t.code] = true;
          // Take, Verlauf und WAV eines Takes in einer Transaktion: ein abgebrochener Import hinterlässt keine halben Takes.
          chain = chain.then(function () { return S.putTakeSeries(t, b.series[t.id] || null, b.audio[t.id] ? { audio: { sampleRate: t.sampleRate, format: 'wav', blob: blobFromB64(b.audio[t.id]) } } : null); });
        });
        (b.calibrations || []).forEach(function (c) { chain = chain.then(function () { return S.putCalibration(c); }); });
        return chain;
      }).then(recomputeRefs).then(function () {
        // Angepinnte Referenzen der Sicherung NACH recomputeRefs einmischen — vorher wären sie
        // sofort wieder vom automatischen Minimum überschrieben.
        if (!b.refs) return '';
        return S.getMeta('refs', {}).then(function (local) {
          var gemischt = [];
          for (var cls in b.refs) {
            if (!b.refs[cls] || !b.refs[cls].pinned) continue;
            if (local[cls] && local[cls].pinned) continue;
            local[cls] = b.refs[cls]; gemischt.push(cls);
          }
          /* Und dann prüfen wie jede andere: Ein Pin aus der Sicherung, dessen Take fehlt oder anders
             gerechnet ist, darf nicht ungeprüft Zielmarke werden. */
          st.refs = A.computeRefs(st.takes, local, rechenweise());
          var pin = 0, verw = 0, weg = 0;
          gemischt.forEach(function (c) { var r = st.refs[c]; if (r && r.pinned) { pin++; if (r.verwaist) verw++; } else weg++; });
          return S.setMeta('refs', st.refs).then(function () {
            return (pin ? ', ' + pin + ' angepinnte Referenz(en) übernommen' + (verw ? ' (' + verw + ' davon verwaist, Grund in der Chronik)' : '') : '')
              + (weg ? ', ' + weg + ' angepinnte Referenz(en) nicht übernommen (ihr Take oder sein Bestsegment fehlt)' : '');
          });
        });
      }).then(function (pinText) {
        status('Import: ' + added + ' Takes übernommen, ' + skipped + ' schon vorhanden (übersprungen)' + pinText + '.'
          + (doppelt.length ? ' Achtung: ' + (doppelt.length === 1 ? '1 übernommener Take trägt' : doppelt.length + ' übernommene Takes tragen') + ' einen Code, den es hier schon gibt (' + doppelt.join(', ') + ') — die Sicherung stammt wohl aus einem anderen Browser oder von einer anderen Adresse. Die Codes bleiben, wie sie sind; diese Takes über Datum und Bezeichnung unterscheiden.' : ''),
          doppelt.length > 0);
        refreshChronik();
      });
    }).catch(function (e) { status('Import fehlgeschlagen: ' + (e && e.message || e), true); });
  }
  /* „Alles löschen“ löscht die Chronik — Takes, Verläufe, Audio, Kalibrierungen, Referenzen —, aber
     nicht ihre Zählung. Ginge der Code-Zähler mit, hieße der nächste Take wieder A, und nach dem
     Einspielen der Sicherung stünden zwei Takes A in der Chronik. Behalten wird der höhere von
     gespeichertem Zähler und vorhandenen Codes, damit auch importierte Takes zählen.
     Sitzung und Einstellungen sind keine Chronik: im Speicher der Seite laufen sie weiter, gelöscht
     kämen sie nach dem Neuladen still als „Sitzung 1“ und als Vorgabewerte zurück. */
  function clearAll() {
    // Ein Take, der gerade aufgenommen oder analysiert wird, würde nach dem Löschen gespeichert —
    // mit einem Code, den der behaltene Zähler nicht kennt.
    if (st.taking || st.busy) { status('Erst Take und Analyse abwarten, dann löschen.', true); return; }
    if (!window.confirm('Wirklich die gesamte Chronik dieses Browsers löschen? Vorher JSON-Sicherung anlegen!')) return;
    if (!window.confirm('Letzte Frage: alles löschen?')) return;
    Promise.all([S.allTakes(), S.getMeta('nextCode', 0), S.getMeta('settings', null)]).then(function (r) {
      var behalten = { nextCode: A.nextCodeIndex(r[0], r[1]) };
      if (r[2]) behalten.settings = r[2];
      if (st.sitzung) behalten.sitzung = st.sitzung;
      return S.clearAll(behalten);
    }).then(function () {
      st.refs = {}; st.refsUebergangen = {}; st.cal = null; st.calSession = false; renderCalStatus([]);
      // Die Kalibrierung ist mitgelöscht. Ohne diesen Aufruf bliebe der Take-Knopf frei, während
      // daneben „Ohne Kalibrierung ist kein Take möglich“ steht.
      updateTakeButton();
      refreshChronik(); offeneAnzeigen(); status('Chronik gelöscht. Codes und Stelle in der Sitzung zählen weiter.');
    }).catch(function (e) { status('Löschen fehlgeschlagen: ' + (e && e.message || e), true); });
  }

  /* ---------- Prüfsignal ---------- */
  function pruefsignal() {
    if (st.busy) return; st.busy = true; updateTakeButton();
    var F = [700, 1200, 2500, 3300, 4200], B = [80, 90, 120, 150, 200], sr = 48000, out = $('pruef-out');
    out.innerHTML = '<div class="skeleton"></div>';
    var sig = D.synthVowel(196, F, B, 2.0, sr), pad0 = new Float64Array(Math.round(0.3 * sr)), all = new Float64Array(sig.length + 2 * pad0.length);
    for (var i = 0; i < pad0.length; i++) pad0[i] = (Math.random() * 2 - 1) * 1e-3;
    all.set(pad0, 0); all.set(sig, pad0.length); all.set(pad0, pad0.length + sig.length);
    A.analyseTake(all, sr, { gate: gateOpts(), spreadMaxHz: st.settings.spreadMaxHz, hopS: st.settings.hopS }).then(function (res) {
      var s = res.summary, rows = F.map(function (f, k) { var m = s.F[k].med, e = Math.abs(m - f); return '<tr><td>F' + (k + 1) + '</td><td class="num">' + f + '</td><td class="num">' + fmt(m) + '</td><td class="num ' + (e >= 60 ? 'rust' : '') + '">' + fmt(e) + '</td></tr>'; });
      var d = s.d34stable.n ? s.d34stable.med : s.d34.med, de = Math.abs(d - 800);
      rows.push('<tr><td>ΔF3–4</td><td class="num">800</td><td class="num">' + fmt(d) + '</td><td class="num ' + (de >= 120 ? 'rust' : '') + '">' + fmt(de) + '</td></tr>');
      rows.push('<tr><td>F0</td><td class="num">196</td><td class="num">' + fmt(s.f0.med, 1) + '</td><td class="num">' + fmt(Math.abs(s.f0.med - 196), 1) + '</td></tr>');
      out.innerHTML = '<table><thead><tr><th>Größe</th><th class="num">Soll (Hz)</th><th class="num">Gemessen</th><th class="num">Fehler</th></tr></thead><tbody>' + rows.join('') + '</tbody></table><p class="small muted">Abnahmegrenze 60 Hz je Formant, 120 Hz für ΔF3–4 (Rost = gerissen). Vokalklasse gemessen: /' + CH.esc(s.vowel.dominant || '–') + '/, stabil ' + fmt(s.stableShare * 100) + ' %, gültig ' + fmt(s.validShare * 100) + ' %. Nicht gespeichert.</p>';
    }).catch(function (e) { out.innerHTML = '<p class="rust">' + CH.esc(e && e.message || e) + '</p>'; }).then(function () { st.busy = false; updateTakeButton(); });
  }

  /* ---------- Anmeldung am privaten Korpus ---------- */
  /* Die öffentliche Seite zeigt vor der Verbindung nur das Token-Feld. Erst wenn korpus.json
     gelesen ist, erscheint die Oberfläche — und mit ihr die persönlichen Marken, die nirgends
     im öffentlichen Code stehen. */
  function zeigeApp(an) {
    $('anmeldung').hidden = an; $('app').hidden = !an; $('nav').hidden = !an;
  }
  function verbinden(token, merken) {
    var fehler = $('anmeldung-fehler'), stand = $('anmeldung-stand'), knopf = $('btn-verbinden');
    fehler.textContent = ''; stand.textContent = 'verbinde …'; knopf.disabled = true;
    return KO.laden(token).then(function (korpus) {
      st.korpus = korpus;
      CH.setMarken(korpus.marken);
      if (merken !== null) KO.tokenSchreiben(token, !!merken);
      /* Der Korpus liefert die Ausgangswerte, überschreibt aber nichts, was hier am Regler
         verstellt wurde — sonst wäre jede Einstellung nach dem nächsten Neuladen wieder weg.
         Weicht ein verstellter Wert ab, wird das gesagt statt still entschieden. */
      var abweichend = [];
      for (var k in korpus.gatter) {
        if (st.settings[k] == null) continue;
        if (st.touched[k]) { if (st.settings[k] !== korpus.gatter[k]) abweichend.push(k + ' ' + st.settings[k] + ' statt ' + korpus.gatter[k]); }
        else st.settings[k] = korpus.gatter[k];
      }
      st.gate = V.createGate(gateOpts());
      saveSettings(); renderSettings(); refsSpaeter();
      stand.textContent = ''; zeigeApp(true);
      $('korpus-stand').textContent = 'Korpus vom ' + (korpus.stand || '?') + ' · ' + korpus.marken.length + ' Marken'
        + (abweichend.length ? ' · hier abweichend eingestellt: ' + abweichend.join(', ') : '');
      $('live-hints').textContent = hintText();
      route();
    }).catch(function (e) {
      stand.textContent = ''; fehler.textContent = (e && e.message) || String(e);
      zeigeApp(false);
    }).then(function () { knopf.disabled = false; });
  }
  function abmelden() {
    // Mitten in Take oder Kalibrierung nicht: das Mikrofon dabei abzuschalten, verdürbe die Aufnahme.
    if (st.taking || st.calRunning) { status(st.taking ? 'Erst den Take beenden, dann das Token entfernen.' : 'Erst die Kalibrierung abwarten, dann das Token entfernen.', true); return; }
    KO.tokenLoeschen(); st.korpus = null;
    CH.setMarken([]);
    /* Nichts aus korpus.json bleibt sichtbar: die Kopfzeile nennt Stand und Gatterwerte des Korpus.
       Der Haken geht auf „nicht merken“ zurück — wer neu verbindet, entscheidet neu. */
    $('korpus-stand').textContent = ''; $('token-merken').checked = false;
    // Mikrofon wirklich aus, mit Knopf und Live-Feldern — sonst stand nach erneutem Verbinden
    // „Mikrofon stoppen“ da, während nichts mehr lief.
    if (st.rec && st.rec.active) mikrofonAus('Token entfernt');
    cancelAnimationFrame(st.raf);
    $('token').value = ''; zeigeApp(false);
    status('Token entfernt. Die Chronik bleibt in diesem Browser erhalten.');
  }

  /* ---------- Start ---------- */
  function init() {
    $('kernel-version').textContent = D.VERSION;
    $('korpus-repo').textContent = KO.REPO; $('korpus-repo-2').textContent = KO.REPO;
    $('anmeldung-file').hidden = location.protocol !== 'file:';
    $('btn-verbinden').addEventListener('click', function () { verbinden($('token').value.trim(), $('token-merken').checked); });
    $('token').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btn-verbinden').click(); });
    $('btn-abmelden').addEventListener('click', abmelden);
    $('origin-name').textContent = location.origin === 'null' ? 'file://' : location.origin;
    $('notice-file').hidden = location.protocol !== 'file:';
    var sel = $('take-intent'); sel.innerHTML = '<option value="">–</option>' + V.CENTROIDS.map(function (c) { return '<option value="' + c.cls + '">/' + c.cls + '/</option>'; }).join('');
    loadSettings().then(function () {
      renderSettings(); renderCalStatus([]); updateTakeButton(); $('live-hints').textContent = hintText();
      // Gemerktes Token: still versuchen. Schlägt es fehl, bleibt die Anmeldung stehen.
      var gemerkt = KO.tokenLesen();
      /* Der Haken zeigt, WO das Token liegt, nicht DASS eines da ist. Stets gesetzt, landete ein Token,
         das nur für diesen Tab galt, beim nächsten Verbinden dauerhaft im localStorage — den teilen
         sich alle Pages-Projekte desselben Kontos. */
      if (gemerkt) { $('token').value = gemerkt; $('token-merken').checked = KO.tokenGemerkt(); verbinden(gemerkt, null); }
      else zeigeApp(false);
      S.allCalibrations().then(function (all) { if (all.length) { var c = all[0]; $('cal-status').innerHTML += ' <span class="muted">Letzte gespeicherte Kalibrierung: ' + CH.esc(CH.dateShort(c.createdAt)) + ', Boden ' + fmt(c.floorDb, 1) + ' dBFS, SNR ' + fmt(c.snrDb, 1) + ' dB — für diese Sitzung neu kalibrieren.</span>'; } }).catch(function () { });
    });
    $('btn-mic').addEventListener('click', micToggle);
    $('btn-cal').addEventListener('click', calibrate);
    $('btn-take').addEventListener('click', takeToggle);
    $('btn-neue-sitzung').addEventListener('click', neueSitzung);
    /* Einsing-Status und -Dauer gelten für die ganze Sitzung, nicht nur für den nächsten Take —
       sie werden deshalb mitgespeichert und sind nach einem Neuladen noch da. */
    $('ctx-warmup').addEventListener('change', function () {
      if (!st.sitzung) return;
      st.sitzung.warmup = $('ctx-warmup').value; st.sitzung.warmupAngabeAt = Date.now();
      einsingHinweis(''); speichereSitzung();
    });
    $('ctx-warmup-min').addEventListener('change', function () {
      if (!st.sitzung) return;
      var v = $('ctx-warmup-min').value.trim(), n = v === '' ? null : Number(v), jetzt = Date.now();
      st.sitzung.warmupMin = (n != null && isFinite(n) && n >= 0) ? n : null;
      // Ab dem Zeitpunkt der Eingabe zählen die Minuten weiter.
      st.sitzung.warmupMinAt = st.sitzung.warmupMin == null ? null : jetzt;
      st.sitzung.warmupAngabeAt = jetzt;
      if (st.sitzung.warmupMin == null) $('ctx-warmup-min').value = '';
      einsingHinweis(''); speichereSitzung();
    });
    /* Sitzung UND Takes lesen, bevor ein Take möglich ist: Stelle in der Sitzung und Pause davor
       kommen aus der Chronik. Bis dahin bleibt der Take-Knopf gesperrt (updateTakeButton). */
    ladeSitzung().then(function (si) {
      return S.allTakes().then(function (alle) {
        st.takes = alle; st.takesGeladen = true;
        $('ctx-warmup').value = si.warmup || '';
        renderKontext(); updateTakeButton();
        /* Gespeicherte Referenzen können von einer früheren Fassung oder anderen Einstellungen stammen.
           Live gilt erst, was mit der jetzigen Rechenweise bestimmt ist. */
        recomputeRefs().catch(function () { });
        offeneAnzeigen();
        /* Die Pause läuft weiter, während die Seite offen steht. Sie wird deshalb jede halbe
           Minute neu angezeigt — festgehalten wird sie erst beim Take-Start. */
        st.ctxTimer = setInterval(renderKontext, 30000);
      });
    }).catch(function (e) {
      st.kontextFehler = (e && e.message) || String(e);
      updateTakeButton();
      status('Chronik nicht lesbar (' + st.kontextFehler + ') — ohne sie sind Stelle in der Sitzung und Pause unbekannt, deshalb ist kein Take möglich.', true);
    });
    $('btn-pruef').addEventListener('click', pruefsignal);
    $('btn-settings-reset').addEventListener('click', function () {
      st.settings = Object.assign({}, SETTINGS_DEFAULT); st.touched = {};
      if (st.korpus) for (var k in st.korpus.gatter) if (st.settings[k] != null) st.settings[k] = st.korpus.gatter[k];
      st.gate = V.createGate(gateOpts()); saveSettings(); renderSettings(); updateTakeButton(); $('live-hints').textContent = hintText(); refsSpaeter();
    });
    $('btn-export-csv').addEventListener('click', exportCsv);
    $('btn-export-json').addEventListener('click', exportJson);
    $('btn-import-json').addEventListener('click', function () { if (!gesperrtImLauf()) $('file-import').click(); });
    $('file-import').addEventListener('change', function (e) { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; });
    $('btn-clear-all').addEventListener('click', clearAll);
    $('btn-reanalyse-all').addEventListener('click', alleNeuAnalysieren);
    $('btn-reanalyse-abbruch').addEventListener('click', alleAbbrechen);
    $('offene-analysen').addEventListener('click', function (e) {
      var b = e.target, act = b && b.getAttribute ? b.getAttribute('data-offen') : null;
      if (act) offenAktion(act, b.getAttribute('data-id'));
    });
    /* Während Aufnahme, Analyse oder Neu-Analyse fragt der Browser vor dem Verlassen nach. Eine laufende
       Aufnahme ginge sonst ganz verloren, eine laufende Analyse müsste nach dem Neuladen von vorn beginnen. */
    window.addEventListener('beforeunload', function (e) {
      if (!st.taking && !st.busy) return undefined;
      e.preventDefault(); e.returnValue = '';
      return '';
    });
    window.addEventListener('hashchange', route);
    window.addEventListener('resize', function () { if (st.rec && st.rec.active) return; drawHist(); });
    fillDevices();
    var fl0 = floorNow(); drawLevel(NaN, fl0.db, fl0.src); drawD34({ state: 'pause', score: NaN }, null); drawSpec({ voiced: false, F: [], valid: [], BW: [] }, null); drawHist();
  }
  window.VAREAPP = { state: st, init: init, finishTake: finishTake, handlers: handlers, refreshChronik: refreshChronik, SETTINGS_DEFAULT: SETTINGS_DEFAULT };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

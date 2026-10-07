/* VARE — Aufnahme über getUserMedia + AudioContext (nur Browser).
   Vorgaben: echoCancellation, noiseSuppression, autoGainControl aus, ein Kanal, native Abtastrate.
   Erfassung über AudioWorklet (recorder-worklet.js), Rückfall ScriptProcessorNode.
   Hält einen Ringpuffer (2 s) für die Live-Anzeige und sammelt während eines Takes alle Blöcke. */
(function (root) {
  'use strict';

  /* Lücken im Take. Fehlen mitten im Take Abtastwerte (Gerät gewechselt, USB- oder Bluetooth-Aussetzer,
     Kontext angehalten), setzt die Aufnahme die Teile davor und danach ohne Pause aneinander. Über einer
     Atempause entstand so ein gehaltener Tonsprung, der in Gold als sicherer Befund dastand, und der Take
     wurde wie jeder andere gespeichert (Befund N7). Erkannt wird an jedem Stück, das recorder-worklet.js
     schickt (Rahmenzähler f und Uhrzeit t im Audiofaden):
     - Rahmen ohne Eingang: Der Rahmenzähler springt weiter, als Abtastwerte da sind. Genau, auf den Abtastwert.
     - Zeit ohne Rahmen: Der Kontext stand (angehalten, Gerätewechsel). Die Uhr läuft dem Rahmenzähler davon.
       Verglichen wird die Untergrenze des Verzugs über die folgenden FENSTER_S: Ein Stück, das nur spät
       kommt, weil der Audiofaden kurz hing und dann aufholt, ist so kein Verlust. Eine Stufe ab NAHT_MIN_S zählt.
     - Anfang und Ende: Kam das erste Stück erst deutlich nach dem Start oder das letzte deutlich vor dem
       Stopp, fehlt dort Signal (ab RAND_MIN_S, der Schwelle der Live-Warnung „kein Signal“).
     Ohne Rahmenzähler (Rückfall ScriptProcessor, ältere Worklet-Datei im Cache) gilt die Ankunftszeit im
     Hauptfaden; dort kann ein langer Hänger der Seite eine Lücke vortäuschen, nie eine verdecken.
     Ergebnis: [{ beiS (Stelle im aufgenommenen Signal), dauerS (fehlende Zeit), art: 'anfang'|'naht'|'ende' }]. */
  var NAHT_MIN_S = 0.1, RAND_MIN_S = 0.3, FENSTER_S = 0.5, ENDE_WARTEN_MS = 600;
  function lueckenAus(b, sr) {
    var n = b.pos.length, out = [], k, j;
    if (!n || !(sr > 0)) return out;
    var mitRahmen = true;
    for (k = 0; k < n; k++) if (!isFinite(b.frame[k])) { mitRahmen = false; break; }
    var kopf = (b.zeit[0] - b.t0) / 1000 - b.len[0] / sr;
    if (kopf > RAND_MIN_S) out.push({ beiS: 0, dauerS: kopf, art: 'anfang' });
    // Audiouhr am Ende jedes Stücks (relativ zum ersten) und Verzug der Uhrzeit dagegen.
    var a = [], lag = [], lvl = [], maxLen = 0;
    for (k = 0; k < n; k++) {
      a.push(mitRahmen ? (b.frame[k] + b.len[k] - b.frame[0] - b.len[0]) / sr : (b.pos[k] + b.len[k] - b.pos[0] - b.len[0]) / sr);
      lag.push((b.zeit[k] - b.zeit[0]) / 1000 - a[k]);
      if (b.len[k] > maxLen) maxLen = b.len[k];
    }
    for (k = 0; k < n; k++) { var m = lag[k]; for (j = k + 1; j < n && a[j] - a[k] <= FENSTER_S; j++) if (lag[j] < m) m = lag[j]; lvl.push(m); }
    for (k = 1; k < n; k++) {
      var fehlt = 0;
      if (mitRahmen) { var sprung = b.frame[k] - (b.frame[k - 1] + b.len[k - 1]); if (sprung > 0) fehlt += sprung / sr; }
      if (lvl[k] - lvl[k - 1] > NAHT_MIN_S) fehlt += lvl[k] - lvl[k - 1];
      if (fehlt > 0) out.push({ beiS: b.pos[k] / sr, dauerS: fehlt, art: 'naht' });
    }
    var schwanz = (b.tEnde - b.zeit[n - 1]) / 1000;
    if (schwanz - maxLen / sr > RAND_MIN_S) out.push({ beiS: (b.pos[n - 1] + b.len[n - 1]) / sr, dauerS: schwanz, art: 'ende' });
    return out;
  }

  function createRecorder() {
    var ctx = null, stream = null, source = null, node = null, sink = null;
    var ring = null, ringPos = 0, ringFilled = 0, sampleRate = 0;
    var chunks = [], recording = false, listeners = [], info = null, samplesSeen = 0;
    var log = null, ende = null;   // Stücke des laufenden Takes (Stelle, Rahmen, Uhrzeit, Länge); wartender Stopp

    // f: Rahmenzähler des ersten Abtastwerts, t: Uhrzeit beim Absenden (ms); fehlen sie, die Ankunft hier.
    function onBlock(buf, f, t) {
      if (!isFinite(t)) t = Date.now();
      samplesSeen += buf.length;
      for (var i = 0; i < buf.length; i++) { ring[ringPos] = buf[i]; ringPos = (ringPos + 1) % ring.length; }
      ringFilled = Math.min(ring.length, ringFilled + buf.length);
      if (recording) {
        var teil = buf;
        // Nach dem Stopp abgeschickt: nur, was vor dem Stopp aufgenommen ist (Abtastwert j entstand um t − (n−1−j)/sr).
        if (ende && t > ende.bis) teil = buf.subarray(0, Math.max(0, Math.min(buf.length, buf.length - Math.ceil((t - ende.bis) / 1000 * sampleRate))));
        if (teil.length) {
          var vor = 0; for (var c = 0; c < chunks.length; c++) vor += chunks[c].length;
          log.pos.push(vor); log.frame.push(isFinite(f) ? f : NaN); log.zeit.push(t); log.len.push(teil.length);
          chunks.push(teil);
        }
        if (ende && t > ende.bis) ende.schluss();
      }
      for (var l = 0; l < listeners.length; l++) listeners[l](buf, sampleRate);
    }

    function start(deviceId) {
      var constraints = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } };
      if (deviceId) constraints.audio.deviceId = { exact: deviceId };
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('getUserMedia nicht verfügbar — HTTPS oder http://localhost nötig, nicht file://'));
      return navigator.mediaDevices.getUserMedia(constraints).then(function (s) {
        stream = s;
        var track = s.getAudioTracks()[0], st = track.getSettings ? track.getSettings() : {};
        ctx = new (root.AudioContext || root.webkitAudioContext)();
        sampleRate = ctx.sampleRate;
        ring = new Float32Array(Math.round(2 * sampleRate)); ringPos = 0; ringFilled = 0;
        info = {
          deviceLabel: track.label || '(unbenannt)', deviceId: st.deviceId || '', sampleRate: sampleRate, trackSampleRate: st.sampleRate || null,
          echoCancellation: st.echoCancellation, noiseSuppression: st.noiseSuppression, autoGainControl: st.autoGainControl, channelCount: st.channelCount,
          capture: null
        };
        source = ctx.createMediaStreamSource(s);
        sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
        var p = (ctx.audioWorklet && ctx.audioWorklet.addModule) ? ctx.audioWorklet.addModule('./recorder-worklet.js').then(function () {
          node = new AudioWorkletNode(ctx, 'vare-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
          node.port.onmessage = function (ev) { var d = ev.data; if (d && d.s) onBlock(d.s, d.f, d.t); else onBlock(d, NaN, NaN); };
          info.capture = 'AudioWorklet';
        }) : Promise.reject(new Error('kein AudioWorklet'));
        return p.catch(function () {
          var sp = ctx.createScriptProcessor(4096, 1, 1);
          sp.onaudioprocess = function (ev) { onBlock(Float32Array.from(ev.inputBuffer.getChannelData(0)), NaN, NaN); };
          node = sp; info.capture = 'ScriptProcessor';
        }).then(function () {
          source.connect(node); node.connect(sink);
          return ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
        }).then(function () { return info; });
      });
    }

    function stop() {
      try { if (node) node.disconnect(); if (source) source.disconnect(); if (sink) sink.disconnect(); } catch (e) { /* egal */ }
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      var c = ctx; ctx = null; stream = null; node = null; source = null;
      if (ende) ende.schluss(); else recording = false;
      return c ? c.close().catch(function () { }) : Promise.resolve();
    }

    function beginTake() { chunks = []; recording = true; ende = null; log = { t0: Date.now(), tEnde: NaN, pos: [], frame: [], zeit: [], len: [] }; }
    function abschluss() {
      recording = false;
      var n = 0, i;
      for (i = 0; i < chunks.length; i++) n += chunks[i].length;
      var out = new Float32Array(n), o = 0;
      for (i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].length; }
      chunks = [];
      return { samples: out, sampleRate: sampleRate, durationS: n / sampleRate, luecken: log ? lueckenAus(log, sampleRate) : [] };
    }
    /* Liefert ein Promise. Gestoppt wird zur Uhrzeit des Aufrufs; Stücke, die davor abgeschickt, aber noch
       nicht angekommen sind (beschäftigter Hauptfaden), gehören noch dazu. Gewartet wird bis zum ersten Stück
       danach, höchstens ENDE_WARTEN_MS — sonst schnitte ein Hänger der Seite das Ende ab und täuschte dort eine
       Lücke vor. */
    function endTake() {
      if (!recording) return Promise.resolve(abschluss());
      if (log) log.tEnde = Date.now();
      if (!ctx) return Promise.resolve(abschluss());
      return new Promise(function (resolve) {
        var h = 0;
        ende = { bis: log.tEnde, schluss: function () { if (!ende) return; clearTimeout(h); ende = null; resolve(abschluss()); } };
        h = setTimeout(ende.schluss, ENDE_WARTEN_MS);
      });
    }
    function latest(seconds) {
      var n = Math.min(ring ? ring.length : 0, Math.round(seconds * sampleRate), ringFilled), out = new Float32Array(n);
      if (!n) return out;
      var start = (ringPos - n + ring.length) % ring.length;
      if (start + n <= ring.length) out.set(ring.subarray(start, start + n));
      else { var first = ring.length - start; out.set(ring.subarray(start)); out.set(ring.subarray(0, n - first), first); }
      return out;
    }

    return {
      start: start, stop: stop, beginTake: beginTake, endTake: endTake, latest: latest,
      onChunk: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
      get info() { return info; }, get sampleRate() { return sampleRate; }, get active() { return !!ctx; }, get recording() { return recording; },
      get recordedSeconds() { var n = 0; for (var i = 0; i < chunks.length; i++) n += chunks[i].length; return n / (sampleRate || 1); },
      get samplesSeen() { return samplesSeen; }
    };
  }

  function listDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices().then(function (ds) { return ds.filter(function (d) { return d.kind === 'audioinput'; }); });
  }

  root.VARERECORDER = { createRecorder: createRecorder, listDevices: listDevices, lueckenAus: lueckenAus, NAHT_MIN_S: NAHT_MIN_S, RAND_MIN_S: RAND_MIN_S };
})(typeof self !== 'undefined' ? self : this);

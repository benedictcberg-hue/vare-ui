/* VARE — Aufnahme über getUserMedia + AudioContext (nur Browser).
   Vorgaben: echoCancellation, noiseSuppression, autoGainControl aus, ein Kanal, native Abtastrate.
   Erfassung über AudioWorklet (recorder-worklet.js), Rückfall ScriptProcessorNode.
   Hält einen Ringpuffer (2 s) für die Live-Anzeige und sammelt während eines Takes alle Blöcke. */
(function (root) {
  'use strict';

  function createRecorder() {
    var ctx = null, stream = null, source = null, node = null, sink = null;
    var ring = null, ringPos = 0, ringFilled = 0, sampleRate = 0;
    var chunks = [], recording = false, takeStart = 0, listeners = [], info = null, samplesSeen = 0;

    function onBlock(buf) {
      samplesSeen += buf.length;
      for (var i = 0; i < buf.length; i++) { ring[ringPos] = buf[i]; ringPos = (ringPos + 1) % ring.length; }
      ringFilled = Math.min(ring.length, ringFilled + buf.length);
      if (recording) chunks.push(buf);
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
          node.port.onmessage = function (ev) { onBlock(ev.data); };
          info.capture = 'AudioWorklet';
        }) : Promise.reject(new Error('kein AudioWorklet'));
        return p.catch(function () {
          var sp = ctx.createScriptProcessor(4096, 1, 1);
          sp.onaudioprocess = function (ev) { onBlock(Float32Array.from(ev.inputBuffer.getChannelData(0))); };
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
      var c = ctx; ctx = null; stream = null; node = null; source = null; recording = false;
      return c ? c.close().catch(function () { }) : Promise.resolve();
    }

    function beginTake() { chunks = []; recording = true; takeStart = ctx ? ctx.currentTime : 0; }
    function endTake() {
      recording = false;
      var n = 0, i;
      for (i = 0; i < chunks.length; i++) n += chunks[i].length;
      var out = new Float32Array(n), o = 0;
      for (i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].length; }
      chunks = [];
      return { samples: out, sampleRate: sampleRate, durationS: n / sampleRate };
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

  root.VARERECORDER = { createRecorder: createRecorder, listDevices: listDevices };
})(typeof self !== 'undefined' ? self : this);

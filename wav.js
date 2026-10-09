/* VARE — WAV lesen und schreiben (RIFF/WAVE, PCM 16/24/32 Bit und Float32, auch WAVE_FORMAT_EXTENSIBLE).
   Läuft im Browser (window.VAREWAV) und unter Node (module.exports). Keine Abhängigkeiten. */
(function (root) {
  'use strict';

  function writeStr(view, off, s) { for (var i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }

  /* samples: Float32Array oder Float64Array (−1..1), mono. format: 'f32' (Vorgabe: bitgleich mit dem
     Float32-Puffer des Browsers), 'i24' (24 Bit PCM, Begrenzung auf ±1) oder 'i16' (16 Bit, nur noch zum
     Lesen alter Takes gedacht; schreibt weiter, damit nichts bricht). Der Chronik-Standard verlangt
     Geräterate und 24 Bit oder Float32 — der Browser darf nicht schlechter liefern als die Nacharbeit braucht. */
  function encode(samples, sampleRate, format) {
    format = format || 'f32';
    var n = samples.length, bps = format === 'f32' ? 4 : (format === 'i24' ? 3 : 2), dataLen = n * bps;
    var buf = new ArrayBuffer(44 + dataLen), v = new DataView(buf);
    writeStr(v, 0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); writeStr(v, 8, 'WAVE');
    writeStr(v, 12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, format === 'f32' ? 3 : 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * bps, true);
    v.setUint16(32, bps, true); v.setUint16(34, bps * 8, true);
    writeStr(v, 36, 'data'); v.setUint32(40, dataLen, true);
    var off = 44;
    if (format === 'f32') { for (var i = 0; i < n; i++, off += 4) v.setFloat32(off, samples[i], true); }
    else if (format === 'i24') {
      for (var m = 0; m < n; m++, off += 3) {
        var q = Math.max(-1, Math.min(1, samples[m])), w = Math.min(8388607, Math.round(q * 8388608));   // Rückweg teilt durch 8388608 (wie TwistedWave, Praat)
        if (w < 0) w += 0x1000000;
        v.setUint8(off, w & 255); v.setUint8(off + 1, (w >> 8) & 255); v.setUint8(off + 2, (w >> 16) & 255);
      }
    }
    else {
      for (var j = 0; j < n; j++, off += 2) {
        var s = Math.max(-1, Math.min(1, samples[j]));
        v.setInt16(off, Math.round(s * 32767), true);          // symmetrisch, Rückweg teilt durch 32767
      }
    }
    return buf;
  }

  /* Liefert { sampleRate, channels, bitsPerSample, format, samples: Float32Array (Mono-Mischung) }. */
  function decode(buf) {
    var v = new DataView(buf), off = 12, fmt = null, data = null;
    function tag(o) { return String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)); }
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Keine WAV-Datei (RIFF/WAVE fehlt)');
    while (off + 8 <= v.byteLength) {
      var id = tag(off), len = v.getUint32(off + 4, true), body = off + 8;
      if (id === 'fmt ') {
        var tagFmt = v.getUint16(body, true), ch = v.getUint16(body + 2, true), sr = v.getUint32(body + 4, true), bits = v.getUint16(body + 14, true);
        if (tagFmt === 0xFFFE && len >= 26) tagFmt = v.getUint16(body + 24, true);   // EXTENSIBLE: Subformat
        fmt = { tag: tagFmt, channels: ch, sampleRate: sr, bits: bits };
      } else if (id === 'data') {
        data = { off: body, len: Math.min(len, v.byteLength - body) };
      }
      off = body + len + (len & 1);
    }
    if (!fmt || !data) throw new Error('WAV ohne fmt- oder data-Block');
    var bytes = fmt.bits / 8, frames = Math.floor(data.len / (bytes * fmt.channels)), out = new Float32Array(frames);
    var isFloat = fmt.tag === 3;
    if (!isFloat && fmt.tag !== 1) throw new Error('WAV-Format ' + fmt.tag + ' nicht unterstützt (nur PCM und Float)');
    for (var f = 0; f < frames; f++) {
      var acc = 0;
      for (var c = 0; c < fmt.channels; c++) {
        var p = data.off + (f * fmt.channels + c) * bytes, s;
        if (isFloat) s = bytes === 8 ? v.getFloat64(p, true) : v.getFloat32(p, true);
        else if (bytes === 2) s = v.getInt16(p, true) / 32767;
        else if (bytes === 3) { var u = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16); if (u & 0x800000) u -= 0x1000000; s = u / 8388608; }
        else if (bytes === 4) s = v.getInt32(p, true) / 2147483648;
        else if (bytes === 1) s = (v.getUint8(p) - 128) / 128;
        else throw new Error('Bittiefe ' + fmt.bits + ' nicht unterstützt');
        acc += s;
      }
      out[f] = acc / fmt.channels;
    }
    return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, format: isFloat ? 'f32' : 'pcm', samples: out };
  }

  var api = { encode: encode, decode: decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VAREWAV = api;
})(typeof self !== 'undefined' ? self : this);

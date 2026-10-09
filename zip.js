/* VARE — ZIP schreiben (nur „stored“, ohne Kompression), für das Übergabepaket je Take: WAV, take.json, frames.csv,
   ereignisse.csv in einer Datei. Läuft im Browser (window.VAREZIP) und unter Node (module.exports). Keine Abhängigkeiten.
   Kein Deflate: Das WAV ist der größte Teil und als Float32 kaum zu komprimieren; die CSV wird für die Ablage im Repo
   getrennt mit gzip (CompressionStream des Browsers) gepackt. ZIP64 gibt es nicht: über 4 GB wirft encode. */
(function (root) {
  'use strict';

  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function utf8(s) { if (typeof TextEncoder === 'function') return new TextEncoder().encode(s); return new Uint8Array(Buffer.from(s, 'utf8')); }
  function dosZeit(d) {
    var t = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31);
    var j = Math.max(1980, d.getFullYear()), dt = (((j - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { t: t, d: dt };
  }

  /* dateien: [{ name, data: Uint8Array|ArrayBuffer|string }], zeit: Date (Vorgabe jetzt). Liefert ArrayBuffer. */
  function encode(dateien, zeit) {
    var z = dosZeit(zeit || new Date()), teile = [], zentral = [], offset = 0, i, k;
    function u32(v, o, p) { v.setUint32(p, o >>> 0, true); }
    for (i = 0; i < dateien.length; i++) {
      var f = dateien[i], data = f.data;
      if (typeof data === 'string') data = utf8(data);
      else if (data instanceof ArrayBuffer) data = new Uint8Array(data);
      else if (ArrayBuffer.isView(data) && !(data instanceof Uint8Array)) data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      var name = utf8(String(f.name)), crc = crc32(data), lokal = new DataView(new ArrayBuffer(30 + name.length));
      if (data.length >= 0xFFFFFFFF || offset + 30 + name.length + data.length >= 0xFFFFFFFF) throw new Error('ZIP über 4 GB nicht unterstützt');
      u32(lokal, 0x04034b50, 0); lokal.setUint16(4, 20, true); lokal.setUint16(6, 0x0800, true); lokal.setUint16(8, 0, true);
      lokal.setUint16(10, z.t, true); lokal.setUint16(12, z.d, true); u32(lokal, crc, 14); u32(lokal, data.length, 18); u32(lokal, data.length, 22);
      lokal.setUint16(26, name.length, true); lokal.setUint16(28, 0, true);
      var lk = new Uint8Array(lokal.buffer); lk.set(name, 30);
      var zd = new DataView(new ArrayBuffer(46 + name.length));
      u32(zd, 0x02014b50, 0); zd.setUint16(4, 20, true); zd.setUint16(6, 20, true); zd.setUint16(8, 0x0800, true); zd.setUint16(10, 0, true);
      zd.setUint16(12, z.t, true); zd.setUint16(14, z.d, true); u32(zd, crc, 16); u32(zd, data.length, 20); u32(zd, data.length, 24);
      zd.setUint16(28, name.length, true); zd.setUint16(30, 0, true); zd.setUint16(32, 0, true); zd.setUint16(34, 0, true); zd.setUint16(36, 0, true); u32(zd, 0, 38); u32(zd, offset, 42);
      var zk = new Uint8Array(zd.buffer); zk.set(name, 46);
      teile.push(lk, data); zentral.push(zk);
      offset += lk.length + data.length;
    }
    var zgroesse = 0;
    for (k = 0; k < zentral.length; k++) zgroesse += zentral[k].length;
    var ende = new DataView(new ArrayBuffer(22));
    u32(ende, 0x06054b50, 0); ende.setUint16(4, 0, true); ende.setUint16(6, 0, true); ende.setUint16(8, dateien.length, true); ende.setUint16(10, dateien.length, true);
    u32(ende, zgroesse, 12); u32(ende, offset, 16); ende.setUint16(20, 0, true);
    var gesamt = offset + zgroesse + 22, out = new Uint8Array(gesamt), o = 0;
    for (i = 0; i < teile.length; i++) { out.set(teile[i], o); o += teile[i].length; }
    for (k = 0; k < zentral.length; k++) { out.set(zentral[k], o); o += zentral[k].length; }
    out.set(new Uint8Array(ende.buffer), o);
    return out.buffer;
  }

  /* Liest ein ZIP ohne Kompression zurück (für die Prüfung): [{ name, data: Uint8Array }]. Deflate wird abgewiesen. */
  function decode(buf) {
    var v = new DataView(buf), n = v.byteLength, e = n - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Kein ZIP (Endsatz fehlt)');
    var anzahl = v.getUint16(e + 10, true), start = v.getUint32(e + 16, true), out = [], p = start;
    for (var i = 0; i < anzahl; i++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP: zentraler Eintrag ' + i + ' fehlt');
      var methode = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), groesse = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), kl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
      if (methode !== 0) throw new Error('ZIP: Kompression ' + methode + ' nicht unterstützt');
      var name = new Uint8Array(buf, p + 46, nl), nameS = typeof TextDecoder === 'function' ? new TextDecoder('utf-8').decode(name) : Buffer.from(name).toString('utf8');
      var lnl = v.getUint16(lo + 26, true), lxl = v.getUint16(lo + 28, true), data = new Uint8Array(buf, lo + 30 + lnl + lxl, groesse);
      if (crc32(data) !== crc) throw new Error('ZIP: Prüfsumme von ' + nameS + ' falsch');
      out.push({ name: nameS, data: data });
      p += 46 + nl + xl + kl;
    }
    return out;
  }

  var api = { encode: encode, decode: decode, crc32: crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VAREZIP = api;
})(typeof self !== 'undefined' ? self : this);

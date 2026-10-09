/* VARE — Verbindung zum privaten Korpus (nur Browser).
   Diese Seite ist öffentlich und enthält keine Messwerte. Die persönlichen Marken — die eigenen
   Bestwerte für ΔF3–4, die Zielschwelle für F3, die Gatterschwellen — liegen im privaten Repo und
   werden zur Laufzeit mit einem Token des Nutzers gelesen. Das Token bleibt im Browser und geht
   ausschließlich an api.github.com; die Content-Security-Policy lässt nichts anderes zu.
   Gelesen wird korpus.json. Geschrieben wird zweierlei: nach jeder gelungenen Kalibrierung eine
   kleine JSON-Datei mit den Messwerten nach data/input/, und nach jedem gespeicherten Take sein
   Übergabepaket ohne WAV (take.json, frames.csv.gz, ereignisse.csv) nach data/takes/<id>/ — so ist
   der Take im Repo lesbar, ohne Upload (Chronik-Standard 2.6). Kein Audio geht ins Repo. Die Chronik
   selbst bleibt im Browser. */
(function (root) {
  'use strict';

  var REPO = 'benedictcberg-hue/vare-tools';   // privates Repo, kein Geheimnis
  var DATEI = 'korpus.json';
  var ZWEIG = 'main';
  var SPEICHER = 'vare-token';
  var ABLAGE = 'data/input';
  var ABLAGE_TAKES = 'data/takes';

  function b64ToText(b64) {
    var bin = atob(b64.replace(/\s+/g, '')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function erklaereFehler(status, nachricht) {
    if (status === 401) return 'Token abgelehnt (401). Ist es abgelaufen oder vertippt?';
    if (status === 403) return 'Keine Berechtigung (403). Das Token braucht „Contents: Read“ auf ' + REPO + '. ' + (nachricht || '');
    if (status === 404) return 'Nicht gefunden (404). Entweder kennt das Token das Repo ' + REPO + ' nicht, oder die Datei ' + DATEI + ' fehlt dort.';
    if (status === 0) return 'Keine Verbindung zu api.github.com.';
    return 'Unerwartete Antwort (' + status + '). ' + (nachricht || '');
  }

  function pruefeKorpus(o) {
    if (!o || typeof o !== 'object') throw new Error(DATEI + ' ist kein Objekt.');
    if (o.format !== 'vare-korpus') throw new Error(DATEI + ' trägt nicht die Kennung „vare-korpus“.');
    if (o.version !== 1) throw new Error('Korpus-Version ' + o.version + ' ist unbekannt.');
    var marken = (o.marken && o.marken.d34) || [];
    if (!Array.isArray(marken)) throw new Error('marken.d34 ist keine Liste.');
    var sauber = [];
    for (var i = 0; i < marken.length; i++) {
      var m = marken[i], hz = (typeof m === 'number') ? m : (m && m.hz);
      if (typeof hz !== 'number' || !isFinite(hz) || hz <= 0 || hz > 4000) continue;
      sauber.push({ hz: hz, text: (m && typeof m.text === 'string') ? m.text : '' });
    }
    var g = o.gatter && typeof o.gatter === 'object' ? o.gatter : {};
    var gatter = {};
    ['windowS', 'sdF1Max', 'sdF2Max', 'minValidShare', 'f3MinHz', 'smooth', 'spreadMaxHz', 'hopS'].forEach(function (k) {
      if (typeof g[k] === 'number' && isFinite(g[k])) gatter[k] = g[k];
    });
    return { marken: sauber, gatter: gatter, stand: typeof o.stand === 'string' ? o.stand : '', notiz: typeof o.notiz === 'string' ? o.notiz : '' };
  }

  /* Liest korpus.json aus dem privaten Repo. Liefert Promise<{marken, gatter, stand, notiz}>. */
  function laden(token) {
    if (!token || !/^[A-Za-z0-9_.-]{20,}$/.test(token)) return Promise.reject(new Error('Das sieht nicht wie ein GitHub-Token aus.'));
    var url = 'https://api.github.com/repos/' + REPO + '/contents/' + encodeURIComponent(DATEI) + '?ref=' + encodeURIComponent(ZWEIG);
    return fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      cache: 'no-store', referrerPolicy: 'no-referrer'
    }).catch(function () { throw new Error(erklaereFehler(0)); }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (b) { throw new Error(erklaereFehler(r.status, b && b.message)); });
      return r.json();
    }).then(function (b) {
      if (!b || typeof b.content !== 'string') throw new Error(DATEI + ' kam ohne Inhalt zurück (zu groß?).');
      var text;
      try { text = b64ToText(b.content); } catch (e) { throw new Error(DATEI + ' ist nicht als UTF-8 lesbar.'); }
      var o;
      try { o = JSON.parse(text); } catch (e) { throw new Error(DATEI + ' ist kein gültiges JSON: ' + e.message); }
      return pruefeKorpus(o);
    });
  }

  /* ---------- Ablage der Kalibrierung im privaten Repo ---------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function zahl(v, dec) { return (typeof v === 'number' && isFinite(v)) ? Number(v.toFixed(dec)) : null; }

  /* Die Datei, die nach einer Kalibrierung ins Repo geht: Uhrzeit und Messwerte, sonst nichts.
     Der Gerätename bleibt draußen, er kann persönliche Namen enthalten. Fehlende Werte sind null. */
  function kalibrierungsDatei(rec) {
    var d = new Date(rec.createdAt);
    if (isNaN(d.getTime())) d = new Date();
    var lokal = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    var stempel = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
    var kurz = String(rec.id || '').replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'ohneid';
    var o = {
      format: 'vare-kalibrierung', version: 1, id: String(rec.id || ''),
      zeit: d.toISOString(), zeitLokal: lokal, utcAbstandMin: -d.getTimezoneOffset(),
      kernVersion: String(rec.kernelVersion || ''), abtastrateHz: zahl(rec.sampleRate, 0),
      rauschbodenDbfs: zahl(rec.floorDb, 1), pegelADbfs: zahl(rec.levelDb, 1), snrDb: zahl(rec.snrDb, 1),
      snrBand0bis2000HzDb: zahl(rec.bandSnr && rec.bandSnr.low, 1),
      snrBand2400bis3200HzDb: zahl(rec.bandSnr && rec.bandSnr.sf, 1),
      ausklangDbProS: zahl(rec.decayDbPerS, 0),
      formantenA_Hz: [0, 1, 2].map(function (k) { return zahl(rec.F && rec.F[k], 0); })
    };
    return { pfad: ABLAGE + '/kalibrierung-' + stempel + '-' + kurz + '.json', inhalt: JSON.stringify(o, null, 2) + '\n', zeitLokal: lokal };
  }

  function textZuB64(text) { return bytesZuB64(new TextEncoder().encode(text)); }
  // Base64 beliebiger Bytes (frames.csv.gz), stückweise: String.fromCharCode.apply nimmt nicht unbegrenzt viele Argumente.
  function bytesZuB64(bytes) {
    var u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), s = '';
    for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, Math.min(u.length, i + 0x8000)));
    return btoa(s);
  }
  /* Die Dateien des Übergabepakets eines Takes für die Ablage: [{ pfad, inhalt | inhaltB64, nachricht }] unter
     data/takes/<id>/. paket = C.takePaket(…) ohne WAV; framesGz: Uint8Array mit frames.csv als gzip (oder null — dann
     geht frames.csv ungepackt). Der Pfadteil ist die Take-ID; sie trägt nur a–z, 0–9 und Bindestriche (csv.js takeId),
     ältere UUID-Kennungen ebenso. */
  function takeDateien(id, paket, framesGz) {
    if (!/^[A-Za-z0-9-]+$/.test(String(id))) throw new Error('Take-ID für die Ablage ungeeignet: ' + id);
    var ordner = ABLAGE_TAKES + '/' + id + '/', out = [];
    for (var i = 0; i < paket.length; i++) {
      var f = paket[i], kurz = f.name.replace(/^.*?\.(take\.json|frames\.csv|ereignisse\.csv|haltetoene\.csv)$/, '$1');
      if (kurz === 'frames.csv' && framesGz) out.push({ pfad: ordner + 'frames.csv.gz', inhaltB64: bytesZuB64(framesGz), nachricht: 'Take ' + id + ': frames.csv.gz' });
      else out.push({ pfad: ordner + kurz, inhalt: f.text, nachricht: 'Take ' + id + ': ' + kurz });
    }
    return out;
  }

  function erklaereSchreibfehler(status, nachricht) {
    if (status === 401) return 'Token abgelehnt (401). Ist es abgelaufen?';
    if (status === 403) return 'Das Token darf nicht schreiben (403). Es braucht „Contents: Read and write“ auf ' + REPO + '.';
    if (status === 404) return 'Nicht gefunden (404). Das Token kennt das Repo ' + REPO + ' nicht oder darf dort nicht schreiben.';
    if (status === 0) return 'Keine Verbindung zu api.github.com.';
    return 'Unerwartete Antwort (' + status + '). ' + (nachricht || '');
  }

  /* Legt eine Datei neu an. Gibt es sie schon (422, gleiche Kalibrierung zweimal geschickt),
     gilt das als erledigt — überschrieben wird nie. Liefert Promise<'neu'|'schon da'>. */
  function ablegen(token, datei) {
    if (!token) return Promise.reject(new Error('Kein Token — erst verbinden.'));
    var url = 'https://api.github.com/repos/' + REPO + '/contents/' + datei.pfad.split('/').map(encodeURIComponent).join('/');
    return fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: datei.nachricht || ('Kalibrierung ' + (datei.zeitLokal || '')), content: datei.inhaltB64 || textZuB64(datei.inhalt), branch: ZWEIG }),
      cache: 'no-store', referrerPolicy: 'no-referrer'
    }).catch(function () { throw new Error(erklaereSchreibfehler(0)); }).then(function (r) {
      if (r.status === 201 || r.status === 200) return 'neu';
      if (r.status === 422) return 'schon da';
      return r.json().catch(function () { return {}; }).then(function (b) { throw new Error(erklaereSchreibfehler(r.status, b && b.message)); });
    });
  }

  function tokenLesen() {
    try { return root.localStorage.getItem(SPEICHER) || root.sessionStorage.getItem(SPEICHER) || ''; } catch (e) { return ''; }
  }
  /* „Gemerkt“ heißt: dauerhaft im localStorage. Ein Token nur in sessionStorage gilt bis zum Schließen
     des Tabs und ist nicht gemerkt — der Haken darf es dann nicht behaupten. */
  function tokenGemerkt() {
    try { return !!root.localStorage.getItem(SPEICHER); } catch (e) { return false; }
  }
  function tokenSchreiben(token, dauerhaft) {
    try {
      root.localStorage.removeItem(SPEICHER); root.sessionStorage.removeItem(SPEICHER);
      (dauerhaft ? root.localStorage : root.sessionStorage).setItem(SPEICHER, token);
    } catch (e) { /* privater Modus: dann eben nur für diese Seite im Arbeitsspeicher */ }
  }
  function tokenLoeschen() {
    try { root.localStorage.removeItem(SPEICHER); root.sessionStorage.removeItem(SPEICHER); } catch (e) { }
  }

  root.VAREKORPUS = { REPO: REPO, DATEI: DATEI, ABLAGE: ABLAGE, ABLAGE_TAKES: ABLAGE_TAKES, laden: laden, kalibrierungsDatei: kalibrierungsDatei, takeDateien: takeDateien, bytesZuB64: bytesZuB64, ablegen: ablegen, erklaereSchreibfehler: erklaereSchreibfehler, pruefeKorpus: pruefeKorpus, erklaereFehler: erklaereFehler,
    tokenLesen: tokenLesen, tokenGemerkt: tokenGemerkt, tokenSchreiben: tokenSchreiben, tokenLoeschen: tokenLoeschen };
})(typeof self !== 'undefined' ? self : this);

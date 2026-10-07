/* VARE — Verbindung zum privaten Korpus (nur Browser).
   Diese Seite ist öffentlich und enthält keine Messwerte. Die persönlichen Marken — die eigenen
   Bestwerte für ΔF3–4, die Zielschwelle für F3, die Gatterschwellen — liegen im privaten Repo und
   werden zur Laufzeit mit einem Token des Nutzers gelesen. Das Token bleibt im Browser und geht
   ausschließlich an api.github.com; die Content-Security-Policy lässt nichts anderes zu.
   Gelesen wird, nie geschrieben: die Chronik bleibt im Browser, nichts verlässt das Gerät. */
(function (root) {
  'use strict';

  var REPO = 'benedictcberg-hue/vare-tools';   // privates Repo, kein Geheimnis
  var DATEI = 'korpus.json';
  var ZWEIG = 'main';
  var SPEICHER = 'vare-token';

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

  root.VAREKORPUS = { REPO: REPO, DATEI: DATEI, laden: laden, pruefeKorpus: pruefeKorpus, erklaereFehler: erklaereFehler,
    tokenLesen: tokenLesen, tokenGemerkt: tokenGemerkt, tokenSchreiben: tokenSchreiben, tokenLoeschen: tokenLoeschen };
})(typeof self !== 'undefined' ? self : this);

/* Kriterien B1 — Kein Take geht verloren, nichts wird still überschrieben.
   app.js läuft hier mit dem ECHTEN storage.js in einer vm-Umgebung. IndexedDB ist nachgebildet (idbNeu): Läden,
   Transaktionen mit Abbruch (alles oder nichts), Versionswechsel, Speicherquote und gezielt scheiternde
   Schreibvorgänge; die Daten überstehen das Neuladen der Seite. Eine „geschlossene“ Seite rechnet nicht weiter
   (ihre Zeitgeber und Datenbankrückrufe laufen ins Leere), so wie ein Tab, der neu geladen wird.
   B1a: Take und Rahmenverlauf in einer Transaktion (Take, Neu-Analyse).
   B1b: Bearbeiten im Detail überschreibt keine laufende oder abgeschlossene Neu-Analyse.
   B1c: Export und Import sind während „Alle neu analysieren“ gesperrt, mit Hinweis.
   B1d: Meldungen stimmen mit dem Speicherzustand: Speicher reicht für Take und Verlauf, nicht für das WAV.
   B1e: Die Aufnahme liegt vor der Analyse in IndexedDB; nach dem Neuladen wird sie angeboten (fortsetzen, WAV
        sichern, verwerfen); während Aufnahme und Analyse fragt die Seite vor dem Verlassen nach.
   B1f: recorder-worklet.js und recorder.js erkennen Signallücken (Eingang fehlt, Kontext steht, Anfang, Ende)
        auf den Abtastwert genau und täuschen keine vor (spätes Stück, beschäftigter Hauptfaden beim Stopp).
   B1g: analysis.js wertet eine Naht als Pause: kein gemessener Rahmen über der Naht, kein Sprung über sie hinweg.
   B1h: Ein Take mit Signallücke wird gespeichert und überall als lückenhaft gekennzeichnet (Ergebnis, Liste,
        Detail, Sprung-Kachel, CSV), ist keine Referenz, und die Neu-Analyse behält die Nähte. */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path'), nodeCrypto = require('crypto');
const { Blob } = require('buffer');
const ROOT = path.join(__dirname, '..', '..');
const U = require(path.join(__dirname, 'u_oberflaeche.js')).hilfen;
const QUELLE = {};
function quelle(f) { return QUELLE[f] || (QUELLE[f] = fs.readFileSync(path.join(ROOT, f), 'utf8')); }
const fehlerListe = [];
function aufFehler(e) { fehlerListe.push(String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }
function kurzFehler(e) { return String(e && e.stack || e).split('\n').slice(0, 2).join(' | '); }

/* ---------- IndexedDB-Nachbildung ---------- */
function domFehler(name, text) { return new DOMException(text || name, name); }
function klon(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Blob) return v;
  if (ArrayBuffer.isView(v)) return v.slice();
  if (v instanceof ArrayBuffer) return v.slice(0);
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(klon);
  const o = {}; for (const k of Object.keys(v)) if (typeof v[k] !== 'function') o[k] = klon(v[k]);
  return o;
}
function groesse(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string') return 2 * v.length;
  if (typeof v !== 'object') return 8;
  if (v instanceof Blob) return v.size;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  let n = 0; for (const k of Object.keys(v)) n += 2 * k.length + groesse(v[k]);
  return n;
}
const vergleich = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/* Ein Browserprofil: Datenbanken bleiben über Seiten hinweg. ctl.quote in Byte, ctl.putFehler(laden, wert) → Fehler
   oder null. Wie IndexedDB: Schreibtransaktionen mit überlappenden Läden laufen nacheinander (eine spätere wartet,
   bis die frühere fertig ist), Anfragen einer Transaktion der Reihe nach; scheitert eine Anfrage, wird alles
   zurückgenommen, was die Transaktion geschrieben hat. Wird eine Seite geschlossen, brechen ihre offenen
   Transaktionen ab, und ihre Rückrufe laufen nicht mehr. */
function idbNeu() {
  const dbs = new Map(), ctl = { quote: Infinity, putFehler: null }, offen = [];
  function nutzung() { let n = 0; for (const d of dbs.values()) for (const st of d.stores.values()) for (const v of st.data.values()) n += groesse(v); return n; }
  const ueberlappt = (a, b) => a.d === b.d && a.namen.some(n => b.namen.indexOf(n) >= 0);
  function plane() {
    for (let i = 0; i < offen.length; i++) {
      const t = offen[i];
      if (t.gestartet) continue;
      const frei = offen.slice(0, i).every(u => !ueberlappt(u, t) || (u.modus !== 'readwrite' && t.modus !== 'readwrite'));
      if (frei) { t.gestartet = true; t.weiter(); }
    }
  }
  function fabrik(seite) {
    const spaeter = f => setImmediate(() => { if (!seite.tot) f(); });
    const rufe = (h, ev) => { if (typeof h !== 'function') return true; try { h(ev); return true; } catch (e) { aufFehler(e); return false; } };
    seite.idbAbbruch = () => offen.filter(t => t.seite === seite).forEach(t => t.ende(domFehler('AbortError', 'Seite geschlossen'), true));
    function transaktion(d, namen, modus) {
      namen = Array.isArray(namen) ? namen.slice() : [namen];
      for (const n of namen) if (!d.stores.has(n)) throw domFehler('NotFoundError', 'Laden ' + n + ' fehlt');
      const t = { mode: modus, error: null, oncomplete: null, onerror: null, onabort: null };
      const intern = { d, namen, modus, seite, gestartet: false, fertig: false, schlange: [], rueck: [], laeuft: false };
      intern.ende = (fehler, still) => {
        if (intern.fertig) return;
        intern.fertig = true;
        if (fehler) { for (let k = intern.rueck.length - 1; k >= 0; k--) intern.rueck[k](); if (!t.error) t.error = fehler; }
        offen.splice(offen.indexOf(intern), 1);
        plane();
        if (!still) spaeter(() => (fehler ? rufe(t.onabort, { type: 'abort', target: t }) : rufe(t.oncomplete, { type: 'complete', target: t })));
      };
      intern.weiter = () => spaeter(() => {
        if (intern.fertig || intern.laeuft) return;
        const a = intern.schlange.shift();
        if (!a) { intern.ende(null); return; }
        intern.laeuft = true;
        const req = a.req;
        try { req.result = a.op(); } catch (e) { req.error = e; }
        intern.laeuft = false;
        if (req.error) {
          // Wie IndexedDB: Fehlerereignis an der Anfrage, dann an der Transaktion (t.error ist da noch leer), dann Abbruch.
          let verhindert = false;
          const ev = { type: 'error', target: req, preventDefault() { verhindert = true; }, stopPropagation() { } };
          rufe(req.onerror, ev); rufe(t.onerror, ev);
          if (!verhindert) { intern.ende(req.error); return; }
        } else if (!rufe(req.onsuccess, { type: 'success', target: req })) { intern.ende(domFehler('AbortError', 'Ausnahme im Rückruf')); return; }
        intern.weiter();
      });
      function anfrage(op) {
        if (intern.fertig) throw domFehler('TransactionInactiveError');
        const req = { result: undefined, error: null, onsuccess: null, onerror: null, transaction: t };
        intern.schlange.push({ req, op });
        return req;
      }
      const schreibend = () => { if (modus !== 'readwrite') throw domFehler('ReadOnlyError'); };
      t.objectStore = name => {
        if (namen.indexOf(name) < 0) throw domFehler('NotFoundError', 'Laden ' + name + ' nicht in der Transaktion');
        const daten = () => d.stores.get(name).data, kp = d.stores.get(name).keyPath;
        const merke = k => { const m = daten(), hatte = m.has(k), alt = m.get(k); intern.rueck.push(() => { if (hatte) m.set(k, alt); else m.delete(k); }); };
        return {
          put(v) {
            schreibend(); const k = v[kp], kopie = klon(v);
            return anfrage(() => {
              const f = ctl.putFehler && ctl.putFehler(name, v); if (f) throw f;
              const m = daten(), hatte = m.has(k), alt = m.get(k);
              m.set(k, kopie);
              if (nutzung() > ctl.quote) { if (hatte) m.set(k, alt); else m.delete(k); throw domFehler('QuotaExceededError', ''); }
              intern.rueck.push(() => { if (hatte) m.set(k, alt); else m.delete(k); });
              return k;
            });
          },
          get: k => anfrage(() => klon(daten().get(k))),
          getKey: k => anfrage(() => (daten().has(k) ? k : undefined)),
          getAll: () => anfrage(() => [...daten().keys()].sort(vergleich).map(k => klon(daten().get(k)))),
          getAllKeys: () => anfrage(() => [...daten().keys()].sort(vergleich)),
          delete(k) { schreibend(); return anfrage(() => { merke(k); daten().delete(k); }); },
          clear() { schreibend(); return anfrage(() => { const m = daten(), alt = new Map(m); intern.rueck.push(() => { m.clear(); for (const [k, v] of alt) m.set(k, v); }); m.clear(); }); },
          createIndex() { }
        };
      };
      t.abort = () => intern.ende(domFehler('AbortError', 'abgebrochen'));
      offen.push(intern);
      plane();
      return t;
    }
    return {
      open(name, version) {
        const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
        spaeter(() => {
          let d = dbs.get(name);
          const alt = d ? d.version : 0;
          if (version < alt) { req.error = domFehler('VersionError'); rufe(req.onerror, { target: req }); return; }
          if (!d) { d = { version: 0, stores: new Map() }; dbs.set(name, d); }
          let upgrade = false;
          const conn = {
            get version() { return d.version; },
            objectStoreNames: { contains: n => d.stores.has(n) },
            createObjectStore(n, o) { if (!upgrade) throw domFehler('InvalidStateError'); d.stores.set(n, { keyPath: o.keyPath, data: new Map() }); return { createIndex() { } }; },
            transaction: (namen, modus) => transaktion(d, namen, modus || 'readonly'),
            close() { }, onversionchange: null
          };
          req.result = conn;
          if (version > alt) { upgrade = true; rufe(req.onupgradeneeded, { oldVersion: alt, newVersion: version, target: req }); upgrade = false; d.version = version; }
          rufe(req.onsuccess, { target: req });
        });
        return req;
      }
    };
  }
  // Inhalt eines Ladens (zum Prüfen von außen, ohne die Seite).
  const laden = (name, store) => { const d = dbs.get(name || 'vare'); return d && d.stores.has(store) ? d.stores.get(store).data : new Map(); };
  return { ctl, dbs, fabrik, laden, nutzung };
}

/* ---------- Seite mit echtem storage.js ---------- */
function htmlVorgaben() {
  const html = quelle('index.html'), v = {}, re = /<([a-z]+)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) { const id = /\bid="([^"]+)"/.exec(m[2]); if (id) v[id[1]] = { hidden: /\shidden(?=[\s=]|$)/.test(m[2]), disabled: /\sdisabled(?=[\s=]|$)/.test(m[2]) }; }
  return v;
}
// Wie U.El, aber neues innerHTML heißt neue Kinder: sonst sammelten sich an „#d-save“ die Klicks aller früher gezeigten Takes.
class E extends U.El {
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) { this._html = v; this._q = {}; this.kinder = []; }
}
// Mikrofon-Ersatz: liefern() bestimmt, was der Recorder beim Stopp zurückgibt.
function recorderNeu(liefern, sr) {
  return {
    createRecorder() {
      const r = {
        active: false, info: null, sampleRate: sr, samplesSeen: 0, recordedSeconds: 0,
        start() { r.active = true; r.info = { deviceLabel: 'Testmikrofon', deviceId: 'standard', sampleRate: sr, trackSampleRate: sr, capture: 'worklet', echoCancellation: false, noiseSuppression: false, autoGainControl: false }; return Promise.resolve(r.info); },
        stop() { r.active = false; return Promise.resolve(); },
        beginTake() { }, endTake() { return liefern(); }, latest() { return new Float32Array(0); }
      };
      return r;
    },
    listDevices: () => Promise.resolve([])
  };
}
async function seiteNeu(browser, liefern, sr) {
  const seite = { tot: false, halt: false, gehalten: [] }, vorgaben = htmlVorgaben(), els = {}, intervalle = [], hoerer = {}, downloads = [];
  function el(id) {
    if (!els[id]) { const e = new E(id), v = vorgaben[id]; if (v) { e.hidden = v.hidden; e.disabled = v.disabled; } els[id] = e; }
    return els[id];
  }
  const leer = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } }; };
  const document = { readyState: 'complete', activeElement: null, body: new E('body'), getElementById: el, createElement: () => new E(), querySelector: () => el('main'), querySelectorAll: () => [], addEventListener() { } };
  const sb = {
    document, console: { log() { }, warn() { }, error: aufFehler }, navigator: {},
    location: { hash: '#/aufnahme', protocol: 'http:', origin: 'http://localhost' },
    addEventListener(t, f) { (hoerer[t] = hoerer[t] || []).push(f); }, removeEventListener() { },
    requestAnimationFrame: () => 0, cancelAnimationFrame() { }, performance: { now: () => Date.now() },
    // Angehalten (p.halt) wartet jeder fällige Zeitgeber der Seite, bis p.weiter(): so steht eine Analyse
    // zwischen zwei Blöcken still, während Datenbank und Klicks weiterlaufen.
    setTimeout: (f, ms) => setTimeout(function lauf() { if (seite.tot) return; if (seite.halt) { seite.gehalten.push(lauf); return; } f(); }, ms), clearTimeout: h => clearTimeout(h),
    setInterval: (f, ms) => { const h = setInterval(() => { if (!seite.tot) f(); }, ms); if (h.unref) h.unref(); intervalle.push(h); return h; },
    clearInterval: h => clearInterval(h),
    confirm: () => true, alert() { }, crypto: { randomUUID: () => nodeCrypto.randomUUID() },
    Blob, URL: { createObjectURL: b => { downloads.push(b); return 'blob:pruefung'; }, revokeObjectURL() { } },
    btoa, atob, Date, devicePixelRatio: 1, localStorage: leer(), sessionStorage: leer(),
    fetch: () => Promise.reject(new Error('kein Netz')), TextDecoder, TextEncoder, indexedDB: browser.fabrik(seite)
  };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb);
  for (const f of ['dsp.js', 'vowel.js', 'analysis.js', 'csv.js', 'wav.js', 'calibration.js', 'korpus.js', 'storage.js', 'chronik.js']) vm.runInContext(quelle(f), sb, { filename: f });
  sb.VARERECORDER = recorderNeu(liefern, sr);
  vm.runInContext(quelle('app.js'), sb, { filename: 'app.js' });
  const st = () => sb.VAREAPP.state, S = sb.VARESTORE;
  const p = {
    sb, el, st, S, hoerer, downloads, seite,
    async warte(bed, ms) {
      const t0 = Date.now();
      for (;;) {
        let ok = false; try { ok = await bed(); } catch (e) { ok = false; }
        if (ok) return true;
        if (Date.now() - t0 > (ms || 10000)) return false;
        await new Promise(r => setTimeout(r, 3));
      }
    },
    klick(id) { try { el(id).click(); } catch (e) { aufFehler(e); } },
    status() { return st().statusEl ? st().statusEl.textContent : ''; },
    geheZu(hash) { sb.location.hash = hash; (hoerer.hashchange || []).forEach(f => { try { f(); } catch (e) { aufFehler(e); } }); },
    kalibriert(id) {
      const s = st();
      s.cal = { id, floorDb: -72, levelDb: -20, snrDb: 52, createdAt: new Date().toISOString(), deviceLabel: 'Testmikrofon', deviceId: 'standard', sampleRate: sr, trackSampleRate: sr,
        captureFlags: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, F: [700, 1200, 2500] };
      s.calSession = true;
    },
    async mikrofon() { p.klick('btn-mic'); return p.warte(() => st().rec && st().rec.active && !el('btn-mic').disabled); },
    // Take aufnehmen; waehrend() läuft gleich nach dem Stopp. Liefert den neuen Take oder null (nicht gespeichert).
    async take(waehrend) {
      if (!(await p.warte(() => !el('btn-take').disabled, 5000))) throw new Error('Take-Knopf blieb gesperrt: ' + el('take-hint').textContent);
      const vorher = new Set((await S.allTakes()).map(t => t.id));
      p.klick('btn-take'); p.klick('btn-take');
      if (waehrend) await waehrend();
      await p.warte(() => !st().busy && el('take-progress').hidden !== false, 60000);
      await p.warte(() => !st().busy, 60000);
      return (await S.allTakes()).find(t => !vorher.has(t.id)) || null;
    },
    halt() { seite.halt = true; },
    weiter() { seite.halt = false; seite.gehalten.splice(0).forEach(f => setTimeout(f, 0)); },
    // Neuladen: diese Seite rechnet nicht weiter, ihre Datenbankrückrufe laufen ins Leere.
    schliessen() { seite.tot = true; intervalle.forEach(h => clearInterval(h)); if (seite.idbAbbruch) seite.idbAbbruch(); }
  };
  if (!(await p.warte(() => st().settings && st().takesGeladen, 5000))) throw new Error('Seite nicht geladen');
  // Geprüft wird die Verdrahtung, nicht der Rechenkern: gröberer Rahmenabstand spart Laufzeit.
  st().settings.hopS = 0.05;
  return p;
}

module.exports = async function (H) {
  const { D, C, SR, concat, noise, BW5 } = H;
  const check = (id, name, ok, detail) => H.check(id, (id.length >= 5 ? ' ' : '') + name, ok, detail);
  process.on('unhandledRejection', aufFehler);
  // Kurzer Take: /a/ bei G3 zwischen zwei Stücken Raumrauschen, 1,2 s.
  const SIG = concat([noise(Math.round(0.1 * SR), 2e-4, 7), D.synthVowel(196, [700, 1200, 2500, 3300, 4200], BW5, 1.0, SR, { gain: 0.3 }), noise(Math.round(0.1 * SR), 2e-4, 8)]);
  const normal = () => ({ samples: Float32Array.from(SIG), sampleRate: SR, durationS: SIG.length / SR });
  const fehlerVorher = fehlerListe.length;

  /* ---------- B1a · Take und Rahmenverlauf in einer Transaktion ---------- */
  try {
    const br = idbNeu(), p = await seiteNeu(br, normal, SR);
    p.kalibriert('cal-1'); await p.mikrofon();
    // 1. Take: Das Schreiben des Rahmenverlaufs scheitert. Dann darf auch der Take nicht in der Chronik stehen.
    br.ctl.putFehler = laden => (laden === 'series' ? domFehler('UnknownError', 'Verlauf nicht schreibbar (Prüfung)') : null);
    const t1 = await p.take();
    const takes1 = [...br.laden('vare', 'takes').values()], ohneSerie = takes1.filter(t => !br.laden('vare', 'series').has(t.id));
    const meldung1 = p.status();
    br.ctl.putFehler = null;
    // 2. Neu-Analyse: Take mit Audio, dann scheitert der Verlauf beim Zurückschreiben. Der Take bleibt, wie er war.
    const A = await p.take();
    const vorA = A && JSON.stringify({ an: A.analysis, h: (A.history || []).length, s: A.summary.F.map(f => f.med) });
    br.ctl.putFehler = laden => (laden === 'series' ? domFehler('UnknownError', 'Verlauf nicht schreibbar (Prüfung)') : null);
    p.sb.VAREAPP.handlers.reanalyse(A);
    await p.warte(() => !p.st().busy && /Neu-Analyse fehlgeschlagen|Neu analysiert/.test(p.status()), 30000);
    br.ctl.putFehler = null;
    const A2 = br.laden('vare', 'takes').get(A.id);
    const nachA = A2 && JSON.stringify({ an: A2.analysis, h: (A2.history || []).length, s: A2.summary.F.map(f => f.med) });
    check('B1a', 'Take und Rahmenverlauf in einer Transaktion: scheitert der Verlauf, steht kein Take ohne Verlauf in der Chronik, und eine Neu-Analyse lässt den Take unverändert',
      !t1 && takes1.length === 0 && /NICHT gespeichert/.test(meldung1) && !!A && vorA === nachA && /fehlgeschlagen/.test(p.status()),
      'Take mit scheiterndem Verlauf: ' + takes1.length + ' Take(s) in der Chronik, davon ohne Verlauf ' + ohneSerie.length + ', Meldung „' + meldung1.slice(0, 60) + '“'
      + ' | Neu-Analyse mit scheiterndem Verlauf: Take ' + (vorA === nachA ? 'unverändert' : 'verändert (Historie ' + (A2 && (A2.history || []).length) + ', Kern ' + (A2 && A2.analysis.kernelVersion) + ')') + ', Meldung „' + p.status().slice(0, 60) + '“');
    p.schliessen();
  } catch (e) { check('B1a', 'Ablauf Transaktion Take und Verlauf läuft durch', false, kurzFehler(e)); }

  /* ---------- B1b · Speichern im Detail während und nach „Alle neu analysieren“ ---------- */
  try {
    const br = idbNeu(), p = await seiteNeu(br, normal, SR);
    p.kalibriert('cal-1'); await p.mikrofon();
    p.el('take-label').value = 'Erster'; const A = await p.take();
    p.el('take-label').value = 'Zweiter'; const B = await p.take();
    // Beide gelten als mit einem älteren Kern gerechnet, wie nach einem Versionswechsel.
    for (const t of [A, B]) { const x = await p.S.getTake(t.id); x.analysis.kernelVersion = '3.0.0'; await p.S.putTake(x); }
    // Detail öffnen und die Felder so füllen, wie die Ansicht sie aus dem Take beim Öffnen füllt; Kommentar dazu.
    async function detail(id, kommentar) {
      const t = await p.S.getTake(id), q = s => p.el('take-detail').querySelector(s);
      p.geheZu('#/take/' + id);
      if (!(await p.warte(() => /d-save/.test(p.el('take-detail').innerHTML) && p.el('take-detail').innerHTML.indexOf('<h2>' + t.code + ' ') >= 0, 5000))) throw new Error('Detail ' + t.code + ' nicht gezeigt');
      q('#d-label').value = t.label; q('#d-intent').value = t.vowelIntent || ''; q('#d-warmup').value = ''; q('#d-warmup-min').value = '';
      q('#d-comment').value = kommentar;
      const knopf = q('#d-save');
      return () => knopf.click();
    }
    // Lauf starten und mitten in der Analyse von A anhalten (Zeitgeber der Seite stehen, Datenbank und Klicks nicht).
    const lauf = async () => {
      p.geheZu('#/chronik'); p.klick('btn-reanalyse-all');
      const ok = await p.warte(() => /Neu-Analyse 1 von 2: A .* — \d+ \/ \d+ Rahmen/.test(p.el('reanalyse-all-text').textContent), 10000);
      p.halt();
      return ok;
    };
    const ende = () => { p.weiter(); return p.warte(() => !p.st().busy && /Alle neu analysiert/.test(p.el('reanalyse-all-text').textContent), 60000); };
    // 1. Wie im Befund: Detail von B öffnen, solange der Lauf noch bei A ist; erst nach dem Lauf speichern.
    const imLauf1 = await lauf();
    const speichernB = await detail(B.id, 'Notiz nach dem Lauf');
    const bOffenAlt = /Kern 3\.0\.0/.test(p.el('take-detail').innerHTML);
    await ende();
    speichernB();
    await p.warte(() => /Gespeichert/.test(p.status()), 5000);
    const b = await p.S.getTake(B.id);
    // 2. Detail von A öffnen und speichern, während der Lauf A gerade rechnet.
    const imLauf2 = await lauf();
    const speichernA = await detail(A.id, 'Notiz während des Laufs');
    speichernA();
    await p.warte(() => /Gespeichert/.test(p.status()), 5000);
    await ende();
    const a = await p.S.getTake(A.id);
    const z = t => t.code + ': Kern ' + t.analysis.kernelVersion + ', Historie ' + (t.history || []).length + ', Kommentar „' + t.comment + '“';
    check('B1b', 'Speichern im Detail nach und während „Alle neu analysieren“: die Neu-Analyse bleibt (Kern, Historie), nur die Notiz kommt dazu',
      imLauf1 && imLauf2 && bOffenAlt && b.analysis.kernelVersion === D.VERSION && (b.history || []).length === 1 && b.comment === 'Notiz nach dem Lauf' && b.label === 'Zweiter'
      && a.analysis.kernelVersion === D.VERSION && (a.history || []).length === 2 && a.comment === 'Notiz während des Laufs' && a.label === 'Erster',
      'Läufe beobachtet=' + imLauf1 + '/' + imLauf2 + ', Detail B zeigte beim Öffnen Kern 3.0.0=' + bOffenAlt + ' | nach dem Lauf gespeichert ' + z(b) + ' | im Lauf gespeichert ' + z(a));
    p.schliessen();
  } catch (e) { check('B1b', 'Ablauf Speichern im Detail während der Neu-Analyse läuft durch', false, kurzFehler(e)); }

  /* ---------- B1c · Export und Import während „Alle neu analysieren“ ---------- */
  try {
    const br = idbNeu(), p = await seiteNeu(br, normal, SR);
    p.kalibriert('cal-1'); await p.mikrofon();
    await p.take(); await p.take();
    const fremd = { id: 'b1c-import', code: 'Z', label: 'Import', createdAt: '2026-03-02T09:00:00.000Z', durationS: 1, sampleRate: SR, analysis: { kernelVersion: D.VERSION }, history: [], summary: {} };
    const sicherung = C.serializeBackup({ takes: [fremd], series: {}, refs: null, calibrations: [], settings: null, kernelVersion: D.VERSION });
    p.geheZu('#/chronik');
    p.klick('btn-reanalyse-all');
    const imLauf = await p.warte(() => /Neu-Analyse 1 von 2: A .* — \d+ \/ \d+ Rahmen/.test(p.el('reanalyse-all-text').textContent), 10000);
    p.halt();
    const gesperrt = ['btn-export-csv', 'btn-export-json', 'btn-import-json'].filter(id => p.el(id).disabled);
    const dl0 = p.downloads.length;
    p.klick('btn-export-csv'); p.klick('btn-export-json');
    p.el('file-import').files = [{ text: () => Promise.resolve(sicherung) }]; p.el('file-import').feuern('change');
    await new Promise(r => setTimeout(r, 50));
    const hinweis = p.status();
    p.weiter();
    await p.warte(() => !p.st().busy && /Alle neu analysiert/.test(p.el('reanalyse-all-text').textContent), 60000);
    const dlLauf = p.downloads.length - dl0;
    const importiert = !!(await p.S.getTake('b1c-import'));
    const frei = ['btn-export-csv', 'btn-export-json', 'btn-import-json'].filter(id => !p.el(id).disabled);
    p.klick('btn-export-csv');
    const nachher = await p.warte(() => p.downloads.length > dl0 + dlLauf, 3000);
    check('B1c', 'Während „Alle neu analysieren“: Export und Import gesperrt (Knöpfe und Aufruf), mit Hinweis; danach wieder frei',
      imLauf && gesperrt.length === 3 && dlLauf === 0 && !importiert && /Alle neu analysieren/.test(hinweis) && /gesperrt|abwarten/.test(hinweis) && frei.length === 3 && nachher,
      'Lauf beobachtet=' + imLauf + ' | gesperrte Knöpfe ' + gesperrt.length + '/3 | Downloads im Lauf ' + dlLauf + ' | Import übernommen=' + importiert + ' | Hinweis „' + hinweis.slice(0, 90) + '“ | danach frei ' + frei.length + '/3, Export geht=' + nachher);
    p.schliessen();
  } catch (e) { check('B1c', 'Ablauf Export/Import während der Neu-Analyse läuft durch', false, kurzFehler(e)); }

  /* ---------- B1d · Meldung = Speicherzustand: das WAV passt nicht mehr, Take und Verlauf schon ---------- */
  try {
    // Erst messen, was ein Take ohne WAV belegt; dann eine frische Chronik, deren Quote dafür reicht, für das WAV nicht.
    const mess = idbNeu(), pm = await seiteNeu(mess, normal, SR);
    pm.kalibriert('cal-1'); await pm.mikrofon();
    pm.st().settings.storeAudio = false;
    const vor = mess.nutzung(); await pm.take(); const ohneWav = mess.nutzung() - vor;
    pm.schliessen();
    const wavBytes = 44 + 4 * SIG.length;   // Vorgabe Float32 (Chronik-Standard)
    const br = idbNeu(), p = await seiteNeu(br, normal, SR);
    p.kalibriert('cal-1'); await p.mikrofon();
    br.ctl.quote = br.nutzung() + ohneWav + Math.round(0.5 * wavBytes);
    p.el('take-label').value = 'Speicher knapp'; p.el('take-comment').value = 'wichtig';
    const A = await p.take();
    const meldung = p.status(), ergebnis = p.el('take-result');
    const knopf = (ergebnis.kinder || []).find(k => /WAV/.test(k.textContent || ''));
    const nextCode = br.laden('vare', 'meta').get('nextCode'), hatAudio = A ? await p.S.hasAudio(A.id) : null, serie = A ? await p.S.getSeries(A.id) : null;
    let dl = null;
    if (knopf) { const n0 = p.downloads.length; knopf.click(); dl = p.downloads.length > n0 ? p.downloads[p.downloads.length - 1] : null; }
    const teil1 = !!A && A.hasAudio === false && hatAudio === false && !!serie && !/NICHT gespeichert/.test(meldung) && /gespeichert/.test(meldung) && /WAV/.test(meldung) && /QuotaExceededError/.test(meldung)
      && /Gespeichert als/.test(ergebnis.innerHTML) && !!dl && dl.size === wavBytes && p.el('take-label').value === '' && p.el('take-comment').value === '' && nextCode && nextCode.value === 1;
    // Scheitert der Take selbst, heißt es „NICHT gespeichert“ — mit dem Grund, nicht „null“.
    br.ctl.quote = Infinity;
    br.ctl.putFehler = laden => (laden === 'takes' ? domFehler('UnknownError', 'Take nicht schreibbar (Prüfung)') : null);
    const B = await p.take();
    br.ctl.putFehler = null;
    const meldung2 = p.status();
    const teil2 = !B && /NICHT gespeichert \(Take nicht schreibbar \(Prüfung\)\)/.test(meldung2);
    check('B1d', 'Meldung = Speicherzustand: reicht der Speicher für Take und Verlauf, nicht für das WAV, heißt es „gespeichert, das WAV nicht“ mit Grund und Knopf zum Sichern (Take ohne Audio, Code weitergezählt, Felder leer); scheitert der Take, „NICHT gespeichert“ mit Grund',
      ohneWav < wavBytes && teil1 && teil2,
      'Take ohne WAV ' + ohneWav + ' B, WAV ' + wavBytes + ' B | Meldung „' + meldung.slice(0, 110) + '“ | Take ' + (A ? A.code + ' hasAudio=' + A.hasAudio + ', Audio da=' + hatAudio + ', Verlauf da=' + !!serie : 'nicht gespeichert')
      + ' | Knopf ' + (knopf ? '„' + knopf.textContent + '“, Datei ' + (dl ? dl.size + ' B' : 'keine') : 'fehlt') + ' | Felder „' + p.el('take-label').value + '|' + p.el('take-comment').value + '“ | nextCode ' + (nextCode && nextCode.value)
      + ' | Take scheitert: „' + meldung2.slice(0, 80) + '“');
    p.schliessen();
  } catch (e) { check('B1d', 'Ablauf Speicher knapp läuft durch', false, kurzFehler(e)); }

  /* ---------- B1e · Neuladen während der Analyse ---------- */
  try {
    const br = idbNeu();
    let p = await seiteNeu(br, normal, SR);
    p.st().settings.hopS = 0.01;   // Analyse lang genug, um mitten in ihr neu zu laden
    p.kalibriert('cal-1'); await p.mikrofon();
    // Rückfrage beim Verlassen, wie der Browser sie auslöst: ein Hörer ruft preventDefault oder setzt returnValue.
    const verlassen = q => { let verhindert = false; const ev = { type: 'beforeunload', returnValue: undefined, preventDefault() { verhindert = true; } };
      (q.hoerer.beforeunload || []).forEach(f => { const r = f(ev); if (typeof r === 'string') verhindert = true; }); return verhindert || typeof ev.returnValue === 'string'; };
    const leerlauf = verlassen(p);
    p.el('take-label').value = 'Lied'; p.el('take-comment').value = 'ganzer Durchgang';
    p.klick('btn-take');
    const beimSingen = verlassen(p);
    p.klick('btn-take');
    const inAnalyse = await p.warte(() => /Analyse \d+ \/ \d+ Rahmen/.test(p.el('take-progress-text').textContent), 10000);
    p.halt();
    const inDerAnalyse = verlassen(p);
    const vor = { pending: br.laden('vare', 'pending').size, audio: br.laden('vare', 'audio').size, takes: br.laden('vare', 'takes').size };
    p.schliessen();
    // Neu geladen: angeboten mit Datum, Dauer und Bezeichnung; die Stelle in der Sitzung ist vergeben.
    p = await seiteNeu(br, normal, SR);
    const id = [...br.laden('vare', 'pending').keys()][0] || '';
    const box = () => p.el('offene-analysen');
    const angeboten = await p.warte(() => !box().hidden && ['weiter', 'wav', 'weg'].every(a => box().innerHTML.indexOf('data-offen="' + a + '" data-id="' + id + '"') >= 0) && /„Lied“/.test(box().innerHTML), 5000);
    const naechste = p.el('ctx-position').textContent;
    const knopf = (act, kid) => ({ getAttribute: k => (k === 'data-offen' ? act : k === 'data-id' ? kid : null) });
    const klickOffen = (act, kid) => (box()._on.click || []).forEach(f => f({ target: knopf(act, kid) }));
    // Sicherung, solange die Aufnahme offen ist: ohne ihr WAV, und die Seite sagt es.
    let n0 = p.downloads.length;
    p.klick('btn-export-json');
    await p.warte(() => p.downloads.length > n0, 5000);
    const sicherung = p.downloads.length > n0 ? await p.downloads[p.downloads.length - 1].text() : '';
    const sicherungOhne = !!sicherung && sicherung.indexOf(id) < 0 && /unvollendete Aufnahme/.test(p.status());
    // WAV sichern
    n0 = p.downloads.length;
    klickOffen('wav', id);
    await p.warte(() => p.downloads.length > n0, 3000);
    const wavDl = p.downloads.length > n0 ? p.downloads[p.downloads.length - 1].size : 0;
    // Fortsetzen
    p.st().settings.hopS = 0.05;
    klickOffen('weiter', id);
    await p.warte(() => br.laden('vare', 'takes').size === 1 && !p.st().busy, 30000);
    await p.warte(() => box().hidden, 3000);
    const t = await p.S.getTake(id), hatAudio = await p.S.hasAudio(id), serie = await p.S.getSeries(id);
    const fortgesetzt = !!t && t.code === 'A' && t.label === 'Lied' && t.comment === 'ganzer Durchgang' && t.sitzung && t.sitzung.position === 1 && t.hasAudio === true && hatAudio && !!serie
      && br.laden('vare', 'pending').size === 0 && box().hidden;
    // Verwerfen: ein zweiter Take, wieder mitten in der Analyse neu geladen.
    p.kalibriert('cal-2'); await p.mikrofon();
    p.st().settings.hopS = 0.01;
    p.el('take-progress-text').textContent = '';   // im echten DOM entsteht die Zeile mit jedem Take neu
    p.klick('btn-take'); p.klick('btn-take');
    await p.warte(() => /Analyse \d+ \/ \d+ Rahmen/.test(p.el('take-progress-text').textContent), 10000);
    p.halt(); p.schliessen();
    p = await seiteNeu(br, normal, SR);
    const id2 = [...br.laden('vare', 'pending').keys()][0] || '';
    await p.warte(() => !box().hidden, 5000);
    klickOffen('weg', id2);
    await p.warte(() => box().hidden, 3000);
    const verworfen = !!id2 && br.laden('vare', 'pending').size === 0 && !br.laden('vare', 'audio').has(id2) && br.laden('vare', 'takes').size === 1;
    p.schliessen();
    // Eine Chronik der Datenbankversion 1 (vor dem Laden pending) wird übernommen, nichts geht verloren.
    const alt = idbNeu(), m = (kp, eintraege) => ({ keyPath: kp, data: new Map(eintraege || []) });
    const altTake = { id: 'v1-take', code: 'C', label: 'aus Version 1', createdAt: '2026-01-01T10:00:00.000Z', analysis: { kernelVersion: D.VERSION }, summary: {}, history: [] };
    alt.dbs.set('vare', { version: 1, stores: new Map([['takes', m('id', [['v1-take', altTake]])], ['series', m('takeId')], ['audio', m('takeId')], ['calibrations', m('id')], ['meta', m('key')]]) });
    const pa = await seiteNeu(alt, normal, SR);
    const v1 = alt.dbs.get('vare'), umgestellt = v1.version === 2 && v1.stores.has('pending') && pa.st().takes.some(x => x.id === 'v1-take');
    pa.schliessen();
    check('B1e', 'Aufnahme vor der Analyse in IndexedDB; nach dem Neuladen angeboten (fortsetzen = derselbe Take mit Angaben und Stelle, WAV sichern, verwerfen); Rückfrage beim Verlassen nur während Aufnahme und Analyse; Sicherung nennt die offene Aufnahme; Chronik der Version 1 bleibt',
      !leerlauf && beimSingen && inAnalyse && inDerAnalyse && vor.pending === 1 && vor.audio === 1 && vor.takes === 0 && angeboten && naechste === '2' && sicherungOhne && wavDl === 44 + 4 * SIG.length && fortgesetzt && verworfen && umgestellt,
      'Rückfrage Leerlauf/Aufnahme/Analyse ' + leerlauf + '/' + beimSingen + '/' + inDerAnalyse + ' | vor dem Neuladen pending ' + vor.pending + ', Audio ' + vor.audio + ', Takes ' + vor.takes
      + ' | angeboten=' + angeboten + ', nächste Nummer ' + naechste + ' | Sicherung ohne die offene Aufnahme, mit Hinweis=' + sicherungOhne + ' | WAV ' + wavDl + ' B'
      + ' | fortgesetzt: ' + (t ? t.code + ' „' + t.label + '“ „' + t.comment + '“ Stelle ' + (t.sitzung && t.sitzung.position) + ' Audio ' + hatAudio + ' Verlauf ' + !!serie : 'kein Take') + ', Anzeige weg=' + box().hidden
      + ' | verworfen=' + verworfen + ' | Version 1 → 2: ' + umgestellt);
  } catch (e) { check('B1e', 'Ablauf Neuladen während der Analyse läuft durch', false, kurzFehler(e)); }

  /* ---------- B1f · Lückenerkennung in recorder-worklet.js und recorder.js ---------- */
  try {
    const bad = [], belege = [];
    // Worklet: process() mit 128er-Quanten; fehlt der Eingang, geht das angefangene Stück sofort ab.
    {
      const posted = [], sbw = { Date: { now: () => 1000 }, registerProcessor: (n, k) => { sbw.Klasse = k; }, Reflect, Object, Float32Array, isFinite };
      sbw.AudioWorkletProcessor = function () { this.port = { postMessage: (d) => posted.push(d) }; };
      vm.createContext(sbw);
      vm.runInContext(quelle('recorder-worklet.js'), sbw, { filename: 'recorder-worklet.js' });
      const proc = new sbw.Klasse();
      const quant = k => { const a = new Float32Array(128); for (let i = 0; i < 128; i++) a[i] = k * 128 + i; return a; };
      for (let k = 0; k < 40; k++) {
        sbw.currentFrame = k * 128;
        if (k >= 20 && k < 25) proc.process([[]]); else proc.process([[quant(k)]]);   // Quanten 20–24: kein Eingang
      }
      const ok = posted.every(m => m && m.s instanceof Float32Array && typeof m.f === 'number' && typeof m.t === 'number')
        && posted.every(m => m.s.every((v, i) => v === m.f + i));   // jeder Wert sitzt auf seinem Rahmen
      const fr = posted.map(m => m.f + '+' + (m.s ? m.s.length : '?'));
      if (!ok || posted.length !== 2 || posted[0].f !== 0 || posted[0].s.length !== 2048 || posted[1].f !== 2048 || posted[1].s.length !== 512) bad.push('Worklet: ' + (posted.length ? fr.join(' ') : 'nichts gesendet') + (posted[0] && !(posted[0].s) ? ' (alte Form ohne Rahmen und Uhrzeit)' : ''));
      // Nach der Lücke beginnt das nächste Stück am neuen Rahmen.
      for (let k = 40; k < 56; k++) { sbw.currentFrame = k * 128; proc.process([[quant(k)]]); }
      const letzt = posted[posted.length - 1];
      if (!letzt || !letzt.s || letzt.f !== 25 * 128 || letzt.s.length !== 2048 || !letzt.s.every((v, i) => v === letzt.f + i)) bad.push('Worklet nach der Lücke: ' + (letzt ? letzt.f + '+' + (letzt.s ? letzt.s.length : '?') : 'nichts'));
      belege.push('Worklet ' + posted.map(m => m.f + '+' + (m.s ? m.s.length : '?')).join(' '));
    }
    // Recorder: nachgebildete Audiokette; die Stücke kommen mit Rahmen und Uhrzeit, wie das Worklet sie schickt.
    const SRr = 48000, BL = 2048;
    async function lauf(plan, opt) {
      opt = opt || {};
      let jetzt = 1e6, port = null;
      const sbr = { Date: { now: () => jetzt }, setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: h => clearTimeout(h), Float32Array, isFinite, Math, Promise };
      const knoten = () => ({ connect() { }, disconnect() { } });
      sbr.navigator = { mediaDevices: { getUserMedia: () => Promise.resolve({ getAudioTracks: () => [{ label: 'Prüfmikrofon', getSettings: () => ({ deviceId: 'x', sampleRate: SRr }), stop() { } }], getTracks: () => [] }) } };
      sbr.AudioContext = function () { this.sampleRate = SRr; this.state = 'running'; this.destination = {}; this.audioWorklet = { addModule: () => Promise.resolve() }; };
      sbr.AudioContext.prototype = { createMediaStreamSource: knoten, createGain: () => Object.assign(knoten(), { gain: { value: 1 } }), resume: () => Promise.resolve(), close: () => Promise.resolve() };
      sbr.AudioWorkletNode = function () { const n = knoten(); n.port = { onmessage: null }; port = n.port; return n; };
      sbr.self = sbr;
      vm.createContext(sbr);
      vm.runInContext(quelle('recorder.js'), sbr, { filename: 'recorder.js' });
      const rec = sbr.VARERECORDER.createRecorder();
      await rec.start(null);
      const schick = (f, t, n) => { const a = new Float32Array(n || BL); port.onmessage({ data: opt.alt ? a : { s: a, f, t } }); };
      jetzt = 2e6; rec.beginTake();
      const r = await plan({ schick, uhr: v => { if (v != null) jetzt = v; return jetzt; }, rec });
      return r;
    }
    const ms = n => n / SRr * 1000, T0 = 2e6;
    // Sauber: 3 s am Stück, Stopp mitten im Stück danach.
    const sauber = await lauf(async ({ schick, uhr, rec }) => {
      let f = 96000;
      for (let k = 0; k < 70; k++) { f += BL; uhr(T0 + ms((k + 1) * BL) + 3); schick(f - BL, uhr()); }
      uhr(T0 + ms(70 * BL) + 20); const p = rec.endTake(); uhr(T0 + ms(71 * BL) + 3); schick(f, uhr()); f += BL;
      return p;
    });
    // Eingang fehlt 1,5 s: Rahmen springen (wie das Worklet sie dann meldet).
    const ohneEingang = await lauf(async ({ schick, uhr, rec }) => {
      let f = 0, wand = T0;
      for (let k = 0; k < 40; k++) { wand += ms(BL); uhr(wand + 2); schick(f, uhr()); f += BL; }
      f += 72000; wand += 1500;
      for (let k = 0; k < 40; k++) { wand += ms(BL); uhr(wand + 2); schick(f, uhr()); f += BL; }
      uhr(wand + 10); const p = rec.endTake(); wand += ms(BL); uhr(wand + 2); schick(f, uhr());
      return p;
    });
    // Kontext steht 2 s: Rahmen lückenlos, die Uhr springt.
    const angehalten = await lauf(async ({ schick, uhr, rec }) => {
      let f = 0, wand = T0;
      for (let k = 0; k < 40; k++) { wand += ms(BL); uhr(wand + 2); schick(f, uhr()); f += BL; }
      wand += 2000;
      for (let k = 0; k < 40; k++) { wand += ms(BL); uhr(wand + 2); schick(f, uhr()); f += BL; }
      uhr(wand + 10); const p = rec.endTake(); wand += ms(BL); uhr(wand + 2); schick(f, uhr());
      return p;
    });
    // Audiofaden hängt 300 ms und holt auf: kein Verlust, keine Lücke. Beim Stopp hängt der Hauptfaden:
    // die letzten Stücke kommen erst nach dem Stopp an, gehören aber dazu.
    const wandVon = k => T0 + ms((k + 1) * BL) + 2;
    const aufgeholt = await lauf(async ({ schick, uhr, rec }) => {
      let f = 0;
      for (let k = 0; k < 76; k++) { const t = (k >= 30 && k < 37) ? Math.max(wandVon(k), wandVon(29) + 300) : wandVon(k); uhr(t); schick(f, t); f += BL; }
      uhr(wandVon(79) + 5); const p = rec.endTake();
      // Stücke 76–79 vor dem Stopp abgeschickt, erst danach ausgeliefert; Stück 80 nach dem Stopp abgeschickt (nur sein Anfang zählt).
      for (let k = 76; k < 81; k++) { uhr(wandVon(79) + 400); schick(f, wandVon(k)); f += BL; }
      return p;
    });
    const sollAufgeholt = 80 * BL + (BL - Math.ceil((wandVon(80) - (wandVon(79) + 5)) / 1000 * SRr));
    // Signal 1 s vor dem Stopp weg, nach dem Stopp kommt nichts mehr: Lücke am Ende (nach dem Nachlauf).
    const endeWeg = await lauf(async ({ schick, uhr, rec }) => {
      let f = 0, wand = T0;
      for (let k = 0; k < 50; k++) { wand += ms(BL); uhr(wand + 2); schick(f, uhr()); f += BL; }
      uhr(wand + 1000); return rec.endTake();
    });
    // Ältere Worklet-Datei ohne Rahmen und Uhrzeit: Ankunftszeit zählt; 2 s ohne Stücke mitten im Take.
    const alt = await lauf(async ({ schick, uhr, rec }) => {
      let wand = T0;
      for (let k = 0; k < 40; k++) { wand += ms(BL); uhr(wand + 2); schick(); }
      wand += 2000;
      for (let k = 0; k < 40; k++) { wand += ms(BL); uhr(wand + 2); schick(); }
      uhr(wand + 10); const p = rec.endTake(); uhr(wand + ms(BL) + 2); schick();
      return p;
    }, { alt: true });
    const z = r => r && r.luecken ? r.luecken.map(l => l.art + '@' + l.beiS.toFixed(3) + '/' + l.dauerS.toFixed(3)).join(',') || 'keine' : 'keine Angabe';
    const eine = (r, art, bei, dauer, tol) => !!(r && r.luecken && r.luecken.length === 1 && r.luecken[0].art === art && Math.abs(r.luecken[0].beiS - bei) < 1e-6 + (tol || 0) && Math.abs(r.luecken[0].dauerS - dauer) <= (tol || 1e-6));
    if (!(sauber.luecken && sauber.luecken.length === 0 && sauber.samples.length > 70 * BL && sauber.samples.length <= 71 * BL)) bad.push('sauber: ' + z(sauber) + ', ' + sauber.samples.length + ' Werte');
    if (!eine(ohneEingang, 'naht', 40 * BL / SRr, 1.5)) bad.push('Eingang fehlt 1,5 s: ' + z(ohneEingang));
    if (!eine(angehalten, 'naht', 40 * BL / SRr, 2.0, 0.01)) bad.push('Kontext steht 2 s: ' + z(angehalten));
    if (!(aufgeholt.luecken && aufgeholt.luecken.length === 0 && aufgeholt.samples.length === sollAufgeholt)) bad.push('spätes Stück und Hänger beim Stopp: ' + z(aufgeholt) + ', ' + aufgeholt.samples.length + ' statt ' + sollAufgeholt + ' Werte');
    if (!eine(endeWeg, 'ende', 50 * BL / SRr, 1.0, 0.01)) bad.push('Signal am Ende weg: ' + z(endeWeg));
    if (!eine(alt, 'naht', 40 * BL / SRr, 2.0, 0.01)) bad.push('ohne Rahmenzähler: ' + z(alt));
    belege.push('sauber ' + z(sauber), 'Eingang fehlt ' + z(ohneEingang), 'Kontext steht ' + z(angehalten), 'aufgeholt ' + z(aufgeholt), 'Ende ' + z(endeWeg), 'ohne Rahmen ' + z(alt));
    check('B1f', 'Signallücken erkannt (Eingang fehlt, Kontext steht, Ende, ohne Rahmenzähler) auf den Abtastwert bzw. 10 ms genau; keine vorgetäuscht (spätes Stück, Hänger beim Stopp); das Worklet trennt Stücke an jeder Lücke',
      !bad.length, bad.length ? bad.join(' | ') : belege.join(' | '));
  } catch (e) { check('B1f', 'Ablauf Lückenerkennung läuft durch', false, kurzFehler(e)); }

  /* ---------- B1g · Naht als Pause in analysis.js ---------- */
  // /a/ auf A3 3 s, 0,5 s Atempause, /a/ auf D3 3 s (7 HT), Raumrauschen; 2 s ab 2,5 s fehlen: die Naht liegt über der
  // Pause. F3 über dem Mindestwert, damit der Take ein Bestsegment hat (B1h: keine Referenz trotz Bestsegment).
  const vok = (f0, d) => { const v = D.synthVowel(f0, [700, 1200, 2600, 3400, 4200], BW5, d, SR, { gain: 0.3 }); const r = Math.round(0.03 * SR); for (let i = 0; i < r; i++) { v[i] *= i / r; v[v.length - 1 - i] *= i / r; } return v; };
  const roh = concat([noise(SR / 2, 2e-4, 21), vok(220, 3), noise(SR / 2, 2e-4, 22), vok(146.83, 3), noise(SR / 2, 2e-4, 23)]);
  { const z = noise(roh.length, 2e-4, 24); for (let i = 0; i < roh.length; i++) roh[i] += z[i]; }
  const NAHT = concat([roh.subarray(0, Math.round(2.5 * SR)), roh.subarray(Math.round(4.5 * SR))]);
  try {
    const A = H.A, F = A.FLAG;
    const mit = await A.analyseTake(Float32Array.from(NAHT), SR, { hopS: 0.05, naehteS: [2.5] });
    const ohne = await A.analyseTake(Float32Array.from(NAHT), SR, { hopS: 0.05 });
    const rand = Math.max.apply(null, D.WINDOWS.concat([D.MAIN_WINDOW])) / 2;
    let ueber = 0, gemessen = 0, markiert = 0, segUeber = 0;
    for (let i = 0; i < mit.series.t.length; i++) {
      const anNaht = Math.abs(mit.series.t[i] - 2.5) < rand;
      if (anNaht) { ueber++; if ((mit.series.flags[i] & F.VOICED) || mit.series.gate[i] !== 0 || isFinite(mit.series.f1[i])) gemessen++; if (F.NAHT && (mit.series.flags[i] & F.NAHT)) markiert++; }
    }
    (mit.summary.segments || []).forEach(sg => { if (sg.startS < 2.5 && sg.startS + sg.lenS > 2.5) segUeber++; });
    const spM = mit.summary.spruenge, spO = ohne.summary.spruenge;
    const ueberNaht = spM.liste.filter(e => e.startS - 0.2 < 2.5 && e.startS + e.dauerS > 2.5).length;
    check('B1g', 'Naht als Pause: kein Rahmen, dessen Fenster die Naht überdeckt, ist gemessen oder gewertet (alle als Naht markiert), kein Segment und kein Tonsprung über die Naht',
      ueber > 0 && gemessen === 0 && markiert === ueber && segUeber === 0 && spM.gehalten === 0 && ueberNaht === 0,
      'Rahmen an der Naht ' + ueber + ', davon gemessen ' + gemessen + ', markiert ' + markiert + ' | Segmente über der Naht ' + segUeber + ' | gehaltene Sprünge mit Nahtangabe ' + spM.gehalten
      + ' (ohne Nahtangabe ' + spO.gehalten + (spO.liste[0] ? ': ' + spO.liste[0].halbtoene.toFixed(1) + ' HT bei ' + spO.liste[0].startS.toFixed(2) + ' s' : '') + ')');
  } catch (e) { check('B1g', 'Ablauf Naht in der Analyse läuft durch', false, kurzFehler(e)); }

  /* ---------- B1h · Take mit Signallücke durch die Seite ---------- */
  try {
    const luecke = [{ beiS: 2.5, dauerS: 2.0, art: 'naht' }];
    let liefer = () => ({ samples: Float32Array.from(NAHT), sampleRate: SR, durationS: NAHT.length / SR, luecken: luecke });
    const br = idbNeu(), p = await seiteNeu(br, () => liefer(), SR);
    p.kalibriert('cal-1'); await p.mikrofon();
    p.el('take-label').value = 'mit Lücke';
    const L = await p.take();
    const ergebnis = p.el('take-result').innerHTML;
    // Referenzen, solange L der einzige Take ist: Sein Bestsegment wäre die Zielmarke, gälte die Lücke nicht.
    const refs = await p.S.getMeta('refs', {});
    liefer = () => Object.assign(normal(), { luecken: [] });
    p.el('take-label').value = 'ohne Lücke';
    const N0 = await p.take();
    // Ein Take von früher, ohne Lückenprüfung.
    const frueher = Object.assign(await p.S.getTake(N0.id), { id: 'frueher', code: 'Q', signalLuecken: undefined, signalLueckeS: undefined });
    delete frueher.signalLuecken; delete frueher.signalLueckeS; await p.S.putTake(frueher);
    const refAusL = Object.keys(refs).filter(c => refs[c] && refs[c].takeId === L.id);
    const bestL = Object.keys((L.summary && L.summary.perVowel) || {}).filter(c => L.summary.perVowel[c].bestSegment);
    // Liste
    p.sb.VAREAPP.refreshChronik(); await p.warte(() => /Signallücke/.test(p.el('takes-list').innerHTML) || p.el('takes-list').innerHTML.length > 200, 3000);
    const liste = p.el('takes-list').innerHTML, zeile = id => { const m = new RegExp('<tr data-id="' + id + '">([\\s\\S]*?)</tr>').exec(liste); return m ? m[1] : ''; };
    const listeOk = /class="tag rust"[^>]*>Signallücke</.test(zeile(L.id)) && !/Signallücke/.test(zeile(N0.id)) && !/Signallücke/.test(zeile('frueher'));
    // Detail
    p.geheZu('#/take/' + L.id);
    await p.warte(() => p.el('take-detail').innerHTML.indexOf('<h2>' + L.code + ' ') >= 0, 3000);
    const det = p.el('take-detail').innerHTML, ks = U.kacheln(det), spr = ks.find(k => /^Tonsprünge/.test(k.k)) || {};
    const detailOk = /class="small rust">Signal unterbrochen: bei 2,5 s fehlen 2,0 s/.test(det) && /\bunsure\b/.test(spr.klasse || '') && !/data-pin=/.test(det);
    // Anpinnen verweigert
    if (bestL.length) p.sb.VAREAPP.handlers.pinRef(bestL[0], L);
    await new Promise(r => setTimeout(r, 30));
    const pinMeldung = p.status(), refs2 = await p.S.getMeta('refs', {});
    // CSV
    const csv = p.sb.VARECSV.takesToCsv([await p.S.getTake(L.id), await p.S.getTake(N0.id), await p.S.getTake('frueher')], 'standard').split(/\r?\n/);
    const kopf = csv[0].split(','), spalte = (zeilenNr) => csv[zeilenNr].split(',')[kopf.indexOf('signal_gap_s')];
    const csvOk = spalte(1) === '2.00' && spalte(2) === '0.00' && spalte(3) === '-99.00';
    // Neu-Analyse behält die Nähte
    p.st().settings.hopS = 0.05;
    p.sb.VAREAPP.handlers.reanalyse(await p.S.getTake(L.id));
    await p.warte(() => !p.st().busy && /Neu analysiert|fehlgeschlagen/.test(p.status()), 30000);
    const L2 = await p.S.getTake(L.id), serie2 = await p.S.getSeries(L.id);
    let naehte2 = 0; for (let i = 0; i < serie2.t.length; i++) if (serie2.flags[i] & 8192) naehte2++;
    const neuOk = (L2.history || []).length === 1 && L2.summary.spruenge.gehalten === 0 && naehte2 > 0;
    check('B1h', 'Take mit Signallücke: gespeichert mit Stelle und Dauer, Naht als Pause (0 Sprünge), in Rost in Ergebnis, Liste und Detail, Sprung-Kachel unsicher, keine Referenz und nicht anpinnbar, CSV signal_gap_s 2,00 (ohne Lücke 0,00, früher −99), Neu-Analyse behält die Nähte',
      !!L && L.signalLueckeS === 2 && L.signalLuecken && L.signalLuecken.length === 1 && L.summary.spruenge.gehalten === 0 && /class="rust">Signal unterbrochen: bei 2,5 s fehlen 2,0 s/.test(ergebnis)
      && N0 && N0.signalLueckeS === 0 && !/Signal unterbrochen/.test(p.el('take-result').innerHTML)
      && bestL.length > 0 && refAusL.length === 0 && Object.keys(refs2).every(c => !refs2[c] || refs2[c].takeId !== L.id) && /Signallücke/.test(pinMeldung)
      && listeOk && detailOk && csvOk && neuOk,
      'Take ' + (L ? L.code + ' Lücke ' + L.signalLueckeS + ' s, gehalten ' + L.summary.spruenge.gehalten : 'fehlt') + ' | ohne Lücke ' + (N0 && N0.signalLueckeS) + ' | Ergebnis Rost=' + /class="rust">Signal unterbrochen/.test(ergebnis)
      + ' | Bestsegmente ' + bestL.join(',') + ', als Referenz ' + (refAusL.join(',') || 'keine') + ' | Anpinnen: „' + pinMeldung.slice(0, 70) + '“ | Liste=' + listeOk + ' Detail=' + detailOk + ' (Sprung-Kachel ' + (spr.klasse || '?') + ')'
      + ' | CSV ' + [1, 2, 3].map(spalte).join('/') + ' | Neu-Analyse: Historie ' + (L2.history || []).length + ', gehalten ' + L2.summary.spruenge.gehalten + ', Nahtrahmen ' + naehte2);
    p.schliessen();
  } catch (e) { check('B1h', 'Ablauf Take mit Signallücke läuft durch', false, kurzFehler(e)); }

  const neueFehler = fehlerListe.slice(fehlerVorher);
  check('B1z', 'Keine Ausnahme in der Seite während der B1-Abläufe', !neueFehler.length, neueFehler.slice(0, 3).join(' || '));
  await kriterienB2(H);
  await kriterienB3(H);
};

/* Kriterien B2 — Anzeige, CSV und Doku sagen dasselbe wie die Messung.
   B2a: Das Take-Ergebnis zeigt schwach belegte Formanten und ein zweideutiges Bestsegment wie das Detail (N8).
   B2b: Die Neu-Analyse nennt jede geänderte Rechenweise und sperrt währenddessen den Take-Knopf (N20).
   B2c: Kein Take-Code, den pandas oder Excel als fehlend, Zahl oder Wahrheitswert lesen (N18).
   B2d: Die Sicherung zählt die ganze Datei und scheitert nie mit „Invalid string length“ (N19).
   B2e: README und pages.yml nennen dieselbe Pages-Quelle „GitHub Actions“ (N24).
   B2f: Ohne Grundton steht „–“ statt der Note „--“.
   B2g: Die Take-CSV nennt die Streuungsgrenze des Takes (spread_max_hz).
   B2h: Die Serie trägt die Fensterzahl je Formant: „nur in 2 Fenstern“ auch neben anderen Gründen (Hover, CSV).
   B2i: H1*−H2* mit einer Artefakt-Bandbreite (unter 40 Hz) steht live, im Hover, im Detail und in der CSV da.
   B2j: In stimmlosen Rahmen stehen Marken und Gründe der Rahmen-CSV als fehlend (−99, leer), nie als 0 = „sicher“. */
async function kriterienB2(H) {
  const { D, SR, noise } = H;
  const check = (id, name, ok, detail) => H.check(id, (id.length >= 5 ? ' ' : '') + name, ok, detail);
  const fehlerVorher = fehlerListe.length;
  const rms = x => { let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i]; return Math.sqrt(e / x.length); };
  const rostTeile = html => html.split(' · ').map(t => ({ rost: /class="rust/.test(t), text: t.replace(/<[^>]+>/g, '') }));

  /* ---------- B2a · Take-Ergebnis wie Detail: schwach belegte Formanten, zweideutiges Bestsegment ---------- */
  try {
    // /o/ auf A2, 2,5 s, davor 0,5 s Raumrauschen; Rauschen 30 dB unter dem Vokal. F1 und F2 sind fast überall
    // gültig, F3 und F4 nur in einem Teil der Rahmen (bei realistischem Abstand von 30–50 dB üblich).
    const o = D.synthVowel(110, [430, 800, 2450, 3200, 4000], [60, 80, 120, 150, 200], 2.5, SR, { gain: 0.3 });
    const z = noise(o.length + SR / 2, 1, 51), g = rms(o) / rms(z) * Math.pow(10, -30 / 20), sig = new Float32Array(z.length);
    for (let i = 0; i < sig.length; i++) sig[i] = g * z[i] + (i >= SR / 2 ? o[i - SR / 2] : 0);
    let liefer = () => ({ samples: Float32Array.from(sig), sampleRate: SR, durationS: sig.length / SR });
    const br = idbNeu(), p = await seiteNeu(br, () => liefer(), SR);
    p.kalibriert('cal-1'); await p.mikrofon();
    const bad = [], belege = [];
    // Soll unabhängig von chronik.js: schwach = weniger als 10 gültige Rahmen oder Anteil unter 0,5; dann Rost mit Anteil.
    const schwachSoll = f => !(f.n >= 10) || !(f.share >= 0.5);
    const pruefeTake = async (T, name) => {
      const ks = U.kacheln(p.el('take-result').innerHTML), fk = ks.find(k => /^F1–F5 Median/.test(k.k));
      if (!fk) { bad.push(name + ': keine Kachel F1–F5'); return { ks }; }
      const teile = rostTeile(fk.vHtml), schwach = [];
      T.summary.F.forEach((f, k) => {
        const soll = schwachSoll(f), t = teile[k] || { rost: null, text: '?' };
        const anteil = 'gültig in ' + (f.share > 0 && f.share < 0.01 ? '< 1' : String(Math.round(f.share * 100))) + ' %';
        if (soll) schwach.push(k);
        if (t.rost !== soll || (soll && t.text.indexOf(anteil) < 0) || (soll && f.n > 0 && f.n < 10 && t.text.indexOf('n = ' + f.n) < 0)) bad.push(name + ' F' + (k + 1) + ' (n=' + f.n + ', ' + (100 * f.share).toFixed(0) + ' %): „' + t.text + '“ ' + (t.rost ? 'in Rost' : 'ohne Rost'));
      });
      // Das Detail desselben Takes führt dieselben Formanten in Rost.
      p.geheZu('#/take/' + T.id);
      await p.warte(() => p.el('take-detail').innerHTML.indexOf('<h2>' + T.code + ' ') >= 0, 3000);
      const dk = U.kacheln(p.el('take-detail').innerHTML), dSchwach = [0, 1, 2, 3, 4].filter(k => { const x = dk.find(c => c.k === 'F' + (k + 1)); return x && /\bunsure\b/.test(x.klasse); });
      if (dSchwach.join() !== schwach.join()) bad.push(name + ': Detail in Rost F' + dSchwach.map(k => k + 1).join(',') + ', Ergebnis F' + schwach.map(k => k + 1).join(','));
      belege.push(name + ' „' + fk.v + '“');
      p.geheZu('#/aufnahme');
      return { ks, schwach };
    };
    const T1 = await p.take();
    const r1 = await pruefeTake(T1, 'Rauschen');
    // Eingespeiste Zusammenfassung: F2 mit hohem Anteil, aber nur 8 Rahmen; F5 nicht gefunden; Bestsegment /a/ zu
    // 30 % zweideutig, /o/ nur aus zweideutigen Segmenten.
    liefer = () => ({ samples: Float32Array.from(sig), sampleRate: SR, durationS: sig.length / SR });
    const AA = p.sb.VAREANALYSIS, echt = AA.analyseTake;
    AA.analyseTake = function () {
      return echt.apply(this, arguments).then(r => {
        r.summary.F[1].n = 8; r.summary.F[1].share = 0.9; r.summary.F[4] = { med: NaN, q1: NaN, q3: NaN, n: 0, share: 0 };
        r.summary.perVowel = { a: { nStable: 40, segments: 1, segmentsAmbiguous: 0, d34: null, bestSegment: { d34Med: 812, startS: 0.6, lenS: 0.8, n: 40, ambiguousShare: 0.3 } },
          o: { nStable: 20, segments: 1, segmentsAmbiguous: 1, d34: null, bestSegment: null } };
        return r;
      });
    };
    const T2 = await p.take();
    AA.analyseTake = echt;
    const r2 = await pruefeTake(T2, 'eingespeist');
    const best = (r2.ks || []).find(k => /^Bestes Segment/.test(k.k)) || { vHtml: '', v: '' };
    if (!/\/a\/ 812 <span class="rust[^"]*">zweideutig 30 %<\/span>/.test(best.vHtml) || !/\/o\/ –.*nur zweideutig zugeordnete Segmente/.test(best.v)) bad.push('Bestsegment „' + best.v + '“');
    belege.push('Bestsegment „' + best.v + '“');
    const gemischt = r1.schwach && r1.schwach.length > 0 && r1.schwach.length < 5;
    check('B2a', 'Take-Ergebnis wie Detail: schwach belegte Formanten (unter 10 Rahmen oder unter 50 % gültig) in Rost mit Anteil, die übrigen ohne; Bestsegment mit Zweideutig-Anteil in Rost (N8)',
      !bad.length && gemischt && [1, 4].every(k => (r2.schwach || []).indexOf(k) >= 0),
      (bad.length ? bad.slice(0, 4).join(' | ') + ' || ' : '') + 'schwach im Rauschtake F' + (r1.schwach || []).map(k => k + 1).join(',') + ' | ' + belege.join(' | '));
    p.schliessen();
  } catch (e) { check('B2a', 'Ablauf Take-Ergebnis läuft durch', false, kurzFehler(e)); }

  /* ---------- B2b · Neu-Analyse: Meldung nennt jede geänderte Rechenweise, Take-Knopf währenddessen gesperrt ---------- */
  try {
    const SIGb = H.concat([noise(Math.round(0.1 * SR), 2e-4, 61), D.synthVowel(196, [700, 1200, 2500, 3300, 4200], H.BW5, 1.0, SR, { gain: 0.3 }), noise(Math.round(0.1 * SR), 2e-4, 62)]);
    const br = idbNeu(), p = await seiteNeu(br, () => ({ samples: Float32Array.from(SIGb), sampleRate: SR, durationS: SIGb.length / SR }), SR);
    p.kalibriert('cal-b'); await p.S.putCalibration(p.st().cal); await p.mikrofon();
    const T = await p.take();
    const vorher = T.analysis.gate;
    // Regler so bewegen, wie es die Hand tut: input-Ereignis am Schieber, den renderSettings angelegt hat.
    const regler = (key, wert) => {
      const wrap = (p.el('settings').kinder || []).find(w => (w.innerHTML || '').indexOf('id="s-' + key + '"') >= 0);
      if (!wrap) throw new Error('Regler ' + key + ' fehlt');
      const inp = wrap.querySelector('input'); inp.value = String(wert); inp.feuern('input');
    };
    regler('windowS', 0.6); regler('sdF2Max', 40); regler('minValidShare', 1);
    // Neu-Analyse starten und mitten in ihr anhalten: Ist der Take-Knopf gesperrt?
    const neu = async () => {
      const t = await p.S.getTake(T.id);
      p.sb.VAREAPP.handlers.reanalyse(t);
      const lief = p.st().busy;
      p.halt();
      await new Promise(r => setTimeout(r, 20));
      const gesperrt = p.el('btn-take').disabled;
      p.weiter();
      await p.warte(() => !p.st().busy && /Neu analysiert|fehlgeschlagen/.test(p.status()), 30000);
      return { lief, gesperrt, status: p.status(), take: await p.S.getTake(T.id), frei: !p.el('btn-take').disabled };
    };
    const r1 = await neu();
    const r2 = await neu();   // nichts verstellt: gleiche Einstellungen
    await p.S.deleteCalibration('cal-b');
    const r3 = await neu();   // Kalibrierung fehlt: der Boden wird geschätzt
    const soll1 = ['Gatter-Fenster 0,3 → 0,6 s', 'F2-Bewegungsgrenze 100 → 40 Hz', 'Mindestanteil gültiger F1/F2 0,8 → 1'];
    const ok1 = r1.lief && r1.gesperrt && r1.frei && soll1.every(x => r1.status.indexOf(x) >= 0 && r1.take.reanalysisNote.indexOf(x) >= 0) && !/gleiche Einstellungen/.test(r1.status) && !/Rauschboden/.test(r1.status);
    const ok2 = r2.gesperrt && r2.frei && /\(gleiche Einstellungen\)/.test(r2.status) && r2.take.reanalysisNote === '';
    const ok3 = r3.gesperrt && r3.frei && /geändert: Rauschboden kalibriert → (geschätzt|unbekannt)$/.test(r3.status) && /^Rauschboden kalibriert → /.test(r3.take.reanalysisNote);
    const z = r => 'Take-Knopf ' + (r.gesperrt ? 'gesperrt' : 'frei') + ' während, ' + (r.frei ? 'frei' : 'gesperrt') + ' danach; „' + r.status + '“';
    check('B2b', 'Neu-Analyse: Meldung und Historie nennen jeden geänderten Gatterwert („alt → neu“) und einen geänderten Rauschboden, „gleiche Einstellungen“ nur ohne Änderung; der Take-Knopf ist während der Neu-Analyse gesperrt (N20)',
      vorher && vorher.windowS === 0.3 && ok1 && ok2 && ok3,
      'gerechnet mit Fenster ' + (vorher && vorher.windowS) + ' | verstellt: ' + z(r1) + ' | unverändert: ' + z(r2) + ' | ohne Kalibrierung: ' + z(r3));
    p.schliessen();
  } catch (e) { check('B2b', 'Ablauf Neu-Analyse läuft durch', false, kurzFehler(e)); }

  /* ---------- B2c · Keine Take-Codes, die CSV-Leser als fehlend, Zahl oder Wahrheitswert lesen ---------- */
  try {
    const A = H.A;
    // Soll unabhängig von analysis.js: Codes A, B, … Z, AA, …; gesperrt sind die Texte, die pandas (Vorgaben) als
    // fehlend (NA, NULL), allein in der Spalte als Zahl (INF, INFINITY) oder Wahrheitswert (TRUE, FALSE) liest, die
    // Excel-Wahrheitswerte (WAHR, FALSCH) und die Großschreibungen der pandas-Marken NaN und None.
    const SOLL = ['NA', 'NULL', 'INF', 'INFINITY', 'TRUE', 'FALSE', 'WAHR', 'FALSCH', 'NAN', 'NONE'];
    const code = n => { let c = ''; n = n + 1; while (n > 0) { const r = (n - 1) % 26; c = String.fromCharCode(65 + r) + c; n = Math.floor((n - 1) / 26); } return c; };
    const index = c => { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const bad = [];
    // Fortlaufend vergeben wie finishTake: Zähler → nächster freier Index → Code, Zähler + 1.
    let n = 0, vergeben = 0;
    for (let i = 0; i < 12000; i++) { n = A.nextCodeIndex([], n); if (SOLL.indexOf(code(n)) >= 0) bad.push('Take ' + (i + 1) + ' bekäme ' + code(n)); vergeben++; n++; }
    // Die fernen Codes direkt: weder aus dem Zähler noch als Nachfolger eines vorhandenen Codes.
    for (const c of SOLL) {
      const k = index(c), a = A.nextCodeIndex([], k), b = A.nextCodeIndex([{ code: code(k - 1) }], 0);
      if (a === k || b === k) bad.push(c + ': Zähler → ' + code(a) + ', nach ' + code(k - 1) + ' → ' + code(b));
    }
    // Ein vorhandener gesperrter Code (ältere Fassung, Import) bleibt und zählt: danach kommt der nächste.
    if (code(A.nextCodeIndex([{ code: 'NA' }], 0)) !== 'NB') bad.push('nach vorhandenem NA: ' + code(A.nextCodeIndex([{ code: 'NA' }], 0)));
    // Über die Seite: Zähler steht vor NA.
    const SIGc = H.concat([noise(Math.round(0.1 * SR), 2e-4, 71), D.synthVowel(196, [700, 1200, 2500, 3300, 4200], H.BW5, 1.0, SR, { gain: 0.3 }), noise(Math.round(0.1 * SR), 2e-4, 72)]);
    const br = idbNeu(), p = await seiteNeu(br, () => ({ samples: Float32Array.from(SIGc), sampleRate: SR, durationS: SIGc.length / SR }), SR);
    p.kalibriert('cal-c'); await p.mikrofon();
    await p.S.setMeta('nextCode', index('MZ'));
    const t1 = await p.take(), t2 = await p.take();
    const zaehler = await p.S.getMeta('nextCode', null);
    p.schliessen();
    if (!t1 || t1.code !== 'MZ' || !t2 || t2.code !== 'NB' || zaehler !== index('NB') + 1) bad.push('Seite: ' + (t1 && t1.code) + ', ' + (t2 && t2.code) + ', Zähler danach ' + code(zaehler));
    // Lesebeispiel im README: wie pandas die CSV liest, ohne dass ein Code oder ein leerer Text als fehlend gilt.
    const readme = quelle('README.md');
    if (!/keep_default_na=False/.test(readme) || !/na_values=\[-99\]/.test(readme)) bad.push('README ohne Lesebeispiel keep_default_na=False, na_values=[-99]');
    check('B2c', 'Take-Codes: nie NA, NULL, INF, INFINITY, TRUE, FALSE, WAHR, FALSCH, NAN, NONE (pandas liest sie als fehlend, Zahl oder Wahrheitswert), auch nicht über die Seite; README nennt das Lesebeispiel (N18)',
      !bad.length && vergeben === 12000, bad.length ? bad.slice(0, 5).join(' | ') : vergeben + ' Codes fortlaufend vergeben bis ' + code(n - 1) + ', Seite: ' + t1.code + ' → ' + t2.code);
  } catch (e) { check('B2c', 'Ablauf Take-Codes läuft durch', false, kurzFehler(e)); }

  /* ---------- B2d · Sicherung: die ganze Datei zählt, nie „Invalid string length“ ---------- */
  try {
    const C = H.C;
    const SIGd = H.concat([noise(Math.round(0.1 * SR), 2e-4, 81), D.synthVowel(147, [700, 1200, 2500, 3300, 4200], H.BW5, 1.0, SR, { gain: 0.3 }), noise(Math.round(0.1 * SR), 2e-4, 82)]);
    const br = idbNeu(), p = await seiteNeu(br, () => ({ samples: Float32Array.from(SIGd), sampleRate: SR, durationS: SIGd.length / SR }), SR);
    p.kalibriert('cal-d'); await p.mikrofon();
    await p.take(); await p.take(); await p.take();
    const CC = p.sb.VARECSV, grenzeVorgabe = CC.SICHERUNG_MAX_BYTES, echtSer = CC.serializeBackup;
    let fragen = 0, antwort = true;
    p.sb.confirm = () => { fragen++; return antwort; };
    // Eine Sicherung auslösen; geliefert werden Datei (oder null), Statuszeile und Zahl der Rückfragen.
    const sichern = async () => {
      const n0 = p.downloads.length, f0 = fragen; p.sb.VAREAPP.state.statusEl && (p.sb.VAREAPP.state.statusEl.textContent = '');
      p.klick('btn-export-json');
      await p.warte(() => p.downloads.length > n0 || /Sicherung|Audio/.test(p.status()), 10000);
      await new Promise(r => setTimeout(r, 20));
      const blob = p.downloads.length > n0 ? p.downloads[p.downloads.length - 1] : null, text = blob ? await blob.text() : '';
      let back = null; try { back = text ? C.parseBackup(text) : null; } catch (e) { back = null; }
      return { blob, groesse: blob ? blob.size : 0, back, status: p.status(), fragen: fragen - f0 };
    };
    // Größen messen: nur Messwerte (Rückfrage verneint), dann mit Audio.
    antwort = false; const ohne = await sichern();
    antwort = true; const mit = await sichern();
    const audioZeichen = mit.groesse - ohne.groesse;
    const z = r => (r.blob ? bytes(r.groesse) + ', ' + (r.back ? r.back.takes.length + ' Takes, ' + Object.keys(r.back.series).length + ' Verläufe, ' + Object.keys(r.back.audio).length + ' WAV' : 'nicht lesbar') : 'keine Datei') + ', Rückfragen ' + r.fragen + ', „' + r.status.slice(0, 150) + '“';
    const bytes = n => (n / 1e3).toFixed(0) + ' kB';
    const kein = r => !/Invalid string length|fehlgeschlagen/.test(r.status);
    // A: Grenze zwischen Messwerten und Messwerten mit Audio. Erwartet: Sicherung ohne Audio unter der Grenze, mit Grund.
    CC.SICHERUNG_MAX_BYTES = ohne.groesse + Math.round(audioZeichen / 2);
    const a = await sichern();
    const okA = !!a.back && a.groesse <= CC.SICHERUNG_MAX_BYTES && a.back.takes.length === 3 && Object.keys(a.back.series).length === 3 && Object.keys(a.back.audio).length === 0
      && a.fragen === 0 && /Audio nicht mitgesichert/.test(a.status) && /höchstens/.test(a.status) && kein(a);
    // B: Grenze unter den Messwerten allein. Erwartet: keine Datei, Klartext.
    CC.SICHERUNG_MAX_BYTES = ohne.groesse - 1000;
    const b = await sichern();
    const okB = !b.blob && /Keine Sicherung möglich/.test(b.status) && /Messwerte allein/.test(b.status) && kein(b);
    // C: Vorgabegrenze, aber der String mit Audio passt nicht in den Speicher (RangeError wie bei 2^29 Zeichen).
    CC.SICHERUNG_MAX_BYTES = grenzeVorgabe;
    CC.serializeBackup = function (bundle) { if (bundle.audio) throw new RangeError('Invalid string length'); return echtSer.apply(this, arguments); };
    const c = await sichern();
    const okC = !!c.back && Object.keys(c.back.audio).length === 0 && c.back.takes.length === 3 && /Audio nicht mitgesichert/.test(c.status) && kein(c);
    // D: schon die Messwerte passen nicht in einen String.
    CC.serializeBackup = function () { throw new RangeError('Invalid string length'); };
    const d = await sichern();
    const okD = !d.blob && /Keine Sicherung möglich/.test(d.status) && kein(d);
    CC.serializeBackup = echtSer;
    // Die Vorgabe selbst liegt unter dem, was Chrome und Edge beim Import lesen (2^29 − 24 Byte).
    const okGrenze = grenzeVorgabe > 0 && grenzeVorgabe <= 536870888;
    check('B2d', 'Sicherung: geprüft wird die ganze Datei gegen die Grenze, die sich wieder einlesen lässt; passt Audio nicht, entsteht die Sicherung ohne Audio mit Grund, passen schon die Messwerte nicht, keine Datei mit Klartext; nie „Invalid string length“ (N19)',
      !!ohne.back && !!mit.back && Object.keys(mit.back.audio).length === 3 && okA && okB && okC && okD && okGrenze,
      'Grenze ' + grenzeVorgabe + ' | nur Messwerte ' + z(ohne) + ' | mit Audio ' + z(mit) + ' || A (Grenze dazwischen) ' + z(a) + ' || B (unter den Messwerten) ' + z(b) + ' || C (RangeError mit Audio) ' + z(c) + ' || D (RangeError ohne Audio) ' + z(d));
    p.schliessen();
  } catch (e) { check('B2d', 'Ablauf Sicherung läuft durch', false, kurzFehler(e)); }

  /* ---------- B2e · README und pages.yml nennen dieselbe Pages-Quelle ---------- */
  try {
    // Hängt die Veröffentlichung am Prüflauf (deploy needs test), muss Pages auf „GitHub Actions“ stehen. Mit der Quelle
    // „Deploy from a branch“ veröffentlicht GitHub jeden Push selbst, ohne Prüflauf, und das Gate greift nicht (N24).
    const readme = quelle('README.md'), pages = quelle(path.join('.github', 'workflows', 'pages.yml'));
    const gate = /\bdeploy:[\s\S]*?\bneeds:\s*\[?\s*test\b/.test(pages), quelleYml = /Source:\s*"?GitHub Actions/.test(pages);
    const abschnitt = (/\*\*GitHub Pages:\*\*([\s\S]*?)(?:\n\n|\n\*\*|\nAdresse)/.exec(readme) || [])[1] || '';
    const nenntActions = /Source:\s*\**"?GitHub Actions/.test(abschnitt);
    // „Deploy from a branch“ darf nur als Warnung („Nicht …“) dastehen, nie als Anweisung.
    const branchAnweisung = abschnitt.split(/(?<=\.)\s+/).some(satz => /Deploy from a branch/.test(satz) && !/\bNicht\b|\bnicht\b/.test(satz));
    check('B2e', 'README richtet Pages so ein, wie pages.yml es verlangt: Source „GitHub Actions“, damit nur nach grünem Prüflauf veröffentlicht wird; „Deploy from a branch“ nicht als Anweisung (N24)',
      gate && quelleYml && nenntActions && !branchAnweisung,
      'pages.yml: deploy needs test=' + gate + ', verlangt GitHub Actions=' + quelleYml + ' | README: „' + abschnitt.replace(/\s+/g, ' ').trim().slice(0, 160) + '“, nennt GitHub Actions=' + nenntActions + ', Branch als Anweisung=' + branchAnweisung);
  } catch (e) { check('B2e', 'Ablauf README/pages.yml läuft durch', false, kurzFehler(e)); }

  /* ---------- B2f · Ohne Grundton keine Note „--“, sondern „–“ wie bei jedem fehlenden Wert ---------- */
  try {
    // Take nur aus Raumrauschen (kein Grundton) und ein /a/ auf G3 (Note G3) als Gegenprobe.
    const still = noise(Math.round(1.3 * SR), 3e-3, 91);
    const vokal = H.concat([noise(Math.round(0.1 * SR), 2e-4, 92), D.synthVowel(196, [700, 1200, 2500, 3300, 4200], H.BW5, 1.0, SR, { gain: 0.3 }), noise(Math.round(0.1 * SR), 2e-4, 93)]);
    let sig = still;
    const br = idbNeu(), p = await seiteNeu(br, () => ({ samples: Float32Array.from(sig), sampleRate: SR, durationS: sig.length / SR }), SR);
    p.kalibriert('cal-f'); await p.mikrofon();
    const ansicht = async T => {
      const erg = (U.kacheln(p.el('take-result').innerHTML).find(k => k.k === 'F0') || {}).v || '?';
      p.sb.VAREAPP.refreshChronik(); await p.warte(() => p.el('takes-list').innerHTML.indexOf('data-id="' + T.id + '"') >= 0, 3000);
      const m = new RegExp('<tr data-id="' + T.id + '">([\\s\\S]*?)</tr>').exec(p.el('takes-list').innerHTML), zellen = m ? m[1].split('</td>').map(z => z.replace(/<[^>]+>/g, '')) : [];
      p.geheZu('#/take/' + T.id); await p.warte(() => p.el('take-detail').innerHTML.indexOf('<h2>' + T.code + ' ') >= 0, 3000);
      const det = (U.kacheln(p.el('take-detail').innerHTML).find(k => /^F0 Median/.test(k.k)) || {}).v || '?';
      p.geheZu('#/aufnahme');
      return { erg, liste: zellen[2] || '?', det };
    };
    const Ts = await p.take(), a = await ansicht(Ts);
    sig = vokal; const Tv = await p.take(), b = await ansicht(Tv);
    const ohneOk = Ts.summary.f0.note === '--' && !/--/.test(a.erg + a.liste + a.det) && /^–/.test(a.erg) && /^–/.test(a.liste) && /^–/.test(a.det);
    const mitOk = /G3/.test(b.erg) && /G3/.test(b.liste) && /G3/.test(b.det);
    check('B2f', 'Ohne gemessenen Grundton steht keine Note „--“, sondern „–“ (Take-Ergebnis, Liste, Detail); mit Grundton die Note',
      ohneOk && mitOk, 'ohne Grundton (Zusammenfassung „' + Ts.summary.f0.note + '“): Ergebnis „' + a.erg + '“, Liste „' + a.liste + '“, Detail „' + a.det + '“ | /a/ G3: „' + b.erg + '“, „' + b.liste + '“, „' + b.det + '“');
    p.schliessen();
  } catch (e) { check('B2f', 'Ablauf Note ohne Grundton läuft durch', false, kurzFehler(e)); }

  /* ---------- B2g · Take-CSV nennt die Streuungsgrenze, mit der der Take gerechnet wurde ---------- */
  try {
    const SIGg = H.concat([noise(Math.round(0.1 * SR), 2e-4, 101), D.synthVowel(196, [700, 1200, 2500, 3300, 4200], H.BW5, 1.0, SR, { gain: 0.3 }), noise(Math.round(0.1 * SR), 2e-4, 102)]);
    const br = idbNeu(), p = await seiteNeu(br, () => ({ samples: Float32Array.from(SIGg), sampleRate: SR, durationS: SIGg.length / SR }), SR);
    p.kalibriert('cal-g'); await p.mikrofon();
    const T1 = await p.take();
    p.st().settings.spreadMaxHz = 120;
    const T2 = await p.take();
    // Ein Take aus einer älteren Fassung ohne die Angabe.
    const alt = Object.assign(await p.S.getTake(T1.id), { id: 'b2g-alt', code: 'Q', createdAt: '2026-01-01T09:00:00.000Z' });
    delete alt.analysis.spreadMaxHz; await p.S.putTake(alt);
    const lies = async dialekt => {
      p.st().settings.csvDialect = dialekt;
      const n0 = p.downloads.length; p.geheZu('#/chronik'); p.klick('btn-export-csv');
      await p.warte(() => p.downloads.length > n0, 5000);
      const text = (await p.downloads[p.downloads.length - 1].text()).replace(/^\uFEFF/, ''), sep = dialekt === 'excelde' ? ';' : ',';
      const z = text.split('\r\n').filter(Boolean).map(x => x.split(sep)), k = z[0].indexOf('spread_max_hz'), c = z[0].indexOf('code');
      const o = {}; z.slice(1).forEach(r => { o[r[c]] = k >= 0 ? r[k] : '(Spalte fehlt)'; });
      return o;
    };
    const st = await lies('standard'), de = await lies('excelde');
    const soll = { [T1.code]: '130', [T2.code]: '120', Q: '-99' };
    const ok = Object.keys(soll).every(c => st[c] === soll[c] && de[c] === soll[c]) && T1.analysis.spreadMaxHz === 130 && T2.analysis.spreadMaxHz === 120;
    check('B2g', 'Take-CSV: spread_max_hz trägt die Streuungsgrenze, mit der der Take gerechnet wurde (130 bzw. 120 Hz), ältere Takes ohne Angabe −99, beide Dialekte',
      ok, 'Standard ' + JSON.stringify(st) + ' | Excel DE ' + JSON.stringify(de));
    p.schliessen();
  } catch (e) { check('B2g', 'Ablauf Streuungsgrenze in der CSV läuft durch', false, kurzFehler(e)); }

  /* ---------- B2h · Fensterzahl je Formant in Serie, Hover und Rahmen-CSV ---------- */
  try {
    const A = H.A, C = H.C, TSR = D.TARGET_SR;
    // Tiefer enger Cluster auf A2 in Rauschen 30 dB unter dem Vokal, /a/ auf E4, /o/ auf B3 mit F6 im Band: Hier stehen
    // ungültige Formanten in genau 2 Fenstern, jeweils neben einem anderen Grund.
    const mitR = (x, db, seed) => { const z = noise(x.length, 1, seed), g = rms(x) / rms(z) * Math.pow(10, -db / 20), y = Float64Array.from(x); for (let i = 0; i < y.length; i++) y[i] += g * z[i]; return y; };
    const SIGh = H.concat([noise(Math.round(0.2 * SR), 2e-4, 21), mitR(D.synthVowel(110, [500, 1500, 1700, 2200, 3150], [70, 90, 90, 90, 100], 0.9, SR), 30, 22),
      D.synthVowel(330, [700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200], 0.5, SR), D.synthVowel(247, [500, 800, 2600, 2950, 4100, 4600], [70, 90, 120, 150, 200, 220], 0.5, SR), noise(Math.round(0.2 * SR), 2e-4, 23)]);
    const hopS = 0.02, res = await A.analyseTake(SIGh, SR, { hopS }), ser = res.series, n = ser.t.length;
    // Dieselben Rahmen nachrechnen wie analyseTake: Raster, Rand 30 ms, Boden aus dem Take.
    const ds = D.resample(SIGh, SR, TSR), hop = Math.round(hopS * TSR), half = Math.round(0.03 * TSR), floorDb = A.estimateFloor(ds, TSR, hopS).db, R = [];
    for (let c = half; c + half <= ds.length; c += hop) R.push(D.analyseAt(ds, TSR, c, { align: 'centre', floorDb, spreadMaxHz: D.SPREAD_MAX_HZ }));
    const CHR = U.chronikNeu().VARECHRONIK, bad = [];
    const z = C.framesToCsv(ser, 'standard', H.V).split('\r\n').filter(Boolean).map(x => x.split(',')), kopf = z[0];
    const alt = Object.assign({}, ser); delete alt.nWin;
    const za = C.framesToCsv(alt, 'standard', H.V).split('\r\n').filter(Boolean).map(x => x.split(','));
    let zweiMitAnderem = 0, zweiGeprueft = 0, zellen = 0;
    if (R.length !== n) bad.push(n + ' Rahmen, ' + R.length + ' nachgerechnet');
    if (!(ser.nWin instanceof Uint16Array)) bad.push('Serie ohne nWin (Uint16Array)');
    for (let i = 0; i < Math.min(n, R.length) && !bad.length; i++) {
      const r = R[i], h = CHR.hoverText(ser, i, D.SPREAD_MAX_HZ);
      const rost = (h.match(/<span class="rust">[^<]*<\/span>/g) || []).map(x => x.replace(/<[^>]+>/g, ''));
      for (let k = 0; k < 5; k++) {
        const ist = (ser.nWin[i] >> (3 * k)) & 7;
        if (ist !== (r.voiced ? r.nWin[k] : 0)) { if (bad.length < 6) bad.push('t ' + i + ' F' + (k + 1) + ': nWin ' + ist + ' statt ' + r.nWin[k]); }
        const c = kopf.indexOf('n_win' + (k + 1)), soll = r.voiced ? String(r.nWin[k]) : '-99';
        if (c < 0 || z[i + 1][c] !== soll || za[i + 1][c] !== '-99') { if (bad.length < 6) bad.push('CSV n_win' + (k + 1) + '[' + i + '] ' + (c < 0 ? 'fehlt' : z[i + 1][c] + ' statt ' + soll + ', ältere Serie ' + za[i + 1][c])); } else zellen++;
        if (!r.voiced || r.valid[k]) continue;
        const teil = rost.find(x => x.startsWith('F' + (k + 1) + ' ')) || '', zwei = /nur in 2 Fenstern/.test(teil);
        if (r.nWin[k] === 2) {
          zweiGeprueft++;
          if (r.slotGrund[k] || r.rauschBoden[k] || r.sdOrder[k] >= D.SPREAD_MAX_HZ || r.sdWin[k] >= D.SPREAD_MAX_HZ || r.nOrders[k] < 2) zweiMitAnderem++;
          if (!zwei) bad.push('t ' + i + ' F' + (k + 1) + ' in 2 Fenstern, Hover „' + teil + '“');
        } else if (zwei) bad.push('t ' + i + ' F' + (k + 1) + ' in ' + r.nWin[k] + ' Fenstern, Hover „' + teil + '“');
      }
    }
    check('B2h', 'Fensterzahl je Formant (nWin) in der Serie wie analyseAt; Hover nennt „nur in 2 Fenstern“ auch neben anderen Gründen; Rahmen-CSV n_win1…5 (stimmlos und ältere Serie −99)',
      !bad.length && zweiMitAnderem >= 1 && zellen === 5 * n,
      (bad.length ? bad.slice(0, 5).join(' | ') + ' || ' : '') + n + ' Rahmen, ungültig in 2 Fenstern ' + zweiGeprueft + ' (davon mit anderem Grund ' + zweiMitAnderem + '), CSV-Zellen ' + zellen + '/' + 5 * n);
  } catch (e) { check('B2h', 'Ablauf Fensterzahl läuft durch', false, kurzFehler(e)); }

  /* ---------- B2i · H1*−H2* mit Artefakt-Bandbreite: live, Hover, Detail und CSV sagen es ---------- */
  try {
    const A = H.A, C = H.C, TSR = D.TARGET_SR, F = A.FLAG;
    // /a/ auf D3 mit LPC-Bandbreiten um 30 Hz (Artefakt, physik.md 2.4) und dasselbe /a/ mit üblichen Bandbreiten.
    const schmal = D.synthVowel(147, [700, 1200, 2500, 3300, 4200], [30, 30, 30, 150, 200], 0.6, SR, { gain: 0.3 });
    const normal = D.synthVowel(147, [700, 1200, 2500, 3300, 4200], H.BW5, 0.6, SR, { gain: 0.3 });
    const SIGi = H.concat([noise(Math.round(0.2 * SR), 2e-4, 111), schmal, normal, noise(Math.round(0.2 * SR), 2e-4, 112)]);
    const bad = [];
    // 1. Zusammenfassung: Anteil über dieselben Rahmen wie der H1*−H2*-Median, hier unabhängig gezählt.
    const res = await A.analyseTake(SIGi, SR, { hopS: 0.02 }), ser = res.series;
    let n = 0, art = 0;
    const artefakt = i => isFinite(ser.h1h2c[i]) && (ser.bw1[i] < 40 || ser.bw2[i] < 40 || ser.bw3[i] < 40);
    for (let i = 0; i < ser.t.length; i++) { if (!(ser.flags[i] & F.VOICED) || (ser.flags[i] & F.F0UNSURE) || !isFinite(ser.h1h2c[i])) continue; n++; if (artefakt(i)) art++; }
    const anteil = res.summary.h1h2c.bwArtefaktShare;
    if (!(n > 0 && art > 0 && art < n && Math.abs(anteil - art / n) < 1e-12)) bad.push('Anteil ' + anteil + ' statt ' + art + '/' + n);
    // 2. Hover: jeder Rahmen mit Artefakt-Bandbreite sagt es bei H1*−H2*, kein anderer.
    const CHR = U.chronikNeu().VARECHRONIK;
    let hMit = 0, hOhne = 0;
    for (let i = 0; i < ser.t.length; i++) {
      if (!(ser.flags[i] & F.VOICED)) continue;
      const h = CHR.hoverText(ser, i, 130).replace(/<[^>]+>/g, ''), sagt = /H1\*−H2\* -?[\d.]+ \(Bandbreite unter 40 Hz, auf 40 Hz begrenzt\)/.test(h);
      if (sagt !== artefakt(i)) { if (bad.length < 5) bad.push('Hover t ' + i + ': „' + h.slice(h.indexOf('H1−H2'), h.indexOf('H1−H2') + 90) + '“'); } else if (sagt) hMit++; else hOhne++;
    }
    // 3. Take-CSV
    const z = C.takesToCsv([{ code: 'I', summary: res.summary }], 'standard').split('\r\n'), kopf = z[0].split(','), c = kopf.indexOf('h1h2c_bw_artifact_share');
    const csv = c >= 0 ? z[1].split(',')[c] : '(Spalte fehlt)';
    const csvSoll = typeof anteil === 'number' ? anteil.toFixed(3) : '(kein Anteil in der Zusammenfassung)';
    if (csv !== csvSoll) bad.push('CSV ' + csv + ' statt ' + csvSoll);
    // 4. Detail über die Seite, dazu ein älterer Take ohne den Anteil; 5. live über die Live-Schleife der Seite.
    const br = idbNeu(), p = await seiteNeu(br, () => ({ samples: Float32Array.from(SIGi), sampleRate: SR, durationS: SIGi.length / SR }), SR);
    let tick = null;
    p.sb.requestAnimationFrame = f => { tick = f; return 1; };
    p.kalibriert('cal-i'); await p.mikrofon();
    const T = await p.take();
    const kachel = async id => { p.geheZu('#/take/' + id); await p.warte(() => /H1−H2/.test(p.el('take-detail').innerHTML) && p.el('take-detail').innerHTML.indexOf(id) >= 0, 3000); return (U.kacheln(p.el('take-detail').innerHTML).find(k => /^H1−H2/.test(k.k)) || {}).v || '?'; };
    const dNeu = await kachel(T.id);
    const alt = Object.assign(await p.S.getTake(T.id), { id: 'b2i-alt', code: 'Q' }); delete alt.summary.h1h2c.bwArtefaktShare; await p.S.putTake(alt);
    const dAlt = await kachel('b2i-alt');
    const pz = x => (x > 0 && x < 0.01) ? '< 1' : String(Math.round(x * 100));
    if (!new RegExp('H1\\*−H2\\* in ' + pz(T.summary.h1h2c.bwArtefaktShare) + ' % der Rahmen mit Bandbreite unter 40 Hz gerechnet').test(dNeu)) bad.push('Detail „' + dNeu + '“');
    if (!/Bandbreite unter 40 Hz nicht gespeichert/.test(dAlt)) bad.push('Detail älterer Take „' + dAlt + '“');
    p.geheZu('#/aufnahme');
    const ds = D.resample(Float32Array.from(schmal), SR, TSR), dsN = D.resample(Float32Array.from(normal), SR, TSR);
    const frA = D.analyseAt(ds, TSR, ds.length - 1, { align: 'end', floorDb: -72 }), frN = D.analyseAt(dsN, TSR, dsN.length - 1, { align: 'end', floorDb: -72 });
    const DD = p.sb.VAREDSP, echt = DD.analyseAt, rec = p.st().rec, live = [];
    rec.latest = s => new Float32Array(Math.round(s * SR));
    let jetzt = 1000;
    for (const fr of [frA, frN]) { DD.analyseAt = () => fr; rec.samplesSeen += 1000; jetzt += 50; if (tick) tick(jetzt); live.push(p.el('v-h1h2').textContent); }
    DD.analyseAt = echt;
    const liveOk = frA.h1h2cArtifact === true && frN.h1h2cArtifact === false && /H1\*−H2\* mit Bandbreite unter 40 Hz gerechnet \(auf 40 Hz begrenzt\)/.test(live[0]) && !/Bandbreite/.test(live[1]);
    if (!liveOk) bad.push('live „' + live.join('“ / „') + '“');
    check('B2i', 'H1*−H2* mit einer LPC-Bandbreite unter 40 Hz (auf 40 Hz begrenzt) ist sichtbar: live, im Hover je Rahmen, im Detail als Anteil (ältere Auswertung: nicht gespeichert), in der Take-CSV h1h2c_bw_artifact_share',
      !bad.length && hMit > 0 && hOhne > 0,
      (bad.length ? bad.join(' | ') + ' || ' : '') + 'Anteil ' + art + '/' + n + ', Hover mit/ohne ' + hMit + '/' + hOhne + ', CSV ' + csv + ' | Detail „' + dNeu.slice(dNeu.indexOf(')') + 1).trim() + '“ | live „' + (live[0] || '').slice(0, 120) + '“');
    p.schliessen();
  } catch (e) { check('B2i', 'Ablauf H1*−H2*-Bandbreite läuft durch', false, kurzFehler(e)); }

  /* ---------- B2j · Rahmen-CSV: in stimmlosen Rahmen keine 0, die sich als „sicher“ liest ---------- */
  try {
    const A = H.A, C = H.C, F = A.FLAG;
    // Raumrauschen, /a/ auf G3, Atempause, /o/ auf D3 mit einer Naht darin, Raumrauschen.
    const SIGj = H.concat([noise(Math.round(0.3 * SR), 3e-4, 121), D.synthVowel(196, [700, 1200, 2500, 3300, 4200], H.BW5, 0.8, SR, { gain: 0.3 }),
      noise(Math.round(0.3 * SR), 3e-4, 122), D.synthVowel(147, [500, 850, 2450, 3200, 4100], H.BW5, 0.8, SR, { gain: 0.3 }), noise(Math.round(0.3 * SR), 3e-4, 123)]);
    const res = await A.analyseTake(SIGj, SR, { hopS: 0.02, naehteS: [1.8] }), ser = res.series;
    // Soll unabhängig von csv.js: Spalten, die nur für einen gemessenen Rahmen etwas sagen.
    const BITS = ['f0_unsure', 'octave_corrected', 'octave_ambiguous', 'octave_unter_grenze', 'h1h2_unsure', 'shr_unsure', 'slot_unsure', 'n_peaks'];
    const TEXTE = ['f0_grund', 'f0_korrektur', 'shr_grund'];
    for (let k = 1; k <= 5; k++) { BITS.push('rauschboden' + k, 'n_win' + k); TEXTE.push('slot_grund' + k); }
    const FLAGBIT = { f0_unsure: F.F0UNSURE, octave_corrected: F.OCTAVE, octave_ambiguous: F.OCTAMBIG, octave_unter_grenze: F.OCTUNTER, h1h2_unsure: F.H1H2UNSURE, shr_unsure: F.SHRUNSURE };
    const bad = [];
    let stimmlos = 0, naht = 0, stimmhaft = 0;
    for (const [d, sep] of [['standard', ','], ['excelde', ';']]) {
      const z = C.framesToCsv(ser, d, H.V).replace(/^\uFEFF/, '').split('\r\n').filter(Boolean).map(x => x.split(sep)), kopf = z[0];
      for (const sp of BITS.concat(TEXTE, ['valid1'])) if (kopf.indexOf(sp) < 0) bad.push(sp + ' fehlt');
      for (let i = 0; i < ser.t.length && bad.length < 6; i++) {
        const zeile = z[i + 1], w = sp => zeile[kopf.indexOf(sp)];
        if (!(ser.flags[i] & F.VOICED)) {
          if (d === 'standard') { stimmlos++; if (ser.flags[i] & F.NAHT) naht++; }
          for (const sp of BITS) if (!/^-99$/.test(w(sp))) bad.push(d + ' t ' + i + ' stimmlos: ' + sp + ' ' + w(sp) + ' statt −99');
          for (const sp of TEXTE) if (w(sp) !== '') bad.push(d + ' t ' + i + ' stimmlos: ' + sp + ' „' + w(sp) + '“ statt leer');
          if (w('valid1') !== '0') bad.push(d + ' t ' + i + ' stimmlos: valid1 ' + w('valid1') + ' statt 0');
        } else {
          if (d === 'standard') stimmhaft++;
          for (const sp in FLAGBIT) if (w(sp) !== ((ser.flags[i] & FLAGBIT[sp]) ? '1' : '0')) bad.push(d + ' t ' + i + ' stimmhaft: ' + sp + ' ' + w(sp));
          for (let k = 1; k <= 5; k++) if (w('rauschboden' + k) !== ((ser.rauschBoden[i] & (1 << (k - 1))) ? '1' : '0')) bad.push(d + ' t ' + i + ' stimmhaft: rauschboden' + k + ' ' + w('rauschboden' + k));
          if (w('n_peaks') !== String(ser.nPeaks[i]) || w('slot_unsure') !== String(ser.slotUnsure[i])) bad.push(d + ' t ' + i + ' stimmhaft: n_peaks ' + w('n_peaks') + ', slot_unsure ' + w('slot_unsure'));
        }
      }
    }
    const readme = quelle('README.md');
    if (!/Stimmlose Rahmen/.test(readme) || !/nie 0, das sich als „sicher“ läse/.test(readme)) bad.push('README nennt die Regel nicht');
    check('B2j', 'Rahmen-CSV: In stimmlosen Rahmen (auch an einer Naht) stehen Marken und Gründe als −99 bzw. leer, nie 0 = „sicher“; valid bleibt 0; in stimmhaften Rahmen die Bits der Serie (beide Dialekte)',
      !bad.length && stimmlos >= 10 && naht >= 1 && stimmhaft >= 10,
      (bad.length ? bad.slice(0, 5).join(' | ') + ' || ' : '') + 'stimmlos ' + stimmlos + ' (davon an der Naht ' + naht + '), stimmhaft ' + stimmhaft + ', Spalten ' + BITS.length + ' Marken, ' + TEXTE.length + ' Gründe');
  } catch (e) { check('B2j', 'Ablauf Rahmen-CSV stimmlos läuft durch', false, kurzFehler(e)); }

  const neueFehler = fehlerListe.slice(fehlerVorher);
  check('B2z', 'Keine Ausnahme in der Seite während der B2-Abläufe', !neueFehler.length, neueFehler.slice(0, 3).join(' || '));
}
/* Kriterien B3 — Prüfstärke. Jede Sperre, die ein ungültiges ΔF3–4, ein filtergetriebenes H1−H2, eine offene
   Oktave oder ein zweideutiges Bestsegment sichtbar hält, hat hier ein Kriterium, das reißt, wenn sie fällt.
   Vorher überlebten die Mutanten der Nachprüfung den ganzen Prüflauf (N10–N13, N22, N23).
   B3a: ΔF3–4 wird nur aus einem gültigen ΔF3–4 gewertet: Gatter live und offline, Take, Referenz, CSV (N10).
   B3b: Die Zusammenfassung zählt für ΔF3–4, ΔF4–5 und F3 stabil nur gültige Rahmen (N11).
   B3c: H1−H2 bei F1 nahe 2·F0 heißt filtergetrieben: Rahmen, Zusammenfassung, CSV, Live-Kachel, Hover (N12).
   B3d: Ungültiges ΔF3–4/ΔF4–5 steht live in Rost; die ΔF3–4-Spur der Chronik zeichnet nur gültige Werte (N13).
   B3e: Periodenverdopplung mit Subharmonischer knapp unter der Oktavschwelle heißt „Oktave offen“ (N22).
   B3f: Freie und angepinnte Referenzen tragen den Zweideutig-Anteil ihres Bestsegments bis in die Tabelle (N23). */
async function kriterienB3(H) {
  const { D, V, A, C, SR, noise } = H;
  const check = (id, name, ok, detail) => H.check(id, (id.length >= 5 ? ' ' : '') + name, ok, detail);
  const fehlerVorher = fehlerListe.length;
  const F = A.FLAG, TSR = D.TARGET_SR;
  const rms = x => { let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i]; return Math.sqrt(e / x.length); };
  // Vokal im Raumrauschen, snr dB unter dem Vokal (Effektivwerte); davor und danach je rand s nur Rauschen.
  function imRauschen(v, snr, seed, rand) {
    const r0 = Math.round((rand || 0) * SR), n = v.length + 2 * r0, z = noise(n, 1, seed), g = rms(v) / Math.pow(10, snr / 20) / rms(z), y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = g * z[i] + (i >= r0 && i < r0 + v.length ? v[i - r0] : 0);
    return y;
  }
  // Quellneigung einer echten Glottisquelle (einpoliger Tiefpass): schwächt F3–F5 gegen das Raumrauschen.
  function quellneigung(v, fc) { const a = Math.exp(-2 * Math.PI * fc / SR); let z = 0; for (let i = 0; i < v.length; i++) { z = (1 - a) * v[i] + a * z; v[i] = z; } return v; }
  const takeAus = (res, id) => ({ id: id || 't', code: 'A', label: 'Prüftake', createdAt: '2026-10-07T10:00:00Z', durationS: 1.5, sampleRate: SR, analysis: res.meta, summary: res.summary });
  function csvSpalte(take, dialekt) {
    const z = C.takesToCsv([take], dialekt || 'standard').split('\r\n'), sep = dialekt === 'excelde' ? ';' : ',';
    const h = z[0].replace(/^﻿/, '').split(sep), r = z[1].split(sep);
    return k => (h.indexOf(k) < 0 ? 'Spalte ' + k + ' fehlt' : r[h.indexOf(k)]);
  }
  // CSV-Zelle zu einer Statistik: ohne Rahmen der Sentinel −99, sonst der Median auf eine Nachkommastelle.
  const csvWie = (zelle, st) => (st.n ? zelle !== '-99.0' && Math.abs(parseFloat(zelle) - st.med) <= 0.051 : zelle === '-99.0');
  // Chronik wie im Browser in einer eigenen Umgebung.
  const csb = { console: { log() { }, warn() { }, error: aufFehler }, devicePixelRatio: 1 };
  csb.self = csb; csb.window = csb; vm.createContext(csb);
  for (const f of ['dsp.js', 'vowel.js', 'analysis.js', 'csv.js', 'chronik.js']) vm.runInContext(quelle(f), csb, { filename: f });
  const CHR = csb.VARECHRONIK;
  // Zeichenfläche, die jeden Aufruf mit der gerade gesetzten Füllfarbe mitschreibt.
  function leinwand() {
    const ops = []; let fill = '';
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { ops.push([k, a, fill]); }), set: (t, k, v) => { t[k] = v; if (k === 'fillStyle') fill = v; return true; } });
    return { cv: { clientWidth: 600, style: {}, getContext: () => ctx }, ops };
  }
  /* Live-Seite: app.js mit echtem storage.js (wie B1), das Mikrofon liefert die letzten s Sekunden von quelle.sig
     bis quelle.pos. takt() rückt Audio und Uhr um 41 ms vor und ruft den Live-Takt der Seite auf. */
  async function liveSeite() {
    const p = await seiteNeu(idbNeu(), () => ({ samples: new Float32Array(0), sampleRate: SR, durationS: 0, luecken: [] }), SR);
    let raf = null;
    p.sb.requestAnimationFrame = f => { raf = f; return 1; };
    if (!(await p.mikrofon()) || !raf) throw new Error('Live-Schleife startet nicht');
    const rec = p.st().rec, quelle = { sig: new Float32Array(SR), pos: SR }, SCHRITT = Math.round(0.041 * SR);
    rec.latest = s => { const n = Math.round(s * SR), a = Math.max(0, quelle.pos - n); return quelle.sig.slice(a, quelle.pos); };
    let jetzt = 1000;
    p.quelle = quelle;
    p.takt = () => { rec.samplesSeen += SCHRITT; jetzt += 41; raf(jetzt); };
    p.kachel = id => ({ klasse: p.el('st-' + id).className, text: p.el('v-' + id).textContent });
    p.schritt = SCHRITT;
    return p;
  }

  /* ---------- B3a · ΔF3–4 gewertet nur aus gültigem ΔF3–4 ---------- */
  try {
    const bad = [];
    // a) Gatter: stehendes /a/ mit gültigem F1/F2 und F3 2600 Hz (über dem Mindestwert), ΔF3–4 endlich.
    //    Gegenprobe mit gültigem ΔF3–4: dieselben Rahmen werden gewertet; sonst prüfte die Sperre nichts.
    const rahmen = (i, gueltig) => ({ t: i * 0.01, voiced: true, F1: 700, F2: 1200, F3: 2600, valid1: true, valid2: true, d34: 1400, d34valid: gueltig });
    const gatter = gueltig => {
      const g = V.createGate({}), live = { stabil: 0, gewertet: 0, gruende: {} }, off = { stabil: 0, gewertet: 0, gruende: {} };
      const zaehl = (z, r) => { if (r.state !== 'stabil') return; z.stabil++; if (isFinite(r.score)) z.gewertet++; else z.gruende[r.reason] = (z.gruende[r.reason] || 0) + 1; };
      for (let i = 0; i < 100; i++) zaehl(live, g.update(rahmen(i, gueltig)));
      V.gateOffline(Array.from({ length: 100 }, (_, i) => rahmen(i, gueltig))).forEach(r => zaehl(off, r));
      return { live, off };
    };
    const ung = gatter(false), gue = gatter(true);
    for (const [art, z] of [['live', ung.live], ['offline', ung.off]]) {
      if (!(z.stabil >= 50)) bad.push(art + ': nur ' + z.stabil + ' stabile Rahmen');
      if (z.gewertet) bad.push(art + ': ' + z.gewertet + ' von ' + z.stabil + ' stabilen Rahmen mit ungültigem ΔF3–4 gewertet');
      if (Object.keys(z.gruende).some(g => !/F3\/F4 unsicher/.test(g))) bad.push(art + ': Grund ' + JSON.stringify(z.gruende));
    }
    if (!(gue.live.gewertet >= 50 && gue.off.gewertet >= 50)) bad.push('Gegenprobe gültiges ΔF3–4: live ' + gue.live.gewertet + ', offline ' + gue.off.gewertet + ' gewertet');
    // b) Take: /o/ 130 Hz, Quellneigung 500 Hz, weißes Raumrauschen 35 dB — F4 im Rauschen, ΔF3–4 fast nie gültig.
    const y = imRauschen(quellneigung(D.synthVowel(130, [450, 800, 2550, 3350, 4200], [80, 90, 120, 150, 200], 1.0, SR, { gain: 0.1 }), 500), 35, 4711, 0);
    const res = await A.analyseTake(y, SR, {}), se = res.series, sm = res.summary;
    let pruef = 0, gewertet = 0, ohne = 0, falsch = 0;
    for (let i = 0; i < se.t.length; i++) {
      if (se.gate[i] === 2 && se.f3[i] >= 2500 && isFinite(se.d34[i]) && !(se.flags[i] & F.D34VALID)) pruef++;
      if (se.flags[i] & F.SCORE) { gewertet++; if (!(se.flags[i] & F.D34VALID)) { ohne++; if (Math.abs(se.score[i] - 800) > 120) falsch++; } }
    }
    if (!(pruef >= 30)) bad.push('Vorbedingung: nur ' + pruef + ' stabile Rahmen mit F3 ≥ 2500 und ungültigem ΔF3–4');
    if (ohne) bad.push(ohne + ' Rahmen ohne gültiges ΔF3–4 gewertet (' + falsch + ' davon mehr als 120 Hz neben 800)');
    if (sm.d34stable.n !== gewertet - ohne) bad.push('ΔF3–4 stabil n ' + sm.d34stable.n + ' statt ' + (gewertet - ohne) + ' gültig gewertete Rahmen');
    const take = takeAus(res), sp = csvSpalte(take), refs = A.computeRefs([take], {});
    if (!csvWie(sp('d34_stable_med'), sm.d34stable)) bad.push('CSV d34_stable_med ' + sp('d34_stable_med') + ' bei n ' + sm.d34stable.n + ', Median ' + sm.d34stable.med);
    // Eine Referenz kann nur aus gültig gewerteten Rahmen kommen.
    const refBad = Object.keys(refs).filter(k => refs[k] && isFinite(refs[k].d34) && !(gewertet - ohne > 0));
    if (refBad.length) bad.push('Referenz aus ungültigem ΔF3–4: ' + refBad.map(k => '/' + k + '/ ' + Math.round(refs[k].d34)).join(', '));
    check('B3a', 'ΔF3–4 wird nur aus einem gültigen ΔF3–4 gewertet: Gatter live und offline (Grund „F3/F4 unsicher“, Gegenprobe gültig wird gewertet); Take /o/ 130 Hz im Rauschen 35 dB ohne Wertung, Referenz und CSV-Wert aus ungültigen Rahmen (N10)',
      !bad.length,
      (bad.length ? bad.slice(0, 5).join(' | ') + ' || ' : '') + 'Gatter ungültig: live ' + ung.live.gewertet + '/' + ung.live.stabil + ', offline ' + ung.off.gewertet + '/' + ung.off.stabil + ' gewertet; gültig: live ' + gue.live.gewertet + ', offline ' + gue.off.gewertet +
      ' | Take: Prüfrahmen ' + pruef + ', gewertet ' + gewertet + ' (ohne gültiges ΔF3–4 ' + ohne + '), ΔF3–4 stabil n ' + sm.d34stable.n + ', CSV ' + sp('d34_stable_med') + ', Referenzen ' + (Object.keys(refs).map(k => '/' + k + '/ ' + Math.round(refs[k].d34)).join(', ') || 'keine'));
  } catch (e) { check('B3a', 'Ablauf ΔF3–4-Wertung nur aus gültigem ΔF3–4 läuft durch', false, kurzFehler(e)); }

  /* ---------- B3b · Zusammenfassung: ΔF3–4, ΔF4–5 und F3 stabil nur aus gültigen Rahmen ---------- */
  try {
    const bad = [];
    /* a) Gebaute Serie: 60 stimmhafte, stabile Rahmen; die geraden gültig (ΔF3–4 850, ΔF4–5 800, F3 2450), die
       ungeraden ohne Gültigkeit von F3/F4 und ohne D34VALID/D45VALID mit falschen Werten (2100, 250, 1900). */
    const n = 60, s = A.makeSeries(n);
    for (let i = 0; i < n; i++) {
      const gut = i % 2 === 0;
      s.t[i] = 0.01 * i; s.f0[i] = 110; s.rms[i] = -20; s.ap[i] = 0.1; s.gate[i] = 2; s.cls[i] = 0; s.score[i] = NaN;
      s.f1[i] = 650; s.f2[i] = 1100; s.f4[i] = 3300; s.f5[i] = 4100; s.f3[i] = gut ? 2450 : 1900;
      s.valid[i] = gut ? 31 : (1 | 2 | 16);
      s.flags[i] = F.VOICED | (gut ? F.D34VALID | F.D45VALID : 0);
      s.d34[i] = gut ? 850 : 2100; s.d45[i] = gut ? 800 : 250;
    }
    const sum = A.summarise(s, { hopS: 0.01, durationS: 0.6, floorDb: -80, floorSource: 'calibration', floorKnown: true });
    const sp = csvSpalte({ id: 'k', code: 'K', label: 'k', createdAt: '2026-10-07T10:00:00Z', summary: sum }), spDe = csvSpalte({ id: 'k', code: 'K', label: 'k', createdAt: '2026-10-07T10:00:00Z', summary: sum }, 'excelde');
    for (const [name, st, med, spalte, csv] of [['ΔF3–4', sum.d34, 850, 'd34_med', '850.0'], ['ΔF4–5', sum.d45, 800, 'd45_med', '800.0'], ['F3 stabil', sum.f3stable, 2450, 'f3_stable_med', '2450.0']]) {
      if (!(st && st.n === 30 && st.med === med && st.q1 === med && st.q3 === med)) bad.push('Serie ' + name + ': n ' + (st && st.n) + ', Median ' + (st && st.med) + ' statt 30 gültige mit ' + med);
      if (sp(spalte) !== csv || spDe(spalte) !== csv.replace('.', ',')) bad.push('CSV ' + spalte + ' ' + sp(spalte) + ' / ' + spDe(spalte) + ' statt ' + csv);
    }
    /* b) Takes im Raumrauschen, in denen die Gültigkeit entscheidet: /a/ 98 Hz mit schwachem F4 (B4 400) bei 35 dB und
       /a/ 131 Hz mit schwachem F3 (B3 380) bei 33 dB. n ist jeweils genau die Zahl der gültigen Rahmen. */
    const belege = [];
    let ungueltig34 = 0, ungueltig45 = 0, ungueltigF3 = 0;
    for (const [nm, f0, Fm, B, snr] of [['/a/ 98 Hz, schwaches F4', 98, [650, 1080, 2400, 3250, 4100], [80, 90, 120, 400, 200], 35], ['/a/ 131 Hz, schwaches F3', 131, [680, 1150, 2550, 3350, 4200], [80, 90, 380, 150, 200], 33]]) {
      const res = await A.analyseTake(imRauschen(D.synthVowel(f0, Fm, B, 1.2, SR, { gain: 0.3 }), snr, 19, 0.3), SR, {}), se = res.series, sm = res.summary;
      let g34 = 0, g45 = 0, gf3 = 0, u34 = 0, u45 = 0, uf3 = 0;
      for (let i = 0; i < se.t.length; i++) {
        if (!(se.flags[i] & F.VOICED)) continue;
        if (se.flags[i] & F.D34VALID) g34++; else if (isFinite(se.d34[i])) u34++;
        if (se.flags[i] & F.D45VALID) g45++; else if (isFinite(se.d45[i])) u45++;
        if (se.gate[i] === 2) { if (se.valid[i] & 4) gf3++; else if (isFinite(se.f3[i])) uf3++; }
      }
      ungueltig34 += u34; ungueltig45 += u45; ungueltigF3 += uf3;
      const c = csvSpalte(takeAus(res));
      for (const [name, st, g, spalte] of [['ΔF3–4', sm.d34, g34, 'd34_med'], ['ΔF4–5', sm.d45, g45, 'd45_med'], ['F3 stabil', sm.f3stable, gf3, 'f3_stable_med']]) {
        if (st.n !== g) bad.push(nm + ': ' + name + ' n ' + st.n + ' statt ' + g + ' gültige Rahmen (Median ' + Math.round(st.med) + ')');
        if (!csvWie(c(spalte), st)) bad.push(nm + ': CSV ' + spalte + ' ' + c(spalte) + ' bei n ' + st.n);
      }
      belege.push(nm + ': gültig ' + g34 + '/' + g45 + '/' + gf3 + ', ungültig endlich ' + u34 + '/' + u45 + '/' + uf3 + ', CSV ' + c('d34_med') + ' / ' + c('d45_med') + ' / ' + c('f3_stable_med'));
    }
    // Ohne ungültige, aber endliche Werte entschiede die Gültigkeit hier nichts.
    if (!(ungueltig34 >= 50 && ungueltig45 >= 10 && ungueltigF3 >= 50)) bad.push('Vorbedingung: ungültig endlich ΔF3–4 ' + ungueltig34 + ', ΔF4–5 ' + ungueltig45 + ', F3 stabil ' + ungueltigF3);
    check('B3b', 'Zusammenfassung zählt für ΔF3–4, ΔF4–5 und F3 stabil nur gültige Rahmen (gebaute Serie: je 30 von 60 mit dem gültigen Wert, beide CSV-Dialekte; Takes mit schwachem F3 bzw. F4 im Rauschen: n = Zahl der gültigen Rahmen, ohne sie −99) (N11)',
      !bad.length, (bad.length ? bad.slice(0, 5).join(' | ') + ' || ' : '') + 'Serie: ' + [sum.d34, sum.d45, sum.f3stable].map(x => x.med + ' n ' + x.n).join(', ') + ' | ' + belege.join(' | '));
  } catch (e) { check('B3b', 'Ablauf Gültigkeitsfilter der Zusammenfassung läuft durch', false, kurzFehler(e)); }

  /* ---------- B3c · H1−H2 bei F1 nahe 2·F0 heißt filtergetrieben ---------- */
  const U120 = [310, 800, 2300, 3200, 4200], BU = [60, 80, 120, 150, 200];
  let u120 = null, g120 = null;
  try {
    const bad = [];
    /* /u/ auf 120 Hz (mitten in der Baritonlage): F1 310 Hz liegt 70 Hz neben H2, gut eine Bandbreite. Der Filter hebt H2
       dort um rund 5 dB an; ein Quellwert ist H1−H2 dann nicht. Gegenstück: dieselbe Quelle mit F1 650 Hz. */
    u120 = await A.analyseTake(imRauschen(D.synthVowel(120, U120, BU, 1.2, SR, { gain: 0.3 }), 40, 11, 0.3), SR, {});
    g120 = await A.analyseTake(imRauschen(D.synthVowel(120, [650].concat(U120.slice(1)), BU, 1.2, SR, { gain: 0.3 }), 40, 11, 0.3), SR, {});
    const zaehl = se => { let st = 0, un = 0, f0u = 0; for (let i = 0; i < se.t.length; i++) if (se.flags[i] & F.VOICED) { st++; if (se.flags[i] & F.H1H2UNSURE) un++; if (se.flags[i] & F.F0UNSURE) f0u++; } return { st, un, f0u }; };
    const zu = zaehl(u120.series), zg = zaehl(g120.series), cu = csvSpalte(takeAus(u120)), cg = csvSpalte(takeAus(g120));
    if (!(zu.st >= 100 && u120.summary.h1h2.unsureShare >= 0.9)) bad.push('/u/ F1 310: filtergetrieben nur ' + zu.un + ' von ' + zu.st + ' stimmhaften Rahmen');
    if (cu('h1h2_med_db') !== '-99.00') bad.push('/u/ F1 310: CSV h1h2_med_db ' + cu('h1h2_med_db') + ' statt -99.00 (Filterwert als Quellwert)');
    // Der Rahmen in der Mitte: filtergetrieben, der Grundton selbst aber sicher (sonst wäre es ein anderer Grund).
    const sm = D.resample(D.synthVowel(120, U120, BU, 0.6, SR, { gain: 0.3 }), SR, TSR), mitte = D.analyseAt(sm, TSR, Math.round(0.3 * TSR), {});
    if (!(mitte.voiced && mitte.h1h2unsure && !mitte.f0Unsure)) bad.push('Rahmen Mitte: h1h2unsure ' + mitte.h1h2unsure + ', f0Unsure ' + mitte.f0Unsure);
    if (!(zg.st >= 100 && zg.un === 0 && /^-?\d+\.\d\d$/.test(cg('h1h2_med_db')) && cg('h1h2_med_db') !== '-99.00')) bad.push('Gegenstück F1 650: filtergetrieben ' + zg.un + '/' + zg.st + ', CSV ' + cg('h1h2_med_db'));
    // Hover: „(filtergetrieben)“ genau in den Rahmen mit der Marke.
    let mitM = 0, ohneM = 0;
    for (const se of [u120.series, g120.series]) for (let i = 0; i < se.t.length; i++) {
      if (!(se.flags[i] & F.VOICED)) continue;
      const h = CHR.hoverText(se, i, 130), m = !!(se.flags[i] & F.H1H2UNSURE);
      if (/H1−H2 [^·<]*\(filtergetrieben\)/.test(h) !== m) { if (bad.length < 6) bad.push('Hover Rahmen ' + i + (m ? ' mit' : ' ohne') + ' Marke: „' + (h.match(/H1−H2[^·]*/) || [''])[0].replace(/<[^>]+>/g, '') + '“'); }
      if (m) mitM++; else ohneM++;
    }
    if (!(mitM >= 100 && ohneM >= 100)) bad.push('Hover: Rahmen mit Marke ' + mitM + ', ohne ' + ohneM);
    check('B3c', 'H1−H2 bei F1 nahe 2·F0 (/u/ 120 Hz, F1 310, Rauschen 40 dB): Rahmen filtergetrieben bei sicherem Grundton, Zusammenfassung und CSV ohne H1−H2-Wert (−99), Hover „(filtergetrieben)“; Gegenstück F1 650 Hz ohne Marke mit Wert (N12)',
      !bad.length, (bad.length ? bad.slice(0, 5).join(' | ') + ' || ' : '') + '/u/ F1 310: ' + zu.un + '/' + zu.st + ' filtergetrieben, Anteil ' + u120.summary.h1h2.unsureShare.toFixed(3) + ', CSV ' + cu('h1h2_med_db') +
      ' | F1 650: ' + zg.un + '/' + zg.st + ', CSV ' + cg('h1h2_med_db') + ' | Hover mit Marke ' + mitM + ', ohne ' + ohneM);
  } catch (e) { check('B3c', 'Ablauf H1−H2 filtergetrieben läuft durch', false, kurzFehler(e)); }

  /* ---------- B3d · Live in Rost, Chronik-Spur nur gültig ---------- */
  try {
    const bad = [], zaehl = { d34g: 0, d34u: 0, d45g: 0, d45u: 0, filter: 0, sauber: 0 };
    const p = await liveSeite(), DD = p.sb.VAREDSP, echt = DD.analyseAt;
    let letzt = null;
    DD.analyseAt = function () { letzt = echt.apply(this, arguments); return letzt; };
    // Kacheln d34, d45, h1h2 gegen den Rahmen, den app.js gerade gemessen hat.
    const pruefe = (name, fr) => {
      if (!fr || !fr.voiced || fr.tonalButAperiodic) return;
      const d34 = p.kachel('d34'), d45 = p.kachel('d45'), h12 = p.kachel('h1h2'), u = k => /\bunsure\b/.test(k.klasse);
      if (u(d34) !== !fr.d34valid) bad.push(name + ': ΔF3–4 ' + (fr.d34valid ? 'gültig' : 'ungültig') + ', Kachel „' + d34.text + '“ (' + d34.klasse + ')');
      if (u(d45) !== !fr.d45valid) bad.push(name + ': ΔF4–5 ' + (fr.d45valid ? 'gültig' : 'ungültig') + ', Kachel „' + d45.text + '“ (' + d45.klasse + ')');
      if (u(h12) !== !!(fr.h1h2unsure || fr.f0Unsure) || /\(filtergetrieben\)/.test(h12.text) !== !!fr.h1h2unsure) bad.push(name + ': H1−H2 ' + (fr.h1h2unsure ? 'filtergetrieben' : 'sauber') + ', Kachel „' + h12.text + '“ (' + h12.klasse + ')');
      zaehl[fr.d34valid ? 'd34g' : 'd34u']++; zaehl[fr.d45valid ? 'd45g' : 'd45u']++;
      if (fr.h1h2unsure && !fr.f0Unsure) zaehl.filter++; else if (!fr.h1h2unsure && !fr.f0Unsure) zaehl.sauber++;
    };
    /* a) Mikrofon: sauberes /a/ 196 Hz, /e/ 147 Hz im Raumrauschen 35 dB (ΔF3–4 bei 30–50 dB fast nie gültig) und
       /u/ 120 Hz mit F1 310 (H1−H2 filtergetrieben), dazwischen Stille. Je Takt 41 ms Audio weiter. */
    const teile = [noise(Math.round(0.3 * SR), 2e-4, 31), D.synthVowel(196, [700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200], 1.0, SR, { gain: 0.3 }), noise(Math.round(0.3 * SR), 2e-4, 32),
      imRauschen(D.synthVowel(147, [450, 1900, 2500, 3450, 4300], [70, 90, 120, 150, 200], 1.0, SR, { gain: 0.3 }), 35, 33, 0), noise(Math.round(0.3 * SR), 2e-4, 34),
      imRauschen(D.synthVowel(120, U120, BU, 1.0, SR, { gain: 0.3 }), 40, 35, 0), noise(Math.round(0.3 * SR), 2e-4, 36)];
    let ns = 0; teile.forEach(t => { ns += t.length; });
    const sig = new Float32Array(ns); let o = 0; teile.forEach(t => { sig.set(t, o); o += t.length; });
    p.quelle.sig = sig;
    let takte = 0;
    for (p.quelle.pos = Math.round(0.2 * SR); p.quelle.pos <= sig.length; p.quelle.pos += p.schritt) { letzt = null; p.takt(); takte++; pruefe('t ' + (p.quelle.pos / SR).toFixed(2) + ' s', letzt); }
    const echtZaehl = Object.assign({}, zaehl);
    // b) Gezielte Abwandlungen eines sauberen Rahmens: je genau eine Marke, unabhängig davon, was der Kern gerade liefert.
    p.quelle.sig = Float32Array.from(D.synthVowel(196, [700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200], 0.4, SR, { gain: 0.3 })); p.quelle.pos = p.quelle.sig.length;
    const sauberDs = DD.resample(p.quelle.sig, SR, TSR);
    const basis = JSON.parse(JSON.stringify(echt(sauberDs, TSR, sauberDs.length - 1, { align: 'end', floorDb: -70 })), (k, v) => (v === null ? NaN : v));
    if (!(basis.voiced && basis.d34valid && basis.d45valid && !basis.h1h2unsure && !basis.f0Unsure)) bad.push('Grundrahmen nicht sauber');
    for (const [name, ab] of [['sauber', {}], ['nur ΔF3–4 ungültig', { d34valid: false }], ['nur ΔF4–5 ungültig', { d45valid: false }], ['nur H1−H2 filtergetrieben', { h1h2unsure: true }]]) {
      const fr = Object.assign({}, basis, ab);
      DD.analyseAt = () => fr; p.takt(); pruefe(name, fr);
    }
    DD.analyseAt = echt;
    p.schliessen();
    /* c) Chronik-Spur ΔF3–4 (dritte Spur, y 270–370): graue 2×2-Punkte genau für Rahmen mit gültigem, endlichem ΔF3–4.
       Serie aus demselben Mikrofonsignal wie a), gültige und ungültige Werte gemischt. */
    const se = (await A.analyseTake(sig, SR, {})).series;
    let gueltig = 0, ungueltig = 0;
    for (let i = 0; i < se.t.length; i++) if (isFinite(se.d34[i])) { if (se.flags[i] & F.D34VALID) gueltig++; else ungueltig++; }
    const l = leinwand(); CHR.drawLanes(l.cv, se, {}, null);
    const grau = l.ops.filter(op => op[0] === 'fillRect' && op[2] === CHR.COL.muted && op[1][2] === 2 && op[1][3] === 2 && op[1][1] >= 269 && op[1][1] <= 371).length;
    if (grau !== gueltig || !(gueltig >= 10 && ungueltig >= 10)) bad.push('Spur ΔF3–4: ' + grau + ' Punkte bei ' + gueltig + ' gültigen und ' + ungueltig + ' ungültigen endlichen Werten');
    const genug = echtZaehl.d34g >= 5 && echtZaehl.d34u >= 5 && echtZaehl.d45g >= 5 && echtZaehl.d45u >= 5 && echtZaehl.filter >= 5 && echtZaehl.sauber >= 5;
    if (!genug) bad.push('Mikrofon deckt nicht alle Fälle ab: ' + JSON.stringify(echtZaehl));
    check('B3d', 'Live: ΔF3–4- und ΔF4–5-Kachel genau dann in Rost, wenn der Wert ungültig ist; H1−H2-Kachel filtergetrieben in Rost mit „(filtergetrieben)“ (Mikrofon mit sauberem /a/, /e/ im Rauschen 35 dB, /u/ 120 Hz, dazu je eine gezielte Marke); Chronik-Spur ΔF3–4 zeichnet nur gültige Werte (N12, N13)',
      !bad.length, (bad.length ? bad.slice(0, 5).join(' | ') + ' || ' : '') + 'Takte ' + takte + ', stimmhaft geprüft ' + JSON.stringify(echtZaehl) + ' | Spur: ' + grau + ' Punkte, gültig ' + gueltig + ', ungültig ' + ungueltig);
  } catch (e) { check('B3d', 'Ablauf Live-Rost und Chronik-Spur läuft durch', false, kurzFehler(e)); }

  /* ---------- B3e · Band „Oktave offen“ bei Periodenverdopplung ---------- */
  try {
    /* Amplitudenwechsel 14 % (Testprofil 8–14 %): die Reihe bei F0/2 liegt zwischen −25 und −20 dB, also knapp unter der
       Oktavschwelle. Die Lesart F0 ist dann eine Entscheidung, keine Messung: „Oktave offen“. Gegenprobe 3 %: die
       Subharmonische liegt weit darunter, keine Marke, keine Teilung. Vier Vokale, 130–247 Hz, je 11 Rahmen. */
    const VOK4 = [[[700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200]], [[300, 2200, 2900, 3500, 4300], [60, 100, 130, 160, 200]],
      [[320, 800, 2400, 3300, 4200], [60, 90, 120, 150, 200]], [[450, 800, 2500, 3300, 4200], [70, 90, 120, 150, 200]]];
    const satz = alt => {
      const z = { n: 0, offen: 0, geteilt: 0, f0falsch: 0 };
      for (const [Fm, B] of VOK4) for (const f0 of [130, 165, 196, 247]) {
        const ds = D.resample(D.synthVowel(f0, Fm, B, 0.5, SR, { altRatio: alt, gain: 0.3 }), SR, TSR);
        for (let c = 1500; c <= 4500; c += 300) {
          const r = D.analyseAt(ds, TSR, c, { orders: [14] });
          if (!r.voiced) continue;
          z.n++; if (r.octaveAmbiguous) z.offen++; if (r.octaveCorrected) z.geteilt++;
          if (!(Math.abs(r.f0 / f0 - 1) < 0.03 || Math.abs(2 * r.f0 / f0 - 1) < 0.03)) z.f0falsch++;
        }
      }
      return z;
    };
    const s14 = satz(0.86), s03 = satz(0.97);
    check('B3e', 'Periodenverdopplung, Amplitudenwechsel 14 % (Subharmonische zwischen −25 und −20 dB), /a/ /i/ /u/ /o/ 130–247 Hz: mindestens 2/3 der Rahmen „Oktave offen“; Gegenprobe 3 %: keine Marke, keine Teilung (N22)',
      s14.n >= 150 && s14.offen >= Math.ceil(2 / 3 * s14.n) && s03.n >= 150 && s03.offen === 0 && s03.geteilt === 0,
      '14 %: ' + s14.offen + '/' + s14.n + ' offen, ' + s14.geteilt + ' geteilt, Grundton weder F0 noch F0/2 ' + s14.f0falsch + ' | 3 %: ' + s03.offen + '/' + s03.n + ' offen, ' + s03.geteilt + ' geteilt, falsch ' + s03.f0falsch);
  } catch (e) { check('B3e', 'Ablauf Oktave offen läuft durch', false, kurzFehler(e)); }

  /* ---------- B3f · Zweideutig-Anteil in freien und angepinnten Referenzen ---------- */
  try {
    const bad = [], CA = csb.VAREANALYSIS;
    const mk = (id, d34, amb) => {
      const b = { d34Med: d34, startS: 1, lenS: 1, n: 100 }; if (amb !== undefined) b.ambiguousShare = amb;
      return { id, code: id, createdAt: '2026-10-01T10:00:00Z', summary: { perVowel: { a: { bestSegment: b } } } };
    };
    const tabelle = refs => { const el = new E('refs'); CHR.renderRefs(el, refs, {}, {}); return el.innerHTML; };
    // Frei (aus dem Bestsegment) und angepinnt (aus dem Bestsegment des eigenen Takes aufgefrischt).
    const frei = CA.computeRefs([mk('X', 700, 0.3)], {}), pin = CA.computeRefs([mk('X', 700, 0.3)], { a: { d34: 700, takeId: 'X', code: 'X', pinned: true } });
    const nodeFrei = A.computeRefs([mk('X', 700, 0.3)], {});
    if (!(frei.a && frei.a.ambiguousShare === 0.3 && !frei.a.pinned)) bad.push('frei: ' + JSON.stringify(frei.a));
    if (!(nodeFrei.a && nodeFrei.a.ambiguousShare === 0.3)) bad.push('frei (Node): ' + JSON.stringify(nodeFrei.a));
    if (!(pin.a && pin.a.ambiguousShare === 0.3 && pin.a.pinned && !pin.a.verwaist)) bad.push('angepinnt: ' + JSON.stringify(pin.a));
    const tf = tabelle(frei), tp = tabelle(pin);
    for (const [nm, t] of [['frei', tf], ['angepinnt', tp]]) if (!/700 <span class="rust[^"]*">zweideutig 30 %<\/span>/.test(t)) bad.push('Tabelle ' + nm + ': ' + t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120));
    // Ohne Anteil (ältere Zusammenfassung) und bei 0 % kein erfundenes „zweideutig“.
    const alt = CA.computeRefs([mk('Y', 650)], {}), null0 = CA.computeRefs([mk('Z', 640, 0)], {});
    if (!alt.a || 'ambiguousShare' in alt.a || /zweideutig/.test(tabelle(alt))) bad.push('ohne Anteil: ' + JSON.stringify(alt.a));
    if (!null0.a || null0.a.ambiguousShare !== 0 || /zweideutig/.test(tabelle(null0))) bad.push('0 %: ' + JSON.stringify(null0.a));
    check('B3f', 'Referenzen tragen den Zweideutig-Anteil ihres Bestsegments: frei und angepinnt 30 % → Tabelle „zweideutig 30 %“ in Rost; ohne Anteil oder bei 0 % nichts (N23)',
      !bad.length, bad.length ? bad.join(' | ') : 'frei ' + frei.a.ambiguousShare + ', angepinnt ' + pin.a.ambiguousShare + ' | ' + tf.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100));
  } catch (e) { check('B3f', 'Ablauf Zweideutig-Anteil der Referenzen läuft durch', false, kurzFehler(e)); }

  const neueFehler = fehlerListe.slice(fehlerVorher);
  check('B3z', 'Keine Ausnahme in der Seite während der B3-Abläufe', !neueFehler.length, neueFehler.slice(0, 3).join(' || '));
}
module.exports.hilfen = { idbNeu, seiteNeu, recorderNeu, E };
module.exports.b2 = kriterienB2;
module.exports.b3 = kriterienB3;

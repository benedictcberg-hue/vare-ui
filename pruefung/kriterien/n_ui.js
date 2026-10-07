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
    fetch: () => Promise.reject(new Error('kein Netz')), TextDecoder, indexedDB: browser.fabrik(seite)
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
    const wavBytes = 44 + 2 * SIG.length;
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
      !leerlauf && beimSingen && inAnalyse && inDerAnalyse && vor.pending === 1 && vor.audio === 1 && vor.takes === 0 && angeboten && naechste === '2' && sicherungOhne && wavDl === 44 + 2 * SIG.length && fortgesetzt && verworfen && umgestellt,
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
};

/* Kriterien B2 — Anzeige, CSV und Doku sagen dasselbe wie die Messung.
   B2a: Das Take-Ergebnis zeigt schwach belegte Formanten und ein zweideutiges Bestsegment wie das Detail (N8).
   B2b: Die Neu-Analyse nennt jede geänderte Rechenweise und sperrt währenddessen den Take-Knopf (N20).
   B2c: Kein Take-Code, den pandas oder Excel als fehlend, Zahl oder Wahrheitswert lesen (N18). */
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

  const neueFehler = fehlerListe.slice(fehlerVorher);
  check('B2z', 'Keine Ausnahme in der Seite während der B2-Abläufe', !neueFehler.length, neueFehler.slice(0, 3).join(' || '));
}
module.exports.hilfen = { idbNeu, seiteNeu, recorderNeu, E };
module.exports.b2 = kriterienB2;

/* Kriterien B1 — Kein Take geht verloren, nichts wird still überschrieben.
   app.js läuft hier mit dem ECHTEN storage.js in einer vm-Umgebung. IndexedDB ist nachgebildet (idbNeu): Läden,
   Transaktionen mit Abbruch (alles oder nichts), Versionswechsel, Speicherquote und gezielt scheiternde
   Schreibvorgänge; die Daten überstehen das Neuladen der Seite. Eine „geschlossene“ Seite rechnet nicht weiter
   (ihre Zeitgeber und Datenbankrückrufe laufen ins Leere), so wie ein Tab, der neu geladen wird.
   B1a: Take und Rahmenverlauf in einer Transaktion (Take, Neu-Analyse).
   B1b: Bearbeiten im Detail überschreibt keine laufende oder abgeschlossene Neu-Analyse. */
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
// Ein Browserprofil: Datenbanken bleiben über Seiten hinweg. ctl.quote in Byte, ctl.putFehler(laden, wert) → Fehler oder null.
function idbNeu() {
  const dbs = new Map(), ctl = { quote: Infinity, putFehler: null };
  function nutzung(stage) {
    let n = 0;
    for (const d of dbs.values()) for (const [name, st] of d.stores) { const m = (stage && stage.d === d && stage.m.has(name)) ? stage.m.get(name) : st.data; for (const v of m.values()) n += groesse(v); }
    return n;
  }
  function fabrik(seite) {
    const spaeter = f => setImmediate(() => { if (!seite.tot) f(); });
    const rufe = (h, ev) => { if (typeof h !== 'function') return true; try { h(ev); return true; } catch (e) { aufFehler(e); return false; } };
    function transaktion(d, namen, modus) {
      namen = Array.isArray(namen) ? namen : [namen];
      for (const n of namen) if (!d.stores.has(n)) throw domFehler('NotFoundError', 'Laden ' + n + ' fehlt');
      const m = new Map(); for (const n of namen) m.set(n, new Map(d.stores.get(n).data));
      const stage = { d, m }, t = { mode: modus, error: null, oncomplete: null, onerror: null, onabort: null };
      let offen = 0, fertig = false;
      const abbruch = e => { if (fertig) return; fertig = true; if (!t.error) t.error = e; spaeter(() => rufe(t.onabort, { type: 'abort', target: t })); };
      const pruefeEnde = () => spaeter(() => { if (!fertig && offen === 0) { fertig = true; for (const [n, daten] of m) d.stores.get(n).data = daten; rufe(t.oncomplete, { type: 'complete', target: t }); } });
      function anfrage(op) {
        if (fertig) throw domFehler('TransactionInactiveError');
        const req = { result: undefined, error: null, onsuccess: null, onerror: null, transaction: t };
        offen++;
        spaeter(() => {
          if (fertig) return;
          try { req.result = op(); } catch (e) { req.error = e; }
          offen--;
          if (req.error) {
            // Wie IndexedDB: Fehlerereignis an der Anfrage, dann an der Transaktion (t.error ist da noch leer), dann Abbruch.
            let verhindert = false;
            const ev = { type: 'error', target: req, preventDefault() { verhindert = true; }, stopPropagation() { } };
            rufe(req.onerror, ev); rufe(t.onerror, ev);
            if (verhindert) pruefeEnde(); else abbruch(req.error);
            return;
          }
          if (!rufe(req.onsuccess, { type: 'success', target: req })) { abbruch(domFehler('AbortError', 'Ausnahme im Rückruf')); return; }
          pruefeEnde();
        });
        return req;
      }
      const schreibend = () => { if (modus !== 'readwrite') throw domFehler('ReadOnlyError'); };
      t.objectStore = name => {
        if (!m.has(name)) throw domFehler('NotFoundError', 'Laden ' + name + ' nicht in der Transaktion');
        const daten = m.get(name), kp = d.stores.get(name).keyPath;
        return {
          put(v) {
            schreibend(); const k = v[kp], kopie = klon(v);
            return anfrage(() => {
              const f = ctl.putFehler && ctl.putFehler(name, v); if (f) throw f;
              const alt = daten.get(k); daten.set(k, kopie);
              if (nutzung(stage) > ctl.quote) { if (alt === undefined) daten.delete(k); else daten.set(k, alt); throw domFehler('QuotaExceededError', ''); }
              return k;
            });
          },
          get: k => anfrage(() => klon(daten.get(k))),
          getKey: k => anfrage(() => (daten.has(k) ? k : undefined)),
          getAll: () => anfrage(() => [...daten.keys()].sort(vergleich).map(k => klon(daten.get(k)))),
          getAllKeys: () => anfrage(() => [...daten.keys()].sort(vergleich)),
          delete(k) { schreibend(); return anfrage(() => { daten.delete(k); }); },
          clear() { schreibend(); return anfrage(() => { daten.clear(); }); },
          createIndex() { }
        };
      };
      t.abort = () => abbruch(domFehler('AbortError', 'abgebrochen'));
      pruefeEnde();
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
  set innerHTML(v) { this._html = v; this._q = {}; }
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
    schliessen() { seite.tot = true; intervalle.forEach(h => clearInterval(h)); }
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

  const neueFehler = fehlerListe.slice(fehlerVorher);
  check('B1z', 'Keine Ausnahme in der Seite während der B1-Abläufe', !neueFehler.length, neueFehler.slice(0, 3).join(' || '));
};
module.exports.hilfen = { idbNeu, seiteNeu, recorderNeu, E };

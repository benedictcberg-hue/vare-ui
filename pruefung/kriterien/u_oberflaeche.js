/* Kriterien U — Oberfläche (app.js) ohne Browser.
   app.js läuft hier unverändert in einer vm-Umgebung. DOM, IndexedDB, Mikrofon, Token-Ablage
   (localStorage, sessionStorage) und der Abruf von korpus.json sind knapp nachgebildet; Rechenkern,
   Analyse, CSV, Chronik, Kalibrierung und korpus.js sind die echten Dateien. So lassen sich Abläufe
   prüfen, die nur in der Verdrahtung stecken: Neuladen, Löschen, Eingaben während der Analyse, eine
   Uhr, die weiterläuft, Gerätewechsel, An- und Abmelden. Geprüft wird, was gespeichert und angezeigt
   wird. Dieselben Abläufe spielt pruefung/browser-test.js im echten Chromium.
   U1: Schritt 0 (Position, Pause, Einsing-Angaben), Angaben beim Stopp. U2: Kalibrierung und Kette,
   „Alles löschen“ und Code-Zähler, Token. U3: Sicherung mit NaN und Infinity, Rost nur für Unsicheres
   (Befund in Gold), Beschriftung der Sprünge, Historie, Referenzen nur aus gleich gerechneten Takes und
   verwaiste Referenzen. Für reine Anzeige läuft chronik.js zusätzlich allein in einer vm-Umgebung
   (chronikNeu); leinwand() schreibt Zeichenaufrufe mit, kacheln() und listenZellen() lesen das HTML. */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path'), nodeCrypto = require('crypto'), v8 = require('v8');
// Blob aus dem buffer-Modul: global erst ab Node 18, so läuft es auch mit älterem Node unter Windows.
const { Blob } = require('buffer');
const ROOT = path.join(__dirname, '..', '..');
const QUELLE = {};
function quelle(f) { return QUELLE[f] || (QUELLE[f] = fs.readFileSync(path.join(ROOT, f), 'utf8')); }

/* ---------- Nachbildung der Browser-Umgebung ---------- */
// Anfangszustand aus index.html übernehmen: was dort hidden oder disabled beginnt, tut es hier auch.
function htmlVorgaben() {
  const html = quelle('index.html'), v = {}, re = /<([a-z]+)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const id = /\bid="([^"]+)"/.exec(m[2]);
    if (id) v[id[1]] = { hidden: /\shidden(?=[\s=]|$)/.test(m[2]), disabled: /\sdisabled(?=[\s=]|$)/.test(m[2]) };
  }
  return v;
}
// Zeichenfläche, die alles schluckt: Zeichnen wird hier nicht geprüft.
const LEER = new Proxy(function () { }, { get: (t, p) => (p === 'width' ? 0 : LEER), set: () => true, apply: () => LEER });
class El {
  constructor(id) {
    this.id = id || ''; this.textContent = ''; this.innerHTML = ''; this.value = ''; this.hidden = false; this.disabled = false;
    this.checked = false; this.className = ''; this.style = {}; this.files = []; this.clientWidth = 600; this.firstChild = null; this._on = {};
  }
  addEventListener(t, f) { (this._on[t] = this._on[t] || []).push(f); }
  removeEventListener() { }
  feuern(t) { (this._on[t] || []).forEach(f => f({ target: this, key: '', preventDefault() { } })); }
  click() { this.feuern('click'); }
  setAttribute(k, v) { this['@' + k] = String(v); }
  getAttribute(k) { return this['@' + k] == null ? null : this['@' + k]; }
  // Je Selektor dasselbe Element und die angehängten Kinder: so erreicht ein Kriterium die Regler,
  // die renderSettings in einen Rahmen schreibt (U3: Referenzen nach einer Regleränderung).
  querySelector(sel) { const q = this._q || (this._q = {}); return q[sel] || (q[sel] = new El()); }
  querySelectorAll() { return []; }
  appendChild(c) { (this.kinder || (this.kinder = [])).push(c); return c; }
  insertBefore(c) { return c; }
  remove() { }
  focus() { }
  getContext() { return LEER; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 600, height: 100 }; }
}
// Uhr der Seite: läuft mit der echten Zeit, lässt sich aber vorstellen (Pause, nächster Tag).
function uhrNeu(startMs) {
  let versatz = startMs - Date.now();
  class UDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(Date.now() + versatz); }
    static now() { return Date.now() + versatz; }
  }
  return { Date: UDate, jetzt: () => Date.now() + versatz, vor: ms => { versatz += ms; } };
}
// IndexedDB-Ersatz mit derselben Schnittstelle wie storage.js. Kopien wie beim echten Speichern;
// bleibt über „Neuladen“ hinweg bestehen. langsam = Verzögerung beim Lesen aller Takes (ms).
function speicherNeu() {
  const d = { takes: new Map(), series: new Map(), audio: new Map(), cal: new Map(), meta: new Map(), pending: new Map() };
  // Wie IndexedDB: eine echte Kopie, NaN und typisierte Felder bleiben erhalten.
  const kopie = v => (v == null ? v : v8.deserialize(v8.serialize(v)));
  const P = v => Promise.resolve(v);
  const api = {
    langsam: 0,
    open: () => P(),
    putTake: t => { d.takes.set(t.id, kopie(t)); return P(); },
    getTake: id => P(kopie(d.takes.get(id))),
    allTakes: () => {
      const a = [...d.takes.values()].map(kopie).sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''));
      return api.langsam ? new Promise(r => setTimeout(() => r(a), api.langsam)) : P(a);
    },
    deleteTake: id => { d.takes.delete(id); d.series.delete(id); d.audio.delete(id); return P(); },
    putSeries: (id, s) => { d.series.set(id, s); return P(); },
    // Seit B1 schreibt storage.js Take und Verlauf (und was dazugehört) in einer Transaktion und ändert Takes
    // durch Lesen-Ändern-Schreiben; Aufnahmen liegen vor der Analyse in pending. Die Nachbildung folgt der Schnittstelle.
    putTakeSeries: (t, s, x) => {
      d.takes.set(t.id, kopie(t)); if (s) d.series.set(t.id, s);
      if (x && x.audio) d.audio.set(t.id, { takeId: t.id, sampleRate: x.audio.sampleRate, format: x.audio.format, blob: x.audio.blob, bytes: x.audio.blob.size });
      else if (x && x.audioLoeschen) d.audio.delete(t.id);
      if (x && x.offenErledigt) d.pending.delete(t.id);
      return P();
    },
    updateTake: (id, fn) => api.updateTakeSeries(id, fn, null),
    updateTakeSeries: (id, fn, s) => {
      if (!d.takes.has(id)) return P(null);
      let n; try { n = fn(kopie(d.takes.get(id))); } catch (e) { return Promise.reject(e); }
      d.takes.set(id, kopie(n)); if (s) d.series.set(id, s);
      return P(kopie(n));
    },
    putPending: (rec, a) => { d.pending.set(rec.id, kopie(rec)); d.audio.set(rec.id, { takeId: rec.id, sampleRate: a.sampleRate, format: a.format, blob: a.blob, bytes: a.blob.size }); return P(); },
    allPending: () => P([...d.pending.values()].map(kopie)),
    deletePending: id => { d.pending.delete(id); d.audio.delete(id); return P(); },
    getSeries: id => P(d.series.get(id) || null),
    putAudio: (id, sr, f, blob) => { d.audio.set(id, { takeId: id, sampleRate: sr, format: f, blob, bytes: blob.size }); return P(); },
    getAudio: id => P(d.audio.get(id)),
    deleteAudio: id => { d.audio.delete(id); return P(); },
    hasAudio: id => P(d.audio.has(id)),
    audioIds: () => P([...d.audio.keys()]),
    putCalibration: c => { d.cal.set(c.id, kopie(c)); return P(); },
    allCalibrations: () => P([...d.cal.values()].map(kopie)),
    deleteCalibration: id => { d.cal.delete(id); return P(); },
    getMeta: (k, fb) => P(d.meta.has(k) ? kopie(d.meta.get(k)) : fb),
    setMeta: (k, v) => { d.meta.set(k, kopie(v)); return P(); },
    // Wie storage.js: alles leeren, dann die mitgegebenen Meta-Einträge zurückschreiben.
    clearAll: behalten => { Object.values(d).forEach(m => m.clear()); for (const k in (behalten || {})) if (behalten[k] !== undefined) d.meta.set(k, kopie(behalten[k])); return P(); },
    estimate: () => P(null), persist: () => P(false), persisted: () => P(false)
  };
  // Token-Ablage des Browsers: localStorage und sessionStorage überstehen beide ein Neuladen im selben Tab.
  return { d, api, web: { local: new Map(), session: new Map() } };
}
function webSpeicher(m) { return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } }; }
// GitHub-API-Ersatz für korpus.js: nur das Prüftoken bekommt einen (erfundenen) Korpus.
const TOKEN = 'github_pat_PRUEFPRUEFPRUEFPRUEF';
const KORPUS = JSON.stringify({ format: 'vare-korpus', version: 1, stand: '2026-01-01', notiz: 'Prüfkorpus', marken: { d34: [{ hz: 404 }, { hz: 707 }] }, gatter: { f3MinHz: 2500, spreadMaxHz: 130 } });
function korpusAbruf(url, o) {
  const ok = !!(o && o.headers && o.headers.Authorization === 'Bearer ' + TOKEN);
  return Promise.resolve({ ok, status: ok ? 200 : 401, json: () => Promise.resolve(ok ? { content: Buffer.from(KORPUS, 'utf8').toString('base64'), encoding: 'base64' } : { message: 'Bad credentials' }) });
}
// Mikrofon-Ersatz: jeder Take liefert dasselbe Signal. Geräte-ID wählt den Gerätenamen.
// ueber: Angaben, die der nächste Start abweichend meldet (dasselbe Gerät, andere Rate oder Bearbeitung).
function recorderNeu(signal, sr) {
  const ueber = {};
  return {
    ueber,
    createRecorder() {
      const r = {
        active: false, info: null, sampleRate: sr, samplesSeen: 0, recordedSeconds: 0,
        start(devId) {
          r.active = true;
          r.info = Object.assign({ deviceLabel: devId ? 'Zweitgerät' : 'Testmikrofon', deviceId: devId || 'standard', sampleRate: sr, trackSampleRate: sr, capture: 'worklet', echoCancellation: false, noiseSuppression: false, autoGainControl: false }, ueber);
          return Promise.resolve(r.info);
        },
        stop() { r.active = false; return Promise.resolve(); },
        beginTake() { }, endTake() { return { samples: signal, sampleRate: sr, durationS: signal.length / sr }; },
        latest() { return new Float32Array(0); }
      };
      return r;
    },
    listDevices: () => Promise.resolve([])
  };
}
const fehler = [];
function aufFehler(e) { fehler.push(String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }
// Eine „Seite“ öffnen: frischer Kontext, gemeinsamer Speicher = Neuladen derselben Seite.
async function seiteOeffnen(sp, uhr, signal, sr) {
  const vorgaben = htmlVorgaben(), els = {}, intervalle = [];
  function el(id) {
    if (!els[id]) { const e = new El(id), v = vorgaben[id]; if (v) { e.hidden = v.hidden; e.disabled = v.disabled; } els[id] = e; }
    return els[id];
  }
  const document = { readyState: 'complete', activeElement: null, body: new El('body'), getElementById: el, createElement: () => new El(), querySelector: () => el('main'), querySelectorAll: () => [], addEventListener() { } };
  const sb = {
    document, console: { log() { }, warn() { }, error: aufFehler }, navigator: {},
    location: { hash: '#/aufnahme', protocol: 'http:', origin: 'http://localhost' },
    addEventListener() { }, removeEventListener() { }, requestAnimationFrame: () => 0, cancelAnimationFrame() { },
    performance: { now: () => Date.now() },
    setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: h => clearTimeout(h),
    setInterval: (f, ms) => { const h = setInterval(f, ms); if (h.unref) h.unref(); intervalle.push({ h, f, ms }); return h; },
    clearInterval: h => { clearInterval(h); const i = intervalle.findIndex(x => x.h === h); if (i >= 0) intervalle.splice(i, 1); },
    confirm: () => true, alert() { }, crypto: { randomUUID: () => nodeCrypto.randomUUID() },
    Blob, URL, btoa, atob, Date: uhr.Date, devicePixelRatio: 1,
    localStorage: webSpeicher(sp.web.local), sessionStorage: webSpeicher(sp.web.session), fetch: korpusAbruf, TextDecoder
  };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb);
  for (const f of ['dsp.js', 'vowel.js', 'analysis.js', 'csv.js', 'wav.js', 'calibration.js', 'korpus.js', 'chronik.js']) vm.runInContext(quelle(f), sb, { filename: f });
  sb.VARESTORE = sp.api; sb.VARERECORDER = recorderNeu(signal, sr);
  vm.runInContext(quelle('app.js'), sb, { filename: 'app.js' });
  const st = () => sb.VAREAPP.state;
  const p = {
    sb, el, st, uhr,
    async warte(bed, ms) {
      const t0 = Date.now();
      for (;;) {
        let ok = false; try { ok = bed(); } catch (e) { ok = false; }
        if (ok) return true;
        if (Date.now() - t0 > (ms || 5000)) return false;
        await new Promise(r => setTimeout(r, 2));
      }
    },
    ruhe: ms => new Promise(r => setTimeout(r, ms)),
    klick(id) { try { el(id).click(); } catch (e) { aufFehler(e); } },
    aendern(id, wert) { el(id).value = wert; try { el(id).feuern('change'); } catch (e) { aufFehler(e); } },
    // Kalibrierung setzen, ohne die 8 s Ablauf: die Kalibrierung selbst prüft der Browser-Lauf.
    // Die Kette ist die des nachgebildeten Standardmikrofons (recorderNeu ohne Geräte-ID).
    kalibriert(id) {
      const s = st();
      s.cal = { id, floorDb: -72, levelDb: -20, snrDb: 52, createdAt: new uhr.Date().toISOString(), deviceLabel: 'Testmikrofon', deviceId: 'standard', sampleRate: sr, trackSampleRate: sr,
        captureFlags: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, F: [700, 1200, 2500] };
      s.calSession = true;
    },
    async mikrofon() { p.klick('btn-mic'); return p.warte(() => st().rec && st().rec.active && !el('btn-mic').disabled); },
    // Mikrofon aus und wieder an (mit dem Gerät, das gerade im Menü steht).
    async mikrofonNeu() { p.klick('btn-mic'); await p.warte(() => !st().rec.active); return p.mikrofon(); },
    // Ein Take: Start, Singdauer auf der Uhr, Stopp, dann was „während der Analyse“ geschieht.
    async take(waehrend, dauerMs) {
      if (!(await p.warte(() => !el('btn-take').disabled, 3000))) throw new Error('Take-Knopf blieb gesperrt: ' + el('take-hint').textContent);
      const vorher = new Set(sp.d.takes.keys());
      p.klick('btn-take');
      uhr.vor(dauerMs || 2000);
      p.klick('btn-take');
      if (waehrend) await waehrend();
      if (!(await p.warte(() => !st().busy && sp.d.takes.size > vorher.size, 60000))) throw new Error('Take nicht gespeichert');
      return [...sp.d.takes.values()].find(t => !vorher.has(t.id));
    },
    // Die halbminütliche Auffrischung der Schritt-0-Anzeige von Hand auslösen.
    intervall(ms) { intervalle.filter(x => x.ms === ms).forEach(x => { try { x.f(); } catch (e) { aufFehler(e); } }); },
    schliessen() { intervalle.slice().forEach(x => clearInterval(x.h)); }
  };
  if (!(await p.warte(() => st().settings, 5000))) throw new Error('Einstellungen nicht geladen');
  // Geprüft wird die Verdrahtung, nicht der Rechenkern: gröberer Rahmenabstand spart Laufzeit.
  st().settings.hopS = 0.05;
  return p;
}

/* ---------- Chronik ohne Seite: chronik.js mit Rechenkern in eigener vm-Umgebung ---------- */
function chronikNeu() {
  const sb = { console: { log() { }, warn() { }, error: aufFehler }, devicePixelRatio: 1 };
  sb.self = sb; sb.window = sb;
  vm.createContext(sb);
  for (const f of ['dsp.js', 'vowel.js', 'analysis.js', 'csv.js', 'chronik.js']) vm.runInContext(quelle(f), sb, { filename: f });
  return sb;
}
// Zeichenfläche, die jeden Aufruf mitschreibt: [Name, Argumente].
function leinwand() {
  const ops = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { ops.push([k, a]); }), set: (t, k, v) => { t[k] = v; return true; } });
  return { cv: { clientWidth: 450, style: {}, getContext: () => ctx }, ops };
}
// Kacheln der Detailansicht: [{ klasse, k, v }], v ohne HTML-Marken außer in vHtml.
function kacheln(html) {
  const out = [], re = /<div class="stat([^"]*)"><span class="k">([\s\S]*?)<\/span><span class="v">([\s\S]*?)<\/span><\/div>/g;
  let m;
  while ((m = re.exec(html))) out.push({ klasse: m[1].trim(), k: m[2].replace(/<[^>]+>/g, ''), v: m[3].replace(/<[^>]+>/g, ''), vHtml: m[3] });
  return out;
}
// Zellen der Take-Liste, erste Datenzeile.
function listenZellen(html) {
  const zeile = /<tr data-id="[^"]*">([\s\S]*?)<\/tr>/.exec(html);
  return zeile ? zeile[1].split(/<\/td>/).map(z => z.replace(/^<td[^>]*>/, '')) : [];
}
// Gleich mit NaN = NaN und ±Infinity, rekursiv; liefert die erste Abweichung als Pfad oder ''.
function abweichung(a, b, pfad) {
  pfad = pfad || '';
  if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b) || (a === 0 && b === 0) ? '' : pfad + ': ' + a + ' → ' + b;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? '' : pfad + ': ' + JSON.stringify(a) + ' → ' + JSON.stringify(b);
  const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined);
  if (ka.length !== kb.length) return pfad + ': Schlüssel ' + ka.join(',') + ' → ' + kb.join(',');
  for (const k of ka) { const d = abweichung(a[k], b[k], pfad + '.' + k); if (d) return d; }
  return '';
}
function nichtEndlich(o, pfad, out) {
  out = out || []; pfad = pfad || '';
  if (typeof o === 'number') { if (!isFinite(o)) out.push(pfad); }
  else if (o && typeof o === 'object') for (const k of Object.keys(o)) nichtEndlich(o[k], pfad + '.' + k, out);
  return out;
}

module.exports = async function (H) {
  const { D, C, SR, concat, noise, BW5 } = H;
  // test_dsp.js füllt die ID auf 5 Zeichen auf; bei „U1.10“ fehlte sonst der Abstand zum Namen.
  const check = (id, name, ok, detail) => H.check(id, (id.length >= 5 ? ' ' : '') + name, ok, detail);
  process.on('unhandledRejection', aufFehler);
  // Kurzer Take: /a/ bei G3 zwischen zwei Stücken Raumrauschen, 1,2 s.
  const SIG = concat([noise(Math.round(0.1 * SR), 2e-4, 7), D.synthVowel(196, [700, 1200, 2500, 3300, 4200], BW5, 1.0, SR, { gain: 0.3 }), noise(Math.round(0.1 * SR), 2e-4, 8)]);
  const kurz = t => t ? t.code + ' pos=' + (t.sitzung && t.sitzung.position) + ' pause=' + (t.sitzung && t.sitzung.pauseVorherS != null ? t.sitzung.pauseVorherS.toFixed(1) : t.sitzung && t.sitzung.pauseVorherS) + ' gleich=' + (t.sitzung && t.sitzung.pauseSelbeSitzung) : '–';
  const T0 = Date.parse('2026-03-02T09:00:00Z');

  /* ---------- U1 · Schritt 0: Position, Pause, Neuladen, Löschen ---------- */
  try {
    const sp = speicherNeu(), uhr = uhrNeu(T0);
    let p = await seiteOeffnen(sp, uhr, SIG, SR);
    p.kalibriert('cal-1'); await p.mikrofon();
    const A = await p.take();
    const anzNachA = p.el('ctx-position').textContent;
    check('U1.1', 'Schritt 0: „nächster Take ist Nummer“ stimmt sofort nach dem Take, nicht erst nach 30 s', anzNachA === '2', 'Anzeige ' + anzNachA + ' nach ' + kurz(A));
    uhr.vor(20000);
    const B = await p.take();
    p.schliessen();
    // Neuladen 30 s später; die Chronik braucht diesmal 150 ms zum Lesen.
    uhr.vor(30000); sp.api.langsam = 150;
    p = await seiteOeffnen(sp, uhr, SIG, SR);
    p.kalibriert('cal-2'); await p.mikrofon();
    const gesperrt = p.el('btn-take').disabled, hinweis = p.el('take-hint').textContent;
    await p.ruhe(400);
    const frei = !p.el('btn-take').disabled;
    check('U1.2', 'Nach dem Neuladen: kein Take, bevor die Chronik gelesen ist; danach frei', gesperrt && frei, 'vor dem Lesen gesperrt=' + gesperrt + ' („' + hinweis + '“), danach frei=' + frei);
    sp.api.langsam = 0;
    const anz = { pos: p.el('ctx-position').textContent, pause: p.el('ctx-pause').textContent };
    const C = await p.take();
    check('U1.3', 'Nach dem Neuladen: nächste Position, Pause > 0, selbe Sitzung', C.sitzung.position === 3 && C.sitzung.pauseVorherS > 0 && C.sitzung.pauseSelbeSitzung === true && C.sitzung.id === A.sitzung.id && anz.pos === '3' && !/erster Take/.test(anz.pause),
      'Anzeige vor dem Take: Nummer ' + anz.pos + ', Pause ' + anz.pause + ' | ' + [A, B, C].map(kurz).join(' | '));
    // Löschen eines Takes aus der Mitte: die nächste Nummer darf keine vorhandene wiederholen.
    uhr.vor(10000);
    p.sb.VAREAPP.handlers.remove(B);
    await p.warte(() => p.st().takes.length === 2 && !sp.d.takes.has(B.id));
    const anzNachLoeschen = p.el('ctx-position').textContent;
    const Dt = await p.take();
    const pos = [...sp.d.takes.values()].filter(t => t.sitzung && t.sitzung.id === A.sitzung.id).map(t => t.sitzung.position).sort((x, y) => x - y);
    check('U1.4', 'Nach dem Löschen eines Takes: Zähler läuft weiter, keine Position doppelt', Dt.sitzung.position === 4 && new Set(pos).size === pos.length && anzNachLoeschen === '4',
      'Anzeige nach dem Löschen ' + anzNachLoeschen + ', neuer Take ' + kurz(Dt) + ', Positionen ' + pos.join(','));
    // Den höchsten löschen und neu laden: die Nummer bleibt vergeben.
    p.sb.VAREAPP.handlers.remove(Dt);
    await p.warte(() => !sp.d.takes.has(Dt.id));
    p.schliessen(); uhr.vor(5000);
    p = await seiteOeffnen(sp, uhr, SIG, SR);
    p.kalibriert('cal-3'); await p.mikrofon();
    const E = await p.take();
    check('U1.5', 'Gelöschte Nummer wird auch nach dem Neuladen nicht neu vergeben', E.sitzung.position === 5, kurz(E));
    // D wurde 5 s vor E gesungen und dann gelöscht; ab C gerechnet wären es rund 17 s.
    check('U1.6', 'Pause nach Löschen des letzten Takes zählt ab dessen Ende, nicht ab dem Take davor', E.sitzung.pauseVorherS >= 4.9 && E.sitzung.pauseVorherS < 10 && E.sitzung.pauseSelbeSitzung === true, kurz(E));
    p.schliessen();
  } catch (e) { check('U1.1', 'Ablauf Schritt 0 (Neuladen, Löschen) läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }

  /* ---------- U1 · Was während der Analyse geschieht, gehört zum nächsten Take ---------- */
  try {
    const sp = speicherNeu(), uhr = uhrNeu(T0 + 86400e3);
    const p = await seiteOeffnen(sp, uhr, SIG, SR);
    // Hier muss die Analyse lange genug laufen, um in sie hinein zu tippen: Vorgabe-Rahmenabstand.
    p.st().settings.hopS = 0.010;
    p.kalibriert('cal-A'); await p.mikrofon();
    p.el('take-label').value = 'A-Take'; p.el('take-intent').value = 'a'; p.el('take-comment').value = 'A-Kommentar';
    let busy = null;
    const A = await p.take(() => {
      busy = p.st().busy;
      p.el('take-label').value = 'B-Take'; p.el('take-intent').value = 'i'; p.el('take-comment').value = 'B-Kommentar';
    });
    const felder = [p.el('take-label').value, p.el('take-intent').value, p.el('take-comment').value].join('|');
    check('U1.7', 'Eingabe während der Analyse: der gespeicherte Take behält seine Angaben, die neuen bleiben für den nächsten',
      busy === true && A.label === 'A-Take' && A.vowelIntent === 'a' && A.comment === 'A-Kommentar' && felder === 'B-Take|i|B-Kommentar',
      'Analyse lief=' + busy + ' | gespeichert ' + JSON.stringify({ label: A.label, vowelIntent: A.vowelIntent, comment: A.comment }) + ' | Felder danach ' + felder);
    // „Neue Sitzung beginnen“ während der Analyse: verwirft die Kalibrierung für künftige Takes,
    // nicht für den, der mit ihr aufgenommen wurde.
    const sid = p.st().sitzung.id, nr = p.st().sitzung.nr;
    busy = null;
    const B = await p.take(() => { busy = p.st().busy; p.klick('btn-neue-sitzung'); });
    await p.ruhe(20);
    const fs0 = B.analysis && B.analysis.floorSource;
    check('U1.8', '„Neue Sitzung“ während der Analyse: Take behält Kalibrierung und Sitzung seiner Aufnahme',
      busy === true && B.calibrationId === 'cal-A' && fs0 === 'calibration' && B.sitzung.id === sid && B.sitzung.nr === nr && p.st().sitzung.id !== sid && p.el('ctx-position').textContent === '1',
      'Analyse lief=' + busy + ' | calibrationId=' + B.calibrationId + ' floorSource=' + fs0 + ' | Sitzung des Takes ' + B.sitzung.nr + ', jetzt ' + p.st().sitzung.nr + ', nächste Nummer ' + p.el('ctx-position').textContent);
    // Gerätewechsel und Audio-Einstellung während der Analyse.
    // Neue Sitzung verlangt neue Kalibrierung; Mikrofon aus und an, damit der Take-Knopf sie sieht.
    p.kalibriert('cal-B');
    p.klick('btn-mic'); await p.warte(() => !p.st().rec.active); await p.mikrofon();
    busy = null;
    const C = await p.take(async () => {
      busy = p.st().busy;
      p.st().settings.storeAudio = false; p.st().settings.audioFormat = 'f32';
      p.klick('btn-mic'); await p.warte(() => !p.st().rec.active);
      p.el('mic-device').value = 'zweit';
      p.klick('btn-mic'); await p.warte(() => p.st().rec.active && p.st().rec.info.deviceLabel === 'Zweitgerät');
      busy = busy && p.st().busy;
    });
    const audio = sp.d.audio.get(C.id);
    check('U1.9', 'Gerätewechsel und Audio-Einstellung während der Analyse: Take behält Gerät und Audioablage seiner Aufnahme',
      busy === true && C.deviceLabel === 'Testmikrofon' && C.deviceId === 'standard' && C.hasAudio === true && !!audio && audio.format === 'i16',
      'Analyse lief während des Wechsels=' + busy + ' | Gerät ' + C.deviceLabel + ' (' + C.deviceId + ') | hasAudio=' + C.hasAudio + ' Audio ' + (audio ? audio.format : 'fehlt'));
    p.schliessen();
  } catch (e) { check('U1.7', 'Ablauf Eingaben während der Analyse läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }

  /* ---------- U1 · Einsing-Minuten laufen mit und wandern nicht in einen anderen Tag ---------- */
  const ein = t => t ? t.code + ' ' + (t.sitzung.warmup || '–') + ' ' + (t.sitzung.warmupMin == null ? 'null' : t.sitzung.warmupMin) + ' min' : '–';
  const hinweisSichtbar = p => !p.el('ctx-hinweis').hidden && /neue Sitzung/.test(p.el('ctx-hinweis').textContent);
  try {
    const sp = speicherNeu(), uhr = uhrNeu(T0 + 2 * 86400e3);
    const p = await seiteOeffnen(sp, uhr, SIG, SR);
    p.kalibriert('cal-W'); await p.mikrofon();
    p.aendern('ctx-warmup', 'voll'); p.aendern('ctx-warmup-min', '15');
    uhr.vor(30 * 60e3); p.intervall(30000);
    const feld30 = p.el('ctx-warmup-min').value;
    const W1 = await p.take();
    check('U1.10', 'Einsing-Minuten laufen mit: 15 min eingetragen, 30 min später zeigen Feld und Take 45 min',
      W1.sitzung.warmup === 'voll' && W1.sitzung.warmupMin >= 44.9 && W1.sitzung.warmupMin <= 46 && feld30 === '45', 'Feld nach 30 min: ' + feld30 + ' | ' + ein(W1));
    // Weitersingen mit 2,5 h Abstand: die Angaben bleiben, gemessen ab dem letzten Take, nicht ab der Eingabe.
    uhr.vor(150 * 60e3);
    const W2 = await p.take();
    uhr.vor(150 * 60e3); p.intervall(30000);
    const nochDa = p.el('ctx-hinweis').hidden && p.el('ctx-warmup').value === 'voll';
    const W3 = await p.take();
    check('U1.11', 'Takes im Abstand von 2,5 h: Einsing-Angaben bleiben, die Minuten zählen weiter',
      nochDa && W2.sitzung.warmup === 'voll' && Math.abs(W2.sitzung.warmupMin - 195) < 1 && W3.sitzung.warmup === 'voll' && Math.abs(W3.sitzung.warmupMin - 345) < 1,
      [W1, W2, W3].map(ein).join(' | ') + ' | vor W3 noch eingetragen=' + nochDa);
    // Über drei Stunden weder Take noch Eingabe: leeren und sagen, warum.
    uhr.vor(3 * 3600e3 + 60e3); p.intervall(30000);
    const s = p.st().sitzung, gesp = sp.d.meta.get('sitzung');
    const geleert = s.warmup === '' && s.warmupMin == null && p.el('ctx-warmup').value === '' && p.el('ctx-warmup-min').value === '' && gesp.warmup === '' && gesp.warmupMin == null;
    const text = p.el('ctx-hinweis').textContent, sichtbar = hinweisSichtbar(p);
    const W4 = await p.take();
    check('U1.12', 'Über 3 h ohne Take und ohne Eingabe: Einsing-Angaben geleert, Hinweis auf neue Sitzung, Take trägt keine alten Angaben',
      geleert && sichtbar && W4.sitzung.warmup === '' && W4.sitzung.warmupMin == null,
      'geleert=' + geleert + ' | Hinweis sichtbar=' + sichtbar + ' „' + text + '“ | ' + ein(W4));
    p.schliessen();
  } catch (e) { check('U1.10', 'Ablauf Einsing-Minuten läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }
  try {
    // Am nächsten Tag geöffnet: dieselbe Sitzung im Speicher, Angaben vom Vortag.
    const sp = speicherNeu(), uhr = uhrNeu(T0 + 3 * 86400e3);
    let p = await seiteOeffnen(sp, uhr, SIG, SR);
    p.kalibriert('cal-T'); await p.mikrofon();
    p.aendern('ctx-warmup', 'voll'); p.aendern('ctx-warmup-min', '15');
    const V = await p.take();
    p.schliessen(); uhr.vor(20 * 3600e3);
    p = await seiteOeffnen(sp, uhr, SIG, SR);
    await p.ruhe(30);
    const anz = p.el('ctx-warmup').value + '|' + p.el('ctx-warmup-min').value, gesp = sp.d.meta.get('sitzung');
    check('U1.13', 'Am nächsten Tag geöffnet: Einsing-Angaben vom Vortag sind leer, der Hinweis sagt warum',
      anz === '|' && p.st().sitzung.warmup === '' && gesp.warmup === '' && gesp.warmupMin == null && hinweisSichtbar(p),
      'Vortag ' + ein(V) + ' | Felder jetzt „' + anz + '“ | Hinweis „' + p.el('ctx-hinweis').textContent + '“');
    p.schliessen();
    // Ältere Daten: Minuten ohne Zeitpunkt der Eingabe, letzter Take vor 10 min.
    const sp2 = speicherNeu(), uhr2 = uhrNeu(T0 + 4 * 86400e3);
    p = await seiteOeffnen(sp2, uhr2, SIG, SR);
    p.kalibriert('cal-L'); await p.mikrofon();
    p.aendern('ctx-warmup', 'voll'); p.aendern('ctx-warmup-min', '15');
    await p.take(); p.schliessen();
    const alt = sp2.d.meta.get('sitzung'); delete alt.warmupMinAt; delete alt.warmupAngabeAt;
    uhr2.vor(10 * 60e3);
    p = await seiteOeffnen(sp2, uhr2, SIG, SR);
    p.kalibriert('cal-L2'); await p.mikrofon();
    const felder = p.el('ctx-warmup').value + '|' + p.el('ctx-warmup-min').value, hw = p.el('ctx-hinweis');
    const L = await p.take();
    check('U1.14', 'Minuten ohne Zeitpunkt (ältere Daten): nicht fortgeschrieben, geleert und benannt; Einsing-Status bleibt',
      felder === 'voll|' && !hw.hidden && /ohne Zeitpunkt/.test(hw.textContent) && L.sitzung.warmup === 'voll' && L.sitzung.warmupMin == null,
      'Felder „' + felder + '“ | Hinweis „' + hw.textContent + '“ | ' + ein(L));
    p.schliessen();
  } catch (e) { check('U1.13', 'Ablauf Einsing-Angaben über Neuladen läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }

  /* ---------- U2 · „Alles löschen“: Kalibrierung ist mitgelöscht ---------- */
  const statusText = p => (p.st().statusEl ? p.st().statusEl.textContent : '');
  try {
    const sp = speicherNeu(), uhr = uhrNeu(T0 + 5 * 86400e3);
    const p = await seiteOeffnen(sp, uhr, SIG, SR);
    p.kalibriert('cal-L1'); await p.mikrofon();
    await p.take();
    p.klick('btn-clear-all');
    await p.warte(() => sp.d.takes.size === 0 && /gelöscht/.test(statusText(p)));
    await p.ruhe(20);
    const gesperrt = p.el('btn-take').disabled, hint = p.el('take-hint').textContent;
    // Ein Klick darf keinen Take starten (takeToggle prüft den Knopf).
    p.klick('btn-take');
    const gestartet = p.st().taking;
    if (gestartet) { p.klick('btn-take'); await p.warte(() => !p.st().busy, 60000); }
    check('U2.1', '„Alles löschen“ löscht die Kalibrierung mit: Take-Knopf gesperrt, ein Klick startet keinen Take',
      gesperrt && !gestartet && p.st().cal === null && /Kalibrierung/.test(hint),
      'gesperrt=' + gesperrt + ' | Klick startete Take=' + gestartet + ' | Hinweis „' + hint + '“');
    p.schliessen();
  } catch (e) { check('U2.1', 'Ablauf „Alles löschen“ läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }

  /* ---------- U2 · „Alles löschen“ behält Code-Zähler, Sitzung und Einstellungen ---------- */
  const codes = sp => [...sp.d.takes.values()].map(t => t.code).sort();
  const sicherung = takes => C.serializeBackup({ takes, series: {}, refs: {}, calibrations: [], settings: null, kernelVersion: D.VERSION, exportedAt: new Date(T0).toISOString(), audio: {} });
  // JSON-Sicherung über das Dateifeld einspielen, wie nach der Dateiauswahl.
  async function importieren(p, json) {
    if (p.st().statusEl) p.st().statusEl.textContent = '';
    p.el('file-import').files = [{ text: () => Promise.resolve(json) }];
    p.el('file-import').feuern('change');
    return p.warte(() => /Import/.test(statusText(p)), 10000);
  }
  async function loeschen(p, sp) { p.klick('btn-clear-all'); return p.warte(() => sp.d.takes.size === 0 && /gelöscht/.test(statusText(p))); }
  try {
    const sp = speicherNeu(), uhr = uhrNeu(T0 + 6 * 86400e3);
    // Ein verstellter Regler, gespeichert wie von saveSettings.
    sp.d.meta.set('settings', { f3MinHz: 2700, __touched: { f3MinHz: true } });
    let p = await seiteOeffnen(sp, uhr, SIG, SR);
    p.kalibriert('cal-K1'); await p.mikrofon();
    const A = await p.take(); uhr.vor(20000);
    const B = await p.take(); uhr.vor(20000);
    const json = sicherung([A, B]), sitzungVor = p.st().sitzung.id;
    await loeschen(p, sp);
    p.schliessen(); uhr.vor(5000);
    p = await seiteOeffnen(sp, uhr, SIG, SR);
    await p.ruhe(20);
    const nach = { f3MinHz: p.st().settings.f3MinHz, selbeSitzung: p.st().sitzung.id === sitzungVor, nr: p.st().sitzung.nr, naechsteNummer: p.el('ctx-position').textContent };
    check('U2.2', '„Alles löschen“, dann Neuladen: Sitzung und verstellte Einstellung bleiben, die Stelle in der Sitzung zählt weiter',
      nach.f3MinHz === 2700 && nach.selbeSitzung && nach.naechsteNummer === '3', JSON.stringify(nach));
    p.kalibriert('cal-K2'); await p.mikrofon();
    const N = await p.take();
    await importieren(p, json);
    const cs = codes(sp), meldungEigene = statusText(p);
    check('U2.3', '„Alles löschen“, neuer Take, Sicherung eingespielt: Codes laufen weiter, keiner doppelt',
      N.code === 'C' && cs.join(',') === 'A,B,C', 'neuer Take ' + N.code + ' | Codes nach dem Import ' + cs.join(','));
    // Sicherung aus einem anderen Browser: andere IDs, ein Code überschneidet sich. Nicht umbenennen, aber sagen.
    const fremd = sicherung([Object.assign({}, A, { id: 'fremd-1', code: 'B' }), Object.assign({}, A, { id: 'fremd-2', code: 'Q' }), Object.assign({}, A, { id: 'fremd-3', code: 'constructor' })]);
    await importieren(p, fremd);
    const meldungFremd = statusText(p), warn = /warn/.test(p.st().statusEl.className), cs2 = codes(sp);
    check('U2.6', 'Import mit Codes, die es schon gibt: Codes bleiben, die Doppelung steht als Warnung da; eigene Sicherung ohne Warnung',
      !/Achtung/.test(meldungEigene) && /Achtung: 1 übernommener Take trägt einen Code/.test(meldungFremd) && /\(B\)/.test(meldungFremd) && warn && cs2.filter(c => c === 'B').length === 2,
      'eigene Sicherung „' + meldungEigene + '“ | fremde „' + meldungFremd + '“ warn=' + warn + ' | Codes ' + cs2.join(','));
    p.schliessen();
    // Nur importierte Takes im Browser: der behaltene Zähler muss auch ihre Codes kennen.
    const sp2 = speicherNeu(), uhr2 = uhrNeu(T0 + 7 * 86400e3);
    p = await seiteOeffnen(sp2, uhr2, SIG, SR);
    await importieren(p, json);
    const importiert = codes(sp2).join(',');
    await loeschen(p, sp2);
    p.kalibriert('cal-K3'); await p.mikrofon();
    const M = await p.take();
    check('U2.4', 'Sicherung eingespielt, dann „Alles löschen“: der neue Take bekommt keinen Code der Sicherung',
      importiert === 'A,B' && M.code === 'C', 'importiert ' + importiert + ' | neuer Take ' + M.code);
    // „Alles löschen“ mitten in der Analyse: abweisen, sonst landet der Take nach dem Löschen.
    p.st().settings.hopS = 0.010;
    const vorher = sp2.d.takes.size;
    p.klick('btn-take'); uhr2.vor(2000); p.klick('btn-take');
    const busy = p.st().busy;
    p.klick('btn-clear-all');
    const txt = statusText(p);
    await p.warte(() => !p.st().busy, 60000); await p.ruhe(20);
    check('U2.5', '„Alles löschen“ während der Analyse wird abgewiesen: nichts gelöscht, der Take danach gespeichert',
      busy === true && sp2.d.takes.size === vorher + 1 && /abwarten/.test(txt), 'Analyse lief=' + busy + ' | Takes vorher ' + vorher + ', danach ' + sp2.d.takes.size + ' | Meldung „' + txt + '“');
    p.schliessen();
  } catch (e) { check('U2.2', 'Ablauf „Alles löschen“ mit Zähler läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }

  /* ---------- U2 · Eine Kalibrierung gilt nur für ihre Kette ---------- */
  try {
    const sp = speicherNeu(), uhr = uhrNeu(T0 + 8 * 86400e3);
    const p = await seiteOeffnen(sp, uhr, SIG, SR);
    p.kalibriert('cal-G1'); await p.mikrofon();
    // Dasselbe Gerät neu gestartet: nichts zu verwerfen.
    await p.mikrofonNeu();
    const gleich = { cal: p.st().cal && p.st().cal.id, gesperrt: p.el('btn-take').disabled };
    check('U2.7', 'Mikrofon mit demselben Gerät neu gestartet: Kalibrierung bleibt, Take frei', gleich.cal === 'cal-G1' && gleich.gesperrt === false, JSON.stringify(gleich));
    // Anderes Gerät gewählt.
    p.klick('btn-mic'); await p.warte(() => !p.st().rec.active);
    p.el('mic-device').value = 'zweit'; await p.mikrofon();
    const w = { cal: p.st().cal, calSession: p.st().calSession, gesperrt: p.el('btn-take').disabled, warnungen: p.el('cal-warnings').innerHTML, meldung: statusText(p), hint: p.el('take-hint').textContent };
    check('U2.8', 'Anderes Gerät: Kalibrierung verworfen, Take gesperrt, beide Geräte benannt',
      w.cal === null && w.calSession === false && w.gesperrt && /Testmikrofon/.test(w.warnungen) && /Zweitgerät/.test(w.warnungen) && /neu kalibrieren/.test(w.meldung) && /Kalibrierung/.test(w.hint),
      'cal=' + (w.cal && w.cal.id) + ' gesperrt=' + w.gesperrt + ' | „' + w.warnungen + '“ | „' + w.meldung + '“');
    // Ohne Kalibrierpflicht darf der Take laufen — aber nicht mit dem Boden des anderen Geräts.
    p.st().settings.requireCal = false; await p.mikrofonNeu();
    const T = await p.take();
    check('U2.9', 'Ohne Kalibrierpflicht nach dem Gerätewechsel: Take trägt weder calibrationId noch Boden des alten Geräts',
      T.deviceLabel === 'Zweitgerät' && T.calibrationId === null && T.analysis.floorSource !== 'calibration',
      'Gerät ' + T.deviceLabel + ' | calibrationId=' + T.calibrationId + ' | floorSource=' + T.analysis.floorSource);
    // Dasselbe Gerät, aber andere Geräte-Abtastrate und automatische Verstärkung an.
    p.st().settings.requireCal = true;
    p.el('mic-device').value = ''; await p.mikrofonNeu();
    p.kalibriert('cal-G2'); await p.mikrofonNeu();
    const vorAenderung = p.st().cal && p.st().cal.id;
    Object.assign(p.sb.VARERECORDER.ueber, { trackSampleRate: 16000, autoGainControl: true });
    await p.mikrofonNeu();
    const w2 = p.el('cal-warnings').innerHTML;
    check('U2.10', 'Dasselbe Gerät mit anderer Abtastrate und Bearbeitung: Kalibrierung verworfen, Abweichung benannt',
      vorAenderung === 'cal-G2' && p.st().cal === null && p.el('btn-take').disabled && /16000/.test(w2) && /automatische Verstärkung aus → an/.test(w2),
      'vorher ' + vorAenderung + ' | cal=' + (p.st().cal && p.st().cal.id) + ' | „' + w2 + '“');
    p.schliessen();
  } catch (e) { check('U2.7', 'Ablauf Gerätewechsel läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }

  /* ---------- U2 · Token: „merken“ nur, wenn gemerkt; „Token entfernen“ räumt auf ---------- */
  // merken: true/false setzt den Haken, null lässt ihn, wie er steht.
  async function anmelden(p, merken) {
    p.el('token').value = TOKEN;
    if (merken != null) p.el('token-merken').checked = merken;
    p.klick('btn-verbinden');
    return p.warte(() => !p.el('app').hidden && !p.el('btn-verbinden').disabled);
  }
  try {
    const uhr = uhrNeu(T0 + 9 * 86400e3);
    // Ohne Haken verbunden: das Token gilt nur für diesen Tab.
    const sp = speicherNeu();
    let p = await seiteOeffnen(sp, uhr, SIG, SR);
    const ok1 = await anmelden(p, false);
    const ablage = { lokal: sp.web.local.has('vare-token'), tab: sp.web.session.has('vare-token') };
    p.schliessen();
    p = await seiteOeffnen(sp, uhr, SIG, SR);
    await p.warte(() => !p.el('app').hidden);
    const haken = p.el('token-merken').checked;
    p.klick('btn-abmelden'); await p.warte(() => !p.el('anmeldung').hidden);
    await anmelden(p, null);
    const lokal2 = sp.web.local.has('vare-token');
    check('U2.11', 'Token nur für diesen Tab: nach dem Neuladen ist „merken“ nicht angehakt, erneutes Verbinden legt es nicht dauerhaft ab',
      ok1 && !ablage.lokal && ablage.tab && haken === false && lokal2 === false,
      'verbunden=' + ok1 + ' | zuerst localStorage=' + ablage.lokal + ' sessionStorage=' + ablage.tab + ' | Haken nach Neuladen=' + haken + ' | nach erneutem Verbinden localStorage=' + lokal2);
    p.schliessen();
    // Mit Haken verbunden: gemerkt; „Token entfernen“ nimmt Haken und Korpus-Kopfzeile zurück.
    const sp2 = speicherNeu();
    p = await seiteOeffnen(sp2, uhr, SIG, SR);
    await anmelden(p, true);
    p.schliessen();
    p = await seiteOeffnen(sp2, uhr, SIG, SR);
    await p.warte(() => !p.el('app').hidden);
    const vor = { haken: p.el('token-merken').checked, kopf: p.el('korpus-stand').textContent };
    p.klick('btn-abmelden'); await p.warte(() => !p.el('anmeldung').hidden);
    const nach = { haken: p.el('token-merken').checked, kopf: p.el('korpus-stand').textContent, lokal: sp2.web.local.has('vare-token'), tab: sp2.web.session.has('vare-token') };
    check('U2.12', 'Gemerktes Token: Haken nach dem Neuladen gesetzt; „Token entfernen“ nimmt ihn zurück und leert die Korpus-Kopfzeile',
      vor.haken === true && /Korpus vom/.test(vor.kopf) && nach.haken === false && nach.kopf === '' && !nach.lokal && !nach.tab,
      'vorher ' + JSON.stringify(vor) + ' | nachher ' + JSON.stringify(nach));
    // Mikrofon: während eines Takes nicht abmelden; sonst Mikrofon samt Knopf und Live-Feldern aus.
    await anmelden(p, false);
    p.kalibriert('cal-T1'); await p.mikrofon();
    p.klick('btn-take');
    p.klick('btn-abmelden');
    const waehrend = { app: !p.el('app').hidden, mic: p.st().rec.active, take: p.st().taking, token: sp2.web.session.has('vare-token'), meldung: statusText(p) };
    uhr.vor(2000); p.klick('btn-take');
    await p.warte(() => !p.st().busy && sp2.d.takes.size === 1, 60000);
    p.klick('btn-abmelden');
    await p.warte(() => !p.st().rec.active && p.el('btn-mic').textContent === 'Mikrofon starten');
    const aus = { knopf: p.el('btn-mic').textContent, mic: p.st().rec.active, kalibrieren: p.el('btn-cal').disabled, take: p.el('btn-take').disabled, eingefroren: /frozen/.test(p.el('st-floor').className) };
    await anmelden(p, false);
    const wieder = { knopf: p.el('btn-mic').textContent, mic: p.st().rec.active };
    check('U2.13', '„Token entfernen“: während eines Takes abgewiesen; sonst Mikrofon aus, Knopf, Kalibrieren, Take und Live-Felder folgen, auch nach erneutem Verbinden',
      waehrend.app && waehrend.mic && waehrend.take && waehrend.token && /Take beenden/.test(waehrend.meldung) && sp2.d.takes.size === 1
      && aus.knopf === 'Mikrofon starten' && !aus.mic && aus.kalibrieren && aus.take && aus.eingefroren && wieder.knopf === 'Mikrofon starten' && !wieder.mic,
      'während des Takes ' + JSON.stringify(waehrend) + ' | danach ' + JSON.stringify(aus) + ' | neu verbunden ' + JSON.stringify(wieder));
    p.schliessen();
  } catch (e) { check('U2.11', 'Ablauf Token läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }

  /* ---------- U3 · Sicherung → Import: „nicht gemessen“ bleibt nicht gemessen ---------- */
  try {
    // /i/ bei 300 Hz ohne Stille: F1 gemessen, F2–F5, ΔF3–4, SNR und weitere Werte nie (NaN).
    // Früher /o/ 450/800 Hz bei 310 Hz: Dort verschmelzen F1 und F2 zu einem Gipfel bei 563 Hz, der auch F2
    // sein kann; seit der Zusammenführung sind deshalb alle fünf Slots unsicher, und es gab keinen gemessenen
    // Formanten mehr, an dem sich „gemessen bleibt gezeichnet, nie gemessen nicht bei 0 Hz“ zeigen ließe.
    // Danach /e/ bei 415 Hz: Seit über 375 Hz Grundton kein Slot mehr gültig ist (Teiltonabstand, dsp.js), ist
    // dort auch F1 nicht gemessen. Bei /i/ 300 Hz ist F1 (310 Hz) gültig; F2–F5 hält der Kern unabhängig von
    // der Teiltonregel für verschmolzen (eine Ordnung trennt, was die anderen zusammenfassen).
    const sig = D.synthVowel(300, [300, 2200, 2900, 3500, 4300], [60, 100, 130, 160, 200], 1.5, SR);
    const res = await H.A.analyseTake(sig, SR, { hopS: 0.02 });
    const summary = res.summary;
    summary.pruefUnendlich = { plus: Infinity, minus: -Infinity, liste: [NaN, 1.5, -Infinity] };
    const take = { id: 'u3-nan', code: 'N', label: 'N 300 Hz', createdAt: new Date(T0).toISOString(), durationS: 1.5, sampleRate: SR, analysis: { kernelVersion: D.VERSION, gate: { f3MinHz: 2500 } },
      summary, history: [{ analysis: { kernelVersion: '2.9.0', analysedAt: new Date(T0 - 864e5).toISOString() }, summary: { snrDb: NaN, F: [{ med: NaN, n: 0 }] } }] };
    const series = res.series;
    // Nicht nur, was die Analyse gerade liefert: NaN und ±Infinity auch ausdrücklich setzen.
    series.sfr[0] = Infinity; series.sfr[1] = -Infinity; series.f2[2] = NaN;
    const nanVorher = [];
    for (let i = 0; i < series.f2.length; i++) if (Number.isNaN(series.f2[i])) nanVorher.push(i);
    const text = C.serializeBackup({ takes: [take], series: { [take.id]: series }, refs: { o: { d34: NaN, takeId: 'x', pinned: true } }, calibrations: [{ id: 'c', floorDb: -Infinity, F: [NaN, 700] }], settings: { x: NaN }, kernelVersion: D.VERSION });
    const back = C.parseBackup(text), t2 = back.takes[0], s2 = back.series[take.id];
    const nf = nichtEndlich(summary);
    const diff = abweichung(take, t2) || abweichung({ o: { d34: NaN, takeId: 'x', pinned: true } }, back.refs) || abweichung([{ id: 'c', floorDb: -Infinity, F: [NaN, 700] }], back.calibrations) || abweichung({ x: NaN }, back.settings);
    check('U3.1', 'Sicherung → Import: NaN und ±Infinity kommen in Zusammenfassung, Historie, Referenzen und Kalibrierungen unverändert zurück, nichts als null',
      nf.length >= 30 && diff === '', nf.length + ' nicht endliche Werte, z. B. ' + nf.slice(0, 3).join(' ') + ' | erste Abweichung: ' + (diff || 'keine'));
    const nanNachher = [];
    for (let i = 0; i < s2.f2.length; i++) if (Number.isNaN(s2.f2[i])) nanNachher.push(i);
    check('U3.2', 'Sicherung → Import: in den Serien bleibt NaN NaN und ±Infinity ±Infinity',
      s2.sfr instanceof Float32Array && s2.sfr[0] === Infinity && s2.sfr[1] === -Infinity && nanVorher.length > 0 && nanNachher.join(',') === nanVorher.join(','),
      'sfr[0..1] ' + s2.sfr[0] + ', ' + s2.sfr[1] + ' | NaN in f2: vorher ' + nanVorher.length + ', nachher ' + nanNachher.length);
    /* Die CSV ist der Austausch nach außen: Sentinel −99 für alles Fehlende, vor und nach dem Rundlauf
       gleich. Die Take-CSV ist byte-gleich. In der Rahmen-CSV sitzen die −99 an denselben Stellen; ihre
       Zahlen können in der letzten Stelle abweichen, weil die Sicherung Serien auf 0,001 rundet. */
    const sentinel = (s, d) => C.framesToCsv(s, d, H.V).split('\r\n').map(z => z.split(d === 'standard' ? ',' : ';').map(c => /^-99([.,]0*)?$/.test(c) ? 'S' : '.').join('')).join('|');
    const csvGleich = ['standard', 'excelde'].every(d => C.takesToCsv([take], d) === C.takesToCsv([t2], d) && sentinel(series, d) === sentinel(s2, d));
    const zeile = C.takesToCsv([t2], 'standard').split('\r\n'), kopf = zeile[0].split(','), werte = zeile[1].split(',');
    check('U3.3', 'CSV nach dem Rundlauf: Take-CSV byte-gleich, Rahmen-CSV mit −99 an denselben Stellen (beide Dialekte); nie gemessen = −99',
      csvGleich && werte[kopf.indexOf('f2_med')] === '-99.0' && werte[kopf.indexOf('snr_db')] === '-99.00', 'gleich=' + csvGleich + ' | f2_med ' + werte[kopf.indexOf('f2_med')] + ' snr_db ' + werte[kopf.indexOf('snr_db')]);
    // Eine Sicherung aus der Zeit vor Version 2 trägt nie Gemessenes als null. Lesbar bleiben, und null ist keine 0.
    const alt = JSON.parse(JSON.stringify({ format: 'vare-backup', version: 1, takes: [{ take: Object.assign({}, take, { history: [] }), series: null, audio: null }], refs: null, calibrations: [], settings: null }));
    const altBack = C.parseBackup(JSON.stringify(alt)), altS = altBack.takes[0].summary;
    const sb = chronikNeu(), CHR = sb.VARECHRONIK;
    const punkte = s => { const l = leinwand(); CHR.drawFormantBars(l.cv, s, 28); return l.ops.filter(o => o[0] === 'arc').map(o => o[1][0].toFixed(1)); };
    const div = new El(); CHR.renderDetail(div, altBack.takes[0], null, {}, false, {});
    const snrKachel = kacheln(div.innerHTML).find(k => /SNR/.test(k.k)) || {};
    const pAlt = punkte(altS), pNeu = punkte(t2.summary), pVorher = punkte(summary);
    check('U3.4', 'Ältere Sicherung (Version 1, null statt NaN): lesbar; die Chronik zeichnet keinen nie gemessenen Formanten bei 0 Hz und nennt SNR „nicht messbar“',
      altS.F[1].med === null && pAlt.length === 1 && /nicht messbar/.test(snrKachel.v || ''), 'Punkte (x px) ' + pAlt.join(' ') + ' | SNR-Kachel „' + snrKachel.v + '“');
    check('U3.5', 'Nach Sicherung → Import zeichnet die Chronik dieselben Formantpunkte wie vorher', pNeu.join(' ') === pVorher.join(' ') && pVorher.length === 1, 'vorher ' + pVorher.join(' ') + ' | nachher ' + pNeu.join(' '));
    // Über die Oberfläche: Import landet mit NaN in der Ablage, nicht mit null.
    const sp = speicherNeu(), uhr = uhrNeu(T0 + 10 * 86400e3);
    const p = await seiteOeffnen(sp, uhr, SIG, SR);
    if (p.st().statusEl) p.st().statusEl.textContent = '';
    p.el('file-import').files = [{ text: () => Promise.resolve(text) }];
    p.el('file-import').feuern('change');
    await p.warte(() => /Import/.test(p.st().statusEl ? p.st().statusEl.textContent : ''), 10000);
    const gesp = sp.d.takes.get(take.id), gs = gesp && gesp.summary;
    check('U3.6', 'Import über die Seite: nie gemessene Werte liegen als NaN in der Ablage, nicht als null',
      !!gs && Number.isNaN(gs.F[1].med) && Number.isNaN(gs.snrDb) && gs.pruefUnendlich.minus === -Infinity, gs ? 'F2 ' + gs.F[1].med + ' | SNR ' + gs.snrDb + ' | −Infinity ' + gs.pruefUnendlich.minus : 'nicht gespeichert');
    p.schliessen();
  } catch (e) { check('U3.1', 'Ablauf Sicherung → Import läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }

  /* ---------- U3 · Rost nur für unsichere Messwerte, Befunde in eigener Kennzeichnung ---------- */
  // Ein Take mit sicher gemessenen Befunden: F3 stabil 2400 Hz (gültig in 95 %), SHR max −12 dB,
  // ein gehaltener Tonsprung. Nichts davon ist unsicher.
  function befundTake(f3MinHz, aenderung) {
    const stat = (med, extra) => Object.assign({ med, q1: med - 10, q3: med + 10, n: 400, share: 0.95 }, extra);
    const s = { nFrames: 500, voicedShare: 0.9, validShare: 0.95, stableShare: 0.8, f0: stat(110, { note: 'A2' }),
      F: [600, 1100, 2400, 3200, 4000].map(f => stat(f)), d34: stat(800), d34stable: { med: NaN, q1: NaN, q3: NaN, n: 0 }, d45: stat(800),
      f3stable: stat(2400, { n: 380 }), sfr: stat(-20), shr: stat(-30, { max: -12 }), cpp: stat(30), h1h2: stat(1, { unsureShare: 0 }), h1h2c: stat(1),
      rms: stat(-20, { max: -10 }), floorDb: -80, floorSource: 'calibration', snrDb: 60, tube: stat(17.5, { n: 100 }), tubeCm: 17.5, perVowel: {},
      octaveCorrectedShare: 0, octaveAmbiguousShare: 0, slotUnsureShare: 0,
      spruenge: { gehalten: 1, kante: 2, lambdaGehalten: 0.02, lambdaKante: 0.04, liste: [] } };
    const t = { id: 'b-' + f3MinHz, code: 'B', label: 'Befund', createdAt: new Date(T0).toISOString(), durationS: 5, summary: s,
      analysis: f3MinHz == null ? { kernelVersion: D.VERSION } : { kernelVersion: D.VERSION, gate: { f3MinHz } } };
    if (aenderung) aenderung(t);
    return t;
  }
  try {
    const sb = chronikNeu(), CHR = sb.VARECHRONIK;
    const liste = t => { const div = new El(); CHR.renderList(div, [t], {}, {}); const z = listenZellen(div.innerHTML); return { d34: z[4], f3: z[5], shr: z[7] }; };
    const detail = t => { const div = new El(); CHR.renderDetail(div, t, null, {}, false, {}); return kacheln(div.innerHTML); };
    const z = liste(befundTake(2500));
    check('U3.7', 'Chronik-Liste: F3 unter dem Mindestwert und SHR über −15 dB als Befund (Gold), nicht in Rost; ΔF3–4 „–“ ohne Rost, wenn F3 der Grund ist',
      /class="befund"/.test(z.f3) && !/rust/.test(z.f3) && /class="befund"/.test(z.shr) && !/rust/.test(z.shr) && !/rust/.test(z.d34), 'F3 ' + z.f3 + ' | SHR ' + z.shr + ' | ΔF3–4 ' + z.d34);
    const z2200 = liste(befundTake(2200)), zOhne = liste(befundTake(null));
    check('U3.8', 'F3-Schwelle aus dem Take: mit 2200 Hz gerechnet ist F3 2400 kein Befund; ohne gespeicherte Schwelle keine Markierung, aber benannt',
      /class="befund"/.test(z.f3) && !/befund|rust/.test(z2200.f3) && !/befund|rust/.test(zOhne.f3) && /nicht gespeichert/.test(zOhne.f3), '2500: ' + z.f3 + ' | 2200: ' + z2200.f3 + ' | ohne: ' + zOhne.f3);
    const k = detail(befundTake(2500)), kz = n => k.find(x => n.test(x.k)) || { klasse: '?', v: '?', vHtml: '' };
    const shr = kz(/^SHR/), spr = kz(/gehalten/), d34 = kz(/ΔF3–4 stabil/);
    check('U3.9', 'Detail: SHR, gehaltene Sprünge und „nicht gewertet, weil F3 unter dem Mindestwert“ als Befund, nicht unsicher; die Zahlen stehen da',
      shr.klasse === 'befund' && spr.klasse === 'befund' && d34.klasse === 'befund' && !/rust/.test(d34.vHtml) && /2400/.test(d34.v) && /2500/.test(d34.v),
      [shr, spr, d34].map(x => x.k + ' → class „stat ' + x.klasse + '“ „' + x.v + '“').join(' | '));
    // Gegenprobe: was unsicher ist oder fehlt, bleibt Rost; was unauffällig ist, bleibt ohne Markierung.
    const unsicher = detail(befundTake(2500, t => {
      const s = t.summary; s.F[1].share = 0.3; s.floorSource = 'estimated'; s.f3stable.med = 2600; s.shr.max = -30; s.spruenge.gehalten = 0;
    }));
    const ku = n => unsicher.find(x => n.test(x.k)) || { klasse: '?', vHtml: '' };
    check('U3.10', 'Gegenprobe: F2 nur in 30 % gültig, Boden geschätzt, keine Wertung ohne F3-Grund bleiben Rost; SHR −30 dB und 0 Sprünge unmarkiert',
      ku(/^F2/).klasse === 'unsure' && ku(/Rauschboden/).klasse === 'unsure' && /rust/.test(ku(/ΔF3–4 stabil/).vHtml) && ku(/^SHR/).klasse === '' && ku(/gehalten/).klasse === '',
      ['F2', 'Rauschboden', 'ΔF3–4 stabil', 'SHR', 'gehalten'].map(n => n + ': „' + ku(new RegExp(n)).klasse + '“').join(' | '));
    // Die Kennzeichnung steht in style.css: Gold ohne Strich; Rost mit Strich nur für unsicher. Live verwendet dieselbe Klasse.
    const css = quelle('style.css'), regel = sel => { const m = new RegExp('(^|[},\\s])' + sel.replace(/\./g, '\\.') + '\\s*[,{][^}]*}', 'm').exec(css); return m ? m[0] : ''; };
    const rBef = regel('.befund'), rStat = regel('.stat.befund .v'), rUns = regel('.stat.unsure .v');
    check('U3.11', 'style.css: eigene Klasse befund in Gold ohne Rost und ohne Strich; unsicher bleibt Rost gestrichelt; Live-Anzeige nutzt dieselbe Klasse',
      /var\(--gold\)/.test(rBef) && !/rust|dashed/.test(rBef) && /var\(--gold\)/.test(rStat) && /var\(--rust\)/.test(rUns) && /dashed/.test(rUns) && /' befund'/.test(quelle('app.js')),
      '„' + rBef.replace(/\s+/g, ' ') + '“ | „' + rUns.replace(/\s+/g, ' ') + '“');
    /* Beschriftung: gezählt werden Weite (≥ 5 HT) und Dauer (≥ 90 ms). Ein legato gesungener
       Melodiesprung erfüllt das genauso — „Registerwechsel“ wäre ein Urteil, das die Zählung nicht trägt. */
    const divS = new El(); CHR.renderDetail(divS, befundTake(2500), null, {}, false, {});
    const ks = kacheln(divS.innerHTML), geh = ks.find(x => x.k === 'Tonsprünge ≥ 5 HT, gehalten ≥ 90 ms'), kan = ks.find(x => x.k === 'kurze Kanten unter 90 ms');
    const spalten = C.TAKE_COLUMNS.map(c => c.key);
    check('U3.13', 'Sprünge neutral beschriftet: „Tonsprünge ≥ 5 HT, gehalten ≥ 90 ms“ und „kurze Kanten unter 90 ms“, nirgends „Register“ in der Anzeige; CSV-Spalten unverändert',
      !!geh && /^1 /.test(geh.v) && geh.klasse === 'befund' && !!kan && /^2 /.test(kan.v) && kan.klasse === '' && !/Register/.test(divS.innerHTML) && !/Register/.test(quelle('index.html'))
      && ['jumps_held', 'jumps_edge', 'lambda_held_per_s', 'lambda_edge_per_s'].every(k => spalten.includes(k)),
      ks.filter(x => /sprün|Sprung|Kante|Register/.test(x.k)).map(x => '„' + x.k + '“ = ' + x.v).join(' | '));
  } catch (e) { check('U3.7', 'Ablauf Befund-Kennzeichnung läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }
  try {
    // Gleich nach dem Take: F3-Mindestwert 2700, das Prüfsignal hat F3 2500 — keine Wertung, Befund statt Rost.
    const sp = speicherNeu(), uhr = uhrNeu(T0 + 11 * 86400e3);
    const p = await seiteOeffnen(sp, uhr, SIG, SR);
    p.st().settings.f3MinHz = 2700;
    p.kalibriert('cal-F3'); await p.mikrofon();
    const T = await p.take();
    const k = kacheln(p.el('take-result').innerHTML).find(x => /ΔF3–4 stabil/.test(x.k)) || { klasse: '?', v: '?' };
    check('U3.12', 'Take-Ergebnis: keine Wertung, weil F3 unter dem Mindestwert 2700 Hz liegt, steht als Befund mit beiden Zahlen, nicht in Rost',
      T.summary.d34stable.n === 0 && T.summary.f3stable.n > 0 && k.klasse === 'befund' && /2700/.test(k.v),
      'f3stable ' + Math.round(T.summary.f3stable.med) + ' (n=' + T.summary.f3stable.n + ') | Kachel „stat ' + k.klasse + '“ „' + k.v + '“');
    p.schliessen();
  } catch (e) { check('U3.12', 'Ablauf Take-Ergebnis mit F3 unter dem Mindestwert läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }

  /* ---------- U3 · Historie: frühere Auswertungen mit Kern und Zeitpunkt ---------- */
  try {
    const sb = chronikNeu(), CHR = sb.VARECHRONIK;
    const t = befundTake(2500, x => {
      x.history = [{ analysis: { kernelVersion: '2.9.0', analysedAt: '2026-03-01T08:05:00.000Z' }, summary: {} },
        { kernelVersion: '2.8.0', analysedAt: '2026-02-01T08:05:00.000Z' }, { summary: {} }];
      x.reanalysisNote = 'F3-Mindestwert 2500 → 2600 Hz, <b>';
    });
    const div = new El(); CHR.renderDetail(div, t, null, {}, false, {});
    const m = /Frühere Auswertungen: ([^<]*)<\/div>/.exec(div.innerHTML), txt = m ? m[1] : '';
    const d1 = CHR.dateShort('2026-03-01T08:05:00.000Z'), d2 = CHR.dateShort('2026-02-01T08:05:00.000Z');
    check('U3.14', 'Detail: frühere Auswertungen mit Kern und Zeitpunkt (neue und ältere Einträge), fehlende Angaben benannt, Änderung der letzten Neu-Analyse maskiert',
      txt.startsWith('2.9.0 (' + d1 + '), 2.8.0 (' + d2 + '), ? (Zeitpunkt unbekannt)') && /geändert: F3-Mindestwert 2500 → 2600 Hz, &lt;b&gt;/.test(txt), '„' + txt + '“');
    // Der ganze Weg: Take mit Audio, Regler verstellt, „Neu analysieren“, Detail öffnen.
    const sp = speicherNeu(), uhr = uhrNeu(T0 + 12 * 86400e3);
    const p = await seiteOeffnen(sp, uhr, SIG, SR);
    p.kalibriert('cal-H'); await p.mikrofon();
    const T = await p.take();
    uhr.vor(60e3);
    p.st().settings.f3MinHz = 2600;
    p.sb.location.hash = '#/take/' + T.id;
    p.sb.VAREAPP.handlers.reanalyse(T);
    await p.warte(() => /Neu analysiert/.test(p.st().statusEl ? p.st().statusEl.textContent : '') && /Frühere Auswertungen/.test(p.el('take-detail').innerHTML), 30000);
    const nach = sp.d.takes.get(T.id), h0 = nach && nach.history && nach.history[0];
    const m2 = /Frühere Auswertungen: ([^<]*)<\/div>/.exec(p.el('take-detail').innerHTML), txt2 = m2 ? m2[1] : '';
    const erwartet = D.VERSION + ' (' + p.sb.VARECHRONIK.dateShort(T.createdAt) + ')';
    check('U3.15', 'Neu-Analyse über die Seite: die Detailansicht nennt die frühere Auswertung mit Kern und Zeitpunkt und was sich geändert hat',
      !!h0 && h0.analysis && h0.analysis.kernelVersion === D.VERSION && txt2.startsWith(erwartet) && /F3-Mindestwert 2500 → 2600 Hz/.test(txt2),
      'erwartet „' + erwartet + ' …“ | angezeigt „' + txt2 + '“');
    p.schliessen();
  } catch (e) { check('U3.14', 'Ablauf Historie läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }

  /* ---------- U3 · Referenzen nur aus gleich gerechneten Takes (Vertrag mit analysis.js) ---------- */
  // Den Regler so bewegen, wie es die Hand tut: input-Ereignis am Schieber, den renderSettings angelegt hat.
  function regler(p, key, wert) {
    const wrap = (p.el('settings').kinder || []).filter(w => new RegExp('id="s-' + key + '"').test(w.innerHTML)).pop();
    if (!wrap) throw new Error('Regler ' + key + ' nicht gefunden');
    const inp = wrap.querySelector('input'); inp.value = String(wert); inp.feuern('input');
  }
  /* Nachbau des Vertrags computeRefs(takes, previous, aktuell) und unvergleichbar(take, aktuell), wie
     ihn analysis.js auf dem Auswertungs-Zweig erfüllt — hier nur mit dem F3-Mindestwert als Rechenweise.
     So prüft das Kriterium die Verdrahtung in app.js, unabhängig davon, welche analysis.js daneben liegt. */
  function vertragNachbauen(sb) {
    const A2 = sb.VAREANALYSIS, echt = A2.computeRefs;
    A2.unvergleichbar = (t, akt) => { const g = t && t.analysis && t.analysis.gate; return akt && g && g.f3MinHz !== akt.gate.f3MinHz ? 'F3-Mindestwert ' + g.f3MinHz + ' statt ' + akt.gate.f3MinHz + ' Hz' : ''; };
    A2.computeRefs = (takes, prev, akt) => {
      const refs = {};
      for (const c in (prev || {})) {
        const pr = prev[c]; if (!pr || !pr.pinned) continue;
        const host = takes.find(t => t.id === pr.takeId), uv = host ? A2.unvergleichbar(host, akt) : '';
        const b = host && host.summary && host.summary.perVowel && host.summary.perVowel[c] && host.summary.perVowel[c].bestSegment;
        refs[c] = host && !uv && b ? { d34: b.d34Med, takeId: host.id, code: host.code, date: host.createdAt, startS: b.startS, lenS: b.lenS, pinned: true }
          : { takeId: pr.takeId, code: pr.code, date: pr.date, startS: pr.startS, lenS: pr.lenS, pinned: true, verwaist: true,
            grund: !host ? 'Take ' + pr.code + ' ist gelöscht.' : 'Take ' + host.code + ' ist anders gerechnet als jetzt eingestellt: ' + uv + '.', d34Zuletzt: isFinite(pr.d34) && pr.d34 !== null ? pr.d34 : pr.d34Zuletzt };
      }
      const auto = echt(takes.filter(t => !A2.unvergleichbar(t, akt)), null);
      for (const c in auto) if (!refs[c]) refs[c] = auto[c];
      return refs;
    };
  }
  try {
    const sp = speicherNeu(), uhr = uhrNeu(T0 + 13 * 86400e3);
    let p = await seiteOeffnen(sp, uhr, SIG, SR);
    const aufrufe = [], echt = p.sb.VAREANALYSIS.computeRefs;
    p.sb.VAREANALYSIS.computeRefs = function (t, prev, akt) { aufrufe.push(akt === undefined ? 'fehlt' : JSON.parse(JSON.stringify(akt))); return echt.apply(this, arguments); };
    p.kalibriert('cal-R'); await p.mikrofon();
    const A1 = await p.take();
    await p.ruhe(20);
    const nachTake = aufrufe[aufrufe.length - 1];
    const soll = { kernelVersion: D.VERSION, gate: { windowS: 0.3, sdF1Max: 50, sdF2Max: 100, minValidShare: 0.8, f3MinHz: 2500 }, spreadMaxHz: 130, hopS: 0.05 };
    aufrufe.length = 0;
    regler(p, 'f3MinHz', 2650);
    await p.warte(() => aufrufe.length > 0, 2000);
    const nachRegler = aufrufe[aufrufe.length - 1];
    check('U3.16', 'Referenzen werden mit der jetzigen Rechenweise bestimmt (Kern, Gatter, Streuungsgrenze, Rahmenabstand), nach dem Take und nach einer Regleränderung',
      abweichung(soll, nachTake) === '' && !!nachRegler && nachRegler.gate && nachRegler.gate.f3MinHz === 2650,
      'nach dem Take ' + JSON.stringify(nachTake) + ' | nach dem Regler ' + JSON.stringify(nachRegler));
    p.schliessen();
    // Gespeicherte Referenz einer früheren Fassung: beim Öffnen neu bestimmt, nicht übernommen.
    sp.d.meta.set('refs', { a: { d34: 600, takeId: 'gibt-es-nicht', code: 'Z', pinned: false } });
    // Regler zurück auf 2500; der Rahmenabstand bleibt der, mit dem A gerechnet ist.
    sp.d.meta.set('settings', Object.assign({}, sp.d.meta.get('settings'), { f3MinHz: 2500 }));
    p = await seiteOeffnen(sp, uhr, SIG, SR);
    await p.warte(() => p.st().refs.a && p.st().refs.a.takeId === A1.id, 2000);
    const gesp = sp.d.meta.get('refs');
    check('U3.17', 'Beim Öffnen: gespeicherte Referenzen werden mit der jetzigen Rechenweise neu bestimmt, eine veraltete Zielmarke bleibt nicht stehen',
      !!p.st().refs.a && p.st().refs.a.takeId === A1.id && gesp.a && gesp.a.takeId === A1.id && Math.abs(gesp.a.d34 - 600) > 50,
      'live ' + JSON.stringify(p.st().refs.a && { takeId: p.st().refs.a.takeId === A1.id ? 'A' : p.st().refs.a.takeId, d34: Math.round(p.st().refs.a.d34) }) + ' | gespeichert ' + (gesp.a ? Math.round(gesp.a.d34) : '–'));
    // Vertrag nachgebaut: ein Take, der mit anderem F3-Mindestwert gerechnet ist, zählt nicht.
    vertragNachbauen(p.sb);
    regler(p, 'f3MinHz', 2600);
    await p.warte(() => !p.st().refs.a, 2000);
    // Ohne die Korrektur fehlen refsUebergangen und refZeile: dann reißt das Kriterium, statt abzubrechen.
    const ueb = p.st().refsUebergangen || {}, refZ = typeof p.sb.VARECHRONIK.refZeile === 'function' ? p.sb.VARECHRONIK.refZeile : () => '';
    const ohne = { refs: Object.keys(p.st().refs).join(','), ueb: JSON.stringify(ueb), zeile: refZ('a', p.st().refs.a, NaN, ueb.a || 0) };
    if (p.st().statusEl) p.st().statusEl.textContent = '';
    p.sb.VAREAPP.handlers.pinRef('a', sp.d.takes.get(A1.id));
    await p.ruhe(30);
    const abgewiesen = { meldung: p.st().statusEl ? p.st().statusEl.textContent : '', gesp: sp.d.meta.get('refs').a };
    p.sb.location.hash = '#/chronik'; p.sb.VAREAPP.refreshChronik();
    await p.warte(() => /anders gerechnet/.test(p.el('refs-table').innerHTML), 2000);
    const tabelle = p.el('refs-table').innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    check('U3.18', 'Regler auf 2600 Hz: der mit 2500 Hz gerechnete Take ist keine Referenz mehr, das wird gesagt; Anpinnen wird abgewiesen',
      ohne.refs === '' && /"a":1/.test(ohne.ueb) && /1 Take ist anders gerechnet/.test(ohne.zeile) && /Nicht angepinnt/.test(abgewiesen.meldung) && !abgewiesen.gesp && /\/a\/ 1 Take/.test(tabelle),
      JSON.stringify(ohne) + ' | Anpinnen: „' + abgewiesen.meldung + '“ | Tabelle „' + tabelle.trim() + '“');
    // Zurück auf 2500, anpinnen, dann wieder 2600: der Pin bleibt sichtbar, verwaist, ohne Zielmarke.
    regler(p, 'f3MinHz', 2500);
    await p.warte(() => p.st().refs.a && !p.st().refs.a.pinned, 2000);
    p.sb.VAREAPP.handlers.pinRef('a', sp.d.takes.get(A1.id));
    await p.warte(() => p.st().refs.a && p.st().refs.a.pinned, 2000);
    regler(p, 'f3MinHz', 2600);
    await p.warte(() => p.st().refs.a && p.st().refs.a.verwaist, 2000);
    p.sb.VAREAPP.refreshChronik();
    await p.warte(() => /verwaist:/.test(p.el('refs-table').innerHTML), 2000);
    const r = p.st().refs.a || {}, zeile = refZ('a', r, 700, 0), tab2 = p.el('refs-table').innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    check('U3.19', 'Angepinnte Referenz, deren Take jetzt anders gerechnet ist: verwaist mit Grund in Tabelle und Live-Zeile, ohne Wert und ohne Differenz',
      r.verwaist === true && !p.sb.VARECHRONIK.zahl(r.d34) && /verwaist: Take A ist anders gerechnet/.test(tab2) && /Lösen/.test(tab2) && /verwaist/.test(zeile) && !/live/.test(zeile),
      'Live „' + zeile + '“ | Tabelle „' + tab2.trim() + '“');
    p.schliessen();
  } catch (e) { check('U3.16', 'Ablauf Referenzen mit Rechenweise läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }
  try {
    // Sicherung mit angepinnter Referenz auf einen Take, der weder in der Sicherung noch hier liegt.
    const sp = speicherNeu(), uhr = uhrNeu(T0 + 14 * 86400e3);
    const p = await seiteOeffnen(sp, uhr, SIG, SR);
    const fremdTake = befundTake(2500, t => { t.id = 'imp-1'; t.code = 'K'; });
    const json = C.serializeBackup({ takes: [fremdTake], series: {}, refs: { u: { d34: 600, takeId: 'fehlt-1', code: 'X', date: new Date(T0).toISOString(), pinned: true } }, calibrations: [], settings: null, kernelVersion: D.VERSION });
    if (p.st().statusEl) p.st().statusEl.textContent = '';
    p.el('file-import').files = [{ text: () => Promise.resolve(json) }];
    p.el('file-import').feuern('change');
    await p.warte(() => /Import/.test(p.st().statusEl ? p.st().statusEl.textContent : ''), 10000);
    const ru = (sp.d.meta.get('refs') || {}).u, meldung = p.st().statusEl.textContent;
    check('U3.20', 'Import: eine angepinnte Referenz der Sicherung wird geprüft wie jede andere; ohne ihren Take wird sie keine Zielmarke, und die Meldung sagt es',
      !(ru && p.sb.VARECHRONIK.zahl(ru.d34)) && (!ru || ru.verwaist === true) && /angepinnte Referenz/.test(meldung) && /(nicht übernommen|verwaist)/.test(meldung),
      'gespeichert ' + JSON.stringify(ru || null) + ' | „' + meldung + '“');
    p.schliessen();
  } catch (e) { check('U3.20', 'Ablauf Import mit angepinnter Referenz läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }
  try {
    // Anzeige mit nachgebauten Einträgen, wie analysis.js sie nach dem Vertrag liefert.
    const sb = chronikNeu(), CHR = sb.VARECHRONIK;
    const refs = {
      a: { takeId: 't-c', code: 'C', date: new Date(T0).toISOString(), startS: 1, lenS: 0.8, pinned: true, verwaist: true, grund: 'Take C ist gelöscht.', d34Zuletzt: 612.4 },
      i: { takeId: 't-d', code: '<img src=x>', date: new Date(T0).toISOString(), pinned: true, verwaist: true, grund: 'Take <img src=x> ist gelöscht.' },
      o: { d34: 700.2, takeId: 't-e', code: 'E', date: new Date(T0).toISOString(), startS: 2, lenS: 0.9, pinned: false, ambiguousShare: 0.3 }
    };
    const div = new El(); CHR.renderRefs(div, refs, {}, { e: 2 });
    const zeilen = div.innerHTML.split('<tr>').slice(2), za = zeilen.find(z => /\/a\//.test(z)) || '', zo = zeilen.find(z => /\/o\//.test(z)) || '';
    const zellenA = za.split('</td>');
    check('U3.21', 'Referenztabelle: verwaist mit Grund, „zuletzt“-Wert nur als Text, kein Wert in der ΔF3–4-Spalte, Lösen-Knopf; zweideutiger Anteil sichtbar; Fremdtext maskiert; übergangene Takes genannt',
      /^–$/.test((zellenA[1] || '').replace(/<[^>]+>/g, '')) && /verwaist: Take C ist gelöscht\./.test(za) && /zuletzt 612 Hz/.test(za) && /data-act="unpin"/.test(za)
      && /700/.test(zo) && /zweideutig 30 %/.test(zo) && !/<img/.test(div.innerHTML) && /\/e\/ 2 Takes/.test(div.innerHTML),
      div.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const refZ = typeof CHR.refZeile === 'function' ? CHR.refZeile : () => '';
    const zv = refZ('a', refs.a, 650, 0), zn = refZ('a', undefined, 650, 2), zr = refZ('o', refs.o, 650, 0), z0 = refZ('a', undefined, NaN, 0);
    check('U3.22', 'Live-Zeile: verwaist ohne Wert und Differenz, mit Grund; ohne Referenz die Zahl der anders gerechneten Takes; sonst Wert und Differenz',
      /verwaist: Take C ist gelöscht\./.test(zv) && /zuletzt 612 Hz/.test(zv) && !/live|−|\+/.test(zv) && /2 Takes sind anders gerechnet/.test(zn) && /700 Hz/.test(zr) && /live 650 \(-50\)/.test(zr) && /erste stabile Aufnahme/.test(z0),
      [zv, zn, zr, z0].join(' | '));
    // Spur ΔF3–4: keine Referenzlinie für einen verwaisten Eintrag oder einen null-Wert aus einer älteren Sicherung.
    const n = 20, ser = { t: new Float32Array(n), f0: new Float32Array(n).fill(196), flags: new Uint8Array(n), valid: new Uint8Array(n), gate: new Uint8Array(n).fill(2), cls: new Int8Array(n), d34: new Float32Array(n).fill(NaN), score: new Float32Array(n).fill(NaN) };
    for (let i = 0; i < n; i++) ser.t[i] = i * 0.05;
    for (let k = 1; k <= 5; k++) ser['f' + k] = new Float32Array(n).fill(NaN);
    const aIdx = sb.VAREVOWEL.CENTROIDS.findIndex(c => c.cls === 'a'); ser.cls.fill(aIdx);
    const linie = r => { const l = leinwand(); CHR.drawLanes(l.cv, ser, { a: r }, null); return l.ops.filter(o => o[0] === 'fillText' && /^\/a\//.test(o[1][0])).map(o => o[1][0]); };
    const lv = linie(refs.a), ln = linie({ d34: null, code: 'Z', pinned: true }), lw = linie({ d34: 700.2, code: 'E' });
    check('U3.23', 'Zeitspur: keine Referenzlinie für verwaiste oder leere Einträge, wohl aber für eine gültige',
      lv.length === 0 && ln.length === 0 && lw.length === 1 && /700/.test(lw[0]), 'verwaist ' + JSON.stringify(lv) + ' | null ' + JSON.stringify(ln) + ' | gültig ' + JSON.stringify(lw));
    // Detail: zweideutige Zuordnung sichtbar; Anpinnen nur, wenn der Take jetzt vergleichbar ist.
    const t = befundTake(2500, x => {
      x.summary.perVowel = { a: { segments: 1, segmentsAmbiguous: 0, bestSegment: { d34Med: 712.4, startS: 0.5, lenS: 1, n: 90, ambiguousShare: 0.3 } }, o: { segments: 2, segmentsAmbiguous: 2, bestSegment: null } };
      x.summary.vowelAmbiguousShare = 0.35;
    });
    const dv = new El(); CHR.renderDetail(dv, t, null, {}, false, { unvergleichbar: () => '' });
    const dn = new El(); CHR.renderDetail(dn, t, null, {}, false, { unvergleichbar: () => 'Kern 2.9.0 statt 3.0.0' });
    const kb = kacheln(dv.innerHTML), best = kb.find(x => /Bestes Segment/.test(x.k)) || {}, va = kb.find(x => /Vokal zweideutig/.test(x.k)) || {};
    const ln2 = new El(); CHR.renderList(ln2, [t], {}, { unvergleichbar: () => 'Kern 2.9.0 statt 3.0.0' });
    check('U3.24', 'Detail: Anteil zweideutiger Rahmen am Bestsegment und im Take sichtbar, „nur zweideutige Segmente“ benannt; Anpinnen nur bei gleicher Rechenweise, sonst der Grund (auch in der Liste)',
      /\/a\/ 712 zweideutig 30 %/.test(best.v || '') && /\/o\/ – \(nur zweideutig zugeordnete Segmente\)/.test(best.v || '') && /35 %/.test(va.v || '')
      && /data-pin="a"/.test(dv.innerHTML) && !/data-pin/.test(dn.innerHTML) && /Nicht als Referenz wählbar.*Kern 2\.9\.0 statt 3\.0\.0/.test(dn.innerHTML) && /title="Kern 2\.9\.0 statt 3\.0\.0">anders gerechnet/.test(ln2.innerHTML),
      'Bestes Segment „' + best.v + '“ | „' + va.k + '“ = „' + va.v + '“ | Pin-Knopf vergleichbar ' + /data-pin="a"/.test(dv.innerHTML) + ', unvergleichbar ' + /data-pin/.test(dn.innerHTML));
  } catch (e) { check('U3.21', 'Ablauf Anzeige Referenzen läuft durch', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }

  check('U1.0', 'app.js: keine Ausnahme in den nachgespielten Abläufen', fehler.length === 0, fehler.slice(0, 3).join(' || '));
  process.removeListener('unhandledRejection', aufFehler);
};
// Die Nachbildung für andere Kriterienmodule (i4_rechenweise.js): dieselbe Seite, derselbe Speicher, dieselben Leser.
module.exports.hilfen = { El, seiteOeffnen, speicherNeu, uhrNeu, chronikNeu, kacheln, listenZellen, fehler };

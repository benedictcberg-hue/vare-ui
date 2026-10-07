/* Kriterien U — Oberfläche (app.js) ohne Browser.
   app.js läuft hier unverändert in einer vm-Umgebung. DOM, IndexedDB, Mikrofon, Token-Ablage
   (localStorage, sessionStorage) und der Abruf von korpus.json sind knapp nachgebildet; Rechenkern,
   Analyse, CSV, Chronik, Kalibrierung und korpus.js sind die echten Dateien. So lassen sich Abläufe
   prüfen, die nur in der Verdrahtung stecken: Neuladen, Löschen, Eingaben während der Analyse, eine
   Uhr, die weiterläuft, Gerätewechsel, An- und Abmelden. Geprüft wird, was gespeichert und angezeigt
   wird. Dieselben Abläufe spielt pruefung/browser-test.js im echten Chromium.
   U1: Schritt 0 (Position, Pause, Einsing-Angaben), Angaben beim Stopp. U2: Kalibrierung und Kette,
   „Alles löschen“ und Code-Zähler, Token. */
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
  querySelector() { return new El(); }
  querySelectorAll() { return []; }
  appendChild(c) { return c; }
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
  const d = { takes: new Map(), series: new Map(), audio: new Map(), cal: new Map(), meta: new Map() };
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
    // /o/ bei 310 Hz ohne Stille: F2–F5, ΔF3–4, SNR und weitere Werte sind nie gemessen (NaN).
    const sig = D.synthVowel(310, [450, 800, 2500, 3300, 4200], [70, 90, 120, 150, 200], 1.5, SR);
    const res = await H.A.analyseTake(sig, SR, { hopS: 0.02 });
    const summary = res.summary;
    summary.pruefUnendlich = { plus: Infinity, minus: -Infinity, liste: [NaN, 1.5, -Infinity] };
    const take = { id: 'u3-nan', code: 'N', label: 'N 310 Hz', createdAt: new Date(T0).toISOString(), durationS: 1.5, sampleRate: SR, analysis: { kernelVersion: D.VERSION, gate: { f3MinHz: 2500 } },
      summary, history: [{ analysis: { kernelVersion: '2.9.0', analysedAt: new Date(T0 - 864e5).toISOString() }, summary: { snrDb: NaN, F: [{ med: NaN, n: 0 }] } }] };
    const series = res.series;
    series.sfr[0] = Infinity; series.sfr[1] = -Infinity;
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

  check('U1.0', 'app.js: keine Ausnahme in den nachgespielten Abläufen', fehler.length === 0, fehler.slice(0, 3).join(' || '));
  process.removeListener('unhandledRejection', aufFehler);
};

/* Kriterien U — Oberfläche (app.js) ohne Browser.
   app.js läuft hier unverändert in einer vm-Umgebung. DOM, IndexedDB und Mikrofon sind knapp
   nachgebildet; Rechenkern, Analyse, CSV, Chronik und Kalibrierung sind die echten Dateien. So
   lassen sich Abläufe prüfen, die nur in der Verdrahtung stecken: Neuladen, Löschen, Eingaben
   während der Analyse, eine Uhr, die weiterläuft. Geprüft wird, was gespeichert und angezeigt
   wird. Dieselben Abläufe spielt pruefung/browser-test.js im echten Chromium. */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path'), nodeCrypto = require('crypto');
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
  const kopie = v => (v == null ? v : structuredClone(v));
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
    clearAll: () => { Object.values(d).forEach(m => m.clear()); return P(); },
    estimate: () => P(null), persist: () => P(false), persisted: () => P(false)
  };
  return { d, api };
}
// Mikrofon-Ersatz: jeder Take liefert dasselbe Signal. Geräte-ID wählt den Gerätenamen.
function recorderNeu(signal, sr) {
  return {
    createRecorder() {
      const r = {
        active: false, info: null, sampleRate: sr, samplesSeen: 0, recordedSeconds: 0,
        start(devId) {
          r.active = true;
          r.info = { deviceLabel: devId ? 'Zweitgerät' : 'Testmikrofon', deviceId: devId || 'standard', sampleRate: sr, trackSampleRate: sr, capture: 'worklet', echoCancellation: false, noiseSuppression: false, autoGainControl: false };
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
    performance: { now: () => performance.now() },
    setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: h => clearTimeout(h),
    setInterval: (f, ms) => { const h = setInterval(f, ms); if (h.unref) h.unref(); intervalle.push({ h, f, ms }); return h; },
    clearInterval: h => { clearInterval(h); const i = intervalle.findIndex(x => x.h === h); if (i >= 0) intervalle.splice(i, 1); },
    confirm: () => true, alert() { }, crypto: { randomUUID: () => nodeCrypto.randomUUID() },
    Blob, URL, btoa, atob, Date: uhr.Date, devicePixelRatio: 1
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
    kalibriert(id) { const s = st(); s.cal = { id, floorDb: -72, levelDb: -20, snrDb: 52, createdAt: new uhr.Date().toISOString(), deviceLabel: 'Testmikrofon', deviceId: 'standard', F: [700, 1200, 2500] }; s.calSession = true; },
    async mikrofon() { p.klick('btn-mic'); return p.warte(() => st().rec && st().rec.active && !el('btn-mic').disabled); },
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
  return p;
}

module.exports = async function (H) {
  const { check, D, SR, concat, noise, BW5 } = H;
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

  check('U1.0', 'app.js: keine Ausnahme in den nachgespielten Abläufen', fehler.length === 0, fehler.slice(0, 3).join(' || '));
  process.removeListener('unhandledRejection', aufFehler);
};

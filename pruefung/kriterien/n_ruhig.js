/* Kriterien zur ruhigen Live-Anzeige (app.js renderRuhig): Werte als Median über 1 s, zweimal pro
   Sekunde neu geschrieben, Formanten auf 10 Hz gerundet; ein Wert erscheint nur, wenn er in der Mehrheit der Rahmen trägt, sonst „– · Grund“.
   app.js läuft unverändert in einer vm-Umgebung; analyseAt liefert echte Rahmen eines /a/ bei 196 Hz, in denen
   nur einzelne Felder verändert sind. Die Zeit der Live-Schleife wird von außen vorgegeben (41 ms je Takt). */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const quelle = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

module.exports = async function (H) {
  const { check } = H;
  const els = {}, intervalle = [];
  const ctx2d = new Proxy({}, { get: (o, k) => k === 'measureText' ? () => ({ width: 10 }) : (k === 'createLinearGradient' ? () => ({ addColorStop() { } }) : (k in o ? o[k] : () => { })), set: (o, k, v) => { o[k] = v; return true; } });
  class El {
    constructor(id) { this.id = id || ''; this._t = ''; this.kinder = []; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this.style = {}; this.clientWidth = 600; this._on = {}; this.innerHTML = ''; this.checked = false; this.files = []; this.width = 600; this.height = 100; this.wechsel = 0; }
    get textContent() { return this._t + this.kinder.map(k => k.textContent).join(''); }
    set textContent(v) { v = String(v); if (v !== this.textContent) this.wechsel++; this._t = v; this.kinder = []; }
    addEventListener(t, f) { (this._on[t] = this._on[t] || []).push(f); }
    removeEventListener() { }
    click() { (this._on.click || []).forEach(f => f({ target: this, preventDefault() { } })); }
    setAttribute(k, v) { this['@' + k] = String(v); }
    getAttribute(k) { return this['@' + k] == null ? null : this['@' + k]; }
    removeAttribute(k) { delete this['@' + k]; }
    querySelector() { return new El(); }
    querySelectorAll() { return []; }
    appendChild(c) { this.kinder.push(c); return c; }
    insertBefore(c) { return c; }
    remove() { } focus() { }
    getContext() { return ctx2d; }
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 600, height: 100 }; }
  }
  const el = id => els[id] || (els[id] = new El(id));
  let raf = null;
  const meta = new Map(), P = v => Promise.resolve(v);
  const store = { open: () => P(), putTake: () => P(), getTake: () => P(null), allTakes: () => P([]), deleteTake: () => P(), putSeries: () => P(), getSeries: () => P(null), putAudio: () => P(), getAudio: () => P(null),
    putTakeSeries: () => P(), updateTake: () => P(null), updateTakeSeries: () => P(null), putPending: () => P(), allPending: () => P([]), deletePending: () => P(),
    deleteAudio: () => P(), hasAudio: () => P(false), audioIds: () => P([]), putCalibration: () => P(), allCalibrations: () => P([]), deleteCalibration: () => P(),
    getMeta: (k, fb) => P(meta.has(k) ? meta.get(k) : fb), setMeta: (k, v) => { meta.set(k, v); return P(); }, clearAll: () => P(), estimate: () => P(null), persist: () => P(false), persisted: () => P(false) };
  const rec = { active: false, info: null, sampleRate: 48000, samplesSeen: 0, recordedSeconds: 0,
    start() { rec.active = true; rec.info = { deviceLabel: 'Testmikrofon', deviceId: 'standard', sampleRate: 48000, trackSampleRate: 48000, capture: 'worklet', echoCancellation: false, noiseSuppression: false, autoGainControl: false }; return P(rec.info); },
    stop() { rec.active = false; return P(); }, beginTake() { }, endTake() { return { samples: new Float32Array(0), sampleRate: 48000, durationS: 0 }; }, latest: s => new Float32Array(Math.round(s * 48000)) };
  const leer = () => ({ getItem: () => null, setItem() { }, removeItem() { } });
  const doc = { readyState: 'complete', activeElement: null, body: new El('body'), getElementById: el, createElement: () => new El(), querySelector: () => el('main'), querySelectorAll: () => [], addEventListener() { } };
  const ab = { document: doc, console: { log() { }, warn() { }, error() { } }, navigator: {}, location: { hash: '#/aufnahme', protocol: 'http:', origin: 'http://localhost' },
    addEventListener() { }, removeEventListener() { }, requestAnimationFrame: f => { raf = f; return 1; }, cancelAnimationFrame() { }, performance: { now: () => Date.now() },
    setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: h => clearTimeout(h),
    setInterval: (f, ms) => { const h = setInterval(f, ms); if (h.unref) h.unref(); intervalle.push(h); return h; }, clearInterval: h => clearInterval(h),
    confirm: () => true, alert() { }, crypto: { randomUUID: () => require('crypto').randomUUID() }, Blob: require('buffer').Blob, URL, btoa, atob, Date, devicePixelRatio: 1,
    localStorage: leer(), sessionStorage: leer(), fetch: () => Promise.reject(new Error('kein Netz')), TextDecoder };
  ab.window = ab; ab.self = ab;

  const bad = { r1: [], r2: [], r3: [] }, belege = { r1: [], r2: [], r3: [] };
  let st = null, defaults = null;
  try {
    vm.createContext(ab);
    for (const f of ['dsp.js', 'vowel.js', 'analysis.js', 'csv.js', 'wav.js', 'calibration.js', 'korpus.js', 'chronik.js']) vm.runInContext(quelle(f), ab, { filename: f });
    ab.VARESTORE = store; ab.VARERECORDER = { createRecorder: () => rec, listDevices: () => P([]) };
    vm.runInContext(quelle('app.js'), ab, { filename: 'app.js' });
    st = ab.VAREAPP.state; defaults = ab.VAREAPP.SETTINGS_DEFAULT;
    for (let w = 0; w < 500 && !st.settings; w++) await new Promise(r => setTimeout(r, 2));
    el('btn-mic').click();
    for (let w = 0; w < 500 && !(rec.active && raf); w++) await new Promise(r => setTimeout(r, 2));
    const DD = ab.VAREDSP, echt = DD.analyseAt;
    const sig = DD.resample(DD.synthVowel(196, [700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200], 0.4, 48000), 48000, DD.TARGET_SR);
    const basis = echt(sig, DD.TARGET_SR, sig.length - 1, { align: 'end', wantSpectrum: true, floorDb: -70 });
    if (!(basis.voiced && basis.valid.every(Boolean))) bad.r1.push('Grundrahmen nicht sauber');
    let jetzt = 1000;
    // n Takte der Live-Schleife, je 41 ms; rahmen(i) liefert die Änderungen am Grundrahmen.
    const lauf = (n, rahmen) => {
      for (let i = 0; i < n; i++) {
        const fr = Object.assign({}, basis, rahmen(i));
        fr.F = (rahmen(i).F || basis.F).slice(); fr.valid = (rahmen(i).valid || basis.valid).slice();
        DD.analyseAt = () => fr;
        rec.samplesSeen += 1968; jetzt += 41;
        raf(jetzt);
      }
    };
    const text = id => el('v-' + id).textContent, klasse = id => el('st-' + id).className;
    const zaehler = () => { const z = {}; for (const k of ['f0', 'f1', 'f3', 'f4', 'd34']) z[k] = el('v-' + k).wechsel; return z; };
    const diff = (a, b) => { const z = {}; for (const k in a) z[k] = b[k] - a[k]; return z; };

    // RU1: Formanten springen von Rahmen zu Rahmen um ±40 Hz. Ruhig: höchstens 4 Neuschriften je Sekunde und
    // der Median steht da; Gegenprobe im Einzeltakt: die Zahl springt mit jedem Rahmen.
    // Versatz −40 … +40 Hz in wechselnder Folge, gleich verteilt um 0: der Median liegt beim Grundrahmen.
    const zappel = i => { const s = ((i * 7) % 9 - 4) * 10; return { F: basis.F.map(f => f + s), f0: basis.f0 + s / 40 }; };
    st.settings.ruhig = true;
    lauf(30, zappel);                     // Vorlauf: Fenster füllen
    let z0 = zaehler();
    lauf(49, zappel);                     // 49 Takte = 2,0 s
    const ruhigW = diff(z0, zaehler());
    const f3Soll = Math.round(basis.F[2]);
    const f3Text = text('f3');
    st.settings.ruhig = false;
    z0 = zaehler(); lauf(49, zappel);
    const einzelW = diff(z0, zaehler());
    st.settings.ruhig = true; lauf(20, () => ({}));
    const maxRuhig = Math.max(...Object.values(ruhigW));
    if (maxRuhig > 5) bad.r1.push('ruhig ' + JSON.stringify(ruhigW) + ' Wechsel in 2 s');
    if (!(einzelW.f3 > 30)) bad.r1.push('Gegenprobe Einzeltakt nur ' + einzelW.f3 + ' Wechsel');
    const ohne = t => t.replace(/[\s·]+/g, '');
    if (ohne(el('hero-d34').textContent) !== ohne(text('d34'))) bad.r1.push('große Zahl „' + el('hero-d34').textContent + '“ ≠ Kachel „' + text('d34') + '“');
    if (!/0 Hz/.test(f3Text)) bad.r1.push('F3 nicht auf 10 Hz: „' + f3Text + '“');
    const f3Zahl = parseFloat(f3Text);
    if (!(Math.abs(f3Zahl - f3Soll) <= 6)) bad.r1.push('F3 „' + f3Text + '“ statt Median um ' + f3Soll);
    belege.r1.push('ruhig ' + JSON.stringify(ruhigW) + ' Wechsel/2 s, Einzeltakt F3 ' + einzelW.f3 + ', F3 „' + f3Text + '“');

    // RU2: F4 nur in 2 von 5 Rahmen gültig → keine Zahl, sondern „– · Grund“ in Rost; in 4 von 5 gültig → Zahl.
    const selten = i => { const v = basis.valid.slice(), g = ['', '', '', '', '']; if (i % 5 > 1) { v[3] = false; g[3] = 'nummer'; } return { valid: v, slotGrund: g, d34valid: i % 5 <= 1 }; };
    lauf(40, selten);
    const f4Selten = { t: text('f4'), k: klasse('f4'), d: text('d34') };
    if (f4Selten.t !== '– · mehrdeutig' || !/\bunsure\b/.test(f4Selten.k)) bad.r2.push('F4 in 40 % gültig: „' + f4Selten.t + '“ ' + f4Selten.k);
    if (/gewertet/.test(f4Selten.d) && !/nicht gewertet/.test(f4Selten.d)) bad.r2.push('ΔF3–4 gewertet, obwohl F4 meist ungültig: „' + f4Selten.d + '“');
    const meist = i => { const v = basis.valid.slice(); if (i % 5 === 0) v[3] = false; return { valid: v }; };
    lauf(40, meist);
    const f4Meist = { t: text('f4'), k: klasse('f4') };
    if (!/^\d+ Hz/.test(f4Meist.t) || /\bunsure\b/.test(f4Meist.k)) bad.r2.push('F4 in 80 % gültig: „' + f4Meist.t + '“ ' + f4Meist.k);
    belege.r2.push('40 %: „' + f4Selten.t + '“ / ΔF3–4 „' + f4Selten.d + '“; 80 %: „' + f4Meist.t + '“');

    // RU3: Gründe kurz und lesbar (höchstens 3 Wörter), unsicherer Grundton als „– · Grundton unsicher“.
    lauf(40, () => ({ f0Unsure: true, f0Grund: 'cepstrum', f0Cep: 98 }));
    const f0Text = text('f0');
    if (f0Text !== '– · Grundton unsicher' || !/\bunsure\b/.test(klasse('f0'))) bad.r3.push('F0 „' + f0Text + '“ ' + klasse('f0'));
    const kurz = [f4Selten.t, f0Text].map(t => t.replace(/^– · /, ''));
    if (kurz.some(g => g.split(/\s+/).length > 3)) bad.r3.push('lange Gründe: ' + kurz.join(' | '));
    belege.r3.push(kurz.join(' | '));
    DD.analyseAt = echt;
  } catch (e) { bad.r1.push('Ausnahme ' + String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }
  intervalle.forEach(h => clearInterval(h));

  check('RU0', 'Ruhige Live-Anzeige ist voreingestellt und abschaltbar (Einstellung „ruhig“)', !!defaults && defaults.ruhig === true && /ruhig/.test(quelle('app.js').match(/SETTING_DEFS[\s\S]*?\];/) ? quelle('app.js').match(/SETTING_DEFS[\s\S]*?\];/)[0] : ''), defaults ? 'ruhig=' + defaults.ruhig : 'keine Voreinstellungen');
  check('RU1', 'Ruhig: Formanten, die von Rahmen zu Rahmen um ±40 Hz springen, stehen als Median da (auf 10 Hz) und werden höchstens zweimal je Sekunde neu geschrieben; die große Zahl oben zeigt dasselbe wie die ΔF3–4-Kachel; im Einzeltakt springt die Zahl mit jedem Rahmen',
    !bad.r1.length, bad.r1.length ? bad.r1.join(' | ') : belege.r1.join(' | '));
  check('RU2', 'Ruhig: ein Wert, der nur in einer Minderheit der Rahmen trägt, erscheint nicht als Zahl, sondern als „– · Grund“ in Rost (Nummer mehrdeutig → „mehrdeutig“); trägt er in der Mehrheit, steht die Zahl ohne Rost',
    !bad.r2.length, bad.r2.length ? bad.r2.join(' | ') : belege.r2.join(' | '));
  check('RU3', 'Ruhig: Gründe kurz (höchstens drei Wörter), unsicherer Grundton als „– · Grundton unsicher“ in Rost',
    !bad.r3.length, bad.r3.length ? bad.r3.join(' | ') : belege.r3.join(' | '));
};

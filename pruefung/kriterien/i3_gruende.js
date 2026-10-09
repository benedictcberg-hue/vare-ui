/* I3 — Gründe für ungültige Formanten und angenommener Rauschboden, sichtbar bis in Serie, CSV und Anzeige.
   Der Rechenkern sagt je Slot, warum er unsicher ist (dsp.js analyseAt: slotGrund 'nummer' oder
   'verschmolzen', rauschBoden; Vertrag K2). Vorher speicherte die Serie nur die Maske slotUnsure, die
   Anzeige schrieb „Zuordnung unsicher, nur N Resonanzen“ — falsch bei 'verschmolzen' und bei fünf Gipfeln —
   und nannte einen Formanten im Rauschboden „Streuung“. Live ohne Kalibrierung galt noch die alte Klemme
   min(q05, q50 − 20), die leise Rahmen eines Decrescendo als Pause verwarf (derselbe Fehlertyp wie V3).
   Prüftake: Stücke, an denen der Kern die Gründe tatsächlich meldet — tiefer enger Cluster bei 110 Hz mit
   Rauschen 30 dB unter dem Vokal (Nummer mehrdeutig, im Rauschboden, Streuung), /a/ bei 330 Hz (zwei
   Resonanzen in einem Gipfel möglich), /o/ bei 247 Hz mit F6 im Band (Nummer mehrdeutig, Bandbreite unter
   40 Hz). Die Sollwerte kommen aus analyseAt selbst, Rahmen für Rahmen.
   I3a Serie und CSV-Rahmenspalten, I3b Gründe live und im Hover, I3c Live-Boden, I3d Stimmschwelle in CSV
   und Chronik. Anzeige in einer vm-Umgebung wie in i2_durchreichen.js. */
'use strict';
const path = require('path');

module.exports = async function (H) {
  const { check, r1, noise, concat, SR, TSR, D, A } = H;
  const rms = x => { let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i]; return Math.sqrt(e / x.length); };
  const mitRauschen = (x, abstandDb, seed) => {
    const z = noise(x.length, 1, seed), g = rms(x) / rms(z) * Math.pow(10, -abstandDb / 20), y = Float64Array.from(x);
    for (let i = 0; i < y.length; i++) y[i] += g * z[i];
    return y;
  };
  const ENG = [[500, 1500, 1700, 2200, 3150], [70, 90, 90, 90, 100]], AV = [[700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200]];
  const OF6 = [[500, 800, 2600, 2950, 4100, 4600], [70, 90, 120, 150, 200, 220]];
  const SIG = concat([noise(Math.round(0.2 * SR), 2e-4, 21),
    mitRauschen(D.synthVowel(110, ENG[0], ENG[1], 0.9, SR), 30, 22),
    D.synthVowel(330, AV[0], AV[1], 0.5, SR),
    D.synthVowel(247, OF6[0], OF6[1], 0.5, SR),
    noise(Math.round(0.2 * SR), 2e-4, 23)]);

  /* ---------- I3a: Serie ---------- */
  const res = await A.analyseTake(SIG, SR, {});
  const ser = res.series, n = ser.t.length;
  // Dieselben Rahmen wie analyseTake: Raster 10 ms, Rand 30 ms, Boden aus dem Take.
  const ds = D.resample(SIG, SR, TSR), hop = Math.round(0.010 * TSR), half = Math.round(0.03 * TSR);
  const floorDb = A.estimateFloor(ds, TSR, 0.010).db, R = [];
  for (let c = half; c + half <= ds.length; c += hop) R.push(D.analyseAt(ds, TSR, c, { align: 'centre', floorDb, spreadMaxHz: D.SPREAD_MAX_HZ }));
  const fall = { nummer: 0, verschmolzen: 0, rauschBoden: 0, beides: 0 };
  {
    const bad = [];
    if (R.length !== n) bad.push(n + ' Rahmen in der Serie, ' + R.length + ' nachgerechnet');
    for (const f of ['slotVerschmolzen', 'rauschBoden']) if (!(ser[f] instanceof Uint8Array)) bad.push(f + ' fehlt oder ist kein Uint8Array');
    if (!bad.length) {
      for (let i = 0; i < Math.min(n, R.length); i++) {
        const r = R[i];
        let m = 0, b = 0, u = 0;
        for (let k = 0; k < 5; k++) {
          if (r.slotUnsure[k]) u |= 1 << k;
          if (r.slotGrund[k] === 'verschmolzen') m |= 1 << k;
          if (r.rauschBoden[k]) b |= 1 << k;
          if (r.voiced && r.slotGrund[k] === 'nummer') fall.nummer++;
          if (r.voiced && r.slotGrund[k] === 'verschmolzen') fall.verschmolzen++;
          if (r.voiced && r.rauschBoden[k]) fall.rauschBoden++;
          if (r.voiced && r.rauschBoden[k] && r.slotGrund[k]) fall.beides++;
        }
        if (ser.slotVerschmolzen[i] !== m) bad.push('slotVerschmolzen[' + i + '] ' + ser.slotVerschmolzen[i] + ' statt ' + m);
        if (ser.rauschBoden[i] !== b) bad.push('rauschBoden[' + i + '] ' + ser.rauschBoden[i] + ' statt ' + b);
        if (ser.slotUnsure[i] !== u) bad.push('slotUnsure[' + i + '] ' + ser.slotUnsure[i] + ' statt ' + u);
        // „verschmolzen“ ist ein Grund für „unsicher“: ohne slotUnsure-Bit wäre die Maske widersprüchlich
        if (ser.slotVerschmolzen[i] & ~ser.slotUnsure[i]) bad.push('verschmolzen ohne unsicher [' + i + ']');
      }
    }
    check('I3a', 'Serie trägt je Rahmen die Masken slotVerschmolzen (slotGrund „verschmolzen“) und rauschBoden (Uint8, Bit k = Fk+1) — Rahmen für Rahmen gleich analyseAt; slotUnsure ohne Verschmolzen-Bit heißt „nummer“',
      !bad.length && fall.nummer >= 20 && fall.verschmolzen >= 20 && fall.rauschBoden >= 20 && fall.beides >= 5,
      n + ' Rahmen; Slots ' + JSON.stringify(fall) + (bad.length ? ' — ' + bad.length + ' Abweichungen: ' + bad.slice(0, 4).join('; ') : ''));
  }
  {
    // Sicherung → Import: die Masken kommen als Uint8Array exakt zurück.
    const H2 = H.C.parseBackup(H.C.serializeBackup({ takes: [{ id: 'i3' }], series: { i3: ser }, refs: null, calibrations: [], settings: null })).series.i3;
    const bad = [];
    for (const f of ['slotVerschmolzen', 'rauschBoden']) if (!(H2[f] instanceof Uint8Array) || Array.from(H2[f]).join() !== Array.from(ser[f] || []).join()) bad.push(f + ' verändert');
    check('I3a', 'Sicherung → Import: slotVerschmolzen und rauschBoden kommen unverändert zurück', !bad.length && !!ser.slotVerschmolzen, bad.join('; '));
  }

  /* ---------- I3a: CSV-Rahmenspalten ---------- */
  const zeilen = (text, sep) => text.replace(/^﻿/, '').split('\r\n').filter(z => z !== '').map(z => z.split(sep));
  {
    // Je Slot der Grund als Text des Kerns und der Rauschboden als 0/1, Rahmen für Rahmen gleich analyseAt.
    const z = zeilen(H.C.framesToCsv(ser, 'standard', H.V), ','), kopf = z[0], bad = [];
    let geprueft = 0;
    const texte = new Set();
    for (let k = 0; k < 5; k++) {
      // In stimmlosen Rahmen fehlen Grund und Marke (leer bzw. −99, B2), statt 0 = „über dem Boden“ zu sagen.
      for (const [name, f] of [['slot_grund' + (k + 1), r => r.voiced ? r.slotGrund[k] : ''], ['rauschboden' + (k + 1), r => !r.voiced ? '-99' : r.rauschBoden[k] ? '1' : '0']]) {
        const c = kopf.indexOf(name);
        if (c < 0) { bad.push(name + ' fehlt'); continue; }
        for (let i = 0; i < R.length; i++) {
          const want = f(R[i]), got = z[i + 1] && z[i + 1][c];
          if (got !== want) { if (bad.length < 6) bad.push(name + '[' + i + '] ' + JSON.stringify(got) + ' statt ' + JSON.stringify(want)); } else geprueft++;
          if (/grund/.test(name) && want) texte.add(want);
        }
      }
    }
    /* Bis Kern 4.0 kannte der Kern nur 'nummer' und 'verschmolzen', und das Kriterium verlangte genau diese zwei Texte.
       Seit Kern 4.1 meldet er im Prüftake zu Recht auch 'teilton' (/a/ bei 330 Hz, Teiltonabstand über 250 Hz) und
       'wechsel' (Hüllkurve wechselt im Fenster, A3). Geprüft bleibt jede Zelle gegen analyseAt; verlangt sind weiter
       beide alten Texte, und kein Text außerhalb des Vertrags (K2, A3). */
    const VERTRAG_SLOT = ['nummer', 'verschmolzen', 'teilton', 'wechsel'];
    check('I3a', 'Rahmen-CSV: slot_grund1…5 („nummer“, „verschmolzen“, „teilton“, „wechsel“, leer) und rauschboden1…5 (0/1) Rahmen für Rahmen gleich analyseAt',
      !bad.length && geprueft === 10 * R.length && texte.has('nummer') && texte.has('verschmolzen') && [...texte].every(t => VERTRAG_SLOT.indexOf(t) >= 0), geprueft + '/' + 10 * R.length + ' Zellen, Gründe ' + [...texte].join(' | ') + (bad.length ? ' — ' + bad.join('; ') : ''));
  }
  {
    // Ältere Serie ohne die Masken: unsicher bleibt sichtbar, aber ohne erfundenen Grund („?“, nicht „nummer“);
    // Rauschboden unbekannt −99 (nicht 0 = „über dem Boden“); kein Absturz, übrige Spalten unverändert.
    const alt = {};
    for (const k in ser) if (k !== 'slotVerschmolzen' && k !== 'rauschBoden') alt[k] = ser[k];
    const bad = [];
    let za = null, zv = null;
    try { za = zeilen(H.C.framesToCsv(alt, 'excelde', H.V), ';'); zv = zeilen(H.C.framesToCsv(ser, 'excelde', H.V), ';'); } catch (e) { bad.push('Ausnahme ' + e.message); }
    let fragen = 0;
    if (za) {
      const kopf = za[0], NEU = [];
      for (let k = 0; k < 5; k++) {
        NEU.push('slot_grund' + (k + 1), 'rauschboden' + (k + 1));
        const cg = kopf.indexOf('slot_grund' + (k + 1)), cb = kopf.indexOf('rauschboden' + (k + 1));
        if (cg < 0 || cb < 0) { bad.push('Spalten für F' + (k + 1) + ' fehlen'); continue; }
        for (let i = 1; i < za.length; i++) {
          const want = (ser.slotUnsure[i - 1] & (1 << k)) ? '?' : '';
          if (want) fragen++;
          if (za[i][cg] !== want) { bad.push('slot_grund' + (k + 1) + '[' + (i - 1) + '] „' + za[i][cg] + '“ statt „' + want + '“'); break; }
          if (!/^-99(,0+)?$/.test(za[i][cb])) { bad.push('rauschboden' + (k + 1) + '[' + (i - 1) + '] ' + za[i][cb] + ' statt −99'); break; }
        }
      }
      kopf.forEach((k, c) => { if (NEU.indexOf(k) < 0 && za.some((r, i) => r[c] !== zv[i][c])) bad.push(k + ' verändert'); });
    }
    check('I3a', 'Ältere Serie ohne die Masken: unsichere Slots mit Grund „?“ (nie still „nummer“), Rauschboden −99, übrige Spalten unverändert, kein Absturz',
      !bad.length && fragen > 0, fragen + ' unsichere Slots' + (bad.length ? ' — ' + bad.slice(0, 4).join('; ') : ''));
  }

  /* ---------- I3b: Gründe live und im Hover ---------- */
  const vm = require('vm'), fs = require('fs');
  const ROOT = path.join(__dirname, '..', '..'), quelle = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const SMAX = D.SPREAD_MAX_HZ;
  /* Sollgründe, hier unabhängig von chronik.js aus den Feldern eines analyseAt-Rahmens gebildet (dsp.js:
     valid verlangt Wert, ≥ 3 Fenster, ≥ 2 Ordnungen, beide Streuungen unter der Grenze, slotGrund leer,
     kein Rauschboden). Die Serie kennt nWin nicht: Dort steht „nur in 2 Fenstern“ nur, wenn sonst nichts
     die Ungültigkeit erklärt (ohneZaehlung). */
  const fmt0 = v => { const t = v.toFixed(0); return t === '-0' ? '0' : t; };
  /* Kern 4.1 (A3) vergibt je Slot zwei weitere Gründe: 'teilton' (Teiltonabstand zu groß, mit dem Abstand) und
     'wechsel' (Vokalwechsel im Fenster). Bis dahin kannte diese Sollfunktion nur 'nummer' und 'verschmolzen' und
     erwartete für einen Slot mit 'teilton' gar keinen Grund — das widerspricht „nennt alle zutreffenden Gründe“. */
  function sollGruende(r, k, ohneZaehlung, sdw, sdo, tt) {
    if (!isFinite(r.F[k])) return ['nicht gefunden'];
    sdw = sdw === undefined ? r.sdWin[k] : sdw; sdo = sdo === undefined ? r.sdOrder[k] : sdo; tt = tt === undefined ? r.teiltonHz : tt;
    const t = [];
    if (r.slotGrund[k] === 'nummer') t.push('Nummer mehrdeutig');
    if (r.slotGrund[k] === 'verschmolzen') t.push('zwei Resonanzen in einem Gipfel möglich');
    if (r.slotGrund[k] === 'teilton') t.push('Teiltonabstand ' + (isFinite(tt) ? fmt0(tt) + ' Hz ' : '') + 'zu groß');
    if (r.slotGrund[k] === 'wechsel') t.push('Vokalwechsel im Fenster');
    if (r.rauschBoden[k]) t.push('im Rauschboden');
    if (sdw >= SMAX) t.push('Streuung über Fenster ' + fmt0(sdw) + ' Hz');
    if (sdo >= SMAX) t.push('Streuung über Ordnungen ' + fmt0(sdo) + ' Hz');
    if (r.nWin[k] === 1) t.push('nur in einem Fenster');
    if (r.nWin[k] === 2 && (!ohneZaehlung || !t.length)) t.push('nur in 2 Fenstern');
    if (r.nOrders[k] < 2) t.push('in weniger als 2 Ordnungen');
    return t;
  }
  // Zeichenfläche, die Aufrufe mitschreibt (wie in i2_durchreichen.js).
  function leinwand() {
    const ops = [];
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { ops.push([k, a]); }), set: (t, k, v) => { t[k] = v; ops.push(['set', k, v]); return true; } });
    return { cv: { clientWidth: 450, style: {}, getContext: () => ctx }, ops };
  }
  /* app.js unverändert in einer vm-Umgebung: Speicher und Mikrofon nachgestellt. Das Mikrofon liefert die
     letzten s Sekunden von quelle.sig bis zur Stelle quelle.pos (Abtastwerte bei 48 kHz). */
  async function appSeite() {
    const els = {}, canv = {}, intervalle = [];
    class El {
      constructor(id) { this.id = id || ''; this._t = ''; this.kinder = []; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this.style = {}; this.clientWidth = 600; this._on = {}; this.innerHTML = ''; this.checked = false; this.files = []; }
      get textContent() { return this._t + this.kinder.map(k => k.textContent).join(''); }
      set textContent(v) { this._t = String(v); this.kinder = []; }
      addEventListener(t, f) { (this._on[t] = this._on[t] || []).push(f); }
      removeEventListener() { }
      click() { (this._on.click || []).forEach(f => f({ target: this, preventDefault() { } })); }
      setAttribute(k, v) { this['@' + k] = String(v); }
      getAttribute(k) { return this['@' + k] == null ? null : this['@' + k]; }
      querySelector() { return new El(); }
      querySelectorAll() { return []; }
      appendChild(c) { this.kinder.push(c); return c; }
      insertBefore(c) { return c; }
      remove() { } focus() { }
      getContext() { const l = leinwand(); canv[this.id] = l.ops; return l.cv.getContext(); }
      getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 600, height: 100 }; }
    }
    const el = id => els[id] || (els[id] = new El(id));
    const seite = { el, canv, raf: null, quelle: { sig: new Float64Array(48000), pos: 48000 } };
    const meta = new Map(), P = v => Promise.resolve(v);
    const store = { open: () => P(), putTake: () => P(), getTake: () => P(null), allTakes: () => P([]), deleteTake: () => P(), putSeries: () => P(), getSeries: () => P(null), putAudio: () => P(), getAudio: () => P(null),
      // Schnittstelle seit B1: Take und Verlauf in einer Transaktion, Aufnahme vor der Analyse in pending.
      putTakeSeries: () => P(), updateTake: () => P(null), updateTakeSeries: () => P(null), putPending: () => P(), allPending: () => P([]), deletePending: () => P(),
      deleteAudio: () => P(), hasAudio: () => P(false), audioIds: () => P([]), putCalibration: () => P(), allCalibrations: () => P([]), deleteCalibration: () => P(),
      getMeta: (k, fb) => P(meta.has(k) ? meta.get(k) : fb), setMeta: (k, v) => { meta.set(k, v); return P(); }, clearAll: () => P(), estimate: () => P(null), persist: () => P(false), persisted: () => P(false) };
    const rec = { active: false, info: null, sampleRate: 48000, samplesSeen: 0, recordedSeconds: 0,
      start() { rec.active = true; rec.info = { deviceLabel: 'Testmikrofon', deviceId: 'standard', sampleRate: 48000, trackSampleRate: 48000, capture: 'worklet', echoCancellation: false, noiseSuppression: false, autoGainControl: false }; return P(rec.info); },
      stop() { rec.active = false; return P(); }, beginTake() { }, endTake() { return { samples: new Float32Array(0), sampleRate: 48000, durationS: 0 }; },
      latest: s => { const q = seite.quelle, n = Math.round(s * 48000), a = Math.max(0, q.pos - n); return Float32Array.from(q.sig.subarray(a, q.pos)); } };
    const leer = () => ({ getItem: () => null, setItem() { }, removeItem() { } });
    const doc = { readyState: 'complete', activeElement: null, body: new El('body'), getElementById: el, createElement: () => new El(), querySelector: () => el('main'), querySelectorAll: () => [], addEventListener() { } };
    const ab = { document: doc, console: { log() { }, warn() { }, error() { } }, navigator: {}, location: { hash: '#/aufnahme', protocol: 'http:', origin: 'http://localhost' },
      addEventListener() { }, removeEventListener() { }, requestAnimationFrame: f => { seite.raf = f; return 1; }, cancelAnimationFrame() { }, performance: { now: () => Date.now() },
      setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: h => clearTimeout(h),
      setInterval: (f, ms) => { const h = setInterval(f, ms); if (h.unref) h.unref(); intervalle.push(h); return h; }, clearInterval: h => clearInterval(h),
      confirm: () => true, alert() { }, crypto: { randomUUID: () => require('crypto').randomUUID() }, Blob: require('buffer').Blob, URL, btoa, atob, Date, devicePixelRatio: 1,
      localStorage: leer(), sessionStorage: leer(), fetch: () => Promise.reject(new Error('kein Netz')), TextDecoder };
    ab.window = ab; ab.self = ab;
    vm.createContext(ab);
    for (const f of ['dsp.js', 'vowel.js', 'analysis.js', 'csv.js', 'wav.js', 'calibration.js', 'korpus.js', 'chronik.js']) vm.runInContext(quelle(f), ab, { filename: f });
    ab.VARESTORE = store; ab.VARERECORDER = { createRecorder: () => rec, listDevices: () => P([]) };
    vm.runInContext(quelle('app.js'), ab, { filename: 'app.js' });
    const st = ab.VAREAPP.state;
    for (let w = 0; w < 500 && !st.settings; w++) await new Promise(r => setTimeout(r, 2));
    // Diese Prüfung liest die Anzeige Takt für Takt; die ruhige Anzeige (Median über 0,6 s, 4×/s) prüft n_ruhig.js.
    st.settings.ruhig = false;
    el('btn-mic').click();
    for (let w = 0; w < 500 && !(rec.active && seite.raf); w++) await new Promise(r => setTimeout(r, 2));
    let jetzt = 1000;
    // Ein Takt der Live-Schleife: neue Abtastwerte melden, 41 ms weiter, tick() aufrufen.
    seite.takt = () => { rec.samplesSeen += 1000; jetzt += 41; for (const k in canv) delete canv[k]; seite.raf(jetzt); };
    seite.kachel = id => ({ klasse: el('st-' + id).className, text: el('v-' + id).textContent });
    Object.assign(seite, { ab, st, rec, ende: () => intervalle.forEach(h => clearInterval(h)) });
    return seite;
  }
  {
    /* Live: echte Rahmen des Prüftakes (alle stimmhaften) und gezielte Abwandlungen eines sauberen /a/, an
       denen genau ein Grund vorliegt. analyseAt liefert für die Dauer der Prüfung den jeweiligen Rahmen. */
    const bad = [], zaehl = {}, belege = [];
    let seite = null;
    try {
      seite = await appSeite();
      const DD = seite.ab.VAREDSP, echt = DD.analyseAt;
      const sig = DD.resample(DD.synthVowel(196, AV[0], AV[1], 0.4, 48000), 48000, DD.TARGET_SR);
      const basis = echt(sig, DD.TARGET_SR, sig.length - 1, { align: 'end', floorDb: -70 });
      if (!(basis.voiced && basis.valid.every(Boolean))) bad.push('Grundrahmen nicht sauber');
      const kopie = r => JSON.parse(JSON.stringify(r), (k, v) => v === null ? NaN : v);
      const ab5 = (r, k, feld, wert) => { const x = kopie(r); x[feld][k] = wert; x.valid[k] = false; x.slotUnsure[k] = !!x.slotGrund[k]; x.d34valid = x.valid[2] && x.valid[3]; x.d45valid = x.valid[3] && x.valid[4]; return x; };
      const faelle = R.filter(r => r.voiced).map((r, j) => ['Prüftake ' + j, r]);
      faelle.push(['nur Rauschboden F3', ab5(basis, 2, 'rauschBoden', true)]);
      faelle.push(['nur verschmolzen F4, fünf Gipfel', ab5(basis, 3, 'slotGrund', 'verschmolzen')]);
      faelle.push(['nur Nummer F2, fünf Gipfel', ab5(basis, 1, 'slotGrund', 'nummer')]);
      faelle.push(['Streuung Fenster F5', ab5(basis, 4, 'sdWin', 150)]);
      faelle.push(['Streuung Ordnungen F1', ab5(basis, 0, 'sdOrder', 140)]);
      faelle.push(['zwei Fenster F3', ab5(basis, 2, 'nWin', 2)]);
      faelle.push(['eine Ordnung F2', ab5(basis, 1, 'nOrders', 1)]);
      faelle.push(['Bandbreite F2 gültig', Object.assign(kopie(basis), { bwArtifact: [false, true, false, false, false] })]);
      for (const [name, fr] of faelle) {
        DD.analyseAt = () => fr;
        seite.takt();
        for (let k = 0; k < 5; k++) {
          const kach = seite.kachel('f' + (k + 1)), unsure = /\bunsure\b/.test(kach.klasse);
          const m = / — (.*?)(?: · |$)/.exec(kach.text), ist = m ? m[1] : '';
          const soll = fr.valid[k] ? '' : sollGruende(fr, k, false).join(', ');
          const bw = !!(fr.bwArtifact && fr.bwArtifact[k]), bwIst = /· Bandbreite unter 40 Hz/.test(kach.text);
          if (ist !== soll || unsure === !!fr.valid[k] || bw !== bwIst || /nur \d+ Resonanzen|Grund unbekannt/.test(kach.text)) {
            if (bad.length < 6) bad.push(name + ' F' + (k + 1) + ': „' + kach.text + '“ (' + kach.klasse + ') statt Gründe „' + soll + '“' + (bw ? ' mit Bandbreite' : ''));
          }
          if (!fr.valid[k]) for (const g of soll.split(', ')) { const key = g.replace(/ \d+ Hz$/, ''); zaehl[key] = (zaehl[key] || 0) + 1; }
          if (fr.slotUnsure[k] && fr.nPeaksRef === 5) zaehl['unsicher bei fünf Gipfeln'] = (zaehl['unsicher bei fünf Gipfeln'] || 0) + 1;
        }
        if (/^nur|^Streuung|^zwei|^eine|^Bandbreite/.test(name)) belege.push(name + ': ' + ['f1', 'f2', 'f3', 'f4', 'f5'].map(seite.kachel).filter(x => / — | · Bandbreite/.test(x.text)).map(x => x.text).join(' | '));
      }
      DD.analyseAt = echt;
    } catch (e) { bad.push('Ausnahme ' + String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }
    if (seite) seite.ende();
    const genug = ['Nummer mehrdeutig', 'zwei Resonanzen in einem Gipfel möglich', 'im Rauschboden', 'Streuung über Fenster', 'Streuung über Ordnungen', 'nur in 2 Fenstern', 'in weniger als 2 Ordnungen', 'unsicher bei fünf Gipfeln'].filter(g => !(zaehl[g] >= 1));
    check('I3b', 'Live: jeder ungültige Formant nennt alle zutreffenden Gründe („Nummer mehrdeutig“, „zwei Resonanzen in einem Gipfel möglich“, „im Rauschboden“, „Streuung über Fenster/Ordnungen N Hz“, „nur in 2 Fenstern“, „in weniger als 2 Ordnungen“) und bleibt in Rost; nie „nur N Resonanzen“; Bandbreite unter 40 Hz als Zusatz, gültig bleibt gültig',
      !bad.length && !genug.length, (bad.length ? bad.join(' | ') : JSON.stringify(zaehl) + ' | ' + belege.join(' | ').slice(0, 600)) + (genug.length ? ' | nicht abgedeckt: ' + genug.join(', ') : ''));
  }
  {
    // Hover im Detail: dieselben Gründe aus den Masken der Serie, ungültige Formanten und ΔF3–4 in Rost.
    const sb = { console: { log() { }, warn() { }, error() { } }, devicePixelRatio: 1 };
    sb.self = sb; sb.window = sb; vm.createContext(sb);
    for (const f of ['dsp.js', 'vowel.js', 'analysis.js', 'csv.js', 'chronik.js']) vm.runInContext(quelle(f), sb, { filename: f });
    const CHR = sb.VARECHRONIK, bad = [], zaehl = {};
    let geprueft = 0;
    /* Seit B2 trägt die Serie die Fensterzahl (nWin): „nur in 2 Fenstern“ steht dann auch neben anderen Gründen, wie
       live. Vorher schrieb dieses Kriterium die Lücke fest (ohneZaehlung für jede Serie). Eine ältere Serie ohne nWin
       wird weiter mit der alten Regel geprüft: dort nur, wenn sonst kein Grund vorliegt. */
    const ohneNWin = Object.assign({}, ser); delete ohneNWin.nWin;
    for (const [s0, ohneZ, art] of [[ser, !ser.nWin, 'Serie'], [ohneNWin, true, 'ältere Serie ohne nWin']]) {
      for (let i = 0; i < Math.min(n, R.length); i++) {
        if (!R[i].voiced) continue;
        let h = '';
        try { h = CHR.hoverText(s0, i, SMAX); } catch (e) { bad.push(art + ': Ausnahme ' + e.message); break; }
        const rost = (h.match(/<span class="rust">[^<]*<\/span>/g) || []).map(x => x.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
        for (let k = 0; k < 5; k++) {
          const kopf = 'F' + (k + 1) + ' ', teil = rost.find(x => x.startsWith(kopf));
          if (R[i].valid[k]) { if (teil) bad.push(art + ' t ' + i + ' F' + (k + 1) + ' gültig, aber Rost „' + teil + '“'); continue; }
          const soll = kopf + CHR.fmt(s0['f' + (k + 1)][i]) + '? (' + sollGruende(R[i], k, ohneZ, s0['sdw' + (k + 1)][i], s0['sdo' + (k + 1)][i], s0.teiltonHz ? s0.teiltonHz[i] : NaN).join(', ') + ')';
          if (teil !== soll) { if (bad.length < 6) bad.push(art + ' t ' + i + ': „' + teil + '“ statt „' + soll + '“'); } else geprueft++;
          if (s0 === ser) for (const g of sollGruende(R[i], k, ohneZ)) zaehl[g.replace(/ \d+ Hz$/, '')] = (zaehl[g.replace(/ \d+ Hz$/, '')] || 0) + 1;
        }
        const d34 = rost.find(x => x.startsWith('ΔF3–4 '));
        if (!!d34 !== !R[i].d34valid) bad.push(art + ' t ' + i + ': ΔF3–4 ' + (d34 ? 'in Rost, obwohl gültig' : 'ungültig ohne Rost'));
        if (/Resonanzen\]/.test(h)) bad.push(art + ' t ' + i + ': alter Zusatz „Resonanzen“');
      }
    }
    // Ältere Serie ohne Masken: Grund nicht erfunden.
    const alt = {};
    for (const k in ser) if (k !== 'slotVerschmolzen' && k !== 'rauschBoden') alt[k] = ser[k];
    const iU = R.findIndex(r => r.voiced && r.slotUnsure.some(Boolean));
    let altText = '';
    try { altText = iU >= 0 ? CHR.hoverText(alt, iU, SMAX) : ''; } catch (e) { bad.push('ältere Serie: Ausnahme ' + e.message); }
    if (iU < 0 || !/Zuordnung unsicher, Grund nicht gespeichert/.test(altText) || /Nummer mehrdeutig|zwei Resonanzen/.test(altText)) bad.push('ältere Serie: „' + altText.replace(/<[^>]+>/g, '').slice(0, 160) + '“');
    check('I3b', 'Hover (Detail): ungültige Formanten in Rost mit denselben Gründen wie live, aus den Masken der Serie (mit Fensterzahl auch „nur in 2 Fenstern“ neben anderen Gründen); ΔF3–4 ungültig in Rost; ältere Serie „Grund nicht gespeichert“ statt eines erfundenen',
      !bad.length && geprueft >= 100 && zaehl['Nummer mehrdeutig'] > 0 && zaehl['zwei Resonanzen in einem Gipfel möglich'] > 0 && zaehl['im Rauschboden'] > 0 && zaehl['nur in 2 Fenstern'] > 0,
      geprueft + ' ungültige Formanten geprüft, Gründe ' + JSON.stringify(zaehl) + (bad.length ? ' — ' + bad.join(' | ') : ''));
  }

  /* ---------- I3c: Live-Boden ohne Kalibrierung ---------- */
  /* Regel aus dem Vertrag V3 (analysis.js estimateFloor), hier unabhängig nachgebaut: Pegel sortieren; größte
     Lücke zwischen 5 % und 95 %; ab 10 dB ist der Boden der Median darunter (bekannt), sonst leisester
     Pegel − 24 (unbekannt), beides nicht unter −95; unter 10 Pegeln −70 (unbekannt). */
  function regelV3(pegel) {
    const l = pegel.filter(isFinite).sort((a, b) => a - b);
    if (l.length < 10) return { db: -70, known: false };
    const lo = Math.max(1, Math.ceil(l.length * 0.05)), hi = Math.floor(l.length * 0.95);
    let cut = -1, gap = 0;
    for (let j = lo; j <= hi; j++) if (l[j] - l[j - 1] > gap) { gap = l[j] - l[j - 1]; cut = j; }
    if (gap >= 10 && cut > 0) { const q = l.slice(0, cut), m = q.length >> 1; return { db: Math.max(-95, q.length % 2 ? q[m] : 0.5 * (q[m - 1] + q[m])), known: true }; }
    return { db: Math.max(-95, l[0] - 24), known: false };
  }
  const NZ = 5e-3;   // Raumrauschen, gleichverteilt: rund 35 dB unter dem Vokal
  const leise = (s, seed) => noise(Math.round(s * SR), NZ, seed);
  const mitNz = (x, seed) => { const z = noise(x.length, NZ, seed), y = Float64Array.from(x); for (let i = 0; i < y.length; i++) y[i] += z[i]; return y; };
  const vokal = (f0, s, env) => { const y = D.synthVowel(f0, AV[0], AV[1], s, SR); if (env) for (let i = 0; i < y.length; i++) y[i] *= Math.pow(10, env(i / SR) / 20); return y; };
  const bodenEcht = D.rmsDb(D.resample(noise(SR, NZ, 99), SR, TSR));
  /* Live-Schleife über ein Signal: je Takt 40 ms weiter. Mitgeschrieben wird je Takt der Puffer davor, der
     Boden, den app.js an analyseAt übergibt, der Rahmen und die Anzeige. */
  async function liveLauf(sig) {
    const seite = await appSeite(), DD = seite.ab.VAREDSP, echt = DD.analyseAt, out = [];
    let letzt = null;
    DD.analyseAt = function (ds, sr, idx, o) { const r = echt(ds, sr, idx, o); letzt = { r, floorDb: o.floorDb }; return r; };
    seite.quelle.sig = sig;
    for (let pos = Math.round(0.2 * 48000); pos <= sig.length; pos += 1920) {
      seite.quelle.pos = pos;
      const ring = seite.st.rmsRing.slice();
      letzt = null; seite.takt();
      if (!letzt) continue;
      out.push({ t: pos / 48000, pos, ring, floorDb: letzt.floorDb, r: letzt.r, f0: seite.kachel('f0').text, boden: seite.kachel('floor'),
        wort: seite.el('gate-state').textContent, grund: seite.el('gate-reason').textContent, pegel: (seite.canv['level-canvas'] || []).filter(o => o[0] === 'fillText').map(o => o[1][0]).join(' | '),
        striche: (seite.canv['level-canvas'] || []).filter(o => o[0] === 'moveTo').length });
    }
    DD.analyseAt = echt; seite.ende();
    return out;
  }
  // Vergleich mit dem echten Boden (wie nach einer Kalibrierung), gleicher Ausschnitt wie live.
  const referenz = (sig, pos) => { const sl = D.resample(Float32Array.from(sig.subarray(pos - 9600, pos)), 48000, TSR); return D.analyseAt(sl, TSR, sl.length - 1, { align: 'end', floorDb: bodenEcht }); };
  {
    // Decrescendo ohne Pause davor, ohne Kalibrierung: die alte Klemme verwarf live den leisen Teil als Pause.
    const sig = mitNz(concat([vokal(147, 8, t => -36 * t / 8), leise(1, 31)]), 32);
    const bad = [];
    let ref = 0, verl = 0, extra = 0, extraGueltig = 0, falschGueltig = 0, tVerl = '';
    try {
      const L = await liveLauf(sig);
      for (const e of L) {
        const k = referenz(sig, e.pos);
        if (k.voiced) ref++;
        if (k.voiced && !e.r.voiced) { verl++; if (!tVerl) tVerl = e.t.toFixed(2) + ' s'; }
        if (!k.voiced && e.r.voiced) { extra++; for (let q = 0; q < 5; q++) if (e.r.valid[q]) { extraGueltig++; if (Math.abs(e.r.F[q] - AV[0][q]) > 130) falschGueltig++; } }
        if (e.r.voiced && e.f0 === 'Pause') bad.push(e.t.toFixed(2) + ' s stimmhaft, Anzeige Pause');
      }
    } catch (e) { bad.push('Ausnahme ' + String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }
    check('I3c', 'Live ohne Kalibrierung, Decrescendo um 36 dB ohne Pause davor: kein Takt, den der echte Boden stimmhaft misst, gilt als Pause; zusätzlich stimmhafte Takte ohne falschen gültigen Formanten',
      !bad.length && ref >= 150 && verl === 0 && falschGueltig === 0,
      'stimmhaft mit echtem Boden ' + ref + ', live verloren ' + verl + (tVerl ? ' ab ' + tVerl : '') + ', zusätzlich ' + extra + ' (gültige Formanten ' + extraGueltig + ', davon > 130 Hz falsch ' + falschGueltig + ')' + (bad.length ? ' — ' + bad.slice(0, 3).join('; ') : ''));
  }
  {
    // Dieselbe Regel wie offline, Takt für Takt auf dem Puffer davor; Anzeige: geschätzt aus Stille als Zahl,
    // sonst „Stimmschwelle angenommen“ und kein Bodenwert.
    const sig = mitNz(concat([leise(1.2, 41), vokal(147, 1.5), leise(0.7, 42), vokal(196, 10.6, t => -6 * t / 10.6), leise(0.7, 43)]), 44);
    const bad = [], z = { bekannt: 0, angenommen: 0 };
    try {
      const L = await liveLauf(sig);
      for (const e of L) {
        const soll = regelV3(e.ring);
        if (!(Math.abs(e.floorDb - soll.db) < 1e-9)) { if (bad.length < 4) bad.push(e.t.toFixed(2) + ' s: Boden ' + r1(e.floorDb) + ' statt ' + r1(soll.db)); continue; }
        const fmt1 = v => v.toFixed(1);
        if (soll.known) {
          z.bekannt++;
          if (e.boden.text !== fmt1(soll.db) + ' dBFS (geschätzt aus Stille)' || !/unsure/.test(e.boden.klasse)) bad.push(e.t.toFixed(2) + ' s: „' + e.boden.text + '“');
        } else {
          z.angenommen++;
          if (e.boden.text !== 'unbekannt · Stimmschwelle angenommen: ' + fmt1(soll.db + 12) + ' dBFS' || !/unsure/.test(e.boden.klasse)) bad.push(e.t.toFixed(2) + ' s: „' + e.boden.text + '“');
        }
        if (bad.length > 4) break;
      }
    } catch (e) { bad.push('Ausnahme ' + String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }
    check('I3c', 'Live-Boden ohne Kalibrierung nach der Regel aus V3 auf dem Puffer der letzten 10 s (Takt für Takt gleich); bekannt: „geschätzt aus Stille“ mit Zahl, sonst „unbekannt · Stimmschwelle angenommen: … dBFS“ statt eines Bodenwerts',
      !bad.length && z.bekannt >= 50 && z.angenommen >= 50, JSON.stringify(z) + (bad.length ? ' — ' + bad.slice(0, 4).join('; ') : ''));
  }
  {
    // Stille ohne Kalibrierung: Mit angenommenem Boden ist „über der Schwelle“ kein „Ton“. Keine Anzeige darf
    // dann Ton behaupten; das Gatter meldet Pause, und der Pegelbalken zeigt keinen Bodenstrich.
    const sig = mitNz(leise(3, 51), 52);
    const bad = [], z = { angenommen: 0, ohnePeriode: 0 };
    let beleg = '';
    try {
      const L = await liveLauf(sig);
      for (const e of L) {
        if (e.r.voiced) bad.push(e.t.toFixed(2) + ' s stimmhaft');
        const ang = /Stimmschwelle angenommen/.test(e.boden.text);
        if (ang) z.angenommen++;
        if (e.r.tonalButAperiodic) z.ohnePeriode++;
        // Das Gatterfenster (0,3 s) ist in den ersten Takten noch nicht voll und meldet selbst Übergang.
        if (ang && (/Ton/.test(e.grund) || (e.t >= 0.8 && e.wort !== 'Pause'))) { if (bad.length < 4) bad.push(e.t.toFixed(2) + ' s: „' + e.wort + ' — ' + e.grund + '“'); }
        if (ang && (!/Boden unbekannt · Stimmschwelle angenommen/.test(e.pegel) || e.striche !== 1)) { if (bad.length < 4) bad.push(e.t.toFixed(2) + ' s Pegelbalken „' + e.pegel + '“, ' + e.striche + ' Striche'); }
        if (ang && e.r.tonalButAperiodic && !beleg) beleg = e.wort + ' — ' + e.grund;
      }
    } catch (e) { bad.push('Ausnahme ' + String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); }
    check('I3c', 'Stille ohne Kalibrierung: mit angenommenem Boden nie „Ton“, und ist das Gatterfenster voll, steht Pause statt „Übergang“; Pegelbalken nur mit der angenommenen Stimmschwelle, ohne Bodenstrich',
      !bad.length && z.angenommen >= 50 && z.ohnePeriode >= 20, JSON.stringify(z) + ' | „' + beleg + '“' + (bad.length ? ' — ' + bad.join('; ') : ''));
  }

  /* ---------- I3d: angenommene Stimmschwelle in CSV und Chronik ---------- */
  {
    const ohne = await A.analyseTake(mitNz(vokal(147, 1.0), 61), SR, {});
    const mitStille = await A.analyseTake(mitNz(concat([leise(0.4, 62), vokal(147, 1.0), leise(0.4, 63)]), 64), SR, {});
    const kal = await A.analyseTake(mitNz(vokal(147, 1.0), 61), SR, { floorDb: bodenEcht });
    // Ältere Auswertung (vor V3): ohne voicingFloorDb, die Annahme stand als floorDb da.
    const alt = JSON.parse(JSON.stringify(ohne.summary), (k, v) => v === null ? NaN : v);
    delete alt.voicingFloorDb; alt.floorDb = -61.25;
    const FAELLE = [
      ['ohne Stille', ohne.summary, NaN, ohne.summary.voicingFloorDb, 'unknown'],
      ['mit Stille', mitStille.summary, mitStille.summary.floorDb, mitStille.summary.floorDb, 'estimate'],
      ['kalibriert', kal.summary, bodenEcht, bodenEcht, 'calibration'],
      ['ältere Auswertung ohne Stille', alt, NaN, -61.25, 'unknown']
    ];
    const z2 = (v, dec) => (typeof v === 'number' && isFinite(v) ? v : -99).toFixed(dec);
    const sb = { console: { log() { }, warn() { }, error() { } }, devicePixelRatio: 1 };
    sb.self = sb; sb.window = sb; vm.createContext(sb);
    for (const f of ['dsp.js', 'vowel.js', 'analysis.js', 'csv.js', 'chronik.js']) vm.runInContext(quelle(f), sb, { filename: f });
    const CHR = sb.VARECHRONIK;
    const El = function () { this.innerHTML = ''; };
    El.prototype.querySelector = function () { return { addEventListener() { }, value: '', hidden: false, getContext: () => leinwand().cv.getContext() }; };
    El.prototype.querySelectorAll = function () { return []; };
    const kacheln = html => { const out = [], re = /<div class="stat([^"]*)"><span class="k">([\s\S]*?)<\/span><span class="v">([\s\S]*?)<\/span><\/div>/g; let m; while ((m = re.exec(html))) out.push({ klasse: m[1].trim(), k: m[2].replace(/<[^>]+>/g, ''), v: m[3].replace(/<[^>]+>/g, ''), vHtml: m[3] }); return out; };
    const badC = [], badA = [], belegeC = [], belegeA = [];
    for (const [name, su, boden, stimm, quelleSoll] of FAELLE) {
      if (su.floorSource !== quelleSoll) badC.push(name + ': Bodenquelle ' + su.floorSource + ' statt ' + quelleSoll);
      const z = zeilen(H.C.takesToCsv([{ code: 'S', summary: su }], 'standard'), ','), kopf = z[0], w = z[1] || [];
      const zelle = k => kopf.indexOf(k) < 0 ? '(fehlt)' : w[kopf.indexOf(k)];
      if (zelle('floor_dbfs') !== z2(boden, 2) || zelle('voicing_floor_dbfs') !== z2(stimm, 2) || !isFinite(stimm)) badC.push(name + ': floor_dbfs ' + zelle('floor_dbfs') + ' statt ' + z2(boden, 2) + ', voicing_floor_dbfs ' + zelle('voicing_floor_dbfs') + ' statt ' + z2(stimm, 2));
      belegeC.push(name + ' ' + zelle('floor_dbfs') + '/' + zelle('voicing_floor_dbfs'));
      let ks = [];
      try { const d = new El(); CHR.renderDetail(d, { id: 'i3', code: 'S', label: name, createdAt: '2026-03-02T09:00:00.000Z', durationS: 1.5, analysis: { kernelVersion: D.VERSION, gate: { f3MinHz: 2500 } }, summary: su }, null, {}, false, {}); ks = kacheln(d.innerHTML); }
      catch (e) { badA.push(name + ': Ausnahme ' + e.message); continue; }
      const kb = ks.find(x => /^Rauschboden/.test(x.k)) || { v: '', klasse: '?' }, ksch = ks.find(x => /^Stimmschwelle/.test(x.k));
      if (quelleSoll === 'unknown') {
        const soll = 'angenommen: ' + CHR.fmt(stimm + 12, 1) + ' dBFS';
        if (!ksch || !ksch.v.startsWith(soll) || ksch.klasse !== '' || /rust|befund/.test(ksch.vHtml)) badA.push(name + ': Stimmschwelle „' + (ksch ? ksch.v + '“ (' + ksch.klasse + ')' : 'fehlt“') + ' statt neutral „' + soll + '“');
        if (!/^– dBFS \(unbekannt/.test(kb.v) || !/nicht messbar/.test(kb.v)) badA.push(name + ': Rauschboden „' + kb.v + '“ — eine Annahme als Boden');
        belegeA.push(name + ': „' + kb.v + '“ | „' + (ksch ? ksch.k + ' ' + ksch.v : '') + '“');
      } else if (ksch) badA.push(name + ': Stimmschwelle-Kachel bei bekanntem Boden');
    }
    check('I3d', 'Take-CSV: floor_dbfs nur für einen gemessenen Boden (sonst −99, auch bei älteren Takes ohne Stille); voicing_floor_dbfs ist der Boden der Stimmhaftigkeit, gemessen oder angenommen (ältere Auswertung: deren floorDb)',
      !badC.length, (badC.length ? badC.join(' | ') : belegeC.join(' | ')));
    check('I3d', 'Chronik bei unbekanntem Boden: Rauschboden „–“ (unbekannt, SNR nicht messbar), dazu neutral „Stimmschwelle angenommen: … dBFS“ (Annahme + 12 dB, kein Rost); bei bekanntem Boden keine solche Kachel',
      !badA.length && belegeA.length === 2, (badA.length ? badA.join(' | ') : belegeA.join(' | ')));
  }
};

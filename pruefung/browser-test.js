/* VARE — Browser-Pruefung. Oeffnet die Seite in Chromium, stellt die GitHub-API nach (nur
   erfundene Daten, kein Netz, kein echtes Token) und spielt einen ganzen Durchgang durch:
   Token-Tor, Mikrofon, Kalibrierung, Take, Chronik, CSV, Sicherung, Import, Detail, Neu-Analyse,
   danach Schritt 0 über Neuladen, Löschen und neue Sitzung sowie die Einsing-Angaben, „Alles
   löschen“ mit Code-Zähler, Gerätewechsel nach der Kalibrierung und „merken“/„Token entfernen“.

     npm install -g playwright && npx playwright install chromium
     Linux:   NODE_PATH="$(npm root -g)" node pruefung/browser-test.js
     Windows: $env:NODE_PATH = (npm root -g); node pruefung\browser-test.js     (PowerShell)
   Chromium kommt aus VARE_CHROMIUM, sonst aus /opt/pw-browsers/chromium (Linux-Prüfumgebung), falls
   vorhanden, sonst aus der Playwright-Installation.

   Als Mikrofon dient eine erzeugte WAV-Datei mit bekannten Formanten; was die Seite misst,
   wird gegen diese bekannten Werte geprueft. */
// playwright-core reicht. Bei einer globalen Installation liegt es unter playwright und ist über
// NODE_PATH = npm root -g nur über dieses Paket erreichbar.
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..'), SP = fs.mkdtempSync(path.join(os.tmpdir(), 'vare-pruefung-'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown' };
const fails = [], notes = [];
function check(name, ok, detail) { (ok ? notes : fails).push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' [' + detail + ']' : '')); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' [' + detail + ']' : '')); }
// Pruefsignal erzeugen: Stille, /a/ bei G3, Stille — dieselben Formanten, die der Test erwartet.
const D = require(path.join(ROOT, 'dsp.js')), W = require(path.join(ROOT, 'wav.js'));
const WAV = path.join(SP, 'fake.wav');
{
  const sr = 48000;
  const rausch = (s, seed) => { const n = Math.round(s * sr), o = new Float64Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1664525 + 1013904223) >>> 0; o[i] = ((x / 4294967296) * 2 - 1) * 2e-4; } return o; };
  const teile = [rausch(1, 1), rausch(5, 2), D.synthVowel(196, [700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200], 3, sr, { gain: 0.3 }),
    rausch(1, 3), rausch(2, 4), D.synthVowel(196, [700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200], 4, sr, { gain: 0.3 }), rausch(3, 5)];
  let n = 0; for (const t of teile) n += t.length;
  const alles = new Float64Array(n); let o = 0; for (const t of teile) { alles.set(t, o); o += t.length; }
  fs.writeFileSync(WAV, Buffer.from(W.encode(alles, sr, 'i16')));
}

(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0].split('#')[0]));
    fs.readFile(p, (e, data) => { if (e) { res.writeHead(404); res.end('nicht da'); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
  });
  // Freier Port statt fest 8765: laufen zwei Prüfläufe gleichzeitig (zweiter Arbeitsstand), fiele
  // der zweite sonst mit EADDRINUSE aus.
  await new Promise(r => server.listen(0, r));
  const BASE = 'http://localhost:' + server.address().port;
  // Ein fest eingetragener Linux-Pfad lief unter Windows nicht. Ein gesetztes VARE_CHROMIUM ohne Datei
  // bricht ab, statt still einen anderen Browser zu nehmen.
  if (process.env.VARE_CHROMIUM && !fs.existsSync(process.env.VARE_CHROMIUM)) throw new Error('VARE_CHROMIUM: keine Datei unter ' + process.env.VARE_CHROMIUM);
  const CHROMIUM = [process.env.VARE_CHROMIUM, path.join(path.sep, 'opt', 'pw-browsers', 'chromium')].find(p => p && fs.existsSync(p));
  const startOpt = { headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-audio-capture=' + WAV, '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] };
  if (CHROMIUM) startOpt.executablePath = CHROMIUM;
  console.log('Chromium: ' + (CHROMIUM || 'aus der Playwright-Installation'));
  const browser = await chromium.launch(startOpt);
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1000, height: 1400 }, locale: 'de-DE' });
  const page = await ctx.newPage();
  const errors = [], logs = [];
  page.on('pageerror', e => errors.push(String(e && e.stack || e)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  // Rückfragen werden abgelehnt (z. B. „Audio mitsichern?“), außer der Ablauf will ausdrücklich bestätigen.
  let dialogAntwort = false;
  page.on('dialog', d => (dialogAntwort ? d.accept() : d.dismiss()));
  const TOKEN = 'github_pat_TESTTESTTESTTESTTEST';
  const KORPUS = JSON.stringify({ format: 'vare-korpus', version: 1, stand: '2026-10-03', notiz: 'Testkorpus',
    marken: { d34: [{ hz: 404, text: 'erfundener Prueftwert' }, { hz: 707 }, { hz: 1111 }] },
    gatter: { f3MinHz: 2500, spreadMaxHz: 130 } });
  const korpusRoute = route => {
    const auth = route.request().headers()['authorization'] || '';
    if (auth !== 'Bearer ' + TOKEN) { route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Bad credentials"}' }); return; }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(KORPUS, 'utf8').toString('base64'), encoding: 'base64' }) });
  };
  await ctx.route('https://api.github.com/**', korpusRoute);
  try {
    await page.goto(BASE + '/index.html#/aufnahme');
    await page.waitForFunction(() => document.getElementById('anmeldung') && !document.getElementById('anmeldung').hidden, null, { timeout: 10000 });
    check('Oeffentliche Huelle: vor der Verbindung nur die Token-Eingabe', await page.isHidden('#app') && await page.isHidden('#nav') && await page.isVisible('#token'));
    check('Huelle nennt das private Repo', (await page.textContent('#korpus-repo')).includes('vare-tools'), await page.textContent('#korpus-repo'));
    // Die Seite nennt ihre Adresse (#origin-name). Der freie Port kann selbst 404 oder 1111 enthalten
    // und täuschte dann ein Leck vor; geprüft wird deshalb der Inhalt ohne die Portnummer.
    // Ebenso die Geräte-IDs im Mikrofonmenü: Chromium vergibt je Profil zufällige 64 Hexziffern, die in etwa jedem
    // 20. Lauf „404“ enthalten (Sonde: 2 von 40 Ladevorgängen). Eine Marke stünde als Text da, nicht als solche ID.
    const port = String(server.address().port), ohnePort = (await page.content()).split(port).join('').replace(/\b[0-9a-f]{64}\b/g, '<Geräte-ID>');
    const markeBei = ['404', '1111'].map(m => ohnePort.indexOf(m) >= 0 ? m + ': …' + ohnePort.slice(Math.max(0, ohnePort.indexOf(m) - 60), ohnePort.indexOf(m) + 20).replace(/\s+/g, ' ') + '…' : '').filter(Boolean);
    check('Huelle enthaelt die Marken nicht im Quelltext', !markeBei.length, 'Port ' + port + (markeBei.length ? ' | ' + markeBei.join(' | ') : ''));
    await page.fill('#token', 'falsches-token-mit-genug-zeichen');
    await page.click('#btn-verbinden');
    await page.waitForFunction(() => (document.getElementById('anmeldung-fehler').textContent || '').length > 0, null, { timeout: 10000 });
    check('Falsches Token: Meldung, Oberflaeche bleibt zu', await page.isHidden('#app'), (await page.textContent('#anmeldung-fehler')).slice(0, 80));
    await page.fill('#token', TOKEN);
    await page.check('#token-merken');
    await page.click('#btn-verbinden');
    await page.waitForFunction(() => !document.getElementById('app').hidden, null, { timeout: 10000 });
    check('Richtiges Token: Oberflaeche erscheint', await page.isVisible('#nav'));
    check('Korpus-Stand in der Kopfzeile', /Marken/.test(await page.textContent('#korpus-stand')), await page.textContent('#korpus-stand'));
    await page.waitForFunction(() => document.getElementById('kernel-version').textContent !== '–', null, { timeout: 10000 });
    check('Seite lädt, Kern-Version sichtbar', true, await page.textContent('#kernel-version'));
    check('file://-Hinweis über http verborgen', await page.isHidden('#notice-file'));
    check('Take-Knopf ohne Mikrofon gesperrt', await page.isDisabled('#btn-take'));
    await page.click('#btn-mic');
    await page.waitForFunction(() => !document.getElementById('btn-cal').disabled, null, { timeout: 15000 });
    const micInfo = await page.textContent('#mic-info');
    check('Mikrofon läuft', /Hz/.test(micInfo), micInfo);
    // Scheitert recorder-worklet.js, fiele die Seite still auf ScriptProcessor zurück; die Kalibrierung danach
    // belegt, dass über das Worklet auch Daten ankommen.
    check('Erfassung über das AudioWorklet, nicht über den Rückfall', /AudioWorklet/.test(micInfo), micInfo);
    check('Take-Knopf ohne Kalibrierung gesperrt (Pflicht)', await page.isDisabled('#btn-take'), await page.textContent('#take-hint'));
    await page.waitForTimeout(800);
    const stateWord = await page.textContent('#gate-state');
    check('Live-Anzeige zeigt Pause in Stille', /Pause/.test(stateWord), stateWord);
    await page.click('#btn-cal');
    await page.waitForFunction(() => document.getElementById('cal-progress').hidden, null, { timeout: 25000 });
    const cal = await page.textContent('#cal-status');
    check('Kalibrierung abgeschlossen', /Kalibriert/.test(cal), cal.slice(0, 220));
    const m = /Rauschboden (-?[\d,.]+) dBFS · \/a\/ (-?[\d,.]+) dBFS · SNR ([\d,.]+) dB/.exec(cal);
    if (m) check('Kalibrierung: Boden < -55, /a/ um -19, SNR > 30', parseFloat(m[1]) < -55 && parseFloat(m[2]) > -30 && parseFloat(m[3]) > 30, m.slice(1).join(' / '));
    else check('Kalibrierung: Zahlen lesbar', false, cal);
    await page.waitForFunction(() => !document.getElementById('btn-take').disabled, null, { timeout: 5000 });
    await page.waitForTimeout(1200);
    await page.fill('#take-label', 'E2E /a/ G3');
    await page.selectOption('#take-intent', 'a');
    await page.fill('#take-comment', 'automatischer Durchlauf');
    await page.click('#btn-take');
    await page.waitForTimeout(3000);
    const live = await page.evaluate(() => ({ state: document.getElementById('gate-state').textContent, f0: document.getElementById('v-f0').textContent, f1: document.getElementById('v-f1').textContent, f3: document.getElementById('v-f3').textContent, d34: document.getElementById('v-d34').textContent, ref: document.getElementById('live-ref').textContent, sfr: document.getElementById('v-sfr').textContent, shr: document.getElementById('v-shr').textContent, floor: document.getElementById('v-floor').textContent }));
    check('Live während /a/: stimmhaft, F0 ≈ 196', /19[4-8]/.test(live.f0), JSON.stringify(live));
    // Nur „<Zahl> Hz gewertet“ zählt; /gewertet/ allein traf auch „— nicht gewertet: …“ und prüfte nichts.
    check('Live: Gatter stabil /a/ und ΔF3–4 gewertet', /stabil \/a\//.test(live.state) && /^\s*-?\d[\d.,]* Hz gewertet\s*$/.test(live.d34), live.state + ' | ' + live.d34);
    await page.screenshot({ path: path.join(SP, 'shot-live.png'), fullPage: true });
    await page.waitForTimeout(3500);
    await page.click('#btn-take');
    // Während der Analyse schon den nächsten Take beschriften: das gehört nicht in diesen Take.
    const busyBeiEingabe = await page.evaluate(() => VAREAPP.state.busy);
    await page.fill('#take-label', 'NAECHSTER');
    await page.selectOption('#take-intent', 'i');
    await page.fill('#take-comment', 'fuer den naechsten Take');
    // Nur aussagekräftig, wenn die Analyse nach der letzten Eingabe noch lief.
    const busyNachEingabe = await page.evaluate(() => VAREAPP.state.busy);
    await page.waitForFunction(() => document.querySelector('#take-result .notice'), null, { timeout: 180000 });
    const result = await page.textContent('#take-result');
    check('Take analysiert und gespeichert', /Gespeichert als/.test(result), result.replace(/\s+/g, ' ').slice(0, 300));
    const takes = await page.evaluate(() => VARESTORE.allTakes());
    check('IndexedDB: 1 Take', takes.length === 1, String(takes.length));
    const felder = [await page.inputValue('#take-label'), await page.inputValue('#take-intent'), await page.inputValue('#take-comment')].join('|');
    check('Eingabe während der Analyse: Take behält Bezeichnung, Vokalabsicht, Kommentar; die neuen bleiben für den nächsten',
      busyBeiEingabe === true && busyNachEingabe === true && takes[0] && takes[0].label === 'E2E /a/ G3' && takes[0].vowelIntent === 'a' && takes[0].comment === 'automatischer Durchlauf' && felder === 'NAECHSTER|i|fuer den naechsten Take',
      'Analyse lief vor/nach der Eingabe=' + busyBeiEingabe + '/' + busyNachEingabe + ' | gespeichert ' + (takes[0] && [takes[0].label, takes[0].vowelIntent, takes[0].comment].join('|')) + ' | Felder ' + felder);
    check('Schritt 0 gleich nach dem Take: nächster Take ist Nummer 2', (await page.textContent('#ctx-position')) === '2', await page.textContent('#ctx-position'));
    const s = takes[0] && takes[0].summary;
    if (s) {
      check('Take: F1..F3 innerhalb 100 Hz von 700/1200/2500', Math.abs(s.F[0].med - 700) < 100 && Math.abs(s.F[1].med - 1200) < 100 && Math.abs(s.F[2].med - 2500) < 100, s.F.map(f => Math.round(f.med)).join(' '));
      check('Take: ΔF3–4 stabil vorhanden, 800 ± 120', s.d34stable.n > 0 && Math.abs(s.d34stable.med - 800) < 120, Math.round(s.d34stable.med) + ' n=' + s.d34stable.n);
      check('Take: Rauschboden aus Kalibrierung', s.floorSource === 'calibration', s.floorSource + ' ' + s.floorDb.toFixed(1));
      check('Take: Vokal a dominant, Bestsegment', s.vowel.dominant === 'a' && s.best && s.best.cls === 'a', JSON.stringify(s.best));
    }
    const hasAudio = await page.evaluate(id => VARESTORE.hasAudio(id), takes[0].id);
    check('Audio (WAV) mitgespeichert', hasAudio === true);
    await page.screenshot({ path: path.join(SP, 'shot-result.png'), fullPage: true });
    // Prüfsignal
    await page.click('#btn-pruef');
    await page.waitForFunction(() => document.querySelector('#pruef-out table'), null, { timeout: 120000 });
    const pruef = await page.textContent('#pruef-out');
    check('Prüfsignal: Tabelle, keine gerissene Grenze', !(await page.$('#pruef-out td.rust')), pruef.replace(/\s+/g, ' ').slice(0, 200));
    // Chronik
    await page.goto(BASE + '/index.html#/chronik');
    await page.waitForFunction(() => document.querySelector('#takes-list table'), null, { timeout: 10000 });
    check('Chronik zeigt Take', (await page.$$('#takes-list tr[data-id]')).length === 1);
    check('Referenz /a/ gesetzt', /\/a\//.test(await page.textContent('#refs-table')), (await page.textContent('#refs-table')).replace(/\s+/g, ' ').slice(0, 120));
    check('Speicherangabe sichtbar', /Takes/.test(await page.textContent('#chronik-storage')), await page.textContent('#chronik-storage'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-csv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    check('CSV-Export: Kopf mit code,label und eine Zeile', /^code,label/.test(csv) && csv.trim().split('\n').length === 2, csv.split('\n')[1].slice(0, 120));
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-json')]);
    const json = fs.readFileSync(await dl2.path(), 'utf8');
    check('JSON-Sicherung: format vare-backup mit Serie', /"format":"vare-backup"/.test(json) && /"series":\{/.test(json), (json.length / 1000).toFixed(0) + ' kB');
    fs.writeFileSync(path.join(SP, 'backup.json'), json);
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btn-import-json')]);
    await fc.setFiles(path.join(SP, 'backup.json'));
    await page.waitForFunction(() => /Import:/.test((document.querySelector('[role=status]') || {}).textContent || ''), null, { timeout: 10000 });
    check('Import derselben Sicherung: übersprungen', /0 Takes übernommen, 1 schon vorhanden/.test(await page.textContent('[role=status]')), await page.textContent('[role=status]'));
    await page.screenshot({ path: path.join(SP, 'shot-chronik.png'), fullPage: true });
    // Detail
    await page.click('#takes-list a[href^="#/take/"]');
    await page.waitForFunction(() => document.getElementById('d-lanes'), null, { timeout: 10000 });
    await page.waitForTimeout(500);
    // Ins Bild holen: Wie weit unten die Spuren liegen, hängt an der Höhe der Kacheln darüber (z. B. ein
    // Anteil unsicherer Grundtonrahmen im Take). Sonst ginge die Maus womöglich unter den Fensterrand.
    const box = await page.$eval('#d-lanes', c => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await page.mouse.move(box.x + box.w * 0.5, box.y + 200);
    await page.waitForTimeout(200);
    const hover = await page.textContent('#d-hover');
    check('Detail: Hover-Ablesung mit F0 und F1', /F0/.test(hover) && /F1/.test(hover), hover.slice(0, 160));
    const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('#d-frames')]);
    const fcsv = fs.readFileSync(await dl3.path(), 'utf8');
    check('Rahmen-CSV: Kopf t_s und > 100 Zeilen', /^t_s,voiced,gate/.test(fcsv) && fcsv.trim().split('\n').length > 100, fcsv.trim().split('\n').length + ' Zeilen');
    await page.click('#d-re');
    await page.waitForFunction(() => /Neu analysiert/.test((document.querySelector('[role=status]') || {}).textContent || ''), null, { timeout: 180000 });
    await page.waitForTimeout(500);
    const t2 = await page.evaluate(() => VARESTORE.allTakes());
    // Die Historie trägt { analysis, summary }; der Kern steht in analysis.
    check('Neu-Analyse: Historie hat einen Eintrag', t2[0].history && t2[0].history.length === 1, JSON.stringify(t2[0].history && t2[0].history.map(h => h.analysis && h.analysis.kernelVersion)));
    await page.waitForFunction(() => /Frühere Auswertungen/.test(document.getElementById('take-detail').textContent), null, { timeout: 10000 }).catch(() => { });
    const frueher = ((await page.textContent('#take-detail')).match(/Frühere Auswertungen:[^\n]*/) || [''])[0].trim();
    check('Neu-Analyse: Detail nennt die frühere Auswertung mit Kern und Zeitpunkt', /^Frühere Auswertungen: \d+\.\d+\.\d+ \(\d+\.\d+\. \d\d:\d\d\)/.test(frueher), frueher);
    await page.screenshot({ path: path.join(SP, 'shot-detail.png'), fullPage: true });
    // Einstellungen: Regler ändern und Reload
    await page.goto(BASE + '/index.html#/aufnahme');
    await page.waitForFunction(() => document.getElementById('s-f3MinHz'), null, { timeout: 10000 });
    await page.$eval('#s-f3MinHz', el => { el.value = '2700'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(600);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('app').hidden, null, { timeout: 15000 });
    check('Gemerktes Token verbindet nach dem Neuladen von selbst', await page.isVisible('#nav'));
    check('Einstellung bleibt nach Neuladen', (await page.$eval('#s-f3MinHz', el => el.value)) === '2700');
    // Zugänglichkeit: Bedienelemente ≥ 46 px
    const small = await page.$$eval('button, select, input[type=text], input[type=range]', els => els.filter(e => !e.hidden && e.offsetParent !== null && e.getBoundingClientRect().height < 46).map(e => e.id || e.textContent.trim().slice(0, 20)));
    check('Alle sichtbaren Bedienelemente ≥ 46 px hoch', small.length === 0, small.join(', '));

    // ---------- Schritt 0 über Neuladen, Löschen und neue Sitzung; Einsing-Angaben ----------
    async function mikrofonUndKalibrieren() {
      await page.click('#btn-mic');
      await page.waitForFunction(() => !document.getElementById('btn-cal').disabled, null, { timeout: 15000 });
      await page.waitForTimeout(800);
      return kalibrieren();
    }
    async function kalibrieren() {
      // Die Prüfdatei läuft in Schleife; trifft die Kalibrierung den Vokal nicht, nochmals.
      for (let v = 0; v < 4; v++) {
        await page.click('#btn-cal');
        await page.waitForFunction(() => document.getElementById('cal-progress').hidden, null, { timeout: 30000 });
        if (/^Kalibriert/.test((await page.textContent('#cal-status')).trim())) return true;
        await page.waitForTimeout(1500);
      }
      return false;
    }
    async function takeAufnehmen(ms, waehrend) {
      await page.waitForFunction(() => !document.getElementById('btn-take').disabled, null, { timeout: 20000 });
      const vorher = (await page.evaluate(() => VARESTORE.allTakes())).map(t => t.id);
      await page.click('#btn-take'); await page.waitForTimeout(ms); await page.click('#btn-take');
      if (waehrend) await waehrend();
      await page.waitForFunction(() => !VAREAPP.state.busy && document.querySelector('#take-result .notice, #take-result button'), null, { timeout: 180000 });
      return (await page.evaluate(() => VARESTORE.allTakes())).find(t => !vorher.includes(t.id)) || null;
    }
    // Die Seite ist eben neu geladen; in der Sitzung liegt Take A an Position 1.
    await page.waitForFunction(() => document.getElementById('ctx-position').textContent !== '–', null, { timeout: 5000 }).catch(() => { });
    const tA = (await page.evaluate(() => VARESTORE.allTakes()))[0];
    const anzReload = { pos: await page.textContent('#ctx-position'), pause: await page.textContent('#ctx-pause') };
    check('Neuladen: Schritt 0 zeigt nächste Nummer 2 und eine Pause, nicht „erster Take“', anzReload.pos === '2' && !/erster Take/.test(anzReload.pause), JSON.stringify(anzReload));
    check('Neuladen: Mikrofon und Kalibrierung', await mikrofonUndKalibrieren(), (await page.textContent('#cal-status')).slice(0, 80));
    // Einsing-Status eintragen und die Eingabe um 30 min zurückdatieren: der Take muss 45 min tragen.
    await page.selectOption('#ctx-warmup', 'voll');
    await page.fill('#ctx-warmup-min', '15'); await page.press('#ctx-warmup-min', 'Tab');
    await page.evaluate(() => { VAREAPP.state.sitzung.warmupMinAt -= 30 * 60000; });
    await page.fill('#take-label', 'E2E B');
    const tB = await takeAufnehmen(2500);
    check('Neuladen: Take B an Position 2, Pause > 0, selbe Sitzung wie A',
      !!tB && tB.sitzung.position === 2 && tB.sitzung.pauseVorherS > 0 && tB.sitzung.pauseSelbeSitzung === true && tB.sitzung.id === tA.sitzung.id,
      tB ? JSON.stringify({ position: tB.sitzung.position, pause: tB.sitzung.pauseVorherS, gleich: tB.sitzung.pauseSelbeSitzung, sitzungWieA: tB.sitzung.id === tA.sitzung.id }) : 'kein Take');
    check('Einsing-Minuten laufen mit: 15 min eingetragen, 30 min zurückdatiert, Take B trägt 45 min',
      !!tB && tB.sitzung.warmup === 'voll' && tB.sitzung.warmupMin >= 44.9 && tB.sitzung.warmupMin <= 46, tB ? tB.sitzung.warmup + ' ' + tB.sitzung.warmupMin : 'kein Take');
    // Take A löschen: der nächste Take darf nicht wieder die 2 bekommen.
    await page.evaluate(() => { location.hash = '#/chronik'; });
    await page.waitForSelector('#takes-list tr[data-id="' + tA.id + '"]', { timeout: 10000 });
    dialogAntwort = true;
    await page.click('#takes-list tr[data-id="' + tA.id + '"] button[data-act="del"]');
    await page.waitForFunction(id => !document.querySelector('#takes-list tr[data-id="' + id + '"]'), tA.id, { timeout: 10000 });
    dialogAntwort = false;
    await page.evaluate(() => { location.hash = '#/aufnahme'; });
    await page.waitForTimeout(300);
    const anzLoeschen = await page.textContent('#ctx-position');
    // Take C; während seiner Analyse „Neue Sitzung beginnen“.
    let busyC = null;
    // Klick im Seitenkontext: page.click wartet auf ruhige Animationsframes und käme so womöglich
    // erst nach der Analyse an. busy wird im selben Schritt gelesen, also sicher während der Analyse.
    const tC = await takeAufnehmen(2500, async () => { busyC = await page.evaluate(() => { const b = VAREAPP.state.busy; document.getElementById('btn-neue-sitzung').click(); return b; }); });
    check('Löschen: Anzeige und Take C bekommen 3, keine Position doppelt',
      anzLoeschen === '3' && !!tC && tC.sitzung.position === 3 && tC.sitzung.position !== tB.sitzung.position, 'Anzeige ' + anzLoeschen + ', C ' + (tC && tC.sitzung.position) + ', B ' + tB.sitzung.position);
    check('„Neue Sitzung“ während der Analyse: Take C behält Kalibrierung und Sitzung seiner Aufnahme',
      busyC === true && !!tC && !!tC.calibrationId && tC.summary.floorSource === 'calibration' && tC.sitzung.id === tA.sitzung.id,
      'Analyse lief=' + busyC + ' | ' + (tC ? 'calibrationId=' + tC.calibrationId + ' floorSource=' + tC.summary.floorSource + ' Sitzung ' + tC.sitzung.nr : 'kein Take'));
    check('Nach „Neue Sitzung“: Take-Knopf gesperrt bis zur Kalibrierung, nächste Nummer 1',
      await page.isDisabled('#btn-take') && (await page.textContent('#ctx-position')) === '1', await page.textContent('#take-hint'));
    // Über drei Stunden weder Take noch Eingabe: alles um 4 h zurückdatieren und neu laden.
    await page.selectOption('#ctx-warmup', 'voll');
    await page.fill('#ctx-warmup-min', '20'); await page.press('#ctx-warmup-min', 'Tab');
    await page.evaluate(async () => {
      const vier = 4 * 3600e3, s = VAREAPP.state.sitzung, frueher = iso => new Date(Date.parse(iso) - vier).toISOString();
      s.warmupMinAt -= vier; s.warmupAngabeAt -= vier; if (s.letztesEnde) s.letztesEnde = frueher(s.letztesEnde);
      await VARESTORE.setMeta('sitzung', s);
      for (const t of await VARESTORE.allTakes()) { t.createdAt = frueher(t.createdAt); await VARESTORE.putTake(t); }
    });
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('app').hidden, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const ein = { status: await page.inputValue('#ctx-warmup'), min: await page.inputValue('#ctx-warmup-min'), hinweis: (await page.isVisible('#ctx-hinweis')) ? await page.textContent('#ctx-hinweis') : '' };
    check('Über 3 h ohne Take und Eingabe: Einsing-Angaben nach dem Neuladen leer, Hinweis auf neue Sitzung', ein.status === '' && ein.min === '' && /neue Sitzung/.test(ein.hinweis), JSON.stringify(ein));
    await page.screenshot({ path: path.join(SP, 'shot-schritt0.png'), fullPage: true });

    // ---------- „Alles löschen“: Kalibrierung mitgelöscht, Code-Zähler bleibt ----------
    const statusText = () => page.evaluate(() => (document.querySelector('[role=status]') || {}).textContent || '');
    check('Vor dem Löschen: Mikrofon und Kalibrierung', await mikrofonUndKalibrieren(), (await page.textContent('#cal-status')).slice(0, 80));
    await page.evaluate(() => { location.hash = '#/chronik'; });
    await page.waitForSelector('#btn-clear-all', { state: 'visible' });
    const codesVorher = (await page.evaluate(() => VARESTORE.allTakes())).map(t => t.code).sort();
    dialogAntwort = true;
    await page.click('#btn-clear-all');
    await page.waitForFunction(() => /Chronik gelöscht/.test((document.querySelector('[role=status]') || {}).textContent || ''), null, { timeout: 10000 });
    dialogAntwort = false;
    await page.evaluate(() => { location.hash = '#/aufnahme'; });
    await page.waitForTimeout(300);
    check('Nach „Alles löschen“: Take-Knopf gesperrt, bis neu kalibriert ist', await page.isDisabled('#btn-take'), await page.textContent('#take-hint'));
    /* Die Prüfdatei läuft in Schleife; mit weiterlaufendem Mikrofon begann die Kalibrierung an einer zufälligen Stelle
       darin, und alle vier Versuche konnten das /a/ verfehlen (I3: 4 von 11 Läufen; hier 2 von 3). Neu gestartet
       beginnt die Datei vorn wie bei jeder anderen Kalibrierung dieses Durchgangs. Geprüft bleibt, dass nach dem
       Löschen neu kalibriert werden muss (Prüfung davor) und kann. */
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.getElementById('btn-mic').textContent === 'Mikrofon starten', null, { timeout: 10000 });
    check('Nach „Alles löschen“ neu kalibriert', await mikrofonUndKalibrieren(), (await page.textContent('#cal-status')).slice(0, 80));
    const tD = await takeAufnehmen(2500);
    // backup.json stammt vom Anfang und enthält Take A.
    await page.evaluate(() => { location.hash = '#/chronik'; });
    await page.waitForSelector('#btn-import-json', { state: 'visible' });
    const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btn-import-json')]);
    await fc2.setFiles(path.join(SP, 'backup.json'));
    await page.waitForFunction(() => /Import: 1 Takes übernommen/.test((document.querySelector('[role=status]') || {}).textContent || ''), null, { timeout: 10000 });
    const codesNachher = (await page.evaluate(() => VARESTORE.allTakes())).map(t => t.code).sort();
    check('„Alles löschen“, neuer Take, alte Sicherung eingespielt: Codes laufen weiter, keiner doppelt',
      !!tD && tD.code === 'D' && new Set(codesNachher).size === codesNachher.length,
      'vor dem Löschen ' + codesVorher.join(',') + ' | neuer Take ' + (tD && tD.code) + ' | nach dem Import ' + codesNachher.join(',') + ' | ' + await statusText());

    // ---------- „Alle neu analysieren“: D hat Audio, der importierte A nicht. Beide gelten als „Kern 3.0.0“. ----------
    // Fehlt der Knopf oder wirft ein Schritt, reißen beide Prüfungen, und der Durchgang läuft weiter.
    const ALLE_NAMEN = ['Alle neu analysieren im Browser: Abbrechen mitten im Take lässt ihn unverändert und sagt es',
      'Alle neu analysieren im Browser: Take mit Audio mit dem jetzigen Kern, Historie „3.0.0“; Take ohne Audio genannt und weiter anders gerechnet; Fortschritt mit Rahmen und Abbrechen-Knopf sichtbar'];
    const alleErledigt = [], alleCheck = (k, ok, d) => { alleErledigt.push(k); check(ALLE_NAMEN[k], ok, d); };
    try {
      if (!(await page.$('#btn-reanalyse-all'))) throw new Error('Knopf „Alle neu analysieren“ fehlt');
      const tAimp = (await page.evaluate(() => VARESTORE.allTakes())).find(t => t.code === 'A');
      await page.evaluate(async () => { for (const t of await VARESTORE.allTakes()) { t.analysis.kernelVersion = '3.0.0'; await VARESTORE.putTake(t); } VAREAPP.refreshChronik(); });
      await page.waitForFunction(() => document.querySelectorAll('#takes-list tr[data-id]').length === 2, null, { timeout: 10000 });
      // Fortschritt mitschreiben; im ersten Lauf nach dem ersten Block abbrechen (im selben Schritt wie die Anzeige, also sicher mitten im Take).
      await page.evaluate(() => {
        window.__fortschritt = []; window.__abbrechenBei = true;
        new MutationObserver(() => {
          const t = document.getElementById('reanalyse-all-text').textContent, m = /— (\d+) \/ (\d+) Rahmen$/.exec(t);
          window.__fortschritt.push({ t, abbrechenSichtbar: !document.getElementById('btn-reanalyse-abbruch').hidden });
          if (window.__abbrechenBei && m && +m[1] < +m[2]) { window.__abbrechenBei = false; document.getElementById('btn-reanalyse-abbruch').click(); }
        }).observe(document.getElementById('reanalyse-all'), { childList: true, characterData: true, subtree: true });
      });
      const reText = () => page.textContent('#reanalyse-all-text');
      dialogAntwort = true;
      await page.click('#btn-reanalyse-all');
      await page.waitForFunction(() => !VAREAPP.state.busy && /^Neu-Analyse abgebrochen/.test(document.getElementById('reanalyse-all-text').textContent), null, { timeout: 120000 });
      const nachAbbruch = await page.evaluate(id => VARESTORE.getTake(id).then(t => ({ kern: t.analysis.kernelVersion, hist: (t.history || []).length })), tD.id);
      alleCheck(0,
        nachAbbruch.kern === '3.0.0' && nachAbbruch.hist === (tD.history || []).length && /0 von 1 Takes/.test(await reText()) && /1 unverändert: D /.test(await reText()),
        JSON.stringify(nachAbbruch) + ' | „' + await reText() + '“');
      await page.click('#btn-reanalyse-all');
      await page.waitForFunction(() => !VAREAPP.state.busy && /^Alle neu analysiert/.test(document.getElementById('reanalyse-all-text').textContent), null, { timeout: 120000 });
      dialogAntwort = false;
      const nachLauf = await page.evaluate(() => VARESTORE.allTakes().then(ts => ts.map(t => ({ code: t.code, kern: t.analysis.kernelVersion, hist: (t.history || []).map(h => h.analysis && h.analysis.kernelVersion) }))));
      const fortschritt = await page.evaluate(() => window.__fortschritt);
      await page.waitForFunction(() => /Alle neu analysiert/.test(document.getElementById('reanalyse-all-text').textContent) && document.querySelectorAll('#takes-list tr[data-id]').length === 2, null, { timeout: 10000 });
      const zeilenUv = await page.$$eval('#takes-list tr[data-id]', trs => trs.map(tr => tr.querySelector('strong').textContent + (/anders gerechnet/.test(tr.textContent) ? ':anders' : ':gleich')).sort().join(' '));
      const dNeu = nachLauf.find(t => t.code === 'D') || {}, aNeu = nachLauf.find(t => t.code === 'A') || {};
      alleCheck(1,
        dNeu.kern === D.VERSION && dNeu.hist && dNeu.hist[dNeu.hist.length - 1] === '3.0.0' && aNeu.kern === '3.0.0' && !!tAimp && aNeu.hist.length === (tAimp.history || []).length
        && new RegExp('Ohne Audio, nicht neu zu rechnen: A .*bleiben anders gerechnet: A .*Kern 3\\.0\\.0 statt').test(await reText()) && zeilenUv === 'A:anders D:gleich'
        && fortschritt.some(f => /^Neu-Analyse 1 von 1: D .* — \d+ \/ \d+ Rahmen$/.test(f.t) && f.abbrechenSichtbar) && await page.isHidden('#btn-reanalyse-abbruch') && await page.isEnabled('#btn-reanalyse-all'),
        JSON.stringify(nachLauf) + ' | Liste ' + zeilenUv + ' | „' + await reText() + '“ | ' + fortschritt.length + ' Fortschrittszeilen');
    } catch (e) { ALLE_NAMEN.forEach((n, k) => { if (alleErledigt.indexOf(k) < 0) check(n, false, 'Ausnahme: ' + String(e && e.message || e).split('\n')[0]); }); }
    dialogAntwort = false;

    // ---------- Gerätewechsel nach der Kalibrierung ----------
    await page.evaluate(() => { location.hash = '#/aufnahme'; });
    await page.waitForSelector('#btn-mic', { state: 'visible' });
    await page.click('#btn-mic');
    await page.waitForFunction(() => document.getElementById('btn-mic').textContent === 'Mikrofon starten', null, { timeout: 10000 });
    const geraete = await page.$$eval('#mic-device option', os => os.map(o => ({ v: o.value, t: o.textContent })));
    const anderes = geraete.find(o => o.v && o.v !== 'default' && !/Default/.test(o.t));
    await page.selectOption('#mic-device', anderes.v);
    await page.click('#btn-mic');
    await page.waitForFunction(() => !document.getElementById('btn-cal').disabled, null, { timeout: 15000 });
    await page.waitForTimeout(800);
    const g = { gesperrt: await page.isDisabled('#btn-take'), boden: await page.textContent('#v-floor'), klasse: await page.getAttribute('#st-floor', 'class'), warnung: await page.textContent('#cal-warnings'), id: await page.evaluate(() => VAREAPP.state.cal) };
    check('Anderes Gerät nach der Kalibrierung: Take gesperrt, Rauschboden nicht „kalibriert“ und in Rost, Wechsel benannt',
      g.gesperrt && g.id === null && !/kalibriert/.test(g.boden) && /unsure/.test(g.klasse) && /anderes Gerät/.test(g.warnung), JSON.stringify(g));

    // ---------- Live: Grundton- und SHR-Unsicherheit in Rost, Korrektur ohne Rost (Farben aus dem Browser) ----------
    // Das Mikrofon läuft noch. analyseAt liefert für die Dauer der Prüfung einen echten Rahmen eines sauberen
    // /a/ bei 196 Hz, in dem nur die Felder gesetzt sind, wie der Kern sie meldet (null steht für NaN).
    const ROST_L = 'rgb(168, 90, 60)', GOLD_L = 'rgb(201, 162, 39)';
    const liveFall = a => page.evaluate(async a => {
      const D = window.VAREDSP;
      if (!window.__echteAnalyse) window.__echteAnalyse = D.analyseAt;
      const sig = D.resample(D.synthVowel(196, [700, 1200, 2500, 3300, 4200], [80, 90, 120, 150, 200], 0.4, 48000), 48000, D.TARGET_SR);
      const fr = Object.assign({}, window.__echteAnalyse(sig, D.TARGET_SR, sig.length - 1, { align: 'end', wantSpectrum: true, floorDb: -70 }), a);
      for (const k in a) if (a[k] === null) fr[k] = NaN;
      D.analyseAt = () => fr;
      await new Promise(r => setTimeout(r, 400));
      const kachel = id => { const st = document.getElementById('st-' + id), v = document.getElementById('v-' + id), sp = v.querySelector('.unsicher-teil');
        return { klasse: st.className, text: v.textContent, farbe: getComputedStyle(v).color, teil: sp ? { text: sp.textContent, farbe: getComputedStyle(sp).color } : null }; };
      return { f0: kachel('f0'), f1: kachel('f1'), shr: kachel('shr'), h1h2: kachel('h1h2') };
    }, a);
    const lU = await liveFall({ f0Unsure: true, f0Grund: 'cepstrum', f0Cep: 98, shrUnsure: true, shrGrund: 'grundton', shrOther: null });
    const lK = await liveFall({ f0Korrektur: 'teiltonreihe', f0Yin: 98 });
    const lS = await liveFall({ shr: -10, shrGrid: 392, shrOther: -48.7, shrUnsure: true, shrGrund: 'kamm+zweitpuls', shrKamm: -10.1, shrZweitpuls: 0.79 });
    const lW = await liveFall({ shr: -10, shrUnsure: false, shrOther: null, shrGrund: '' });
    await page.evaluate(() => { window.VAREDSP.analyseAt = window.__echteAnalyse; });
    check('Live im Browser: unsicherer Grundton in Rost mit Grund (auch SHR und H1−H2), F1/F0 als Teil in Rost neben schwarzem F1; korrigierter Grundton ohne Rost',
      lU.f0.farbe === ROST_L && /Grundton unsicher: Cepstrum zeigt 98\.0 Hz/.test(lU.f0.text) && lU.shr.farbe === ROST_L && lU.h1h2.farbe === ROST_L
      && !!lU.f1.teil && lU.f1.teil.farbe === ROST_L && lU.f1.farbe !== ROST_L && lK.f0.farbe !== ROST_L && /korrigiert aus 98\.0 Hz, Teiltonreihe/.test(lK.f0.text),
      JSON.stringify({ unsicher: lU.f0, f1: lU.f1, korrigiert: lK.f0 }).replace(/rgb\(168, 90, 60\)/g, 'ROST'));
    check('Live im Browser: SHR-Raster zweifelhaft → beide Werte mit Raster in Rost, keine Warnung; sicheres SHR −10 dB in Gold',
      lS.shr.farbe === ROST_L && !/befund/.test(lS.shr.klasse) && /-10\.0 dB \(Raster 392 Hz\) · -48\.7 dB \(Raster 196 Hz\)/.test(lS.shr.text) && lW.shr.farbe === GOLD_L,
      JSON.stringify({ zweifel: lS.shr, sicher: lW.shr }).replace(/rgb\(168, 90, 60\)/g, 'ROST').replace(/rgb\(201, 162, 39\)/g, 'GOLD'));

    // ---------- Token: „merken“ und „Token entfernen“ in einem frischen Browserprofil ----------
    const ctx2 = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1000, height: 1400 }, locale: 'de-DE' });
    await ctx2.route('https://api.github.com/**', korpusRoute);
    const p2 = await ctx2.newPage();
    p2.on('pageerror', e => errors.push(String(e && e.stack || e)));
    await p2.goto(BASE + '/index.html#/aufnahme');
    await p2.waitForFunction(() => !document.getElementById('anmeldung').hidden, null, { timeout: 10000 });
    await p2.fill('#token', TOKEN); await p2.uncheck('#token-merken'); await p2.click('#btn-verbinden');
    await p2.waitForFunction(() => !document.getElementById('app').hidden, null, { timeout: 10000 });
    await p2.reload();
    await p2.waitForFunction(() => !document.getElementById('app').hidden, null, { timeout: 15000 });
    const ablage = await p2.evaluate(() => ({ lokal: localStorage.getItem('vare-token'), tab: !!sessionStorage.getItem('vare-token'), haken: document.getElementById('token-merken').checked }));
    check('Token nur für diesen Tab: nach dem Neuladen verbunden, „merken“ nicht angehakt', ablage.lokal === null && ablage.tab && ablage.haken === false, JSON.stringify(ablage));
    await p2.click('#btn-mic');
    await p2.waitForFunction(() => !document.getElementById('btn-cal').disabled, null, { timeout: 15000 });
    await p2.click('#btn-abmelden');
    await p2.waitForFunction(() => !document.getElementById('anmeldung').hidden, null, { timeout: 10000 });
    check('„Token entfernen“: Korpus-Kopfzeile leer', (await p2.textContent('#korpus-stand')) === '', await p2.textContent('#korpus-stand'));
    await p2.fill('#token', TOKEN); await p2.click('#btn-verbinden');
    await p2.waitForFunction(() => !document.getElementById('app').hidden, null, { timeout: 10000 });
    const neu = await p2.evaluate(() => ({ lokal: localStorage.getItem('vare-token'), knopf: document.getElementById('btn-mic').textContent, mic: VAREAPP.state.rec.active, kalibrieren: document.getElementById('btn-cal').disabled }));
    check('Erneut verbunden, Haken nicht angefasst: Token nicht im localStorage; Mikrofon aus, Knopf sagt „Mikrofon starten“',
      neu.lokal === null && neu.knopf === 'Mikrofon starten' && !neu.mic && neu.kalibrieren, JSON.stringify(neu));
    await ctx2.close();

    // ---------- Aufnahme vor der Analyse gesichert, Neuladen mitten in der Analyse, Datenbank Version 1 → 2 ----------
    // Wirft ein Schritt (fehlt etwa die Anzeige), reißen die offenen Prüfungen dieses Abschnitts, und der Durchgang läuft weiter.
    const NEULADEN_NAMEN = ['Datenbank Version 1 → 2: die vorhandene Chronik bleibt, der Laden für unvollendete Analysen ist da',
      'Neuladen während der Analyse: Aufnahme vor der Analyse in IndexedDB, Rückfrage beim Verlassen, danach als unvollendete Analyse angeboten',
      'Fortsetzen nach dem Neuladen: derselbe Take mit Bezeichnung, Stelle in der Sitzung, WAV und Rahmenverlauf; nichts mehr offen'];
    const neuladenErledigt = [], neuladenCheck = (k, ok, d) => { neuladenErledigt.push(k); check(NEULADEN_NAMEN[k], ok, d); };
    let ctx4 = null;
    try {
      ctx4 = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1000, height: 1400 }, locale: 'de-DE' });
      await ctx4.route('https://api.github.com/**', korpusRoute);
      const p4 = await ctx4.newPage();
      p4.on('pageerror', e => errors.push(String(e && e.stack || e)));
      // Rückfragen beim Verlassen werden mitgeschrieben und abgelehnt, außer der Ablauf erlaubt das Verlassen ausdrücklich.
      const dialoge = []; let verlassenErlaubt = false;
      p4.on('dialog', d => { dialoge.push(d.type()); if (d.type() === 'beforeunload' && verlassenErlaubt) d.accept(); else d.dismiss(); });
      // Eine Chronik der Datenbankversion 1 (vor dem Laden pending) unter derselben Adresse anlegen.
      await p4.goto(BASE + '/README.md');
      await p4.evaluate(() => new Promise((ok, fehler) => {
        const r = indexedDB.open('vare', 1);
        r.onupgradeneeded = () => { const db = r.result, t = db.createObjectStore('takes', { keyPath: 'id' }); t.createIndex('createdAt', 'createdAt'); t.createIndex('code', 'code'); db.createObjectStore('series', { keyPath: 'takeId' }); db.createObjectStore('audio', { keyPath: 'takeId' }); db.createObjectStore('calibrations', { keyPath: 'id' }).createIndex('createdAt', 'createdAt'); db.createObjectStore('meta', { keyPath: 'key' }); };
        r.onsuccess = () => { const db = r.result, tx = db.transaction('takes', 'readwrite'); tx.objectStore('takes').put({ id: 'v1-take', code: 'C', label: 'aus Version 1', createdAt: '2026-01-01T10:00:00.000Z', analysis: { kernelVersion: '4.0.0' }, summary: {}, history: [] }); tx.oncomplete = () => { db.close(); ok(); }; tx.onerror = () => fehler(tx.error); };
        r.onerror = () => fehler(r.error);
      }));
      await p4.goto(BASE + '/index.html#/aufnahme');
      await p4.waitForFunction(() => !document.getElementById('anmeldung').hidden, null, { timeout: 10000 });
      await p4.fill('#token', TOKEN); await p4.uncheck('#token-merken'); await p4.click('#btn-verbinden');
      await p4.waitForFunction(() => !document.getElementById('app').hidden && VAREAPP.state.takesGeladen, null, { timeout: 10000 });
      const v1 = await p4.evaluate(() => Promise.all([VARESTORE.allTakes(), VARESTORE.allPending()]).then(r => ({ takes: r[0].map(t => t.id), pending: r[1].length })));
      neuladenCheck(0, v1.takes.includes('v1-take') && v1.pending === 0, JSON.stringify(v1));
      // Ohne Kalibrierpflicht (Schalter in den Einstellungen); ein Take von 7 s, damit die Analyse lange genug läuft.
      await p4.$eval('#s-requireCal', el => { el.checked = false; el.dispatchEvent(new Event('change')); });
      await p4.click('#btn-mic');
      await p4.waitForFunction(() => !document.getElementById('btn-take').disabled, null, { timeout: 15000 });
      await p4.waitForTimeout(500);
      await p4.fill('#take-label', 'Neuladen-Probe');
      await p4.click('#btn-take'); await p4.waitForTimeout(7000); await p4.click('#btn-take');
      await p4.waitForFunction(() => /Analyse \d+ \/ \d+ Rahmen/.test((document.getElementById('take-progress-text') || {}).textContent || ''), null, { timeout: 30000 });
      const vor = await p4.evaluate(() => Promise.all([VARESTORE.allPending(), VARESTORE.audioIds(), VARESTORE.allTakes()]).then(r => ({ pending: r[0].map(o => o.id), audio: r[1], takes: r[2].length, busy: VAREAPP.state.busy })));
      // Neuladen mitten in der Analyse: Der Browser fragt nach; abgelehnt, läuft die Analyse weiter.
      await p4.evaluate(() => { location.reload(); });
      await p4.waitForTimeout(800);
      const nachAbgelehnt = await p4.evaluate(() => ({ busy: VAREAPP.state.busy, gespeichert: /Gespeichert als/.test(document.getElementById('take-result').textContent) }));
      const abgelehntGeblieben = dialoge.includes('beforeunload') && (nachAbgelehnt.busy || nachAbgelehnt.gespeichert);
      // Dann bestätigt neu laden, solange die Analyse noch läuft.
      const nochInAnalyse = await p4.evaluate(() => VAREAPP.state.busy);
      verlassenErlaubt = true;
      await p4.reload();
      verlassenErlaubt = false;
      await p4.waitForFunction(() => !document.getElementById('app').hidden && VAREAPP.state.takesGeladen, null, { timeout: 15000 });
      await p4.waitForFunction(() => !document.getElementById('offene-analysen').hidden, null, { timeout: 10000 }).catch(() => { });
      const angebot = await p4.evaluate(() => { const b = document.getElementById('offene-analysen'); return { sichtbar: !b.hidden, text: b.textContent, knoepfe: Array.from(b.querySelectorAll('button')).map(x => x.textContent) }; });
      neuladenCheck(1,
        vor.busy && vor.pending.length === 1 && vor.audio.includes(vor.pending[0]) && vor.takes === 1 && abgelehntGeblieben && nochInAnalyse
        && angebot.sichtbar && /Neuladen-Probe/.test(angebot.text) && angebot.knoepfe.join('|') === 'Analyse fortsetzen|WAV sichern|Verwerfen',
        JSON.stringify({ vor, dialoge, nachAbgelehnt, nochInAnalyse, angebot: angebot.text.slice(0, 90), knoepfe: angebot.knoepfe }));
      await p4.click('#offene-analysen button[data-offen="weiter"]').catch(() => { });
      await p4.waitForFunction(() => VARESTORE.allTakes().then(ts => ts.some(t => t.label === 'Neuladen-Probe')), null, { timeout: 60000, polling: 300 }).catch(() => { });
      await p4.waitForFunction(() => !VAREAPP.state.busy, null, { timeout: 30000 }).catch(() => { });
      const nach = await p4.evaluate(id => Promise.all([VARESTORE.getTake(id), VARESTORE.allPending(), VARESTORE.hasAudio(id), VARESTORE.getSeries(id)]).then(r => ({ code: r[0] && r[0].code, label: r[0] && r[0].label, pos: r[0] && r[0].sitzung && r[0].sitzung.position, pending: r[1].length, audio: r[2], serie: !!r[3], angebotWeg: document.getElementById('offene-analysen').hidden, ergebnis: document.getElementById('take-result').textContent.slice(0, 40) })), vor.pending[0] || '');
      neuladenCheck(2,
        nach.label === 'Neuladen-Probe' && nach.code === 'D' && nach.pos === 1 && nach.pending === 0 && nach.audio && nach.serie && nach.angebotWeg && /Gespeichert als D/.test(nach.ergebnis), JSON.stringify(nach));
    } catch (e) { NEULADEN_NAMEN.forEach((n, k) => { if (neuladenErledigt.indexOf(k) < 0) check(n, false, 'Ausnahme: ' + String(e && e.message || e).split('\n')[0]); }); }
    if (ctx4) await ctx4.close();

    // ---------- Sicherung mit nie Gemessenem, Befund statt Rost, Sprünge, verwaiste Referenz ----------
    const C = require(path.join(ROOT, 'csv.js'));
    const stat = (med, extra) => Object.assign({ med, q1: med - 10, q3: med + 10, n: 400, share: 0.95 }, extra);
    // Erfundener Take: F3 stabil 2400 unter dem Mindestwert 2500, SHR max −12 dB, ein gehaltener Sprung — alles sicher
    // gemessen. F4 und SNR nie gemessen (NaN).
    const befund = { id: 'e2e-befund', code: 'Q', label: 'Befund', createdAt: '2026-03-02T09:00:00.000Z', durationS: 5, sampleRate: 48000, deviceLabel: 'Prüfgerät',
      analysis: { kernelVersion: D.VERSION, gate: { f3MinHz: 2500 }, analysedAt: '2026-03-02T09:00:00.000Z' }, history: [],
      summary: { nFrames: 500, voicedShare: 0.9, validShare: 0.95, stableShare: 0.8, f0: stat(110, { note: 'A2' }), F: [600, 1100, 2400, NaN, 4000].map(f => stat(f)),
        d34: stat(800), d34stable: { med: NaN, q1: NaN, q3: NaN, n: 0 }, d45: stat(800), f3stable: stat(2400, { n: 380 }), sfr: stat(-20), shr: stat(-30, { max: -12 }), cpp: stat(30),
        h1h2: stat(1, { unsureShare: 0 }), h1h2c: stat(1), rms: stat(-20, { max: -10 }), floorDb: -80, floorSource: 'calibration', snrDb: NaN, tube: stat(17.5, { n: 100 }), tubeCm: 17.5,
        perVowel: {}, octaveCorrectedShare: 0, octaveAmbiguousShare: 0, slotUnsureShare: 0, spruenge: { gehalten: 1, kante: 2, lambdaGehalten: 0.02, lambdaKante: 0.04, liste: [] } } };
    befund.summary.F[3] = { med: NaN, q1: NaN, q3: NaN, n: 0, share: 0 };
    fs.writeFileSync(path.join(SP, 'befund.json'), C.serializeBackup({ takes: [befund], series: {}, refs: { u: { d34: 600, takeId: 'fehlt', code: 'X', pinned: true } }, calibrations: [], settings: null, kernelVersion: D.VERSION }));
    const ctx3 = await browser.newContext({ viewport: { width: 1000, height: 1400 }, locale: 'de-DE' });
    await ctx3.route('https://api.github.com/**', korpusRoute);
    const p3 = await ctx3.newPage();
    p3.on('pageerror', e => errors.push(String(e && e.stack || e)));
    p3.on('dialog', d => d.dismiss());
    await p3.goto(BASE + '/index.html#/chronik');
    await p3.waitForFunction(() => !document.getElementById('anmeldung').hidden, null, { timeout: 10000 });
    await p3.fill('#token', TOKEN); await p3.uncheck('#token-merken'); await p3.click('#btn-verbinden');
    await p3.waitForFunction(() => !document.getElementById('app').hidden, null, { timeout: 10000 });
    // Nach dem Verbinden bestimmt die Seite die Referenzen neu (Gatterwerte aus dem Korpus); das abwarten.
    await p3.waitForTimeout(600);
    await p3.waitForSelector('#btn-import-json', { state: 'visible' });
    const [fc3] = await Promise.all([p3.waitForEvent('filechooser'), p3.click('#btn-import-json')]);
    await fc3.setFiles(path.join(SP, 'befund.json'));
    await p3.waitForFunction(() => /Import:/.test((document.querySelector('[role=status]') || {}).textContent || ''), null, { timeout: 10000 });
    const imp = await p3.evaluate(() => VARESTORE.getTake('e2e-befund').then(t => ({ f4NaN: Number.isNaN(t.summary.F[3].med), snrNaN: Number.isNaN(t.summary.snrDb), f4: String(t.summary.F[3].med), meldung: document.querySelector('[role=status]').textContent })));
    check('Sicherung → Import: nie gemessene Werte bleiben NaN in IndexedDB (nicht null)', imp.f4NaN && imp.snrNaN, JSON.stringify({ F4: imp.f4, snrNaN: imp.snrNaN }));
    check('Import: angepinnte Referenz ohne ihren Take wird nicht ungeprüft Zielmarke', /angepinnte Referenz/.test(imp.meldung) && /(nicht übernommen|verwaist)/.test(imp.meldung), imp.meldung);
    await p3.waitForSelector('#takes-list tr[data-id="e2e-befund"]', { timeout: 10000 });
    const GOLD = 'rgb(201, 162, 39)', ROST = 'rgb(168, 90, 60)';
    const zeile = await p3.$eval('#takes-list tr[data-id="e2e-befund"]', tr => { const td = tr.querySelectorAll('td'); const farbe = i => { const sp = td[i].querySelector('span'); return sp ? { klasse: sp.className, farbe: getComputedStyle(sp).color, text: sp.textContent } : null; }; return { f3: farbe(5), shr: farbe(7), rost: tr.querySelectorAll('.rust').length }; });
    check('Chronik-Liste im Browser: F3 unter dem Mindestwert und SHR über −15 dB in Gold (Befund), kein Rost in der Zeile',
      zeile.f3 && zeile.f3.klasse === 'befund' && zeile.f3.farbe === GOLD && zeile.shr && zeile.shr.farbe === GOLD && zeile.rost === 0, JSON.stringify(zeile));
    const legende = await p3.textContent('#view-chronik');
    check('Chronik nennt, was Rost und was Gold heißt', /Rost = Messwert unsicher/.test(legende) && /Gold ohne Strich = sicher gemessen, aber Befund/.test(legende));
    // Verwaiste Referenz, wie analysis.js sie nach dem Vertrag liefert: sichtbar mit Grund, ohne Wert.
    await p3.evaluate(() => VARESTORE.setMeta('refs', { a: { takeId: 'weg', code: 'Q', date: '2026-03-02T09:00:00.000Z', startS: 1, lenS: 0.8, pinned: true, verwaist: true, grund: 'Take Q ist gelöscht.', d34Zuletzt: 612.4 } }).then(() => VAREAPP.refreshChronik()));
    await p3.waitForFunction(() => /verwaist/.test(document.getElementById('refs-table').textContent), null, { timeout: 5000 }).catch(() => { });
    const refZeile = await p3.$eval('#refs-table', el => { const tr = el.querySelector('tbody tr'); return tr ? { wert: tr.querySelectorAll('td')[1].textContent.trim(), text: tr.textContent.replace(/\s+/g, ' ').trim(), loesen: !!tr.querySelector('button[data-act="unpin"]') } : null; });
    check('Verwaiste Referenz: Grund sichtbar, kein Wert in der ΔF3–4-Spalte, Lösen-Knopf',
      !!refZeile && refZeile.wert === '–' && /verwaist: Take Q ist gelöscht\./.test(refZeile.text) && /zuletzt 612 Hz/.test(refZeile.text) && refZeile.loesen, JSON.stringify(refZeile));
    await p3.evaluate(() => { location.hash = '#/take/e2e-befund'; });
    await p3.waitForFunction(() => document.querySelector('#take-detail .grid'), null, { timeout: 10000 });
    const det = await p3.$$eval('#take-detail .stat', els => els.map(e => ({ k: e.querySelector('.k').textContent, klasse: e.className, farbe: getComputedStyle(e.querySelector('.v')).color, v: e.querySelector('.v').textContent })));
    const dk = re => det.find(x => re.test(x.k)) || {};
    const seite = await p3.textContent('#take-detail');
    check('Detail im Browser: SHR, Tonsprünge und „nicht gewertet, F3 unter dem Mindestwert“ in Gold; nirgends „Register“; SNR „nicht messbar“',
      dk(/^SHR/).farbe === GOLD && dk(/^Tonsprünge ≥ 5 HT, gehalten ≥ 90 ms$/).farbe === GOLD && dk(/^kurze Kanten unter 90 ms$/).v.startsWith('2') && dk(/ΔF3–4 stabil/).farbe === GOLD
      && dk(/^F4$/).farbe !== GOLD && !/Register/.test(seite) && /nicht messbar/.test(dk(/SNR/).v || ''),
      ['SHR', 'Tonsprünge', 'kurze Kanten', 'ΔF3–4 stabil', 'SNR'].map(n => n + ': ' + JSON.stringify(dk(new RegExp(n)))).join(' | ').replace(new RegExp(ROST.replace(/[()]/g, '\\$&'), 'g'), 'ROST').replace(new RegExp(GOLD.replace(/[()]/g, '\\$&'), 'g'), 'GOLD'));

    // ---------- Detail und Hover: Take mit unsicherem und korrigiertem Grundton (Farben aus dem Browser) ----------
    const A = require(path.join(ROOT, 'analysis.js')), F = A.FLAG, nG = 60, gs = A.makeSeries(nG);
    for (let i = 0; i < nG; i++) {
      gs.t[i] = 0.01 * i; gs.f0[i] = 196; gs.f0Yin[i] = 196; gs.f0Cep[i] = 196; gs.rms[i] = -20; gs.ap[i] = 0.1; gs.flags[i] = F.VOICED; gs.cls[i] = -1; gs.gate[i] = 1; gs.score[i] = NaN;
      // Alle fünf Formanten gültig, also auch ΔF3–4 und ΔF4–5 (dsp.js: d34valid = valid3 ∧ valid4). Vorher fehlten
      // D34VALID und d34 (0) — ein Rahmen, den der Kern nie liefert; seit der Hover ungültiges ΔF3–4 in Rost zeigt,
      // stand dieser Widerspruch im korrigierten Rahmen in Rost.
      [700, 1200, 2500, 3300, 4200].forEach((f, k) => { gs['f' + (k + 1)][i] = f; gs['bw' + (k + 1)][i] = [80, 90, 120, 150, 200][k]; }); gs.valid[i] = 31;
      gs.flags[i] |= F.D34VALID | F.D45VALID; gs.d34[i] = 800; gs.d45[i] = 900;
      gs.shr[i] = -30; gs.shrGrid[i] = 196; gs.shrOther[i] = NaN; gs.shrKamm[i] = -1; gs.shrZweitpuls[i] = 0.1; gs.h1h2[i] = 2; gs.h1h2c[i] = 3;
      if (i >= 20 && i < 30) { gs.flags[i] |= F.F0UNSURE | F.SHRUNSURE; gs.f0Grund[i] = A.codeAus('f0Grund', 'cepstrum'); gs.f0Cep[i] = 98; gs.shrGrund[i] = A.codeAus('shrGrund', 'grundton'); }
      if (i >= 35 && i < 45) { gs.flags[i] |= F.F0KORR; gs.f0Korrektur[i] = A.codeAus('f0Korrektur', 'teiltonreihe'); gs.f0Yin[i] = 98; }
    }
    const gTake = { id: 'e2e-grundton', code: 'G', label: 'Grundton', createdAt: '2026-03-02T10:00:00.000Z', durationS: 0.6, sampleRate: 48000, deviceLabel: 'Prüfgerät',
      analysis: { kernelVersion: D.VERSION, gate: { f3MinHz: 2500 }, analysedAt: '2026-03-02T10:00:00.000Z' }, history: [],
      summary: A.summarise(gs, { hopS: 0.01, durationS: 0.6, floorDb: -80, floorSource: 'calibration', floorKnown: true }) };
    fs.writeFileSync(path.join(SP, 'grundton.json'), C.serializeBackup({ takes: [gTake], series: { [gTake.id]: gs }, refs: null, calibrations: [], settings: null, kernelVersion: D.VERSION }));
    await p3.evaluate(() => { location.hash = '#/chronik'; });
    await p3.waitForSelector('#btn-import-json', { state: 'visible' });
    // Die Meldung des vorigen Imports lautet gleich: erst leeren, sonst ginge es weiter, bevor der Take da ist.
    await p3.evaluate(() => { const m = document.querySelector('[role=status]'); if (m) m.textContent = ''; });
    const [fc4] = await Promise.all([p3.waitForEvent('filechooser'), p3.click('#btn-import-json')]);
    await fc4.setFiles(path.join(SP, 'grundton.json'));
    await p3.waitForFunction(() => /Import: 1 Takes übernommen/.test((document.querySelector('[role=status]') || {}).textContent || ''), null, { timeout: 10000 });
    await p3.evaluate(() => { location.hash = '#/take/e2e-grundton'; });
    await p3.waitForFunction(() => document.getElementById('d-lanes') && document.querySelector('#take-detail .grid'), null, { timeout: 10000 });
    await p3.waitForTimeout(300);
    const f0Kachel = await p3.$$eval('#take-detail .stat', els => { const e = els.find(x => /^F0 Median/.test(x.querySelector('.k').textContent)); const sp = e && e.querySelector('.v .rust'); return e ? { v: e.querySelector('.v').textContent, rost: sp ? getComputedStyle(sp).color : null } : null; });
    // Die Spuren liegen unter den Kacheln, womöglich außerhalb des Fensters: erst hinscrollen, dann messen.
    const box2 = await p3.$eval('#d-lanes', c => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
    const hoverBei = async idx => {
      await p3.mouse.move(box2.x + 46 + idx / (nG - 1) * (box2.w - 46 - 70), box2.y + 50);
      await p3.waitForTimeout(150);
      return p3.$eval('#d-hover', el => ({ text: el.textContent, rost: Array.from(el.querySelectorAll('.rust')).map(s => ({ text: s.textContent, farbe: getComputedStyle(s).color })) }));
    };
    const hU = await hoverBei(25), hK = await hoverBei(40);
    check('Detail im Browser: F0-Median aus sicheren Rahmen, unsicherer Anteil in Rost daneben; Hover: unsicherer Grundton in Rost mit Grund, korrigierter mit altem Wert ohne Rost',
      !!f0Kachel && /^196 \[196–196\]/.test(f0Kachel.v) && /Grundton unsicher in 17 %/.test(f0Kachel.v) && f0Kachel.rost === ROST
      && hU.rost.some(r => /^F0 196\.0 \(Grundton unsicher: Cepstrum zeigt 98\.0 Hz\)$/.test(r.text) && r.farbe === ROST) && hU.rost.some(r => /^SHR -30\.0 .*unsicher: Grundton unsicher$/.test(r.text))
      && /F0 196\.0 \(korrigiert aus 98\.0 Hz, Teiltonreihe\)/.test(hK.text) && !hK.rost.length,
      JSON.stringify({ f0Kachel, unsicher: hU.rost, korrigiert: hK.text.slice(0, 120) }).replace(/rgb\(168, 90, 60\)/g, 'ROST'));
    await ctx3.close();
  } catch (e) { fails.push('AUSNAHME ' + (e && e.stack || e)); console.log('AUSNAHME', e); }
  check('Keine JavaScript-Fehler auf der Seite', errors.length === 0, errors.join(' | '));
  if (logs.length) console.log('Konsole:', logs.slice(0, 10).join('\n'));
  await browser.close(); server.close();
  console.log('\n=== E2E: ' + notes.length + ' bestanden, ' + fails.length + ' gerissen ===');
  process.exit(fails.length ? 1 : 0);
})();

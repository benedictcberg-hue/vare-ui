/* VARE — Browser-Pruefung. Oeffnet die Seite in Chromium, stellt die GitHub-API nach (nur
   erfundene Daten, kein Netz, kein echtes Token) und spielt einen ganzen Durchgang durch:
   Token-Tor, Mikrofon, Kalibrierung, Take, Chronik, CSV, Sicherung, Import, Detail, Neu-Analyse,
   danach Schritt 0 über Neuladen, Löschen und neue Sitzung sowie die Einsing-Angaben.

     npm install -g playwright && npx playwright install chromium
     node pruefung/browser-test.js            (Windows: node pruefung\browser-test.js)

   Als Mikrofon dient eine erzeugte WAV-Datei mit bekannten Formanten; was die Seite misst,
   wird gegen diese bekannten Werte geprueft. */
const { chromium } = require('playwright-core');
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
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-audio-capture=' + WAV, '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1000, height: 1400 }, locale: 'de-DE' });
  const page = await ctx.newPage();
  const errors = [], logs = [];
  page.on('pageerror', e => errors.push(String(e && e.stack || e)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  // Rückfragen werden abgelehnt (z. B. „Audio mitsichern?“), außer der Ablauf will ausdrücklich bestätigen.
  let dialogAntwort = false;
  page.on('dialog', d => (dialogAntwort ? d.accept() : d.dismiss()));
  const KORPUS = JSON.stringify({ format: 'vare-korpus', version: 1, stand: '2026-10-03', notiz: 'Testkorpus',
    marken: { d34: [{ hz: 404, text: 'erfundener Prueftwert' }, { hz: 707 }, { hz: 1111 }] },
    gatter: { f3MinHz: 2500, spreadMaxHz: 130 } });
  await ctx.route('https://api.github.com/**', route => {
    const auth = route.request().headers()['authorization'] || '';
    if (auth !== 'Bearer github_pat_TESTTESTTESTTESTTEST') { route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Bad credentials"}' }); return; }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(KORPUS, 'utf8').toString('base64'), encoding: 'base64' }) });
  });
  try {
    await page.goto(BASE + '/index.html#/aufnahme');
    await page.waitForFunction(() => document.getElementById('anmeldung') && !document.getElementById('anmeldung').hidden, null, { timeout: 10000 });
    check('Oeffentliche Huelle: vor der Verbindung nur die Token-Eingabe', await page.isHidden('#app') && await page.isHidden('#nav') && await page.isVisible('#token'));
    check('Huelle nennt das private Repo', (await page.textContent('#korpus-repo')).includes('vare-tools'), await page.textContent('#korpus-repo'));
    check('Huelle enthaelt die Marken nicht im Quelltext', !(await page.content()).includes('404') && !(await page.content()).includes('1111'));
    await page.fill('#token', 'falsches-token-mit-genug-zeichen');
    await page.click('#btn-verbinden');
    await page.waitForFunction(() => (document.getElementById('anmeldung-fehler').textContent || '').length > 0, null, { timeout: 10000 });
    check('Falsches Token: Meldung, Oberflaeche bleibt zu', await page.isHidden('#app'), (await page.textContent('#anmeldung-fehler')).slice(0, 80));
    await page.fill('#token', 'github_pat_TESTTESTTESTTESTTEST');
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
    check('Live: Gatter stabil /a/ und ΔF3–4 gewertet', /stabil \/a\//.test(live.state) && /gewertet/.test(live.d34), live.state + ' | ' + live.d34);
    await page.screenshot({ path: path.join(SP, 'shot-live.png'), fullPage: true });
    await page.waitForTimeout(3500);
    await page.click('#btn-take');
    // Während der Analyse schon den nächsten Take beschriften: das gehört nicht in diesen Take.
    const busyBeiEingabe = await page.evaluate(() => VAREAPP.state.busy);
    await page.fill('#take-label', 'NAECHSTER');
    await page.selectOption('#take-intent', 'i');
    await page.fill('#take-comment', 'fuer den naechsten Take');
    await page.waitForFunction(() => document.querySelector('#take-result .notice'), null, { timeout: 180000 });
    const result = await page.textContent('#take-result');
    check('Take analysiert und gespeichert', /Gespeichert als/.test(result), result.replace(/\s+/g, ' ').slice(0, 300));
    const takes = await page.evaluate(() => VARESTORE.allTakes());
    check('IndexedDB: 1 Take', takes.length === 1, String(takes.length));
    const felder = [await page.inputValue('#take-label'), await page.inputValue('#take-intent'), await page.inputValue('#take-comment')].join('|');
    check('Eingabe während der Analyse: Take behält Bezeichnung, Vokalabsicht, Kommentar; die neuen bleiben für den nächsten',
      busyBeiEingabe === true && takes[0] && takes[0].label === 'E2E /a/ G3' && takes[0].vowelIntent === 'a' && takes[0].comment === 'automatischer Durchlauf' && felder === 'NAECHSTER|i|fuer den naechsten Take',
      'Analyse lief=' + busyBeiEingabe + ' | gespeichert ' + (takes[0] && [takes[0].label, takes[0].vowelIntent, takes[0].comment].join('|')) + ' | Felder ' + felder);
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
    const box = await page.$eval('#d-lanes', c => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
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
    check('Neu-Analyse: Historie hat einen Eintrag', t2[0].history && t2[0].history.length === 1, JSON.stringify(t2[0].history && t2[0].history.map(h => h.kernelVersion)));
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
    const tC = await takeAufnehmen(2500, async () => { busyC = await page.evaluate(() => VAREAPP.state.busy); await page.click('#btn-neue-sitzung'); });
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
  } catch (e) { fails.push('AUSNAHME ' + (e && e.stack || e)); console.log('AUSNAHME', e); }
  check('Keine JavaScript-Fehler auf der Seite', errors.length === 0, errors.join(' | '));
  if (logs.length) console.log('Konsole:', logs.slice(0, 10).join('\n'));
  await browser.close(); server.close();
  console.log('\n=== E2E: ' + notes.length + ' bestanden, ' + fails.length + ' gerissen ===');
  process.exit(fails.length ? 1 : 0);
})();

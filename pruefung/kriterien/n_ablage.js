/* Kriterien zur Ablage der Kalibrierung im privaten Repo (korpus.js: kalibrierungsDatei, ablegen).
   Der Browser-Prüflauf prüft den Weg durch die Seite; hier geht es um Datei und Anfrage. */
'use strict';
const path = require('path');
module.exports = async function (H) {
  const { check } = H;
  const KO = require(path.join(__dirname, '..', '..', 'korpus.js')).VAREKORPUS;
  const rec = { id: 'cal-1234abcd', createdAt: '2026-10-09T07:48:12.000Z', kernelVersion: '4.1.0', sampleRate: 48000,
    floorDb: -71.234, levelDb: -18.44, snrDb: 52.81, bandSnr: { low: 55.1, sf: 40.25 }, decayDbPerS: 310.4, F: [700.4, 1180, NaN],
    deviceLabel: 'Mikrofon von Testperson', deviceId: 'abc' };
  const d = KO.kalibrierungsDatei(rec);
  let o = null; try { o = JSON.parse(d.inhalt); } catch (e) { }
  check('AB1', 'Ablage: Pfad unter data/input/ mit Zeitstempel und Kurz-ID', /^data\/input\/kalibrierung-\d{8}-\d{6}-34abcd\.json$/.test(d.pfad), d.pfad);
  check('AB1', 'Ablage: Messwerte gerundet, fehlender Wert null, kein Gerätename und keine Geräte-ID',
    !!o && o.format === 'vare-kalibrierung' && o.version === 1 && o.rauschbodenDbfs === -71.2 && o.snrDb === 52.8 && o.snrBand2400bis3200HzDb === 40.3
      && o.ausklangDbProS === 310 && o.formantenA_Hz[0] === 700 && o.formantenA_Hz[2] === null && o.kernVersion === '4.1.0'
      && !/Testperson|deviceLabel|deviceId|"abc"/.test(d.inhalt), d.inhalt.replace(/\s+/g, ' ').slice(0, 200));
  // Anfrage: PUT an die Contents-API des privaten Repos, Inhalt als Base64 (UTF-8), nie überschreiben.
  const alt = global.fetch, gesehen = [];
  async function mitAntwort(status, fn) {
    global.fetch = (url, init) => { gesehen.push({ url, init }); return Promise.resolve({ status, ok: status < 300, json: () => Promise.resolve({ message: 'x' }) }); };
    try { return await fn(); } finally { global.fetch = alt; }
  }
  let ok201 = null, ok422 = null, f403 = null;
  ok201 = await mitAntwort(201, () => KO.ablegen('github_pat_TESTTESTTESTTESTTEST', d));
  ok422 = await mitAntwort(422, () => KO.ablegen('github_pat_TESTTESTTESTTESTTEST', d));
  try { await mitAntwort(403, () => KO.ablegen('github_pat_TESTTESTTESTTESTTEST', d)); } catch (e) { f403 = e.message; }
  const r = gesehen[0] || {}, body = r.init && JSON.parse(r.init.body || '{}');
  const zurueck = body && body.content ? Buffer.from(body.content, 'base64').toString('utf8') : '';
  check('AB2', 'Ablage: PUT an api.github.com/repos/…/vare-tools/contents/data/input/…, Inhalt bitgleich als Base64, ohne sha',
    r.init && r.init.method === 'PUT' && r.url === 'https://api.github.com/repos/' + KO.REPO + '/contents/' + d.pfad && zurueck === d.inhalt && !('sha' in body) && body.branch === 'main', r.url);
  check('AB2', 'Ablage: 201 = neu, 422 (gibt es schon) = erledigt ohne Überschreiben, 403 = verständlicher Fehler',
    ok201 === 'neu' && ok422 === 'schon da' && /Read and write/.test(f403 || ''), [ok201, ok422, f403].join(' | '));
  let ohneToken = null; try { await KO.ablegen('', d); } catch (e) { ohneToken = e.message; }
  check('AB2', 'Ablage: ohne Token keine Anfrage', /Kein Token/.test(ohneToken || ''), ohneToken);
};

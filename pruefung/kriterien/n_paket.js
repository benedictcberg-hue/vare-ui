/* Kriterien zum Chronik-Standard, Stufe 1 (9.10.2026): Take-ID nach Chronik-Schema, Zeitbezug Start, Kette je Take,
   Formular (Stichpunkte) mit Fassungen, Übergabepaket (take.json, frames.csv im Dialekt chronik, ereignisse.csv, ZIP) und
   seine Ablage nach data/takes/<id>/ (korpus.js takeDateien), WAV 24 Bit und Float32 als Vorgabe.
   PK1: csv.js takeId/kurztitel/dateiStamm und Start aus Ende minus Dauer. PK2: Paket und Dialekt chronik (leer statt −99,
   volle Genauigkeit, Spaltennamen mit _b). PK3: ZIP stored mit Prüfsumme. PK4: Ablage-Dateien. PK5: WAV 24 Bit. */
'use strict';
const path = require('path');
module.exports = async function (H) {
  const { check, C, W, V, A, D } = H;
  const Z = require(path.join(__dirname, '..', '..', 'zip.js')), KO = require(path.join(__dirname, '..', '..', 'korpus.js')).VAREKORPUS;

  /* ---------- PK1 · Take-ID und Zeitbezug ---------- */
  {
    const start = new Date(2026, 9, 9, 1, 0, 30);   // 9.10.2026 01:00:30 Ortszeit
    const id1 = C.takeId(start, 'Stand by Me', []), id2 = C.takeId(start, 'Stand by Me', [id1]), id3 = C.takeId(start, 'Stand by Me', [id1, id2]);
    const leer = C.takeId(start, '', () => false), umlaut = C.kurztitel('Übung: Jäger & Söhne — groß'), lang = C.kurztitel('Defying Gravity ganzer Durchgang mit Reprise');
    check('PK1', 'Take-ID JJJJMMTT-hhmm-kurztitel aus der Startzeit; gleiche Minute und gleicher Titel: -2, -3; ohne Titel „ohne-titel“',
      id1 === '20261009-0100-stand-by-me' && id2 === id1 + '-2' && id3 === id1 + '-3' && leer === '20261009-0100-ohne-titel' && C.ID_SCHEMA.test(id1) && C.ID_SCHEMA.test(id3),
      [id1, id2, id3, leer].join(' | '));
    check('PK1', 'Kurztitel: Kleinbuchstaben, Umlaute aufgelöst, Sonderzeichen zu Bindestrich, höchstens 24 Zeichen, am Wort gekürzt',
      umlaut === 'uebung-jaeger-soehne' && lang.length <= 24 && !/-$/.test(lang) && /^[a-z0-9-]+$/.test(lang) && lang === 'defying-gravity-ganzer', umlaut + ' | ' + lang);
    let fehler = ''; try { C.takeId('kein datum', 'x'); } catch (e) { fehler = e.message; }
    check('PK1', 'Take-ID ohne gültige Startzeit wirft, statt eine zu erfinden', /Startzeit/.test(fehler), fehler);
    // Älterer Take: nur createdAt (Ende) und timeLocal (Ende). Start = Ende − Dauer, Wanduhr über den gespeicherten UTC-Abstand.
    const alt = { id: '3f1c-uuid', code: 'C', createdAt: '2026-10-03T07:48:00.000Z', timeLocal: '09:48', tzOffsetMin: 120, durationS: 125.4 };
    const neu = { id: '20261009-0100-worry', code: 'D', createdAt: '2026-10-08T23:02:10.000Z', startedAt: '2026-10-08T23:00:30.000Z', endedAt: '2026-10-08T23:02:10.000Z', timeLocal: '01:00', timeLocalEnd: '01:02', tzOffsetMin: 120, durationS: 100 };
    const zeile = (t) => { const L = C.takesToCsv([t], 'standard').split('\r\n'), k = L[0].split(','), w = L[1].split(','); return name => w[k.indexOf(name)]; };
    const za = zeile(alt), zn = zeile(neu);
    check('PK1', 'CSV-Zeitbezug Start: älterer Take Ende − Dauer (07:45:55Z, Wanduhr 09:45), Ende bleibt in end_iso/end_local; neuer Take trägt Start und Ende wie gespeichert',
      za('datetime_iso') === '2026-10-03T07:45:54.600Z' && za('time_local') === '09:45' && za('end_iso') === alt.createdAt && za('end_local') === '09:48'
      && zn('datetime_iso') === neu.startedAt && zn('time_local') === '01:00' && zn('end_iso') === neu.endedAt && zn('end_local') === '01:02' && zn('take_id') === neu.id,
      [za('datetime_iso'), za('time_local'), za('end_iso'), za('end_local'), zn('datetime_iso'), zn('time_local')].join(' | '));
    check('PK1', 'Dateistamm = Take-ID beim Chronik-Schema, sonst Code und Zeitstempel des Starts', C.dateiStamm(neu) === neu.id && /^vare-C-20261003-\d{4}$/.test(C.dateiStamm(alt)), C.dateiStamm(neu) + ' | ' + C.dateiStamm(alt));
    // Kette je Take: Bearbeitung durch den Browser 1/0/fehlend.
    const bb = C.browserBearbeitung;
    check('PK1', 'browser_processing: 1 bei einer Automatik an, 0 bei allen aus, fehlend ohne Angabe',
      bb({ captureFlags: { echoCancellation: false, noiseSuppression: true, autoGainControl: false } }) === 1 && bb({ captureFlags: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }) === 0
      && bb({ captureFlags: { capture: 'x' } }) === null && bb({}) === null, '');
  }

  /* ---------- PK2 · Paket: take.json, frames.csv (chronik), ereignisse.csv ---------- */
  let take = null, series = null;
  {
    // Kurzer Take durch die echte Analyse, damit Serie und Zusammenfassung echt sind (grober Rahmenabstand spart Zeit).
    const sig = H.concat([H.noise(Math.round(0.1 * H.SR), 2e-4, 3), D.synthVowel(196, [700, 1200, 2500, 3300, 4200], H.BW5, 0.8, H.SR, { gain: 0.3 }), H.noise(Math.round(0.1 * H.SR), 2e-4, 4)]);
    const res = await A.analyseTake(sig, H.SR, { hopS: 0.02, spreadMaxHz: 130 });
    series = res.series;
    take = { id: '20261009-0100-worry', schemaVersion: 2, code: 'D', label: 'Worry', comment: 'leise', createdAt: '2026-10-08T23:02:10.000Z', startedAt: '2026-10-08T23:00:30.000Z', endedAt: '2026-10-08T23:02:10.000Z',
      timeLocal: '01:00', timeLocalEnd: '01:02', tzOffsetMin: 120, durationS: sig.length / H.SR, sampleRate: H.SR, trackSampleRate: H.SR, deviceLabel: 'Mikro', deviceId: 'dev1', audioFormat: 'f32',
      captureFlags: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, capture: 'AudioWorklet' }, calibrationId: 'cal-9',
      angaben: { zeit: '2026-10-08T23:02:12.000Z', titel: 'Worry', haltung: 'stehend', ort: 'Küche', kette: 'Hülle B', gefuehl: 'wach', notiz: 'leise', biphonation: 'offen', periodenverdopplung: 'nein' },
      angabenVersionen: [{ zeit: '2026-10-08T23:02:11.000Z', titel: 'Worr', haltung: '', ort: '', kette: '', gefuehl: '', notiz: '', biphonation: 'offen', periodenverdopplung: 'offen' }],
      sitzung: { nr: 3, id: 's-1', position: 2, pauseVorherS: 61.5, pauseSelbeSitzung: true, warmup: 'voll', warmupMin: 12 },
      analysis: { kernelVersion: D.VERSION, hopS: 0.02 }, summary: res.summary, signalLuecken: [], signalLueckeS: 0 };
    // Ein Sprungereignis mit NaN, damit fehlend geprüft wird.
    take.summary.spruenge = take.summary.spruenge || {};
    take.summary.spruenge.liste = [{ startS: 0.5, dauerS: 0.12, halbtoene: 12.02, richtung: 'auf', vonHz: 196, nachHz: 392, art: 'gehalten', uebergangMs: NaN, apSpitze: 0.31, oktave: true }];
    const paket = C.takePaket(take, series, V), namen = paket.map(f => f.name);
    const json = JSON.parse(paket[0].text), frames = paket[1].text, ereig = paket[2].text;
    check('PK2', 'Paket: <id>.take.json, <id>.frames.csv, <id>.ereignisse.csv', namen.join(',') === 'worry.take.json,worry.frames.csv,worry.ereignisse.csv'.split(',').map(n => take.id + n.slice(5)).join(','), namen.join(', '));
    const kk = json.kette || {}, zt = json.zeit || {};
    check('PK2', 'take.json: Format, ID, Zeit (Start und Ende, ISO und lokal), Formular mit Fassungen, Kette (Gerät, Kennung, Raten, Bearbeitung, WAV-Format, Kalibrier-ID), Kern, Kennwerte; Sprungliste nicht doppelt',
      json.format === 'vare-take' && json.version === 1 && json.id === take.id && json.code === 'D' && zt.start_iso === take.startedAt && zt.start_lokal === '01:00' && zt.ende_iso === take.endedAt && zt.ende_lokal === '01:02' && zt.utc_abstand_min === 120
      && json.angaben.haltung === 'stehend' && json.angaben_versionen.length === 1 && json.angaben_versionen[0].titel === 'Worr'
      && kk.geraet === 'Mikro' && kk.geraet_id === 'dev1' && kk.kontextrate_hz === H.SR && kk.geraeterate_hz === H.SR && kk.browser_bearbeitung === 0 && kk.wav_format === 'f32' && kk.kalibrier_id === 'cal-9' && kk.erfassung === 'AudioWorklet'
      && json.kern_version === D.VERSION && json.kennwerte && typeof json.kennwerte.voicedShare === 'number' && !('liste' in (json.spruenge || {})) && json.spruenge && 'gehalten' in json.spruenge
      && json.dateien.wav === take.id + '.wav',
      Object.keys(json).join(','));
    // Kein NaN, kein −99, kein {"$nf"} im JSON — fehlend ist null.
    check('PK2', 'take.json: fehlende Zahl null, nie NaN, nie −99, nie {"$nf"}', !/NaN|\$nf|-99\b/.test(paket[0].text) && /null/.test(paket[0].text), '');
    const L = frames.split('\r\n').filter(Boolean), kopf = L[0].split(','), zeilen = L.slice(1).map(z => z.split(','));
    const sp = name => kopf.indexOf(name);
    const bad = [];
    if (kopf.length !== C.FRAME_COLUMNS.length) bad.push('Kopf ' + kopf.length + ' Spalten');
    for (const [alt, neu] of [['t_s', 't'], ['f0_hz', 'f0_b'], ['f1', 'f1_b'], ['f5', 'f5_b'], ['d34', 'd34_b'], ['sfr_db', 'sfr0_b'], ['cpp_db', 'cpp_b'], ['h1h2_db', 'h1h2_b'], ['shr_db', 'shr_b'], ['shr_grid_hz', 'shr_raster'], ['shr_zweitpuls', 'zweitpuls'], ['h1h2_unsure', 'h1h2_filter'], ['f0_korrektur', 'f0_korr'], ['rms_dbfs', 'rms']])
      if (sp(neu) < 0 || sp(alt) >= 0) bad.push(alt + '→' + neu);
    for (const k of ['valid1', 'valid5', 'flags', 'voiced', 'gate', 'vowel', 'f0_grund', 'd34_grund']) if (sp(k) < 0) bad.push(k + ' fehlt');
    if (zeilen.length !== series.t.length) bad.push(zeilen.length + ' Zeilen statt ' + series.t.length);
    // Stimmlose Zeilen: f1_b leer (nicht −99), valid1 0; irgendwo steht eine leere Zelle, nirgends −99.
    const stimmlos = zeilen.filter(z => z[sp('voiced')] === '0'), stimmhaft = zeilen.filter(z => z[sp('voiced')] === '1');
    if (!stimmlos.length || !stimmhaft.length) bad.push('stimmlos ' + stimmlos.length + ', stimmhaft ' + stimmhaft.length);
    if (stimmlos.some(z => z[sp('f0_b')] !== '' || z[sp('valid1')] !== '0')) bad.push('stimmlos: f0_b „' + (stimmlos[0] || [])[sp('f0_b')] + '“ valid1 „' + (stimmlos[0] || [])[sp('valid1')] + '“');
    if (/(^|,)-99(\.0+)?(,|$)/m.test(frames)) bad.push('−99 im Dialekt chronik');
    // Volle Genauigkeit: der Float32-Wert der Serie kommt bitgleich zurück.
    let unrund = 0, falsch = 0;
    for (let i = 0; i < zeilen.length; i++) { const w = zeilen[i][sp('f0_b')]; if (w === '') continue; unrund++; if (Math.fround(Number(w)) !== series.f0[i]) falsch++; }
    if (!unrund || falsch) bad.push('f0_b: ' + falsch + ' von ' + unrund + ' nicht bitgleich');
    if (stimmhaft.some(z => z[sp('rms')] === '' || !/^-?\d+(\.\d+)?$/.test(z[sp('rms')]))) bad.push('rms stimmhaft leer oder kein Dezimalpunkt');
    check('PK2', 'frames.csv im Dialekt chronik: Spalten umbenannt (_b für Browser-Formeln, f0_b bis zum Praat-Abgleich), fehlend leer statt −99, Float32 bitgleich zurücklesbar, Dezimalpunkt, alle Rahmen', !bad.length, bad.join(' | ') || kopf.length + ' Spalten, ' + zeilen.length + ' Rahmen, ' + unrund + ' f0-Werte bitgleich');
    const E = ereig.split('\r\n').filter(Boolean), ek = E[0].split(','), ez = (E[1] || '').split(',');
    check('PK2', 'ereignisse.csv: t, dauer_s, von_hz, nach_hz, halbtoene, richtung, art, uebergang_ms, oktave, ap_spitze; NaN leer, Wahrheitswert 1',
      ek.join(',') === 't,dauer_s,von_hz,nach_hz,halbtoene,richtung,art,uebergang_ms,oktave,ap_spitze' && E.length === 2 && ez[0] === '0.5' && ez[2] === '196' && ez[6] === 'gehalten' && ez[7] === '' && ez[8] === '1' && ez[9] === '0.31', E.join(' | '));
    // Standard- und Excel-Dialekt bleiben, wie sie waren: Sentinel −99 und alte Spaltennamen.
    const alt = C.framesToCsv(series, 'standard', V).split('\r\n')[0].split(',');
    check('PK2', 'Standard-Dialekt unverändert: alte Spaltennamen (f0_hz, f1, sfr_db), −99 als Sentinel', alt.indexOf('f0_hz') >= 0 && alt.indexOf('f1') >= 0 && alt.indexOf('sfr_db') >= 0 && /(^|,)-99\.00(,|$)/.test(C.framesToCsv(series, 'standard', V)), alt.slice(0, 8).join(','));
  }

  /* ---------- PK3 · ZIP ---------- */
  {
    const wav = W.encode(Float64Array.from([0, 0.5, -0.5, 1]), 48000, 'f32');
    const dateien = [{ name: take.id + '.wav', data: wav }, { name: take.id + '.take.json', data: '{"a":1}' }, { name: 'ü.csv', data: new Uint8Array([49, 44, 50]) }];
    const buf = Z.encode(dateien, new Date(2026, 9, 9, 1, 0, 0)), v = new DataView(buf);
    let zurueck = null, fehler = '';
    try { zurueck = Z.decode(buf); } catch (e) { fehler = e.message; }
    const gleich = zurueck && zurueck.length === 3 && zurueck[0].name === take.id + '.wav' && zurueck[0].data.length === wav.byteLength && Buffer.from(zurueck[0].data).equals(Buffer.from(wav))
      && Buffer.from(zurueck[1].data).toString('utf8') === '{"a":1}' && zurueck[2].name === 'ü.csv' && zurueck[2].data.join(',') === '49,44,50';
    check('PK3', 'ZIP (stored): lokale Köpfe, zentrales Verzeichnis, Endsatz, CRC-32, UTF-8-Namen; Inhalt kommt byte-gleich zurück',
      v.getUint32(0, true) === 0x04034b50 && v.getUint32(buf.byteLength - 22, true) === 0x06054b50 && gleich && Z.crc32(Buffer.from('123456789')) === 0xCBF43926, fehler || (buf.byteLength + ' Bytes'));
    // Manipulierte Datei: Prüfsumme reißt.
    const kaputt = new Uint8Array(buf.slice(0)); kaputt[30 + (take.id + '.wav').length + 5] ^= 0xFF;
    let f2 = ''; try { Z.decode(kaputt.buffer); } catch (e) { f2 = e.message; }
    check('PK3', 'ZIP: veränderter Inhalt wird an der Prüfsumme erkannt', /Prüfsumme/.test(f2), f2);
  }

  /* ---------- PK4 · Ablage nach data/takes/<id>/ ---------- */
  {
    const paket = C.takePaket(take, series, V), gz = new Uint8Array([31, 139, 8, 0, 1, 2, 3]);
    const mit = KO.takeDateien(take.id, paket, gz), ohne = KO.takeDateien(take.id, paket, null);
    const pf = d => d.map(x => x.pfad).join(',');
    check('PK4', 'Ablage: drei Dateien unter data/takes/<id>/ — take.json, frames.csv.gz (Base64 der Bytes) oder frames.csv ohne gzip, ereignisse.csv; Commit-Nachricht nennt den Take',
      pf(mit) === ['take.json', 'frames.csv.gz', 'ereignisse.csv'].map(n => 'data/takes/' + take.id + '/' + n).join(',') && pf(ohne) === ['take.json', 'frames.csv', 'ereignisse.csv'].map(n => 'data/takes/' + take.id + '/' + n).join(',')
      && mit[1].inhaltB64 === Buffer.from(gz).toString('base64') && !mit[1].inhalt && mit[0].inhalt === paket[0].text && ohne[1].inhalt === paket[1].text && mit.every(d => /^Take 20261009-0100-worry: /.test(d.nachricht)),
      pf(mit));
    let f = ''; try { KO.takeDateien('../x', paket, null); } catch (e) { f = e.message; }
    check('PK4', 'Ablage: eine ID mit anderen Zeichen als a–z, 0–9 und Bindestrich wird abgewiesen (kein Pfadausbruch)', /ungeeignet/.test(f), f);
    // PUT: Base64-Inhalt und eigene Nachricht gehen durch ablegen.
    const altF = global.fetch, gesehen = [];
    global.fetch = (url, init) => { gesehen.push({ url, init }); return Promise.resolve({ status: 201, ok: true, json: () => Promise.resolve({}) }); };
    try { await KO.ablegen('github_pat_TESTTESTTESTTESTTEST', mit[1]); await KO.ablegen('github_pat_TESTTESTTESTTESTTEST', mit[0]); } finally { global.fetch = altF; }
    const b1 = JSON.parse(gesehen[0].init.body), b0 = JSON.parse(gesehen[1].init.body);
    check('PK4', 'Ablage: PUT mit den Bytes der gz-Datei als Base64 und mit der Nachricht des Takes; Textdatei als UTF-8-Base64',
      gesehen[0].url === 'https://api.github.com/repos/' + KO.REPO + '/contents/' + mit[1].pfad && b1.content === mit[1].inhaltB64 && b1.message === mit[1].nachricht && Buffer.from(b0.content, 'base64').toString('utf8') === paket[0].text && b0.message === mit[0].nachricht,
      gesehen.map(g => g.url).join(' | '));
  }

  /* ---------- PK5 · WAV 24 Bit, Vorgabe Float32 ---------- */
  {
    const x = Float64Array.from([0, 0.5, -0.5, 1, -1, 1.5, 1 / 3]);
    const b24 = W.encode(x, 48000, 'i24'), d24 = W.decode(b24), dv = new DataView(b24);
    const soll = x.map(v => Math.min(8388607, Math.round(Math.max(-1, Math.min(1, v)) * 8388608)) / 8388608);
    const diff = Math.max(...Array.from(d24.samples).map((v, i) => Math.abs(v - soll[i])));
    check('PK5', 'WAV 24 Bit: PCM-Tag 1, 24 Bit, 3 Byte je Wert, Begrenzung auf ±1, Rückweg durch 8388608 auf 1e-9', dv.getUint16(20, true) === 1 && dv.getUint16(34, true) === 24 && dv.getUint16(32, true) === 3 && d24.bitsPerSample === 24 && diff < 1e-9 && d24.samples.length === x.length, 'größte Abweichung ' + diff);
    const vorgabe = W.decode(W.encode(x, 48000));
    check('PK5', 'WAV ohne Format: Float32 ist Vorgabe (bitgleich, Werte jenseits ±1 bleiben)', vorgabe.format === 'f32' && vorgabe.samples[5] === Math.fround(1.5), vorgabe.format);
  }
};

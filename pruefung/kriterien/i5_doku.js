/* I5 — Endkontrolle: Browserdateien in ES5, Hilfetexte und README gegen das, was der Code tut.
   I5a: Jede Browserdatei (alle *.js im Hauptordner außer test_dsp.js) ist ES5-Syntax. Ein Parser im
        ES5-Modus steht in CI nicht zur Verfügung (keine Abhängigkeiten), darum ein eigener Abtaster: Er
        überspringt Kommentare, Zeichenketten und reguläre Ausdrücke und meldet Schlüsselwörter und
        Zeichen, die es erst ab ES2015 gibt. Er ist ein Stolperdraht, kein vollständiger Parser.
   I5b: Der Hilfetext zu Schritt 0 (index.html) nennt die Platzhalter, die die CSV wirklich schreibt.
   I5c: Der Browser-Test läuft auch unter Windows: kein fest eingetragener Linux-Pfad.
   I5d/I5e: Das öffentliche README nennt den Stand des Codes (Kern, Feinspur, Gültigkeitsregeln, Spalten,
        Sicherung), jeden Grund für „ungültig“ und jedes Kriterienmodul. */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const NEU_WORT = { class: 1, let: 1, const: 1, import: 1, export: 1, async: 1, await: 1, yield: 1 };
// Vor einem „/“ an diesen Stellen beginnt ein regulärer Ausdruck, sonst ist es eine Division.
const VOR_REGEX = /^(?:[(,=:[!&|?{};+\-*%<>~^]|return|typeof|case|do|else|in|instanceof|new|delete|void|throw)$/;
function es5Funde(src) {
  const funde = [], n = src.length;
  let i = 0, zeile = 1, vorher = '';
  const fund = (was) => funde.push('Zeile ' + zeile + ': ' + was);
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '\n') { zeile++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') zeile++; i++; } i += 2; continue; }
    if (c === '\'' || c === '"') {
      i++; while (i < n && src[i] !== c) { if (src[i] === '\\') i++; else if (src[i] === '\n') zeile++; i++; }
      i++; vorher = 'str'; continue;
    }
    if (c === '`') {
      fund('Template-String'); i++;
      while (i < n && src[i] !== '`') { if (src[i] === '\\') i++; else if (src[i] === '\n') zeile++; i++; }
      i++; vorher = 'str'; continue;
    }
    if (c === '/' && (vorher === '' || VOR_REGEX.test(vorher))) {
      i++; let klasse = false;
      while (i < n && src[i] !== '\n' && (klasse || src[i] !== '/')) { if (src[i] === '\\') i++; else if (src[i] === '[') klasse = true; else if (src[i] === ']') klasse = false; i++; }
      i++; while (i < n && /[a-z]/i.test(src[i])) i++;
      vorher = 'regex'; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < n && /[\w$]/.test(src[j])) j++;
      const wort = src.slice(i, j);
      // Nach „.“ oder vor „:“ ist es ein Eigenschaftsname ({ class: 1 }, o.let) — in ES5 erlaubt.
      let k = j; while (k < n && /[ \t]/.test(src[k])) k++;
      if (vorher !== '.' && src[k] !== ':' && Object.prototype.hasOwnProperty.call(NEU_WORT, wort)) fund('Schlüsselwort ' + wort);
      if (wort === 'function') { let k = j; while (k < n && /\s/.test(src[k])) k++; if (src[k] === '*') fund('Generator function*'); }
      vorher = wort; i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(d))) { let j = i + 1; while (j < n && /[\w.]/.test(src[j])) j++; vorher = 'zahl'; i = j; continue; }
    const drei = src.substr(i, 3), zwei = src.substr(i, 2);
    if (drei === '...') { fund('Spread/Rest ...'); i += 3; vorher = '...'; continue; }
    if (zwei === '=>') { fund('Pfeilfunktion =>'); i += 2; vorher = '=>'; continue; }
    if (zwei === '**') { fund('Potenzoperator **'); i += 2; vorher = '*'; continue; }
    if (zwei === '??') { fund('Operator ??'); i += 2; vorher = '?'; continue; }
    if (zwei === '?.' && !/[0-9]/.test(src[i + 2])) { fund('Operator ?.'); i += 2; vorher = '.'; continue; }
    vorher = c; i++;
  }
  return funde;
}

module.exports = async function (H) {
  const { check, C, D } = H;
  {
    const dateien = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && f !== 'test_dsp.js').sort();
    const bad = [];
    for (const f of dateien) {
      const funde = es5Funde(fs.readFileSync(path.join(ROOT, f), 'utf8'));
      if (funde.length) bad.push(f + ' (' + funde.slice(0, 4).join('; ') + (funde.length > 4 ? '; … ' + funde.length + ' Funde' : '') + ')');
    }
    check('I5a', 'Browserdateien in ES5-Syntax: kein class/let/const, keine Pfeilfunktion, kein Template-String, keine Module, kein ...',
      dateien.length >= 10 && !bad.length, bad.length ? bad.join(' | ') : dateien.length + ' Dateien: ' + dateien.join(', '));
  }
  {
    /* Hilfetext Schritt 0: Was er über die CSV sagt, muss die CSV auch schreiben. Früher stand dort
       „Sentinel −99,00“; geschrieben wird −99 mit den Stellen der Spalte, fehlender Text bleibt leer. */
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    // Bis zur nächsten Überschrift: seit der Take-Kasten über Schritt 0 steht, ist das nicht mehr „Take“.
    const a = html.indexOf('<h2>Schritt 0'), b0 = html.indexOf('<h2>', a + 4), b = b0 < 0 ? html.length : b0;
    const text = (a >= 0 && b > a ? html.slice(a, b) : '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const geschrieben = new Set(), bad = [];
    for (const d of ['standard', 'excelde']) {
      const tr = d === 'excelde' ? ';' : ',', L = C.takesToCsv([{ code: 'B', createdAt: 'x' }], d).replace(/^﻿/, '').split(/\r?\n/);
      const kopf = L[0].split(tr), w = L[1].split(tr), v = k => w[kopf.indexOf(k)];
      for (const k of ['session_nr', 'take_in_session', 'pause_before_s', 'warmup_min']) geschrieben.add(v(k));
      if (v('warmup_state') !== '') bad.push(d + ': warmup_state „' + v('warmup_state') + '“ statt leer');
    }
    const behauptet = (text.match(/[−-]99(?:[.,]\d+)?/g) || []).map(s => s.replace('−', '-'));
    for (const s of behauptet) if (!geschrieben.has(s)) bad.push('Hilfetext nennt „' + s + '“, die CSV schreibt ' + Array.from(geschrieben).join(' / '));
    if (!behauptet.length) bad.push('Hilfetext nennt keinen Platzhalter für fehlende Zahlen');
    if (!/leere Zelle/.test(text)) bad.push('Hilfetext sagt nicht, dass fehlender Text als leere Zelle steht');
    check('I5b', 'Hilfetext Schritt 0 nennt die Platzhalter, die die CSV schreibt: Zahl −99 mit den Stellen der Spalte, Text leer',
      a >= 0 && b > a && !bad.length, bad.length ? bad.join(' | ') : (text.match(/[^.]*CSV[^.]*\./) || [''])[0].trim());
  }
  {
    /* Der Browser-Test muss unter Windows laufen (Regel: keine Shell-Annahmen, Pfade über path.join).
       Früher startete er Chromium fest aus /opt/pw-browsers/chromium und lud nur playwright-core. */
    const bt = fs.readFileSync(path.join(ROOT, 'pruefung', 'browser-test.js'), 'utf8');
    const bad = [];
    if (/executablePath\s*:\s*['"`]/.test(bt)) bad.push('executablePath als fester Text');
    const pfad = /['"`]\/(?:opt|usr|home|tmp|root)\/[^'"`]*['"`]/.exec(bt);
    if (pfad) bad.push('absoluter Linux-Pfad ' + pfad[0]);
    if (!/require\(\s*['"]playwright['"]\s*\)/.test(bt)) bad.push('kein Rückfall auf das Paket playwright (globale Installation)');
    if (!/VARE_CHROMIUM/.test(bt)) bad.push('Chromium-Pfad nicht über VARE_CHROMIUM wählbar');
    check('I5c', 'Browser-Test ohne festen Linux-Pfad: Chromium aus VARE_CHROMIUM, einem vorhandenen Prüfpfad oder der Playwright-Installation; playwright-core oder playwright',
      !bad.length, bad.join(' | ') || 'ok');
  }
  {
    /* README gegen den Code: Zahlen, die dort stehen, kommen aus den Konstanten des Kerns und aus csv.js.
       Früher nannte es ein 30-ms-Fenster (Kern: 35 ms), 177 Kriterien und „nur N Resonanzen“. */
    const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), bad = [];
    const soll = ['Kern ' + D.VERSION,
      'Fenster ' + Math.round(D.FINE_WINDOW_S * 1000) + ' ms', 'Raster ' + Math.round(D.FINE_HOP_S * 1000) + ' ms',
      'Untergrenze ' + D.FINE_FMIN + ' Hz', 'Tiefpass ' + D.FINE_LOWPASS_HZ + ' Hz',
      D.WINDOWS.map(w => String(w.toFixed(2)).replace('.', ',')).join(' / ') + ' s', D.ORDERS.join(' / '),
      'unter ' + D.SPREAD_MAX_HZ + ' Hz', 'mindestens ' + D.DROP_MIN_DB + ' dB', 'bis ' + D.F_PEAK_MAX_HZ + ' Hz',
      'nie unter ' + D.F0_MIN_HZ + ' Hz', C.TAKE_COLUMNS.length + ' Spalten je Take, ' + C.FRAME_COLUMNS.length + ' je Rahmen'];
    for (const s of soll) if (md.indexOf(s) < 0) bad.push('fehlt „' + s + '“');
    const sich = /## JSON-Sicherung\s+Version (\d+)/.exec(md);
    if (!sich || +sich[1] !== C.BACKUP_VERSION) bad.push('JSON-Sicherung: README Version ' + (sich ? sich[1] : '?') + ', csv.js ' + C.BACKUP_VERSION);
    check('I5d', 'README nennt den Stand des Codes: Kernversion, Feinspur (Fenster, Raster, Untergrenze, Tiefpass), Gültigkeitsregeln, Spaltenzahl, Sicherungsversion',
      !bad.length, bad.join(' | ') || soll.join(' · '));
  }
  {
    /* Jeder Grund, den die Anzeige für einen ungültigen Formanten nennen kann (chronik.js formantGruende,
       live und im Hover), und jedes Kriterienmodul steht im README; Tonsprünge heißen dort neutral. */
    const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), bad = [];
    const CH = require(path.join(ROOT, 'chronik.js')).VARECHRONIK, gruende = new Set();
    // Seit Kern 4.1 auch die Slot-Gründe 'teilton' und 'wechsel' (A3): Sie müssen ebenso in der Tabelle stehen.
    for (const F of [NaN, 500]) for (const grund of [undefined, '', 'nummer', 'verschmolzen', 'teilton', 'wechsel', '?']) for (const rauschBoden of [undefined, false, true])
      for (const sdWin of [undefined, 0, 200]) for (const sdOrder of [undefined, 0, 200]) for (const nWin of [undefined, 1, 2, 4]) for (const nOrders of [undefined, 1, 3]) for (const smax of [undefined, 130])
        for (const g of CH.formantGruende({ F, grund, rauschBoden, sdWin, sdOrder, nWin, nOrders, smax })) gruende.add(g.replace(/ [\d.,−-]+ Hz$/, ''));
    // In der Tabelle „Grund | heißt“ gesucht, nicht irgendwo im Text: Wörter wie „nur eine Ordnung“ stehen
    // auch in anderen Sätzen und täuschten sonst eine Erklärung vor.
    const tab = /\| Grund \| heißt \|\r?\n\|---\|---\|\r?\n((?:\|.*\r?\n)+)/.exec(md);
    const zellen = tab ? tab[1].split(/\r?\n/).filter(Boolean).map(z => z.split('|')[1]) : [];
    if (!zellen.length) bad.push('Tabelle „Grund | heißt“ fehlt');
    for (const g of gruende) if (!zellen.some(z => z.indexOf(g) >= 0)) bad.push('Grund „' + g + '“ fehlt in der Tabelle');
    if (md.indexOf(CH.BANDBREITE_TEXT) < 0) bad.push('„' + CH.BANDBREITE_TEXT + '“ fehlt');
    const module = fs.readdirSync(__dirname).filter(f => /\.js$/.test(f)).sort();
    for (const f of module) if (md.indexOf('`' + f + '`') < 0) bad.push('Modul ' + f + ' fehlt');
    const register = (md.match(/.?Registerwechsel/g) || []).filter(s => s[0] !== '„');
    if (register.length) bad.push(register.length + '× „Registerwechsel“ als Begriff');
    for (const k of ['Tonsprünge ≥ 5 HT, gehalten ≥ 90 ms', 'kurze Kanten unter 90 ms']) if (md.indexOf(k) < 0) bad.push('Kachelname „' + k + '“ fehlt');
    check('I5e', 'README erklärt jeden Grund für „ungültig“, den die Anzeige nennen kann, nennt jedes Kriterienmodul und die Tonsprünge mit den neutralen Namen der Anzeige',
      gruende.size >= 10 && module.length >= 10 && !bad.length, bad.length ? bad.join(' | ') : gruende.size + ' Gründe, ' + module.length + ' Module');
  }
};
module.exports.es5Funde = es5Funde;

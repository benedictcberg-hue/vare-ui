/* I5 — Endkontrolle: Browserdateien in ES5, Hilfetexte und README gegen das, was der Code tut.
   I5a: Jede Browserdatei (alle *.js im Hauptordner außer test_dsp.js) ist ES5-Syntax. Ein Parser im
        ES5-Modus steht in CI nicht zur Verfügung (keine Abhängigkeiten), darum ein eigener Abtaster: Er
        überspringt Kommentare, Zeichenketten und reguläre Ausdrücke und meldet Schlüsselwörter und
        Zeichen, die es erst ab ES2015 gibt. Er ist ein Stolperdraht, kein vollständiger Parser.
   I5b: Der Hilfetext zu Schritt 0 (index.html) nennt die Platzhalter, die die CSV wirklich schreibt.
   I5c: Der Browser-Test läuft auch unter Windows: kein fest eingetragener Linux-Pfad. */
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
  const { check, C } = H;
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
    const a = html.indexOf('<h2>Schritt 0'), b = html.indexOf('<h2>Take</h2>');
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
};
module.exports.es5Funde = es5Funde;

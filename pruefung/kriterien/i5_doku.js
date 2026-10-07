/* I5 — Endkontrolle: Browserdateien in ES5, Hilfetexte und README gegen das, was der Code tut.
   I5a: Jede Browserdatei (alle *.js im Hauptordner außer test_dsp.js) ist ES5-Syntax. Ein Parser im
        ES5-Modus steht in CI nicht zur Verfügung (keine Abhängigkeiten), darum ein eigener Abtaster: Er
        überspringt Kommentare, Zeichenketten und reguläre Ausdrücke und meldet Schlüsselwörter und
        Zeichen, die es erst ab ES2015 gibt. Er ist ein Stolperdraht, kein vollständiger Parser. */
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
  const { check } = H;
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
};
module.exports.es5Funde = es5Funde;

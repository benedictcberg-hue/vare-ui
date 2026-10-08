# Kriterienmodule

Jede Datei `*.js` hier exportiert `module.exports = async function (H) { ... }`.
`H` enthält die Hilfen aus `test_dsp.js`: `check, near, r0, r1, r2, noise, tone, concat, scale, dbToLin,
SR, TSR, BW5, CASES, D, V, A, C, W, glide`.

`node test_dsp.js` lädt alle Module alphabetisch nach den eingebauten Kriterien. Ein Modul, das eine
Ausnahme wirft, zählt als gerissenes Kriterium.

Regel wie im ganzen Prüflauf: Reißt ein Kriterium, ist das ein Befund. Die Schwelle wird nicht angehoben.

Testsignale verwenden allgemeine Baritonwerte, keine Messwerte einer bestimmten Stimme.

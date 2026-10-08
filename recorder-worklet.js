/* VARE — AudioWorklet-Prozessor: bündelt 128er-Blöcke zu 2048er-Stücken und schickt sie an den Hauptfaden.
   Eigene Datei, keine Blob-URL (Vorgabe). ES5-Syntax wie alle Browserdateien: registerProcessor verlangt
   keine class, nur einen Konstruktor, dessen Objekt aus AudioWorkletProcessor entsteht. Reflect.construct
   baut es mit dem Prototyp von VareCapture; AudioWorkletProcessor.call(this) wäre ohne new verboten.
   Jedes Stück trägt den Rahmenzähler seines ersten Abtastwerts (currentFrame des Kontexts) und die Uhrzeit
   beim Absenden, gemessen im Audiofaden: { s: Abtastwerte, f: Rahmen, t: Date.now() }. Daran erkennt
   recorder.js Lücken — Rahmen ohne Eingang (Gerät weg) und Zeit ohne Rahmen (Kontext angehalten) —, ohne
   dass ein beschäftigter Hauptfaden sie vortäuscht. Fehlt der Eingang mitten im Stück, geht das angefangene
   Stück sofort ab: Ein Stück enthält nie Abtastwerte von beiden Seiten einer Lücke. */
function VareCapture() {
  var self = Reflect.construct(AudioWorkletProcessor, [], VareCapture);
  self.buf = new Float32Array(2048); self.pos = 0; self.frame = NaN;
  return self;
}
VareCapture.prototype = Object.create(AudioWorkletProcessor.prototype);
VareCapture.prototype.constructor = VareCapture;
Object.setPrototypeOf(VareCapture, AudioWorkletProcessor);
VareCapture.prototype.senden = function () {
  var out = this.pos === this.buf.length ? this.buf : this.buf.slice(0, this.pos);
  this.port.postMessage({ s: out, f: this.frame, t: Date.now() }, [out.buffer]);
  this.buf = new Float32Array(2048); this.pos = 0;
};
VareCapture.prototype.process = function (inputs) {
  var ch = inputs[0] && inputs[0][0];
  if (!ch) return true;
  var f = (typeof currentFrame === 'number') ? currentFrame : NaN;
  if (this.pos > 0 && isFinite(f) && f !== this.frame + this.pos) this.senden();
  for (var i = 0; i < ch.length; i++) {
    if (this.pos === 0) this.frame = f + i;
    this.buf[this.pos++] = ch[i];
    if (this.pos === this.buf.length) this.senden();
  }
  return true;
};
registerProcessor('vare-capture', VareCapture);

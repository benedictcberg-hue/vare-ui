/* VARE — AudioWorklet-Prozessor: bündelt 128er-Blöcke zu 2048er-Stücken und schickt sie an den Hauptfaden.
   Eigene Datei, keine Blob-URL (Vorgabe). ES5-Syntax wie alle Browserdateien: registerProcessor verlangt
   keine class, nur einen Konstruktor, dessen Objekt aus AudioWorkletProcessor entsteht. Reflect.construct
   baut es mit dem Prototyp von VareCapture; AudioWorkletProcessor.call(this) wäre ohne new verboten. */
function VareCapture() {
  var self = Reflect.construct(AudioWorkletProcessor, [], VareCapture);
  self.buf = new Float32Array(2048); self.pos = 0;
  return self;
}
VareCapture.prototype = Object.create(AudioWorkletProcessor.prototype);
VareCapture.prototype.constructor = VareCapture;
Object.setPrototypeOf(VareCapture, AudioWorkletProcessor);
VareCapture.prototype.process = function (inputs) {
  var ch = inputs[0] && inputs[0][0];
  if (!ch) return true;
  for (var i = 0; i < ch.length; i++) {
    this.buf[this.pos++] = ch[i];
    if (this.pos === this.buf.length) {
      var out = this.buf;
      this.port.postMessage(out, [out.buffer]);
      this.buf = new Float32Array(2048); this.pos = 0;
    }
  }
  return true;
};
registerProcessor('vare-capture', VareCapture);

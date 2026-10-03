/* VARE — AudioWorklet-Prozessor: bündelt 128er-Blöcke zu 2048er-Stücken und schickt sie an den Hauptfaden.
   Eigene Datei, keine Blob-URL (Vorgabe). */
class VareCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.pos = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.pos++] = ch[i];
      if (this.pos === this.buf.length) {
        const out = this.buf;
        this.port.postMessage(out, [out.buffer]);
        this.buf = new Float32Array(2048); this.pos = 0;
      }
    }
    return true;
  }
}
registerProcessor('vare-capture', VareCapture);

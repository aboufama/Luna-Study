class LabCapture extends AudioWorkletProcessor {
  constructor(options) { super(); this.rate = options.processorOptions.rate; this.ratio = sampleRate / this.rate; this.phase = 0; this.sum = 0; this.count = 0; this.frame = []; }
  process(inputs) {
    const input = inputs[0]?.[0]; if (!input) return true;
    for (const value of input) {
      this.sum += value; this.count++; this.phase++;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio; this.frame.push(this.sum / this.count); this.sum = 0; this.count = 0;
        if (this.frame.length >= this.rate / 50) { const frame = Float32Array.from(this.frame); this.port.postMessage(frame, [frame.buffer]); this.frame = []; }
      }
    }
    return true;
  }
}
registerProcessor('lab-capture', LabCapture);

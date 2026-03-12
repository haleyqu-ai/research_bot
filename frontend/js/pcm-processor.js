/**
 * AudioWorklet processor — downsample mic input to 16kHz 16-bit PCM mono.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    // Mono channel float32 samples at sampleRate (usually 44100 or 48000)
    const float32 = input[0];

    // Downsample to 16kHz
    const ratio = sampleRate / 16000;
    for (let i = 0; i < float32.length; i += ratio) {
      const idx = Math.floor(i);
      const sample = Math.max(-1, Math.min(1, float32[idx]));
      // Convert float32 → int16
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this._buffer.push(int16);
    }

    // Send in chunks of 3200 samples (~200ms at 16kHz)
    while (this._buffer.length >= 3200) {
      const chunk = this._buffer.splice(0, 3200);
      const pcm = new Int16Array(chunk);
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);

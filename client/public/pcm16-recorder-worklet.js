/**
 * AudioWorklet processor: capture mic float32 samples, downsample to 24kHz,
 * convert to PCM16, and post back ArrayBuffer chunks (~80ms each).
 *
 * Why 24 kHz : OpenAI Realtime API expects pcm16 at 24 000 Hz mono.
 * The browser AudioContext is usually 48 kHz, so we average pairs of samples
 * (simple downsample by 2) to get 24 kHz.
 */
class PCM16RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._chunkSamples = 1920; // 80ms @ 24kHz = 1920 samples
    this._inputRate = sampleRate; // built-in global = AudioContext sample rate
    this._ratio = this._inputRate / 24000;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    // Downsample float32 from inputRate to 24kHz (linear average)
    if (this._ratio === 1) {
      for (let i = 0; i < channel.length; i++) this._buffer.push(channel[i]);
    } else {
      let i = 0;
      while (i < channel.length) {
        const end = Math.min(channel.length, Math.ceil(i + this._ratio));
        let sum = 0;
        let count = 0;
        for (let j = Math.floor(i); j < end; j++) {
          sum += channel[j];
          count++;
        }
        this._buffer.push(count > 0 ? sum / count : 0);
        i += this._ratio;
      }
    }

    // Emit PCM16 chunks of 1920 samples
    while (this._buffer.length >= this._chunkSamples) {
      const slice = this._buffer.splice(0, this._chunkSamples);
      const pcm16 = new Int16Array(slice.length);
      for (let k = 0; k < slice.length; k++) {
        let s = Math.max(-1, Math.min(1, slice[k]));
        pcm16[k] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm16-recorder", PCM16RecorderProcessor);

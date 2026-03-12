/**
 * Speech recognition manager — streams mic audio via WebSocket to
 * DashScope Paraformer real-time STT on the backend (/ws/stt).
 *
 * Preserves the same public interface:
 *   constructor(language, sttWsUrl?)
 *   startListening(onInterim, onFinal)
 *   stopListening()
 *   getLastResult()
 *   setLanguage(language)
 */

export class SpeechManager {
  constructor(language, sttWsUrl) {
    this.language = language;
    this.sttWsUrl = sttWsUrl || this._defaultWsUrl();
    this.lastResult = '';
    this.isListening = false;
    this.onInterim = null;
    this.onFinal = null;

    // Audio capture
    this._stream = null;
    this._audioCtx = null;
    this._workletNode = null;

    // STT WebSocket
    this._ws = null;
    this._wsReady = false;
    this._pendingText = '';
  }

  _defaultWsUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${window.location.host}/ws/stt`;
  }

  async startListening(onInterim, onFinal) {
    this.lastResult = '';
    this._pendingText = '';
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.isListening = true;

    try {
      // 1. Open mic
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: { ideal: 48000 },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // 2. Set up AudioWorklet for PCM conversion
      this._audioCtx = new AudioContext({ sampleRate: 48000 });
      await this._audioCtx.audioWorklet.addModule('/js/pcm-processor.js');

      const source = this._audioCtx.createMediaStreamSource(this._stream);
      this._workletNode = new AudioWorkletNode(this._audioCtx, 'pcm-processor');

      // 3. Connect STT WebSocket
      await this._connectSTT();

      // 4. Forward PCM chunks to WebSocket
      this._workletNode.port.onmessage = (e) => {
        if (this._ws && this._wsReady) {
          this._ws.send(e.data); // ArrayBuffer of PCM int16
        }
      };

      source.connect(this._workletNode);
      this._workletNode.connect(this._audioCtx.destination); // Required to keep processing

    } catch (err) {
      console.error('[Speech] Start error:', err);
      this.isListening = false;
    }
  }

  async _connectSTT() {
    return new Promise((resolve, reject) => {
      this._ws = new WebSocket(this.sttWsUrl);
      this._wsReady = false;

      this._ws.onopen = () => {
        // Send init with language
        this._ws.send(JSON.stringify({ language: this.language }));
      };

      this._ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'stt_ready') {
          this._wsReady = true;
          resolve();
          return;
        }

        if (data.type === 'stt_result') {
          if (data.is_final) {
            this._pendingText += data.text;
            this.lastResult = this._pendingText;
            if (this.onFinal) this.onFinal(this._pendingText);
          } else {
            const interim = this._pendingText + data.text;
            if (this.onInterim) this.onInterim(interim);
          }
        }
      };

      this._ws.onerror = (err) => {
        console.error('[Speech] STT WS error:', err);
        reject(err);
      };

      this._ws.onclose = () => {
        this._wsReady = false;
      };

      // Timeout
      setTimeout(() => {
        if (!this._wsReady) reject(new Error('STT WS timeout'));
      }, 10000);
    });
  }

  stopListening() {
    this.isListening = false;

    // Stop audio capture
    if (this._workletNode) {
      this._workletNode.disconnect();
      this._workletNode = null;
    }
    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {});
      this._audioCtx = null;
    }
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }

    // Signal backend to stop, then close
    if (this._ws) {
      try {
        if (this._wsReady) {
          this._ws.send(JSON.stringify({ action: 'stop' }));
        }
      } catch (_) {}
      setTimeout(() => {
        if (this._ws) {
          this._ws.close();
          this._ws = null;
        }
      }, 500);
      this._wsReady = false;
    }
  }

  getLastResult() {
    return this.lastResult;
  }

  setLanguage(language) {
    this.language = language;
  }
}

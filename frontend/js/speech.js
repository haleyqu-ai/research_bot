/**
 * Speech recognition manager — streams mic audio via WebSocket to
 * DashScope Paraformer real-time STT on the backend (/ws/stt).
 *
 * Public interface:
 *   constructor(language, sttWsUrl?)
 *   startListening(onInterim, onFinal)
 *   stopListening()          — fire-and-forget stop
 *   stopAndGetResult(timeout) — stop and wait for final text (Promise)
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
    this._latestInterim = '';  // Track latest interim text as fallback
    this._connectError = false; // Track if STT connection failed

    // Promise resolved when a final result arrives after stop
    this._stopResolve = null;
    this._stopTimeoutId = null;
    this._stopWsRef = null;  // WS ref for the active stop cycle
  }

  _defaultWsUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${window.location.host}/ws/stt`;
  }

  async startListening(onInterim, onFinal) {
    // Close any lingering WS from a previous session before starting fresh
    if (this._ws) {
      try { this._ws.close(); } catch (_) {}
      this._ws = null;
      this._wsReady = false;
    }
    // Cancel any pending stop timeout from previous session
    if (this._stopTimeoutId) {
      clearTimeout(this._stopTimeoutId);
      this._stopTimeoutId = null;
    }

    this.lastResult = '';
    this._pendingText = '';
    this._latestInterim = '';
    this._connectError = false;
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.isListening = true;
    this._stopResolve = null;
    this._stopWsRef = null;

    try {
      // 1. Open mic
      console.log('[Speech] Step 1: Requesting mic access...');
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: { ideal: 48000 },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      console.log('[Speech] Step 1: Mic access granted');

      // 2. Set up AudioWorklet for PCM conversion
      console.log('[Speech] Step 2: Setting up AudioWorklet...');
      this._audioCtx = new AudioContext({ sampleRate: 48000 });
      await this._audioCtx.audioWorklet.addModule('/js/pcm-processor.js');
      console.log('[Speech] Step 2: AudioWorklet loaded');

      const source = this._audioCtx.createMediaStreamSource(this._stream);
      this._workletNode = new AudioWorkletNode(this._audioCtx, 'pcm-processor');

      // 3. Connect STT WebSocket
      console.log('[Speech] Step 3: Connecting STT WebSocket...');
      await this._connectSTT();
      console.log('[Speech] Step 3: STT WebSocket ready');

      // 4. Forward PCM chunks to WebSocket
      let chunkCount = 0;
      this._workletNode.port.onmessage = (e) => {
        if (this._ws && this._wsReady && this._ws.readyState === WebSocket.OPEN) {
          chunkCount++;
          if (chunkCount <= 3 || chunkCount % 50 === 0) {
            console.log(`[Speech] Sending audio chunk #${chunkCount}, size=${e.data.byteLength}`);
          }
          this._ws.send(e.data); // ArrayBuffer of PCM int16
        }
      };

      source.connect(this._workletNode);
      this._workletNode.connect(this._audioCtx.destination);
      console.log('[Speech] Audio pipeline connected, listening...');

    } catch (err) {
      console.error('[Speech] Start error:', err);
      this._connectError = true;
      this.isListening = false;
      // Clean up partial setup
      this._stopAudioCapture();
      this._closeWs();
      throw err; // Propagate so caller can show error UI
    }
  }

  async _connectSTT() {
    return new Promise((resolve, reject) => {
      this._ws = new WebSocket(this.sttWsUrl);
      this._wsReady = false;

      this._ws.onopen = () => {
        this._ws.send(JSON.stringify({ language: this.language }));
      };

      this._ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'stt_ready') {
          this._wsReady = true;
          resolve();
          return;
        }

        if (data.type === 'stt_error') {
          console.error('[Speech] STT backend error:', data.message);
          this._connectError = true;
          reject(new Error(data.message || 'STT connection failed'));
          return;
        }

        if (data.type === 'stt_processing') {
          // Server is processing audio — reset timeout to give Google Cloud full time
          console.log('[Speech] Server is processing audio, extending timeout...');
          if (this._stopTimeoutId) {
            clearTimeout(this._stopTimeoutId);
            this._stopTimeoutId = this._createStopTimeout(15000);
          }
          return;
        }

        if (data.type === 'stt_result') {
          if (data.is_final) {
            this._pendingText += data.text;
            this.lastResult = this._pendingText;
            console.log('[Speech] Final result:', this.lastResult);
            if (this.onFinal) this.onFinal(this._pendingText);
            // Resolve the stop promise if waiting, then close WS immediately
            if (this._stopResolve) {
              // Cancel pending timeout — we got the result
              if (this._stopTimeoutId) {
                clearTimeout(this._stopTimeoutId);
                this._stopTimeoutId = null;
              }
              this._stopResolve(this.lastResult);
              this._stopResolve = null;
              // Close WS right away — result received, no need to wait for timeout
              this._closeWs();
            }
          } else {
            this._latestInterim = data.text;
            const interim = this._pendingText + data.text;
            console.log('[Speech] Interim:', interim);
            if (this.onInterim) this.onInterim(interim);
          }
        }
      };

      this._ws.onerror = (err) => {
        console.error('[Speech] STT WS error:', err);
        reject(err);
      };

      // Capture ref so onclose only affects THIS connection, not a newer one
      const wsRef = this._ws;
      this._ws.onclose = (event) => {
        console.log(`[Speech] WS closed: code=${event.code} reason="${event.reason}" wasClean=${event.wasClean}`);
        // Only update state if this is still the active WS
        if (this._ws === wsRef) {
          this._wsReady = false;
          // If still waiting for stop result, resolve with best available text
          if (this._stopResolve) {
            const best = this.lastResult || (this._pendingText + this._latestInterim) || '';
            console.log('[Speech] Resolving stop with:', best);
            this._stopResolve(best);
            this._stopResolve = null;
          }
        }
      };

      setTimeout(() => {
        if (!this._wsReady) reject(new Error('STT WS timeout'));
      }, 10000);
    });
  }

  /**
   * Stop listening and return a Promise that resolves with the final text.
   * Waits up to `timeoutMs` for the server to return the result.
   * The timeout resets when the server sends `stt_processing`.
   *
   * Stop sequence (order matters!):
   * 1. Flush remaining audio from the AudioWorklet buffer
   * 2. Wait 250ms for flush + in-flight chunks to reach WS
   * 3. Send "stop" signal to server
   * 4. Server processes all buffered audio → returns result
   * 5. Disconnect audio capture after stop is sent
   */
  stopAndGetResult(timeoutMs = 15000) {
    console.log('[Speech] stopAndGetResult called. wsReady:', this._wsReady, 'connectError:', this._connectError, 'hasWs:', !!this._ws);
    this.isListening = false;

    // If connection failed or no WS, clean up and return immediately
    if (this._connectError || !this._ws) {
      console.log('[Speech] No STT connection, returning empty');
      this._stopAudioCapture();
      this._closeWs();
      return Promise.resolve(this.lastResult || '');
    }

    // If we already have a result, clean up and return it
    if (this.lastResult) {
      this._stopAudioCapture();
      this._closeWs();
      return Promise.resolve(this.lastResult);
    }

    // Capture current WS reference
    const wsRef = this._ws;
    this._stopWsRef = wsRef;

    // Step 1: Flush remaining audio from the worklet buffer
    if (this._workletNode) {
      try {
        this._workletNode.port.postMessage('flush');
        console.log('[Speech] Sent flush to AudioWorklet');
      } catch (_) {}
    }

    // Step 2: Wait 250ms for flush + in-flight chunks, then send stop
    return new Promise((resolve) => {
      this._stopResolve = resolve;

      setTimeout(() => {
        // Step 3: Send stop signal to server (all audio should be delivered by now)
        try {
          if (this._wsReady && wsRef.readyState === WebSocket.OPEN) {
            wsRef.send(JSON.stringify({ action: 'stop' }));
            console.log('[Speech] Sent stop signal to server');
          }
        } catch (e) {
          console.warn('[Speech] Failed to send stop:', e);
        }

        // Step 5: Now safe to disconnect audio capture
        this._stopAudioCapture();

        // Start resettable timeout
        this._stopTimeoutId = this._createStopTimeout(timeoutMs);
      }, 250);
    });
  }

  /**
   * Create (or recreate) the stop timeout. Returns the timeout ID.
   * Called initially by stopAndGetResult and reset by stt_processing.
   */
  _createStopTimeout(ms) {
    const wsRef = this._stopWsRef;
    return setTimeout(() => {
      this._stopTimeoutId = null;
      if (this._stopResolve) {
        const best = this.lastResult || (this._pendingText + this._latestInterim) || '';
        console.log('[Speech] Timeout, resolving with:', best);
        this._stopResolve(best);
        this._stopResolve = null;
      }
      // Only close if this is still the active WS (not replaced by a new session)
      if (this._ws === wsRef) {
        this._closeWs();
      } else if (wsRef) {
        try { wsRef.close(); } catch (_) {}
      }
    }, ms);
  }

  /** Fire-and-forget stop (backward compat). */
  stopListening() {
    this.isListening = false;
    this._stopAudioCapture();

    if (this._ws) {
      const wsRef = this._ws;
      try {
        if (this._wsReady) {
          wsRef.send(JSON.stringify({ action: 'stop' }));
        }
      } catch (_) {}
      // Only close this specific WS, not a newer one from a subsequent session
      setTimeout(() => {
        if (this._ws === wsRef) {
          this._closeWs();
        } else {
          try { wsRef.close(); } catch (_) {}
        }
      }, 3000);
      this._wsReady = false;
    }
  }

  _stopAudioCapture() {
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
  }

  _closeWs() {
    if (this._ws) {
      try { this._ws.close(); } catch (_) {}
      this._ws = null;
    }
    this._wsReady = false;
  }

  getLastResult() {
    return this.lastResult;
  }

  setLanguage(language) {
    this.language = language;
  }
}

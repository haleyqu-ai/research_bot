/**
 * Avatar manager — TalkingHead 3D avatar with audio-driven lip-sync.
 *
 * Uses pre-built TalkingHead-compatible GLB models with:
 *   - Mixamo armature (skeleton)
 *   - 52 ARKit facial blend shapes (eye blink, jaw, lips, brows)
 *   - 15 Oculus viseme shape keys (lip-sync)
 *
 * For CJK languages (Chinese, Japanese, Korean), generates viseme
 * sequences from audio amplitude analysis so lip-sync works without
 * a dedicated phoneme→viseme language module.
 */

import { TalkingHead } from "talkinghead";

// Available TalkingHead lip-sync modules
const AVAILABLE_LIPSYNC = new Set(['en', 'de', 'fr', 'fi', 'lt']);

// Languages that have native lip-sync modules (word→phoneme→viseme)
const LIPSYNC_LANG_MAP = {
  en: 'en', de: 'de', fr: 'fr',
};

// Languages that need audio-amplitude lip-sync (no native module)
const NEEDS_AUDIO_LIPSYNC = new Set(['zh', 'ja', 'ko', 'es', 'pt', 'ru', 'it']);

// Avatar GLB files — TalkingHead-compatible models with full facial animation
const AVATAR_URLS = {
  female: '/assets/avatars/brunette.glb',   // Ready Player Me brunette (F)
  male:   '/assets/avatars/avatarsdk.glb',  // Avatar SDK male (M)
};

// TalkingHead mood mapping from our emotion names
const MOOD_MAP = {
  friendly: 'happy',
  interested: 'happy',
  empathetic: 'sad',
  surprised: 'happy',
  thinking: 'neutral',
  grateful: 'love',
  encouraging: 'happy',
  listening: 'neutral',
  neutral: 'neutral',
};


export class AvatarManager {
  constructor(container) {
    this.container = container;
    this.head = null;
    this.language = 'en';
    this.ready = false;
    this._useAudioLipsync = false;
    this._nodInterval = null;
  }

  async init(avatarType, language = 'en') {
    this.language = language;
    this._useAudioLipsync = NEEDS_AUDIO_LIPSYNC.has(language);

    // Determine lip-sync modules to load
    const lipsyncLang = LIPSYNC_LANG_MAP[language] || 'en';
    const modules = ['en'];
    if (lipsyncLang !== 'en' && AVAILABLE_LIPSYNC.has(lipsyncLang)) {
      modules.push(lipsyncLang);
    }

    // Instantiate TalkingHead
    this.head = new TalkingHead(this.container, {
      ttsEndpoint: null,
      ttsApikey: null,
      lipsyncModules: modules,
      lipsyncLang: lipsyncLang,
      cameraView: 'upper',
      modelFPS: 30,
      avatarMood: 'neutral',
      avatarIdleEyeContact: 0.6,
      avatarIdleHeadMove: 0.6,
    });

    // Load avatar
    const url = AVATAR_URLS[avatarType] || AVATAR_URLS.female;
    const body = avatarType === 'male' ? 'M' : 'F';

    await this.head.showAvatar({
      url,
      body,
      avatarMood: 'neutral',
      lipsyncLang: lipsyncLang,
      baseline: {
        headRotateX: -0.05,
        eyeBlinkLeft: 0.15,
        eyeBlinkRight: 0.15,
      },
    }, (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.round(ev.loaded / ev.total * 100);
        console.log(`Avatar loading: ${pct}%`);
      }
    });

    this.ready = true;

    // Handle visibility change to save resources
    document.addEventListener('visibilitychange', () => {
      if (!this.head) return;
      if (document.visibilityState === 'visible') {
        this.head.start();
      } else {
        this.head.stop();
      }
    });
  }

  // ── Emotion & Expression ──────────────────────────────────────

  setEmotion(emotion) {
    if (!this.head || !this.ready) return;
    const mood = MOOD_MAP[emotion] || 'neutral';
    try {
      this.head.setMood(mood);
    } catch (e) {
      console.warn('setMood error:', e);
    }
  }

  /** Nod the head (e.g. when acknowledging user input). */
  nod() {
    if (!this.head || !this.ready) return;
    try { this.head.playGesture('nod'); } catch (e) {}
  }

  /** Enter "listening" mode: eye contact + periodic nods. */
  startListening() {
    if (!this.head || !this.ready) return;
    this.setEmotion('listening');
    try { this.head.lookAtCamera(500); } catch (e) {}
    // Nod occasionally while user is speaking
    this.stopListening();
    this._nodInterval = setInterval(() => {
      if (Math.random() > 0.5) this.nod();
    }, 3000);
  }

  stopListening() {
    if (this._nodInterval) {
      clearInterval(this._nodInterval);
      this._nodInterval = null;
    }
  }

  /** "Thinking" pose: look slightly up/away, neutral mood. */
  startThinking() {
    if (!this.head || !this.ready) return;
    this.setEmotion('thinking');
    try { this.head.lookAt(-0.3, -0.5, 600); } catch (e) {}
  }

  /** Return to friendly, camera-facing state. */
  resetToFriendly() {
    if (!this.head || !this.ready) return;
    this.stopListening();
    this.setEmotion('friendly');
    try { this.head.lookAtCamera(400); } catch (e) {}
  }

  // ── Audio-Amplitude Viseme Generation ─────────────────────────

  /**
   * Analyze an AudioBuffer's waveform and generate a viseme sequence.
   * Maps audio RMS amplitude to Oculus viseme IDs at ~50ms intervals.
   * Works for ANY language — no text/phoneme processing needed.
   */
  _generateVisemesFromAudio(decoded) {
    const channelData = decoded.getChannelData(0);
    const sampleRate = decoded.sampleRate;
    const frameMs = 50; // 50ms per frame → 20 visemes/sec
    const frameSamples = Math.floor(sampleRate * frameMs / 1000);

    const visemes = [];
    const vtimes = [];
    const vdurations = [];

    // Compute global max RMS for normalization
    let globalMaxRms = 0;
    for (let i = 0; i < channelData.length; i += frameSamples) {
      const end = Math.min(i + frameSamples, channelData.length);
      let sum = 0;
      for (let j = i; j < end; j++) sum += channelData[j] * channelData[j];
      const rms = Math.sqrt(sum / (end - i));
      if (rms > globalMaxRms) globalMaxRms = rms;
    }
    if (globalMaxRms < 0.001) globalMaxRms = 0.001;

    // Smoothing for natural transitions
    let prevLevel = 0;
    const smoothing = 0.4;

    for (let i = 0; i < channelData.length; i += frameSamples) {
      const end = Math.min(i + frameSamples, channelData.length);
      let sum = 0;
      for (let j = i; j < end; j++) sum += channelData[j] * channelData[j];
      const rms = Math.sqrt(sum / (end - i));
      const normalized = Math.min(rms / globalMaxRms, 1.0);

      // Smooth the level
      const level = prevLevel * smoothing + normalized * (1 - smoothing);
      prevLevel = level;

      // Map normalized level to viseme
      let viseme;
      if (level < 0.05) {
        viseme = 'sil';
      } else if (level < 0.15) {
        // Low energy: choose from closed/near-closed mouth shapes
        viseme = ['PP', 'FF', 'nn'][Math.floor(Math.random() * 3)];
      } else if (level < 0.35) {
        // Medium energy: mid-open shapes
        viseme = ['DD', 'kk', 'SS', 'TH'][Math.floor(Math.random() * 4)];
      } else if (level < 0.6) {
        // Medium-high: open shapes
        viseme = ['E', 'I', 'O'][Math.floor(Math.random() * 3)];
      } else {
        // High energy: wide open
        viseme = ['aa', 'O', 'U'][Math.floor(Math.random() * 3)];
      }

      const timeMs = Math.round((i / sampleRate) * 1000);
      visemes.push(viseme);
      vtimes.push(timeMs);
      vdurations.push(frameMs);
    }

    // Ensure we end with silence
    if (visemes.length > 0 && visemes[visemes.length - 1] !== 'sil') {
      visemes.push('sil');
      vtimes.push(vtimes[vtimes.length - 1] + frameMs);
      vdurations.push(frameMs);
    }

    return { visemes, vtimes, vdurations };
  }

  /**
   * Split text into words, with CJK-aware splitting.
   * CJK characters become individual "words" for better timing.
   */
  _splitWords(text) {
    // CJK Unicode ranges
    const cjkRegex = /[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
    const tokens = [];

    // Split on whitespace first
    const parts = text.split(/\s+/).filter(w => w.length > 0);
    for (const part of parts) {
      if (cjkRegex.test(part)) {
        // Split CJK parts character by character
        for (const ch of part) tokens.push(ch);
      } else {
        tokens.push(part);
      }
    }

    return tokens.length > 0 ? tokens : [text || ' '];
  }

  // ── Main Speech Method ────────────────────────────────────────

  /**
   * Speak with audio and lip-sync.
   * For languages with native lip-sync modules: uses word→phoneme→viseme.
   * For other languages (CJK etc.): generates visemes from audio amplitude.
   *
   * @param {ArrayBuffer} audioBuffer — raw audio bytes
   * @param {string} text — the text being spoken
   * @returns {Promise} resolves when speech ends
   */
  speakAudio(audioBuffer, text) {
    if (!this.head || !this.ready) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      try {
        const audioCtx = this.head.audioCtx;
        if (!audioCtx) {
          console.warn('[Avatar] No AudioContext');
          resolve();
          return;
        }

        const resumeAndPlay = async () => {
          if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
          }

          const bufCopy = audioBuffer.slice(0);
          audioCtx.decodeAudioData(bufCopy, (decoded) => {
            const duration = decoded.duration * 1000;
            console.log(`[Avatar] Audio decoded: ${(duration / 1000).toFixed(1)}s, using ${this._useAudioLipsync ? 'audio-amplitude' : 'word-based'} lip-sync`);

            let speakObj;

            if (this._useAudioLipsync) {
              // ── Audio-amplitude lip-sync (CJK and unsupported languages) ──
              const { visemes, vtimes, vdurations } = this._generateVisemesFromAudio(decoded);
              const words = this._splitWords(text);
              const wordDur = duration / words.length;
              const wtimes = words.map((_, i) => Math.round(i * wordDur));
              const wdurations = words.map(() => Math.round(wordDur));

              speakObj = {
                audio: decoded,
                words,
                wtimes,
                wdurations,
                visemes,
                vtimes,
                vdurations,
              };
              console.log(`[Avatar] Generated ${visemes.length} visemes from audio amplitude`);
            } else {
              // ── Word-based lip-sync (languages with native modules) ──
              const words = this._splitWords(text);
              const wordDur = duration / words.length;
              const wtimes = words.map((_, i) => Math.round(i * wordDur));
              const wdurations = words.map(() => Math.round(wordDur));

              speakObj = {
                audio: decoded,
                words,
                wtimes,
                wdurations,
              };
            }

            // Eye contact during speech
            try { this.head.lookAtCamera(300); } catch (e) {}

            const result = this.head.speakAudio(speakObj);
            if (result && typeof result.then === 'function') {
              result.then(() => resolve()).catch(() => resolve());
            } else {
              setTimeout(resolve, duration + 500);
            }
          }, (err) => {
            console.warn('[Avatar] Audio decode failed:', err);
            resolve();
          });
        };

        resumeAndPlay().catch((e) => {
          console.warn('[Avatar] resumeAndPlay error:', e);
          resolve();
        });
      } catch (e) {
        console.warn('[Avatar] speakAudio exception:', e);
        resolve();
      }
    });
  }

  destroy() {
    this.stopListening();
    if (this.head) {
      this.head.stop();
      this.head = null;
    }
    this.ready = false;
  }
}

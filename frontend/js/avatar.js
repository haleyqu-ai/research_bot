/**
 * Avatar manager — Pre-recorded video avatar.
 *
 * Replaces TalkingHead 3D lip-sync with pre-recorded video clips:
 *   - Opening: played during greeting phase
 *   - Speaking: looped while bot audio plays (question/general phases)
 *   - Listening: looped while user is speaking
 *   - Ending: played during farewell phase
 *
 * Videos play muted; audio comes from TTS via the backend.
 */

// Video clip library
const VIDEO_CLIPS = {
  opening:   ['/assets/videos/opening.mp4'],
  speaking:  ['/assets/videos/speaking-1.mp4', '/assets/videos/speaking-2.mp4', '/assets/videos/speaking-3.mp4'],
  listening: ['/assets/videos/listening-1.mp4', '/assets/videos/listening-2.mp4'],
  ending:    ['/assets/videos/ending-1.mp4', '/assets/videos/ending-2.mp4'],
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class AvatarManager {
  constructor(container) {
    this.container = container;
    this.video = null;
    this.ready = false;
    this.language = 'en';
    this._phase = 'greeting';
    this._currentCategory = null;
    this._preloaded = {};
  }

  async init(_avatarType, language = 'en', onProgress = null) {
    this.language = language;

    // Create the video element
    this.video = document.createElement('video');
    this.video.className = 'avatar-video';
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('webkit-playsinline', '');
    this.container.appendChild(this.video);

    // Preload all clips with progress tracking
    const allClips = Object.values(VIDEO_CLIPS).flat();
    let loaded = 0;
    const total = allClips.length;

    await Promise.all(allClips.map(src =>
      this._preloadVideo(src).then(() => {
        loaded++;
        if (onProgress) onProgress(loaded, total);
      })
    ));

    // Show first frame of opening video
    this.video.src = VIDEO_CLIPS.opening[0];
    this.video.load();

    this.ready = true;
    console.log(`[Avatar] Video avatar ready, ${allClips.length} clips preloaded`);
  }

  /** Prefetch a video into browser cache. */
  _preloadVideo(src) {
    return new Promise((resolve) => {
      if (this._preloaded[src]) { resolve(); return; }
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.src = src;
      v.oncanplaythrough = () => {
        this._preloaded[src] = true;
        resolve();
      };
      v.onerror = () => {
        console.warn(`[Avatar] Failed to preload: ${src}`);
        resolve();
      };
      v.load();
    });
  }

  // ── Phase control ──────────────────────────────────────────

  /** Set the current interview phase (greeting, question, farewell). */
  setPhase(phase) {
    this._phase = phase;
  }

  // ── Video playback helpers ─────────────────────────────────

  /**
   * Play a video from a category, optionally looping.
   * Returns when the video starts playing.
   */
  _playCategory(category, loop = true) {
    if (!this.video || !this.ready) return;
    this._currentCategory = category;

    const clips = VIDEO_CLIPS[category];
    if (!clips || clips.length === 0) return;

    const src = pickRandom(clips);
    this.video.src = src;
    this.video.loop = loop;
    this.video.currentTime = 0;
    this.video.play().catch(e => console.warn('[Avatar] Play error:', e));
  }

  /** Stop current video playback, pause on current frame. */
  _stopVideo() {
    if (!this.video) return;
    this.video.loop = false;
    this.video.pause();
    this._currentCategory = null;
  }

  // ── Main Speech Method ─────────────────────────────────────

  /**
   * Play bot speech: show matching video while audio plays.
   * Video is muted; audio plays through a separate Audio element.
   *
   * @param {ArrayBuffer} audioBuffer — raw audio bytes (mp3/wav)
   * @param {string} _text — the text being spoken (unused, kept for API compat)
   * @returns {Promise} resolves when audio playback ends
   */
  speakAudio(audioBuffer, _text) {
    if (!this.video || !this.ready) return Promise.resolve();

    return new Promise((resolve) => {
      // Choose video category based on phase
      let category = 'speaking';
      if (this._phase === 'greeting') category = 'opening';
      else if (this._phase === 'farewell') category = 'ending';

      // For greeting, the opening video is already playing from startInterview;
      // don't restart it — just let it continue. For other phases, start video.
      if (!(category === 'opening' && this._currentCategory === 'opening')) {
        const loop = category === 'speaking';
        this._playCategory(category, loop);
      }

      // Play TTS audio
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      const cleanup = () => {
        URL.revokeObjectURL(url);
        // Stop looping speaking videos when audio ends
        if (category === 'speaking') {
          this._stopVideo();
        }
        // For opening/ending, let video finish naturally
        resolve();
      };

      audio.onended = cleanup;
      audio.onerror = () => {
        console.warn('[Avatar] Audio playback error');
        cleanup();
      };

      audio.play().catch((e) => {
        console.warn('[Avatar] Audio play failed:', e);
        cleanup();
      });
    });
  }

  // ── Emotion & Expression (simplified for video avatar) ─────

  setEmotion(_emotion) {
    // No-op: video clips handle expressions
  }

  nod() {
    // No-op: video clips handle gestures
  }

  /** Enter "listening" mode: play a listening clip in loop. */
  startListening() {
    this._playCategory('listening', true);
  }

  stopListening() {
    if (this._currentCategory === 'listening') {
      this._stopVideo();
    }
  }

  /** "Thinking" pose: show a listening clip. */
  startThinking() {
    this._playCategory('listening', true);
  }

  /** Return to idle state. */
  resetToFriendly() {
    this.stopListening();
  }

  destroy() {
    this._stopVideo();
    if (this.video) {
      this.video.remove();
      this.video = null;
    }
    this.ready = false;
  }
}

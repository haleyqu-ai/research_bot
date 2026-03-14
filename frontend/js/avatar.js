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
  speaking:  ['/assets/videos/speaking-1.mp4', '/assets/videos/speaking-2.mp4', '/assets/videos/speaking-3.mp4', '/assets/videos/speaking-4.mp4'],
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
    this._currentAudio = null;
    this._onVideoEnded = null;
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
   * Play a video from a category with continuous looping.
   * When a clip ends, automatically picks a new random clip from the same category.
   */
  _playCategory(category, loop = true) {
    if (!this.video || !this.ready) return;
    this._currentCategory = category;

    // Remove previous ended handler
    if (this._onVideoEnded) {
      this.video.removeEventListener('ended', this._onVideoEnded);
      this._onVideoEnded = null;
    }

    const clips = VIDEO_CLIPS[category];
    if (!clips || clips.length === 0) return;

    const src = pickRandom(clips);
    this.video.src = src;
    this.video.loop = false; // We handle looping manually for seamless clip chaining
    this.video.currentTime = 0;

    if (loop) {
      this._onVideoEnded = () => {
        // Only continue if still in the same category
        if (this._currentCategory === category) {
          const nextSrc = pickRandom(clips);
          this.video.src = nextSrc;
          this.video.currentTime = 0;
          this.video.play().catch(e => console.warn('[Avatar] Loop play error:', e));
        }
      };
      this.video.addEventListener('ended', this._onVideoEnded);
    }

    this.video.play().catch(e => console.warn('[Avatar] Play error:', e));
  }

  /** Stop current video playback, pause on current frame. */
  _stopVideo() {
    if (!this.video) return;
    if (this._onVideoEnded) {
      this.video.removeEventListener('ended', this._onVideoEnded);
      this._onVideoEnded = null;
    }
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
      if (this._phase === 'farewell') category = 'ending';

      // For greeting, the opening video is already playing — let it finish,
      // then chain into speaking videos to keep avatar animated during long greeting audio.
      if (this._phase === 'greeting' && this._currentCategory === 'opening') {
        // When opening video ends, switch to looping speaking videos
        if (this._onVideoEnded) {
          this.video.removeEventListener('ended', this._onVideoEnded);
        }
        this._onVideoEnded = () => {
          this._playCategory('speaking', true);
        };
        this.video.addEventListener('ended', this._onVideoEnded);
      } else {
        this._playCategory(category, true);
      }

      // Play TTS audio
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this._currentAudio = audio;

      const cleanup = () => {
        this._currentAudio = null;
        URL.revokeObjectURL(url);
        // Transition to listening when speaking ends (avatar stays animated)
        if (category === 'speaking') {
          this._playCategory('listening', true);
        }
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

  /**
   * Stop any currently playing TTS audio and video.
   */
  stopSpeaking() {
    if (this._currentAudio) {
      try {
        this._currentAudio.pause();
        this._currentAudio.currentTime = 0;
      } catch (_) {}
      this._currentAudio = null;
    }
    this._stopVideo();
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

  /** Return to idle/listening state — avatar is never static. */
  resetToFriendly() {
    this._playCategory('listening', true);
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

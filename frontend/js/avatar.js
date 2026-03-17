/**
 * Avatar manager — Pre-recorded video avatar with double-buffered playback.
 *
 * Uses two stacked <video> elements to eliminate black-screen flashes
 * between clips. The "back" video preloads the next clip while the
 * "front" video is still playing, then they swap instantly.
 *
 * Video mapping (from source material):
 *   - Speaking (讲话): Video 14, Video 21, Video 21 1 → speaking-1/2/3.mp4
 *   - Listening (倾听+记录): Video 16, Video 22 → listening-1/2.mp4
 *   - Opening (开场总): opening.mp4
 *   - Ending (结束): Video 19, Video 20 → ending-1/2.mp4
 */

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
    this._videoA = null;
    this._videoB = null;
    this._front = null;
    this._back = null;
    this.video = null;
    this.ready = false;
    this.language = 'en';
    this._phase = 'greeting';
    this._currentCategory = null;
    this._preloaded = {};
    this._currentAudio = null;
    this._looping = false;
    this._destroyed = false;
    this._nextReady = false;
  }

  async init(_avatarType, language = 'en', onProgress = null) {
    this.language = language;

    this._videoA = this._createVideoEl();
    this._videoB = this._createVideoEl();
    this.container.appendChild(this._videoA);
    this.container.appendChild(this._videoB);

    // A is front (visible), B is back (hidden, preloading)
    this._front = this._videoA;
    this._back = this._videoB;
    this._back.style.opacity = '0';
    this.video = this._front;

    // Preload all clips
    const allClips = Object.values(VIDEO_CLIPS).flat();
    let loaded = 0;
    const total = allClips.length;

    await Promise.all(allClips.map(src =>
      this._preloadVideo(src).then(() => {
        loaded++;
        if (onProgress) onProgress(loaded, total);
      })
    ));

    this._front.src = VIDEO_CLIPS.opening[0];
    this._front.load();

    this.ready = true;
    console.log(`[Avatar] Ready, ${allClips.length} clips cached`);
  }

  _createVideoEl() {
    const v = document.createElement('video');
    v.className = 'avatar-video';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.style.position = 'absolute';
    v.style.top = '0';
    v.style.left = '0';
    v.style.width = '100%';
    v.style.height = '100%';
    v.style.objectFit = 'cover';
    v.style.opacity = '1';
    return v;
  }

  _preloadVideo(src) {
    return new Promise((resolve) => {
      if (this._preloaded[src]) { resolve(); return; }
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.src = src;
      v.oncanplaythrough = () => { this._preloaded[src] = true; resolve(); };
      v.onerror = () => { console.warn(`[Avatar] Preload fail: ${src}`); resolve(); };
      v.load();
    });
  }

  /** Instant swap: back becomes front. */
  _swap() {
    this._back.style.opacity = '1';
    this._front.style.opacity = '0';
    const tmp = this._front;
    this._front = this._back;
    this._back = tmp;
    this.video = this._front;
  }

  // ── Phase control ──────────────────────────────────────────

  setPhase(phase) {
    this._phase = phase;
  }

  // ── Double-buffered video loop ─────────────────────────────

  /**
   * Start playing clips from a category. When loop=true, continuously
   * chains random clips using double-buffer to avoid black frames.
   */
  _playCategory(category, loop = true) {
    if (!this._front || !this.ready) return;

    // Don't restart if already playing this category
    if (this._currentCategory === category && this._looping === loop) return;

    this._stopLoop();
    this._currentCategory = category;
    this._looping = loop;

    const clips = VIDEO_CLIPS[category];
    if (!clips || clips.length === 0) return;

    this._startClip(pickRandom(clips));

    if (loop) {
      this._scheduleNext(category, clips);
    }
  }

  /** Play a clip on the front video element. */
  _startClip(src) {
    this._front.src = src;
    this._front.currentTime = 0;
    this._front.style.opacity = '1';
    this._front.play().catch(e => console.warn('[Avatar] Play:', e));
  }

  /** Set up the ended handler to chain the next clip seamlessly. */
  _scheduleNext(category, clips) {
    this._nextReady = false;

    // Preload next clip on back buffer when nearing end
    const onTimeUpdate = () => {
      if (this._destroyed || this._currentCategory !== category) return;
      const v = this._front;
      if (v.duration && v.currentTime > 0 && (v.duration - v.currentTime) < 1.0 && !this._nextReady) {
        const nextSrc = pickRandom(clips);
        this._back.src = nextSrc;
        this._back.currentTime = 0;
        this._back.style.opacity = '0';
        this._back.load();
        this._nextReady = true;
      }
    };

    const onEnded = () => {
      if (this._destroyed || this._currentCategory !== category) return;

      // Prep fallback if timeupdate didn't fire
      if (!this._nextReady) {
        const nextSrc = pickRandom(clips);
        this._back.src = nextSrc;
        this._back.currentTime = 0;
        this._back.load();
      }

      // Swap and play
      this._back.play().then(() => {
        this._swap();
        this._cleanupFrontHandlers();
        if (this._looping && this._currentCategory === category) {
          this._scheduleNext(category, clips);
        }
      }).catch(() => {
        // Fallback: play on same element
        this._startClip(pickRandom(clips));
        if (this._looping && this._currentCategory === category) {
          this._scheduleNext(category, clips);
        }
      });
    };

    this._front._onTimeUpdate = onTimeUpdate;
    this._front._onEnded = onEnded;
    this._front.addEventListener('timeupdate', onTimeUpdate);
    this._front.addEventListener('ended', onEnded);
  }

  _cleanupFrontHandlers() {
    // Clean handlers from the element that is NOW the back (was front before swap)
    const el = this._back;
    if (el._onTimeUpdate) {
      el.removeEventListener('timeupdate', el._onTimeUpdate);
      el._onTimeUpdate = null;
    }
    if (el._onEnded) {
      el.removeEventListener('ended', el._onEnded);
      el._onEnded = null;
    }
  }

  _stopLoop() {
    this._looping = false;
    this._currentCategory = null;
    // Clean handlers from both elements
    [this._videoA, this._videoB].forEach(el => {
      if (!el) return;
      if (el._onTimeUpdate) { el.removeEventListener('timeupdate', el._onTimeUpdate); el._onTimeUpdate = null; }
      if (el._onEnded) { el.removeEventListener('ended', el._onEnded); el._onEnded = null; }
    });
  }

  _stopVideo() {
    this._stopLoop();
    this._front?.pause();
    this._back?.pause();
  }

  // ── State transitions (called from app.js) ─────────────────

  /**
   * Bot is about to speak — immediately start speaking videos.
   * Called from handleBotSpeak BEFORE audio arrives, so the avatar
   * is already moving when TTS audio begins playing.
   */
  startSpeaking() {
    if (this._phase === 'greeting' && this._currentCategory === 'opening') {
      // During greeting, let opening video finish, then chain into speaking
      const onEnd = () => {
        this._front.removeEventListener('ended', onEnd);
        this._playCategory('speaking', true);
      };
      this._front.addEventListener('ended', onEnd);
    } else if (this._phase === 'farewell') {
      this._playCategory('ending', true);
    } else {
      this._playCategory('speaking', true);
    }
  }

  /**
   * Play TTS audio synchronized with the speaking video.
   * The speaking video is ALREADY playing (from startSpeaking),
   * so we just need to play audio and handle cleanup when it ends.
   */
  speakAudio(audioBuffer, _text, onPlayStart) {
    if (!this._front || !this.ready) return Promise.resolve();

    return new Promise((resolve) => {
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this._currentAudio = audio;

      const cleanup = () => {
        this._currentAudio = null;
        URL.revokeObjectURL(url);
        resolve();
      };

      audio.onended = cleanup;
      audio.onerror = () => { console.warn('[Avatar] Audio error'); cleanup(); };

      // Ensure duration is available before reporting to typewriter (fire once)
      let durationReported = false;
      const reportDuration = () => {
        if (!durationReported && onPlayStart && isFinite(audio.duration) && audio.duration > 0) {
          durationReported = true;
          onPlayStart(audio.duration);
        }
      };

      audio.onloadedmetadata = reportDuration;
      audio.play().then(() => {
        // Fallback: if loadedmetadata already fired before we attached listener
        reportDuration();
      }).catch((e) => { console.warn('[Avatar] Audio play failed:', e); cleanup(); });
    });
  }

  stopSpeaking() {
    if (this._currentAudio) {
      try { this._currentAudio.pause(); this._currentAudio.currentTime = 0; } catch (_) {}
      this._currentAudio = null;
    }
    this._stopVideo();
  }

  // ── Listening / Idle state ─────────────────────────────────

  /** User is speaking or bot is idle — play listening videos. */
  startListening() {
    this._playCategory('listening', true);
  }

  stopListening() {
    // Don't stop — let it keep playing listening. Only category change stops it.
  }

  startThinking() {
    this._playCategory('listening', true);
  }

  /** After bot finishes speaking — transition to listening (always animated). */
  resetToFriendly() {
    this._playCategory('listening', true);
  }

  // ── Emotion (no-op for video avatar) ─────────────────────

  setEmotion(_emotion) {}
  nod() {}

  destroy() {
    this._destroyed = true;
    this._stopVideo();
    this._videoA?.remove();
    this._videoB?.remove();
    this._videoA = null;
    this._videoB = null;
    this._front = null;
    this._back = null;
    this.video = null;
    this.ready = false;
  }
}

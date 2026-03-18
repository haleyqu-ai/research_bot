/**
 * Avatar manager — Pre-recorded video avatar with double-buffered playback.
 *
 * Uses two stacked <video> elements to eliminate black-screen flashes
 * between clips. The "back" video preloads the next clip while the
 * "front" video is still playing, then they swap instantly.
 *
 * Opening sequence (3-part):
 *   1. Entrance animation (opening-entrance.mp4) — with original sound
 *   2. Speaking loop (opening-speaking-loop.mp4) — loops during greeting TTS
 *   3. Opening ending (opening-ending.mp4) — closing transition
 *
 * Other categories:
 *   - Speaking (讲话): speaking-1/2/3.mp4
 *   - Listening (倾听+待机): listening-1/2/3/4.mp4
 *   - Ending (结束): ending-1/2.mp4
 */

const VIDEO_CLIPS = {
  // Opening is now handled as a 3-part sequence (not looped from this list)
  'opening-entrance': ['/assets/videos/opening-entrance.mp4'],
  'opening-loop':     ['/assets/videos/opening-speaking-loop.mp4'],
  'opening-ending':   ['/assets/videos/opening-ending.mp4'],
  speaking:  ['/assets/videos/speaking-1.mp4', '/assets/videos/speaking-2.mp4', '/assets/videos/speaking-3.mp4'],
  listening: ['/assets/videos/listening-1.mp4'],
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

    // Opening sequence state
    this._openingPhase = null; // 'entrance' | 'loop' | 'ending' | null
    this._openingAudioDone = false;
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

  // ── Opening Sequence (3-part) ────────────────────────────────

  /**
   * Start the 3-part opening sequence:
   * 1. Play entrance animation (with sound!)
   * 2. When entrance ends → loop the speaking clip
   * 3. When greeting audio ends → play opening-ending, then transition to listening
   */
  playOpeningSequence() {
    if (!this._front || !this.ready) return;

    this._stopLoop();
    this._openingPhase = 'entrance';
    this._openingAudioDone = false;
    this._currentCategory = 'opening-entrance';

    const entranceSrc = VIDEO_CLIPS['opening-entrance'][0];

    // Entrance plays WITH SOUND (unmuted)
    this._front.muted = false;
    this._front.src = entranceSrc;
    this._front.currentTime = 0;
    this._front.style.opacity = '1';
    this._front.play().catch(e => {
      // Autoplay with sound may be blocked — retry muted
      console.warn('[Avatar] Entrance with sound blocked, retrying muted:', e);
      this._front.muted = true;
      this._front.play().catch(e2 => console.warn('[Avatar] Entrance play failed:', e2));
    });

    // When entrance ends → transition to speaking loop
    const onEntranceEnded = () => {
      this._front.removeEventListener('ended', onEntranceEnded);
      this._front.muted = true; // Back to muted for the rest

      if (this._destroyed) return;
      console.log('[Avatar] Entrance done → speaking loop');
      this._openingPhase = 'loop';
      this._playCategory('opening-loop', true);
    };
    this._front.addEventListener('ended', onEntranceEnded);
  }

  /**
   * Called when the greeting TTS audio finishes.
   * Transitions from speaking loop → opening ending → listening.
   */
  onGreetingAudioDone() {
    this._openingAudioDone = true;

    if (this._openingPhase === 'entrance') {
      // Entrance still playing — let it finish, then go to ending instead of loop
      // Override: when entrance ends, go straight to opening-ending
      this._front.removeEventListener('ended', this._front._onEnded);
      const goToEnding = () => {
        this._front.removeEventListener('ended', goToEnding);
        this._front.muted = true;
        this._playOpeningEnding();
      };
      this._front.addEventListener('ended', goToEnding);
    } else if (this._openingPhase === 'loop') {
      // Currently in speaking loop — play the ending clip next
      this._playOpeningEnding();
    }
    // If already in 'ending' or null, do nothing
  }

  _playOpeningEnding() {
    if (this._destroyed) return;
    console.log('[Avatar] Opening → ending clip');
    this._openingPhase = 'ending';
    this._stopLoop();
    this._currentCategory = 'opening-ending';

    const endingSrc = VIDEO_CLIPS['opening-ending'][0];

    // Preload on back, swap when ready
    this._back.src = endingSrc;
    this._back.currentTime = 0;
    this._back.style.opacity = '0';
    this._back.load();

    this._back.play().then(() => {
      this._swap();
      // When ending clip finishes → go to listening
      const onEndingDone = () => {
        this._front.removeEventListener('ended', onEndingDone);
        if (this._destroyed) return;
        console.log('[Avatar] Opening sequence complete → listening');
        this._openingPhase = null;
        this._playCategory('listening', true);
      };
      this._front.addEventListener('ended', onEndingDone);
    }).catch(() => {
      // Fallback: play directly on front
      this._front.src = endingSrc;
      this._front.currentTime = 0;
      this._front.play().catch(() => {});
      const onEndingDone = () => {
        this._front.removeEventListener('ended', onEndingDone);
        this._openingPhase = null;
        this._playCategory('listening', true);
      };
      this._front.addEventListener('ended', onEndingDone);
    });
  }

  // ── Double-buffered video loop ─────────────────────────────

  /**
   * Start playing clips from a category. When loop=true, continuously
   * chains random clips using double-buffer to avoid black frames.
   *
   * Uses the back buffer for smooth transitions — the old frame stays
   * visible until the new clip is ready to play, preventing flicker
   * on slower connections (e.g. Railway deployment).
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

    const newSrc = pickRandom(clips);

    // Load new clip on back buffer, keeping old frame visible
    this._back.src = newSrc;
    this._back.currentTime = 0;
    this._back.style.opacity = '0';

    const startPlayback = () => {
      if (this._destroyed || this._currentCategory !== category) return;
      this._back.play().then(() => {
        this._swap();
        if (loop && this._currentCategory === category) {
          this._scheduleNext(category, clips);
        }
      }).catch(() => {
        // Fallback: play directly on front (accepts brief flash)
        this._directStartClip(newSrc);
        if (loop && this._currentCategory === category) {
          this._scheduleNext(category, clips);
        }
      });
    };

    // If back buffer is already loaded (from preload cache), swap immediately
    if (this._back.readyState >= 3) {
      startPlayback();
    } else {
      this._back.addEventListener('canplay', startPlayback, { once: true });
      this._back.load();
    }
  }

  /** Direct play on front element — only used as fallback. */
  _directStartClip(src) {
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
        this._directStartClip(pickRandom(clips));
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
    this._openingPhase = null;
    this._front?.pause();
    this._back?.pause();
  }

  /**
   * Switch to a category — if already playing this category, skip.
   * Uses double-buffered _playCategory for smooth transitions.
   */
  _switchTo(category) {
    this._playCategory(category, true);
  }

  // ── State transitions (called from app.js) ─────────────────

  /**
   * Bot is about to speak — immediately start speaking videos.
   * Called from handleBotSpeak BEFORE audio arrives, so the avatar
   * is already moving when TTS audio begins playing.
   */
  startSpeaking() {
    if (this._phase === 'greeting' && this._openingPhase) {
      // During greeting opening sequence, don't interrupt — the loop is already
      // showing the speaking animation. Just let it continue.
      return;
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

        // If this was the greeting audio, signal the opening sequence
        if (this._phase === 'greeting' && this._openingPhase) {
          this.onGreetingAudioDone();
        }

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
        // Start speaking animation NOW — when audio actually begins playing.
        // This keeps lips in sync with voice.
        if (this._phase !== 'greeting' || !this._openingPhase) {
          // For non-greeting phases, start speaking videos when audio plays
          this.startSpeaking();
        }
        // For greeting, the opening sequence is already handling the video
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
    this._switchTo('listening');
  }

  stopListening() {
    // Don't stop — let it keep playing listening. Only category change stops it.
  }

  startThinking() {
    // Keep listening videos — don't change.
    // If somehow NOT listening, force it.
    if (this._currentCategory !== 'listening') {
      this._switchTo('listening');
    }
  }

  /** After bot finishes speaking — transition to listening (always animated). */
  resetToFriendly() {
    this._switchTo('listening');
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

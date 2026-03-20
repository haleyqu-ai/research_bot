/**
 * Meshy ResearchBot — Main Application
 */

import { SpeechManager } from './speech.js';
import { AvatarManager } from './avatar.js';
import { WebSocketManager } from './websocket.js';

// ---------- State ----------
const state = {
  email: '',
  language: '',
  avatar: '',
  phase: 'email',
  isRecording: false,
  isBotSpeaking: false,
  isEnding: false,
  _speakGeneration: 0,
  interviewStartTime: null,
  timerInterval: null,
};

// ---------- Language Data ----------
const LANGUAGES = {
  en: { name: 'English', native: 'English' },
  zh: { name: 'Chinese', native: '中文' },
  de: { name: 'German', native: 'Deutsch' },
  fr: { name: 'French', native: 'Français' },
  ja: { name: 'Japanese', native: '日本語' },
  ko: { name: 'Korean', native: '한국어' },
  es: { name: 'Spanish', native: 'Español' },
  pt: { name: 'Portuguese', native: 'Português' },
  ru: { name: 'Russian', native: 'Русский' },
  it: { name: 'Italian', native: 'Italiano' },
};

// ---------- Managers ----------
let ws = null;
let speech = null;
let avatar = null;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);

// ---------- Phase Management ----------
function _beforeUnloadHandler(e) {
  e.preventDefault();
  e.returnValue = '';
  return '';
}

function _pageHideHandler() {
  // When user actually leaves (after confirming), trigger end interview
  if (state.phase === 'interview' && ws) {
    // Use sendBeacon for reliable delivery during page unload
    const url = `${window.location.protocol}//${window.location.host}/api/end-session`;
    const payload = JSON.stringify({ action: 'end_interview' });
    navigator.sendBeacon(url, payload);
    // Also try WS (may not work during unload)
    try { ws.send({ action: 'end_interview' }); } catch (_) {}
  }
}

function setPhase(phaseName) {
  state.phase = phaseName;
  document.querySelectorAll('.phase').forEach(el => el.classList.remove('active'));
  const el = $(`phase-${phaseName}`);
  if (el) el.classList.add('active');

  const controls = $('interview-controls');
  if (controls) controls.classList.toggle('hidden', phaseName !== 'interview');

  const statusPill = $('avatar-status');
  if (statusPill) statusPill.classList.toggle('hidden', phaseName !== 'interview');

  // Warn user when closing tab/browser during interview
  if (phaseName === 'interview') {
    window.addEventListener('beforeunload', _beforeUnloadHandler);
    window.addEventListener('pagehide', _pageHideHandler);
  }

  // Stop timer when leaving interview
  if (phaseName === 'complete') {
    window.removeEventListener('beforeunload', _beforeUnloadHandler);
    window.removeEventListener('pagehide', _pageHideHandler);
    stopTimer();
    showInterviewDuration();
  }
}

// ---------- Timer ----------
function startTimer() {
  state.interviewStartTime = Date.now();
  state.timerInterval = setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function updateTimerDisplay() {
  const elapsed = Math.floor((Date.now() - state.interviewStartTime) / 1000);
  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const secs = String(elapsed % 60).padStart(2, '0');
  const el = $('timer-text');
  if (el) el.textContent = `${mins}:${secs}`;
  // Progress bar — estimate ~17 min (midpoint of 15-20)
  const bar = $('timer-progress-bar');
  if (bar) {
    const pct = Math.min((elapsed / (17 * 60)) * 100, 100);
    bar.style.width = `${pct}%`;
  }
}

function getElapsedTime() {
  if (!state.interviewStartTime) return '0:00';
  const elapsed = Math.floor((Date.now() - state.interviewStartTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = String(elapsed % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function showInterviewDuration() {
  const el = $('interview-duration');
  if (el) el.textContent = `Interview duration: ${getElapsedTime()}`;
}

// ---------- Phase 1: Email ----------
function initEmailPhase() {
  const input = $('email-input');
  const btn = $('email-submit');

  // Default email for testing
  input.value = 'test@meshy.ai';
  btn.disabled = false;

  input.addEventListener('input', () => {
    btn.disabled = !input.value.includes('@');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !btn.disabled) btn.click();
  });

  btn.addEventListener('click', () => {
    state.email = input.value.trim();
    setPhase('language');
  });
}

// ---------- Phase 2: Language ----------
function initLanguagePhase() {
  const grid = $('language-grid');

  Object.entries(LANGUAGES).forEach(([code, lang]) => {
    const card = document.createElement('div');
    card.className = 'language-card';
    card.dataset.lang = code;
    card.innerHTML = `
      <div class="lang-name">${lang.native}</div>
      <div class="lang-native">${lang.name}</div>
    `;
    card.addEventListener('click', () => {
      grid.querySelectorAll('.language-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.language = code;
      state.avatar = 'female'; // Single mascot, no selection needed
      setTimeout(() => startInterview(), 400);
    });
    grid.appendChild(card);
  });
}

// ---------- Loading Overlay ----------
function showLoadingOverlay(container) {
  const overlay = document.createElement('div');
  overlay.id = 'loading-overlay';
  overlay.innerHTML = `
    <div class="loading-content">
      <div class="loading-spinner"></div>
      <div class="loading-text">Loading...</div>
      <div class="loading-bar-track"><div class="loading-bar-fill" id="loading-fill"></div></div>
    </div>
  `;
  container.appendChild(overlay);
  return {
    update(text, pct) {
      overlay.querySelector('.loading-text').textContent = text;
      overlay.querySelector('#loading-fill').style.width = `${pct}%`;
    },
    remove() {
      overlay.classList.add('fade-out');
      setTimeout(() => overlay.remove(), 300);
    },
  };
}

// ---------- Phase 4: Interview ----------
async function startInterview() {
  setPhase('interview');

  const avatarArea = $('avatar-container').closest('.avatar-fullscreen') || $('avatar-container').parentElement;
  const loader = showLoadingOverlay(avatarArea);
  loader.update('Loading...', 0);

  const sttProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const sttUrl = `${sttProtocol}://${window.location.host}/ws/stt`;
  speech = new SpeechManager(state.language, sttUrl);

  // Initialize video avatar with progress
  avatar = new AvatarManager($('avatar-container'));
  try {
    await avatar.init(state.avatar, state.language, (loaded, total) => {
      const pct = Math.round((loaded / total) * 80);
      loader.update(`Loading (${loaded}/${total})...`, pct);
    });
    console.log('Video avatar loaded');
  } catch (err) {
    console.error('Avatar load error:', err);
  }

  // Start 3-part opening sequence: entrance → speaking loop → ending
  avatar.setPhase('greeting');
  avatar.playOpeningSequence();
  state._openingVideoStartTime = Date.now();

  // Remove loader so user can see the opening video
  loader.remove();

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocketManager(`${protocol}://${window.location.host}/ws`);

  ws.on('bot_speak', handleBotSpeak);
  ws.on('bot_audio', handleBotAudio);
  ws.on('bot_thinking', handleBotThinking);
  ws.on('interview_report', handleInterviewReport);
  ws.on('error', handleError);

  await ws.connect();

  ws.send({
    action: 'start_session',
    email: state.email,
    language: state.language,
    avatar: state.avatar,
  });

  initMicButton();
  initTextInput();
  initEndButton();
  initSpaceKey();

  startTimer();
  updateStatus('Connected', true);
  enableInput();
}

// ---------- End Interview Button ----------
function initEndButton() {
  const btn = $('end-interview-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    // Confirm before ending
    const msg = state.language === 'zh'
      ? '确定要结束访谈吗？'
      : 'End the interview now?';

    if (!confirm(msg)) return;

    // Force stop ALL audio — unconditionally, invalidate stale audio
    state.isBotSpeaking = false;
    state._speakGeneration++;
    if (state._audioTimeout) {
      clearTimeout(state._audioTimeout);
      state._audioTimeout = null;
    }
    speechSynthesis?.cancel();
    avatar?.stopSpeaking?.();
    if (state._fallbackAudio) {
      try { state._fallbackAudio.pause(); } catch (_) {}
      state._fallbackAudio = null;
    }

    // Stop recording if active
    if (state.isRecording) {
      state.isRecording = false;
      speech?.stopListening();
      const micBtn = $('mic-btn');
      if (micBtn) {
        micBtn.classList.remove('recording');
        setMicIcon(micBtn, false);
        const span = micBtn.querySelector('span');
        if (span) span.textContent = 'Click to talk';
      }
      $('waveform')?.classList.add('hidden');
    }

    // Truncate any in-progress typewriter with "..."
    _finishTypewriter(true);
    // Remove speaking wave indicators from bubbles
    const chatContainer = $('chat-messages');
    if (chatContainer) chatContainer.querySelectorAll('.bubble-wave').forEach(w => w.remove());

    // Hide typing indicator and waveform
    $('typing-indicator')?.classList.add('hidden');
    $('waveform')?.classList.add('hidden');

    // Mark ending state — suppress bot_thinking indicator
    state.isEnding = true;

    // Disable all input and send end signal
    disableInput();
    btn.disabled = true;
    stopTimer();
    ws.send({ action: 'end_interview' });
  });
}

// ---------- Mic Button (click-to-toggle) ----------
const MIC_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M19 9a1 1 0 0 1 1 1a8 8 0 0 1 -6.999 7.938l-.001 2.062h3a1 1 0 0 1 0 2h-8a1 1 0 0 1 0 -2h3v-2.062a8 8 0 0 1 -7 -7.938a1 1 0 1 1 2 0a6 6 0 0 0 12 0a1 1 0 0 1 1 -1m-7 -8a4 4 0 0 1 4 4v5a4 4 0 1 1 -8 0v-5a4 4 0 0 1 4 -4"/></svg>';
const REC_DOT_HTML = '<span class="rec-dot"></span>';

function setMicIcon(btn, isRecording) {
  const existingDot = btn.querySelector('.rec-dot');
  const existingSvg = btn.querySelector('svg');
  if (isRecording) {
    if (existingSvg) existingSvg.style.display = 'none';
    if (!existingDot) btn.insertAdjacentHTML('afterbegin', REC_DOT_HTML);
  } else {
    if (existingDot) existingDot.remove();
    if (existingSvg) existingSvg.style.display = '';
    else btn.insertAdjacentHTML('afterbegin', MIC_ICON);
  }
}

function initMicButton() {
  const btn = $('mic-btn');
  let isConnecting = false;

  btn.addEventListener('click', async () => {
    if (btn.disabled || isConnecting) return;
    if (state.isRecording) {
      stopRecording();
    } else {
      isConnecting = true;
      await startRecording();
      isConnecting = false;
    }
  });
}

// ---------- Space Key (removed — click-only interaction) ----------
function initSpaceKey() {
  // No-op: space key shortcut removed, mic is click-to-toggle only
}

// ---------- Text Input ----------
function initTextInput() {
  const input = $('text-input');
  const sendBtn = $('text-send-btn');
  const wrapper = input?.closest('.text-input-wrapper');
  if (!input || !sendBtn) return;

  if (_isMobile()) input.placeholder = 'Type';

  const sendMessage = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendUserMessage(text);
  };

  // Expand input on focus → collapse mic to icon-only
  const micBtn = $('mic-btn');
  input.addEventListener('focus', () => {
    if (wrapper) wrapper.classList.add('expanded');
    if (micBtn) micBtn.classList.add('icon-only');
  });
  input.addEventListener('blur', () => {
    if (wrapper && !input.value.trim()) {
      wrapper.classList.remove('expanded');
      if (micBtn) micBtn.classList.remove('icon-only');
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);
}

function sendUserMessage(text) {
  addChatMessage(text, 'user');
  disableInput();
  // Ensure avatar stays in listening mode while waiting for bot response
  avatar?.startListening();
  ws.send({ action: 'user_answer', text });
}

async function startRecording() {
  const btn = $('mic-btn');
  const span = btn.querySelector('span');

  // Show connecting state — disable button during connection
  btn.classList.add('connecting');
  btn.disabled = true;
  setMicIcon(btn, true);
  if (span) span.textContent = 'Connecting...';
  $('waveform').classList.remove('hidden');
  avatar?.startListening();

  try {
    await speech.startListening(
      () => {},
      (final) => {
        if (state.isRecording) stopRecording(final);
      }
    );
    // Connected — re-enable button and switch to recording state
    btn.classList.remove('connecting');
    btn.classList.add('recording');
    btn.disabled = false;
    state.isRecording = true;
    if (span) span.textContent = 'Click to end and send';
    updateStatus('Connected', true);
  } catch (err) {
    console.error('[App] STT start failed:', err);
    btn.classList.remove('connecting', 'recording');
    btn.disabled = false;
    setMicIcon(btn, false);
    if (span) span.textContent = 'Click to talk';
    $('waveform').classList.add('hidden');
    avatar?.stopListening();
    state.isRecording = false;
    if (err.name === 'NotAllowedError' || err.name === 'NotFoundError') {
      updateStatus('Mic blocked — check browser settings', false);
    } else {
      updateStatus('Voice failed — use text input', false);
    }
  }
}

async function stopRecording(finalText) {
  state.isRecording = false;
  const btn = $('mic-btn');
  btn.classList.remove('recording');
  setMicIcon(btn, false);
  const span = btn.querySelector('span');
  if (span) span.textContent = 'Click to talk';
  $('waveform').classList.add('hidden');

  // Keep avatar in listening mode during STT processing
  avatar?.startListening();

  let text = finalText || '';

  try {
    if (!text) {
      // Wait for Google Cloud STT to return the final transcription.
      // Long audio (10+ seconds) can take 5-8s to process, so allow generous timeout.
      if (span) span.textContent = 'Processing...';
      addProcessingBubble();
      text = await speech.stopAndGetResult(15000);
    } else {
      speech.stopListening();
    }
  } catch (err) {
    console.error('[App] STT stopAndGetResult error:', err);
    text = '';
  } finally {
    // Always reset button state, no matter what
    if (span) span.textContent = 'Click to talk';
    removeProcessingBubble();
  }

  console.log('[App] STT result:', text);
  if (text && text.trim()) {
    updateStatus('Connected', true);
    sendUserMessage(text.trim());
  } else {
    // Recognition returned empty — let user know and keep input enabled
    console.warn('[App] STT returned empty result');
    updateStatus('Could not hear you — please try again', false);
    enableInput();
  }
}

// ---------- Bot Response ----------
async function handleBotSpeak(data) {
  // Force-stop any audio still playing from a previous message
  if (state.isBotSpeaking) {
    speechSynthesis?.cancel();
    avatar?.stopSpeaking?.();
    if (state._fallbackAudio) {
      try { state._fallbackAudio.pause(); } catch (_) {}
      state._fallbackAudio = null;
    }
    if (state._audioTimeout) {
      clearTimeout(state._audioTimeout);
      state._audioTimeout = null;
    }
  }

  state.isBotSpeaking = true;
  state._speakGeneration++;
  state._currentSpeakGen = state._speakGeneration;
  state._firstBotMessageShown = true;
  state._lastBotText = data.text;
  state._lastBotPhase = data.phase;
  $('typing-indicator').classList.add('hidden');
  updateStatus('Connected', true);
  disableInput();

  addChatMessage(data.text, 'bot');

  // Set phase — but DON'T start speaking videos yet.
  // The speaking animation will start when TTS audio actually begins playing,
  // so lips and voice are synchronized.
  avatar?.setPhase(data.phase || 'question');


  // If audio is included (legacy/local), play immediately
  if (data.audio && data.audio.length > 100) {
    playWithLipSync(data.audio, data.text, data.phase);
  }
  // Otherwise wait for bot_audio — set a timeout fallback to browser TTS
  else {
    state._audioTimeout = setTimeout(() => {
      if (state.isBotSpeaking) {
        console.log('[App] Audio timeout, using browser TTS');
        speakWithBrowserTTS(data.text, data.phase);
      }
    }, 8000);
  }
}

function handleBotAudio(data) {
  // Cancel the browser TTS fallback timeout
  if (state._audioTimeout) {
    clearTimeout(state._audioTimeout);
    state._audioTimeout = null;
  }

  // Reject stale audio from a previous bot_speak (e.g. greeting audio arriving after end)
  const gen = state._currentSpeakGen;
  if (data.audio && data.audio.length > 100 && state.isBotSpeaking && gen === state._speakGeneration) {
    playWithLipSync(data.audio, state._lastBotText || '', state._lastBotPhase || 'question');
  }
}

/**
 * Decode base64 audio and play with video avatar.
 * For greeting phase, delays audio so it starts ~8s after opening video began.
 */
async function playWithLipSync(audioB64, text, phase) {
  try {
    const binary = atob(audioB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const audioBuffer = bytes.buffer;

    if (phase === 'greeting' && state._openingVideoStartTime) {
      // Wait for the entrance video to finish before playing greeting TTS.
      // The entrance video has its own sound, so TTS should start when
      // the avatar transitions to the speaking loop.
      const elapsed = Date.now() - state._openingVideoStartTime;
      const entranceDuration = 8000; // ~8s entrance animation
      const remaining = entranceDuration - elapsed;
      if (remaining > 0) {
        console.log(`[App] Greeting: waiting ${remaining}ms for entrance to finish`);
        await new Promise(r => setTimeout(r, remaining));
      }
      state._openingVideoStartTime = null;
    }

    const onAudioStart = (durationSec) => {
      if (state._typewriterControl && !state._typewriterControl.started) {
        state._typewriterControl.start(durationSec * 1000);
      }
    };

    if (avatar && avatar.ready) {
      await avatar.speakAudio(audioBuffer, text, onAudioStart);
      onBotDoneSpeaking(phase);
    } else {
      playAudioFallback(bytes, phase, text, onAudioStart);
    }
  } catch (e) {
    console.warn('Lip-sync playback error, falling back:', e);
    speakWithBrowserTTS(text, phase);
  }
}

function playAudioFallback(bytes, phase, text, onPlayStart) {
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  state._fallbackAudio = audio;

  audio.onended = () => {
    state._fallbackAudio = null;
    URL.revokeObjectURL(url);
    onBotDoneSpeaking(phase);
  };
  audio.onerror = () => {
    state._fallbackAudio = null;
    URL.revokeObjectURL(url);
    speakWithBrowserTTS(text, phase);
  };

  let durationReported = false;
  const reportDuration = () => {
    if (!durationReported && onPlayStart && isFinite(audio.duration) && audio.duration > 0) {
      durationReported = true;
      onPlayStart(audio.duration);
    }
  };
  audio.onloadedmetadata = reportDuration;
  audio.play().then(() => {
    // Start speaking animation when audio actually begins
    avatar?.startSpeaking();
    reportDuration();
  }).catch(() => {
    state._fallbackAudio = null;
    URL.revokeObjectURL(url);
    speakWithBrowserTTS(text, phase);
  });
}

function speakWithBrowserTTS(text, phase) {
  const langMap = {
    en: 'en-US', zh: 'zh-CN', de: 'de-DE', fr: 'fr-FR',
    ja: 'ja-JP', ko: 'ko-KR', es: 'es-ES', pt: 'pt-BR',
    ru: 'ru-RU', it: 'it-IT',
  };

  if (!window.speechSynthesis) {
    if (state._typewriterControl && !state._typewriterControl.started) {
      state._typewriterControl.start(text.length * 80);
    }
    setTimeout(() => onBotDoneSpeaking(phase), 1500);
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = langMap[state.language] || 'en-US';
  utterance.rate = 0.95;
  utterance.pitch = state.avatar === 'female' ? 1.1 : 0.9;

  utterance.onstart = () => {
    // Start speaking animation when browser TTS actually begins
    avatar?.startSpeaking();
    if (state._typewriterControl && !state._typewriterControl.started) {
      const chars = [...text];
      const cjkRatio = chars.filter(c => /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(c)).length / (chars.length || 1);
      // Adjusted for rate=0.95: CJK ~260ms/char, English ~420ms/word
      const estimatedMs = cjkRatio > 0.3
        ? chars.length * 260
        : text.split(/\s+/).length * 420;
      state._typewriterControl.start(estimatedMs);
    }
  };

  utterance.onend = () => onBotDoneSpeaking(phase);
  utterance.onerror = () => onBotDoneSpeaking(phase);

  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);

  setTimeout(() => {
    if (state.isBotSpeaking) {
      speechSynthesis.cancel();
      onBotDoneSpeaking(phase);
    }
  }, 30000);
}

function onBotDoneSpeaking(phase) {
  if (!state.isBotSpeaking) return;
  state.isBotSpeaking = false;
  removeSpeakingWaves();

  if (phase === 'farewell') {
    setTimeout(() => setPhase('complete'), 1500);
  } else {
    avatar?.resetToFriendly();
    enableInput();
  }
}

function handleBotThinking() {
  disableInput();
  // Skip typing indicator when ending — farewell will appear directly
  if (state.isEnding) return;
  // Only show typing indicator after the first bot message has been displayed
  if (state._firstBotMessageShown) {
    $('typing-indicator').classList.remove('hidden');
  }
  avatar?.startThinking();
}

function handleInterviewReport(data) {
  console.log('[Report] Interview synthesis received:', data);
  // Report is saved server-side, just log confirmation
  if (data.synthesis) {
    console.log('[Report] Synthesis:', JSON.stringify(data.synthesis, null, 2));
  }
  if (data.error) {
    console.warn('[Report] Error:', data.error);
  }
}

function handleError(data) {
  console.error('WebSocket error:', data.message);
  updateStatus('Error', false);
}

// ---------- UI Helpers ----------
const _isMobile = () => window.innerWidth <= 768;
const MAX_VISIBLE_BUBBLES_DESKTOP = 5;
const MAX_VISIBLE_BUBBLES_MOBILE = 2;
const BUBBLE_GAP = 24;

let _activeTypewriter = null;

function addProcessingBubble() {
  const container = $('chat-messages');
  if (!container) return;

  // Remove any existing processing bubble
  removeProcessingBubble();

  const msg = document.createElement('div');
  msg.className = 'chat-msg processing';
  msg.id = 'processing-bubble';

  const dots = document.createElement('div');
  dots.className = 'processing-dots';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('div');
    dot.className = 'pdot';
    dots.appendChild(dot);
  }
  msg.appendChild(dots);

  let xPos = 2 + Math.random() * 6;
  msg.style.setProperty('--bubble-x', `${xPos}%`);

  const driftDur = 5 + Math.random() * 4;
  const driftDelay = 0.4 + Math.random() * 0.3;
  msg.style.setProperty('--drift-dur', `${driftDur}s`);
  msg.style.setProperty('--drift-delay', `${driftDelay}s`);

  const r = () => (Math.random() * 8 - 4).toFixed(1) + 'px';
  const rd = () => (Math.random() * 1.2 - 0.6).toFixed(2) + 'deg';
  msg.style.setProperty('--dx1', r());
  msg.style.setProperty('--dy1', r());
  msg.style.setProperty('--dr1', rd());
  msg.style.setProperty('--dx2', r());
  msg.style.setProperty('--dy2', r());
  msg.style.setProperty('--dr2', rd());
  msg.style.setProperty('--dx3', r());
  msg.style.setProperty('--dy3', r());
  msg.style.setProperty('--dr3', rd());

  container.appendChild(msg);
  requestAnimationFrame(() => _layoutBubbles(container));
}

function removeProcessingBubble() {
  const bubble = $('processing-bubble');
  if (bubble) {
    bubble.classList.add('fading');
    setTimeout(() => bubble.remove(), 600);
  }
}

function addChatMessage(text, role) {
  const container = $('chat-messages');
  if (!container) return;

  _finishTypewriter();
  removeProcessingBubble();

  const maxBubbles = _isMobile() ? MAX_VISIBLE_BUBBLES_MOBILE : MAX_VISIBLE_BUBBLES_DESKTOP;
  const visible = [...container.querySelectorAll('.chat-msg:not(.fading):not(.chat-status-bubble):not(.processing)')];
  let removed = 0;
  while (visible.length - removed >= maxBubbles) {
    const oldest = visible[removed];
    oldest.classList.add('fading');
    if (_isMobile()) oldest.classList.add('fading-up');
    setTimeout(() => oldest.remove(), 600);
    removed++;
  }

  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;

  const textSpan = document.createElement('span');
  textSpan.className = 'bubble-text';
  msg.appendChild(textSpan);

  let xPos = 2 + Math.random() * 6;
  msg.style.setProperty('--bubble-x', `${xPos}%`);

  const driftDur = 5 + Math.random() * 4;
  const driftDelay = 0.4 + Math.random() * 0.3;
  msg.style.setProperty('--drift-dur', `${driftDur}s`);
  msg.style.setProperty('--drift-delay', `${driftDelay}s`);

  const r = () => (Math.random() * 8 - 4).toFixed(1) + 'px';
  const rd = () => (Math.random() * 1.2 - 0.6).toFixed(2) + 'deg';
  msg.style.setProperty('--dx1', r());
  msg.style.setProperty('--dy1', r());
  msg.style.setProperty('--dr1', rd());
  msg.style.setProperty('--dx2', r());
  msg.style.setProperty('--dy2', r());
  msg.style.setProperty('--dr2', rd());
  msg.style.setProperty('--dx3', r());
  msg.style.setProperty('--dy3', r());
  msg.style.setProperty('--dr3', rd());

  if (role === 'bot') {
    const wave = document.createElement('div');
    wave.className = 'bubble-wave';
    for (let i = 0; i < 5; i++) {
      const bar = document.createElement('div');
      bar.className = 'bw';
      wave.appendChild(bar);
    }
    msg.appendChild(wave);

    const chars = [...text];

    // Don't start typewriter immediately — wait for audio to provide duration
    state._typewriterControl = {
      textSpan,
      chars,
      fullText: text,
      msg,
      started: false,
      start(durationMs) {
        if (this.started) return;
        this.started = true;

        // Use unclamped timing so text finishes exactly when audio ends.
        // Reserve 5% of duration as tail buffer so text completes slightly before audio.
        const effectiveMs = durationMs * 0.95;
        const msPerChar = Math.max(15, effectiveMs / chars.length);

        let idx = 0;
        let lastH = this.msg.offsetHeight;
        const startTime = performance.now();

        const tick = () => {
          const elapsed = performance.now() - startTime;
          const targetIdx = Math.min(Math.floor(elapsed / msPerChar), chars.length);

          // Batch-append all chars up to target index
          if (targetIdx > idx) {
            textSpan.textContent = chars.slice(0, targetIdx).join('');
            idx = targetIdx;
            const h = this.msg.offsetHeight;
            if (h !== lastH) {
              lastH = h;
              _layoutBubbles(container);
            }
          }

          if (idx < chars.length) {
            this._raf = requestAnimationFrame(tick);
          } else {
            if (_activeTypewriter?.raf === this._raf) _activeTypewriter = null;
            _layoutBubbles(container);
          }
        };

        this._raf = requestAnimationFrame(tick);
        _activeTypewriter = { raf: this._raf, textSpan, fullText: text, msg };
        requestAnimationFrame(() => _layoutBubbles(container));
      },
    };
  } else {
    textSpan.textContent = text;
  }

  container.appendChild(msg);

  requestAnimationFrame(() => _layoutBubbles(container));

  return msg;
}

function _layoutBubbles(container) {
  const bubbles = [...container.querySelectorAll('.chat-msg:not(.fading):not(.chat-status-bubble):not(.processing)')];
  if (!bubbles.length) return;

  const containerH = container.offsetHeight;
  const heights = bubbles.map(b => b.offsetHeight);

  // On mobile: anchor newest bubble near the bottom; desktop: ~55% center
  const newestH = heights[heights.length - 1];
  const newestTop = _isMobile()
    ? Math.max(20, containerH - newestH - 20)
    : Math.max(20, Math.min(
        containerH * 0.55 - newestH / 2,
        containerH - newestH - 20
      ));

  bubbles[bubbles.length - 1].style.top = `${newestTop}px`;

  // Stack older bubbles above newest
  let cursor = newestTop;
  for (let i = bubbles.length - 2; i >= 0; i--) {
    cursor -= BUBBLE_GAP + heights[i];
    bubbles[i].style.top = `${cursor}px`;

    if (cursor + heights[i] < -20) {
      bubbles[i].classList.add('fading');
      setTimeout(() => bubbles[i].remove(), 600);
    }
  }
}

function _finishTypewriter(truncate = false) {
  if (_activeTypewriter) {
    if (_activeTypewriter.tid) clearInterval(_activeTypewriter.tid);
    if (_activeTypewriter.raf) cancelAnimationFrame(_activeTypewriter.raf);
    if (truncate) {
      const current = _activeTypewriter.textSpan.textContent;
      if (current && current !== _activeTypewriter.fullText) {
        _activeTypewriter.textSpan.textContent = current.trimEnd() + '...';
      }
    } else {
      _activeTypewriter.textSpan.textContent = _activeTypewriter.fullText;
    }
    _activeTypewriter = null;
  }
  if (state._typewriterControl) {
    if (truncate && !state._typewriterControl.started) {
      // Not started yet — leave empty or show truncated
      state._typewriterControl.textSpan.textContent = '';
    } else if (!truncate && !state._typewriterControl.started) {
      state._typewriterControl.textSpan.textContent = state._typewriterControl.fullText;
    }
    state._typewriterControl.started = true;
    state._typewriterControl = null;
  }
}

function removeSpeakingWaves() {
  _finishTypewriter();
  const container = $('chat-messages');
  if (!container) return;
  container.querySelectorAll('.bubble-wave').forEach(w => w.remove());
}

function updateStatus(text, connected) {
  const el = $('status-text');
  if (el) el.textContent = text;
  const dot = $('status-dot');
  if (dot) dot.style.background = connected ? 'var(--lime)' : 'var(--pink)';
}

function disableInput() {
  const btn = $('mic-btn');
  if (btn) btn.disabled = true;
  const textInput = $('text-input');
  if (textInput) textInput.disabled = true;
  const sendBtn = $('text-send-btn');
  if (sendBtn) sendBtn.disabled = true;
}

function enableInput() {
  // Reveal controls bar on first enable (hidden until bot finishes greeting)
  const bar = document.querySelector('.chat-controls-bar');
  if (bar && bar.classList.contains('hidden')) {
    bar.classList.remove('hidden');
  }
  const btn = $('mic-btn');
  if (btn) btn.disabled = false;
  const textInput = $('text-input');
  if (textInput) {
    textInput.disabled = false;
  }
  const sendBtn = $('text-send-btn');
  if (sendBtn) sendBtn.disabled = false;
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  initEmailPhase();
  initLanguagePhase();
});

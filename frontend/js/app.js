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

  // Start opening video immediately (muted, no TTS yet)
  avatar.setPhase('greeting');
  avatar._playCategory('opening', false);
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

    // Stop any ongoing bot speech
    if (state.isBotSpeaking) {
      state.isBotSpeaking = false;
      if (state._audioTimeout) {
        clearTimeout(state._audioTimeout);
        state._audioTimeout = null;
      }
      speechSynthesis?.cancel();
      avatar?.stopSpeaking?.();
      // Stop fallback audio if playing
      if (state._fallbackAudio) {
        try { state._fallbackAudio.pause(); } catch (_) {}
        state._fallbackAudio = null;
      }
    }

    // Stop recording if active
    if (state.isRecording) {
      state.isRecording = false;
      speech?.stopListening();
      const micBtn = $('mic-btn');
      if (micBtn) {
        micBtn.classList.remove('recording');
        const span = micBtn.querySelector('span');
        if (span) span.textContent = 'Mic';
      }
      $('waveform')?.classList.add('hidden');
    }

    // Disable all input and send end signal
    disableInput();
    btn.disabled = true;
    ws.send({ action: 'end_interview' });
  });
}

// ---------- Mic Button ----------
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

  btn.addEventListener('touchstart', async (e) => {
    e.preventDefault();
    if (btn.disabled || isConnecting) return;
    isConnecting = true;
    await startRecording();
    isConnecting = false;
  });

  btn.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (state.isRecording) stopRecording();
  });
}

// ---------- Space Key Shortcut ----------
function initSpaceKey() {
  document.addEventListener('keydown', (e) => {
    // Ignore if typing in text input or if Space is held (repeat)
    if (e.code !== 'Space' || e.repeat) return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

    e.preventDefault();
    const btn = $('mic-btn');
    if (btn && !btn.disabled) {
      btn.click();
    }
  });
}

// ---------- Text Input ----------
function initTextInput() {
  const input = $('text-input');
  const sendBtn = $('text-send-btn');
  if (!input || !sendBtn) return;

  const sendMessage = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendUserMessage(text);
  };

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
  ws.send({ action: 'user_answer', text });
}

async function startRecording() {
  const btn = $('mic-btn');
  const span = btn.querySelector('span');

  // Show connecting state
  btn.classList.add('recording');
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
    // Only mark recording after STT is actually ready
    state.isRecording = true;
    if (span) span.textContent = 'Listening...';
  } catch (err) {
    console.error('[App] STT start failed:', err);
    btn.classList.remove('recording');
    if (span) span.textContent = 'Mic';
    $('waveform').classList.add('hidden');
    avatar?.stopListening();
    state.isRecording = false;
    updateStatus('Voice failed — use text input', false);
  }
}

async function stopRecording(finalText) {
  state.isRecording = false;
  const btn = $('mic-btn');
  btn.classList.remove('recording');
  const span = btn.querySelector('span');
  if (span) span.textContent = 'Mic';
  $('waveform').classList.add('hidden');

  let text = finalText || '';

  try {
    if (!text) {
      // Wait for DashScope to return the final transcription
      if (span) span.textContent = 'Processing...';
      text = await speech.stopAndGetResult(5000);
    } else {
      speech.stopListening();
    }
  } catch (err) {
    console.error('[App] STT stopAndGetResult error:', err);
    text = '';
  } finally {
    // Always reset button state, no matter what
    if (span) span.textContent = 'Mic';
  }

  console.log('[App] STT result:', text);
  if (text && text.trim()) {
    sendUserMessage(text.trim());
  }
}

// ---------- Bot Response ----------
async function handleBotSpeak(data) {
  state.isBotSpeaking = true;
  state._lastBotText = data.text;
  state._lastBotPhase = data.phase;
  $('typing-indicator').classList.add('hidden');
  disableInput();

  addChatMessage(data.text, 'bot');

  // Set phase and immediately start speaking videos (before audio arrives)
  // This ensures the avatar is already animated when TTS audio begins
  avatar?.setPhase(data.phase || 'question');
  avatar?.startSpeaking();


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

  if (data.audio && data.audio.length > 100 && state.isBotSpeaking) {
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
      const elapsed = Date.now() - state._openingVideoStartTime;
      const targetDelay = 8000;
      const remaining = targetDelay - elapsed;
      if (remaining > 0) {
        console.log(`[App] Greeting: waiting ${remaining}ms before TTS audio`);
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

  audio.play().then(() => {
    if (onPlayStart && isFinite(audio.duration)) {
      onPlayStart(audio.duration);
    }
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
    if (state._typewriterControl && !state._typewriterControl.started) {
      const chars = [...text];
      const cjkRatio = chars.filter(c => /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(c)).length / (chars.length || 1);
      const estimatedMs = cjkRatio > 0.3
        ? chars.length * 240
        : text.split(/\s+/).length * 400;
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
  $('typing-indicator').classList.remove('hidden');
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
const MAX_VISIBLE_BUBBLES = 5;
const BUBBLE_GAP = 24;

let _activeTypewriter = null;

function addChatMessage(text, role) {
  const container = $('chat-messages');
  if (!container) return;

  _finishTypewriter();

  const visible = container.querySelectorAll('.chat-msg:not(.fading):not(.chat-status-bubble)');
  if (visible.length >= MAX_VISIBLE_BUBBLES) {
    const oldest = visible[0];
    oldest.classList.add('fading');
    setTimeout(() => oldest.remove(), 600);
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
        const msPerChar = Math.max(20, Math.min(150, durationMs / chars.length));
        let idx = 0;
        let lastH = this.msg.offsetHeight;
        const tid = setInterval(() => {
          if (idx < chars.length) {
            textSpan.textContent += chars[idx];
            idx++;
            if (idx % 5 === 0) {
              const h = this.msg.offsetHeight;
              if (h !== lastH) {
                lastH = h;
                _layoutBubbles(container);
              }
            }
          } else {
            clearInterval(tid);
            if (_activeTypewriter?.tid === tid) _activeTypewriter = null;
            _layoutBubbles(container);
          }
        }, msPerChar);
        _activeTypewriter = { tid, textSpan, fullText: text, msg };
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
  const bubbles = [...container.querySelectorAll('.chat-msg:not(.fading):not(.chat-status-bubble)')];
  if (!bubbles.length) return;

  const containerH = container.offsetHeight;
  const heights = bubbles.map(b => b.offsetHeight);

  // Anchor newest bubble so its center sits at ~55% of container height
  const newestH = heights[heights.length - 1];
  const newestTop = Math.max(20, Math.min(
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

function _finishTypewriter() {
  if (_activeTypewriter) {
    clearInterval(_activeTypewriter.tid);
    _activeTypewriter.textSpan.textContent = _activeTypewriter.fullText;
    _activeTypewriter = null;
  }
  if (state._typewriterControl && !state._typewriterControl.started) {
    state._typewriterControl.textSpan.textContent = state._typewriterControl.fullText;
    state._typewriterControl.started = true;
  }
  state._typewriterControl = null;
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
  const btn = $('mic-btn');
  if (btn) btn.disabled = false;
  const textInput = $('text-input');
  if (textInput) {
    textInput.disabled = false;
    textInput.focus();
  }
  const sendBtn = $('text-send-btn');
  if (sendBtn) sendBtn.disabled = false;
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  initEmailPhase();
  initLanguagePhase();
});

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
function setPhase(phaseName) {
  state.phase = phaseName;
  document.querySelectorAll('.phase').forEach(el => el.classList.remove('active'));
  const el = $(`phase-${phaseName}`);
  if (el) el.classList.add('active');

  const controls = $('interview-controls');
  if (controls) controls.classList.toggle('hidden', phaseName !== 'interview');

  // Stop timer when leaving interview
  if (phaseName === 'complete') {
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

  // Show loading overlay on the avatar area
  const avatarArea = $('avatar-container').parentElement;
  const loader = showLoadingOverlay(avatarArea);
  loader.update('Loading videos...', 0);

  const sttProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const sttUrl = `${sttProtocol}://${window.location.host}/ws/stt`;
  speech = new SpeechManager(state.language, sttUrl);

  // Initialize video avatar with progress
  avatar = new AvatarManager($('avatar-container'));
  try {
    await avatar.init(state.avatar, state.language, (loaded, total) => {
      const pct = Math.round((loaded / total) * 80); // 0-80% for videos
      loader.update(`Loading videos (${loaded}/${total})...`, pct);
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

  // Start timer only after everything is ready
  startTimer();
  updateStatus('Connected', true);
}

// ---------- End Interview Button ----------
function initEndButton() {
  const btn = $('end-interview-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (state.isBotSpeaking) return;

    // Confirm before ending
    const msg = state.language === 'zh'
      ? '确定要结束访谈吗？'
      : 'End the interview now?';

    if (confirm(msg)) {
      disableInput();
      btn.disabled = true;
      ws.send({ action: 'end_interview' });
    }
  });
}

// ---------- Mic Button ----------
function initMicButton() {
  const btn = $('mic-btn');
  let isConnecting = false;

  btn.addEventListener('click', async () => {
    if (state.isBotSpeaking || btn.disabled || isConnecting) return;

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
    if (state.isBotSpeaking || btn.disabled || isConnecting) return;
    isConnecting = true;
    await startRecording();
    isConnecting = false;
  });

  btn.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (state.isRecording) stopRecording();
  });
}

// ---------- Text Input ----------
function initTextInput() {
  const input = $('text-input');
  const sendBtn = $('text-send-btn');
  if (!input || !sendBtn) return;

  const sendMessage = () => {
    const text = input.value.trim();
    if (!text || state.isBotSpeaking) return;
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
  disableInput();
  // Avatar starts listening/acknowledging while processing
  avatar?.startListening();
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
  $('typing-indicator').classList.add('hidden');

  // Stop listening mode when bot starts talking
  avatar?.stopListening();

  addChatMessage(data.text, 'bot');

  // Set phase so avatar picks the right video category
  avatar?.setPhase(data.phase || 'question');

  if (data.questionIndex !== undefined) {
    updateProgress(data.questionIndex, data.totalQuestions);
  }

  // Play audio with video avatar, or fallback
  if (data.audio && data.audio.length > 100) {
    playWithLipSync(data.audio, data.text, data.phase);
  } else {
    speakWithBrowserTTS(data.text, data.phase);
  }
}

/**
 * Decode base64 audio and play with video avatar.
 * For greeting phase, delays audio so it starts ~8s after opening video began.
 */
async function playWithLipSync(audioB64, text, phase) {
  try {
    // Decode base64 to ArrayBuffer
    const binary = atob(audioB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const audioBuffer = bytes.buffer;

    // For greeting: wait until ~8 seconds after opening video started
    if (phase === 'greeting' && state._openingVideoStartTime) {
      const elapsed = Date.now() - state._openingVideoStartTime;
      const targetDelay = 8000; // 8 seconds
      const remaining = targetDelay - elapsed;
      if (remaining > 0) {
        console.log(`[App] Greeting: waiting ${remaining}ms before TTS audio`);
        await new Promise(r => setTimeout(r, remaining));
      }
      state._openingVideoStartTime = null; // Reset after use
    }

    if (avatar && avatar.ready) {
      // Play video avatar + TTS audio
      await avatar.speakAudio(audioBuffer, text);
      onBotDoneSpeaking(phase);
    } else {
      // No avatar — play audio directly
      playAudioFallback(bytes, phase, text);
    }
  } catch (e) {
    console.warn('Lip-sync playback error, falling back:', e);
    speakWithBrowserTTS(text, phase);
  }
}

function playAudioFallback(bytes, phase, text) {
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  audio.onended = () => {
    URL.revokeObjectURL(url);
    onBotDoneSpeaking(phase);
  };
  audio.onerror = () => {
    URL.revokeObjectURL(url);
    speakWithBrowserTTS(text, phase);
  };

  audio.play().catch(() => {
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
    setTimeout(() => onBotDoneSpeaking(phase), 1500);
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = langMap[state.language] || 'en-US';
  utterance.rate = 0.95;
  utterance.pitch = state.avatar === 'female' ? 1.1 : 0.9;
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

  if (phase === 'farewell') {
    setTimeout(() => setPhase('complete'), 1500);
  } else {
    // Switch to listening mode after speaking
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
function addChatMessage(text, role) {
  const container = $('chat-messages');
  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;
  msg.textContent = text;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function updateProgress(current, total) {
  const pct = Math.round((current / total) * 100);
  $('progress-fill').style.width = `${pct}%`;
  $('progress-text').textContent = `${current} / ${total}`;
}

function updateStatus(text, connected) {
  const el = $('status-text');
  if (el) el.textContent = text;
  const dot = $('status-dot');
  if (dot) dot.style.background = connected ? 'var(--accent)' : 'var(--coral)';
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

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
  $('progress-bar').classList.toggle('hidden', phaseName !== 'interview');
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
      setTimeout(() => setPhase('avatar'), 400);
    });
    grid.appendChild(card);
  });
}

// ---------- Phase 3: Avatar ----------
function initAvatarPhase() {
  document.querySelectorAll('.avatar-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.avatar-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.avatar = card.dataset.avatar;
      setTimeout(() => startInterview(), 600);
    });
  });
}

// ---------- Phase 4: Interview ----------
async function startInterview() {
  setPhase('interview');

  // Show loading state
  const statusText = $('status-text');
  if (statusText) statusText.textContent = 'Loading avatar...';

  speech = new SpeechManager(state.language);

  // Initialize TalkingHead 3D avatar
  avatar = new AvatarManager($('avatar-container'));
  try {
    await avatar.init(state.avatar, state.language);
    console.log('TalkingHead avatar loaded');
  } catch (err) {
    console.error('Avatar load error:', err);
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocketManager(`${protocol}://${window.location.host}/ws`);

  ws.on('bot_speak', handleBotSpeak);
  ws.on('bot_thinking', handleBotThinking);
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
  updateStatus('Connected', true);
}

// ---------- Mic Button ----------
function initMicButton() {
  const btn = $('mic-btn');
  let holdTimer = null;
  let isHolding = false;

  btn.addEventListener('mousedown', () => {
    if (state.isBotSpeaking || btn.disabled) return;
    isHolding = true;
    holdTimer = setTimeout(() => startRecording(), 200);
  });

  btn.addEventListener('mouseup', () => {
    if (isHolding && state.isRecording) stopRecording();
    isHolding = false;
    clearTimeout(holdTimer);
  });

  btn.addEventListener('click', () => {
    if (state.isBotSpeaking || btn.disabled) return;
    if (!isHolding) {
      state.isRecording ? stopRecording() : startRecording();
    }
  });

  btn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state.isBotSpeaking || btn.disabled) return;
    startRecording();
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

function startRecording() {
  state.isRecording = true;
  const btn = $('mic-btn');
  btn.classList.add('recording');
  const span = btn.querySelector('span');
  if (span) span.textContent = 'Listening...';
  $('waveform').classList.remove('hidden');

  avatar?.startListening();

  speech.startListening(
    () => {},
    (final) => {
      if (state.isRecording) stopRecording(final);
    }
  );
}

function stopRecording(finalText) {
  state.isRecording = false;
  const btn = $('mic-btn');
  btn.classList.remove('recording');
  const span = btn.querySelector('span');
  if (span) span.textContent = 'Mic';
  $('waveform').classList.add('hidden');

  speech.stopListening();

  const text = finalText || speech.getLastResult();
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

  // Set emotion and gesture based on phase and content
  const emotion = data.emotion || 'friendly';
  avatar?.setEmotion(emotion);

  // Nod when acknowledging user input (question phase)
  if (data.phase === 'question') {
    avatar?.nod();
  }

  if (data.questionIndex !== undefined) {
    updateProgress(data.questionIndex, data.totalQuestions);
  }

  // Play audio with TalkingHead lip-sync, or fallback
  if (data.audio && data.audio.length > 100) {
    playWithLipSync(data.audio, data.text, data.phase);
  } else {
    speakWithBrowserTTS(data.text, data.phase);
  }
}

/**
 * Decode base64 audio and play through TalkingHead with lip-sync.
 */
async function playWithLipSync(audioB64, text, phase) {
  try {
    // Decode base64 to ArrayBuffer
    const binary = atob(audioB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const audioBuffer = bytes.buffer;

    if (avatar && avatar.ready) {
      // Use avatar for playback (TalkingHead or Three.js fallback)
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
    avatar?.setEmotion('grateful');
    avatar?.nod();
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
  if (dot) dot.style.background = connected ? 'var(--success)' : 'var(--danger)';
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
  initAvatarPhase();
});

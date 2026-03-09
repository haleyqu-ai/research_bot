/**
 * Speech recognition manager using Web Speech API.
 */

export class SpeechManager {
  constructor(language) {
    this.language = language;
    this.recognition = null;
    this.lastResult = '';
    this.isListening = false;
    this.onInterim = null;
    this.onFinal = null;

    // Language code mapping for Web Speech API
    this.langMap = {
      en: 'en-US',
      zh: 'zh-CN',
      de: 'de-DE',
      fr: 'fr-FR',
      ja: 'ja-JP',
      ko: 'ko-KR',
      es: 'es-ES',
      pt: 'pt-BR',
      ru: 'ru-RU',
      it: 'it-IT',
    };

    this._initRecognition();
  }

  _initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech Recognition API not supported in this browser.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.lang = this.langMap[this.language] || 'en-US';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    this.recognition.onresult = (event) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim && this.onInterim) {
        this.onInterim(interim);
      }

      if (final) {
        this.lastResult = final;
        if (this.onFinal) {
          this.onFinal(final);
        }
      }
    };

    this.recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
      if (event.error === 'no-speech' || event.error === 'aborted') {
        // These are expected when user stops speaking
        return;
      }
    };

    this.recognition.onend = () => {
      // Auto-restart if still supposed to be listening
      if (this.isListening) {
        try {
          this.recognition.start();
        } catch (e) {
          // Already started
        }
      }
    };
  }

  startListening(onInterim, onFinal) {
    if (!this.recognition) return;

    this.lastResult = '';
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.isListening = true;

    try {
      this.recognition.start();
    } catch (e) {
      // May already be started
    }
  }

  stopListening() {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        // May already be stopped
      }
    }
  }

  getLastResult() {
    return this.lastResult;
  }

  setLanguage(language) {
    this.language = language;
    if (this.recognition) {
      this.recognition.lang = this.langMap[language] || 'en-US';
    }
  }
}

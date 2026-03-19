"""TTS Service — Google Cloud Text-to-Speech with Edge TTS fallback."""

import io
import base64
import httpx
import edge_tts

from config import settings

# Google Cloud TTS endpoint
GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize"

# Google Cloud TTS voice mapping
# Primary languages (zh, en) use Chirp 3 HD — Google's latest LLM-powered voices,
# much more natural and conversational than WaveNet.
# Other languages fall back to WaveNet (Chirp 3 HD has limited locale support).
# Chirp 3 HD voices: Kore/Leda (female, warm), Puck/Charon (male, clear)
GOOGLE_VOICE_MAP = {
    "female": {
        "zh": {"name": "cmn-CN-Chirp3-HD-Leda", "languageCode": "cmn-CN"},
        "en": {"name": "en-US-Chirp3-HD-Kore", "languageCode": "en-US"},
        "de": {"name": "de-DE-Chirp3-HD-Kore", "languageCode": "de-DE"},
        "fr": {"name": "fr-FR-Chirp3-HD-Kore", "languageCode": "fr-FR"},
        "ja": {"name": "ja-JP-Chirp3-HD-Kore", "languageCode": "ja-JP"},
        "ko": {"name": "ko-KR-Chirp3-HD-Kore", "languageCode": "ko-KR"},
        "es": {"name": "es-ES-Chirp3-HD-Kore", "languageCode": "es-ES"},
        "pt": {"name": "pt-BR-Chirp3-HD-Kore", "languageCode": "pt-BR"},
        "ru": {"name": "ru-RU-Wavenet-C", "languageCode": "ru-RU"},
        "it": {"name": "it-IT-Chirp3-HD-Kore", "languageCode": "it-IT"},
    },
    "male": {
        "zh": {"name": "cmn-CN-Chirp3-HD-Puck", "languageCode": "cmn-CN"},
        "en": {"name": "en-US-Chirp3-HD-Puck", "languageCode": "en-US"},
        "de": {"name": "de-DE-Chirp3-HD-Puck", "languageCode": "de-DE"},
        "fr": {"name": "fr-FR-Chirp3-HD-Puck", "languageCode": "fr-FR"},
        "ja": {"name": "ja-JP-Chirp3-HD-Puck", "languageCode": "ja-JP"},
        "ko": {"name": "ko-KR-Chirp3-HD-Puck", "languageCode": "ko-KR"},
        "es": {"name": "es-ES-Chirp3-HD-Puck", "languageCode": "es-ES"},
        "pt": {"name": "pt-BR-Chirp3-HD-Puck", "languageCode": "pt-BR"},
        "ru": {"name": "ru-RU-Wavenet-B", "languageCode": "ru-RU"},
        "it": {"name": "it-IT-Chirp3-HD-Puck", "languageCode": "it-IT"},
    },
}

# Fallback WaveNet voices if Chirp 3 HD fails for a locale
WAVENET_FALLBACK = {
    "female": {
        "zh": {"name": "cmn-CN-Wavenet-A", "languageCode": "cmn-CN"},
        "en": {"name": "en-US-Wavenet-F", "languageCode": "en-US"},
    },
    "male": {
        "zh": {"name": "cmn-CN-Wavenet-B", "languageCode": "cmn-CN"},
        "en": {"name": "en-US-Wavenet-D", "languageCode": "en-US"},
    },
}

# --- Edge TTS voice mapping (fallback) ---
EDGE_VOICE_MAP = {
    "female": {
        "zh": "zh-CN-XiaoxiaoNeural",
        "en": "en-US-JennyNeural",
        "de": "de-DE-KatjaNeural",
        "fr": "fr-FR-DeniseNeural",
        "ja": "ja-JP-NanamiNeural",
        "ko": "ko-KR-SunHiNeural",
        "es": "es-ES-ElviraNeural",
        "pt": "pt-BR-FranciscaNeural",
        "ru": "ru-RU-SvetlanaNeural",
        "it": "it-IT-ElsaNeural",
    },
    "male": {
        "zh": "zh-CN-YunxiNeural",
        "en": "en-US-GuyNeural",
        "de": "de-DE-ConradNeural",
        "fr": "fr-FR-HenriNeural",
        "ja": "ja-JP-KeitaNeural",
        "ko": "ko-KR-InJoonNeural",
        "es": "es-ES-AlvaroNeural",
        "pt": "pt-BR-AntonioNeural",
        "ru": "ru-RU-DmitryNeural",
        "it": "it-IT-DiegoNeural",
    },
}


class TTSService:
    """Google Cloud TTS with Edge TTS fallback."""

    def __init__(self):
        self.use_google = bool(settings.GOOGLE_CLOUD_API_KEY)
        if self.use_google:
            print("[TTS] Using Google Cloud Text-to-Speech")
        else:
            print("[TTS] No GOOGLE_CLOUD_API_KEY set, using Edge TTS fallback")

    async def synthesize(self, text: str, language: str, avatar: str) -> bytes:
        """Synthesize speech, returns MP3 audio bytes."""
        if self.use_google:
            try:
                return await self._google_tts(text, language, avatar)
            except Exception as e:
                print(f"[TTS] Google Cloud TTS failed: {e}, falling back to Edge TTS")

        return await self._edge_tts(text, language, avatar)

    async def _google_tts(self, text: str, language: str, avatar: str) -> bytes:
        """Call Google Cloud Text-to-Speech REST API.

        Uses Chirp 3 HD voices (LLM-powered, most natural).
        Falls back to WaveNet if Chirp 3 HD fails for a locale.
        """
        gender = "female" if avatar == "female" else "male"
        voice_config = GOOGLE_VOICE_MAP.get(gender, {}).get(language)

        if not voice_config:
            voice_config = GOOGLE_VOICE_MAP[gender]["en"]

        is_chirp = "Chirp3-HD" in voice_config["name"]

        audio_config = {"audioEncoding": "MP3"}
        # Chirp 3 HD handles pacing naturally; only set speakingRate for WaveNet
        if not is_chirp:
            audio_config["speakingRate"] = 1.12

        payload = {
            "input": {"text": text},
            "voice": {
                "languageCode": voice_config["languageCode"],
                "name": voice_config["name"],
            },
            "audioConfig": audio_config,
        }

        api_key = settings.GOOGLE_CLOUD_API_KEY
        url = f"{GOOGLE_TTS_URL}?key={api_key}"

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload)

            # If Chirp 3 HD fails, fall back to WaveNet
            if resp.status_code != 200 and is_chirp:
                fallback = WAVENET_FALLBACK.get(gender, {}).get(language)
                if fallback:
                    print(f"[TTS] Chirp 3 HD failed ({resp.status_code}), falling back to WaveNet for {language}")
                    payload["voice"] = {
                        "languageCode": fallback["languageCode"],
                        "name": fallback["name"],
                    }
                    payload["audioConfig"]["speakingRate"] = 1.12
                    resp = await client.post(url, json=payload)

            resp.raise_for_status()
            data = resp.json()

        audio_b64 = data.get("audioContent", "")
        if not audio_b64:
            raise ValueError(f"No audioContent in Google TTS response: {data}")

        audio_bytes = base64.b64decode(audio_b64)
        voice_type = "Chirp3-HD" if is_chirp else "WaveNet"
        print(f"[TTS] {voice_type} synthesized {len(audio_bytes)} bytes MP3 ({voice_config['name']})")
        return audio_bytes

    async def _edge_tts(self, text: str, language: str, avatar: str) -> bytes:
        """Fallback: Edge TTS (Microsoft neural voices, free, no API key)."""
        gender = "female" if avatar == "female" else "male"
        voice = EDGE_VOICE_MAP.get(gender, {}).get(language, "en-US-JennyNeural")

        communicate = edge_tts.Communicate(text, voice, rate="+12%")
        buf = io.BytesIO()

        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])

        return buf.getvalue()

"""TTS Service — Google Cloud Text-to-Speech with Edge TTS fallback."""

import io
import base64
import httpx
import edge_tts

from config import settings

# Google Cloud TTS endpoint
GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize"

# Google Cloud TTS voice mapping (WaveNet voices for natural sound)
GOOGLE_VOICE_MAP = {
    "female": {
        "zh": {"name": "cmn-CN-Wavenet-A", "languageCode": "cmn-CN"},
        "en": {"name": "en-US-Wavenet-F", "languageCode": "en-US"},
        "de": {"name": "de-DE-Wavenet-C", "languageCode": "de-DE"},
        "fr": {"name": "fr-FR-Wavenet-C", "languageCode": "fr-FR"},
        "ja": {"name": "ja-JP-Wavenet-B", "languageCode": "ja-JP"},
        "ko": {"name": "ko-KR-Wavenet-A", "languageCode": "ko-KR"},
        "es": {"name": "es-ES-Wavenet-C", "languageCode": "es-ES"},
        "pt": {"name": "pt-BR-Wavenet-A", "languageCode": "pt-BR"},
        "ru": {"name": "ru-RU-Wavenet-C", "languageCode": "ru-RU"},
        "it": {"name": "it-IT-Wavenet-A", "languageCode": "it-IT"},
    },
    "male": {
        "zh": {"name": "cmn-CN-Wavenet-B", "languageCode": "cmn-CN"},
        "en": {"name": "en-US-Wavenet-D", "languageCode": "en-US"},
        "de": {"name": "de-DE-Wavenet-D", "languageCode": "de-DE"},
        "fr": {"name": "fr-FR-Wavenet-D", "languageCode": "fr-FR"},
        "ja": {"name": "ja-JP-Wavenet-D", "languageCode": "ja-JP"},
        "ko": {"name": "ko-KR-Wavenet-C", "languageCode": "ko-KR"},
        "es": {"name": "es-ES-Wavenet-B", "languageCode": "es-ES"},
        "pt": {"name": "pt-BR-Wavenet-B", "languageCode": "pt-BR"},
        "ru": {"name": "ru-RU-Wavenet-B", "languageCode": "ru-RU"},
        "it": {"name": "it-IT-Wavenet-C", "languageCode": "it-IT"},
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
        """Call Google Cloud Text-to-Speech REST API."""
        gender = "female" if avatar == "female" else "male"
        voice_config = GOOGLE_VOICE_MAP.get(gender, {}).get(language)

        if not voice_config:
            # Default to English
            voice_config = GOOGLE_VOICE_MAP[gender]["en"]

        payload = {
            "input": {"text": text},
            "voice": {
                "languageCode": voice_config["languageCode"],
                "name": voice_config["name"],
            },
            "audioConfig": {
                "audioEncoding": "MP3",
                "speakingRate": 1.12,
            },
        }

        api_key = settings.GOOGLE_CLOUD_API_KEY
        url = f"{GOOGLE_TTS_URL}?key={api_key}"

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()

        # Response contains base64-encoded audio
        audio_b64 = data.get("audioContent", "")
        if not audio_b64:
            raise ValueError(f"No audioContent in Google TTS response: {data}")

        audio_bytes = base64.b64decode(audio_b64)
        print(f"[TTS] Google Cloud synthesized {len(audio_bytes)} bytes MP3")
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

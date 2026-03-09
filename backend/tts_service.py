"""TTS Service — Qwen3-TTS (DashScope) with Edge TTS fallback."""

import io
import httpx
import edge_tts

from config import settings

# --- Qwen3-TTS voice mapping ---
QWEN_VOICE_MAP = {
    "female": "Cherry",   # Natural female voice, multi-language
    "male": "Ethan",      # Natural male voice, multi-language
}

QWEN_LANG_MAP = {
    "zh": "Chinese", "en": "English", "de": "German",
    "fr": "French", "ja": "Japanese", "ko": "Korean",
    "es": "Spanish", "pt": "Portuguese", "ru": "Russian",
    "it": "Italian",
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

# DashScope API endpoint (China region)
DASHSCOPE_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"


class TTSService:
    """Qwen3-TTS via DashScope with Edge TTS fallback."""

    def __init__(self):
        self.use_qwen = bool(settings.DASHSCOPE_API_KEY)
        if self.use_qwen:
            print("[TTS] Using Qwen3-TTS (DashScope)")
        else:
            print("[TTS] No DASHSCOPE_API_KEY set, using Edge TTS fallback")

    async def synthesize(self, text: str, language: str, avatar: str) -> bytes:
        """Synthesize speech, returns MP3 audio bytes."""
        if self.use_qwen:
            try:
                return await self._qwen_tts(text, language, avatar)
            except Exception as e:
                print(f"[TTS] Qwen3-TTS failed: {e}, falling back to Edge TTS")

        return await self._edge_tts(text, language, avatar)

    async def _qwen_tts(self, text: str, language: str, avatar: str) -> bytes:
        """Call Qwen3-TTS via DashScope REST API."""
        gender = "female" if avatar == "female" else "male"
        voice = QWEN_VOICE_MAP.get(gender, "Cherry")
        lang_type = QWEN_LANG_MAP.get(language, "Auto")

        payload = {
            "model": "qwen3-tts-flash",
            "input": {
                "text": text,
                "voice": voice,
                "language_type": lang_type,
            },
        }

        headers = {
            "Authorization": f"Bearer {settings.DASHSCOPE_API_KEY}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(DASHSCOPE_URL, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

            # Extract audio URL from response
            output = data.get("output", {})
            audio_url = output.get("audio", {}).get("url")

            if not audio_url:
                raise ValueError(f"No audio URL in Qwen3-TTS response: {data}")

            # Download the audio
            audio_resp = await client.get(audio_url)
            audio_resp.raise_for_status()
            return audio_resp.content

    async def _edge_tts(self, text: str, language: str, avatar: str) -> bytes:
        """Fallback: Edge TTS (Microsoft neural voices, free, no API key)."""
        gender = "female" if avatar == "female" else "male"
        voice = EDGE_VOICE_MAP.get(gender, {}).get(language, "en-US-JennyNeural")

        communicate = edge_tts.Communicate(text, voice, rate="-5%")
        buf = io.BytesIO()

        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])

        return buf.getvalue()

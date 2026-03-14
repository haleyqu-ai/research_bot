"""STT Service — Google Cloud Speech-to-Text via REST API."""

import base64
import httpx

from config import settings

# Google Cloud Speech-to-Text v1 endpoint
GOOGLE_STT_URL = "https://speech.googleapis.com/v1/speech:recognize"

# Language code mapping
LANG_MAP = {
    "zh": "zh-CN",
    "en": "en-US",
    "de": "de-DE",
    "fr": "fr-FR",
    "ja": "ja-JP",
    "ko": "ko-KR",
    "es": "es-ES",
    "pt": "pt-BR",
    "ru": "ru-RU",
    "it": "it-IT",
}

# Phrase hints to boost recognition of brand names and 3D terminology
# These are especially important for non-English languages where users
# frequently mix in English brand names and technical terms
PHRASE_HINTS = [
    # Meshy product
    "Meshy", "meshy.ai", "Meshy AI",
    "Text to 3D", "Image to 3D", "Text to Texture",
    "Remesh", "Retexture", "AI Texturing",
    "Meshy 3", "Meshy 4", "Meshy 5", "Meshy 6",
    "Blender Bridge", "Solid Paint",
    "PBR", "GLB", "FBX", "OBJ", "STL", "USDZ",

    # Competitors
    "Tripo", "Tripo AI", "Tripo3D",
    "Hitem", "Hitem AI", "Hitem 3D",
    "Sparc3D", "Sparc",
    "Luma", "Luma AI",
    "Kaedim",
    "Rodin", "Rodin AI",
    "3D AI Studio",
    "Hunyuan", "Tencent Hunyuan",

    # 3D software
    "Blender", "ZBrush", "Maya", "3ds Max",
    "Unity", "Unreal Engine", "Unreal",
    "Godot", "GDevelop", "Roblox", "Roblox Studio",
    "Substance Painter", "MagicaVoxel",
    "Mixamo", "After Effects",
    "Tinkercad", "MeshLab",
    "Bambu Studio", "Chitubox", "Cura",

    # Image AI tools
    "Midjourney", "DALL-E", "Stable Diffusion",
    "ComfyUI", "FLUX", "Leonardo AI",

    # 3D technical terms
    "topology", "retopology", "retopo",
    "UV map", "UV mapping", "UV unwrap",
    "polygon", "low poly", "high poly",
    "rigging", "auto rigging",
    "A-pose", "T-pose",
    "normal map", "displacement map",
    "albedo", "roughness", "metallic",
    "manifold", "watertight",
    "voxel", "mesh",
    "shape keys", "blend shapes",
    "lip sync",
]


class GoogleCloudSTT:
    """Buffers audio chunks, then sends to Google Cloud STT for recognition."""

    def __init__(self, language: str = "en"):
        self.language = language
        self._chunks: list[bytes] = []

    def add_audio(self, chunk: bytes):
        """Buffer a raw PCM audio chunk (16-bit 16kHz mono)."""
        self._chunks.append(chunk)

    async def recognize(self) -> str:
        """Send all buffered audio to Google Cloud STT and return transcript."""
        if not self._chunks:
            return ""

        # Combine all chunks into one PCM buffer
        pcm_data = b"".join(self._chunks)
        audio_b64 = base64.b64encode(pcm_data).decode("utf-8")

        lang_code = LANG_MAP.get(self.language, "en-US")

        payload = {
            "config": {
                "encoding": "LINEAR16",
                "sampleRateHertz": 16000,
                "languageCode": lang_code,
                "enableAutomaticPunctuation": True,
                # Phrase hints boost recognition of specific words/phrases
                "speechContexts": [
                    {
                        "phrases": PHRASE_HINTS,
                        "boost": 15.0,
                    }
                ],
            },
            "audio": {
                "content": audio_b64,
            },
        }

        api_key = settings.GOOGLE_CLOUD_API_KEY
        url = f"{GOOGLE_STT_URL}?key={api_key}"

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()

        # Extract transcript from results
        results = data.get("results", [])
        transcript_parts = []
        for result in results:
            alternatives = result.get("alternatives", [])
            if alternatives:
                transcript_parts.append(alternatives[0].get("transcript", ""))

        transcript = " ".join(transcript_parts).strip()
        print(f"[STT] Google Cloud recognized: '{transcript}' ({len(pcm_data)} bytes PCM)")
        return transcript

    def clear(self):
        """Clear buffered audio."""
        self._chunks.clear()

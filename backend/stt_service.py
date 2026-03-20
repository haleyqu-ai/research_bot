"""STT Service — Google Cloud Speech-to-Text via REST API."""

import asyncio
import base64
import re
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
# Post-processing: fix common STT misrecognitions of brand names.
# Google Cloud phrase hints boost probability but can't force replacements,
# so we correct known errors after recognition.
STT_CORRECTIONS = [
    # "triple/Triple" → Tripo (competitor name, very common in interviews)
    (re.compile(r'\btriple\b', re.IGNORECASE), 'Tripo'),
    # "mesh/Mesh" → Meshy (product name; \b prevents matching inside "remesh")
    # Negative lookahead: keep "mesh" when followed by 3D terms (mesh quality, mesh topology...)
    (re.compile(r'\bmesh\b(?!\s+(?:quality|topology|topologies|model|models|data|file|files|format|generation|editing|editor|resolution|density|polygon|structure|issue|issues|error|errors|broken|clean))', re.IGNORECASE), 'Meshy'),
    # "mash/Mash" → Meshy
    (re.compile(r'\bmash\b', re.IGNORECASE), 'Meshy'),
]


def _apply_corrections(text: str) -> str:
    """Apply brand name corrections to STT output."""
    original = text
    for pattern, replacement in STT_CORRECTIONS:
        text = pattern.sub(replacement, text)
    if text != original:
        print(f"[STT] Corrected: '{original}' → '{text}'")
    return text


# High-priority brand names — easily confused with common words.
# "Meshy" sounds like "mesh/mash", "Tripo" sounds like "triple/trip".
# These get a separate speechContext with max boost so STT prefers them.
BRAND_HINTS = [
    "Meshy", "Meshy AI", "meshy.ai",
    "Tripo", "Tripo AI", "Tripo3D",
]

PHRASE_HINTS = [
    # ── Meshy workspace features (from feature matrix) ──
    "Meshy AI",
    "Text to 3D", "Text to 3D model", "Image to 3D", "Image to 3D model",
    "Batch Images to 3D",
    "Text to Texture", "Texture Generation", "Generate PBR Maps",
    "Remesh", "Retexture", "AI Texturing",
    "Meshy 3", "Meshy 4", "Meshy 5", "Meshy 6", "Meshy 6 Preview",
    "Blender Bridge", "DCC Bridge", "Solid Paint",
    "Nano Banana", "Nano Banana Pro",
    "Prompt helper", "Background Removal",
    "Rig", "Animate", "Animate Library",
    "Multi-view", "Multi select mode",
    "Image to Video", "Text to Video", "3D to video", "3D to image",
    "Image Render", "3D Reference", "Audio Generation",
    "Asset Card", "Related Assets", "Collection",
    "Workspace Toolbar", "Download Settings",
    "Multi-Color Printing", "Full color 3D Print", "Add Base",
    "CC BY 4.0", "License",
    "Target Polycount", "Polycount",
    "Quad", "Triangle", "Adaptive", "Fixed",
    "GPT-Image", "Veo3", "Kling", "Kling 2.5 Turbo", "Kling 2.1",

    # ── File formats ──
    "PBR", "GLB", "GLTF", "FBX", "OBJ", "STL", "USDZ", "GCODE",

    # ── Competitors (Tripo is in BRAND_HINTS with higher boost) ──
    "Hitem", "Hitem AI", "Hitem 3D",
    "Sparc3D", "Sparc",
    "Luma", "Luma AI",
    "Kaedim",
    "Rodin", "Rodin AI",
    "3D AI Studio",
    "Hunyuan", "Tencent Hunyuan",

    # ── 3D / DCC software ──
    "Blender", "ZBrush", "Maya", "3ds Max", "Cinema 4D",
    "Unity", "Unreal Engine", "Unreal",
    "Godot", "GDevelop", "Roblox", "Roblox Studio",
    "Substance Painter", "Substance Designer", "MagicaVoxel",
    "Mixamo", "After Effects", "Marvelous Designer",
    "Tinkercad", "MeshLab", "SketchUp",

    # ── Image / Video AI tools ──
    "Midjourney", "DALL-E", "Stable Diffusion",
    "ComfyUI", "FLUX", "Leonardo AI",

    # ── 3D modeling & technical terms ──
    "topology", "retopology", "retopo",
    "UV map", "UV mapping", "UV unwrap",
    "polygon", "low poly", "low-poly", "high poly",
    "polycount", "poly count", "triangle count",
    "rigging", "auto rigging", "skinning", "skeletal animation",
    "A-pose", "T-pose",
    "normal map", "displacement map", "texture atlas",
    "albedo", "roughness", "metallic",
    "manifold", "watertight",
    "voxel", "subdivision", "Boolean",
    "shape keys", "blend shapes",
    "lip sync",
    "LOD", "level of detail",
    "baking", "light baking", "lightmap",
    "ambient occlusion", "occlusion",
    "navmesh", "navigation mesh",
    "draw call", "shader", "material",
    "game-ready", "game asset",

    # ── 3D printing terms ──
    "FDM", "SLA", "SLS", "DLP", "resin printing",
    "PLA", "ABS", "PETG", "TPU", "resin",
    "filament", "nozzle", "extruder",
    "layer height", "infill", "support structure",
    "build plate", "print bed", "bed adhesion",
    "overhang", "bridging", "warping", "stringing",
    "slicer", "Cura", "PrusaSlicer", "OrcaSlicer",
    "Bambu Studio", "Bambu Lab", "Chitubox",
    "Creality", "Prusa", "Ender",
    "multi-material", "multi-color",
]


class GoogleCloudSTT:
    """Buffers audio chunks, then sends to Google Cloud STT for recognition."""

    def __init__(self, language: str = "en"):
        self.language = language
        self._chunks: list[bytes] = []

    def add_audio(self, chunk: bytes):
        """Buffer a raw PCM audio chunk (16-bit 16kHz mono)."""
        self._chunks.append(chunk)

    # Google Cloud STT sync API limit: 60 seconds of audio.
    # We split at 55s to stay safely under the limit.
    BYTES_PER_SECOND = 16000 * 2  # 16kHz, 16-bit mono
    MAX_SEGMENT_BYTES = 55 * BYTES_PER_SECOND

    async def recognize(self) -> str:
        """Send all buffered audio to Google Cloud STT and return transcript.

        Audio longer than 55 seconds is automatically split into segments
        and recognized in parallel, then concatenated.
        """
        if not self._chunks:
            return ""

        pcm_data = b"".join(self._chunks)
        duration_s = len(pcm_data) / self.BYTES_PER_SECOND
        print(f"[STT] Total audio: {len(pcm_data)} bytes ({duration_s:.1f}s)")

        # Split into segments if needed
        if len(pcm_data) <= self.MAX_SEGMENT_BYTES:
            return _apply_corrections(await self._recognize_segment(pcm_data))

        segments = []
        for i in range(0, len(pcm_data), self.MAX_SEGMENT_BYTES):
            segments.append(pcm_data[i : i + self.MAX_SEGMENT_BYTES])
        print(f"[STT] Audio exceeds 55s limit, split into {len(segments)} segments")

        # Recognize all segments in parallel
        results = await asyncio.gather(
            *(self._recognize_segment(seg, idx=i) for i, seg in enumerate(segments)),
            return_exceptions=True,
        )

        # Concatenate successful results in order
        parts = []
        for i, r in enumerate(results):
            if isinstance(r, Exception):
                print(f"[STT] Segment {i} failed: {r}")
            elif r:
                parts.append(r)

        transcript = " ".join(parts).strip()
        transcript = _apply_corrections(transcript)
        print(f"[STT] Combined transcript: '{transcript[:100]}...' ({len(parts)}/{len(segments)} segments)")
        return transcript

    async def _recognize_segment(self, pcm_data: bytes, idx: int = 0) -> str:
        """Recognize a single audio segment (must be <= 60s)."""
        audio_b64 = base64.b64encode(pcm_data).decode("utf-8")
        lang_code = LANG_MAP.get(self.language, "en-US")

        # Code-switching: add alternative languages
        alt_langs = []
        if lang_code != "en-US":
            alt_langs.append("en-US")
        if lang_code == "en-US":
            alt_langs.append("zh-CN")

        # "latest_long" enhanced model only supports en-US;
        # other languages use the default model.
        config = {
                "encoding": "LINEAR16",
                "sampleRateHertz": 16000,
                "languageCode": lang_code,
                "alternativeLanguageCodes": alt_langs,
        }
        if lang_code == "en-US":
            config["model"] = "latest_long"
            config["useEnhanced"] = True

        payload = {
            "config": {**config,
                "enableAutomaticPunctuation": True,
                "speechContexts": [
                    {
                        "phrases": BRAND_HINTS,
                        "boost": 20.0,
                    },
                    {
                        "phrases": PHRASE_HINTS,
                        "boost": 15.0,
                    },
                ],
            },
            "audio": {
                "content": audio_b64,
            },
        }

        api_key = settings.GOOGLE_CLOUD_API_KEY
        url = f"{GOOGLE_STT_URL}?key={api_key}"
        duration_s = len(pcm_data) / self.BYTES_PER_SECOND

        print(f"[STT] Segment {idx}: {len(pcm_data)} bytes ({duration_s:.1f}s) → Google Cloud (lang={lang_code})")

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code != 200:
                print(f"[STT] Segment {idx} error: {resp.status_code} {resp.text[:500]}")
                resp.raise_for_status()
            data = resp.json()

        results = data.get("results", [])
        if not results:
            print(f"[STT] Segment {idx}: no results from Google Cloud")
        transcript_parts = []
        for result in results:
            alternatives = result.get("alternatives", [])
            if alternatives:
                transcript_parts.append(alternatives[0].get("transcript", ""))

        transcript = " ".join(transcript_parts).strip()
        print(f"[STT] Segment {idx} recognized: '{transcript[:80]}'")
        return transcript

    def clear(self):
        """Clear buffered audio."""
        self._chunks.clear()

"""STT Service — DashScope Paraformer real-time speech recognition via WebSocket."""

import json
import uuid
import asyncio
import websockets

from config import settings

# DashScope real-time ASR WebSocket endpoint
DASHSCOPE_ASR_WSS = "wss://dashscope.aliyuncs.com/api-ws/v1/inference/"

# Paraformer real-time model
ASR_MODEL = "paraformer-realtime-v2"

# Language hints for better recognition
LANG_HINTS = {
    "zh": ["zh", "en"],
    "en": ["en"],
    "ja": ["ja", "en"],
    "ko": ["ko", "en"],
    "de": ["de", "en"],
    "fr": ["fr", "en"],
    "es": ["es", "en"],
    "pt": ["pt", "en"],
    "ru": ["ru", "en"],
    "it": ["it", "en"],
}


class DashScopeSTT:
    """Streams audio to DashScope Paraformer and returns transcription results."""

    def __init__(self, language: str = "en"):
        self.language = language
        self.task_id = str(uuid.uuid4())
        self.ws = None
        self._connected = False

    async def connect(self):
        """Open WebSocket connection to DashScope ASR."""
        headers = {
            "Authorization": f"Bearer {settings.DASHSCOPE_API_KEY}",
            "X-DashScope-DataInspection": "enable",
        }

        self.ws = await websockets.connect(
            DASHSCOPE_ASR_WSS,
            additional_headers=headers,
            ping_interval=20,
            ping_timeout=10,
        )

        # Send run-task directive
        lang_hints = LANG_HINTS.get(self.language, ["en"])
        run_msg = {
            "header": {
                "action": "run-task",
                "task_id": self.task_id,
                "streaming": "duplex",
            },
            "payload": {
                "task_group": "audio",
                "task": "asr",
                "function": "recognition",
                "model": ASR_MODEL,
                "parameters": {
                    "format": "pcm",
                    "sample_rate": 16000,
                    "language_hints": lang_hints,
                    "disfluency_removal_enabled": True,
                },
                "input": {},
            },
        }

        await self.ws.send(json.dumps(run_msg))

        # Wait for task-started confirmation
        resp = await self.ws.recv()
        data = json.loads(resp)
        action = data.get("header", {}).get("action", "")
        if action == "task-started":
            self._connected = True
            print(f"[STT] Paraformer session started: {self.task_id}")
        else:
            event = data.get("header", {}).get("event", action)
            raise RuntimeError(f"Unexpected ASR response: {event} — {data}")

    async def send_audio(self, audio_chunk: bytes):
        """Send raw PCM audio chunk (16-bit 16kHz mono)."""
        if not self.ws or not self._connected:
            return
        try:
            await self.ws.send(audio_chunk)
        except Exception as e:
            print(f"[STT] Send error: {e}")

    async def recv_result(self) -> dict | None:
        """Receive one transcription result. Returns None if connection closed."""
        if not self.ws or not self._connected:
            return None
        try:
            msg = await asyncio.wait_for(self.ws.recv(), timeout=0.1)
            data = json.loads(msg)
            header = data.get("header", {})
            payload = data.get("payload", {})
            output = payload.get("output", {})

            action = header.get("action", "")
            event = header.get("event", "")

            if action == "result-generated" or event == "result-generated":
                sentence = output.get("sentence", {})
                return {
                    "text": sentence.get("text", ""),
                    "is_final": sentence.get("end_time", -1) >= 0,
                }
            elif action == "task-finished" or event == "task-finished":
                self._connected = False
                return None
            elif action == "task-failed" or event == "task-failed":
                print(f"[STT] Task failed: {data}")
                self._connected = False
                return None

            return None
        except asyncio.TimeoutError:
            return None
        except websockets.ConnectionClosed:
            self._connected = False
            return None

    async def finish(self):
        """Send finish signal and close."""
        if not self.ws:
            return

        try:
            finish_msg = {
                "header": {
                    "action": "finish-task",
                    "task_id": self.task_id,
                    "streaming": "duplex",
                },
                "payload": {
                    "input": {},
                },
            }
            await self.ws.send(json.dumps(finish_msg))

            # Drain remaining results
            try:
                while self._connected:
                    msg = await asyncio.wait_for(self.ws.recv(), timeout=2.0)
                    data = json.loads(msg)
                    event = data.get("header", {}).get("event", "")
                    if event in ("task-finished", "task-failed"):
                        break
            except (asyncio.TimeoutError, websockets.ConnectionClosed):
                pass

            await self.ws.close()
        except Exception as e:
            print(f"[STT] Finish error: {e}")
        finally:
            self.ws = None
            self._connected = False

    @property
    def is_connected(self):
        return self._connected

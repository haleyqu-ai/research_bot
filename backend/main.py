"""Meshy ResearchBot — FastAPI Backend"""

import asyncio
import json
import base64
import re
import sys
from pathlib import Path
from datetime import datetime, timezone

# Ensure backend modules are importable
sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uvicorn

from conversation import ConversationEngine
from tts_service import TTSService
from stt_service import DashScopeSTT
from config import settings

app = FastAPI(title="Meshy ResearchBot")

PROJECT_ROOT = Path(__file__).parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
DATA_DIR = PROJECT_ROOT / "data" / "sessions"
REPORTS_DIR = PROJECT_ROOT / "data" / "reports"


# Disable caching for JS/CSS during development (raw ASGI middleware — safe for WebSockets)
class NoCacheMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            # Pass WebSocket and other non-HTTP connections through unchanged
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if not path.endswith((".js", ".css", ".html")):
            await self.app(scope, receive, send)
            return

        # Intercept response headers to add no-cache
        async def send_with_nocache(message):
            if message["type"] == "http.response.start":
                headers = dict(message.get("headers", []))
                extra = [
                    (b"cache-control", b"no-cache, no-store, must-revalidate"),
                    (b"pragma", b"no-cache"),
                    (b"expires", b"0"),
                ]
                message = dict(message)
                message["headers"] = list(message.get("headers", [])) + extra
            await send(message)

        await self.app(scope, receive, send_with_nocache)


app.add_middleware(NoCacheMiddleware)

# Serve static files
app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

# TTS service (lazy init)
tts_service: TTSService | None = None

# Conversation engines keyed by session
conversations: dict[str, ConversationEngine] = {}


@app.get("/")
async def index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.websocket("/ws/stt")
async def stt_endpoint(ws: WebSocket):
    """Relay audio ↔ DashScope Paraformer real-time STT."""
    print("[STT WS] === New STT connection ===")
    await ws.accept()
    print("[STT WS] WebSocket accepted")
    stt: DashScopeSTT | None = None

    try:
        # Wait for init message with language
        init_raw = await ws.receive_text()
        init_msg = json.loads(init_raw)
        language = init_msg.get("language", "en")
        print(f"[STT WS] Init: language={language}")

        stt = DashScopeSTT(language=language)
        try:
            await stt.connect()
            print("[STT WS] DashScope connected successfully")
        except Exception as e:
            print(f"[STT WS] DashScope connection failed: {e}")
            await ws.send_json({"type": "stt_error", "message": f"STT connection failed: {e}"})
            await ws.close()
            return
        await ws.send_json({"type": "stt_ready"})
        print("[STT WS] Sent stt_ready to browser")

        # Background task: forward DashScope results → browser
        audio_chunk_count = 0

        async def forward_results():
            while stt.is_connected:
                result = await stt.recv_result()
                if result:
                    print(f"[STT WS] Result: text='{result['text']}' is_final={result['is_final']}")
                    await ws.send_json({
                        "type": "stt_result",
                        "text": result["text"],
                        "is_final": result["is_final"],
                    })
                else:
                    await asyncio.sleep(0.05)

        result_task = asyncio.create_task(forward_results())

        # Main loop: receive audio/control from browser
        while True:
            msg = await ws.receive()

            if msg.get("type") == "websocket.receive":
                if "bytes" in msg and msg["bytes"]:
                    # Binary = PCM audio data
                    audio_chunk_count += 1
                    if audio_chunk_count <= 3 or audio_chunk_count % 50 == 0:
                        print(f"[STT WS] Audio chunk #{audio_chunk_count}, size={len(msg['bytes'])} bytes")
                    await stt.send_audio(msg["bytes"])
                elif "text" in msg and msg["text"]:
                    ctrl = json.loads(msg["text"])
                    print(f"[STT WS] Control message: {ctrl}")
                    if ctrl.get("action") == "stop":
                        print(f"[STT WS] Stop requested. Total audio chunks: {audio_chunk_count}")
                        # Send finish-task to DashScope so it flushes final results
                        if stt and stt.ws and stt._connected:
                            finish_msg = {
                                "header": {
                                    "action": "finish-task",
                                    "task_id": stt.task_id,
                                    "streaming": "duplex",
                                },
                                "payload": {"input": {}},
                            }
                            await stt.ws.send(json.dumps(finish_msg))

                        # Let result_task forward remaining results
                        # (it exits when stt.is_connected becomes False)
                        try:
                            await asyncio.wait_for(result_task, timeout=3.0)
                        except asyncio.TimeoutError:
                            result_task.cancel()
                            try:
                                await result_task
                            except asyncio.CancelledError:
                                pass
                        break

        # Mark STT as finished (connection already drained above)
        if stt:
            stt._connected = False
            if stt.ws:
                try:
                    await stt.ws.close()
                except Exception:
                    pass
                stt.ws = None

    except WebSocketDisconnect:
        print("[STT WS] Browser disconnected")
    except Exception as e:
        import traceback
        print(f"[STT WS] Error: {e}")
        traceback.print_exc()
    finally:
        print(f"[STT WS] Cleanup. Audio chunks received: {audio_chunk_count if 'audio_chunk_count' in dir() else 'N/A'}")
        if stt and stt.is_connected:
            await stt.finish()


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    session_id = None

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            action = msg.get("action")

            # --- Start session ---
            if action == "start_session":
                email = msg["email"]
                language = msg["language"]
                avatar = msg["avatar"]
                session_id = f"{email}_{language}_{avatar}"

                engine = ConversationEngine(
                    language=language,
                    avatar=avatar,
                    email=email,
                )
                conversations[session_id] = engine

                # Generate greeting + first question
                result = await engine.get_greeting()
                audio_b64 = await synthesize_speech(result["text"], language, avatar)

                await ws.send_json({
                    "type": "bot_speak",
                    "text": result["text"],
                    "audio": audio_b64,
                    "emotion": result["emotion"],
                    "gesture": result.get("gesture", "talking"),
                    "phase": "greeting",
                })

            # --- User answered ---
            elif action == "user_answer":
                if not session_id or session_id not in conversations:
                    await ws.send_json({"type": "error", "message": "No active session"})
                    continue

                engine = conversations[session_id]
                user_text = msg["text"]
                language = engine.language
                avatar = engine.avatar

                # Send "thinking" state immediately
                await ws.send_json({
                    "type": "bot_thinking",
                    "emotion": "thinking",
                })

                # Get AI response
                result = await engine.process_answer(user_text)

                if result.get("completed"):
                    audio_b64 = await synthesize_speech(result["text"], language, avatar)
                    await ws.send_json({
                        "type": "bot_speak",
                        "text": result["text"],
                        "audio": audio_b64,
                        "emotion": result["emotion"],
                        "gesture": "bow",
                        "phase": "farewell",
                    })
                    # Save and generate report
                    await finalize_session(ws, session_id, engine)
                else:
                    audio_b64 = await synthesize_speech(result["text"], language, avatar)
                    await ws.send_json({
                        "type": "bot_speak",
                        "text": result["text"],
                        "audio": audio_b64,
                        "emotion": result["emotion"],
                        "gesture": result.get("gesture", "talking"),
                        "phase": "question",
                        "questionIndex": engine.current_question_index,
                        "totalQuestions": engine.total_questions,
                    })

            # --- User ends interview early ---
            elif action == "end_interview":
                if not session_id or session_id not in conversations:
                    await ws.send_json({"type": "error", "message": "No active session"})
                    continue

                engine = conversations[session_id]
                language = engine.language
                avatar = engine.avatar

                await ws.send_json({
                    "type": "bot_thinking",
                    "emotion": "thinking",
                })

                # Generate farewell
                result = await engine.end_early()
                audio_b64 = await synthesize_speech(result["text"], language, avatar)

                await ws.send_json({
                    "type": "bot_speak",
                    "text": result["text"],
                    "audio": audio_b64,
                    "emotion": result.get("emotion", "grateful"),
                    "gesture": "bow",
                    "phase": "farewell",
                })

                # Save and generate report
                await finalize_session(ws, session_id, engine)

    except WebSocketDisconnect:
        if session_id and session_id in conversations:
            engine = conversations[session_id]
            engine.mark_ended()
            save_raw_transcript(session_id, engine)
            del conversations[session_id]


async def finalize_session(ws: WebSocket, session_id: str, engine: ConversationEngine):
    """Save transcript, generate synthesis report, notify client."""
    engine.mark_ended()

    # 1. Save raw transcript
    raw_path = save_raw_transcript(session_id, engine)

    # 2. Generate synthesis report
    try:
        synthesis = await engine.generate_synthesis()
        report_path = save_synthesis_report(session_id, engine, synthesis)

        await ws.send_json({
            "type": "interview_report",
            "synthesis": synthesis,
            "rawTranscriptPath": str(raw_path),
            "reportPath": str(report_path) if report_path else None,
        })
    except Exception as e:
        print(f"[Report] Synthesis failed: {e}")
        await ws.send_json({
            "type": "interview_report",
            "synthesis": None,
            "rawTranscriptPath": str(raw_path),
            "error": str(e),
        })

    # Cleanup
    if session_id in conversations:
        del conversations[session_id]


def _guess_industry(engine: ConversationEngine) -> str:
    """Guess user industry from conversation content."""
    for msg in engine.history:
        if msg["role"] == "user":
            text = msg["text"].lower()
            if any(k in text for k in ["game", "gaming", "游戏", "ゲーム", "roblox", "unity", "unreal"]):
                return "gaming"
            elif any(k in text for k in ["print", "printing", "打印", "stl"]):
                return "3d_printing"
            elif any(k in text for k in ["animation", "film", "movie", "动画", "影视", "vfx"]):
                return "animation"
            elif any(k in text for k in ["education", "teach", "student", "教育", "教学"]):
                return "education"
            elif any(k in text for k in ["prototype", "product", "industrial", "工业", "原型"]):
                return "industrial"
            elif any(k in text for k in ["art", "创作", "hobby", "indie", "personal"]):
                return "personal_creation"
            elif any(k in text for k in ["xr", "vr", "ar", "metaverse", "元宇宙"]):
                return "xr"
    return "unknown"


def save_raw_transcript(session_id: str, engine: ConversationEngine) -> Path:
    """Save raw transcript: date_email_industry_rawdata.json"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y%m%d")
    email_clean = re.sub(r'[^\w@.]', '_', engine.email)
    industry = _guess_industry(engine)

    filename = f"{date_str}_{email_clean}_{industry}_rawdata.json"
    filepath = DATA_DIR / filename

    data = engine.get_history()
    data["industry_guess"] = industry

    filepath.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[Transcript] Saved: {filepath}")
    return filepath


def save_synthesis_report(session_id: str, engine: ConversationEngine, synthesis: dict) -> Path | None:
    """Save synthesis report as JSON."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y%m%d")
    email_clean = re.sub(r'[^\w@.]', '_', engine.email)

    filename = f"meshy_interview_{email_clean}_{date_str}.json"
    filepath = REPORTS_DIR / filename

    report_data = {
        "reportMetadata": {
            "title": "Meshy Interview Synthesis Report",
            "interviewDate": date_str,
            "exportDate": now.isoformat(),
            "intervieweeEmail": engine.email,
            "language": engine.language,
            "questionsAsked": engine.current_question_index,
        },
        "synthesis": synthesis,
    }

    filepath.write_text(
        json.dumps(report_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[Report] Saved: {filepath}")
    return filepath


async def synthesize_speech(text: str, language: str, avatar: str) -> str:
    """Synthesize speech and return base64-encoded MP3 audio."""
    global tts_service
    if tts_service is None:
        tts_service = TTSService()

    audio_bytes = await tts_service.synthesize(text, language, avatar)
    return base64.b64encode(audio_bytes).decode("utf-8")


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )

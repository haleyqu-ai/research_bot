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

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import uvicorn

from conversation import ConversationEngine
from tts_service import TTSService
from stt_service import GoogleCloudSTT
from config import settings
from feishu_service import feishu_service

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

        # Video/audio assets: aggressive caching (1 week)
        if path.endswith((".mp4", ".webm", ".mp3", ".wav")):
            async def send_with_cache(message):
                if message["type"] == "http.response.start":
                    message = dict(message)
                    message["headers"] = list(message.get("headers", [])) + [
                        (b"cache-control", b"public, max-age=604800, immutable"),
                    ]
                await send(message)
            await self.app(scope, receive, send_with_cache)
            return

        if not (path == "/" or path.endswith((".js", ".css", ".html"))):
            await self.app(scope, receive, send)
            return

        # Intercept response headers to add no-cache for code files
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


@app.post("/api/end-session")
async def end_session_beacon(request: Request):
    """Handle sendBeacon from browser tab close — save transcript for all active sessions."""
    # Save any active conversations when user closes the tab
    for session_id, engine in list(conversations.items()):
        try:
            engine.mark_ended()
            save_raw_transcript(session_id, engine)
            print(f"[Beacon] Saved transcript for session: {session_id}")
        except Exception as e:
            print(f"[Beacon] Error saving {session_id}: {e}")
    return JSONResponse({"ok": True})


@app.websocket("/ws/stt")
async def stt_endpoint(ws: WebSocket):
    """Buffer audio from browser, then recognize via Google Cloud STT."""
    print("[STT WS] === New STT connection ===")
    await ws.accept()
    audio_chunk_count = 0

    try:
        # Wait for init message with language
        init_raw = await ws.receive_text()
        init_msg = json.loads(init_raw)
        language = init_msg.get("language", "en")
        print(f"[STT WS] Init: language={language}")

        stt = GoogleCloudSTT(language=language)

        # No external connection needed — immediately ready
        await ws.send_json({"type": "stt_ready"})
        print("[STT WS] Sent stt_ready to browser")

        # Main loop: buffer audio chunks, recognize on stop
        while True:
            msg = await ws.receive()

            if msg.get("type") == "websocket.receive":
                if "bytes" in msg and msg["bytes"]:
                    audio_chunk_count += 1
                    if audio_chunk_count <= 3 or audio_chunk_count % 50 == 0:
                        print(f"[STT WS] Audio chunk #{audio_chunk_count}, size={len(msg['bytes'])} bytes")
                    stt.add_audio(msg["bytes"])
                elif "text" in msg and msg["text"]:
                    ctrl = json.loads(msg["text"])
                    print(f"[STT WS] Control message: {ctrl}")
                    if ctrl.get("action") == "stop":
                        print(f"[STT WS] Stop requested. Total audio chunks: {audio_chunk_count}")
                        # Tell browser we're processing — keeps WS alive on Railway
                        await ws.send_json({"type": "stt_processing"})
                        # Recognize all buffered audio with timeout
                        try:
                            transcript = await asyncio.wait_for(
                                stt.recognize(), timeout=15.0
                            )
                        except asyncio.TimeoutError:
                            print("[STT WS] Google Cloud STT timed out")
                            transcript = ""
                        print(f"[STT WS] Sending result: '{transcript}'")
                        await ws.send_json({
                            "type": "stt_result",
                            "text": transcript,
                            "is_final": True,
                        })
                        # Give Railway proxy time to forward the result
                        # before the handler exits and closes the WS
                        await asyncio.sleep(0.5)
                        break

    except WebSocketDisconnect:
        print("[STT WS] Browser disconnected")
    except Exception as e:
        import traceback
        print(f"[STT WS] Error: {e}")
        traceback.print_exc()
        try:
            await ws.send_json({"type": "stt_error", "message": str(e)})
        except Exception:
            pass
    finally:
        print(f"[STT WS] Cleanup. Audio chunks received: {audio_chunk_count}")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    session_id = None

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            action = msg.get("action")

            # --- Keepalive ping ---
            if action == "ping":
                continue

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

                # Send greeting text immediately
                result = await engine.get_greeting()
                await ws.send_json({
                    "type": "bot_speak",
                    "text": result["text"],
                    "emotion": result["emotion"],
                    "gesture": result.get("gesture", "talking"),
                    "phase": "greeting",
                })
                # TTS audio follows asynchronously
                asyncio.create_task(
                    _send_audio(ws, result["text"], language, avatar)
                )

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

                # Get AI response with timeout — prevents permanent hang if Gemini is slow
                try:
                    result = await asyncio.wait_for(
                        engine.process_answer(user_text),
                        timeout=30.0,
                    )
                except asyncio.TimeoutError:
                    print(f"[WS] Gemini timeout for session {session_id}")
                    result = {
                        "text": "I'm sorry, I had a brief connection issue. Could you repeat what you just said?",
                        "emotion": "friendly",
                        "gesture": "talking",
                        "completed": False,
                    }
                    # Undo the question index increment since we didn't get a real response
                    engine.current_question_index = max(0, engine.current_question_index - 1)
                except Exception as e:
                    print(f"[WS] Gemini error for session {session_id}: {e}")
                    result = {
                        "text": "I'm sorry, something went wrong on my end. Could you try again?",
                        "emotion": "friendly",
                        "gesture": "talking",
                        "completed": False,
                    }
                    engine.current_question_index = max(0, engine.current_question_index - 1)

                if result.get("completed"):
                    await ws.send_json({
                        "type": "bot_speak",
                        "text": result["text"],
                        "emotion": result["emotion"],
                        "gesture": "bow",
                        "phase": "farewell",
                    })
                    asyncio.create_task(
                        _send_audio(ws, result["text"], language, avatar)
                    )
                    await finalize_session(ws, session_id, engine)
                else:
                    await ws.send_json({
                        "type": "bot_speak",
                        "text": result["text"],
                        "emotion": result["emotion"],
                        "gesture": result.get("gesture", "talking"),
                        "phase": "question",
                        "questionIndex": engine.current_question_index,
                        "totalQuestions": engine.total_questions,
                    })
                    asyncio.create_task(
                        _send_audio(ws, result["text"], language, avatar)
                    )

            # --- User ends interview early ---
            elif action == "end_interview":
                if not session_id or session_id not in conversations:
                    await ws.send_json({"type": "error", "message": "No active session"})
                    continue

                engine = conversations[session_id]
                language = engine.language
                avatar = engine.avatar

                # Instant farewell — no LLM wait
                _quick_farewells = {
                    "en": "Thank you so much for your time and feedback! Your insights are incredibly valuable and will directly help us improve Meshy. Have a wonderful day!",
                    "zh": "非常感谢您抽出宝贵的时间参与访谈！您的反馈对我们改进 Meshy 非常有价值。祝您有美好的一天！",
                }
                farewell_text = _quick_farewells.get(language, _quick_farewells["en"])

                await ws.send_json({
                    "type": "bot_speak",
                    "text": farewell_text,
                    "emotion": "grateful",
                    "gesture": "bow",
                    "phase": "farewell",
                })
                asyncio.create_task(
                    _send_audio(ws, farewell_text, language, avatar)
                )
                # Run synthesis in background (no need to wait)
                asyncio.create_task(finalize_session(ws, session_id, engine))

    except WebSocketDisconnect:
        if session_id and session_id in conversations:
            engine = conversations[session_id]
            engine.mark_ended()
            save_raw_transcript(session_id, engine)
            del conversations[session_id]


async def finalize_session(ws: WebSocket, session_id: str, engine: ConversationEngine):
    """Save transcript, generate synthesis report, push to Feishu, notify client."""
    engine.mark_ended()
    industry = _guess_industry(engine)

    # 1. Save raw transcript locally
    raw_path = save_raw_transcript(session_id, engine)

    # 2. Generate synthesis report
    synthesis = None
    report_path = None
    feishu_transcript_url = None
    feishu_synthesis_url = None

    try:
        synthesis = await engine.generate_synthesis()
        report_path = save_synthesis_report(session_id, engine, synthesis)
    except Exception as e:
        print(f"[Report] Synthesis failed: {e}")

    # 3. Save to Feishu (non-blocking — don't fail the session if Feishu is down)
    try:
        feishu_transcript_url = await feishu_service.save_transcript(engine, industry)
        if synthesis and "error" not in synthesis:
            feishu_synthesis_url = await feishu_service.save_synthesis(engine, synthesis, industry)
    except Exception as e:
        print(f"[Feishu] Integration error: {e}")

    # 4. Notify client
    await ws.send_json({
        "type": "interview_report",
        "synthesis": synthesis,
        "rawTranscriptPath": str(raw_path),
        "reportPath": str(report_path) if report_path else None,
        "feishuTranscriptUrl": feishu_transcript_url,
        "feishuSynthesisUrl": feishu_synthesis_url,
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


async def _send_audio(ws: WebSocket, text: str, language: str, avatar: str):
    """Synthesize TTS and send audio as a separate bot_audio message."""
    try:
        audio_b64 = await asyncio.wait_for(
            synthesize_speech(text, language, avatar),
            timeout=15.0,
        )
        await ws.send_json({
            "type": "bot_audio",
            "audio": audio_b64,
        })
    except asyncio.TimeoutError:
        print(f"[TTS] Audio synthesis timed out for: {text[:50]}...")
    except Exception as e:
        print(f"[TTS] Background audio failed: {e}")


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

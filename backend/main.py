"""Meshy ResearchBot — FastAPI Backend"""

import json
import base64
import asyncio
import sys
from pathlib import Path

# Ensure backend modules are importable
sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uvicorn

from conversation import ConversationEngine
from tts_service import TTSService
from config import settings

app = FastAPI(title="Meshy ResearchBot")

PROJECT_ROOT = Path(__file__).parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
DATA_DIR = PROJECT_ROOT / "data" / "sessions"

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
                    save_session(session_id, engine)
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

    except WebSocketDisconnect:
        if session_id and session_id in conversations:
            save_session(session_id, conversations[session_id])
            del conversations[session_id]


async def synthesize_speech(text: str, language: str, avatar: str) -> str:
    """Synthesize speech and return base64-encoded MP3 audio."""
    global tts_service
    if tts_service is None:
        tts_service = TTSService()

    audio_bytes = await tts_service.synthesize(text, language, avatar)
    return base64.b64encode(audio_bytes).decode("utf-8")


def save_session(session_id: str, engine: ConversationEngine):
    """Save conversation history to disk."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    filepath = DATA_DIR / f"{session_id}.json"
    filepath.write_text(
        json.dumps(engine.get_history(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )

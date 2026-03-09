# Meshy ResearchBot

AI-powered digital human that conducts user interviews for [Meshy](https://meshy.ai). Features 3D animated avatars with real-time speech synthesis and lip-sync.

## Features

- **3D Digital Human** — TalkingHead avatars with facial expressions, lip-sync, and gestures
- **Voice Synthesis** — Qwen3-TTS (Chinese) + Edge TTS (English) with automatic language detection
- **AI Interviewer** — Gemini 2.5 Flash powers adaptive conversation flow
- **Real-time WebSocket** — Low-latency audio streaming and avatar control
- **Multi-language** — Chinese and English interview support

## Tech Stack

| Layer | Technology |
|-------|------------|
| LLM | Gemini 2.5 Flash |
| TTS | Qwen3-TTS-Flash (DashScope) / Edge TTS |
| Avatar | TalkingHead v1.7 + Three.js |
| Backend | FastAPI + WebSocket |
| Frontend | Vanilla JS + Import Maps |

## Quick Start

### Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (recommended) or pip

### 1. Clone & Install

```bash
git clone https://github.com/haleyqu-ai/research_bot.git
cd research_bot
uv sync
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your API keys:

```
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash
DASHSCOPE_API_KEY=your-dashscope-api-key
```

### 3. Run

```bash
cd backend
python main.py
```

Open **http://localhost:8000** in your browser.

### 4. Use

1. Enter your email
2. Select language (Chinese / English)
3. Choose an avatar (Sophia / Marcus)
4. Start the interview — the digital human will guide you through questions

## Project Structure

```
meshy-research-bot/
├── backend/
│   ├── main.py              # FastAPI server + WebSocket
│   ├── conversation.py      # Gemini-powered conversation engine
│   ├── tts_service.py       # TTS (Qwen3-TTS + Edge TTS)
│   └── config.py            # Settings & environment
├── frontend/
│   ├── index.html            # Main page with import maps
│   ├── js/
│   │   ├── app.js            # App logic & WebSocket client
│   │   └── avatar.js         # TalkingHead avatar management
│   ├── css/                  # Styles
│   └── assets/avatars/       # GLB avatar models
├── .env.example
├── pyproject.toml
└── README.md
```

## License

Internal use — Meshy, Inc.

# Meshy ResearchBot

AI-powered interview bot that conducts user research for [Meshy](https://meshy.ai). Features pre-recorded video avatars with real-time speech synthesis.

## Features

- **Video Avatar** — Pre-recorded video clips with double-buffered playback for smooth transitions
- **Voice Synthesis** — Google Cloud TTS (Chirp 3 HD) with Edge TTS fallback
- **Speech Recognition** — Google Cloud STT with brand-name correction and long-audio segmentation
- **AI Interviewer** — Gemini 2.5 Flash powers adaptive conversation with V2 interviewing constraints
- **Real-time WebSocket** — Low-latency audio streaming and avatar control
- **Multi-language** — 10 languages supported (zh, en, de, fr, ja, ko, es, pt, ru, it)

## Tech Stack

| Layer | Technology |
|-------|------------|
| LLM | Gemini 2.5 Flash |
| TTS | Google Cloud TTS (Chirp 3 HD) / Edge TTS fallback |
| STT | Google Cloud Speech-to-Text |
| Avatar | Pre-recorded video clips (double-buffered) |
| Backend | FastAPI + WebSocket |
| Frontend | Vanilla JS + ES Modules |

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
GOOGLE_CLOUD_API_KEY=your-google-cloud-api-key
```

### 3. Run

```bash
cd backend
python main.py
```

Open **http://localhost:8000** in your browser.

### 4. Use

1. Enter your email
2. Select language
3. Choose an avatar
4. Start the interview — the bot will guide you through questions

## Project Structure

```
meshy-research-bot/
├── backend/
│   ├── main.py              # FastAPI server + WebSocket
│   ├── conversation.py      # Gemini-powered conversation engine
│   ├── tts_service.py       # TTS (Chirp 3 HD + Edge TTS)
│   ├── stt_service.py       # STT (Google Cloud Speech-to-Text)
│   ├── feishu_service.py    # Feishu integration for reports
│   └── config.py            # Settings & environment
├── frontend/
│   ├── index.html           # Main page
│   ├── js/
│   │   ├── app.js           # App logic & WebSocket client
│   │   ├── avatar.js        # Video avatar management
│   │   ├── speech.js        # STT WebSocket client
│   │   ├── websocket.js     # Main WebSocket with keepalive
│   │   └── pcm-processor.js # AudioWorklet for mic capture
│   ├── css/                 # Styles
│   └── assets/videos/       # Pre-recorded avatar video clips
├── .env.example
├── pyproject.toml
└── README.md
```

## License

Internal use — Meshy, Inc.

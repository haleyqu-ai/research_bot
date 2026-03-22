# Meshy User Interview Bot

AI-powered interview bot that conducts user research for [Meshy](https://meshy.ai). Features pre-recorded video avatars with real-time speech synthesis and intelligent conversation.

## Features

- **Video Avatar** — Pre-recorded video clips with double-buffered playback for smooth transitions
- **Voice Synthesis** — Google Cloud TTS (Chirp 3 HD) with voice consistency lock and Edge TTS fallback
- **Speech Recognition** — Google Cloud STT with brand-name correction, long-audio segmentation, and audio backup retry
- **AI Interviewer** — Gemini 2.5 Flash powers adaptive conversation with V2 interviewing constraints
- **Real-time WebSocket** — Low-latency audio streaming and avatar control
- **Multi-language** — 10 languages supported (en, zh, de, fr, ja, ko, es, pt, ru, it)
- **Feishu Integration** — Auto-saves transcripts and synthesis reports to Feishu Wiki
- **Domain Vocabulary** — 190+ phrase hints for Meshy features, 3D modeling, gaming, and printing terms

## Tech Stack

| Layer | Technology |
|-------|------------|
| LLM | Gemini 2.5 Flash |
| TTS | Google Cloud TTS (Chirp 3 HD) / Edge TTS fallback |
| STT | Google Cloud Speech-to-Text (latest_long enhanced model) |
| Avatar | Pre-recorded video clips (double-buffered) |
| Backend | FastAPI + WebSocket |
| Frontend | Vanilla JS + ES Modules |
| Reports | Feishu Wiki API |

## Quick Start

### Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (recommended) or pip

### 1. Clone & Install

```bash
git clone https://github.com/taichi-dev/user-interview-bot.git
cd user-interview-bot
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
FEISHU_APP_ID=your-feishu-app-id
FEISHU_APP_SECRET=your-feishu-app-secret
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
user-interview-bot/
├── backend/
│   ├── main.py              # FastAPI server + WebSocket
│   ├── conversation.py      # Gemini-powered conversation engine
│   ├── tts_service.py       # TTS (Chirp 3 HD + voice lock + Edge TTS)
│   ├── stt_service.py       # STT (Google Cloud + phrase hints + corrections)
│   ├── feishu_service.py    # Feishu Wiki integration for reports
│   └── config.py            # Settings & environment
├── frontend/
│   ├── index.html           # Main page
│   ├── js/
│   │   ├── app.js           # App logic & WebSocket client
│   │   ├── avatar.js        # Video avatar management
│   │   ├── speech.js        # STT WebSocket client + audio backup retry
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

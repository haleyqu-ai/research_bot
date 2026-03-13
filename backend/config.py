"""Configuration for Meshy ResearchBot."""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


class Settings:
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    DASHSCOPE_API_KEY: str = os.getenv("DASHSCOPE_API_KEY", "")

    PROJECT_ROOT: Path = Path(__file__).parent.parent
    MODELS_DIR: Path = PROJECT_ROOT / "models"
    QUESTIONS_DIR: Path = Path(__file__).parent / "questions"

    # TTS config
    TTS_MODEL_PATH: str = os.getenv(
        "TTS_MODEL_PATH",
        str(MODELS_DIR / "qwen3-tts-0.6b"),
    )
    # Voice mapping: avatar -> speaker name
    TTS_VOICES: dict = {
        "male": {"zh": "Chelsie", "en": "Ethan", "de": "Ethan"},
        "female": {"zh": "Cherry", "en": "Amber", "de": "Amber"},
    }

    # Interview config
    MAX_QUESTIONS: int = 7

    # Supported languages
    LANGUAGES: dict = {
        "en": "English",
        "zh": "中文",
        "de": "Deutsch",
        "fr": "Français",
        "ja": "日本語",
        "ko": "한국어",
        "es": "Español",
        "pt": "Português",
        "ru": "Русский",
        "it": "Italiano",
    }


settings = Settings()

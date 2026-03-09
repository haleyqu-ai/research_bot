"""Conversation engine for Meshy ResearchBot (Gemini)."""

import json
from datetime import datetime, timezone

from google import genai
from google.genai import types

from config import settings

client = genai.Client(api_key=settings.GEMINI_API_KEY)

SYSTEM_PROMPT_TEMPLATE = """You are a professional user researcher conducting an interview on behalf of Meshy (meshy.ai), an AI-powered 3D generation platform.

IMPORTANT RULES:
- Speak ONLY in {language_name} ({language_code}). Every word of your response must be in this language.
- You are a {avatar_gender} interviewer. Keep a warm, professional tone.
- Your goal is to understand the user's experience with Meshy's products and gather actionable feedback.
- Ask ONE question at a time. Wait for the user's response before asking the next.
- After the user answers, briefly acknowledge their response (show empathy/interest), then transition to the next question.
- Keep responses concise — 2-3 sentences max for acknowledgment + next question.

INTERVIEW TOPICS (ask in order, adapt based on responses):
1. How did you first discover Meshy? What brought you to try it?
2. What do you primarily use Meshy for? (game assets, prototyping, art, etc.)
3. Which features do you use most frequently? (text-to-3D, image-to-3D, texturing, etc.)
4. What has been your best experience using Meshy?
5. What has been your most frustrating experience?
6. How does the quality of generated 3D models meet your expectations?
7. Are there any features you wish Meshy had but doesn't?
8. How does Meshy compare to other 3D tools you've used?
9. Would you recommend Meshy to others? Why or why not?
10. Any final thoughts or suggestions for the Meshy team?

RESPONSE FORMAT — You MUST return valid JSON and nothing else:
{{
  "text": "Your spoken response in {language_name}",
  "emotion": "one of: friendly, interested, empathetic, surprised, thinking, grateful, encouraging",
  "gesture": "one of: talking, nodding, lean_forward, thinking, idle",
  "completed": false
}}

When all questions are done, set "completed": true and give a warm farewell message."""

GREETING_TEMPLATE = {
    "en": "Hello! Thank you so much for taking the time to chat with me today. I'm from the Meshy team, and I'd love to hear about your experience with our platform. Shall we get started?",
    "zh": "你好！非常感谢你今天抽出时间和我聊天。我来自 Meshy 团队，很想听听你使用我们平台的体验。我们开始吧？",
    "de": "Hallo! Vielen Dank, dass Sie sich heute die Zeit nehmen, mit mir zu sprechen. Ich bin vom Meshy-Team und würde gerne von Ihren Erfahrungen mit unserer Plattform hören. Sollen wir anfangen?",
    "fr": "Bonjour ! Merci beaucoup de prendre le temps de discuter avec moi aujourd'hui. Je fais partie de l'équipe Meshy et j'aimerais connaître votre expérience avec notre plateforme. On commence ?",
    "ja": "こんにちは！本日はお時間をいただきありがとうございます。Meshyチームの者です。私たちのプラットフォームについてのご体験をお聞かせいただけますか？始めましょうか？",
    "ko": "안녕하세요! 오늘 시간 내주셔서 정말 감사합니다. 저는 Meshy 팀에서 왔고, 저희 플랫폼 사용 경험에 대해 듣고 싶습니다. 시작할까요?",
    "es": "¡Hola! Muchas gracias por tomarte el tiempo de hablar conmigo hoy. Soy del equipo de Meshy y me encantaría conocer tu experiencia con nuestra plataforma. ¿Empezamos?",
    "pt": "Olá! Muito obrigado por dedicar seu tempo para conversar comigo hoje. Sou da equipe Meshy e adoraria ouvir sobre sua experiência com nossa plataforma. Vamos começar?",
    "ru": "Здравствуйте! Большое спасибо, что нашли время поговорить со мной сегодня. Я из команды Meshy, и мне хотелось бы узнать о вашем опыте использования нашей платформы. Начнём?",
    "it": "Ciao! Grazie mille per aver dedicato del tempo a parlare con me oggi. Faccio parte del team Meshy e mi piacerebbe conoscere la tua esperienza con la nostra piattaforma. Iniziamo?",
}


class ConversationEngine:
    def __init__(self, language: str, avatar: str, email: str):
        self.language = language
        self.avatar = avatar
        self.email = email
        self.history: list[dict] = []
        self.gemini_history: list[types.Content] = []
        self.current_question_index = 0
        self.total_questions = settings.MAX_QUESTIONS
        self.started_at = datetime.now(timezone.utc).isoformat()

        lang_name = settings.LANGUAGES.get(language, "English")
        gender = "male" if avatar == "male" else "female"

        self.system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
            language_name=lang_name,
            language_code=language,
            avatar_gender=gender,
        )

    async def get_greeting(self) -> dict:
        """Return the initial greeting."""
        text = GREETING_TEMPLATE.get(self.language, GREETING_TEMPLATE["en"])
        self.history.append({"role": "bot", "text": text, "phase": "greeting"})
        return {
            "text": text,
            "emotion": "friendly",
            "gesture": "waving",
        }

    async def process_answer(self, user_text: str) -> dict:
        """Process user answer and generate next response."""
        self.history.append({"role": "user", "text": user_text})
        self.current_question_index += 1

        # Add user message to Gemini history
        self.gemini_history.append(
            types.Content(role="user", parts=[types.Part(text=user_text)])
        )

        # Call Gemini async
        response = await client.aio.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=self.gemini_history,
            config=types.GenerateContentConfig(
                system_instruction=self.system_prompt,
                max_output_tokens=512,
                response_mime_type="application/json",
            ),
        )

        raw = response.text

        # Add model response to history
        self.gemini_history.append(
            types.Content(role="model", parts=[types.Part(text=raw)])
        )

        # Parse JSON response
        try:
            if "```json" in raw:
                raw = raw.split("```json")[1].split("```")[0]
            elif "```" in raw:
                raw = raw.split("```")[1].split("```")[0]
            result = json.loads(raw.strip())
        except (json.JSONDecodeError, IndexError):
            result = {
                "text": raw,
                "emotion": "friendly",
                "gesture": "talking",
                "completed": False,
            }

        self.history.append({
            "role": "bot",
            "text": result.get("text", raw),
            "emotion": result.get("emotion", "friendly"),
            "phase": "farewell" if result.get("completed") else "question",
        })

        return result

    def get_history(self) -> dict:
        """Return full session data for saving."""
        return {
            "email": self.email,
            "language": self.language,
            "avatar": self.avatar,
            "started_at": self.started_at,
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "total_questions_asked": self.current_question_index,
            "conversation": self.history,
        }

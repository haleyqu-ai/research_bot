"""Conversation engine for Meshy ResearchBot (Gemini)."""

import json
from datetime import datetime, timezone

from google import genai
from google.genai import types

from config import settings

client = genai.Client(api_key=settings.GEMINI_API_KEY)

# ── System Prompt with Meshy Domain Knowledge (from Interview Skills) ──

SYSTEM_PROMPT_TEMPLATE = """You are a professional user researcher conducting an interview on behalf of Meshy (meshy.ai), an AI-powered 3D content generation platform.

## Meshy Domain Knowledge

Meshy's core product is a tool for generating high-quality 3D models from text or images, serving creators and professional teams in game development, animation/film, 3D printing, education, industrial prototyping, and other industries.

### Core Product Features
- **Text to 3D** — Input text descriptions to directly generate 3D models
- **Image to 3D** — Upload reference images to convert into 3D models
- **AI Texturing** — Automatically generate textures/materials for existing 3D models
- **Text to Texture** — Re-texture models using text descriptions
- **Model Refinement / Remesh** — Optimize model topology for different purposes
- **Multi-format Export** — GLB, FBX, OBJ, STL
- **API Integration** — Batch-call generation capabilities through API

### Primary Export Targets
Blender, ZBrush, Unreal Engine, Unity, Maya, Cinema 4D, 3D printing slicing software (Bambu Studio, Chitubox, etc.)

### Competitors (for context)
TripoAI, Hitem3D, Kaedim, Luma AI, Blockade Labs, Rodin.AI. Related tools: Midjourney/DALL-E, Spline, Leonardo AI.

## Interview Rules

IMPORTANT RULES:
- Speak ONLY in {language_name} ({language_code}). Every word must be in this language.
- You are a {avatar_gender} interviewer. Keep a warm, professional tone.
- Ask ONE question at a time. Wait for the user's response before asking the next.
- After the user answers, briefly acknowledge (show empathy/interest), then transition naturally to the next question.
- Keep responses concise — 2-3 sentences max for acknowledgment + next question.
- Adapt follow-up questions based on the user's answers. Probe deeper when they mention pain points, workarounds, or strong emotions.
- If the user mentions competitors, ask for specific comparisons.
- If the user describes a workaround, explore the underlying unmet need.

## Analysis Dimensions (actively scan for these signals)

**User Background**: Role, industry, team size, technical 3D background, discovery channel
**Use Cases**: What Meshy is used for, workflow stage, frequency, companion tools
**Positive Feedback**: Specific liked features, comparison to previous workflow
**Pain Points**: Problems encountered (note emotional intensity), workarounds
**Feature Requests**: Explicit and implicit needs, "nice to have" vs "must solve"
**Workflow Integration**: Export experience, downstream tool compatibility
**Growth Signals**: Discovery channel, community mentions, referral potential
**Product Signals**: Subscription tier, competitor comparison, switching intent

## Interview Topics (adapt based on responses)
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

## Response Format — Return valid JSON ONLY:
{{
  "text": "Your spoken response in {language_name}",
  "emotion": "one of: friendly, interested, empathetic, surprised, thinking, grateful, encouraging",
  "gesture": "one of: talking, nodding, lean_forward, thinking, idle",
  "completed": false
}}

When all questions are done, set "completed": true and give a warm farewell message thanking the user."""


# ── Synthesis Prompt (applied after interview ends) ──

SYNTHESIS_PROMPT = """You are an expert analyst on the Meshy user research team, skilled at transforming raw interview content into clear, actionable user insights.

Given the following interview transcript, produce a structured synthesis report.

## Interview Transcript
{transcript}

## Output Format (JSON)

Return valid JSON with this structure:
{{
  "interviewee_profile": {{
    "email": "{email}",
    "industry": "best guess from interview content",
    "primary_use_cases": ["list of use cases mentioned"],
    "discovery_channel": "how they found Meshy"
  }},
  "one_line_summary": "Single sentence capturing the user's most core request or current status",
  "key_insights": [
    {{
      "insight": "Your analytical interpretation",
      "signal_strength": "high/medium/low",
      "supporting_evidence": "Quote or behavior from interview"
    }}
  ],
  "positive_feedback": ["specific features or experiences liked"],
  "core_pain_points": [
    {{
      "pain_point": "description",
      "severity": "high/medium/low",
      "workaround": "if mentioned, otherwise null"
    }}
  ],
  "feature_requests": [
    {{
      "request": "description",
      "type": "explicit/implicit",
      "priority": "must-have/nice-to-have"
    }}
  ],
  "key_quotes": [
    {{
      "quote": "verbatim quote",
      "reflection": "what this reveals"
    }}
  ]
}}

## Analysis Principles
- Behavior > Attitude: what users do is more valuable than what they say
- Workarounds are strong signals of unmet needs
- Emotional intensity matters: frustration, repeated mentions = high priority
- Quotes are evidence, not conclusions
- Be specific, not vague (e.g., "V5's texture quality meets commercial baseline" not "user is satisfied")
- Use the same language as the interview content
"""


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
        self.ended_at = None

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

    async def end_early(self) -> dict:
        """Generate a farewell message when user ends interview early."""
        farewell_prompts = {
            "en": "The user wants to end the interview now. Thank them warmly for their time and any feedback shared so far.",
            "zh": "用户希望现在结束访谈。请热情地感谢他们的时间和已经分享的反馈。",
        }
        prompt = farewell_prompts.get(self.language, farewell_prompts["en"])

        self.gemini_history.append(
            types.Content(role="user", parts=[types.Part(text=prompt)])
        )

        response = await client.aio.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=self.gemini_history,
            config=types.GenerateContentConfig(
                system_instruction=self.system_prompt,
                max_output_tokens=256,
                response_mime_type="application/json",
            ),
        )

        raw = response.text
        try:
            if "```json" in raw:
                raw = raw.split("```json")[1].split("```")[0]
            elif "```" in raw:
                raw = raw.split("```")[1].split("```")[0]
            result = json.loads(raw.strip())
        except (json.JSONDecodeError, IndexError):
            result = {"text": raw, "emotion": "grateful", "completed": True}

        result["completed"] = True

        self.history.append({
            "role": "bot",
            "text": result.get("text", raw),
            "emotion": result.get("emotion", "grateful"),
            "phase": "farewell",
        })

        return result

    def mark_ended(self):
        """Mark the interview as ended."""
        self.ended_at = datetime.now(timezone.utc).isoformat()

    def get_transcript_text(self) -> str:
        """Get plain text transcript for synthesis."""
        lines = []
        for msg in self.history:
            role = "Interviewer" if msg["role"] == "bot" else "User"
            lines.append(f"{role}: {msg['text']}")
        return "\n\n".join(lines)

    async def generate_synthesis(self) -> dict:
        """Generate a synthesis report from the interview transcript."""
        transcript = self.get_transcript_text()

        prompt = SYNTHESIS_PROMPT.format(
            transcript=transcript,
            email=self.email,
        )

        response = await client.aio.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[types.Content(role="user", parts=[types.Part(text=prompt)])],
            config=types.GenerateContentConfig(
                max_output_tokens=4096,
                response_mime_type="application/json",
            ),
        )

        raw = response.text
        try:
            if "```json" in raw:
                raw = raw.split("```json")[1].split("```")[0]
            elif "```" in raw:
                raw = raw.split("```")[1].split("```")[0]
            return json.loads(raw.strip())
        except (json.JSONDecodeError, IndexError):
            return {"error": "Failed to parse synthesis", "raw": raw}

    def get_history(self) -> dict:
        """Return full session data for saving."""
        return {
            "email": self.email,
            "language": self.language,
            "avatar": self.avatar,
            "started_at": self.started_at,
            "ended_at": self.ended_at or datetime.now(timezone.utc).isoformat(),
            "total_questions_asked": self.current_question_index,
            "conversation": self.history,
        }

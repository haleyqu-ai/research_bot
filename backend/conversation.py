"""Conversation engine for Meshy ResearchBot (Gemini)."""

import json
from datetime import datetime, timezone

from google import genai
from google.genai import types

from config import settings

client = genai.Client(api_key=settings.GEMINI_API_KEY)

# ── System Prompt with Meshy Domain Knowledge (from Interview Skills) ──

SYSTEM_PROMPT_TEMPLATE = """You are a professional user researcher conducting a diagnostic interview on behalf of Meshy (meshy.ai), an AI-powered 3D content generation platform.

## Study: Meshy First-Day Cancellation Diagnostic

Research Questions:
1. What did users experience on their first day after subscribing that led them to cancel?
2. What alternatives did users turn to after canceling?
3. What was the gap between users' expectations at subscription and their actual experience?

Target Users: Users who canceled their Meshy subscription within 24 hours of subscribing.

## Meshy Domain Knowledge

Meshy's core product generates high-quality 3D models from text or images, serving creators in game development, animation/film, 3D printing, education, industrial prototyping, etc.

Core Features: Text to 3D, Image to 3D, AI Texturing, Text to Texture, Model Refinement/Remesh, Multi-format Export (GLB/FBX/OBJ/STL), API Integration.
Export Targets: Blender, ZBrush, Unreal Engine, Unity, Maya, Cinema 4D, 3D printing slicers (Bambu Studio, Chitubox, etc.)
Competitors (context only): TripoAI, Hitem3D, Kaedim, Luma AI, Blockade Labs, Rodin.AI. Related: Midjourney/DALL-E, Spline, Leonardo AI.

## Interview Structure — Follow This Flow

You MUST follow these modules in order. Each module has specific questions, probes, and things to AVOID.

### Module 1: Background & Context (~2 min)
**Q1**: "Tell me a little about yourself — what kind of work or projects involve 3D content for you?"
- Probes: "Is this for professional work, a hobby, or something else?" / "How long have you been working with 3D?"
- AVOID: Do NOT define the user's identity for them (e.g., don't say "So you're a game developer, right?")

### Module 2: Subscription Decision & First-Day Experience (~7 min)
**Q2**: "Walk me through what led you to subscribe to Meshy. What were you hoping to accomplish?"
- Probes: "Where did you first hear about Meshy?" / "What specifically made you decide to go with a paid plan rather than staying on free?" / "Was there a particular project or task you had in mind?"
- AVOID: Do NOT suggest reasons for the user (e.g., don't say "Did you subscribe because you saw an ad?")

**Q3**: "After you subscribed, tell me what happened next. Walk me through your experience."
- Probes: "What got in the way of trying it out?" / "Was there something you were looking for but couldn't find?" / "What did you try to create?" / "How did the result compare to what you had in mind?"
- AVOID: Do NOT presume emotional response (e.g., don't say "Were you disappointed with the quality?")

**Q4**: "Take me back to the moment you decided to cancel. What was going through your mind?"
- Probes: "Was there a specific thing that triggered that decision?" / "Did you consider any alternatives before canceling, like switching plans?" / "How were you feeling at that point?"
- AVOID: Do NOT lead attribution (e.g., don't say "Was it because the product didn't meet your expectations?")

### Module 3: Post-Cancellation Alternatives (~4 min)
**Q5**: "Since canceling, how are you handling the 3D work you were doing or planning to do?"
- Probes: "Are you using any other tools now?" / "How does that compare to your experience with Meshy?" / "Or have you put that project on hold?"
- AVOID: Do NOT name-drop competitors (e.g., don't say "Are you using Tripo3D now?")

**Q6**: "If you think about the future, what would need to be true for you to consider subscribing to Meshy again?"
- Probes: "Is it more about the product itself, the pricing, or something else?" / "What would make it a no-brainer for you?"
- AVOID: Do NOT suggest solutions (e.g., don't say "Would you come back if we lowered the price?")

### Module 4: Closing (~1 min)
**Q7**: "Is there anything else about your experience — subscribing, using, or canceling — that we haven't covered but you think is important for us to know?"
- AVOID: Do NOT steer toward negativity (e.g., don't say "Is there anything else you didn't like?")

After Q7, give a warm farewell: "Thank you so much for sharing your experience. Your feedback is really valuable — we'll use it to make Meshy better for creators like you. Have a great day!"

## Interview Rules

CRITICAL RULES:
- Speak ONLY in {language_name} ({language_code}). Every word must be in this language.
- You are a {avatar_gender} interviewer. Keep a warm, professional tone.
- Ask ONE question at a time. Wait for the user's response before asking the next.
- After the user answers, briefly acknowledge (show empathy/interest), then transition naturally to the next question.
- Keep responses concise — 2-3 sentences max for acknowledgment + next question.
- Use the probes when the user's answer is vague or surface-level. You don't need to ask every probe — pick the most relevant.
- Strictly follow the AVOID rules — these are common interviewer biases that invalidate research data.
- Adapt follow-up questions based on the user's answers. Probe deeper when they mention pain points, workarounds, or strong emotions.
- If the user mentions competitors, ask for specific comparisons (but don't name-drop first).
- If the user describes a workaround, explore the underlying unmet need.

## Analysis Dimensions (actively scan for these signals)

**User Background**: Role, industry, team size, technical 3D background, discovery channel
**Subscription Motivation**: Why paid vs free, specific project/task, expectations at time of purchase
**First-Day Experience**: What they tried, blockers encountered, quality vs expectations gap
**Cancellation Trigger**: Specific moment/event, emotional state, alternatives considered
**Post-Cancellation**: Current tools/workflow, comparison to Meshy, willingness to return
**Win-Back Conditions**: What would need to change (product, pricing, trust)

## Response Format — Return valid JSON ONLY:
{{
  "text": "Your spoken response in {language_name}",
  "emotion": "one of: friendly, interested, empathetic, surprised, thinking, grateful, encouraging",
  "gesture": "one of: talking, nodding, lean_forward, thinking, idle",
  "completed": false
}}

When all questions are done (after Q7), set "completed": true and give the warm farewell."""


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
    "en": "Hi, thank you for taking the time to chat with me today. I'm from the Meshy team. We're doing some research to understand people's experience with our product — there are no right or wrong answers, and I'm genuinely curious about your experience. Everything you share is confidential and will only be used to improve our product. This should take about 15 minutes. Ready to get started?",
    "zh": "你好，非常感谢你今天抽出时间和我聊天。我来自 Meshy 团队。我们正在做一些研究，想了解大家使用我们产品的体验——没有对错之分，我真心想听听你的经历。你分享的一切都是保密的，只会用来改进我们的产品。大概需要 15 分钟。准备好开始了吗？",
    "de": "Hallo, vielen Dank, dass Sie sich heute die Zeit nehmen. Ich bin vom Meshy-Team. Wir führen eine Studie durch, um die Erfahrungen unserer Nutzer zu verstehen — es gibt keine richtigen oder falschen Antworten. Alles bleibt vertraulich. Das dauert etwa 15 Minuten. Bereit?",
    "fr": "Bonjour, merci de prendre le temps de discuter avec moi. Je fais partie de l'équipe Meshy. Nous menons une étude pour comprendre l'expérience de nos utilisateurs — il n'y a pas de bonnes ou mauvaises réponses. Tout est confidentiel. Cela prendra environ 15 minutes. On commence ?",
    "ja": "こんにちは、本日はお時間をいただきありがとうございます。Meshyチームの者です。製品体験についてお話を伺う調査を行っています。正解も不正解もありません。お話いただく内容はすべて機密扱いです。15分ほどかかります。始めてもよろしいですか？",
    "ko": "안녕하세요, 오늘 시간 내주셔서 감사합니다. Meshy 팀입니다. 저희 제품 경험에 대한 연구를 진행하고 있습니다. 정답이나 오답은 없으며, 공유해 주시는 모든 내용은 기밀로 처리됩니다. 약 15분 정도 소요됩니다. 시작할까요?",
    "es": "Hola, gracias por tomarte el tiempo de hablar conmigo hoy. Soy del equipo de Meshy. Estamos investigando la experiencia de nuestros usuarios — no hay respuestas correctas ni incorrectas. Todo es confidencial. Tomará unos 15 minutos. ¿Empezamos?",
    "pt": "Olá, obrigado por dedicar seu tempo hoje. Sou da equipe Meshy. Estamos fazendo uma pesquisa sobre a experiência dos nossos usuários — não há respostas certas ou erradas. Tudo é confidencial. Levará cerca de 15 minutos. Vamos começar?",
    "ru": "Здравствуйте, спасибо, что нашли время поговорить сегодня. Я из команды Meshy. Мы проводим исследование опыта наших пользователей — нет правильных или неправильных ответов. Всё конфиденциально. Это займёт около 15 минут. Начнём?",
    "it": "Ciao, grazie per aver dedicato del tempo oggi. Faccio parte del team Meshy. Stiamo facendo una ricerca sull'esperienza dei nostri utenti — non ci sono risposte giuste o sbagliate. Tutto è confidenziale. Ci vorranno circa 15 minuti. Iniziamo?",
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
        self.history.append({"role": "bot", "text": text, "phase": "greeting", "timestamp": datetime.now(timezone.utc).isoformat()})
        return {
            "text": text,
            "emotion": "friendly",
            "gesture": "waving",
        }

    async def process_answer(self, user_text: str) -> dict:
        """Process user answer and generate next response."""
        self.history.append({"role": "user", "text": user_text, "timestamp": datetime.now(timezone.utc).isoformat()})
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
            "timestamp": datetime.now(timezone.utc).isoformat(),
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
            "timestamp": datetime.now(timezone.utc).isoformat(),
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

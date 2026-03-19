"""Conversation engine for Meshy ResearchBot (Gemini)."""

import json
from datetime import datetime, timezone

from google import genai
from google.genai import types

from config import settings

client = genai.Client(api_key=settings.GEMINI_API_KEY)

# ── System Prompt with Meshy Domain Knowledge (from Interview Skills) ──

SYSTEM_PROMPT_TEMPLATE = """You are a professional user researcher conducting an in-depth interview on behalf of Meshy (meshy.ai), an AI-powered 3D content generation platform.

## Study: Meshy Comprehensive User Research

Research Goals:
1. Understand WHO the user is, their 3D background, and what drives their creative work
2. Map the user's COMPLETE WORKFLOW — from ideation to final output — and where Meshy fits
3. Identify PAIN POINTS, workarounds, and unmet needs in their 3D creation process
4. Discover what features or improvements would create the most value for them
5. Understand how Meshy compares to alternatives in their specific workflow

## Deep Meshy Domain Knowledge

Meshy generates high-quality 3D models from text or images, serving creators across game development, animation/film, 3D printing, XR/VR, education, and industrial prototyping.

### Core Features
- **Text to 3D**: Generate 3D models from text prompts (model versions: Meshy-3 through Meshy-6)
- **Image to 3D**: Convert reference images into 3D models
- **AI Texturing / Retexture**: Apply or regenerate textures on existing meshes; includes PBR texture maps
- **Text to Texture**: Generate textures from text descriptions
- **Remesh**: Retopology and polygon count reduction
- **Auto-Rigging**: Automated skeletal rigging for character animation
- **Animation Library**: Pre-built animations (walk cycles, idle, combat, etc.)
- **Text to Voxel**: Generate voxel-style models
- **AI Prompt Helper**: Assists users in crafting better generation prompts
- **Solid Paint Tool**: Manual texture editing within Meshy
- **Multi-format Export**: GLB, FBX, OBJ, STL, 3MF, USDZ
- **Blender Bridge**: Direct integration plugin for Blender
- **API Integration**: Programmatic access for batch generation

### Key Technical Concepts (use naturally when relevant)
- **Topology / Retopology**: The structure of a mesh's polygons; clean topology is critical for animation and games
- **UV Mapping**: How 2D textures wrap onto 3D surfaces
- **PBR Textures**: Physically Based Rendering maps (albedo, normal, roughness, metallic)
- **Manifold Geometry**: Watertight meshes required for 3D printing (no open edges)
- **Polygon Count / Low-poly / High-poly**: Triangle budget matters for real-time rendering (games/VR)
- **A-pose / T-pose**: Standard neutral poses for character rigging
- **Rigging / Skeleton / Bones**: Armature system for animating 3D characters
- **Shape Keys / Blend Shapes**: For facial animation and lip-sync
- **Displacement / Normal / Height Maps**: Texture types for surface detail
- **Coarse Model vs Refined Model**: Meshy's two-stage generation (preview → high quality)

### Common Downstream Tools (for context, don't name-drop)
- Modeling: Blender, ZBrush, 3ds Max, Modo, MagicaVoxel
- Game Engines: Unity, Unreal Engine, Godot, GDevelop, Roblox Studio
- Animation: Mixamo (auto-rigging), After Effects, Blender
- Image Generation: Midjourney, FLUX, Stable Diffusion, ComfyUI
- 3D Printing: Bambu Studio, Chitubox, Cura, Tinkercad
- Texturing: Substance Painter, Quixel Mixer

### Competitor Landscape (context only — NEVER name-drop first)
- Direct: Tripo AI, Sparc3D, Tencent Hunyuan, Luma AI, 3DAIStudio, Rodin.AI, Kaedim
- Adjacent: Midjourney/DALL-E (image gen), Spline (web 3D), Leonardo AI

### Known User Segments (adapt your probing based on detected segment)
- **Indie Game Developers**: Need game-ready assets, consistent style, low-poly options, engine integration
- **3D Printing Hobbyists**: Need print-ready models (flat base, manifold, no floating geo), simple editing
- **Animation/Film Creators**: Need facial fidelity, rigging, lip-sync, animation chaining
- **Professional 3D Artists / VFX**: Use Meshy for block-out/concepting, need clean topology for sculpting downstream
- **Hobbyists / Explorers**: Creative exploration, VRChat worlds, digital art
- **XR/AR/VR Developers**: Low-poly with strict triangle budgets, rigging for interactive use
- **Educators / Students**: Learning 3D, rapid prototyping, classroom projects

### Known Pain Points from Past Research (probe for these when relevant)
- Mesh quality: floating geometry, extra limbs, face artifacts, back-side quality issues
- Texture: smudgy/painterly look on hard surfaces, baked lighting in textures, style inconsistency
- Coarse → Refined gap: preview looks very different from final, feels like a "gamble"
- Prompt frustration: complex prompts sometimes worse than simple ones, negative prompts unreliable
- 3D printing: no flat base option, non-manifold output, no printability check
- Animation: auto-rigging fails on non-humanoid, no creature/non-standard animation
- Workflow: no in-app local mesh editing, must export to fix small issues
- Organization: no folders for assets, no batch download
- Style consistency: can't "lock" a style across multiple asset generations
- Credits: gambling feeling when spending credits on uncertain outcomes

## Interview Structure — Follow This Flow

You MUST follow these modules in order. Adapt probes and depth based on the user's segment and responses. Spend more time on modules where the user has rich experiences to share.

### Module 1: Background & Identity (~2 min)
**Q1**: "Tell me a little about yourself — what kind of work or projects involve 3D content for you?"
- Probes: "Is this for professional work, a side project, or a hobby?" / "How long have you been working with 3D?" / "Are you working solo or with a team?"
- Segment detection: Listen for clues about their segment (game dev, printing, animation, etc.) and adapt subsequent questions.
- AVOID: Do NOT define the user's identity for them (e.g., don't say "So you're a game developer")

### Module 2: Discovery & First Impressions (~2 min)
**Q2**: "How did you first discover Meshy, and what made you decide to try it?"
- Probes: "What were you using before Meshy?" / "Was there a specific project or need that led you to it?" / "What were your first impressions when you started using it?"
- AVOID: Do NOT suggest discovery channels (e.g., don't say "Did you find us on YouTube?")

### Module 3: Workflow Deep Dive (~5 min)
**Q3**: "Walk me through your typical workflow when you use Meshy — from the idea in your head to the final output."
- Probes: "Which Meshy features do you use most?" / "Do you use other tools together with Meshy? What does each tool handle?" / "Which stage takes the longest or is the most frustrating?" / "When the result isn't quite right, what do you do?"
- For game devs: probe about engine integration, poly count, style consistency across assets
- For 3D printing: probe about printability, flat bases, manifold issues, post-processing
- For animation: probe about rigging, animation quality, facial expressions, lip-sync
- For artists: probe about topology quality, UV maps, sculpting workflow downstream
- AVOID: Do NOT assume their workflow — let them describe it

### Module 4: Quality & Feature Experience (~4 min)
**Q4**: "Thinking about the 3D models you've generated with Meshy — what works well, and where do you feel the quality could improve?"
- Probes: "Can you think of a specific example where the result surprised you — positively or negatively?" / "How do the results compare to what you had in mind?" / "Are there types of models that Meshy handles better or worse?"
- Dig deeper on: texture quality, mesh integrity, prompt reliability, generation consistency
- If they mention workarounds: "That's interesting — can you tell me more about that workaround? What would the ideal solution look like?"
- AVOID: Do NOT presume satisfaction or dissatisfaction

### Module 5: Pain Points & Unmet Needs (~3 min)
**Q5**: "What's the biggest challenge or limitation you face when using Meshy for your work?"
- Probes: "Has that ever caused you to abandon a project or find a different approach?" / "How are you handling that limitation right now?" / "If that issue were resolved, how would it change your workflow?"
- When they describe a workaround, explore the underlying unmet need
- AVOID: Do NOT suggest pain points — let them surface naturally

### Module 6: Competitive Context (~2 min)
**Q6**: "Have you tried any other AI 3D tools? How does your experience with them compare?"
- Probes: "What does each tool do well?" / "Is there anything another tool does that you wish Meshy could do?" / "What keeps you coming back to Meshy (or what drove you away)?"
- If they haven't tried others: "What made you stick with Meshy?"
- AVOID: Do NOT name-drop competitors — let the user bring them up

### Module 7: Future Wishlist (~2 min)
**Q7**: "If you could wave a magic wand and add one capability to Meshy, what would make the biggest difference for your work?"
- Probes: "What would that enable you to do that you can't do today?" / "Is there any feature you've seen elsewhere that you'd love Meshy to have?"
- AVOID: Do NOT suggest features

### Module 8: Open Closing (~1 min)
**Q8**: "Is there anything else about your experience with Meshy — or 3D creation in general — that we haven't covered but you think is important for us to know?"
- AVOID: Do NOT steer toward negativity (don't say "anything else you didn't like?")

After Q8, give a warm farewell: "Thank you so much for sharing your experience. Your feedback is incredibly valuable — it directly helps us make Meshy better for creators like you. Have a wonderful day!"

## Interview Rules

CRITICAL RULES:
- Speak ONLY in {language_name} ({language_code}). Every word must be in this language.
- You are a {avatar_gender} interviewer. Keep a warm, professional, conversational tone.
- Ask ONE question at a time. Wait for the user's response before asking the next.
- After the user answers, transition naturally to the next question. Show genuine interest through your follow-up, NOT by repeating or paraphrasing what the user just said. Never start with "So you..." or "It sounds like you..." — this feels robotic and wastes time.
- Keep responses concise — 1-2 sentences max. Go straight to the next question or probe.
- Use the probes when the user's answer is vague or surface-level. You don't need to ask every probe — pick the most relevant.
- Strictly follow the AVOID rules — these are common interviewer biases that invalidate research data.
- Adapt follow-up questions based on the user's answers. Probe deeper when they mention pain points, workarounds, or strong emotions.
- If the user mentions competitors, ask for specific comparisons (but don't name-drop first).
- If the user describes a workaround, explore the underlying unmet need — workarounds are the strongest signals.
- Use the domain knowledge naturally — when a user mentions a concept (e.g., "the topology is messy"), acknowledge it fluently to build rapport and trust.
- Mirror the user's language level: use technical terms with professionals, simpler language with hobbyists.
- When users express frustration, validate it ("I can see how that would be frustrating") before probing deeper.

## Analysis Dimensions (actively scan for these signals)

**User Profile**: Role, industry, team size, 3D skill level, discovery channel, segment
**Workflow**: Full pipeline (ideation → Meshy → post-processing → final output), tool ecosystem, bottlenecks
**Feature Usage**: Which Meshy features used, frequency, satisfaction level, features not discovered
**Quality Perception**: Mesh quality, texture quality, generation consistency, prompt reliability
**Pain Points**: Specific limitations, workarounds used, impact on workflow, severity
**Competitive Position**: Other tools used, Meshy strengths/weaknesses vs alternatives, switching factors
**Feature Requests**: Explicit asks, implicit needs (from workarounds), priority level
**Emotional Signals**: Enthusiasm, frustration, delight, resignation — and what triggers them
**Retention Factors**: What keeps them using Meshy, what might cause them to leave

## Response Format — Return valid JSON ONLY:
{{
  "text": "Your spoken response in {language_name}",
  "emotion": "one of: friendly, interested, empathetic, surprised, thinking, grateful, encouraging",
  "gesture": "one of: talking, nodding, lean_forward, thinking, idle",
  "completed": false
}}

When all questions are done (after Q8), set "completed": true and give the warm farewell."""


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
    "segment": "one of: indie_game_dev, 3d_printing, animation_film, pro_artist_vfx, hobbyist, xr_vr, student_educator, api_developer, other",
    "industry": "best guess from interview content",
    "role": "their job title or role description",
    "team_size": "solo / small_team / studio / unknown",
    "3d_skill_level": "beginner / intermediate / advanced / professional",
    "primary_use_cases": ["list of use cases mentioned"],
    "discovery_channel": "how they found Meshy",
    "subscription_tier": "free / paid / unknown"
  }},
  "one_line_summary": "Single sentence capturing the user's most critical insight or need",
  "workflow_map": {{
    "pipeline": ["ordered list of tools/steps in their workflow, e.g., 'Midjourney → Meshy Image-to-3D → Blender cleanup → Unity'"],
    "meshy_role": "how Meshy fits in — primary generator / concepting tool / texturing tool / one of many",
    "bottleneck": "which stage is slowest or most painful",
    "post_processing": "what they do after Meshy output (if anything)"
  }},
  "meshy_features_used": [
    {{
      "feature": "feature name (e.g., Text to 3D, Image to 3D, Remesh, AI Texturing, Auto-Rigging)",
      "satisfaction": "high/medium/low",
      "notes": "specific feedback"
    }}
  ],
  "key_insights": [
    {{
      "insight": "Your analytical interpretation",
      "signal_strength": "high/medium/low",
      "category": "quality / workflow / pricing / ux / feature_gap / competitive",
      "supporting_evidence": "Quote or behavior from interview"
    }}
  ],
  "positive_feedback": ["specific features, experiences, or moments of delight mentioned"],
  "core_pain_points": [
    {{
      "pain_point": "description",
      "severity": "critical/high/medium/low",
      "category": "mesh_quality / texture_quality / prompt_reliability / printing / animation / workflow / ux / pricing / other",
      "workaround": "if mentioned, otherwise null",
      "impact": "how it affects their work"
    }}
  ],
  "feature_requests": [
    {{
      "request": "description",
      "type": "explicit/implicit",
      "priority": "must-have/nice-to-have/dream",
      "impact": "what it would enable"
    }}
  ],
  "competitive_insights": [
    {{
      "competitor": "tool name",
      "comparison": "what they said about it vs Meshy",
      "meshy_advantage": "where Meshy wins (if mentioned)",
      "meshy_gap": "where Meshy falls short (if mentioned)"
    }}
  ],
  "key_quotes": [
    {{
      "quote": "verbatim quote",
      "reflection": "what this reveals about user needs or product gaps"
    }}
  ],
  "retention_signals": {{
    "keeps_using_because": "what drives continued usage",
    "churn_risk": "factors that might cause them to leave",
    "win_back_conditions": "what would bring them back if churned (if applicable)"
  }}
}}

## Analysis Principles
- Behavior > Attitude: what users do is more valuable than what they say
- Workarounds are the strongest signals of unmet needs — analyze them deeply
- Emotional intensity matters: frustration, repeated mentions, strong language = high priority
- Quotes are evidence, not conclusions — always tie back to product implications
- Be specific, not vague (e.g., "Meshy-5's texture quality meets their commercial baseline for background props but not hero characters" not "user is satisfied")
- Segment context matters: a pain point critical for 3D printing (e.g., no flat base) may be irrelevant for game devs
- Use the same language as the interview content
"""


GREETING_TEMPLATE = {
    "en": "Hi, thank you for taking the time to chat with me today. I'm from the Meshy team. We're doing some research to understand people's experience with our product — there are no right or wrong answers, and I'm genuinely curious about your experience. Everything you share is confidential and will only be used to improve our product. This should take about 20 minutes. Ready to get started?",
    "zh": "你好，非常感谢你今天抽出时间和我聊天。我来自 Meshy 团队。我们正在做一些研究，想了解大家使用我们产品的体验——没有对错之分，我真心想听听你的经历。你分享的一切都是保密的，只会用来改进我们的产品。大概需要 20 分钟。准备好开始了吗？",
    "de": "Hallo, vielen Dank, dass Sie sich heute die Zeit nehmen. Ich bin vom Meshy-Team. Wir führen eine Studie durch, um die Erfahrungen unserer Nutzer zu verstehen — es gibt keine richtigen oder falschen Antworten. Alles bleibt vertraulich. Das dauert etwa 20 Minuten. Bereit?",
    "fr": "Bonjour, merci de prendre le temps de discuter avec moi. Je fais partie de l'équipe Meshy. Nous menons une étude pour comprendre l'expérience de nos utilisateurs — il n'y a pas de bonnes ou mauvaises réponses. Tout est confidentiel. Cela prendra environ 20 minutes. On commence ?",
    "ja": "こんにちは、本日はお時間をいただきありがとうございます。Meshyチームの者です。製品体験についてお話を伺う調査を行っています。正解も不正解もありません。お話いただく内容はすべて機密扱いです。20分ほどかかります。始めてもよろしいですか？",
    "ko": "안녕하세요, 오늘 시간 내주셔서 감사합니다. Meshy 팀입니다. 저희 제품 경험에 대한 연구를 진행하고 있습니다. 정답이나 오답은 없으며, 공유해 주시는 모든 내용은 기밀로 처리됩니다. 약 20분 정도 소요됩니다. 시작할까요?",
    "es": "Hola, gracias por tomarte el tiempo de hablar conmigo hoy. Soy del equipo de Meshy. Estamos investigando la experiencia de nuestros usuarios — no hay respuestas correctas ni incorrectas. Todo es confidencial. Tomará unos 20 minutos. ¿Empezamos?",
    "pt": "Olá, obrigado por dedicar seu tempo hoje. Sou da equipe Meshy. Estamos fazendo uma pesquisa sobre a experiência dos nossos usuários — não há respostas certas ou erradas. Tudo é confidencial. Levará cerca de 20 minutos. Vamos começar?",
    "ru": "Здравствуйте, спасибо, что нашли время поговорить сегодня. Я из команды Meshy. Мы проводим исследование опыта наших пользователей — нет правильных или неправильных ответов. Всё конфиденциально. Это займёт около 20 минут. Начнём?",
    "it": "Ciao, grazie per aver dedicato del tempo oggi. Faccio parte del team Meshy. Stiamo facendo una ricerca sull'esperienza dei nostri utenti — non ci sono risposte giuste o sbagliate. Tutto è confidenziale. Ci vorranno circa 20 minuti. Iniziamo?",
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
                max_output_tokens=1024,
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
            # Try to extract text field from truncated JSON
            extracted_text = raw
            try:
                import re
                # Match "text": "..." even in broken JSON
                m = re.search(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)"', raw)
                if m:
                    extracted_text = m.group(1).replace('\\"', '"').replace('\\n', '\n')
            except Exception:
                pass
            result = {
                "text": extracted_text,
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

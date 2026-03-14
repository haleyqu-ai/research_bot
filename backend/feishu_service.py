"""Feishu (Lark) document integration for Meshy ResearchBot.

Creates wiki sub-documents under a parent node with:
- Full conversation transcript (with timestamps)
- Synthesis report
"""

import httpx
from datetime import datetime, timezone

from config import settings


class FeishuService:
    BASE_URL = "https://open.feishu.cn/open-apis"

    def __init__(self):
        self._token: str | None = None
        self._token_expires: float = 0

    async def _get_tenant_token(self) -> str:
        now = datetime.now(timezone.utc).timestamp()
        if self._token and now < self._token_expires:
            return self._token

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.BASE_URL}/auth/v3/tenant_access_token/internal",
                json={
                    "app_id": settings.FEISHU_APP_ID,
                    "app_secret": settings.FEISHU_APP_SECRET,
                },
            )
            data = resp.json()
            if data.get("code") != 0:
                raise Exception(f"Feishu auth failed: {data}")
            self._token = data["tenant_access_token"]
            self._token_expires = now + data.get("expire", 7200) - 60
            return self._token

    async def _headers(self) -> dict:
        token = await self._get_tenant_token()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    async def create_wiki_doc(self, title: str) -> dict:
        """Create a docx under the wiki parent node. Returns {node_token, obj_token}."""
        headers = await self._headers()
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.BASE_URL}/wiki/v2/spaces/{settings.FEISHU_WIKI_SPACE_ID}/nodes",
                headers=headers,
                json={
                    "obj_type": "docx",
                    "parent_node_token": settings.FEISHU_WIKI_PARENT_NODE,
                    "node_type": "origin",
                    "title": title,
                },
            )
            data = resp.json()
            if data.get("code") != 0:
                raise Exception(f"Feishu create wiki node failed: {data}")
            node = data["data"]["node"]
            return {
                "node_token": node["node_token"],
                "obj_token": node["obj_token"],
            }

    async def write_doc_blocks(self, document_id: str, blocks: list[dict]):
        """Write content blocks to a Feishu document."""
        headers = await self._headers()
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.BASE_URL}/docx/v1/documents/{document_id}/blocks/{document_id}/children",
                headers=headers,
                json={
                    "children": blocks,
                    "index": 0,
                },
            )
            result = resp.json()
            if result.get("code") != 0:
                raise Exception(f"Feishu write blocks failed: {result}")
            return result

    # ── Block builders ──

    @staticmethod
    def _text_block(text: str) -> dict:
        return {
            "block_type": 2,
            "text": {
                "elements": [{"text_run": {"content": text}}],
            },
        }

    @staticmethod
    def _heading_block(text: str, level: int = 2) -> dict:
        block_type = level + 2  # heading1=3, heading2=4, heading3=5, ...
        key = f"heading{level}"
        return {
            "block_type": block_type,
            key: {
                "elements": [{"text_run": {"content": text}}],
            },
        }

    @staticmethod
    def _divider_block() -> dict:
        return {"block_type": 22, "divider": {}}

    # ── High-level methods ──

    async def save_transcript(self, engine, industry: str) -> str | None:
        """Save full conversation transcript to Feishu. Returns doc URL or None."""
        if not settings.FEISHU_APP_ID:
            print("[Feishu] Skipped: FEISHU_APP_ID not configured")
            return None

        try:
            now = datetime.now(timezone.utc)
            date_str = now.strftime("%Y%m%d")
            email_clean = engine.email.replace("@", "_at_")
            title = f"{date_str}_{email_clean}_{industry}_transcript"

            doc_info = await self.create_wiki_doc(title)
            document_id = doc_info["obj_token"]

            blocks = []
            blocks.append(self._heading_block("Interview Transcript", level=1))
            blocks.append(self._text_block(
                f"Date: {now.strftime('%Y-%m-%d %H:%M UTC')}  |  "
                f"Email: {engine.email}  |  "
                f"Language: {engine.language}  |  "
                f"Industry: {industry}"
            ))
            blocks.append(self._divider_block())

            for msg in engine.history:
                role = "Interviewer" if msg["role"] == "bot" else "User"
                ts = msg.get("timestamp", "")
                ts_display = ""
                if ts:
                    try:
                        dt = datetime.fromisoformat(ts)
                        ts_display = f" [{dt.strftime('%H:%M:%S')}]"
                    except ValueError:
                        ts_display = f" [{ts}]"
                blocks.append(self._text_block(f"{role}{ts_display}: {msg['text']}"))

            await self.write_doc_blocks(document_id, blocks)

            url = f"https://o9ixctz0o7.feishu.cn/wiki/{doc_info['node_token']}"
            print(f"[Feishu] Transcript saved: {url}")
            return url

        except Exception as e:
            print(f"[Feishu] Failed to save transcript: {e}")
            return None

    async def save_synthesis(self, engine, synthesis: dict, industry: str) -> str | None:
        """Save synthesis report to Feishu. Returns doc URL or None."""
        if not settings.FEISHU_APP_ID:
            return None

        try:
            now = datetime.now(timezone.utc)
            date_str = now.strftime("%Y%m%d")
            email_clean = engine.email.replace("@", "_at_")
            title = f"{date_str}_{email_clean}_{industry}_synthesis"

            doc_info = await self.create_wiki_doc(title)
            document_id = doc_info["obj_token"]

            blocks = []
            blocks.append(self._heading_block("Interview Synthesis Report", level=1))
            blocks.append(self._text_block(
                f"Date: {now.strftime('%Y-%m-%d %H:%M UTC')}  |  "
                f"Email: {engine.email}  |  "
                f"Industry: {industry}"
            ))
            blocks.append(self._divider_block())

            # Interviewee Profile
            profile = synthesis.get("interviewee_profile", {})
            if profile:
                blocks.append(self._heading_block("Interviewee Profile", level=2))
                blocks.append(self._text_block(
                    f"Email: {profile.get('email', engine.email)}\n"
                    f"Industry: {profile.get('industry', industry)}\n"
                    f"Use Cases: {', '.join(profile.get('primary_use_cases', []))}\n"
                    f"Discovery Channel: {profile.get('discovery_channel', 'N/A')}"
                ))

            # One-line Summary
            summary = synthesis.get("one_line_summary", "")
            if summary:
                blocks.append(self._heading_block("Summary", level=2))
                blocks.append(self._text_block(summary))

            # Key Insights
            insights = synthesis.get("key_insights", [])
            if insights:
                blocks.append(self._heading_block("Key Insights", level=2))
                for ins in insights:
                    blocks.append(self._text_block(
                        f"[{ins.get('signal_strength', 'medium')}] {ins.get('insight', '')}\n"
                        f"Evidence: {ins.get('supporting_evidence', '')}"
                    ))

            # Positive Feedback
            positives = synthesis.get("positive_feedback", [])
            if positives:
                blocks.append(self._heading_block("Positive Feedback", level=2))
                for p in positives:
                    blocks.append(self._text_block(f"• {p}"))

            # Core Pain Points
            pains = synthesis.get("core_pain_points", [])
            if pains:
                blocks.append(self._heading_block("Core Pain Points", level=2))
                for pp in pains:
                    workaround = f" → Workaround: {pp.get('workaround')}" if pp.get("workaround") else ""
                    blocks.append(self._text_block(
                        f"[{pp.get('severity', 'medium')}] {pp.get('pain_point', '')}{workaround}"
                    ))

            # Feature Requests
            features = synthesis.get("feature_requests", [])
            if features:
                blocks.append(self._heading_block("Feature Requests", level=2))
                for fr in features:
                    blocks.append(self._text_block(
                        f"[{fr.get('priority', 'nice-to-have')}] {fr.get('request', '')} ({fr.get('type', 'explicit')})"
                    ))

            # Key Quotes
            quotes = synthesis.get("key_quotes", [])
            if quotes:
                blocks.append(self._heading_block("Key Quotes", level=2))
                for q in quotes:
                    blocks.append(self._text_block(
                        f"\"{q.get('quote', '')}\"\n"
                        f"→ {q.get('reflection', '')}"
                    ))

            await self.write_doc_blocks(document_id, blocks)

            url = f"https://o9ixctz0o7.feishu.cn/wiki/{doc_info['node_token']}"
            print(f"[Feishu] Synthesis saved: {url}")
            return url

        except Exception as e:
            print(f"[Feishu] Failed to save synthesis: {e}")
            return None


feishu_service = FeishuService()

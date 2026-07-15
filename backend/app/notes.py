"""Session Breakthrough Notes — generated after a tutor session ends.

Calls Gemini with the session transcript and produces a JSON summary written
entirely from the student's perspective. Never sends student identifiers to
the API — only the raw message content.
"""
from __future__ import annotations

import json
import re

from app.db import get_conn, new_id, now
from app.gemini_client import LLMClient, get_llm_client

_NOTES_PROMPT = """\
You are analysing a maths tutoring session transcript to produce a brief structured
summary FROM THE STUDENT'S PERSPECTIVE. This will be shown to the student to
reinforce what THEY figured out — never say "the tutor explained" or "the AI told
you". Attribute every insight to the student ("You worked out...", "You figured out...").

TRANSCRIPT:
{transcript}

Respond with ONLY valid JSON — no markdown fences, no commentary:
{{
  "student_breakthrough": "<one sentence starting with 'You worked out that...' or 'You figured out that...' — the key insight the student arrived at themselves. null if unclear.>",
  "struggled_with": "<one short phrase — the concept or step where the student got most stuck. null if none.>",
  "topic_covered": "<the specific mathematical topic or concept practised in this session>"
}}

If the transcript has fewer than 4 student messages, return:
{{"student_breakthrough": null, "struggled_with": null, "topic_covered": null}}
"""


def _strip_fences(text: str) -> str:
    text = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
    return m.group(1) if m else text


def generate_and_store(session_id: str, *, llm: LLMClient | None = None) -> dict | None:
    """Generate session notes from the transcript and persist them.
    Returns the notes dict, or None if the session was too short or generation failed.
    """
    llm = llm or get_llm_client()

    with get_conn() as conn:
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE session_id=? ORDER BY id ASC",
            (session_id,),
        ).fetchall()

    if not rows:
        return None

    # Build anonymous transcript — no student identifiers, just roles
    lines = [
        f"[{'Student' if r['role'] == 'student' else 'Tutor'}]: {r['content']}"
        for r in rows
    ]
    transcript = "\n\n".join(lines)

    try:
        raw = llm.generate(
            system_prompt="You produce concise structured JSON. Output JSON only.",
            history=[{"role": "user", "text": _NOTES_PROMPT.format(transcript=transcript)}],
            temperature=0.3,
            json_mode=True,
        )
        data = json.loads(_strip_fences(raw))
    except Exception:
        return None

    if not data.get("student_breakthrough"):
        return None

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO session_notes "
            "(id, session_id, student_breakthrough, struggled_with, topic_covered, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(session_id) DO UPDATE SET "
            "  student_breakthrough=excluded.student_breakthrough, "
            "  struggled_with=excluded.struggled_with, "
            "  topic_covered=excluded.topic_covered",
            (
                new_id(),
                session_id,
                data.get("student_breakthrough"),
                data.get("struggled_with"),
                data.get("topic_covered"),
                now(),
            ),
        )

    return data

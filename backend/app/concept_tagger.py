"""Concept node tagging — runs at session end.

Calls Gemini to rate each concept node in the subtopic as solid / shaky /
not_tested based on the session transcript. Stores results in the
concept_mastery table. No student identifying info is sent (CLAUDE.md §13).
"""
from __future__ import annotations

import json
import re

from app.config import get_subtopic
from app.db import get_conn, now
from app.gemini_client import LLMClient, get_llm_client

VALID_MASTERY: frozenset[str] = frozenset({"solid", "shaky", "not_tested"})

_SYS = "You produce concise structured JSON. Output JSON only, no markdown fences."

_PROMPT = """\
Analyse this maths tutoring session transcript and rate each concept node.

SUBTOPIC: {subtopic}
CONCEPT NODES:
{nodes_text}

TRANSCRIPT:
{transcript}

For each concept_id above, rate the student's apparent understanding:
- "solid": student demonstrated correct, confident understanding
- "shaky": student struggled, had misconceptions, or made errors on this concept
- "not_tested": concept did not meaningfully come up in the session

Return ONLY a JSON object mapping every concept_id to its mastery:
{{"<concept_id>": "<solid|shaky|not_tested>", ...}}
Include ALL concept_ids — even those rated "not_tested".
"""


def tag_concepts_and_store(
    session_id: str,
    student_id: str,
    subtopic: str,
    *,
    llm: LLMClient | None = None,
) -> dict | None:
    """Tag concept mastery from session transcript and upsert to concept_mastery.

    Returns the raw ratings dict, or None if tagging was skipped or failed.
    """
    llm = llm or get_llm_client()

    try:
        sub = get_subtopic(subtopic)
    except KeyError:
        return None

    nodes: list[dict] = sub.get("concept_nodes", [])
    if not nodes:
        return None

    with get_conn() as conn:
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE session_id=? ORDER BY id ASC",
            (session_id,),
        ).fetchall()

    if sum(1 for r in rows if r["role"] == "student") < 2:
        return None

    transcript = "\n\n".join(
        f"[{'Student' if r['role'] == 'student' else 'Tutor'}]: {r['content']}"
        for r in rows
    )
    nodes_text = "\n".join(
        f"- {n['id']}: {n['label']} — {n.get('description', '')}"
        for n in nodes
    )

    try:
        raw = llm.generate(
            system_prompt=_SYS,
            history=[{"role": "user", "text": _PROMPT.format(
                subtopic=sub.get("label", subtopic),
                nodes_text=nodes_text,
                transcript=transcript,
            )}],
            temperature=0.2,
            json_mode=True,
        )
        text = raw.strip()
        m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
        data: dict = json.loads(m.group(1) if m else text)
    except Exception:
        return None

    valid_ids = {n["id"] for n in nodes}
    ts = now()
    with get_conn() as conn:
        for concept_id, mastery in data.items():
            if concept_id not in valid_ids:
                continue
            if mastery not in VALID_MASTERY:
                mastery = "not_tested"
            conn.execute(
                """INSERT INTO concept_mastery
                   (student_id, concept_id, subtopic, mastery, last_updated)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(student_id, concept_id) DO UPDATE SET
                     mastery = CASE
                       WHEN excluded.mastery != 'not_tested' THEN excluded.mastery
                       ELSE concept_mastery.mastery
                     END,
                     last_updated = CASE
                       WHEN excluded.mastery != 'not_tested' THEN excluded.last_updated
                       ELSE concept_mastery.last_updated
                     END""",
                (student_id, concept_id, subtopic, mastery, ts),
            )

    return data

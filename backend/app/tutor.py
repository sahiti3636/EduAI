"""Tutor session — CLAUDE.md §8.3.

Stateless-LLM-call, stateful-DB design: each turn, we rebuild the full
conversation history from the `messages` table and resend it (plus a freshly
built system prompt, since the bucket can change mid-session via
re-bucketing) to the model. This keeps the server itself stateless between
requests, which is simpler to reason about and survives restarts.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.config import get_items, get_settings, get_sub_subtopic, get_sub_subtopics, get_subtopic
from app.db import get_conn, new_id, now
from app.gemini_client import LLMClient, get_llm_client
from app.prompts import build_feynman_prompt, build_system_prompt

REBUCKET_TAG_RE = re.compile(r"\[REBUCKET_SUGGESTION:\s*([ABC])\]\s*$", re.MULTILINE)

# Very rough heuristic for the guardrail-integrity audit metric (CLAUDE.md §8.4).
# This does NOT enforce anything — the system prompt is what holds the line.
# It only flags messages for a human to review afterward.
_LEAK_PATTERNS = [
    re.compile(r"\bthe answer is\b", re.IGNORECASE),
    re.compile(r"\bfinal answer\s*[:=]", re.IGNORECASE),
    re.compile(r"\bx\s*=\s*-?\d+(\.\d+)?\s*$"),
]


def pick_default_problem(subtopic: str, bucket: str = "B") -> str:
    """Return a practice problem matched to the student's bucket.

    Pulls from `practice_problems` in curriculum.yaml if present — these
    are deliberately harder for bucket A (extension/proof problems), standard
    multi-step for B, and scaffolded for C. Falls back to a diagnostic item
    if the config key is missing.
    """
    sub = get_subtopic(subtopic)
    practice = sub.get("practice_problems", {})
    if bucket in practice and practice[bucket]:
        return practice[bucket]

    # fallback: pick a diagnostic item type that suits the bucket
    items = get_items(subtopic)
    preferred_type = {
        "A": "choose-between-methods",
        "B": "solve-and-show-working",
        "C": "explain-first-step",
    }.get(bucket, "solve-and-show-working")
    for item in items:
        if item["type"] == preferred_type:
            return item["prompt"]
    return items[0]["prompt"] if items else "Let's pick a problem to work on."


def detect_pressure(text: str) -> bool:
    settings = get_settings()["session"]
    lowered = text.lower()
    return any(phrase in lowered for phrase in settings.get("pressure_phrases", []))


def _looks_like_possible_leak(text: str) -> bool:
    stripped = REBUCKET_TAG_RE.sub("", text).strip()
    return any(p.search(stripped) for p in _LEAK_PATTERNS)


def _extract_rebucket_suggestion(text: str) -> tuple[str, str | None]:
    """Returns (display_text_without_tag, suggested_bucket_or_None)."""
    match = REBUCKET_TAG_RE.search(text)
    if not match:
        return text, None
    suggested = match.group(1)
    cleaned = REBUCKET_TAG_RE.sub("", text).rstrip()
    return cleaned, suggested


def _current_bucket(student_id: str, subtopic: str) -> str:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT bucket FROM buckets WHERE student_id=? AND subtopic=?",
            (student_id, subtopic),
        ).fetchone()
    if row is None:
        raise ValueError(
            f"No bucket found for student={student_id} subtopic={subtopic}. "
            "Run the diagnostic first."
        )
    return row["bucket"]


def _session_history(session_id: str) -> list[dict[str, str]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE session_id=? ORDER BY id ASC",
            (session_id,),
        ).fetchall()
    # google-genai roles: "user" (student) / "model" (tutor)
    return [
        {"role": "user" if r["role"] == "student" else "model", "text": r["content"]}
        for r in rows
    ]


def _store_message(session_id: str, role: str, content: str, *, pressure: bool = False, leak: bool = False) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO messages (session_id, role, content, flagged_pressure, flagged_possible_leak, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, role, content, int(pressure), int(leak), now()),
        )


def _get_error_pattern_hint(student_id: str, subtopic: str) -> str | None:
    """Return a one-line system prompt addition if the student has recurring errors."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT error_type FROM error_patterns "
            "WHERE student_id=? AND subtopic=? AND count >= 3",
            (student_id, subtopic),
        ).fetchall()
    if not rows:
        return None
    tags = [r["error_type"].replace("_", " ") for r in rows]
    return (
        f"NOTE — this student has a documented recurring pattern: {', '.join(tags)}. "
        "Watch for this specifically and address it if it appears."
    )


@dataclass
class TutorTurn:
    session_id: str
    reply_text: str
    bucket_used: str
    rebucket_suggested: str | None = None
    problem_text: str | None = None   # only set when a new session is started
    mode: str = "socratic"


def start_session(
    student_id: str,
    subtopic: str,
    *,
    problem_statement: str | None = None,
    sub_subtopic_id: str | None = None,
    mode: str = "socratic",
    llm: LLMClient | None = None,
) -> TutorTurn:
    llm = llm or get_llm_client()
    bucket = _current_bucket(student_id, subtopic)
    subtopic_label = get_subtopic(subtopic)["label"]

    # Resolve sub-subtopic label if provided
    sub_subtopic_label: str | None = None
    if sub_subtopic_id:
        try:
            sub_subtopic_label = get_sub_subtopic(subtopic, sub_subtopic_id)["label"]
        except KeyError:
            pass  # gracefully ignore unknown ids

    # Decide whether to embed a problem in the prompt.
    # When a sub-subtopic is selected without a custom problem, we let the tutor
    # give an overview first and pick problems organically in conversation.
    has_custom_problem = bool(problem_statement)
    problem_for_prompt: str | None = None
    if has_custom_problem:
        problem_for_prompt = problem_statement
    elif not sub_subtopic_id:
        # Old default behaviour: inject a level-matched practice problem
        problem_for_prompt = pick_default_problem(subtopic, bucket)

    session_id = new_id()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions (id, student_id, subtopic, bucket_at_start, started_at, ended_at, mode) "
            "VALUES (?, ?, ?, ?, ?, NULL, ?)",
            (session_id, student_id, subtopic, bucket, now(), mode),
        )

    # Build system prompt based on mode
    topic_label = f"{subtopic_label}{' — ' + sub_subtopic_label if sub_subtopic_label else ''}"
    if mode == "feynman":
        system_prompt = build_feynman_prompt(topic_label)
    else:
        system_prompt = build_system_prompt(
            bucket,
            subtopic_label,
            sub_subtopic_label=sub_subtopic_label,
            has_custom_problem=has_custom_problem,
        )
        # Inject recurring error hint if applicable
        hint = _get_error_pattern_hint(student_id, subtopic)
        if hint:
            system_prompt += f"\n\n{hint}"
        if problem_for_prompt:
            system_prompt += f"\n\nPROBLEM FOR THIS SESSION:\n{problem_for_prompt}"

    settings = get_settings()["llm"]
    opening_history = [{"role": "user", "text": "(session started)"}]
    raw_reply = llm.generate(
        system_prompt=system_prompt,
        history=opening_history,
        temperature=settings.get("tutor_temperature", 0.6),
    )
    display_text, rebucket = _extract_rebucket_suggestion(raw_reply)
    _store_message(session_id, "tutor", display_text, leak=_looks_like_possible_leak(display_text))

    return TutorTurn(
        session_id=session_id,
        reply_text=display_text,
        bucket_used=bucket,
        rebucket_suggested=rebucket,
        problem_text=problem_for_prompt,
        mode=mode,
    )


def send_message(
    session_id: str,
    student_text: str,
    *,
    llm: LLMClient | None = None,
) -> TutorTurn:
    llm = llm or get_llm_client()

    with get_conn() as conn:
        session = conn.execute(
            "SELECT student_id, subtopic FROM sessions WHERE id=?", (session_id,)
        ).fetchone()
    if session is None:
        raise ValueError(f"Unknown session_id: {session_id}")

    student_id, subtopic = session["student_id"], session["subtopic"]
    pressure = detect_pressure(student_text)
    _store_message(session_id, "student", student_text, pressure=pressure)

    bucket = _current_bucket(student_id, subtopic)  # may have changed via re-bucket since session start
    subtopic_label = get_subtopic(subtopic)["label"]
    system_prompt = build_system_prompt(bucket, subtopic_label)
    settings = get_settings()["llm"]

    history = _session_history(session_id)
    raw_reply = llm.generate(
        system_prompt=system_prompt,
        history=history,
        temperature=settings.get("tutor_temperature", 0.6),
    )
    display_text, rebucket = _extract_rebucket_suggestion(raw_reply)
    leak = _looks_like_possible_leak(display_text)
    _store_message(session_id, "tutor", display_text, leak=leak)

    if rebucket:
        apply_rebucket(student_id, subtopic, rebucket)

    return TutorTurn(session_id=session_id, reply_text=display_text, bucket_used=bucket, rebucket_suggested=rebucket)


def apply_rebucket(student_id: str, subtopic: str, new_bucket: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE buckets SET bucket=?, source='re_bucket', updated_at=? "
            "WHERE student_id=? AND subtopic=?",
            (new_bucket, now(), student_id, subtopic),
        )


def end_session(session_id: str) -> dict | None:
    """Mark session ended, generate notes + tag concepts. Returns notes dict or None."""
    with get_conn() as conn:
        session = conn.execute(
            "SELECT student_id, subtopic FROM sessions WHERE id=?", (session_id,)
        ).fetchone()
        conn.execute("UPDATE sessions SET ended_at=? WHERE id=?", (now(), session_id))

    from app.notes import generate_and_store
    notes = generate_and_store(session_id)

    if session:
        try:
            from app.concept_tagger import tag_concepts_and_store
            tag_concepts_and_store(session_id, session["student_id"], session["subtopic"])
        except Exception:
            pass  # concept tagging is non-critical

    return notes

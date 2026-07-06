"""Teacher/pilot dashboard — read-only aggregate view of all students.

Protected by teacher token (HMAC of TEACHER_PASSWORD env var).
"""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.config import get_curriculum
from app.db import get_conn, now, rows_to_list
from app.routers.auth import require_teacher

_ANSWER_PATTERNS = [
    re.compile(r'\bthe answer is\b', re.IGNORECASE),
    re.compile(r'\bthe solution is\b', re.IGNORECASE),
    re.compile(r'\bx\s*=\s*[-+]?\d', re.IGNORECASE),
    re.compile(r'\btherefore\s+\w+\s*=\s*[-+]?\d', re.IGNORECASE),
    re.compile(r'\bso\s+\w+\s*=\s*[-+]?\d', re.IGNORECASE),
    re.compile(r'=\s*[-+]?\d+\.?\d*\s*[.,]?\s*$', re.MULTILINE),
]

router = APIRouter(prefix="/teacher", tags=["teacher"])


@router.get("/overview", dependencies=[Depends(require_teacher)])
def overview() -> dict:
    """Aggregate stats across all students for the teacher dashboard."""
    curriculum = get_curriculum()
    subtopic_labels = {
        k: v.get("label", k) for k, v in curriculum.get("subtopics", {}).items()
    }

    with get_conn() as conn:
        students = conn.execute(
            "SELECT id, label, created_at FROM students ORDER BY created_at"
        ).fetchall()

        buckets = conn.execute("SELECT * FROM buckets").fetchall()

        quiz_attempts = conn.execute(
            "SELECT qa.student_id, qa.score, qa.total, qa.submitted_at, "
            "       q.subtopic, q.sub_subtopic_label "
            "FROM quiz_attempts qa JOIN quizzes q ON qa.quiz_id = q.id "
            "ORDER BY qa.submitted_at"
        ).fetchall()

        pressure_rows = conn.execute(
            "SELECT session_id, content, created_at FROM messages "
            "WHERE role='student' AND flagged_pressure=1 ORDER BY created_at DESC LIMIT 50"
        ).fetchall()

        leak_rows = conn.execute(
            "SELECT session_id, content, created_at FROM messages "
            "WHERE role='tutor' AND flagged_possible_leak=1 ORDER BY created_at DESC LIMIT 20"
        ).fetchall()

        totals = conn.execute(
            "SELECT "
            "  (SELECT COUNT(*) FROM students) AS total_students, "
            "  (SELECT COUNT(*) FROM sessions) AS total_sessions, "
            "  (SELECT COUNT(*) FROM quiz_attempts) AS total_quizzes, "
            "  (SELECT COUNT(*) FROM messages WHERE role='student' AND flagged_pressure=1) AS pressure_count, "
            "  (SELECT COUNT(*) FROM messages WHERE role='tutor' AND flagged_possible_leak=1) AS leak_count"
        ).fetchone()

    # Build per-student summary
    bucket_map: dict[str, dict] = {}
    for b in buckets:
        bucket_map.setdefault(b["student_id"], {})[b["subtopic"]] = b["bucket"]

    quiz_map: dict[str, list] = {}
    for a in quiz_attempts:
        quiz_map.setdefault(a["student_id"], []).append({
            "subtopic": a["subtopic"],
            "chapter": a["sub_subtopic_label"],
            "score": a["score"],
            "total": a["total"],
            "pct": round(a["score"] / a["total"] * 100) if a["total"] else 0,
            "date": a["submitted_at"][:10],
        })

    student_summaries = []
    for s in students:
        sid = s["id"]
        st_buckets = bucket_map.get(sid, {})
        quizzes    = quiz_map.get(sid, [])
        avg_pct    = round(sum(q["pct"] for q in quizzes) / len(quizzes)) if quizzes else None
        student_summaries.append({
            "id":           sid,
            "label":        s["label"],
            "joined":       s["created_at"][:10],
            "buckets":      {subtopic_labels.get(k, k): v for k, v in st_buckets.items()},
            "quizzes_taken": len(quizzes),
            "avg_quiz_pct": avg_pct,
            "recent_quizzes": quizzes[-3:],
        })

    # Bucket distribution across all students
    bucket_dist: dict[str, dict[str, int]] = {}
    for b in buckets:
        label = subtopic_labels.get(b["subtopic"], b["subtopic"])
        bucket_dist.setdefault(label, {"A": 0, "B": 0, "C": 0})
        bucket_dist[label][b["bucket"]] = bucket_dist[label].get(b["bucket"], 0) + 1

    return {
        "totals": dict(totals),
        "bucket_distribution": bucket_dist,
        "students": student_summaries,
        "recent_pressure_attempts": rows_to_list(pressure_rows),
        "possible_leaks": rows_to_list(leak_rows),
    }


@router.get("/written-feedback", dependencies=[Depends(require_teacher)])
def written_feedback() -> list[dict]:
    """All written text feedback submitted by students."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT student_id, subtopic, metric_type, text_feedback, created_at "
            "FROM metrics WHERE text_feedback IS NOT NULL AND text_feedback != '' "
            "ORDER BY created_at DESC"
        ).fetchall()
    return rows_to_list(rows)


@router.get("/guardrail-audit", dependencies=[Depends(require_teacher)])
def guardrail_audit() -> dict:
    """Deep audit: scan all tutor messages for answer-reveal patterns."""
    with get_conn() as conn:
        session_map = {
            r["id"]: {"subtopic": r["subtopic"], "student_label": r["label"]}
            for r in conn.execute(
                "SELECT s.id, s.subtopic, st.label "
                "FROM sessions s JOIN students st ON s.student_id=st.id"
            ).fetchall()
        }
        tutor_msgs = conn.execute(
            "SELECT id, session_id, content, flagged_possible_leak, created_at "
            "FROM messages WHERE role='tutor' ORDER BY created_at DESC"
        ).fetchall()

    flagged = []
    for m in tutor_msgs:
        reasons: list[str] = []
        if m["flagged_possible_leak"]:
            reasons.append("flagged_by_system")
        for pat in _ANSWER_PATTERNS:
            if pat.search(m["content"]):
                reasons.append(f"pattern:{pat.pattern[:40]}")
                break
        if not reasons:
            continue
        sess = session_map.get(m["session_id"], {})
        flagged.append({
            "message_id": m["id"],
            "session_id": m["session_id"],
            "student_label": sess.get("student_label", "?"),
            "subtopic": sess.get("subtopic", "?"),
            "content": m["content"],
            "reasons": reasons,
            "date": m["created_at"][:10],
        })
        if len(flagged) >= 50:
            break

    return {"total_flagged": len(flagged), "messages": flagged}


class BucketAssessmentIn(BaseModel):
    student_id: str
    subtopic: str
    bucket: str
    note: str | None = None


@router.post("/bucket-assessments", dependencies=[Depends(require_teacher)])
def submit_bucket_assessment(req: BucketAssessmentIn) -> dict:
    """Teacher submits their own bucket assessment for a student/subtopic."""
    teacher_id = "teacher"
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO teacher_bucket_assessments(teacher_id, student_id, subtopic, bucket, note, assessed_at)
               VALUES(?,?,?,?,?,?)
               ON CONFLICT(teacher_id, student_id, subtopic) DO UPDATE SET
                 bucket=excluded.bucket, note=excluded.note, assessed_at=excluded.assessed_at""",
            (teacher_id, req.student_id, req.subtopic, req.bucket, req.note, now()),
        )
    return {"ok": True}


@router.get("/rater-validation", dependencies=[Depends(require_teacher)])
def rater_validation() -> dict:
    """Compare AI rater buckets vs teacher-entered bucket assessments."""
    with get_conn() as conn:
        ai_map = {
            (r["student_id"], r["subtopic"]): r["bucket"]
            for r in conn.execute("SELECT student_id, subtopic, bucket FROM buckets").fetchall()
        }
        teacher_rows = conn.execute(
            "SELECT student_id, subtopic, bucket FROM teacher_bucket_assessments WHERE teacher_id='teacher'"
        ).fetchall()
        students = {r["id"]: r["label"] for r in conn.execute("SELECT id, label FROM students").fetchall()}

    comparisons = []
    agree = 0
    for r in teacher_rows:
        ai_b = ai_map.get((r["student_id"], r["subtopic"]))
        match = ai_b == r["bucket"]
        if match:
            agree += 1
        comparisons.append({
            "student_label": students.get(r["student_id"], r["student_id"][:8] + "…"),
            "subtopic": r["subtopic"],
            "ai_bucket": ai_b or "?",
            "teacher_bucket": r["bucket"],
            "match": match,
        })

    total = len(comparisons)
    return {
        "total_assessed": total,
        "agreement_pct": round(agree / total * 100) if total else None,
        "comparisons": comparisons,
    }


@router.get("/students-for-validation", dependencies=[Depends(require_teacher)])
def students_for_validation() -> list[dict]:
    """All students with their AI buckets — for teacher to enter assessments."""
    with get_conn() as conn:
        students = {r["id"]: r["label"] for r in conn.execute("SELECT id, label FROM students").fetchall()}
        buckets = conn.execute(
            "SELECT student_id, subtopic, bucket, updated_at FROM buckets ORDER BY updated_at DESC"
        ).fetchall()
        assessed_keys = {
            (r["student_id"], r["subtopic"])
            for r in conn.execute(
                "SELECT student_id, subtopic FROM teacher_bucket_assessments WHERE teacher_id='teacher'"
            ).fetchall()
        }

    return [
        {
            "student_id": b["student_id"],
            "student_label": students.get(b["student_id"], b["student_id"][:8] + "…"),
            "subtopic": b["subtopic"],
            "ai_bucket": b["bucket"],
            "assessed": (b["student_id"], b["subtopic"]) in assessed_keys,
            "updated_at": b["updated_at"][:10],
        }
        for b in buckets
    ]

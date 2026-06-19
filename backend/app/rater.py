"""The Rater — CLAUDE.md §8.2.

Takes a student's free-text diagnostic responses + the per-item rubric for a
subtopic, asks Gemini for a strict-JSON banding + aggregate bucket, and
parses/validates the result. Falls back to a config-driven heuristic only if
the model's own bucket field is missing or unparseable (the LLM is the
primary classifier, per §8.2 — the heuristic is a safety net, not the design).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.config import get_items, get_settings
from app.gemini_client import LLMClient, get_llm_client

VALID_BANDS = {"correct-justified", "right-idea-gaps", "wrong-or-missing"}
VALID_BUCKETS = {"A", "B", "C"}

RATER_INSTRUCTIONS = """\
You are grading a high-school student's MATH DIAGNOSTIC responses. This is
NOT a graded test — correctness alone does not matter. You are assessing
the student's APPROACH/REASONING to decide how much step-by-step guidance
they will need from a tutor afterward.

For EACH item below, assign exactly one band:
- "correct-justified": sound method, correctly executed/justified (minor
  slips are OK if the reasoning is right).
- "right-idea-gaps": the right general approach is present, but there are
  real gaps — missing justification, a conceptual slip, or an execution
  error that breaks the method.
- "wrong-or-missing": no coherent method, a fundamentally wrong approach,
  or no real attempt.

IMPORTANT — these are CONCEPTUAL/REASONING questions, not standard drill
exercises. "correct-justified" has a HIGH bar:
- Formula recall or pattern-matching to a textbook procedure does NOT
  count as "correct-justified". The student must show they understand
  WHY their approach works — the structural insight, not just the answer.
  Examples of the insight required: recognising p+q+r = f(1) rather than
  just substituting x=1 by luck; seeing complementary angles → Pythagorean
  identity in the sin²A+sin²C problem; naming the equal-likelihood
  requirement in the dice sum fallacy.
- A student who writes the right final answer by plugging into a memorised
  formula without explanation is at most "right-idea-gaps".
- A terse but genuinely insightful response (e.g. "A and C are
  complementary so sinC = cosA, making this sin²+cos²=1") is
  "correct-justified" — brevity is fine if the key reasoning is visible.

CALIBRATION — avoid two known rater biases:
1. Do NOT over-reward answers that SOUND fluent. If the reasoning skips
   the non-trivial step or makes an unjustified leap, it is "right-idea-gaps"
   even if the final answer is correct or the prose is confident.
2. Do NOT under-reward brief-but-correct reasoning. Conciseness is not
   a deficit; the bar is correctness and justification, not length.

After banding every item, assign ONE aggregate bucket for the whole
subtopic:
- "A": mostly correct-justified; methods are sound; any errors are minor
  slips, not conceptual.
- "B": a mix; right ideas are present but there are recurring gaps in
  execution or justification.
- "C": mostly wrong-or-missing; method is absent or fundamentally off track.

Respond with ONLY valid JSON, no markdown fences, no commentary, matching
exactly this schema:
{
  "subtopic": "<subtopic id>",
  "per_item": [
    {"item_id": "<id>", "band": "<one of the three bands>", "note": "<one short sentence>"}
  ],
  "bucket": "<A|B|C>",
  "rationale": "<one or two sentences justifying the aggregate bucket>"
}
"""


@dataclass
class RaterResult:
    subtopic: str
    per_item: list[dict]
    bucket: str
    rationale: str
    used_fallback_heuristic: bool = False


class RaterOutputError(RuntimeError):
    pass


def _build_prompt(subtopic: str, responses: dict[str, str]) -> str:
    items = get_items(subtopic)
    blocks = []
    for item in items:
        student_answer = responses.get(item["id"], "").strip() or "(no response given)"
        rubric = item["rubric"]
        blocks.append(
            f"--- Item {item['id']} ({item['type']}) ---\n"
            f"Question shown to student:\n{item['prompt']}\n\n"
            f"Rubric for this item:\n"
            f"  correct-justified: {rubric['correct-justified']}\n"
            f"  right-idea-gaps: {rubric['right-idea-gaps']}\n"
            f"  wrong-or-missing: {rubric['wrong-or-missing']}\n\n"
            f"Student's response:\n{student_answer}\n"
        )
    items_text = "\n".join(blocks)
    return (
        f"{RATER_INSTRUCTIONS}\n"
        f"Subtopic id: {subtopic}\n\n"
        f"{items_text}"
    )


def _strip_code_fences(text: str) -> str:
    text = text.strip()
    match = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
    return match.group(1) if match else text


def _parse_rater_json(raw_text: str, subtopic: str) -> dict:
    cleaned = _strip_code_fences(raw_text)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise RaterOutputError(f"Rater did not return valid JSON: {e}\nRaw: {raw_text[:500]}") from e

    if "per_item" not in data or not isinstance(data["per_item"], list):
        raise RaterOutputError(f"Rater JSON missing/invalid 'per_item': {data}")
    for entry in data["per_item"]:
        if entry.get("band") not in VALID_BANDS:
            raise RaterOutputError(f"Invalid band in rater output: {entry}")

    data.setdefault("subtopic", subtopic)
    return data


def _fallback_bucket_from_bands(per_item: list[dict]) -> str:
    """Safety net only — used if the model's bucket field is missing/invalid."""
    settings = get_settings()["bucket_heuristic"]
    total = len(per_item) or 1
    justified = sum(1 for e in per_item if e["band"] == "correct-justified")
    wrong = sum(1 for e in per_item if e["band"] == "wrong-or-missing")
    if wrong / total >= settings["c_min_wrong_ratio"]:
        return "C"
    if justified / total >= settings["a_min_justified_ratio"]:
        return "A"
    return "B"


def rate_subtopic(
    subtopic: str,
    responses: dict[str, str],
    *,
    llm: LLMClient | None = None,
) -> RaterResult:
    """responses: {item_id: free-text answer}. Calls the LLM rater and returns
    a validated RaterResult. Raises RaterOutputError if the model's output is
    unusable after one retry.
    """
    llm = llm or get_llm_client()
    settings = get_settings()["llm"]
    prompt = _build_prompt(subtopic, responses)

    last_error: Exception | None = None
    raw_text = ""
    for attempt in range(2):  # one retry on malformed JSON
        raw_text = llm.generate(
            system_prompt=(
                "You are a strict, calibrated rubric-based grader. Output JSON only."
            ),
            history=[{"role": "user", "text": prompt}],
            temperature=settings.get("rater_temperature", 0.2),
            json_mode=True,
        )
        try:
            data = _parse_rater_json(raw_text, subtopic)
            break
        except RaterOutputError as e:
            last_error = e
            data = None
    if data is None:
        raise RaterOutputError(f"Rater failed after retry: {last_error}\nLast raw: {raw_text[:500]}")

    used_fallback = False
    bucket = data.get("bucket")
    if bucket not in VALID_BUCKETS:
        bucket = _fallback_bucket_from_bands(data["per_item"])
        used_fallback = True

    return RaterResult(
        subtopic=data.get("subtopic", subtopic),
        per_item=data["per_item"],
        bucket=bucket,
        rationale=data.get("rationale", "(no rationale provided)"),
        used_fallback_heuristic=used_fallback,
    )

"""Deterministic unit tests for the rater's parsing/validation logic, using a
fake LLM client (no live API calls / no API key required).

The actual rater-vs-teacher agreement check (CLAUDE.md §8.2, "validate
against a real teacher") is `backend/scripts/validate_rater.py`, which DOES
call the live Gemini API against real teacher-labeled data — run that
separately once you have a teacher-labeled CSV.
"""
import json

import pytest

from app.rater import RaterOutputError, rate_subtopic


class FakeLLM:
    def __init__(self, response_text: str):
        self.response_text = response_text
        self.calls = []

    def generate(self, system_prompt, history, *, temperature=0.5, json_mode=False):
        self.calls.append((system_prompt, history, temperature, json_mode))
        return self.response_text


VALID_RESPONSE = json.dumps(
    {
        "subtopic": "algebra",
        "per_item": [
            {"item_id": "alg_1", "band": "correct-justified", "note": "good setup"},
            {"item_id": "alg_2", "band": "right-idea-gaps", "note": "minor slip"},
            {"item_id": "alg_3", "band": "correct-justified", "note": "caught it"},
            {"item_id": "alg_4", "band": "correct-justified", "note": "good comparison"},
        ],
        "bucket": "A",
        "rationale": "Mostly correct-justified with sound reasoning throughout.",
    }
)


def test_rate_subtopic_parses_valid_json():
    llm = FakeLLM(VALID_RESPONSE)
    result = rate_subtopic("algebra", {"alg_1": "x"}, llm=llm)
    assert result.bucket == "A"
    assert len(result.per_item) == 4
    assert result.used_fallback_heuristic is False


def test_rate_subtopic_strips_code_fences():
    fenced = "```json\n" + VALID_RESPONSE + "\n```"
    llm = FakeLLM(fenced)
    result = rate_subtopic("algebra", {"alg_1": "x"}, llm=llm)
    assert result.bucket == "A"


def test_rate_subtopic_falls_back_when_bucket_missing():
    data = json.loads(VALID_RESPONSE)
    del data["bucket"]
    llm = FakeLLM(json.dumps(data))
    result = rate_subtopic("algebra", {"alg_1": "x"}, llm=llm)
    assert result.used_fallback_heuristic is True
    # 3/4 correct-justified >= a_min_justified_ratio (0.6) -> should fall back to A
    assert result.bucket == "A"


def test_rate_subtopic_raises_on_garbage_after_retry():
    llm = FakeLLM("this is not json at all")
    with pytest.raises(RaterOutputError):
        rate_subtopic("algebra", {"alg_1": "x"}, llm=llm)
    # one initial attempt + one retry
    assert len(llm.calls) == 2


def test_rate_subtopic_rejects_invalid_band():
    bad = json.loads(VALID_RESPONSE)
    bad["per_item"][0]["band"] = "amazing"
    llm = FakeLLM(json.dumps(bad))
    with pytest.raises(RaterOutputError):
        rate_subtopic("algebra", {"alg_1": "x"}, llm=llm)

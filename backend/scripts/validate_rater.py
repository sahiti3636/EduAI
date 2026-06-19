#!/usr/bin/env python3
"""Teacher-validation script — CLAUDE.md §8.2 (required before trusting the rater).

Compares rater-assigned buckets against teacher-entered buckets for the same
students and reports agreement. Do NOT trust the rater in the pilot until
agreement is acceptable (aim ~80%+); if low, fix the rubric, not the students.

Usage:
    export GEMINI_API_KEY=...
    python backend/scripts/validate_rater.py path/to/teacher_buckets.csv

CSV format (one row per student x subtopic), header required:
    student_id,subtopic,item_1_id,item_1_response,item_2_id,item_2_response,...,teacher_bucket

Simplest/most robust format actually used here: a "long" CSV with one row per
(student_id, subtopic, item_id) plus one extra row per (student_id, subtopic)
giving the teacher_bucket. See `sample_teacher_validation.csv` for an example.
"""
from __future__ import annotations

import csv
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # make `app` importable

from app.rater import rate_subtopic  # noqa: E402


def load_long_csv(path: str) -> dict[tuple[str, str], dict]:
    """Reads a long-format CSV with columns:
        student_id, subtopic, item_id, response_text, teacher_bucket
    `item_id` may be blank on a row that only carries `teacher_bucket`
    (use this if it's easier to add the teacher's label as its own row).
    Returns {(student_id, subtopic): {"responses": {item_id: text}, "teacher_bucket": "A"}}
    """
    grouped: dict[tuple[str, str], dict] = defaultdict(lambda: {"responses": {}, "teacher_bucket": None})
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            key = (row["student_id"].strip(), row["subtopic"].strip())
            if row.get("item_id"):
                grouped[key]["responses"][row["item_id"].strip()] = row.get("response_text", "")
            if row.get("teacher_bucket"):
                grouped[key]["teacher_bucket"] = row["teacher_bucket"].strip().upper()
    return grouped


def main() -> None:
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)

    csv_path = sys.argv[1]
    grouped = load_long_csv(csv_path)

    total = 0
    agree = 0
    mismatches: list[str] = []

    for (student_id, subtopic), data in grouped.items():
        teacher_bucket = data["teacher_bucket"]
        if not teacher_bucket:
            print(f"  [skip] {student_id}/{subtopic}: no teacher_bucket given")
            continue
        if not data["responses"]:
            print(f"  [skip] {student_id}/{subtopic}: no responses given")
            continue

        result = rate_subtopic(subtopic, data["responses"])
        total += 1
        match = result.bucket == teacher_bucket
        agree += int(match)
        status = "MATCH" if match else "MISMATCH"
        line = (
            f"  [{status}] {student_id}/{subtopic}: "
            f"rater={result.bucket} teacher={teacher_bucket} | {result.rationale}"
        )
        print(line)
        if not match:
            mismatches.append(line)

    print("\n--- Summary ---")
    if total == 0:
        print("No comparable rows found — check your CSV.")
        return
    pct = 100.0 * agree / total
    print(f"Agreement: {agree}/{total} = {pct:.1f}%")
    if pct < 80:
        print(
            "Below the ~80% target in CLAUDE.md §8.2. Do NOT trust the rater for "
            "the pilot yet — revise the rubric (not the students) and re-run."
        )
    else:
        print("Meets the ~80% target. Still spot-check mismatches below before piloting.")
    if mismatches:
        print("\nMismatches to review:")
        for m in mismatches:
            print(m)


if __name__ == "__main__":
    main()

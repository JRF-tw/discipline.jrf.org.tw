#!/usr/bin/env python3
"""Validate the public data model before a deployment."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
URL_RE = re.compile(r"^https://\S+$")


def load(name: str):
    with (DATA / name).open(encoding="utf-8") as fh:
        return json.load(fh)


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def main() -> int:
    errors: list[str] = []
    try:
        db = load("cases.json")
        patterns_meta = load("pattern-meta.json")
        content = load("content-meta.json")
    except Exception as exc:  # pragma: no cover - command-line failure path
        print(f"data load failed: {exc}", file=sys.stderr)
        return 1

    if db.get("schemaVersion") != 3:
        fail(errors, f"cases.json schemaVersion must be 3, got {db.get('schemaVersion')!r}")
    if patterns_meta.get("schemaVersion") != 2:
        fail(errors, f"pattern-meta.json schemaVersion must be 2, got {patterns_meta.get('schemaVersion')!r}")
    if content.get("schemaVersion") != 1:
        fail(errors, f"content-meta.json schemaVersion must be 1, got {content.get('schemaVersion')!r}")

    cases = db.get("cases")
    patterns = db.get("patterns")
    map_rows = db.get("mapRows")
    laws = db.get("laws")
    signs = db.get("signs")
    sources = {str(item.get("key", "")).lower() for item in db.get("sources", [])}
    sources.update(str(item.get("key", "")).lower() for item in db.get("extraSources", []))
    # x denotes other regulations that are intentionally not represented in laws[].
    sources.add("x")
    meta_patterns = patterns_meta.get("patterns", {})

    if not isinstance(cases, list) or not cases:
        fail(errors, "cases must be a non-empty array")
        cases = []
    if not isinstance(patterns, list):
        fail(errors, "patterns must be an array")
        patterns = []
    if not isinstance(map_rows, list):
        fail(errors, "mapRows must be an array")
        map_rows = []
    if not isinstance(laws, dict):
        fail(errors, "laws must be an object")
        laws = {}
    if not isinstance(signs, list):
        fail(errors, "signs must be an array")
        signs = []

    case_numbers = {case.get("caseNo") for case in cases}
    pattern_ids = {pattern.get("id") for pattern in patterns}
    for pattern in patterns:
        pid = pattern.get("id")
        if not isinstance(pid, str) or not re.fullmatch(r"P\d{3}", pid):
            fail(errors, f"invalid pattern id: {pid!r}")
        if pid not in meta_patterns:
            fail(errors, f"pattern {pid!r} missing from pattern-meta.json")
        for index in pattern.get("cases", []):
            if not isinstance(index, int) or index < 0 or index >= len(cases):
                fail(errors, f"pattern {pid!r} references invalid case index {index!r}")
        for law_key, articles in (pattern.get("laws") or {}).items():
            if str(law_key).lower() not in sources:
                fail(errors, f"pattern {pid!r} references unknown law key {law_key!r}")
            if not isinstance(articles, list):
                fail(errors, f"pattern {pid!r} law {law_key!r} is not an array")

    for index, row in enumerate(map_rows):
        pid = row.get("patternId") if isinstance(row, dict) else None
        if pid and pid not in pattern_ids:
            fail(errors, f"mapRows[{index}] references unknown pattern {pid!r}")

    for key, law in laws.items():
        if str(key).lower() not in sources:
            fail(errors, f"laws contains unknown source key {key!r}")
        for index, article in enumerate(law.get("articles", [])):
            if not isinstance(article, dict) or not article.get("no"):
                fail(errors, f"laws[{key!r}].articles[{index}] has no article number")

    for index, case in enumerate(cases):
        prefix = f"cases[{index}]"
        if not case.get("caseNo") or not case.get("name"):
            fail(errors, f"{prefix} requires caseNo and name")
        if not DATE_RE.fullmatch(str(case.get("date", ""))):
            fail(errors, f"{prefix}.date is not YYYY-MM-DD")
        if case.get("revDate") and not DATE_RE.fullmatch(str(case["revDate"])):
            fail(errors, f"{prefix}.revDate is not YYYY-MM-DD")
        if case.get("dOrig") and not DATE_RE.fullmatch(str(case["dOrig"])):
            fail(errors, f"{prefix}.dOrig is not YYYY-MM-DD")
        if case.get("revDOrig") and not DATE_RE.fullmatch(str(case["revDOrig"])):
            fail(errors, f"{prefix}.revDOrig is not YYYY-MM-DD")
        for field in ("full", "revFull"):
            value = case.get(field, "")
            if value and value != "無全文" and not URL_RE.fullmatch(str(value).split("#", 1)[0]):
                fail(errors, f"{prefix}.{field} is not an HTTPS URL or 無全文")
        for norm_index, norm in enumerate(case.get("norm", [])):
            if not isinstance(norm, list) or len(norm) != 3:
                fail(errors, f"{prefix}.norm[{norm_index}] must have three elements")
            elif str(norm[1]).lower() not in sources:
                fail(errors, f"{prefix}.norm[{norm_index}] uses unknown law key {norm[1]!r}")
        for field in ("sig", "sigRev"):
            if case.get(field) is not None and (
                not isinstance(case[field], int) or case[field] < 0 or case[field] >= len(signs)
            ):
                fail(errors, f"{prefix}.{field} points outside signs")
        if case.get("caseNo") not in case_numbers:
            fail(errors, f"{prefix}.caseNo is not indexed")

    if errors:
        print(f"Data validation failed with {len(errors)} error(s):", file=sys.stderr)
        for error in errors[:100]:
            print(f"- {error}", file=sys.stderr)
        if len(errors) > 100:
            print(f"- ... {len(errors) - 100} more", file=sys.stderr)
        return 1

    print(f"Data validation passed: {len(cases)} cases, {len(patterns)} patterns, {len(laws)} law groups")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Smoke-test the generated browser data files."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def read(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_site_data.py OUTPUT_DATA_DIR", file=sys.stderr)
        return 2
    out = Path(sys.argv[1])
    source = read(Path("data/cases.json"))
    index = read(out / "cases-index.json")
    fulltext = read(out / "cases-fulltext.json")
    content = read(out / "content-meta.json")

    cases = source["cases"]
    errors: list[str] = []
    if len(index.get("cases", [])) != len(cases):
        errors.append("generated index case count differs from source")
    if any("ft" in case or "ftRev" in case for case in index.get("cases", [])):
        errors.append("generated index still contains fulltext fields")
    expected_main = {c["caseNo"] for c in cases if c.get("ft") and c.get("caseNo")}
    expected_rev = {c["revNo"] for c in cases if c.get("ftRev") and c.get("revNo")}
    if set(fulltext.get("main", {})) != expected_main:
        errors.append("generated main fulltext keys differ from source")
    if set(fulltext.get("rev", {})) != expected_rev:
        errors.append("generated review fulltext keys differ from source")
    for year in range(2005, 2011):
        expected = sum(1 for c in cases if (c.get("revDate") or c.get("date") or "").startswith(str(year)))
        actual = content["stats"]["rows"][str(year)][0]
        if actual != expected:
            errors.append(f"generated stats total for {year} is {actual}, expected {expected}")

    if errors:
        print("Generated site data smoke test failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Generated site data smoke test passed: {len(cases)} cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

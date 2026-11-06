#!/usr/bin/env python3
"""Create the browser-facing split data files from the canonical cases.json."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path


HC_OF = {
    "1": 1, "2.09": 2, "2.1": 2, "2.11": 2, "2.12": 2, "2.23": 2,
    "2.24": 2, "2.25": 2, "2.3": 3, "2.31": 3, "2.32": 3,
    "2.341": 3, "2.342": 3, "2.35": 3, "2.38": 3, "2.4": 3,
    "2.41": 3, "2.44": 3, "2.49": 3, "2.495": 3, "2.497": 3,
    "2.5": 3, "2.51": 3, "2.52": 3, "2.6": 3, "2.61": 3,
    "2.62": 3, "2.63": 3, "2.7": 3, "2.71": 3, "2.72": 3,
    "2.73": 3, "2.8": 3, "3": 4, "3.01": 4, "3.2": 4,
    "3.21": 4, "3.4": 4, "3.41": 4, "3.61": 4, "3.7": 5,
    "4.01": 6, "4.21": 6, "4.6": 6, "4.61": 6, "4.7": 7,
    "5.01": 8, "5.21": 8, "5.41": 8, "5.6": 8, "5.61": 8,
    "6": 0, "7": 0, "8": 0, "9": 0, "1001": 0, "1001.1": 0, "1002": 0,
}


def number_key(value) -> str:
    text = str(value)
    return text[:-2] if text.endswith(".0") else text


def derive_early_stats(cases: list[dict], content: dict) -> None:
    """Rebuild the years whose official aggregate table is unavailable.

    The first six years are defined by the cases dataset. Later years remain
    sourced from the official statistics table in content-meta.json.
    """
    rows = content.get("stats", {}).get("rows", {})
    for year in range(2005, 2011):
        row = [0] * 34
        for case in cases:
            final_date = case.get("revDate") or case.get("date") or ""
            if not final_date.startswith(str(year)):
                continue
            row[0] += 1
            category = HC_OF.get(number_key(case.get("h")))
            decision = str(case.get("decision", ""))
            if category == 1:
                index = 24
            elif category in (2, 3):
                index = 22 if "研習" in decision else 20
            elif category == 4:
                index = 18
            elif category == 5:
                index = 16
            elif category == 6:
                index = 14
            elif category == 7:
                index = 12
            elif category == 8:
                index = 10
            elif category == 0:
                index = 8 if "免議" in decision else 6 if "不受理" in decision else 4
            else:
                raise ValueError(f"unknown h value for {case.get('caseNo')}: {case.get('h')}")
            row[index] += 1
        rows[str(year)] = row


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    with args.source.open(encoding="utf-8") as fh:
        source = json.load(fh)
    content_source = args.source.parent / "content-meta.json"
    with content_source.open(encoding="utf-8") as fh:
        content = json.load(fh)
    derive_early_stats(source["cases"], content)

    index = copy.deepcopy(source)
    fulltext = {"schemaVersion": source.get("schemaVersion"), "main": {}, "rev": {}}
    for case in index["cases"]:
        case_no = case.get("caseNo")
        if case.get("ft") and case_no and case_no not in fulltext["main"]:
            fulltext["main"][case_no] = case.pop("ft")
        else:
            case.pop("ft", None)
        rev_no = case.get("revNo")
        if case.get("ftRev") and rev_no and rev_no not in fulltext["rev"]:
            fulltext["rev"][rev_no] = case.pop("ftRev")
        else:
            case.pop("ftRev", None)

    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / "cases-index.json").open("w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    with (args.output / "cases-fulltext.json").open("w", encoding="utf-8") as fh:
        json.dump(fulltext, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    with (args.output / "content-meta.json").open("w", encoding="utf-8") as fh:
        json.dump(content, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    print(f"Generated {args.output / 'cases-index.json'} and {args.output / 'cases-fulltext.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Static browser contract checks for the site's boot and interaction surface."""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise AssertionError(f"missing {label}: {needle}")


def main() -> int:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
    loader = (ROOT / "assets/js/load-data.js").read_text(encoding="utf-8")
    route = (ROOT / "assets/js/modules/route.js").read_text(encoding="utf-8")
    context = (ROOT / "assets/js/modules/app-context.js").read_text(encoding="utf-8")
    fulltext = (ROOT / "assets/js/modules/fulltext-service.js").read_text(encoding="utf-8")
    fulltext_renderer = (ROOT / "assets/js/modules/fulltext-renderer.js").read_text(encoding="utf-8")
    dialog_events = (ROOT / "assets/js/modules/fulltext-dialog-events.js").read_text(encoding="utf-8")
    fulltext_highlight = (ROOT / "assets/js/modules/fulltext-highlight.js").read_text(encoding="utf-8")
    fulltext_meta = (ROOT / "assets/js/modules/fulltext-meta.js").read_text(encoding="utf-8")
    dialog_controller = (ROOT / "assets/js/modules/fulltext-dialog-controller.js").read_text(encoding="utf-8")
    lifecycle = (ROOT / "assets/js/modules/feature-lifecycle.js").read_text(encoding="utf-8")
    list_state = (ROOT / "assets/js/modules/case-list-state.js").read_text(encoding="utf-8")
    list_search = (ROOT / "assets/js/modules/case-list-search.js").read_text(encoding="utf-8")
    list_view = (ROOT / "assets/js/modules/case-list-view.js").read_text(encoding="utf-8")
    list_pager = (ROOT / "assets/js/modules/case-list-pager.js").read_text(encoding="utf-8")
    list_renderer = (ROOT / "assets/js/modules/case-list-renderer.js").read_text(encoding="utf-8")

    order = [
        "assets/js/modules/app-context.js",
        "assets/js/modules/route.js",
        "assets/js/modules/fulltext-service.js",
        "assets/js/modules/fulltext-renderer.js",
        "assets/js/modules/fulltext-dialog-events.js",
        "assets/js/modules/fulltext-dialog-controller.js",
        "assets/js/modules/fulltext-highlight.js",
        "assets/js/modules/fulltext-meta.js",
        "assets/js/modules/feature-lifecycle.js",
        "assets/js/modules/case-list-state.js",
        "assets/js/modules/case-list-search.js",
        "assets/js/modules/case-list-view.js",
        "assets/js/modules/case-list-pager.js",
        "assets/js/modules/case-list-renderer.js",
        "assets/js/load-data.js",
    ]
    positions = [html.find(path) for path in order]
    if any(pos < 0 for pos in positions) or positions != sorted(positions):
        raise AssertionError("boot scripts are missing or in the wrong order")

    for selector in ["id=\"tabbtn-list\"", "id=\"list-table\""]:
        require(html, selector, selector)
    for selector in ["id = FILES[i][0]", "db-content-meta", "db-pattern-meta", "'db'"]:
        require(loader, selector, selector)
    require(app, "DisciplineApp.services.fulltext", "fulltext service integration")
    require(app, "DisciplineApp.features", "feature lifecycle integration")
    require(app, "APP_CONTEXT", "shared app context")
    require(app, "CASE_LIST_STATE", "case list state integration")
    require(app, "CASE_LIST_SEARCH", "case list search integration")
    require(app, "CASE_LIST_VIEW", "case list view integration")
    require(app, "CASE_LIST_PAGER", "case list pager integration")
    require(app, "CASE_LIST_RENDERER", "case list renderer integration")
    require(app, "FULLTEXT_RENDERER", "fulltext renderer integration")
    require(app, "function ensureFulltext()", "fulltext loading entrypoint")
    require(app, "initFulltextDeferredClick", "deferred fulltext click bridge")
    require(route, "global.DBROUTE", "route module export")
    require(context, "app.context", "shared context export")
    require(fulltext, "cases-fulltext.json", "fulltext endpoint")
    require(fulltext_renderer, "fulltextRenderer", "fulltext renderer export")
    require(dialog_events, "fulltextDialogEvents", "fulltext dialog event export")
    require(dialog_controller, "fulltextDialogController", "fulltext dialog controller export")
    require(fulltext_highlight, "fulltextHighlight", "fulltext highlight export")
    require(fulltext_meta, "fulltextMeta", "fulltext meta export")
    require(lifecycle, "app.features", "feature lifecycle export")
    require(list_state, "createState", "case list state export")
    require(list_search, "caseListSearch", "case list search export")
    require(list_view, "caseListView", "case list view export")
    require(list_pager, "caseListPager", "case list pager export")
    require(list_renderer, "caseListRenderer", "case list renderer export")
    require((ROOT / "tests/browser-smoke.mjs").read_text(encoding="utf-8"), "playwright", "browser smoke test")

    if re.search(r"window\.__loadDisciplineFulltext", app):
        raise AssertionError("legacy fulltext loader is still referenced by app.js")

    if "data/cases.json" in html:
        raise AssertionError("public HTML still references maintenance-only cases.json")

    print("Browser contract checks passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"Browser contract check failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

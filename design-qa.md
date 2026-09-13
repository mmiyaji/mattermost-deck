# Pane-local incremental search — design QA

Date: 2026-09-14

## Visual target and scope

Selected the first displayed concept, **必要なときだけ開く検索** (`exec-ddb64085-48ce-4b25-a665-01352904e5e8.png`). Implemented in the existing extension, retaining its theme tokens, typography, cards, and icons.

Compared the source board and final implementation images together. The source is a 1536 × 1024 presentation board with enlarged pane examples; implementation captures are 1600 × 900 at device scale 1 with the existing 320 CSS-pixel panes. Comparison therefore focused on corresponding pane/header/input/result regions, rather than the surrounding presentation canvas. The fixture is in English; all nine application locales have translated controls.

## Evidence

- `test-results/pane-search-final/favorites-ui-built-Deck-di-d7f35--pane-with-a-fixture-server/pane-search-active.png`
- `test-results/pane-search-final/favorites-ui-built-Deck-di-d7f35--pane-with-a-fixture-server/pane-search-empty.png`
- `test-results/pane-search-final/favorites-favorites-persis-c3d66-econcile-edits-and-deletion/pane-search.png` (real Docker Mattermost)

These are local ignored test artifacts.

## Findings

- Closed state adds only an unboxed search icon alongside the existing controls toggle.
- Open state uses a compact single-row input, inline count and clear button, followed by the loaded-post scope hint. Text and controls fit within the existing pane.
- Search terms remain visible while filtering; filtered excerpts use the existing highlight colors. Other panes retain their posts.
- Empty state keeps the query and count visible. Changed the initially prominent filled clear button to a quiet outline button.
- Keyboard focus, Escape, clear, and IME composition were exercised in Chromium. Filtering and clearing do not request additional favorite posts.
- Existing body/author alignment and bottom-right favorite actions remain intact.
- No unresolved P0/P1/P2 design issues. The decorative empty-state illustration from the concept was omitted to keep the existing compact pane style; no new raster assets were required.

final result: passed

# Pane-local search validation — 2026-09-14

## Behavior

- All post-list panes expose an unobtrusive header search icon: mentions, channels, DMs, search/keyword results, favorites, and saved posts. Diagnostics is excluded.
- Opening reveals a compact input, count, and loaded-post scope hint. Filtering matches literal case-insensitive message text or loaded author names (including `@username`), and uses canonical Unicode normalization.
- Search is independent per mounted pane, not persisted, and does not call a search endpoint or load additional pages. The normalized text index is built only while a nonblank query is active and reused between keystrokes until posts or users change.
- IME conversion does not change results until composition ends. Clear restores the list; Escape clears and closes the field, returning focus to its toggle. Clicking the toggle with a query refocuses the field instead of hiding an active filter.
- Filtered views show highlighted excerpts, suppress pagination/end-of-list claims and synthetic new-post notices, and omit the unread-divider mark-all-read action. Existing pane-level read controls retain their original meaning.

## Checks

- Build, TypeScript, static site validation, and unit suite passed: **381 tests across 38 files**.
- `favorites-ui.spec.ts` exercises the built extension with a fixture API: opening, live filtering, query/count visibility, zero matches, isolation from another pane, unchanged favorite lookup count, username filtering, IME composition, Escape, and existing favorite hover/touch/keyboard behavior. Passed on the final build.
- `favorites.spec.ts` passed against Docker Mattermost 9.5.11, including real-server search isolation and restoration, alongside cached favorite persistence and edit/delete refresh.
- Full standard E2E run: **43 passed, 1 failed, 3 skipped** in 7.3 minutes. The non-CRT reply test failed at its API fixture precondition (`replyIsUnread: false`) before launching its browser. The test itself was left unchanged and subsequently passed in a targeted run (**3 passed**, including both updated favorites scenarios, in 1.7 minutes).
- Thus all 44 enabled standard E2E cases have a successful run. This is not a claim that the initial full run was entirely green. Long-running soak, seeded monkey, and store-build smoke remain opt-in and were skipped.
- Final minor author-index handling (`@username`) was separately verified by the five filter unit cases and built-extension UI E2E.

## Artifacts and limits

- Full run: `test-results/pane-search-full/`
- Real-server/IME/empty-state captures: `test-results/pane-search-final/`
- Final author-search UI run: `test-results/pane-search-author-final/`
- Visual comparison: `design-qa.md`

Artifacts are ignored local test output. Search covers loaded post snapshots and known authors, not the complete server history or attachment contents. No release ZIP was repackaged in this change.

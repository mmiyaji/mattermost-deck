import React, { useId, useMemo, useRef, useState } from "react";
import type { MattermostPost, MattermostUser } from "../mattermost/api";
import i18n from "./i18n";
import { filterPanePosts, indexPanePosts } from "./paneSearchFilter";

export function usePaneSearch(posts: MattermostPost[], users: Record<string, MattermostUser>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const composing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const active = Boolean(query.trim());
  const index = useMemo(() => active ? indexPanePosts(posts, users) : [], [posts, users, active]);
  const filtered = useMemo(() => filterPanePosts(posts, index, query), [posts, index, query]);
  const clear = () => { setDraft(""); setQuery(""); composing.current = false; };
  const close = () => { clear(); setOpen(false); toggleRef.current?.focus(); };
  return { open, setOpen, draft, setDraft, query, setQuery, composing, inputRef, toggleRef, id,
    posts: filtered, total: posts.length, active, clear, close };
}

export type PaneSearchState = ReturnType<typeof usePaneSearch>;

export function PaneSearchToggle({ search, icon }: { search: PaneSearchState; icon: React.ReactNode }) {
  return <button type="button" ref={search.toggleRef} className="deck-icon-button deck-icon-button--ghost deck-pane-search-toggle"
    title={i18n.t("deck.paneSearchOpen")} aria-label={i18n.t("deck.paneSearchOpen")}
    aria-expanded={search.open} aria-controls={search.id}
    onClick={() => {
      if (search.open && !search.draft) search.close();
      else if (search.open) search.inputRef.current?.focus();
      else search.setOpen(true);
    }}>{icon}</button>;
}

export function PaneSearchField({ search, icon, closeIcon }: { search: PaneSearchState; icon: React.ReactNode; closeIcon: React.ReactNode }) {
  if (!search.open) return null;
  // Outside the closed shadow root, Mattermost sees the host rather than our
  // input and may redirect typing to its composer. Keep key events local while
  // retaining their native editing, focus navigation, and IME behavior.
  return <div id={search.id} className="deck-pane-search"
    onKeyDown={event => event.stopPropagation()}
    onKeyUp={event => event.stopPropagation()}
    onKeyPress={event => event.stopPropagation()}>
    <div className="deck-pane-search-row">
      {icon}
      <input ref={search.inputRef} autoFocus type="text" value={search.draft} maxLength={200} autoComplete="off" spellCheck={false}
        aria-label={i18n.t("deck.paneSearchPlaceholder")} aria-describedby={`${search.id}-hint`}
        placeholder={i18n.t("deck.paneSearchPlaceholder")}
        onChange={event => {
          search.setDraft(event.target.value);
          if (!search.composing.current) search.setQuery(event.target.value);
        }}
        onCompositionStart={() => { search.composing.current = true; }}
        onCompositionEnd={event => { search.composing.current = false; search.setQuery(event.currentTarget.value); }}
        onKeyDown={event => {
          // Let the IME handle Escape/Enter during conversion.
          if (event.nativeEvent.isComposing || search.composing.current || event.keyCode === 229) return;
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); search.close(); }
          if (event.key === "Enter") event.preventDefault();
        }} />
      <span className="deck-pane-search-count" role="status" aria-live="polite" aria-atomic="true"
        aria-label={i18n.t("deck.paneSearchCount", { count: search.posts.length, total: search.total })}>{search.posts.length} / {search.total}</span>
      <button type="button" className="deck-icon-button deck-icon-button--ghost" aria-label={i18n.t(search.draft ? "deck.paneSearchClear" : "deck.paneSearchClose")}
        title={i18n.t(search.draft ? "deck.paneSearchClear" : "deck.paneSearchClose")}
        onClick={() => {
          if (search.draft) { search.clear(); search.inputRef.current?.focus(); }
          else search.close();
        }}>{closeIcon}</button>
    </div>
    <p id={`${search.id}-hint`} className="deck-pane-search-hint">{i18n.t("deck.paneSearchHint")}</p>
    {search.active && search.posts.length === 0 ? <div className="deck-pane-search-empty">
      <p>{i18n.t("deck.paneSearchEmpty")}</p>
      <button type="button" className="deck-button" onClick={() => { search.clear(); search.inputRef.current?.focus(); }}>{i18n.t("deck.paneSearchClear")}</button>
    </div> : null}
  </div>;
}

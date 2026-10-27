import React, { useEffect, useMemo, useRef, useState } from "react";
import { searchUsers, type MattermostPost, type MattermostUser } from "../mattermost/api";
import type { useMentionExclusions } from "./mentionExclusions";

type Exclusions = ReturnType<typeof useMentionExclusions>;
export interface ExclusionFeedback { text: string; undo: () => Promise<void> }

export function MentionExclusionControls({ rules, directory, channelLabels, showExcluded, onShowExcluded, language, onFeedback }: {
  rules: Exclusions;
  directory: Record<string, MattermostUser>;
  channelLabels: Record<string, string>;
  showExcluded: boolean;
  onShowExcluded: (value: boolean) => void;
  language: string;
  onFeedback: (feedback: ExclusionFeedback) => void;
}): React.JSX.Element {
  const ja = language === "ja";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MattermostUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const term = query.trim().replace(/^@/, "");
  useEffect(() => {
    let active = true;
    setResults([]);
    setSearchError(null);
    if (term.length < 2) { setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchUsers(term).then(users => { if (active) setResults(users); }).catch(error => { if (active) setSearchError(error instanceof Error ? error.message : String(error)); }).finally(() => { if (active) setSearching(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [term]);
  const candidates = useMemo(() => {
    if (!term) return [];
    const excluded = new Set(rules.users.map(user => user.id));
    const merged = new Map([...Object.values(directory), ...results].map(user => [user.id, user]));
    return [...merged.values()].filter(user => user.username && !excluded.has(user.id) && [user.username, user.nickname, user.first_name, user.last_name].some(value => value?.toLowerCase().includes(term.toLowerCase()))).slice(0, 20);
  }, [term, directory, results, rules.users]);
  const addUser = async (user: MattermostUser) => {
    setBusy(true);
    try {
      await rules.excludeUser({ id: user.id, username: user.username, displayName: user.nickname || [user.first_name, user.last_name].filter(Boolean).join(" ") || undefined });
      setQuery("");
      onFeedback({ text: ja ? "ユーザーを表示から除外しました" : "User excluded from display", undo: () => rules.restoreUser(user.id) });
    } catch { /* The shared store exposes write errors. */ } finally { setBusy(false); }
  };
  const restore = async (run: () => Promise<void>) => { setBusy(true); try { await run(); } catch { /* Store error remains visible outside the fold. */ } finally { setBusy(false); } };
  return <section className="deck-exclusion-settings" data-deck-exclusion-controls aria-label={ja ? "表示の除外" : "Display exclusions"}>
    <div className="deck-exclusion-heading"><strong>{ja ? "表示の除外" : "Display exclusions"}</strong><span>{ja ? `ユーザー ${rules.users.length}人・会話 ${rules.conversations.length}件` : `${rules.users.length} users · ${rules.conversations.length} conversations`}</span></div>
    <p className="deck-exclusion-note">{ja ? "すべてのメンションペインで共有し、再起動後も保持します。非表示にしても既読・確認済みにはなりません。" : "Shared across mention panes and saved across restarts. Hiding does not mark posts read or confirmed."}</p>
    <h3>{ja ? "ユーザー" : "Users"}</h3>
    <label className="deck-field"><span className="deck-sr-only">{ja ? "除外するユーザーを検索" : "Search users to exclude"}</span><input type="search" className="deck-input" data-deck-exclusion-user-search value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder={ja ? "ユーザーを検索" : "Search users"} disabled={!rules.ready || busy} /></label>
    {term ? <div className="deck-exclusion-search-results" aria-live="polite">
      {candidates.map(user => <button type="button" className="deck-exclusion-search-result" key={user.id} data-deck-exclusion-user-result={user.id} disabled={busy} onClick={() => void addUser(user)}><span>@{user.username}</span><small>{ja ? "追加" : "Add"}</small></button>)}
      {searching ? <p>{ja ? "検索中…" : "Searching…"}</p> : candidates.length === 0 ? <p>{term.length < 2 ? (ja ? "サーバー検索は2文字から" : "Enter 2 characters to search the server") : (ja ? "一致するユーザーはいません" : "No matching users")}</p> : null}
      {searchError ? <p role="alert">{searchError}</p> : null}
    </div> : null}
    <div className="deck-exclusion-list">{rules.users.map(user => <div className="deck-exclusion-row" key={user.id} data-deck-excluded-user={user.id}><span className="deck-exclusion-avatar" aria-hidden="true">@</span><span className="deck-exclusion-label">@{user.username}{user.displayName ? <small>{user.displayName}</small> : null}</span><button type="button" className="deck-exclusion-link" data-deck-restore-excluded-user={user.id} disabled={busy} onClick={() => void restore(() => rules.restoreUser(user.id))} aria-label={`${ja ? "除外を解除" : "Restore"} @${user.username}`}>{ja ? "解除" : "Restore"}</button></div>)}{!rules.users.length ? <p className="deck-exclusion-empty">{ja ? "除外しているユーザーはいません" : "No excluded users"}</p> : null}</div>
    <h3>{ja ? "会話" : "Conversations"}</h3>
    <div className="deck-exclusion-list">{rules.conversations.map(conversation => <div className="deck-exclusion-row" key={conversation.rootId} data-deck-excluded-thread={conversation.rootId}><span className="deck-exclusion-avatar" aria-hidden="true">↳</span><span className="deck-exclusion-label"><strong>{conversation.label}</strong><small>{conversation.authorUsername ? `@${conversation.authorUsername} · ` : ""}{channelLabels[conversation.channelId] || conversation.channelId}</small></span><button type="button" className="deck-exclusion-link" data-deck-restore-excluded-thread={conversation.rootId} disabled={busy} onClick={() => void restore(() => rules.restoreConversation(conversation.rootId))} aria-label={`${ja ? "会話の除外を解除" : "Restore conversation"}: ${conversation.label}`}>{ja ? "解除" : "Restore"}</button></div>)}{!rules.conversations.length ? <p className="deck-exclusion-empty">{ja ? "除外している会話はありません" : "No excluded conversations"}</p> : null}</div>
    <label className="deck-toggle deck-exclusion-reveal"><input type="checkbox" data-deck-show-excluded checked={showExcluded} onChange={event => onShowExcluded(event.currentTarget.checked)} /><span>{ja ? "除外した投稿を一時表示" : "Temporarily show excluded posts"}</span></label>
  </section>;
}

export function MentionPostMenu({ post, user, rootPost, rootUser, channelLabel, rules, language, onFeedback }: {
  post: MattermostPost; user?: MattermostUser; rootPost?: MattermostPost; rootUser?: MattermostUser; channelLabel: string; rules: Exclusions; language: string; onFeedback: (feedback: ExclusionFeedback) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = React.useId();
  const ja = language === "ja";
  useEffect(() => {
    if (!open) return;
    const root = host.current?.getRootNode();
    const outside = (event: Event) => {
      if (event.currentTarget === document && root instanceof ShadowRoot && event.composedPath().includes(root.host)) return;
      if (host.current && !event.composedPath().includes(host.current)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside, true);
    if (root instanceof ShadowRoot) root.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside, true); if (root instanceof ShadowRoot) root.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  const exclude = async (kind: "user" | "thread") => {
    setBusy(true);
    try {
      if (kind === "user" && user) {
        await rules.excludeUser({ id: user.id, username: user.username, displayName: user.nickname || undefined });
        onFeedback({ text: ja ? "ユーザーを表示から除外しました" : "User excluded from display", undo: () => rules.restoreUser(user.id) });
      } else if (kind === "thread") {
        const rootId = post.root_id || post.id;
        await rules.excludeConversation({ rootId, channelId: post.channel_id, label: (rootPost?.message || post.message || channelLabel).replace(/\s+/g, " ").slice(0, 120), authorUsername: rootPost ? rootUser?.username : user?.username });
        onFeedback({ text: ja ? "会話を表示から除外しました" : "Conversation excluded from display", undo: () => rules.restoreConversation(rootId) });
      }
      setOpen(false);
    } catch { /* Save failure keeps the post visible. */ } finally { setBusy(false); }
  };
  return <div ref={host} className="deck-mention-post-menu" onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <button type="button" ref={trigger} className="deck-icon-button deck-icon-button--ghost" data-deck-mention-menu={post.id} aria-label={ja ? "メンションの投稿メニュー" : "Mention post menu"} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><svg className="deck-type-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="13" cy="8" r="1" /></svg></button>
    {open ? <div id={id} className="deck-mention-post-menu-items"><button type="button" data-deck-exclude-user disabled={!rules.ready || busy || !user?.username} onClick={() => void exclude("user")}>{ja ? "このユーザーの投稿を表示しない" : "Hide posts from this user"}</button><button type="button" data-deck-exclude-thread disabled={!rules.ready || busy} onClick={() => void exclude("thread")}>{ja ? "この会話を表示しない" : "Hide this conversation"}</button></div> : null}
  </div>;
}

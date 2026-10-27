import { useMemo, useSyncExternalStore } from "react";
import type { MattermostPost } from "../mattermost/api";

export interface ExcludedMentionUser { id: string; username: string; displayName?: string }
export interface ExcludedMentionConversation { rootId: string; channelId: string; label: string; authorUsername?: string }
interface Snapshot { loaded: boolean; ready: boolean; error: string | null; users: ExcludedMentionUser[]; conversations: ExcludedMentionConversation[] }
export const mentionExclusionPrefix = (server: string, userId: string) => `mattermostDeck.mentionExclusions.v1:${encodeURIComponent(server)}:${encodeURIComponent(userId)}:`;
export function isMentionExcluded(post: MattermostPost, userIds: ReadonlySet<string>, rootIds: ReadonlySet<string>): boolean {
  return userIds.has(post.user_id) || rootIds.has(post.root_id || post.id);
}
const area = () => typeof chrome !== "undefined" && chrome.storage?.local ? chrome.storage.local : null;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const string = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";
function user(value: unknown): ExcludedMentionUser | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const id = string(v.id, 200), username = string(v.username, 200), displayName = string(v.displayName, 200);
  return id && username ? { id, username, ...(displayName ? { displayName } : {}) } : null;
}
function conversation(value: unknown): ExcludedMentionConversation | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const rootId = string(v.rootId, 200), channelId = string(v.channelId, 200), label = string(v.label, 160), authorUsername = string(v.authorUsername, 200);
  return rootId && channelId && label ? { rootId, channelId, label, ...(authorUsername ? { authorUsername } : {}) } : null;
}
const stores = new Map<string, MentionExclusionStore>();
const emptySnapshot: Snapshot = { loaded: false, ready: false, error: null, users: [], conversations: [] };

/** One store per account, with independent storage keys for each rule. */
export class MentionExclusionStore {
  private values: Record<string, unknown> = {};
  private revisions = new Map<string, number>();
  private snapshot: Snapshot = emptySnapshot;
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private loading: Promise<void> | null = null;
  private pending: Record<string, unknown> | null = null;
  private cleanup?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private storageArea = area();
  constructor(readonly prefix: string) {
    // Listen before reading so changes arriving during hydration win over its snapshot.
    if (this.storageArea) chrome.storage.onChanged.addListener(this.changed);
    else if (typeof window !== "undefined") window.addEventListener("storage", this.localChanged);
    void this.retry();
    this.scheduleCleanup();
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    clearTimeout(this.cleanup);
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); this.scheduleCleanup(); };
  };
  private scheduleCleanup() {
    clearTimeout(this.cleanup);
    this.cleanup = setTimeout(() => {
      const pendingQueue = this.queue;
      void Promise.allSettled([pendingQueue, this.loading]).then(() => {
        if (!this.listeners.size && pendingQueue === this.queue) this.dispose();
        else if (!this.listeners.size) this.scheduleCleanup();
      });
    }, 1000);
  }
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.cleanup);
    if (this.storageArea) chrome.storage.onChanged.removeListener(this.changed);
    else if (typeof window !== "undefined") window.removeEventListener("storage", this.localChanged);
    if (stores.get(this.prefix) === this) stores.delete(this.prefix);
  };
  private publish(error: string | null = null, ready = this.snapshot.ready, loaded = this.snapshot.loaded) {
    const users: ExcludedMentionUser[] = [], conversations: ExcludedMentionConversation[] = [];
    for (const [key, value] of Object.entries(this.values)) {
      if (key.startsWith(`${this.prefix}user:`)) {
        const rule = user(value);
        if (rule && key === this.userKey(rule.id)) users.push(rule);
      } else if (key.startsWith(`${this.prefix}conversation:`)) {
        const rule = conversation(value);
        if (rule && key === this.conversationKey(rule.rootId)) conversations.push(rule);
      }
    }
    users.sort((a, b) => a.username.localeCompare(b.username));
    conversations.sort((a, b) => a.label.localeCompare(b.label));
    this.snapshot = { loaded, ready, error, users, conversations };
    this.listeners.forEach(listener => listener());
  }
  private accept(changes: Record<string, unknown>) {
    const relevant = Object.fromEntries(Object.entries(changes).filter(([key]) => key.startsWith(this.prefix)));
    if (!Object.keys(relevant).length) return;
    for (const key of Object.keys(relevant)) this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    if (this.pending) Object.assign(this.pending, relevant);
    Object.assign(this.values, relevant);
    this.publish(this.snapshot.error);
  }
  private changed = (changes: Record<string, chrome.storage.StorageChange>, namespace: string) => {
    if (namespace === "local") this.accept(Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.newValue])));
  };
  private localChanged = (event: StorageEvent) => {
    if (event.storageArea !== localStorage || !event.key) return;
    try { this.accept({ [event.key]: event.newValue === null ? null : JSON.parse(event.newValue) }); } catch { this.accept({ [event.key]: null }); }
  };
  retry = (): Promise<void> => {
    if (this.loading) return this.loading;
    this.pending = {};
    this.loading = Promise.resolve().then(async () => {
      try {
        const values: Record<string, unknown> = {};
        if (this.storageArea) Object.assign(values, await this.storageArea.get(null));
        else for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith(this.prefix)) {
            try { values[key] = JSON.parse(localStorage.getItem(key)!); } catch { /* Ignore corrupt records. */ }
          }
        }
        this.values = { ...Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith(this.prefix))), ...this.pending };
        this.publish(null, true, true);
      } catch (error) { this.publish(errorMessage(error), false, true); }
      finally { this.pending = null; this.loading = null; }
    });
    return this.loading;
  };
  private userKey = (id: string) => `${this.prefix}user:${encodeURIComponent(id)}`;
  private conversationKey = (id: string) => `${this.prefix}conversation:${encodeURIComponent(id)}`;
  private write(key: string, value: unknown): Promise<void> {
    const operation = this.queue.catch(() => undefined).then(async () => {
      await this.loading;
      if (!this.snapshot.ready) throw new Error(this.snapshot.error || "Mention exclusions are not loaded");
      const revision = this.revisions.get(key) ?? 0;
      try {
        if (this.storageArea) await this.storageArea.set({ [key]: value });
        else localStorage.setItem(key, JSON.stringify(value));
        // Storage events may already contain a later write from another window.
        if ((this.revisions.get(key) ?? 0) === revision) this.values[key] = value;
        this.publish();
      } catch (error) { this.publish(errorMessage(error)); throw error; }
    });
    this.queue = operation;
    if (!this.listeners.size) this.scheduleCleanup();
    return operation;
  }
  excludeUser = (value: ExcludedMentionUser) => {
    const rule = user(value);
    return rule ? this.write(this.userKey(rule.id), rule) : Promise.reject(new Error("Invalid user exclusion"));
  };
  excludeConversation = (value: ExcludedMentionConversation) => {
    const rule = conversation(value);
    return rule ? this.write(this.conversationKey(rule.rootId), rule) : Promise.reject(new Error("Invalid conversation exclusion"));
  };
  restoreUser = (id: string) => this.write(this.userKey(id), null);
  restoreConversation = (rootId: string) => this.write(this.conversationKey(rootId), null);
}
export function getMentionExclusionStore(server: string, userId: string): MentionExclusionStore {
  const prefix = mentionExclusionPrefix(server, userId);
  let store = stores.get(prefix);
  if (!store) { store = new MentionExclusionStore(prefix); stores.set(prefix, store); }
  return store;
}
const noopSubscribe = () => () => {};
const getEmptySnapshot = () => emptySnapshot;
const unavailable = () => Promise.reject(new Error("An account is required for mention exclusions"));
export function useMentionExclusions(server: string, userId: string | null | undefined) {
  const store = useMemo(() => server && userId ? getMentionExclusionStore(server, userId) : null, [server, userId]);
  const snapshot = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? getEmptySnapshot);
  return { ...snapshot, excludeUser: store?.excludeUser ?? unavailable, excludeConversation: store?.excludeConversation ?? unavailable,
    restoreUser: store?.restoreUser ?? unavailable, restoreConversation: store?.restoreConversation ?? unavailable, retry: store?.retry ?? unavailable };
}

import type { MattermostUser } from "../mattermost/api";

export const MEMORY_METADATA_TTL_MS = 5 * 60_000;
export const MEMORY_DIRECTORY_MAX_ENTRIES = 2_000;

/** Bounded display metadata. Expiry requests a refresh without blanking labels. */
export class MetadataDirectoryStore<T extends { id: string }> {
  private values: Record<string, T> = {};
  private times = new Map<string, number>();
  private pending = new Map<string, Promise<void>>();
  private revisions = new Map<string, number>();
  private listeners = new Set<() => void>();
  constructor(private owner: string | null, private fetchEntries: (ids: string[]) => Promise<T[]>,
    private now = Date.now, private limit = MEMORY_DIRECTORY_MAX_ENTRIES) {}
  getSnapshot = () => this.values;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  put = (users: T[]) => {
    const next = { ...this.values };
    let changed = false;
    for (const user of users) {
      if (!user.id) continue;
      if (JSON.stringify(next[user.id]) !== JSON.stringify(user)) changed = true;
      next[user.id] = user;
      this.revisions.set(user.id, (this.revisions.get(user.id) ?? 0) + 1);
      this.times.delete(user.id);
      this.times.set(user.id, this.now());
    }
    for (const id of this.times.keys()) {
      if (this.times.size <= this.limit) break;
      if (id === this.owner) continue;
      this.times.delete(id); if (!this.pending.has(id)) this.revisions.delete(id); delete next[id]; changed = true;
    }
    if (changed) { this.values = next; this.listeners.forEach(listener => listener()); }
  };
  ensure = async (ids: string[]) => {
    const unique = [...new Set(ids.filter(Boolean))];
    const missing = unique.filter(id => !this.pending.has(id) &&
      (!this.values[id] || this.now() - (this.times.get(id) ?? 0) >= MEMORY_METADATA_TTL_MS));
    if (missing.length) {
      const revisions = new Map(missing.map(id => [id, this.revisions.get(id) ?? 0]));
      const request = Promise.resolve().then(() => this.fetchEntries(missing))
        .then(users => this.put(users.filter(user => (this.revisions.get(user.id) ?? 0) === revisions.get(user.id))))
        .catch(() => undefined);
      for (const id of missing) this.pending.set(id, request);
      void request.finally(() => { for (const id of missing) if (this.pending.get(id) === request) { this.pending.delete(id); if (!this.times.has(id)) this.revisions.delete(id); } });
    }
    await Promise.all(unique.map(id => this.pending.get(id)));
  };
}

export class UserDirectoryStore extends MetadataDirectoryStore<MattermostUser> {}

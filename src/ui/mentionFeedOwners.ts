import type { DeckColumn } from "./layout";

export function mentionFeedOwnerKey(server: string, user: string | null | undefined, team?: string): string {
  return JSON.stringify([server, user ?? null, team ?? null]);
}

// Pane order is presentation state. Keep the elected collector until it leaves
// its feed, so moving a pane never cancels or restarts collection.
export function reconcileMentionFeedOwners(previous: ReadonlyMap<string, string>, columns: readonly DeckColumn[], server: string, user: string | null | undefined): Map<string, string> {
  const candidates = new Map<string, string[]>();
  for (const column of columns) {
    if (column.type !== "mentions") continue;
    const key = mentionFeedOwnerKey(server, user, column.teamId);
    const ids = candidates.get(key) ?? [];
    ids.push(column.id);
    candidates.set(key, ids);
  }
  return new Map(Array.from(candidates, ([key, ids]) => {
    const owner = previous.get(key);
    return [key, owner && ids.includes(owner) ? owner : ids[0]];
  }));
}

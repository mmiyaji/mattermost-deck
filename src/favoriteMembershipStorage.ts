import { favoriteMembership, favoriteStorageKey, FAVORITES_LIMIT, readFavorites, type FavoriteMembership } from "./ui/favorites";
import { membershipWithUnmigratedLegacy } from "./ui/favoriteCache";

export const FAVORITE_MEMBERSHIP_MESSAGE = "mattermost-deck:favorite-membership";
export interface FavoriteMembershipRequest {
  scope: string;
  operation: "toggle" | "remove" | "strip-legacy";
  member?: FavoriteMembership;
  id?: string;
}
export interface FavoriteMembershipResponse {
  members: FavoriteMembership[];
  selected?: boolean;
}

const queues = new Map<string, Promise<unknown>>();

/** Worker-owned serializer shared by registration mutations and privacy cleanup. */
export async function withFavoriteMembershipLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const task = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
  queues.set(key, task);
  const release = () => { if (queues.get(key) === task) queues.delete(key); };
  void task.then(release, release);
  return task;
}

export function favoriteMembershipScope(scope: unknown): { serverScope: string; userId: string } {
  if (typeof scope !== "string" || scope.length > 8192) throw new Error("Invalid favorite membership scope");
  let parts: unknown;
  try { parts = JSON.parse(scope); } catch { throw new Error("Invalid favorite membership scope"); }
  if (!Array.isArray(parts) || parts.length !== 2 || JSON.stringify(parts) !== scope ||
      !parts.every(value => typeof value === "string" && value.length > 0)) throw new Error("Invalid favorite membership scope");
  const [serverScope, userId] = parts as [string, string];
  let url: URL;
  try { url = new URL(serverScope); } catch { throw new Error("Invalid favorite membership server"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || userId.length > 128) {
    throw new Error("Invalid favorite membership scope");
  }
  return { serverScope, userId };
}
function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9_-]{1,128}$/i.test(value);
}
function validMember(value: FavoriteMembership | undefined): value is FavoriteMembership {
  return !!value && validId(value.id) && typeof value.revision === "string" && value.revision.length > 0 && value.revision.length <= 128 &&
    Number.isSafeInteger(value.addedAt) && value.addedAt >= 0;
}

/** Background authorizes sender; this handler validates and serializes its data. */
export async function handleFavoriteMembershipRequest(message: FavoriteMembershipRequest): Promise<FavoriteMembershipResponse> {
  if (!message || !["toggle", "remove", "strip-legacy"].includes(message.operation)) throw new Error("Invalid favorite membership operation");
  const { serverScope, userId } = favoriteMembershipScope(message.scope);
  if (message.operation === "toggle" && !validMember(message.member)) throw new Error("Invalid favorite membership");
  if (message.operation === "remove" && !validId(message.id)) throw new Error("Invalid favorite membership ID");
  const key = favoriteStorageKey(serverScope, userId);
  return withFavoriteMembershipLock(key, async () => {
    const raw = (await chrome.storage.local.get(key))[key];
    let current = readFavorites(raw);
    let selected: boolean | undefined;
    if (message.operation === "toggle") {
      const member = message.member!;
      selected = !current.some(entry => entry.id === member.id);
      if (selected) {
        if (current.length >= FAVORITES_LIMIT) throw new Error("favorites-limit");
        current = [{ id: member.id, revision: member.revision, addedAt: member.addedAt, post: null, checkedAt: 0 }, ...current];
      } else current = current.filter(entry => entry.id !== member.id);
    } else if (message.operation === "remove") current = current.filter(entry => entry.id !== message.id);
    const members = favoriteMembership(current);
    // Only the migration caller requests strip-legacy after its body transaction
    // commits. Other mutations retain unrelated old bodies for a later retry.
    const value = message.operation === "strip-legacy" ? members : membershipWithUnmigratedLegacy(current, raw);
    if (JSON.stringify(raw) !== JSON.stringify(value)) await chrome.storage.local.set({ [key]: value });
    return { members, ...(selected === undefined ? {} : { selected }) };
  });
}

import {
  clearPersistedMentionCache,
  loadMentionCache,
  saveMentionCache,
  type MentionCacheContext,
} from "../../src/ui/mentionCache";
import type { MentionReadState } from "../../src/ui/mentionFeed";

const context: MentionCacheContext = {
  serverScope: "https://example.test/team/",
  userId: "user-a",
  scopeTeamId: null,
  teamIds: ["team-a"],
  mentionSignature: "signature-1",
};

const readState: MentionReadState = {
  channelLastViewedAt: {},
  threadLastViewedAt: {},
  activeChannelIds: null,
};

const post = (message: string) => ({
  id: "post1",
  user_id: "author",
  channel_id: "channel",
  create_at: 1,
  message,
});

(window as unknown as Record<string, unknown>).mentionCacheFixture = {
  save: (message: string, persist: boolean) =>
    saveMentionCache(context, [post(message)], readState, Date.now(), persist),
  load: async (persist: boolean, offsetMs = 0) => {
    const snapshot = await loadMentionCache(
      context,
      Date.now() + offsetMs,
      persist,
    );
    return snapshot?.posts.map((cached) => cached.message) ?? null;
  },
  clear: () => clearPersistedMentionCache(),
  storedKeys: async () => ({
    local: Object.keys(await chrome.storage.local.get(null)),
    session: Object.keys(await chrome.storage.session.get(null)),
  }),
};

const ready = document.createElement("output");
ready.textContent = "Ready";
document.body.append(ready);

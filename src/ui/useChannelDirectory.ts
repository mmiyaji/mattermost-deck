import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getChannelsByIds, getMattermostUrl, type MattermostChannel, type MattermostPost } from "../mattermost/api";
import { MetadataDirectoryStore } from "./memoryDirectory";

export function useChannelDirectory(posts: MattermostPost[], userId?: string | null) {
  const server = getMattermostUrl("/");
  const store = useMemo(() => new MetadataDirectoryStore<MattermostChannel>(null, getChannelsByIds), [server, userId]);
  const directory = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => { void store.ensure(posts.map(post => post.channel_id)); }, [store, posts]);
  return directory;
}

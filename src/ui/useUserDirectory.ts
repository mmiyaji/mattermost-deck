import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getUsersByIds, type MattermostUser } from "../mattermost/api";
import { UserDirectoryStore } from "./memoryDirectory";

/** A new scope/metadata generation owns a new store; old requests cannot publish into it. */
export function useUserDirectory(server: string, user: MattermostUser | null, metadataGeneration: number) {
  const store = useMemo(() => new UserDirectoryStore(user?.id ?? null, getUsersByIds), [server, user?.id, metadataGeneration]);
  useEffect(() => { if (user) store.put([user]); }, [store, user]);
  const directory = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { directory, ensureUsers: store.ensure, updateUsers: store.put };
}

import type {
  MattermostUserThread,
  MattermostUserThreads,
} from "../mattermost/api";

export async function collectUnreadMentionThreads(
  firstPage: MattermostUserThreads,
  loadPageBefore: (before: string) => Promise<MattermostUserThreads>,
  {
    perPage,
    maxMentionThreads,
    shouldCancel = () => false,
  }: {
    perPage: number;
    maxMentionThreads: number;
    shouldCancel?: () => boolean;
  },
): Promise<MattermostUserThread[]> {
  const mentionThreads = new Map<string, MattermostUserThread>();
  const seenThreadIds = new Set<string>();
  const safePerPage = Math.max(1, Math.floor(perPage));
  const safeMaxMentionThreads = Math.max(
    0,
    Math.floor(maxMentionThreads),
  );

  const collectPage = (threads: MattermostUserThread[]) => {
    for (const thread of threads) {
      seenThreadIds.add(thread.id);
      if (
        (thread.unread_replies ?? 0) > 0 &&
        (thread.unread_mentions ?? 0) > 0
      ) {
        mentionThreads.set(thread.id, thread);
        if (mentionThreads.size >= safeMaxMentionThreads) {
          break;
        }
      }
    }
  };

  if (safeMaxMentionThreads === 0 || shouldCancel()) {
    return [];
  }

  let page = firstPage;
  collectPage(page.threads);
  while (
    mentionThreads.size < safeMaxMentionThreads &&
    page.threads.length === safePerPage &&
    !shouldCancel()
  ) {
    const before = page.threads.at(-1)?.id;
    if (!before) {
      break;
    }
    const previousSeenCount = seenThreadIds.size;
    page = await loadPageBefore(before);
    if (shouldCancel()) {
      break;
    }
    collectPage(page.threads);
    if (seenThreadIds.size === previousSeenCount) {
      break;
    }
  }

  return Array.from(mentionThreads.values());
}

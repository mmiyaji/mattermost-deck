export interface RecentChannelTarget {
  type: "channelWatch" | "dmWatch";
  teamId: string;
  teamLabel: string;
  channelId: string;
  channelLabel: string;
}

const MAX_RECENT_TARGETS = 6;

export function getRecentTargetKey(target: Pick<RecentChannelTarget, "channelId">): string {
  return target.channelId;
}

export function dedupeRecentTargets(targets: RecentChannelTarget[]): RecentChannelTarget[] {
  const seen = new Set<string>();
  const next: RecentChannelTarget[] = [];

  for (const target of targets) {
    const key = getRecentTargetKey(target);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(target);
    if (next.length >= MAX_RECENT_TARGETS) {
      break;
    }
  }

  return next;
}

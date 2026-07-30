const SPECIAL_MENTION_PATTERN = /(^|[^a-z0-9._-])@(all|here|channel)(?![a-z0-9._-])/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createUserMentionPattern(username: string | null): RegExp | null {
  if (!username) {
    return null;
  }

  return new RegExp(`(^|[^a-z0-9._-])@${escapeRegExp(username)}(?![a-z0-9._-])`, "i");
}

export function hasSpecialMattermostMention(message: string): boolean {
  return SPECIAL_MENTION_PATTERN.test(message);
}

export interface MattermostMentionOptions {
  specialMentionsEnabled?: boolean;
}

export function hasMattermostMention(
  message: string,
  username: string | null,
  options: MattermostMentionOptions = {},
): boolean {
  const userMentionPattern = createUserMentionPattern(username);
  const specialMentionsEnabled = options.specialMentionsEnabled ?? true;
  return (
    (userMentionPattern?.test(message) ?? false) ||
    (specialMentionsEnabled && hasSpecialMattermostMention(message))
  );
}

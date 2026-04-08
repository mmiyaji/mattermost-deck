export const LONG_TOKEN_DISPLAY_LIMIT = 48;

const NON_URL_TOKEN_PATTERN = /(\s+)|([^\s]+)/gi;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION_PATTERN = /[).,!?;:。、，！？」』）】]+$/u;

export interface PostTextToken {
  type: "text" | "url";
  raw: string;
  display: string;
  href?: string;
}

export function truncateDisplayToken(value: string, limit = LONG_TOKEN_DISPLAY_LIMIT): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(1, limit - 3))}...`;
}

export function extractHighlightKeywords(value: string): string[] {
  return value
    .split(/[\s,、;；\r\n\t]+/u)
    .map((term) => term.trim())
    .filter(Boolean);
}

function tokenizeNonUrlText(value: string): PostTextToken[] {
  const tokens: PostTextToken[] = [];
  let tokenMatch: RegExpExecArray | null;

  while ((tokenMatch = NON_URL_TOKEN_PATTERN.exec(value)) !== null) {
    const [token] = tokenMatch;
    if (!token) {
      continue;
    }

    tokens.push({
      type: "text",
      raw: token,
      display: tokenMatch[2] ? truncateDisplayToken(token) : token,
    });
  }

  NON_URL_TOKEN_PATTERN.lastIndex = 0;
  return tokens;
}

function splitUrlCandidate(value: string): { url: string; trailing: string } {
  const trimmedUrl = value.replace(TRAILING_PUNCTUATION_PATTERN, "");
  return {
    url: trimmedUrl,
    trailing: value.slice(trimmedUrl.length),
  };
}

export function tokenizePostText(text: string): PostTextToken[] {
  const tokens: PostTextToken[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = URL_PATTERN.exec(text)) !== null) {
    const rawMatch = match[0];
    const matchIndex = match.index;

    if (matchIndex > cursor) {
      tokens.push(...tokenizeNonUrlText(text.slice(cursor, matchIndex)));
    }

    const { url, trailing } = splitUrlCandidate(rawMatch);
    if (url.length > 0) {
      tokens.push({
        type: "url",
        raw: url,
        display: truncateDisplayToken(url),
        href: url,
      });
    }

    if (trailing) {
      tokens.push(...tokenizeNonUrlText(trailing));
    }

    cursor = matchIndex + rawMatch.length;
  }

  if (cursor < text.length) {
    tokens.push(...tokenizeNonUrlText(text.slice(cursor)));
  }

  URL_PATTERN.lastIndex = 0;
  return tokens;
}

import { emojify } from "node-emoji";

/** Mattermost shortcodes that node-emoji does not know under the same name. */
const MATTERMOST_ALIASES: Readonly<Record<string, string>> = {
  thumbsup: "👍",
  thumbsdown: "👎",
  simple_smile: "🙂",
  slightly_smiling_face: "🙂",
  upside_down_face: "🙃",
  "100": "💯",
};

const SHORTCODE_SOURCE = ":([a-z0-9_+-]+):";

/**
 * Replaces known `:shortcode:` names with Unicode emoji. Unknown names,
 * including workspace custom emoji, are left untouched.
 */
export function replaceEmojiShortcodes(text: string): string {
  if (!text.includes(":")) return text;
  const withAliases = text.replace(new RegExp(SHORTCODE_SOURCE, "gi"), (match, name: string) => MATTERMOST_ALIASES[name.toLowerCase()] ?? match);
  return emojify(withAliases, { fallback: (name: string) => `:${name}:` });
}

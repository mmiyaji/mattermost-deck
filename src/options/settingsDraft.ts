import type { DeckSettings } from "../ui/settings";

/** Compare values, not object identity or property insertion order. */
export function hasSettingsChanges(draft: DeckSettings, saved: DeckSettings): boolean {
  return (Object.keys(saved) as (keyof DeckSettings)[]).some((key) => {
    if (key === "columnColors") {
      return (Object.keys(saved.columnColors) as (keyof DeckSettings["columnColors"])[])
        .some((color) => draft.columnColors[color] !== saved.columnColors[color]);
    }
    return draft[key] !== saved[key];
  });
}

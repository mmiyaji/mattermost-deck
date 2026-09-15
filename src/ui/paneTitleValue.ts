export const MAX_PANE_TITLE_LENGTH = 100;
export function normalisePaneTitle(value: unknown): string | undefined {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_PANE_TITLE_LENGTH) || undefined : undefined;
}

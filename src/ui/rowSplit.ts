export const DEFAULT_ROW_SPLIT = 50;
export const MIN_ROW_SPLIT = 20;
export const MAX_ROW_SPLIT = 80;

export function normaliseRowSplit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(MIN_ROW_SPLIT, Math.min(MAX_ROW_SPLIT, Math.round(value)))
    : DEFAULT_ROW_SPLIT;
}

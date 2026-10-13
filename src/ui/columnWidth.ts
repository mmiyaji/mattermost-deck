export const MIN_PREFERRED_COLUMN_WIDTH = 200;
export const MAX_PREFERRED_COLUMN_WIDTH = 800;
export const DEFAULT_PREFERRED_COLUMN_WIDTH = 320;

export function normalisePreferredColumnWidth(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value ?? DEFAULT_PREFERRED_COLUMN_WIDTH);
  if (!Number.isFinite(parsed)) return DEFAULT_PREFERRED_COLUMN_WIDTH;
  return Math.min(MAX_PREFERRED_COLUMN_WIDTH, Math.max(MIN_PREFERRED_COLUMN_WIDTH, Math.round(parsed)));
}

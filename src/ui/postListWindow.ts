/** Seed the newest viewport before observer callbacks, without mounting the whole feed. */
export function isInitialPostWindow(index: number, total: number, compact: boolean, height: number, reversed: boolean): boolean {
  const viewportHeight = Number.isFinite(height) && height > 0 ? height : 720;
  const budget = Math.min(compact ? 80 : 24, Math.max(4, Math.ceil((viewportHeight + 320) / (compact ? 34 : 120)) + 2));
  return reversed ? index >= Math.max(0, total - budget) : index < budget;
}

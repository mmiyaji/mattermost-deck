export async function waitMs(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

/**
 * `gapMs` is a delay added after each batch. Pass `pacing: "interval"` to make it
 * a minimum spacing between batch starts instead: a batch that already took that
 * long has paced itself, so the next one starts without a further wait.
 */
export type BatchPacing = "delay" | "interval";

export async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  mapper: (item: T, index: number) => Promise<R>,
  gapMs = 0,
  shouldCancel?: () => boolean,
  pacing: BatchPacing = "delay",
): Promise<R[]> {
  const normalizedBatchSize = Math.max(1, Math.floor(batchSize));
  const results: R[] = [];

  for (let offset = 0; offset < items.length; offset += normalizedBatchSize) {
    if (shouldCancel?.()) {
      break;
    }

    const batchStartedAt = pacing === "interval" ? Date.now() : 0;
    const batch = items.slice(offset, offset + normalizedBatchSize);
    const mapped = await Promise.all(batch.map((item, index) => mapper(item, offset + index)));
    results.push(...mapped);

    if (offset + normalizedBatchSize < items.length) {
      if (shouldCancel?.()) {
        break;
      }
      const elapsedMs = pacing === "interval" ? Date.now() - batchStartedAt : 0;
      await waitMs(gapMs - elapsedMs);
    }
  }

  return results;
}

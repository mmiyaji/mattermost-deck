export async function waitMs(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

export async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  mapper: (item: T, index: number) => Promise<R>,
  gapMs = 0,
  shouldCancel?: () => boolean,
): Promise<R[]> {
  const normalizedBatchSize = Math.max(1, Math.floor(batchSize));
  const results: R[] = [];

  for (let offset = 0; offset < items.length; offset += normalizedBatchSize) {
    if (shouldCancel?.()) {
      break;
    }

    const batch = items.slice(offset, offset + normalizedBatchSize);
    const mapped = await Promise.all(batch.map((item, index) => mapper(item, offset + index)));
    results.push(...mapped);

    if (offset + normalizedBatchSize < items.length) {
      if (shouldCancel?.()) {
        break;
      }
      await waitMs(gapMs);
    }
  }

  return results;
}

/** Poll only while the document is visible, without overlapping async work. */
export function startVisiblePolling(
  run: () => void | Promise<void>,
  intervalMs: number,
  { refreshOnOnline = false }: { refreshOnOnline?: boolean } = {},
): () => void {
  let disposed = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const execute = async () => {
    if (disposed || running || document.hidden) return;
    clear();
    running = true;
    try {
      await run();
    } catch {
      // Callers own error reporting. A failed poll must not stop future polls.
    } finally {
      running = false;
      if (!disposed && !document.hidden) timer = setTimeout(() => { void execute(); }, intervalMs);
    }
  };
  const resume = () => {
    clear();
    if (!document.hidden) void execute();
  };
  document.addEventListener("visibilitychange", resume);
  if (refreshOnOnline) window.addEventListener("online", resume);
  void execute();
  return () => {
    disposed = true;
    clear();
    document.removeEventListener("visibilitychange", resume);
    if (refreshOnOnline) window.removeEventListener("online", resume);
  };
}

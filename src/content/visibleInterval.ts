/** Runs a lightweight synchronous fallback only while the page is visible. */
export function startVisibleInterval(run: () => void, intervalMs: number): () => void {
  let disposed = false;
  let timer: number | null = null;

  const stop = () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
  const start = (reconcile: boolean) => {
    if (disposed || document.hidden || timer !== null) return;
    timer = window.setInterval(run, intervalMs);
    if (reconcile) run();
  };
  const handleVisibility = () => {
    if (document.hidden) {
      stop();
    } else {
      start(true);
    }
  };

  document.addEventListener("visibilitychange", handleVisibility);
  start(false);

  return () => {
    disposed = true;
    stop();
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}

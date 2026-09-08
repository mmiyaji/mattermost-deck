type Listener = (visible: boolean) => void;
interface TargetSubscription {
  listeners: Set<Listener>;
  visible?: boolean;
}
interface ObserverPool {
  observer: IntersectionObserver;
  targets: Map<Element, TargetSubscription>;
}

const rootedPools = new WeakMap<Element, Map<string, ObserverPool>>();
const viewportPools = new Map<string, ObserverPool>();

// Share one native observer per root/options, and release it (and its targets)
// as soon as the final subscription is removed. No detached DOM is retained.
export function observeElementVisibility(
  element: Element,
  listener: Listener,
  options: { root?: Element | null; rootMargin?: string; threshold?: number } = {},
): () => void {
  const root = options.root ?? null;
  const rootMargin = options.rootMargin ?? "0px";
  const threshold = options.threshold ?? 0;
  let pools = root ? rootedPools.get(root) : viewportPools;
  if (!pools) {
    pools = new Map();
    rootedPools.set(root!, pools);
  }
  const key = JSON.stringify([rootMargin, threshold]);
  let pool = pools.get(key);
  if (!pool) {
    const targets = new Map<Element, TargetSubscription>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const subscription = targets.get(entry.target);
        if (!subscription) continue;
        subscription.visible = entry.isIntersecting;
        for (const notify of subscription.listeners) notify(entry.isIntersecting);
      }
    }, { root, rootMargin, threshold });
    pool = { observer, targets };
    pools.set(key, pool);
  }
  let subscription = pool.targets.get(element);
  if (!subscription) {
    subscription = { listeners: new Set() };
    pool.targets.set(element, subscription);
    pool.observer.observe(element);
  }
  // Wrap the callback so independent subscriptions can use the same listener.
  const notify: Listener = visible => listener(visible);
  subscription.listeners.add(notify);
  if (subscription.visible !== undefined) listener(subscription.visible);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    subscription.listeners.delete(notify);
    if (subscription.listeners.size > 0) return;
    pool.targets.delete(element);
    pool.observer.unobserve(element);
    if (pool.targets.size === 0) {
      pool.observer.disconnect();
      pools.delete(key);
      if (root && pools.size === 0) rootedPools.delete(root);
    }
  };
}

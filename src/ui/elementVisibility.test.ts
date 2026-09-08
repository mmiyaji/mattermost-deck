import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeElementVisibility } from "./elementVisibility";

class Observer {
  static instances: Observer[] = [];
  targets = new Set<Element>();
  observe = vi.fn((target: Element) => { this.targets.add(target); });
  unobserve = vi.fn((target: Element) => { this.targets.delete(target); });
  disconnect = vi.fn(() => this.targets.clear());
  constructor(public callback: IntersectionObserverCallback, public options: IntersectionObserverInit) {
    Observer.instances.push(this);
  }
  emit(...entries: { target: Element; isIntersecting: boolean }[]) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}
const element = () => ({}) as Element;

describe("shared visibility observers", () => {
  const cleanup: (() => void)[] = [];
  beforeEach(() => { Observer.instances = []; vi.stubGlobal("IntersectionObserver", Observer); });
  afterEach(() => { cleanup.splice(0).forEach(stop => stop()); vi.unstubAllGlobals(); });
  const watch: typeof observeElementVisibility = (...args) => {
    const stop = observeElementVisibility(...args); cleanup.push(stop); return stop;
  };

  it("shares only matching roots/options and delivers every entry in a batch", () => {
    const root = element(), first = element(), second = element();
    const one = vi.fn(), two = vi.fn();
    watch(first, one, {root, rootMargin: "320px 0px"});
    watch(second, two, {root, rootMargin: "320px 0px"});
    expect(Observer.instances).toHaveLength(1);
    Observer.instances[0].emit({target: first, isIntersecting: true}, {target: second, isIntersecting: false});
    expect(one).toHaveBeenLastCalledWith(true);
    expect(two).toHaveBeenLastCalledWith(false);
    watch(element(), vi.fn(), {root, rootMargin: "240px 0px"});
    watch(element(), vi.fn(), {root: element(), rootMargin: "320px 0px"});
    watch(element(), vi.fn(), {root, rootMargin: "320px 0px", threshold: 0.5});
    expect(Observer.instances).toHaveLength(4);
  });

  it("keeps independent subscriptions to one node and replays its last visibility", () => {
    const node = element();
    const listener = vi.fn();
    const first = watch(node, listener);
    const observer = Observer.instances[0];
    observer.emit({target: node, isIntersecting: false});
    const second = watch(node, listener);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(false);
    expect(observer.observe).toHaveBeenCalledOnce();
    first(); first();
    observer.emit({target: node, isIntersecting: true});
    expect(listener).toHaveBeenCalledTimes(3);
    expect(observer.unobserve).not.toHaveBeenCalled();
    second();
    expect(observer.unobserve).toHaveBeenCalledOnce();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    observer.emit({target: node, isIntersecting: false});
    expect(listener).toHaveBeenCalledTimes(3);
    watch(node, listener);
    expect(Observer.instances).toHaveLength(2);
  });

  it("releases every target across 500 mount/unmount cycles", () => {
    const root = element();
    const notify = vi.fn();
    for (let cycle = 0; cycle < 500; cycle++) {
      const stops = Array.from({length: 100}, () => observeElementVisibility(element(), notify, {root}));
      const observer = Observer.instances.at(-1)!;
      expect(observer.targets.size).toBe(100);
      expect(Observer.instances).toHaveLength(cycle + 1);
      stops.forEach(stop => stop());
      expect(observer.targets.size).toBe(0);
      expect(observer.disconnect).toHaveBeenCalledOnce();
    }
    expect(Observer.instances.every(observer => observer.targets.size === 0)).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import { RequestQueue, type QueueSlotLike, type RequestPriority } from "./requestQueue";

type Slot = QueueSlotLike & { id: number };
const priorities: RequestPriority[] = ["interactive", "normal", "background"];
const slot = (id: number, priority: RequestPriority = "normal", method: "GET" | "POST" = "GET", key?: string): Slot =>
  ({ id, priority, method, key, queuedAt: id * 10, deadline: id * 10 + 1000, generation: 1 });
const fifoHeads = (queue: RequestQueue<Slot>) => queue.heads().sort((a, b) => queue.sequence(a) - queue.sequence(b));

describe("RequestQueue", () => {
  it("keeps one FIFO head per method and priority without mutating arrival metadata", () => {
    const queue = new RequestQueue<Slot>();
    const entries = priorities.flatMap((priority, index) => [slot(index * 2, priority), slot(index * 2 + 1, priority, "POST")]);
    for (const entry of [...entries, slot(10, "normal"), slot(11, "normal", "POST")]) queue.enqueue(entry);
    expect(fifoHeads(queue)).toEqual(entries);
    expect(queue.heads()).toHaveLength(6);
    expect(queue.size).toBe(8);
    expect(queue.counts()).toBe(8);
    expect(queue.counts("GET")).toBe(4);
    expect(queue.counts("POST")).toBe(4);
    expect(queue.oldestQueuedAt).toBe(0);
    const frozen = Object.freeze(slot(20));
    const fields = Object.keys(frozen);
    queue.enqueue(frozen);
    expect(Object.keys(frozen)).toEqual(fields);
    expect(queue.remove(frozen)).toBe(true);
  });

  it("promotes keyed requests ahead of newer lane peers while preserving original FIFO", () => {
    const queue = new RequestQueue<Slot>();
    const backgroundGet = slot(0, "background", "GET", "shared");
    const backgroundPost = slot(1, "background", "POST", "shared");
    const normal = slot(2, "normal", "GET", "shared");
    const interactive = slot(3, "interactive", "GET", "shared");
    const unrelated = slot(4, "background", "GET", "other");
    [backgroundGet, backgroundPost, normal, interactive, unrelated].forEach(entry => queue.enqueue(entry));
    const sequence = queue.sequence(backgroundGet);
    queue.promote("shared", "interactive");
    expect(fifoHeads(queue)).toEqual([backgroundGet, backgroundPost, unrelated]);
    expect(queue.sequence(backgroundGet)).toBe(sequence);
    expect(backgroundGet.priority).toBe("interactive");
    expect(backgroundPost.priority).toBe("interactive");
    expect(unrelated.priority).toBe("background");
    queue.promote("shared", "normal");
    expect(interactive.priority).toBe("interactive");
    queue.remove(backgroundGet);
    expect(queue.heads()).toContain(normal);
  });

  it("cancels middle heap nodes and releases their object and key indices", () => {
    const queue = new RequestQueue<Slot>();
    const entries = Array.from({ length: 31 }, (_, index) => slot(index, "background", "GET", "shared"));
    entries.forEach(entry => queue.enqueue(entry));
    const cancelled = [entries[15], entries[7], entries[30], entries[0], entries[19]];
    cancelled.forEach(entry => {
      expect(queue.remove(entry)).toBe(true);
      expect(queue.remove(entry)).toBe(false);
      expect(() => queue.sequence(entry)).toThrow(RangeError);
    });
    queue.promote("shared", "interactive");
    expect(cancelled.every(entry => entry.priority === "background")).toBe(true);
    const remaining = entries.filter(entry => !cancelled.includes(entry));
    for (const expected of remaining) {
      expect(queue.heads()).toEqual([expected]);
      queue.remove(expected);
    }
    expect(queue.size).toBe(0);
    expect(queue.heads()).toEqual([]);
    expect([...queue.values()]).toEqual([]);
    expect(queue.oldestQueuedAt).toBeUndefined();
    queue.promote("shared", "interactive");
    expect(cancelled.every(entry => entry.priority === "background")).toBe(true);
  });

  it("assigns a fresh sequence to a re-enqueued object and rejects duplicate enqueue", () => {
    const queue = new RequestQueue<Slot>(), first = slot(0), second = slot(1);
    queue.enqueue(first);
    const original = queue.sequence(first);
    expect(() => queue.enqueue(first)).toThrow("already queued");
    queue.remove(first);
    queue.enqueue(second); queue.enqueue(first);
    expect(queue.sequence(first)).toBeGreaterThan(original);
    expect(queue.sequence(first)).toBeGreaterThan(queue.sequence(second));
    expect(queue.heads()).toEqual([second]);
    expect([...queue.values()]).toEqual([second, first]);
  });

  it("leaves deadline and generation policy to the scheduler", () => {
    const queue = new RequestQueue<Slot>();
    const expired = { ...slot(0), deadline: -1, generation: -1 };
    queue.enqueue(expired);
    expect(queue.heads()).toEqual([expired]);
    expect(expired.deadline).toBe(-1);
    expect(expired.generation).toBe(-1);
  });

  it("matches a deterministic model across interleaved promotion and cancellation", () => {
    const queue = new RequestQueue<Slot>();
    const model = new Map<Slot, { sequence: number; priority: RequestPriority }>();
    const all: Slot[] = [];
    let random = 0x83f1502, nextSequence = 0;
    const choose = (bound: number) => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % bound; };
    const verify = () => {
      const expected = new Map<string, Slot>();
      for (const [entry, metadata] of model) {
        const lane = `${metadata.priority}/${entry.method}`;
        if (!expected.has(lane)) expected.set(lane, entry);
      }
      expect(fifoHeads(queue)).toEqual([...expected.values()].sort((a, b) => model.get(a)!.sequence - model.get(b)!.sequence));
      expect([...queue.values()]).toEqual([...model.keys()]);
      expect(queue.size).toBe(model.size);
      expect(queue.counts("GET")).toBe([...model.keys()].filter(entry => entry.method === "GET").length);
      expect(queue.counts("POST")).toBe([...model.keys()].filter(entry => entry.method === "POST").length);
      expect(queue.oldestQueuedAt).toBe(model.size ? Math.min(...[...expected.values()].map(entry => entry.queuedAt)) : undefined);
    };
    for (let index = 0; index < 5000; index++) {
      const action = choose(10);
      if (action < 5 || !all.length) {
        const entry = slot(all.length, priorities[choose(3)], choose(2) ? "GET" : "POST", `key-${choose(23)}`);
        all.push(entry); model.set(entry, { sequence: nextSequence++, priority: entry.priority }); queue.enqueue(entry);
      } else if (action < 8) {
        const entry = all[choose(all.length)];
        expect(queue.remove(entry)).toBe(model.delete(entry));
      } else {
        const key = `key-${choose(23)}`, priority = priorities[choose(3)];
        queue.promote(key, priority);
        for (const [entry, metadata] of model) if (entry.key === key && priorities.indexOf(priority) < priorities.indexOf(metadata.priority)) metadata.priority = priority;
      }
      if (index % 25 === 0) verify();
    }
    verify();
    while (queue.size) {
      const first = fifoHeads(queue)[0];
      queue.remove(first); model.delete(first);
    }
    verify();
  });

  it("does not walk a large queue for heads, counts, oldest time, cancellation or one keyed promotion", () => {
    let visits = 0;
    const NativeMap = Map;
    const counted = <T>(iterator: IterableIterator<T>) => (function* () {
      for (const value of iterator) { visits++; yield value; }
    })();
    class CountingMap<K, V> extends NativeMap<K, V> {
      override values() { return counted(super.values()) as MapIterator<V>; }
      override keys() { return counted(super.keys()) as MapIterator<K>; }
      override entries() { return counted(super.entries()) as MapIterator<[K, V]>; }
      override [Symbol.iterator]() { return this.entries(); }
    }
    vi.stubGlobal("Map", CountingMap);
    let reads = 0;
    try {
      const queue = new RequestQueue<Slot>();
      const entries = Array.from({ length: 20_000 }, (_, index) => {
        const entry = slot(index, "background", index % 2 ? "GET" : "POST", `key-${index}`);
        for (const property of ["key", "method", "queuedAt"] as const) {
          const value = entry[property];
          Object.defineProperty(entry, property, { get: () => { reads++; return value; } });
        }
        return entry;
      });
      entries.forEach(entry => queue.enqueue(entry));
      visits = 0; reads = 0;
      queue.heads(); queue.counts(); queue.counts("GET"); queue.counts("POST");
      void queue.oldestQueuedAt;
      queue.remove(entries[10_000]);
      queue.promote("key-19000", "interactive");
      const measured = { visits, reads };
      vi.unstubAllGlobals();
      expect(measured.visits).toBeLessThan(100);
      expect(measured.reads).toBeLessThan(100);
      expect(queue.heads()).toContain(entries[19_000]);
      expect(queue.size).toBe(19_999);
    } finally { vi.unstubAllGlobals(); }
  });
});

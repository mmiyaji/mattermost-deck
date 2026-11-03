export type RequestPriority = "interactive" | "normal" | "background";

export interface QueueSlotLike {
  method: "GET" | "POST";
  priority: RequestPriority;
  key?: string;
  queuedAt: number;
  deadline: number;
  generation: number;
}

interface QueueNode<T> {
  slot: T;
  sequence: number;
  lane: number;
  index: number;
  key: string | undefined;
}

const PRIORITY_RANK: Record<RequestPriority, number> = { interactive: 0, normal: 1, background: 2 };

/** Six FIFO heaps make readiness selection independent of total queue depth.
 * Only promotion changes a slot's priority; arrival order lives in private nodes.
 */
export class RequestQueue<T extends QueueSlotLike> {
  private readonly lanes: Array<Array<QueueNode<T>>> = Array.from({ length: 6 }, () => []);
  private readonly nodes = new Map<T, QueueNode<T>>();
  private readonly keyed = new Map<string, Set<QueueNode<T>>>();
  private nextSequence = 0;

  get size(): number { return this.nodes.size; }

  enqueue(slot: T): void {
    if (this.nodes.has(slot)) throw new Error("Request is already queued");
    const node: QueueNode<T> = { slot, sequence: this.nextSequence++, index: -1,
      lane: PRIORITY_RANK[slot.priority] * 2 + (slot.method === "POST" ? 1 : 0), key: slot.key };
    this.nodes.set(slot, node);
    if (node.key !== undefined) {
      let entries = this.keyed.get(node.key);
      if (!entries) this.keyed.set(node.key, entries = new Set());
      entries.add(node);
    }
    this.insert(node);
  }

  remove(slot: T): boolean {
    const node = this.nodes.get(slot);
    if (!node) return false;
    this.detach(node);
    this.nodes.delete(slot);
    if (node.key !== undefined) {
      const entries = this.keyed.get(node.key)!;
      entries.delete(node);
      if (!entries.size) this.keyed.delete(node.key);
    }
    return true;
  }

  /** At most one original-arrival head for each priority/method combination. */
  heads(): T[] {
    const heads: T[] = [];
    for (const lane of this.lanes) if (lane.length) heads.push(lane[0].slot);
    return heads;
  }

  /** Promote keyed consumers without scanning unrelated requests or losing FIFO. */
  promote(key: string, priority: RequestPriority): void {
    const entries = this.keyed.get(key);
    if (!entries) return;
    const rank = PRIORITY_RANK[priority];
    for (const node of entries) {
      if (rank >= Math.floor(node.lane / 2)) continue;
      const methodLane = node.lane % 2;
      this.detach(node);
      node.lane = rank * 2 + methodLane;
      node.slot.priority = priority;
      this.insert(node);
    }
  }

  /** Metrics only: dispatch should inspect heads instead of traversing values. */
  values(): IterableIterator<T> { return this.nodes.keys(); }

  counts(method?: "GET" | "POST"): number {
    if (method === undefined) return this.size;
    const offset = method === "POST" ? 1 : 0;
    return this.lanes[offset].length + this.lanes[offset + 2].length + this.lanes[offset + 4].length;
  }

  get oldestQueuedAt(): number | undefined {
    let oldest: number | undefined;
    for (const lane of this.lanes) if (lane.length) {
      const queuedAt = lane[0].slot.queuedAt;
      if (oldest === undefined || queuedAt < oldest) oldest = queuedAt;
    }
    return oldest;
  }

  /** Compare heads before removing them; removed nodes retain no queue indices. */
  sequence(slot: T): number {
    const node = this.nodes.get(slot);
    if (!node) throw new RangeError("Request is not queued");
    return node.sequence;
  }

  private insert(node: QueueNode<T>): void {
    const lane = this.lanes[node.lane];
    node.index = lane.length;
    lane.push(node);
    this.siftUp(lane, node.index);
  }

  private detach(node: QueueNode<T>): void {
    const lane = this.lanes[node.lane], index = node.index, last = lane.pop()!;
    node.index = -1;
    if (last === node) return;
    lane[index] = last;
    last.index = index;
    if (index > 0 && last.sequence < lane[(index - 1) >>> 1].sequence) this.siftUp(lane, index);
    else this.siftDown(lane, index);
  }

  private siftUp(lane: Array<QueueNode<T>>, initial: number): void {
    let index = initial;
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (lane[parent].sequence <= lane[index].sequence) break;
      this.swap(lane, index, parent);
      index = parent;
    }
  }

  private siftDown(lane: Array<QueueNode<T>>, initial: number): void {
    let index = initial;
    while (index * 2 + 1 < lane.length) {
      let child = index * 2 + 1;
      if (child + 1 < lane.length && lane[child + 1].sequence < lane[child].sequence) child++;
      if (lane[index].sequence <= lane[child].sequence) break;
      this.swap(lane, index, child);
      index = child;
    }
  }

  private swap(lane: Array<QueueNode<T>>, first: number, second: number): void {
    const temporary = lane[first];
    lane[first] = lane[second]; lane[second] = temporary;
    lane[first].index = first; lane[second].index = second;
  }
}

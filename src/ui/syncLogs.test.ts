import { describe, expect, it } from "vitest";
import { createSyncLogStore, type SyncLogEntry } from "./syncLogs";

function emit(target: EventTarget, index: number, source = "api") {
  target.dispatchEvent(new CustomEvent<SyncLogEntry>(`mattermost-deck-${source}-log`, {
    detail: { level: "info", message: `log-${index}`, timestamp: index },
  }));
}

describe("sync log store", () => {
  it("retains the latest 20 entries without an open diagnostics pane", () => {
    const store = createSyncLogStore();
    const target = new EventTarget();
    const disconnect = store.connect(target);
    for (let index = 0; index < 25; index++) emit(target, index);
    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(20);
    expect(snapshot[0].message).toBe("log-24");
    expect(snapshot[19].message).toBe("log-5");
    expect(store.getSnapshot()).toBe(snapshot);
    emit(target, 25, "ws");
    expect(store.getSnapshot()).not.toBe(snapshot);
    expect(snapshot[0].message).toBe("log-24");
    disconnect();
  });

  it("notifies all mounted subscribers and supports individual unsubscribe", () => {
    const store = createSyncLogStore();
    const target = new EventTarget();
    const disconnect = store.connect(target);
    const received: string[] = [];
    const first = store.subscribe(() => received.push(`first:${store.getSnapshot()[0].message}`));
    const second = store.subscribe(() => received.push(`second:${store.getSnapshot()[0].message}`));
    emit(target, 1);
    first();
    emit(target, 2, "ws");
    second();
    emit(target, 3);
    expect(received).toEqual(["first:log-1", "second:log-1", "second:log-2"]);
    expect(store.getSnapshot()[0].message).toBe("log-3");
    disconnect();
  });

  it("disconnects on unmount and can reconnect without duplicated entries", () => {
    const store = createSyncLogStore();
    const target = new EventTarget();
    const disconnect = store.connect(target);
    emit(target, 1);
    disconnect();
    const snapshot = store.getSnapshot();
    emit(target, 2);
    emit(target, 3, "ws");
    expect(store.getSnapshot()).toBe(snapshot);
    const disconnectAgain = store.connect(target);
    emit(target, 4);
    expect(store.getSnapshot().map(entry => entry.message)).toEqual(["log-4", "log-1"]);
    disconnectAgain();
    expect(createSyncLogStore().getSnapshot()).toEqual([]);
  });
});

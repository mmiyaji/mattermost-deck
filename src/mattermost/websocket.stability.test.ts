import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../traceLog", () => ({ addTraceEntry: vi.fn() }));

class Socket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = Socket.CONNECTING;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = Socket.CLOSING; });
  constructor(_url: string) { super(); Socket.instances.push(this); }
  open() { this.readyState = Socket.OPEN; this.dispatchEvent(new Event("open")); }
  message(payload: unknown) {
    this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(payload) }));
  }
  authenticate() { this.open(); this.message({event: "hello", broadcast: {user_id: "user"}}); }
}

describe("WebSocket long-running recovery", () => {
  let target: EventTarget;
  let doc: EventTarget;
  let dispose: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    Socket.instances = [];
    target = new EventTarget();
    doc = new EventTarget();
    vi.stubGlobal("window", Object.assign(target, {
      location: { origin: "https://example.test" },
      setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    }));
    vi.stubGlobal("document", Object.assign(doc, {hidden: false}));
    vi.stubGlobal("navigator", {onLine: true});
    vi.stubGlobal("WebSocket", Socket);
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });
  async function connect() {
    const { connectMattermostWebSocket } = await import("./websocket");
    const callbacks = {onReconnect: vi.fn(), onPosted: vi.fn(), onAuthFailure: vi.fn()};
    dispose = connectMattermostWebSocket({enabled: true, userId: "user", username: "alice", token: "pat", ...callbacks});
    return callbacks;
  }

  it.each([false, true])("recovers a stalled connection/authentication without a close event (open=%s)", async opened => {
    const callbacks = await connect();
    const first = Socket.instances[0];
    if (opened) first.open();
    await vi.advanceTimersByTimeAsync(32_000);
    expect(Socket.instances).toHaveLength(2);
    expect(first.close).toHaveBeenCalled();
    first.message({event: "hello", broadcast: {user_id: "user"}});
    Socket.instances[1].authenticate();
    expect(callbacks.onReconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("recovers a missing heartbeat reply even if close never completes", async () => {
    await connect();
    Socket.instances[0].authenticate();
    await vi.advanceTimersByTimeAsync(42_000);
    expect(Socket.instances).toHaveLength(2);
    expect(Socket.instances[0].close).toHaveBeenCalled();
  });

  it("recovers a synchronous send failure without an uncaught timer exception", async () => {
    await connect();
    Socket.instances[0].authenticate();
    Socket.instances[0].send.mockImplementation(() => { throw new Error("closed transport"); });
    await vi.advanceTimersByTimeAsync(32_000);
    expect(Socket.instances).toHaveLength(2);
  });

  it("retires a socket on error and removes its handlers before reconnecting", async () => {
    await connect();
    const first = Socket.instances[0];
    first.authenticate();
    const remove = vi.spyOn(first, "removeEventListener");
    first.dispatchEvent(new Event("error"));
    expect(remove.mock.calls.map(call => call[0]).sort()).toEqual(["close", "error", "message", "open"]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(Socket.instances).toHaveLength(2);
  });

  it("keeps one heartbeat timer throughout seven simulated days", async () => {
    const callbacks = await connect();
    const socket = Socket.instances[0];
    socket.authenticate();
    const heartbeatCount = 7 * 24 * 60 * 2;
    for (let tick = 0; tick < heartbeatCount; tick++) {
      vi.advanceTimersByTime(30_000);
      const ping = JSON.parse(socket.send.mock.calls.at(-1)![0]);
      socket.message({seq_reply: ping.seq, status: "OK"});
      if (tick % 100 === 0) expect(vi.getTimerCount()).toBe(1);
    }
    expect(Socket.instances).toHaveLength(1);
    expect(callbacks.onReconnect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    dispose!(); dispose = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores valid JSON that is not an event envelope", async () => {
    const callbacks = await connect();
    const socket = Socket.instances[0];
    socket.authenticate();
    for (const payload of [null, 1, "text", [], true]) socket.message(payload);
    expect(callbacks.onPosted).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("keeps timers bounded over 500 disconnect/reconnect cycles and releases listeners", async () => {
    const removeWindow = vi.spyOn(target, "removeEventListener");
    const removeDocument = vi.spyOn(doc, "removeEventListener");
    const callbacks = await connect();
    Socket.instances[0].authenticate();
    for (let cycle = 0; cycle < 500; cycle++) {
      target.dispatchEvent(new Event("offline"));
      expect(vi.getTimerCount()).toBe(0);
      target.dispatchEvent(new Event("online"));
      const socket = Socket.instances.at(-1)!;
      socket.authenticate();
      await vi.advanceTimersByTimeAsync(30_000);
      const ping = JSON.parse(socket.send.mock.calls.at(-1)![0]);
      socket.message({seq_reply: ping.seq, status: "OK"});
      expect(vi.getTimerCount()).toBe(1);
    }
    expect(callbacks.onReconnect).toHaveBeenCalledTimes(500);
    dispose!(); dispose = undefined;
    expect(vi.getTimerCount()).toBe(0);
    expect(removeWindow.mock.calls.map(call => call[0])).toEqual(["online", "offline"]);
    expect(removeDocument.mock.calls.map(call => call[0])).toEqual(["visibilitychange"]);
    const count = Socket.instances.length;
    target.dispatchEvent(new Event("online"));
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(Socket.instances).toHaveLength(count);
  });

  it("stops all timers on authentication rejection and disposal during connection", async () => {
    const callbacks = await connect();
    const socket = Socket.instances[0];
    socket.open();
    const auth = JSON.parse(socket.send.mock.calls[0][0]);
    socket.message({seq_reply: auth.seq, status: "FAIL"});
    expect(callbacks.onAuthFailure).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(Socket.instances).toHaveLength(1);
    dispose!();
    await connect();
    dispose!(); dispose = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });
});

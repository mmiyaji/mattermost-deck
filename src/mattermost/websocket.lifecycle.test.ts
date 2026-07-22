import { describe, expect, it, vi } from "vitest";

class TestCustomEvent<T> extends Event {
  detail: T;
  constructor(type: string, init: { detail: T }) {
    super(type);
    this.detail = init.detail;
  }
}

class TestSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: TestSocket[] = [];
  readyState = TestSocket.CONNECTING;
  send = vi.fn();

  constructor(public url: string) {
    super();
    TestSocket.instances.push(this);
  }

  open() {
    this.readyState = TestSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  message(payload: unknown) {
    const event = new Event("message") as Event & { data: string };
    event.data = JSON.stringify(payload);
    this.dispatchEvent(event);
  }

  close(_code?: number, _reason?: string) {
    if (this.readyState === TestSocket.CLOSED) return;
    this.readyState = TestSocket.CLOSED;
    const event = new Event("close") as Event & { code: number; reason: string };
    event.code = 1000;
    event.reason = "";
    this.dispatchEvent(event);
  }
}

describe("WebSocket online lifecycle", () => {
  it("does not duplicate a live socket and refreshes after an offline reconnect", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    TestSocket.instances = [];
    const fakeWindow = new EventTarget() as EventTarget & typeof globalThis;
    Object.assign(fakeWindow, {
      location: { origin: "https://example.test" },
      localStorage: { getItem: () => null, setItem: () => undefined },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    });
    const fakeDocument = new EventTarget() as EventTarget & { hidden: boolean };
    fakeDocument.hidden = false;
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("CustomEvent", TestCustomEvent);
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
        onChanged: { addListener: vi.fn() },
      },
    });
    const { connectMattermostWebSocket } = await import("./websocket");
    const onReconnect = vi.fn();
    const dispose = connectMattermostWebSocket({
      userId: "user-id",
      username: "alice",
      enabled: true,
      token: "pat",
      onReconnect,
      onPosted: vi.fn(),
      onAuthFailure: vi.fn(),
    });

    const first = TestSocket.instances[0];
    first.open();
    first.message({ status: "OK", seq_reply: 1 });
    fakeWindow.dispatchEvent(new Event("online"));
    expect(TestSocket.instances).toHaveLength(1);

    fakeWindow.dispatchEvent(new Event("offline"));
    fakeWindow.dispatchEvent(new Event("online"));
    const second = TestSocket.instances[1];
    second.open();
    second.message({ status: "OK", seq_reply: 2 });

    expect(TestSocket.instances).toHaveLength(2);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    dispose();
    vi.useRealTimers();
  });
});

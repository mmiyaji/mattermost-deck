import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import { TRACE_CAPTURE_STORAGE_KEY, TRACE_LOG_STORAGE_KEY } from "./traceProtocol";
import type { TraceStorageRequest, TraceStorageSnapshot } from "./traceProtocol";

type Runtime = typeof globalThis & { traceStorage: typeof import("./traceStorage"); legacy: Record<string, unknown>; failStorageSet?: boolean; failStorageRemove?: boolean; failDetailPut?: boolean };
describe("extension-origin trace database", () => {
  let browser: Browser, context: BrowserContext, page: Page, bundle: string;
  beforeAll(async () => {
    bundle = (await build({ entryPoints: ["src/traceStorage.ts"], bundle: true, write: false, format: "iife", globalName: "traceStorage", platform: "browser" })).outputFiles[0]!.text;
    browser = await chromium.launch({ headless: true });
  }, 30_000);
  afterAll(async () => { await browser?.close(); });
  beforeEach(async () => {
    context = await browser.newContext(); page = await context.newPage();
    await page.route("https://trace.test/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Trace DB test</title>" }));
    await page.goto("https://trace.test/");
    await page.evaluate(() => {
      (globalThis as Runtime).legacy = {};
      Object.defineProperty(globalThis, "chrome", { configurable: true, value: { storage: { local: {
        get: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, structuredClone((globalThis as Runtime).legacy[key])])),
        set: async (values: Record<string, unknown>) => { if((globalThis as Runtime).failStorageSet)throw new Error("simulated local metadata failure");Object.assign((globalThis as Runtime).legacy, structuredClone(values)); },
        remove: async (key: string) => { if((globalThis as Runtime).failStorageRemove)throw new Error("simulated legacy cleanup failure");delete (globalThis as Runtime).legacy[key]; },
      } } } });
    });
    await page.addScriptTag({ content: bundle });
  });
  afterEach(async () => { await context?.close(); });
  const call = (request: TraceStorageRequest) => page.evaluate(async request => (globalThis as Runtime).traceStorage.handleTraceStorageRequest(request), request) as Promise<TraceStorageSnapshot>;
  const entry = (id: string, timestamp = Date.now(), payload: Record<string, unknown> = {}) => ({ id, timestamp, source: "api" as const, level: "info" as const, event: "request.complete", payload: { durationMs: 90, networkMs: 70, queueWaitMs: 20, ...payload } });

  it("imports legacy logs once and removes their local key after the durable marker", async () => {
    await page.evaluate(({ key }) => { (globalThis as Runtime).legacy[key] = [{ ...({ id: "old", timestamp: Date.now(), source: "api", level: "info", event: "request.complete" }) }]; }, { key: TRACE_LOG_STORAGE_KEY });
    await call({ operation: "get" });
    expect((await call({ operation: "query" })).entries[0]?.id).toBe("old");
    expect(await page.evaluate(key => (globalThis as Runtime).legacy[key], TRACE_LOG_STORAGE_KEY)).toBeUndefined();
    expect(await page.evaluate(() => new Promise(resolve => { const r=indexedDB.open("mattermost-deck-traces",1); r.onsuccess=()=>{const db=r.result;const q=db.transaction("meta").objectStore("meta").get("legacy-import-v1");q.onsuccess=()=>resolve(q.result);}; }))).toBe(true);
  });
  it("retries legacy-key cleanup after an interrupted migration cleanup",async()=>{
    await page.evaluate(({key})=>{const g=globalThis as Runtime;g.legacy[key]=[{id:"legacy-retry",timestamp:Date.now(),source:"api",level:"info",event:"request.complete"}];g.failStorageRemove=true;},{key:TRACE_LOG_STORAGE_KEY});
    await expect(call({operation:"get"})).rejects.toThrow("simulated legacy cleanup failure");
    await page.evaluate(()=>{(globalThis as Runtime).failStorageRemove=false;});
    await call({operation:"get"});
    expect((await call({operation:"query"})).entries.map(e=>e.id)).toEqual(["legacy-retry"]);
    expect(await page.evaluate(key=>(globalThis as Runtime).legacy[key],TRACE_LOG_STORAGE_KEY)).toBeUndefined();
  });
  it("dedupes retried appends and updates timestamp buckets with paired totals", async () => {
    const state = await call({ operation: "setCapture", enabled: true });
    const timestamp = Math.floor(Date.now() / 60_000) * 60_000 + 1000;
    const batch = [entry("one", timestamp), entry("two", timestamp + 10, { status: 429, failed: true })];
    await call({ operation: "append", generation: state.generation, entries: batch });
    await call({ operation: "append", generation: state.generation, entries: batch });
    const aggregate = await call({ operation: "aggregates", from: Math.floor(timestamp / 60_000) * 60_000, to: timestamp + 60_000 });
    expect(aggregate.aggregates?.[0]).toMatchObject({ count: 2, errors: 1, rateLimited: 1, waitSum: 40, waitCount: 2, networkSum: 140, networkCount: 2, totalSum: 180, totalCount: 2 });
    expect((await call({ operation: "query", from: timestamp, to: timestamp + 60_000 })).entries).toHaveLength(2);
  });
  it("filters requests before pagination and includes unknown HTTP status consistently",async()=>{
    const state=await call({operation:"setCapture",enabled:true}),now=Date.now();
    await call({operation:"append",generation:state.generation,entries:[
      {...entry("success",now,{path:"/widgets",status:200}),source:"api"},
      {...entry("failed",now-1,{path:"/widgets/fail",status:503}),event:"request.error",source:"api"},
      {...entry("unknown",now-2,{path:"/widgets/unknown",status:"unparsed"}),event:"request.error",source:"api"},
      {...entry("other",now-3,{path:"/widgets"}),source:"ws"},
    ]});
    const page1=await call({operation:"query",requestsOnly:true,limit:1});
    expect(page1.entries).toHaveLength(1);expect(page1.hasMore).toBe(true);
    expect((await call({operation:"query",requestsOnly:true,failedOnly:true,query:"fail"})).entries.map(e=>e.id)).toEqual(["failed"]);
    expect((await call({operation:"query",requestsOnly:true,status:"no-http"})).entries.map(e=>e.id)).toContain("unknown");
    expect((await call({operation:"query",requestsOnly:true,status:200})).entries.map(e=>e.id)).toEqual(["success"]);
  });
  it("clear and capture off invalidate the generation and delete aggregates", async () => {
    const state = await call({ operation: "setCapture", enabled: true });
    await call({ operation: "append", generation: state.generation, entries: [entry("before")] });
    const cleared = await call({ operation: "clear" });
    expect(cleared.generation).not.toBe(state.generation);
    expect((await call({ operation: "aggregates" })).aggregates).toEqual([]);
    await call({ operation: "append", generation: state.generation, entries: [entry("stale")] });
    expect((await call({ operation: "query" })).entries).toEqual([]);
    const disabled = await call({ operation: "setCapture", enabled: false });
    expect(disabled.captureEnabled).toBe(false);
    expect(await page.evaluate(key => (globalThis as Runtime).legacy[key], TRACE_LOG_STORAGE_KEY)).toBeUndefined();
  });
  it("keeps aggregates and dedupe receipts after detail eviction and restart", async () => {
    const state=await call({operation:"setCapture",enabled:true});
    const base=Math.floor(Date.now()/60_000)*60_000+1;
    const batch=Array.from({length:10_000},(_,i)=>entry(`evict-${i}`,base+i));
    await call({operation:"append",generation:state.generation,entries:batch});
    await call({operation:"append",generation:state.generation,entries:[entry("newest",base+20_000)]});
    expect((await call({operation:"query",from:base,to:base+60_000,limit:100})).hasMore).toBe(true);
    const total=await call({operation:"aggregates",from:base-1,to:base+60_000});
    expect(total.aggregates?.[0]?.count).toBe(10_001);
    await page.addScriptTag({content:bundle}); // simulate a background worker restart; IDB persists
    await call({operation:"append",generation:state.generation,entries:[entry("evict-0",base, {durationMs:9999})]});
    expect((await call({operation:"aggregates",from:base-1,to:base+60_000})).aggregates?.[0]?.count).toBe(10_001);
  },30_000);
  it("recovers the durable generation when metadata mirroring fails after clear", async () => {
    const state=await call({operation:"setCapture",enabled:true});
    await call({operation:"append",generation:state.generation,entries:[entry("before-clear")]});
    await page.evaluate(()=>{(globalThis as Runtime).failStorageSet=true;});
    await expect(call({operation:"clear"})).rejects.toThrow("simulated local metadata failure");
    await page.evaluate(()=>{(globalThis as Runtime).failStorageSet=false;});
    await page.addScriptTag({content:bundle});
    const recovered=await call({operation:"get"});
    expect(recovered.generation).not.toBe(state.generation);
    expect((await call({operation:"query"})).entries).toEqual([]);
  });
  it("prunes only reconstructible details and retries an IndexedDB quota failure",async()=>{
    const state=await call({operation:"setCapture",enabled:true});
    await page.evaluate(()=>{const g=globalThis as Runtime;g.failDetailPut=true;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==="details"&&g.failDetailPut){g.failDetailPut=false;throw new DOMException("quota","QuotaExceededError");}return put.apply(this,args);};});
    await call({operation:"append",generation:state.generation,entries:[entry("quota-retry")]});
    expect((await call({operation:"query"})).entries[0]?.id).toBe("quota-retry");
    expect((await call({operation:"aggregates"})).aggregates?.[0]?.count).toBe(1);
  });
  it("bounds dedupe receipts with a durable watermark while accepting newer entries",async()=>{
    const state=await call({operation:"setCapture",enabled:true}),now=Date.now(),old=now-60*60_000,oldBucket=Math.floor(old/60_000)*60_000;
    await page.evaluate(({old,oldBucket})=>new Promise<void>((resolve,reject)=>{
      const open=indexedDB.open("mattermost-deck-traces",1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(["receipts","aggregates"],"readwrite"),receipts=tx.objectStore("receipts");
        receipts.put({id:"evicted-receipt",timestamp:old});for(let i=0;i<49_999;i++)receipts.put({id:`receipt-${i}`,timestamp:old+1+i});
        tx.objectStore("aggregates").put({start:oldBucket,count:1,errors:0,rateLimited:0,waitSum:0,waitCount:0,networkSum:0,networkCount:0,totalSum:0,totalCount:0,clientLimiterWaits:0,maxOutstanding:0});
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    }),{old,oldBucket});
    await call({operation:"append",generation:state.generation,entries:[entry("new-after-cap",now)]});
    await page.addScriptTag({content:bundle});
    await call({operation:"append",generation:state.generation,entries:[entry("evicted-receipt",old)]});
    const all=await call({operation:"aggregates",from:oldBucket,to:now});
    expect(all.aggregates?.reduce((sum,bucket)=>sum+bucket.count,0)).toBe(2);
    expect(await page.evaluate(()=>new Promise<number>(resolve=>{const open=indexedDB.open("mattermost-deck-traces",1);open.onsuccess=()=>{const q=open.result.transaction("receipts").objectStore("receipts").count();q.onsuccess=()=>resolve(q.result);};}))).toBe(50_000);
    expect((await call({operation:"query",from:now-1000,to:now+1000})).entries.map(e=>e.id)).toContain("new-after-cap");
  },30_000);
  it("adds trusted origin provenance without retaining sender paths or credentials", async () => {
    const state = await call({ operation: "setCapture", enabled: true });
    await page.evaluate(async ({ generation }) => (globalThis as Runtime).traceStorage.handleTraceStorageRequest({ operation: "append", generation, entries: [{ id: "origin", timestamp: Date.now(), source: "api", level: "info", event: "request.complete" }] }, { url: "https://user:secret@chat.example/private?token=secret", tab: { id: 7 } } as chrome.runtime.MessageSender), { generation: state.generation });
    expect((await call({ operation: "query" })).entries[0]?.context).toEqual({ origin: "https://chat.example", tabId: 7 });
    expect((globalThis as Runtime | undefined)).toBeDefined();
  });
});

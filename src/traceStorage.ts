import {
  TRACE_CAPTURE_STORAGE_KEY, TRACE_LOG_STORAGE_KEY, TRACE_STATE_STORAGE_KEY, TRACE_LOG_LIMIT,
  TRACE_LOG_TTL_MS, TRACE_MAX_BYTES, TRACE_AGGREGATE_TTL_MS, TRACE_AGGREGATE_BUCKET_LIMIT,
  TRACE_PAGE_SIZE, sanitizeTraceEntry, traceBytes,
  type TraceLogEntry, type TraceStorageRequest, type TraceStorageSnapshot, type TraceMinuteAggregate,
} from "./traceProtocol";

// Background-only writer. IndexedDB transactions make detail, aggregate and
// dedupe receipt updates atomic; storage.local contains only control metadata.
const DB_NAME = "mattermost-deck-traces";
const DB_VERSION = 1;
const DETAILS = "details", AGGREGATES = "aggregates", RECEIPTS = "receipts", META = "meta";
const RECEIPT_LIMIT = 50_000;
let queue: Promise<unknown> = Promise.resolve();
let dbPromise: Promise<IDBDatabase> | null = null;
let legacyCleanupComplete = false;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const details = db.createObjectStore(DETAILS, { keyPath: "id" }); details.createIndex("timestamp", "timestamp");
      db.createObjectStore(AGGREGATES, { keyPath: "start" });
      db.createObjectStore(RECEIPTS, { keyPath: "id" }).createIndex("timestamp", "timestamp");
      db.createObjectStore(META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Trace database unavailable"));
    request.onblocked = () => reject(new Error("Trace database upgrade blocked"));
  }).catch(error => { dbPromise = null; throw error; });
  dbPromise = opening;
  return opening;
}
function transaction<T>(db: IDBDatabase, stores: string[], action: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite"); let value: T;
    void action(tx).then(result => { value = result; }, error => { try { tx.abort(); } catch { /* closed */ } reject(error); });
    tx.oncomplete = () => resolve(value!); tx.onerror = () => reject(tx.error ?? new Error("Trace database transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("Trace database transaction aborted"));
  });
}
const req = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
function payloadNumber(entry: TraceLogEntry, key: string): number | null { const v = entry.payload?.[key]; return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null; }
function updateAggregate(a: TraceMinuteAggregate | undefined, e: TraceLogEntry): TraceMinuteAggregate {
  const start = Math.floor(e.timestamp / 60_000) * 60_000;
  const value = a ?? { start, count: 0, errors: 0, rateLimited: 0, waitSum: 0, waitCount: 0, networkSum: 0, networkCount: 0, totalSum: 0, totalCount: 0, clientLimiterWaits: 0, maxOutstanding: 0 };
  if (e.source !== "api") return value;
  if (e.event === "request.rate_limit_wait") { value.clientLimiterWaits++; return value; }
  if (!["request.complete", "request.error"].includes(e.event)) return value;
  value.count++;
  const status = payloadNumber(e, "status"); if (e.event === "request.error" || e.payload?.failed === true || (status !== null && status >= 400)) value.errors++;
  if (status === 429) value.rateLimited++;
  const wait = payloadNumber(e, "queueWaitMs"), total = payloadNumber(e, "durationMs");
  const recordedNetwork=payloadNumber(e,"networkMs"), network=recordedNetwork??(total!==null&&wait!==null&&wait<=total?total-wait:null);
  if (wait !== null) { value.waitSum += wait; value.waitCount++; }
  if (network !== null) { value.networkSum += network; value.networkCount++; }
  if (total !== null) { value.totalSum += total; value.totalCount++; }
  if (e.payload?.clientLimiterWait === true) value.clientLimiterWaits++;
  const outstanding = payloadNumber(e, "queueDepth"); if (outstanding !== null) value.maxOutstanding = Math.max(value.maxOutstanding, outstanding);
  return value;
}
async function importLegacy(db: IDBDatabase): Promise<void> {
  const marker = await req(db.transaction(META).objectStore(META).get("legacy-import-v1"));
  if (marker) { if(!legacyCleanupComplete){await chrome.storage.local.remove(TRACE_LOG_STORAGE_KEY);legacyCleanupComplete=true;} return; }
  const old = await chrome.storage.local.get([TRACE_LOG_STORAGE_KEY]);
  const values = Array.isArray(old[TRACE_LOG_STORAGE_KEY]) ? old[TRACE_LOG_STORAGE_KEY] as TraceLogEntry[] : [];
  await transaction(db, [DETAILS, AGGREGATES, RECEIPTS, META], async tx => {
    const details = tx.objectStore(DETAILS), aggregates = tx.objectStore(AGGREGATES), receipts = tx.objectStore(RECEIPTS); let bytes=0;
    const now = Date.now();
    for (let i = 0; i < values.length; i++) {
      const entry = sanitizeTraceEntry({ ...values[i], id: values[i]?.id ?? `legacy-${i}` }, now);
      if (!entry || await req(details.get(entry.id!))) continue;
      const size=traceBytes(entry); details.put({...entry,__bytes:size}); bytes+=size; receipts.put({ id: entry.id, timestamp: entry.timestamp });
      const key = Math.floor(entry.timestamp / 60_000) * 60_000;
      aggregates.put(updateAggregate(await req(aggregates.get(key)), entry));
    }
    tx.objectStore(META).put(bytes,"detailBytes"); tx.objectStore(META).put(true, "legacy-import-v1");
  });
  // Marker is durable before removing the legacy key; restart between these
  // operations simply observes the marker and completes cleanup safely.
  await chrome.storage.local.remove(TRACE_LOG_STORAGE_KEY);
  legacyCleanupComplete = true;
}
function deleteBefore(store: IDBObjectStore, indexName: string | null, cutoff: number, field: string): Promise<number> {
  return new Promise((resolve,reject) => {
    const source: IDBIndex|IDBObjectStore = indexName ? store.index(indexName) : store;
    const cursor=source.openCursor(IDBKeyRange.upperBound(cutoff, true), "next"); let deleted=0;
    cursor.onerror=()=>reject(cursor.error);
    cursor.onsuccess=()=>{ const c=cursor.result; if(!c){resolve(deleted);return;} const value=c.value as Record<string,unknown>; if(typeof value[field]==="number") deleted+=Number(value[field]); c.delete(); c.continue(); };
  });
}
async function prune(tx: IDBTransaction, now: number): Promise<void> {
  const details=tx.objectStore(DETAILS), receipts=tx.objectStore(RECEIPTS), aggregates=tx.objectStore(AGGREGATES), meta=tx.objectStore(META);
  const expired=await deleteBefore(details,"timestamp",now-TRACE_LOG_TTL_MS,"__bytes");
  const receiptCutoff=now-TRACE_LOG_TTL_MS; await deleteBefore(receipts,"timestamp",receiptCutoff,"timestamp");
  await deleteBefore(aggregates,null,now-TRACE_AGGREGATE_TTL_MS,"start");
  let bytes=await req(meta.get("detailBytes")) as number|undefined;
  if(bytes===undefined) { bytes=0; await new Promise<void>((resolve,reject)=>{const c=details.openCursor();c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur){resolve();return;}bytes!+=Number((cur.value as Record<string,unknown>).__bytes??traceBytes(cur.value));cur.continue();};}); }
  bytes=Math.max(0,bytes-expired); let count=await req(details.count());
  if(count>TRACE_LOG_LIMIT||bytes>TRACE_MAX_BYTES) await new Promise<void>((resolve,reject)=>{const c=details.index("timestamp").openCursor(null,"next");c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur|| (count<=TRACE_LOG_LIMIT&&bytes!<=TRACE_MAX_BYTES)){resolve();return;} bytes!-=Number((cur.value as Record<string,unknown>).__bytes??traceBytes(cur.value));count--;cur.delete();cur.continue();};});
  meta.put(Math.max(0,bytes),"detailBytes");
  let aggCount=await req(aggregates.count()); if(aggCount>TRACE_AGGREGATE_BUCKET_LIMIT) await new Promise<void>((resolve,reject)=>{const c=aggregates.openCursor(null,"next");c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur||aggCount<=TRACE_AGGREGATE_BUCKET_LIMIT){resolve();return;}aggCount--;cur.delete();cur.continue();};});
}
function queryDetails(store: IDBObjectStore, message: TraceStorageRequest, now: number): Promise<{entries:TraceLogEntry[];hasMore:boolean}> {
  const from=Math.max(now-TRACE_LOG_TTL_MS,0,message.from??now-TRACE_LOG_TTL_MS), to=Math.min(now+5*60_000,message.to??now);
  if(from>to)return Promise.resolve({entries:[],hasMore:false});
  const range=IDBKeyRange.bound(from,to), limit=Math.max(1,Math.min(TRACE_PAGE_SIZE,message.limit??TRACE_PAGE_SIZE)), offset=Math.max(0,Math.min(TRACE_LOG_LIMIT,message.offset??0));
  const query=(message.query??"").toLocaleLowerCase(); const matches=(e:TraceLogEntry)=>{
    if(message.requestsOnly && !(e.source==="api"&&["request.complete","request.error"].includes(e.event)))return false;
    const rawStatus=e.payload?.status,status=typeof rawStatus==="number"&&Number.isInteger(rawStatus)&&rawStatus>=100&&rawStatus<=599?rawStatus:null;
    if(message.failedOnly && !(e.event==="request.error"||e.payload?.failed===true||(status!==null&&status>=400))) return false;
    if(message.status==="no-http" && status!==null) return false;
    if(typeof message.status==="number" && status!==message.status) return false;
    return !query||[e.payload?.path,e.payload?.fullPath,e.payload?.method,e.payload?.reason,e.payload?.error,e.payload?.purpose,e.payload?.priority].some(v=>typeof v==="string"&&v.toLocaleLowerCase().includes(query));
  };
  return new Promise((resolve,reject)=>{const entries:TraceLogEntry[]=[];let skipped=0,hasMore=false;const c=store.index("timestamp").openCursor(range,"prev");c.onerror=()=>reject(c.error);c.onsuccess=()=>{const cur=c.result;if(!cur){resolve({entries,hasMore});return;}const value=cur.value as TraceLogEntry&{__bytes?:number};if(matches(value)){if(skipped<offset) skipped++;else if(entries.length<limit) entries.push(Object.fromEntries(Object.entries(value).filter(([key])=>key!=="__bytes")) as TraceLogEntry);else {hasMore=true;resolve({entries,hasMore});return;}}cur.continue();};});
}
function evictReceipts(store:IDBObjectStore,count:number,watermark:number):Promise<{removed:number;watermark:number}>{
  if(count<=0)return Promise.resolve({removed:0,watermark});
  return new Promise((resolve,reject)=>{let removed=0;const cursor=store.index("timestamp").openCursor(null,"next");cursor.onerror=()=>reject(cursor.error);cursor.onsuccess=()=>{const c=cursor.result;if(!c||removed>=count){resolve({removed,watermark});return;}const timestamp=Number((c.value as {timestamp:number}).timestamp);watermark=Math.max(watermark,timestamp);c.delete();removed++;c.continue();};});
}
export async function handleTraceStorageRequest(message: TraceStorageRequest, sender?: chrome.runtime.MessageSender): Promise<TraceStorageSnapshot> {
  if (!message) throw new Error("Invalid trace storage request");
  const validRange=(message.from===undefined||Number.isSafeInteger(message.from)&&message.from>=0)&&(message.to===undefined||Number.isSafeInteger(message.to)&&message.to>=0)&&(message.from===undefined||message.to===undefined||message.from<=message.to);
  const validQuery=message.operation!=="query"||((message.offset===undefined||Number.isSafeInteger(message.offset)&&message.offset>=0)&&(message.limit===undefined||Number.isSafeInteger(message.limit)&&message.limit>=1&&message.limit<=TRACE_PAGE_SIZE)&&(typeof message.query!=="string"||message.query.length<=256)&&(typeof message.status!=="string"||message.status==="no-http"||message.status==="all"));
  if (!message || !["get", "append", "clear", "setCapture", "query", "aggregates"].includes(message.operation) ||
      (message.operation === "append" && (typeof message.generation !== "string" || !Array.isArray(message.entries) || message.entries.length > TRACE_LOG_LIMIT)) ||
      (message.operation === "setCapture" && typeof message.enabled !== "boolean") ||
      (["query","aggregates"].includes(message.operation) && !validRange) || !validQuery) throw new Error("Invalid trace storage request");
  const task = queue.catch(() => undefined).then(async () => {
    const db = await openDb(); await importLegacy(db);
    const stored = await chrome.storage.local.get([TRACE_CAPTURE_STORAGE_KEY, TRACE_STATE_STORAGE_KEY]);
    const state = stored[TRACE_STATE_STORAGE_KEY] as {generation?:unknown;revision?:unknown}|undefined;
    let generation = typeof state?.generation === "string" && state.generation ? state.generation : crypto.randomUUID();
    let revision = typeof state?.revision === "number" && Number.isSafeInteger(state.revision) ? state.revision : 0;
    let captureEnabled = stored[TRACE_CAPTURE_STORAGE_KEY] === true;
    const savedControl=await req(db.transaction(META).objectStore(META).get("control")) as {generation:string;revision:number;captureEnabled:boolean}|undefined;
    if(savedControl){generation=savedControl.generation;revision=savedControl.revision;captureEnabled=savedControl.captureEnabled;}
    else await transaction(db,[META],async tx=>{tx.objectStore(META).put({generation,revision,captureEnabled},"control");return;});
    const now = Date.now();
    if (message.operation === "clear" || (message.operation === "setCapture" && !message.enabled)) {
      generation = crypto.randomUUID(); captureEnabled = message.operation === "setCapture" ? false : captureEnabled;
      revision++;
      await transaction(db, [DETAILS, AGGREGATES, RECEIPTS, META], async tx => { tx.objectStore(DETAILS).clear(); tx.objectStore(AGGREGATES).clear(); tx.objectStore(RECEIPTS).clear(); tx.objectStore(META).put(0,"detailBytes");tx.objectStore(META).put(-1,"receiptWatermark");tx.objectStore(META).put({generation,revision,captureEnabled},"control"); return; });
    }
    if (message.operation === "setCapture") { captureEnabled = message.enabled!; if(message.enabled){revision++;await transaction(db,[META],async tx=>{tx.objectStore(META).put({generation,revision,captureEnabled},"control");return;});} }
    let entries: TraceLogEntry[] = [], aggregates: TraceMinuteAggregate[] = [], hasMore = false, entriesAuthoritative=false;
    let appendAccepted=false;
    if (message.operation === "append" && captureEnabled && generation === message.generation) {
      const context: TraceLogEntry["context"] = {};
      try { if (sender?.url || sender?.origin) context.origin = new URL(sender.url ?? sender.origin!).origin; } catch { /* unavailable provenance */ }
      if (sender?.tab?.id !== undefined) context.tabId = sender.tab.id;
      const writeBatch=()=>transaction(db, [DETAILS, AGGREGATES, RECEIPTS, META], async tx => {
        const d=tx.objectStore(DETAILS), r=tx.objectStore(RECEIPTS), a=tx.objectStore(AGGREGATES);
        const meta=tx.objectStore(META);await prune(tx,now);let bytes=await req(meta.get("detailBytes")) as number|undefined;if(bytes===undefined)bytes=0;
        const control=await req(meta.get("control")) as {generation:string;captureEnabled:boolean}|undefined;if(!control||!control.captureEnabled||control.generation!==message.generation)return false;
        let watermark=await req(meta.get("receiptWatermark")) as number|undefined??-1;
        const incoming=message.entries!.map(raw=>sanitizeTraceEntry({...raw,...(Object.keys(context).length?{context}:{})},now)).filter((e):e is TraceLogEntry=>e!==null&&e.timestamp>watermark);
        const uniqueIds=[...new Map(incoming.map(e=>[e.id!,e])).values()];let unseen=0;
        for(const e of uniqueIds)if(!await req(r.get(e.id!)))unseen++;
        const receiptCount=await req(r.count());
        if(receiptCount+unseen>RECEIPT_LIMIT){const evicted=await evictReceipts(r,receiptCount+unseen-RECEIPT_LIMIT,watermark);watermark=evicted.watermark;meta.put(watermark,"receiptWatermark");}
        for (const e of incoming) {
          if(e.timestamp<=watermark)continue;
          if (await req(r.get(e.id!))) continue;
          const size=traceBytes(e);r.put({id:e.id!,timestamp:e.timestamp}); d.put({...e,__bytes:size});bytes+=size;
          const key=Math.floor(e.timestamp/60_000)*60_000; a.put(updateAggregate(await req(a.get(key)),e));
        }
        meta.put(watermark,"receiptWatermark");
        meta.put(bytes,"detailBytes");
        const nextRevision=revision+1;meta.put({generation,revision:nextRevision,captureEnabled},"control");
        await prune(tx, now);
        return true;
      });
      try { appendAccepted=await writeBatch(); }
      catch(error) {
        if((error as DOMException)?.name!=="QuotaExceededError")throw error;
        // Detailed records are reconstructible. Free their space, then retry
        // the same atomic append while preserving aggregates, settings, reviews
        // and favorites. A second failure is surfaced to the caller.
        await transaction(db,[DETAILS,META],async tx=>{tx.objectStore(DETAILS).clear();tx.objectStore(META).put(0,"detailBytes");return;});
        appendAccepted=await writeBatch();
      }
      if(appendAccepted)revision++;
    }
    if (message.operation === "get" || message.operation === "append" || message.operation === "setCapture" || message.operation === "clear") {
      if (message.operation === "get") await transaction(db,[DETAILS,AGGREGATES,RECEIPTS,META], async tx => { await prune(tx,now); return; });
    }
    if (message.operation === "query") {
      const tx=db.transaction(DETAILS,"readonly"), result=await queryDetails(tx.objectStore(DETAILS),message,now); entries=result.entries; hasMore=result.hasMore;entriesAuthoritative=true;
    }
    if (message.operation === "aggregates") {
      const lower=Math.floor(Math.max(now-TRACE_AGGREGATE_TTL_MS,message.from??now-TRACE_AGGREGATE_TTL_MS)/60_000)*60_000,upper=Math.min(now,message.to??now);
      if(lower>upper){aggregates=[];}else{const tx=db.transaction(AGGREGATES,"readonly"), all=await req(tx.objectStore(AGGREGATES).getAll(IDBKeyRange.bound(lower,upper)));aggregates=(all as TraceMinuteAggregate[]).sort((a,b)=>a.start-b.start);}
    }
    if ((message.operation === "setCapture" || message.operation === "clear" || (message.operation === "append"&&appendAccepted))) {
      await chrome.storage.local.set({[TRACE_CAPTURE_STORAGE_KEY]:captureEnabled,[TRACE_STATE_STORAGE_KEY]:{generation,revision}});
    }
    else if(message.operation==="get"&&(stored[TRACE_CAPTURE_STORAGE_KEY]!==captureEnabled||state?.generation!==generation||state?.revision!==revision)) await chrome.storage.local.set({[TRACE_CAPTURE_STORAGE_KEY]:captureEnabled,[TRACE_STATE_STORAGE_KEY]:{generation,revision}});
    return {captureEnabled,generation,revision,entries,entriesAuthoritative,aggregates,hasMore};
  });
  queue=task; return task;
}

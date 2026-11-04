import { afterEach, describe, expect, it, vi } from "vitest";
import { TRACE_CAPTURE_STORAGE_KEY, TRACE_LOG_STORAGE_KEY, TRACE_STATE_STORAGE_KEY, type TraceStorageRequest, type TraceStorageSnapshot } from "./traceProtocol";

type Client=typeof import("./traceLog");const clients:Client[]=[];
async function setup(){
  vi.useFakeTimers();vi.resetModules();
  const values:Record<string,unknown>={[TRACE_CAPTURE_STORAGE_KEY]:true,[TRACE_STATE_STORAGE_KEY]:{generation:"g1",revision:0}};
  const listeners=new Set<(changes:Record<string,chrome.storage.StorageChange>,area:string)=>void>();
  const get=vi.fn(async(keys:string[])=>Object.fromEntries(keys.map(key=>[key,structuredClone(values[key])])));
  const set=vi.fn(async(next:Record<string,unknown>)=>{const changes=Object.fromEntries(Object.entries(next).map(([key,value])=>[key,{oldValue:values[key],newValue:structuredClone(value)}]));Object.assign(values,structuredClone(next));for(const listener of listeners)listener(changes,"local");});
  const addListener=vi.fn(listener=>listeners.add(listener)),removeListener=vi.fn(listener=>listeners.delete(listener));
  let control:TraceStorageSnapshot={captureEnabled:true,generation:"g1",revision:0,entries:[]};let queryEntries:TraceStorageSnapshot["entries"]=[];
  const sendMessage=vi.fn(async(message:TraceStorageRequest):Promise<TraceStorageSnapshot&{success:boolean}>=>{
    if(message.operation==="setCapture"){control={...control,captureEnabled:message.enabled!,generation:message.enabled?control.generation:"g2",revision:control.revision+1};}
    if(message.operation==="clear")control={...control,generation:"g3",revision:control.revision+1,entries:[]};
    if(message.operation==="append"&&message.generation===control.generation)control={...control,revision:control.revision+1};
    return {success:true,...control,entries:message.operation==="query"?queryEntries:[],entriesAuthoritative:message.operation==="query"};
  });
  vi.stubGlobal("chrome",{storage:{local:{get,set},onChanged:{addListener,removeListener}},runtime:{sendMessage}});
  const client=async()=>{vi.resetModules();const result=await import("./traceLog");clients.push(result);await vi.advanceTimersByTimeAsync(0);return result;};
  return {values,sendMessage,set,addListener,removeListener,listeners,client,setQueryEntries(entries:TraceStorageSnapshot["entries"]){queryEntries=entries;}};
}
afterEach(()=>{for(const client of clients.splice(0))client.disposeTraceLogRuntime();vi.useRealTimers();vi.unstubAllGlobals();});

describe("trace client control protocol",()=>{
  it("sends stable-ID batches while local storage contains only capture and revision metadata",async()=>{
    const s=await setup(),client=await s.client();
    client.addTraceEntry({source:"api",level:"info",event:"one"});client.addTraceEntry({source:"content",level:"warn",event:"two"});
    const optimistic=client.getTraceEntries();expect(optimistic).toHaveLength(2);expect(optimistic.every(entry=>entry.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    const append=s.sendMessage.mock.calls.map(([message])=>message).find(message=>message.operation==="append");
    expect(append?.entries?.map(entry=>entry.id)).toEqual(optimistic.map(entry=>entry.id));
    expect(s.values[TRACE_LOG_STORAGE_KEY]).toBeUndefined();
    expect(Object.keys(s.values).sort()).toEqual([TRACE_CAPTURE_STORAGE_KEY,TRACE_STATE_STORAGE_KEY].sort());
  });
  it("preserves generation-scoped clear and capture-off behavior",async()=>{
    const s=await setup(),client=await s.client();client.addTraceEntry({source:"api",level:"info",event:"pending"});
    client.clearTraceEntries();expect(client.getTraceEntries()).toEqual([]);await vi.advanceTimersByTimeAsync(0);
    expect(s.sendMessage.mock.calls.some(([message])=>message.operation==="clear")).toBe(true);
    client.addTraceEntry({source:"api",level:"info",event:"after-clear"});expect(client.getTraceEntries().map(e=>e.event)).toEqual(["after-clear"]);
    client.setTraceCaptureEnabled(false);expect(client.getTraceEntries()).toEqual([]);expect(client.isTraceCaptureEnabled()).toBe(false);
    await vi.advanceTimersByTimeAsync(0);expect(s.sendMessage.mock.calls.some(([message])=>message.operation==="setCapture"&&message.enabled===false)).toBe(true);
  });
  it.each(["clear","off"] as const)("drops confirmed details immediately on foreign metadata-only %s",async action=>{
    const s=await setup(),client=await s.client();
    s.setQueryEntries([{id:"confirmed",timestamp:Date.now(),source:"api",level:"info",event:"request.complete"}]);
    // The fake background provides the initial explicit page, then metadata-only control notifications.
    const module=await import("./traceLog");
    await module.refreshTraceEntries();
    expect(client.getTraceEntries().map(e=>e.id)).toEqual(["confirmed"]);
    const old=s.values[TRACE_STATE_STORAGE_KEY] as {generation:string;revision:number};
    const changes:Record<string,chrome.storage.StorageChange>={[TRACE_STATE_STORAGE_KEY]:{newValue:{generation:"g-next",revision:old.revision+1}}};
    if(action==="off")changes[TRACE_CAPTURE_STORAGE_KEY]={newValue:false};
    for(const listener of s.listeners)listener(changes,"local");
    expect(client.getTraceEntries()).toEqual([]);
  });
  it("keeps unacknowledged entries through a transport failure and retries on later append",async()=>{
    const s=await setup(),client=await s.client();s.sendMessage.mockRejectedValueOnce(new Error("offline"));
    client.addTraceEntry({source:"api",level:"info",event:"first"});await vi.advanceTimersByTimeAsync(300);
    expect(client.getTraceEntries().map(e=>e.event)).toEqual(["first"]);
    client.addTraceEntry({source:"api",level:"info",event:"second"});await vi.advanceTimersByTimeAsync(300);
    expect(s.sendMessage.mock.calls.filter(([message])=>message.operation==="append")).toHaveLength(2);
    expect(s.sendMessage.mock.calls.at(-1)?.[0].entries?.map(entry=>entry.event)).toEqual(["second","first"]);
  });
  it("removes its metadata listener and pending flush when disposed",async()=>{
    const s=await setup(),client=await s.client();client.addTraceEntry({source:"content",level:"info",event:"pending"});
    const calls=s.sendMessage.mock.calls.length;client.disposeTraceLogRuntime();
    expect(s.removeListener).toHaveBeenCalledWith(s.addListener.mock.calls[0]?.[0]);await vi.advanceTimersByTimeAsync(300);expect(s.sendMessage).toHaveBeenCalledTimes(calls);
  });
});

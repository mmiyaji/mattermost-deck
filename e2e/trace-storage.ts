import type { BrowserContext, Worker } from "@playwright/test";
import type { TraceLogEntry, TraceStorageRequest, TraceStorageSnapshot } from "../src/traceProtocol";

const pages=new WeakMap<BrowserContext,import("@playwright/test").Page>();
type Reply=TraceStorageSnapshot&{success:boolean};
async function extensionPage(context:BrowserContext,worker:Worker){
  let page=pages.get(context);
  if(page&&!page.isClosed())return page;
  page=await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
  pages.set(context,page);return page;
}
export async function traceRequest(context:BrowserContext,worker:Worker,request:TraceStorageRequest):Promise<Reply>{
  const page=await extensionPage(context,worker);
  const result=await page.evaluate(async request=>chrome.runtime.sendMessage({type:"mattermost-deck:trace-storage",...request}) as Promise<Reply>,request);
  if(!result?.success)throw new Error(`Trace storage ${request.operation} failed`);
  return result;
}
export async function clearTraceEntries(context:BrowserContext,worker:Worker){return traceRequest(context,worker,{operation:"clear"});}
export async function setTraceCapture(context:BrowserContext,worker:Worker,enabled:boolean){return traceRequest(context,worker,{operation:"setCapture",enabled});}
export async function appendTraceEntries(context:BrowserContext,worker:Worker,entries:TraceLogEntry[]){
  let state=await traceRequest(context,worker,{operation:"get"});
  if(!state.captureEnabled)state=await setTraceCapture(context,worker,true);
  return traceRequest(context,worker,{operation:"append",generation:state.generation,entries});
}
export async function readTraceEntries(context:BrowserContext,worker:Worker,options:Omit<TraceStorageRequest,"operation"|"offset"|"limit">={}):Promise<TraceLogEntry[]>{
  const entries:TraceLogEntry[]=[];const seen=new Set<string>();const from=options.from??Date.now()-24*60*60_000,to=options.to??Date.now();let offset=0,hasMore=true;
  while(hasMore&&offset<10_000){
    const result=await traceRequest(context,worker,{...options,operation:"query",from,to,offset,limit:100});
    for(const entry of result.entries)if(!entry.id||!seen.has(entry.id)){entries.push(entry);if(entry.id)seen.add(entry.id);}
    hasMore=result.hasMore??false;offset+=result.entries.length;
    if(result.entries.length===0)break;
  }
  return entries;
}

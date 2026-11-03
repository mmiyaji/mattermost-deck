import { test, expect, chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import fs from "node:fs/promises";

test("unchanged progressive refreshes do not reposition a virtual list being read", async ({}, info) => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React, {useMemo,useState} from "react";
    import {createRoot} from "react-dom/client";
    import {VirtualPostList} from "./src/ui/VirtualPostList";
    const posts=Array.from({length:100},(_,i)=>({key:String(i),height:i%3===0?240:110}));
    function App(){
      const [viewport,setViewport]=useState(null);
      const [revision,setRevision]=useState(0);
      const entries=useMemo(()=>posts.map(post=>({...post})),[revision]);
      window.refresh=()=>setRevision(value=>value+1);
      return <><header>Updating mentions · {revision}/30 teams</header><div id="viewport" ref={setViewport} style={{height:420,width:340,overflow:"auto"}}>
        {viewport&&<VirtualPostList entries={entries} viewport={viewport} compact={false} reversed={false}
          renderEntry={entry=><article data-deck-entry-key={entry.key} style={{height:entry.height,boxSizing:"border-box",padding:16,border:"1px solid gray"}}>Post {entry.key} — variable height cached message</article>}/>}</div></>;
    }
    createRoot(document.getElementById("root")).render(<App/>);
  `}, bundle: true, write: false, define: { "process.env.NODE_ENV": '"production"' } });
  const script=result.outputFiles[0].text;
  const server=createServer((req,res)=>{if(req.url==="/app.js"){res.setHeader("Content-Type","application/javascript");res.end(script);}else{res.setHeader("Content-Type","text/html");res.end('<div id="root"></div><script src="/app.js"></script>');}});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const browser=await chromium.launch({channel:"chromium",headless:true});
  try{
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
    await expect(page.locator("article").first()).toBeVisible();
    await page.locator("#viewport").evaluate(node=>{node.scrollTop=6000;});
    await page.waitForTimeout(500);
    const report=await page.evaluate(async()=>{
      const viewport=document.getElementById("viewport")!;
      const visible=()=>Array.from(viewport.querySelectorAll<HTMLElement>("article")).filter(row=>{const r=row.getBoundingClientRect(),v=viewport.getBoundingClientRect();return r.top>=v.top&&r.bottom<=v.bottom;});
      const anchor=visible()[0], key=anchor.dataset.deckEntryKey!, baseline=anchor.getBoundingClientRect().top;
      const original=viewport.scrollTo.bind(viewport);
      let repositionCalls=0;
      viewport.scrollTo=((...args:any[])=>{repositionCalls++;(original as any)(...args);}) as typeof viewport.scrollTo;
      const scrollTop=Object.getOwnPropertyDescriptor(Element.prototype,"scrollTop")!;
      let positionWrites=0;
      Object.defineProperty(viewport,"scrollTop",{configurable:true,
        get:()=>scrollTop.get!.call(viewport),
        set:value=>{positionWrites++;scrollTop.set!.call(viewport,value);}});
      const samples:Array<{offset:number|null;count:number;top:number}>=[];
      for(let step=0;step<30;step++){
        (window as any).refresh();
        for(let frame=0;frame<5;frame++){
          await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
          const row=viewport.querySelector<HTMLElement>(`[data-deck-entry-key="${key}"]`);
          samples.push({offset:row?row.getBoundingClientRect().top-baseline:null,count:visible().length,top:viewport.scrollTop});
        }
      }
      return {positionWrites,repositionCalls,samples,maxDrift:Math.max(...samples.map(s=>Math.abs(s.offset??100000))),missingFrames:samples.filter(s=>s.offset===null||s.count===0).length};
    });
    await fs.writeFile(info.outputPath("refresh-stability.json"),JSON.stringify(report,null,2));
    expect(report.missingFrames).toBe(0);
    expect(report.maxDrift).toBeLessThan(1);
    expect(report.repositionCalls).toBe(0);
    expect(report.positionWrites).toBe(0);
  } finally {await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

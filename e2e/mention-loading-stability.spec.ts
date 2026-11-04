import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";

test("cached unread mentions stay mounted and stationary through progressive team loading", async ({}, info) => {
  test.setTimeout(90000);
  const user={id:"u".repeat(26),username:"tester",notify_props:{mention_keys:"tester",channel:"true"}};
  const author={id:"a".repeat(26),username:"author"};
  const teams=Array.from({length:3},(_,i)=>({id:`t${String(i).padStart(25,"0")}`,name:`team${i}`,display_name:`Team ${i}`}));
  const channels=teams.map((team,i)=>({id:`c${String(i).padStart(25,"0")}`,team_id:team.id,name:"town-square",display_name:`Town ${i}`,type:"O"}));
  const posts=Array.from({length:100},(_,i)=>({id:`p${String(i).padStart(25,"0")}`,channel_id:channels[i%3].id,user_id:author.id,create_at:Date.now()-i*60000,message:`@tester Cached unread ${i}\n`+(i%3===0?"Variable height message.\n".repeat(9):"A short message.")}));
  let slow=false;
  const held:Array<()=>void>=[];
  const server=createServer((req,res)=>{
    const p=new URL(req.url??"/","http://localhost").pathname.replace("/api/v4","");
    if(!req.url?.startsWith("/api/")){res.setHeader("Content-Type","text/html");res.end('<html><body class="app__body"><main id="root" class="app__content">Loading fixture</main></body></html>');return;}
    let data:unknown=[];
    if(p==="/users/me")data=user;
    else if(p==="/users/ids")data=[user,author];
    else if(p==="/users/me/teams")data=teams;
    else if(p.startsWith("/config/client"))data={CollapsedThreads:"disabled"};
    else if(p==="/system/ping")data={status:"OK"};
    else if(p.endsWith("/teams/unread"))data=teams.map(team=>({team_id:team.id,msg_count:100,mention_count:100}));
    else if(p.endsWith("/channels/members"))data=channels.map(channel=>({user_id:user.id,channel_id:channel.id,last_viewed_at:0,mention_count:0}));
    else if(p.endsWith("/channels"))data=channels;
    else if(p.startsWith("/channels/"))data=channels.find(c=>p.includes(c.id))??channels[0];
    else if(p.endsWith("/posts/search")){
      const teamIndex=teams.findIndex(team=>p.includes(team.id));
      const teamPosts=posts.filter(post=>post.channel_id===channels[Math.max(teamIndex,0)].id);
      data={order:teamPosts.map(post=>post.id),posts:Object.fromEntries(teamPosts.map(post=>[post.id,post]))};
    }
    else if(p.includes("/threads"))data={total:0,total_unread_threads:0,threads:[]};
    const send=()=>{if(!res.destroyed){res.setHeader("Content-Type","application/json");res.end(JSON.stringify(data));}};
    if(slow&&p.endsWith("/posts/search"))held.push(send);else send();
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),"deck-loading-stability-"));
  const extension=path.resolve("dist");
  const context=await chromium.launchPersistentContext(profile,{channel:"chromium",headless:true,viewport:{width:1200,height:900},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try{
    const worker=context.serviceWorkers()[0]??await context.waitForEvent("serviceworker");
    const options=await waitForInstalledOptions(context,worker);
    await worker.evaluate(async origin=>chrome.storage.local.set({"mattermostDeck.serverUrl.v1":origin,"mattermostDeck.language.v1":"en","mattermostDeck.pollingIntervalSeconds.v1":3600,"mattermostDeck.layout.v1":[{id:"unread",type:"mentions",unreadOnly:true}]}),origin);
    const page=await context.newPage();
    await page.setViewportSize({width:1200,height:480});
    const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    const inside=async(action:string)=>worker.evaluate(async({origin,action})=>{
      const tab=(await chrome.tabs.query({})).find(tab=>tab.url?.startsWith(origin));
      const [result]=await chrome.scripting.executeScript({target:{tabId:tab!.id!},func:action=>{
        const host=document.getElementById("mattermost-deck-root");
        if(!host)return null;
        const root=(chrome as any).dom.openOrClosedShadowRoot(host) as ShadowRoot;
        const pane=root?.querySelector('[data-pane-id="unread"]');
        const viewport=pane?.querySelector<HTMLElement>(".deck-list-viewport");
        if(action==="inspect"){const first=viewport?.querySelector<HTMLElement>("[data-deck-post-id]");const status=pane?.querySelector<HTMLElement>(".deck-column-loading-status");const header=pane?.querySelector<HTMLElement>(".deck-column-header");const rect=(el?:HTMLElement|null)=>el?{top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom}:null;return{rows:viewport?.querySelectorAll("[data-deck-post-id]").length??0,busy:!!pane?.querySelector('[aria-busy="true"]'),loading:!!status,twoRows:!!root?.querySelector(".deck-columns--two-rows"),text:pane?.textContent,author:first?.querySelector(".deck-card-author-label")?.textContent,meta:first?.querySelector(".deck-card-meta")?.textContent,gap:status&&first?first.getBoundingClientRect().top-status.getBoundingClientRect().bottom:null,header:rect(header),list:rect(viewport),status:rect(status),first:rect(first)};}
        if(!viewport)return null;
        if(action==="scroll"){viewport.scrollTop=600;return true;}
        if(action==="monitor"){
          const bounds=viewport.getBoundingClientRect();
          const anchor=Array.from(viewport.querySelectorAll<HTMLElement>("[data-deck-post-id]")).find(row=>{const r=row.getBoundingClientRect();return r.top>=bounds.top&&r.bottom<=bounds.bottom;})!;
          const key=anchor.dataset.deckPostId!, baseline=anchor.getBoundingClientRect().top;
          const report={running:true,frames:0,missing:0,maxDrift:0,replaced:0,scrollTop:viewport.scrollTop};
          (window as any).__loadingReport=report;
          const sample=()=>{
            if(!report.running)return;
            const current=pane!.querySelector<HTMLElement>(`[data-deck-post-id="${key}"]`);
            report.frames++;
            if(!current||!viewport.isConnected)report.missing++;
            else{report.maxDrift=Math.max(report.maxDrift,Math.abs(current.getBoundingClientRect().top-baseline));if(current!==anchor)report.replaced++;}
            requestAnimationFrame(sample);
          };requestAnimationFrame(sample);return true;
        }
        if(action==="stop"){const report=(window as any).__loadingReport;report.running=false;return report;}
        return null;
      },args:[action]});return result.result as any;
    },{origin,action});
    await page.goto(`${origin}/team0/channels/town-square`);
    await expect.poll(async()=> (await inside("inspect"))?.text).toContain("Cached unread 0");
    await expect.poll(async()=> (await inside("inspect"))?.loading).toBe(false);
    await expect.poll(()=>options.evaluate(async({origin,userId})=>{
      const response=await chrome.runtime.sendMessage({type:"mattermost-deck:mention-cache-storage",operation:"get",persist:true,key:JSON.stringify([origin+"/",userId,"all"])});return response.snapshot?.posts.length;
    },{origin,userId:user.id})).toBe(100);
    slow=true;
    await page.reload();
    await expect.poll(async()=> (await inside("inspect"))?.rows).toBeGreaterThan(0);
    await expect.poll(()=>held.length).toBeGreaterThan(0);
    // Confirm cached labels resolve while the full mention search is held.
    await expect.poll(async()=> (await inside("inspect"))?.author).toBe("@author");
    await expect.poll(async()=> (await inside("inspect"))?.meta).toContain("Town 0");
    const rowGeometry=await inside("inspect");
    await page.screenshot({path:info.outputPath("mention-loading-row.png")});
    expect(rowGeometry?.loading).toBe(true);
    expect(rowGeometry?.gap).toBeGreaterThanOrEqual(8);
    expect(rowGeometry?.gap).toBeLessThanOrEqual(12);
    for(const release of held.splice(0))release();
    await worker.evaluate(async()=>chrome.storage.local.set({"mattermostDeck.layoutMode.v1":"twoRows"}));
    await page.reload();
    await expect.poll(async()=> (await inside("inspect"))?.loading).toBe(true);
    await expect.poll(()=>held.length).toBeGreaterThan(0);
    const splitGeometry=await inside("inspect");
    expect(splitGeometry?.twoRows).toBe(true);
    await page.screenshot({path:info.outputPath("mention-loading-two-rows.png")});
    expect(splitGeometry?.gap).toBeGreaterThanOrEqual(8);
    expect(splitGeometry?.gap).toBeLessThanOrEqual(12);
    await fs.writeFile(info.outputPath("mention-loading-geometry.json"),JSON.stringify({row:{gap:rowGeometry?.gap,header:rowGeometry?.header,status:rowGeometry?.status,list:rowGeometry?.list,first:rowGeometry?.first},twoRows:{gap:splitGeometry?.gap,header:splitGeometry?.header,status:splitGeometry?.status,list:splitGeometry?.list,first:splitGeometry?.first}},null,2));
    for(const release of held.splice(0))release();
    await worker.evaluate(async()=>chrome.storage.local.set({"mattermostDeck.layoutMode.v1":"row"}));
    await page.reload();
    await expect.poll(async()=> (await inside("inspect"))?.loading).toBe(true);
    await expect.poll(()=>held.length).toBeGreaterThan(0);
    await inside("scroll");await page.waitForTimeout(500);
    await inside("monitor");
    for(let i=0;i<3;i++){
      await expect.poll(()=>held.length).toBeGreaterThan(0);
      held.shift()!();await page.waitForTimeout(450);
    }
    slow=false;for(const release of held.splice(0))release();
    await expect.poll(async()=> (await inside("inspect"))?.loading,{timeout:15000}).toBe(false);
    await page.waitForTimeout(500);
    const report=await inside("stop");
    await fs.writeFile(info.outputPath("loading-stability.json"),JSON.stringify(report,null,2));
    await page.screenshot({path:info.outputPath("unread-after-loading.png")});
    expect(report.frames).toBeGreaterThan(30);
    expect(report.missing).toBe(0);
    expect(report.replaced).toBe(0);
    expect(report.maxDrift).toBeLessThan(1);
    expect(errors).toEqual([]);
  }finally{slow=false;for(const release of held.splice(0))release();await context.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(profile,{recursive:true,force:true});}
});

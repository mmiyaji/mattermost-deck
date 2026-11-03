import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForInstalledOptions } from "./extension-install";

test("polling reconciles startup cache and reused scans without hiding edits behind new-post updates", async ({}, info) => {
  test.setTimeout(90000);
  const user={id:"u".repeat(26),username:"tester",notify_props:{mention_keys:"tester",channel:"true"}};
  const author={id:"a".repeat(26),username:"author"};
  const team={id:"t".repeat(26),name:"testteam",display_name:"Test team"};
  const channel={id:"c".repeat(26),team_id:team.id,name:"town-square",display_name:"Town Square",type:"O"};
  const now=Date.now();
  const original=Array.from({length:3},(_,i)=>({id:`p${String(i).padStart(25,"0")}`,channel_id:channel.id,user_id:author.id,create_at:now-i*60000,update_at:now-i*60000,message:`@tester ${["Before edit","Deleted later","Outside search window"][i]}`}));
  let alive=[...original], phase=0, failLookup=false, searches=0;
  let releaseSearch:(()=>void)|undefined;
  const batches:string[][]=[];
  const server=createServer(async(req,res)=>{
    const p=new URL(req.url??"/","http://localhost").pathname.replace("/api/v4","");
    if(!req.url?.startsWith("/api/")){res.setHeader("Content-Type","text/html");res.end('<html><body class="app__body"><main id="root" class="app__content">Polling fixture</main></body></html>');return;}
    let data:unknown=[];
    if(p==="/users/me")data=user;
    else if(p==="/users/ids")data=[user,author];
    else if(p==="/users/me/teams")data=[team];
    else if(p.startsWith("/config/client"))data={CollapsedThreads:"disabled"};
    else if(p==="/system/ping")data={status:"OK"};
    // Keep unread counters unchanged across edit/delete to exercise scan reuse.
    else if(p.endsWith("/teams/unread"))data=[{team_id:team.id,msg_count:3,mention_count:3}];
    else if(p.endsWith("/channels/members"))data=[{user_id:user.id,channel_id:channel.id,last_viewed_at:0,mention_count:0}];
    else if(p.endsWith("/channels"))data=[channel];
    else if(p.startsWith("/channels/"))data=channel;
    else if(p.endsWith("/posts/search")){
      searches++;
      const found=phase===0?alive:alive.filter(post=>post.id!==original[2].id);
      data={order:found.map(post=>post.id),posts:Object.fromEntries(found.map(post=>[post.id,post]))};
      if(phase===1)await new Promise<void>(resolve=>{releaseSearch=resolve;});
    }
    else if(p==="/posts/ids"){
      let body="";for await(const part of req)body+=part;
      const ids=JSON.parse(body) as string[];batches.push(ids);
      if(failLookup){res.statusCode=500;data={message:"Temporary fixture failure"};}
      else data=[...alive, ...(phase>0 ? [{...original[1],delete_at:now+1500}] : [])].filter(post=>ids.includes(post.id));
    }
    else if(p.includes("/threads"))data={total:0,total_unread_threads:0,threads:[]};
    res.setHeader("Content-Type","application/json");res.end(JSON.stringify(data));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),"deck-polling-reconcile-"));
  const extension=path.resolve("dist");
  const context=await chromium.launchPersistentContext(profile,{channel:"chromium",headless:true,viewport:{width:1500,height:900},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try{
    const worker=context.serviceWorkers()[0]??await context.waitForEvent("serviceworker");
    const options=await waitForInstalledOptions(context,worker);
    await worker.evaluate(async origin=>chrome.storage.local.set({"mattermostDeck.serverUrl.v1":origin,"mattermostDeck.language.v1":"en","mattermostDeck.pollingIntervalSeconds.v1":"15","mattermostDeck.layout.v1":[{id:"normal",type:"mentions"},{id:"unread",type:"mentions",unreadOnly:true},{id:"review",type:"mentions",mentionReview:true}]}),origin);
    const page=await context.newPage();
    const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    const inspect=()=>worker.evaluate(async origin=>{
      const tab=(await chrome.tabs.query({})).find(tab=>tab.url?.startsWith(origin));
      const [result]=await chrome.scripting.executeScript({target:{tabId:tab!.id!},func:()=>{
        const host=document.getElementById("mattermost-deck-root");if(!host)return null;
        const root=(chrome as any).dom.openOrClosedShadowRoot(host) as ShadowRoot;
        return [...root.querySelectorAll(".deck-column--mentions")].map(pane=>({id:pane.getAttribute("data-deck-column-id"),
          rows:[...pane.querySelectorAll("[data-deck-post-id]")].map(row=>({id:(row as HTMLElement).dataset.deckPostId,text:row.textContent})),
          busy:!!pane.querySelector('[aria-busy="true"]'),update:pane.querySelector(".deck-mention-updates-button")?.textContent,
          badge:pane.querySelector(".deck-badge")?.textContent}));
      }});return result.result as any;
    },origin);
    const rows=async()=>JSON.stringify((await inspect())?.map((pane:any)=>pane.rows));
    await page.goto(`${origin}/testteam/channels/town-square`);
    await page.bringToFront();
    await expect.poll(rows).toContain("Before edit");
    await expect.poll(()=>options.evaluate(async({origin,userId})=>{
      const response=await chrome.runtime.sendMessage({type:"mattermost-deck:mention-cache-storage",operation:"get",persist:true,key:JSON.stringify([origin+"/",userId,"all"])});return response.snapshot?.posts.length;
    },{origin,userId:user.id})).toBe(3);
    alive=[{...original[0],message:"@tester Edited while closed",update_at:now+1000},original[2],{...original[0],id:"n".repeat(26),create_at:now+2000,update_at:now+2000,message:"@tester New pending arrival"}];
    phase=1;
    await page.reload();
    await expect.poll(rows).toContain("Before edit");
    await expect.poll(()=>!!releaseSearch).toBe(true);
    phase=2;releaseSearch!();releaseSearch=undefined;
    await expect.poll(rows).toContain("Edited while closed");
    await expect.poll(rows).not.toContain("Deleted later");
    await expect.poll(rows).not.toContain("Before edit");
    await expect.poll(rows).toContain("Outside search window");
    expect(JSON.stringify((await inspect())?.find((pane:any)=>pane.id==="normal")?.rows)).not.toContain("New pending arrival");
    await expect.poll(async()=> !!(await inspect())?.find((pane:any)=>pane.id==="normal")?.update).toBe(true);
    expect(batches.some(batch=>batch.includes(original[1].id)&&batch.includes(original[2].id))).toBe(true);
    // A later poll reuses the team's unchanged counters and still checks bodies.
    const priorSearches=searches;
    alive=alive.map(post=>post.id===original[0].id?{...post,message:"@tester Edited with unchanged counters",update_at:now+3000}:post);
    await expect.poll(rows,{timeout:30000}).toContain("Edited with unchanged counters");
    expect(searches).toBe(priorSearches);
    // A failed verification must not remove a cached item outside search.
    failLookup=true;
    await page.reload();
    await expect.poll(rows).toContain("Outside search window");
    await expect.poll(async()=> (await inspect())?.every((pane:any)=>!pane.busy),{timeout:15000}).toBe(true);
    expect(await rows()).toContain("Outside search window");
    await page.screenshot({path:info.outputPath("polling-edits-and-deletions.png")});
    await fs.writeFile(info.outputPath("polling-evidence.json"),JSON.stringify({searches,batches,state:await inspect()},null,2));
    expect(errors).toEqual([]);
  }finally{releaseSearch?.();await context.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(profile,{recursive:true,force:true});}
});

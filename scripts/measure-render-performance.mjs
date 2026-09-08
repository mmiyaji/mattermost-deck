// Runs the real PostList and log hooks in production React/Chromium with fixed
// data. This isolates rendering from server latency; it is not a full App E2E.
// Capture before editing, then compare both immutable bundles in alternating order:
// node scripts/measure-render-performance.mjs capture baseline
// node scripts/measure-render-performance.mjs capture candidate
// node scripts/measure-render-performance.mjs compare baseline candidate
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const directory = path.resolve("test-results/render-performance");
const args = process.argv.slice(2);
const disablePostReuse = args.includes('--no-post-reuse');
const cycleArg = args.find(arg => arg.startsWith('--cycles='));
const soakCycles = cycleArg ? Number(cycleArg.slice('--cycles='.length)) : 50;
if (!Number.isInteger(soakCycles) || soakCycles < 1 || soakCycles > 1000) throw new Error('cycles must be 1-1000');
const [command, ...labels] = args.filter(arg => arg !== '--no-post-reuse' && arg !== cycleArg);
if (!labels.length || labels.some((label) => !/^[a-z0-9-]+$/.test(label))) {
  throw new Error("Use capture, compare, or soak <label> [<label> ...]");
}
await fs.mkdir(directory, { recursive: true });

if (command === "capture") {
  const source = await fs.readFile("src/ui/App.tsx", "utf8");
  const isolatedLogs = source.includes("const syncLogStore = useSyncLogStore()");
  const reusePosts = !disablePostReuse && source.includes("reuseUnchangedPostState(current");
  const result = await build({
    stdin: {
      contents: `
        import React, {useState, useLayoutEffect} from 'react';
        import {createRoot} from 'react-dom/client';
        import {flushSync} from 'react-dom';
        import {PostList ${isolatedLogs ? "" : ", useSyncLogs"}} from './src/ui/App';
        ${isolatedLogs ? "import {useSyncLogStore, useSyncLogs} from './src/ui/syncLogs';" : ""}
        ${reusePosts ? "import {reuseUnchangedPosts} from './src/ui/postState';" : ""}
        import {railCssText} from './src/ui/styles';
        import i18n from './src/ui/i18n';
        await i18n.changeLanguage('en');
        const counters = window.counters = {parentCommits: 0, resizeObservers: 0, intersectionObservers: 0, activeResizeTargets: 0, activeIntersectionTargets: 0};
        for (const [name, key] of [['ResizeObserver', 'resizeObservers'], ['IntersectionObserver', 'intersectionObservers']]) {
          const Original = window[name];
          const activeKey = name === 'ResizeObserver' ? 'activeResizeTargets' : 'activeIntersectionTargets';
          window[name] = class extends Original {
            targets = new Set();
            constructor(...args) { super(...args); counters[key]++; }
            observe(target, ...args) { super.observe(target, ...args); if (!this.targets.has(target)) {this.targets.add(target); counters[activeKey]++;} }
            unobserve(target) { super.unobserve(target); if (this.targets.delete(target)) counters[activeKey]--; }
            disconnect() { super.disconnect(); counters[activeKey] -= this.targets.size; this.targets.clear(); }
          };
        }
        const posts = Array.from({length: 100}, (_, i) => ({
          id: 'post-' + i, user_id: 'user', channel_id: 'channel',
          create_at: 1700000000000 - i * 60000, update_at: 1700000000000 - i * 60000,
          message: 'Fixed performance fixture ' + i + ' https://example.org/test #monitoring',
          root_id: '', type: '', props: {}, file_ids: []
        }));
        const users = {user: {id: 'user', username: 'Fixture'}};
        function Logs({value}) {
          const logs = ${isolatedLogs ? "useSyncLogs(value)" : "value"};
          return <output id="logs">{JSON.stringify(logs)}</output>;
        }
        function Fixture() {
          const value = ${isolatedLogs ? "useSyncLogStore()" : "useSyncLogs()"};
          const [items, setItems] = useState(posts);
          const [showLogs, setShowLogs] = useState(false);
          window.replacePosts = (changed = false) => setItems(current => {
            const incoming = current.map(post => ({...post}));
            // Change the last item to exercise the full comparison prefix.
            if (changed) {
              const last = incoming[incoming.length - 1];
              const revision = (last.props.fixtureRevision ?? 0) + 1;
              last.props = {...last.props, fixtureRevision: revision};
              last.message = 'Edited revision ' + revision;
            }
            return ${reusePosts ? "reuseUnchangedPosts(current, incoming)" : "incoming"};
          });
          window.showLogs = setShowLogs;
          useLayoutEffect(() => { counters.parentCommits++; });
          return <><div style={{display: 'flex', height: 640}}>{[0,1,2].map(index =>
            <section className="deck-column" key={index} style={{width: 360, height: 640}}>
              <PostList posts={items} userDirectory={users} compactMode={true}
                postClickAction="none" highlightTerms={['fixture']} />
            </section>)}</div>{showLogs && <Logs value={value}/>}</>;
        }
        const host = document.createElement('div'); document.body.append(host);
        const shadow = host.attachShadow({mode:'open'});
        const style = document.createElement('style'); style.textContent = railCssText; shadow.append(style);
        const mount = document.createElement('div'); shadow.append(mount);
        let root = createRoot(mount);
        flushSync(() => root.render(<Fixture/>));
        window.runWorkload = (kind, count) => {
          const before = {...counters};
          const started = performance.now();
          for(let i = 0; i < count; i++) flushSync(() => {
            if(kind === 'logs') window.dispatchEvent(new CustomEvent('mattermost-deck-api-log', {
              detail: {level: 'info', message: 'request-' + i, timestamp: i}
            })); else window.replacePosts(kind === 'changedPosts');
          });
          return {durationMs: performance.now() - started,
            ...Object.fromEntries(Object.keys(before).map(key => [key, counters[key] - before[key]]))};
        };
        window.verifyLogs = () => {
          flushSync(() => window.showLogs(true));
          const retained = JSON.parse(shadow.querySelector('#logs').textContent);
          flushSync(() => window.dispatchEvent(new CustomEvent('mattermost-deck-ws-log', {
            detail: {level:'warn', message:'live-ws', timestamp: 1000}
          })));
          const live = JSON.parse(shadow.querySelector('#logs').textContent);
          flushSync(() => window.showLogs(false));
          return {retained, live};
        };
        window.verifyResize = async () => {
          const section = shadow.querySelector('section');
          section.style.height = '400px';
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return section.querySelector('.deck-list-viewport').clientHeight;
        };
        window.readLastPost = () => shadow.querySelectorAll('.deck-post-compact-body')[99].textContent;
        window.disposeFixture = () => flushSync(() => root.unmount());
        window.mountFixture = () => {root = createRoot(mount); flushSync(() => root.render(<Fixture/>));};
        window.ready = true;
      `,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, format: "esm", minify: true,
    define: { "process.env.NODE_ENV": '"production"', __STORE_BUILD__: "false" },
    plugins: [{name: "private-component-fixture", setup(builder) {
      builder.onLoad({filter: /[/\\]App\.tsx$/}, () => ({
        contents: source + `\nexport {PostList${isolatedLogs ? "" : ", useSyncLogs"}};`, loader: "tsx",
        resolveDir: path.resolve("src/ui"),
      }));
    }}],
  });
  await fs.writeFile(path.join(directory, `${labels[0]}.js`), result.outputFiles[0].text);
  console.log(`Captured ${labels[0]} (${isolatedLogs ? "isolated" : "parent"} log subscription)`);
} else if (command === "soak") {
  const browser = await chromium.launch({channel: 'chromium', headless: true});
  const results = [];
  try {
    for (const label of labels) {
      const page = await browser.newPage({viewport: {width: 1200, height: 800}});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://fixture.test/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><html><body></body></html>'}));
      await page.goto('http://fixture.test/');
      await page.addScriptTag({type: 'module', content: await fs.readFile(path.join(directory, `${label}.js`), 'utf8')});
      await page.waitForFunction(() => window.ready);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      const samples = [];
      const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const started = performance.now();
      for (let cycle = 0; cycle <= soakCycles; cycle++) {
        await settle();
        const mounted = await page.evaluate(() => ({...window.counters}));
        if (mounted.activeIntersectionTargets !== 300) throw new Error(`${label}: lost visibility targets`);
        await page.evaluate(() => window.disposeFixture());
        const disposed = await page.evaluate(() => ({...window.counters}));
        if (disposed.activeIntersectionTargets || disposed.activeResizeTargets) throw new Error(`${label}: observers retained after unmount`);
        if (cycle % 10 === 0 || cycle === soakCycles) {
          // Let already queued native observer callbacks and React cleanup
          // finish before measuring detached DOM retention.
          await settle();
          await cdp.send('HeapProfiler.collectGarbage');
          const dom = await cdp.send('Memory.getDOMCounters');
          const {metrics} = await cdp.send('Performance.getMetrics');
          samples.push({cycle, mounted, disposed, dom, heapBytes: metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value});
        }
        if (cycle < soakCycles) await page.evaluate(() => window.mountFixture());
      }
      if (errors.length) throw new Error(errors.join('\n'));
      results.push({label, durationMs: performance.now() - started, samples});
      await page.close();
    }
  } finally {await browser.close();}
  const report = {browser: browser.version(), cycles: soakCycles, note: 'Accelerated mount/unmount component soak, not elapsed-days or full App E2E', results};
  await fs.writeFile(path.join(directory, 'stability.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(results.map(result => ({label: result.label, first: result.samples[0], last: result.samples.at(-1)})), null, 2));
} else if (command === "compare") {
  const browser = await chromium.launch({channel: "chromium", headless: true});
  const results = [];
  try {
    for (let round = 0; round < 5; round++) {
      for (const label of round % 2 ? [...labels].reverse() : labels) {
        const page = await browser.newPage({viewport: {width: 1200, height: 800}});
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.route("http://fixture.test/**", route => route.fulfill({
          contentType: "text/html", body: "<!doctype html><html><body></body></html>",
        }));
        await page.goto("http://fixture.test/");
        await page.addScriptTag({type: "module", content: await fs.readFile(path.join(directory, `${label}.js`), "utf8")});
        await page.waitForFunction(() => window.ready).catch(error => {
          throw new Error(errors.join('\n') || error.message);
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const initial = await page.evaluate(() => ({...window.counters}));
        await page.evaluate(() => {window.runWorkload('logs', 10); window.runWorkload('posts', 10);});
        const logs = await page.evaluate(() => window.runWorkload('logs', 60));
        const verification = await page.evaluate(() => window.verifyLogs());
        if (verification.retained.length !== 20 || verification.retained[0].message !== 'request-59' || verification.live[0].message !== 'live-ws') {
          throw new Error(`${label}: log retention/live subscription regression`);
        }
        const posts = await page.evaluate(() => window.runWorkload('posts', 60));
        const supportsChanged = await page.evaluate(() => typeof window.readLastPost === 'function');
        let changedPosts;
        if (supportsChanged) {
          changedPosts = await page.evaluate(() => window.runWorkload('changedPosts', 60));
          const content = await page.evaluate(() => window.readLastPost());
          if (content !== 'Edited revision 60') throw new Error(`${label}: edited post was not rendered: ${content}`);
        }
        const resizedHeight = await page.evaluate(() => window.verifyResize());
        if (!(resizedHeight > 0 && resizedHeight <= 400)) throw new Error(`${label}: resize regression: ${resizedHeight}`);
        await page.evaluate(() => window.disposeFixture());
        if (errors.length) throw new Error(errors.join('\n'));
        results.push({label, round, initial, logs, posts, ...(changedPosts ? {changedPosts} : {}), resizedHeight});
        await page.close();
      }
    }
  } finally { await browser.close(); }
  const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)];
  const summary = labels.map(label => {
    const runs = results.filter(result => result.label === label);
    return {label, ...Object.fromEntries(['logs', 'posts', 'changedPosts'].filter(kind => runs[0][kind]).map(kind => [kind,
      Object.fromEntries(Object.keys(runs[0][kind]).map(key => [key, median(runs.map(run => run[kind][key]))]))]))};
  });
  const bundles = Object.fromEntries(await Promise.all(labels.map(async label => [label,
    createHash('sha256').update(await fs.readFile(path.join(directory, `${label}.js`))).digest('hex')])));
  const report = {environment: {
    measuredAt: new Date().toISOString(), browser: browser.version(), node: process.version,
    platform: process.platform, cpu: os.cpus()[0]?.model, react: 'production',
    panes: 3, postsPerPane: 100, updates: 60, rounds: 5,
  }, bundles, summary, results};
  await fs.writeFile(path.join(directory, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} else { throw new Error('Expected capture, compare, or soak'); }

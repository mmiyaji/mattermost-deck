import React, { useMemo } from "react";
import type { TraceLogEntry } from "../traceLog";
import { analyzePerformance } from "./performanceAnalysis";

export function PerformanceOverview({ entries, language, capturing }: { entries: TraceLogEntry[]; language: string; capturing: boolean }) {
  const a = useMemo(() => analyzePerformance(entries), [entries]);
  const ja = language === "ja";
  const label = (jp: string, en: string) => ja ? jp : en;
  const ms = (n: number | null) => n === null ? "—" : `${Math.round(n).toLocaleString(language)} ms`;
  const time = (n: number) => new Date(n).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  const date = (n: number) => new Date(n).toLocaleString(language);
  const titles = {
    empty: label("APIの記録がありません", "No API samples recorded"),
    unknown: label("待ち時間の内訳を判定できません", "Latency breakdown is unavailable"),
    errors: label("失敗したリクエストがあります", "Some requests failed"),
    queue: label("拡張内の待ち時間が大きくなっています", "Waiting inside Deck dominates latency"),
    network: label("通信・応答に時間がかかっています", "Network and response time is elevated"),
    clear: label("記録内に目立った待ち・失敗はありません", "No prominent delays or failures in this recording"),
  };
  const hints = {
    empty: label("記録をONにして、重く感じる操作を行ってください。", "Enable recording, then repeat the slow interaction."),
    unknown: label("内訳のない旧形式のログです。最新の拡張で記録をONにして、操作を再現してください。", "These records lack measured timing breakdowns. Record the interaction again with the latest extension."),
    errors: label("下のリクエスト詳細でステータスやエラーを確認してください。待ち時間の内訳も併せて確認できます。", "Inspect statuses and errors in the request details below, alongside the latency breakdown."),
    queue: label("取得処理の集中や並列数・レート制限が候補です。下の詳細設定と、呼び出し回数の多い処理を確認してください。", "Bursts, concurrency, or rate limits may contribute. Check advanced settings and frequently called endpoints below."),
    network: label("この値には通信・応答・本文読み取りが含まれます。サーバー処理だけの時間ではありません。", "This includes transport, response, and body reading; it does not isolate server processing."),
    clear: label("APIログだけでは画面操作の重さは判断できません。描画やメモリーの調査にはブラウザーのPerformanceも使用してください。", "API logs cannot establish UI responsiveness. Use the browser Performance tools for rendering and memory."),
  };
  const maxMs = Math.max(1, ...a.buckets.map(b => (b.wait ?? 0) + (b.network ?? 0)));
  const maxCount = Math.max(1, ...a.buckets.map(b => b.count));
  const waitLabel = label("拡張内の待ち", "Waiting inside Deck");
  const netLabel = label("通信・応答", "Network / response");
  return <div className="perf-overview" data-testid="performance-overview">
    <section className={`perf-finding perf-finding--${a.status}`} aria-labelledby="perf-finding-title">
      <div className="perf-period">{label("保存ログの分析", "Retained log analysis")} · {capturing ? label("記録中", "Recording") : label("記録OFF", "Recording off")}</div>
      <h3 id="perf-finding-title">{titles[a.status]}</h3><p>{hints[a.status]}</p>
      <p className="options-hint">{a.start !== null && a.end !== null ? `${date(a.start)} → ${date(a.end)} · ${a.samples} ${label("リクエスト", "requests")}` : label("記録待ち", "Awaiting samples")}</p>
      <p className="options-hint">{label("保存済み最大500ログの集計です。現在のキュー待ち数や、操作全体の所要時間ではありません。判定目安：平均待ち500 ms以上かつ通信・応答より長い／平均通信・応答1,000 ms以上。", "Aggregates up to 500 retained log entries, not the live queue or full interaction time. Heuristics: average wait ≥500 ms and above response time, or average response ≥1,000 ms.")}</p>
    </section>
    <div className="perf-metrics">
      {[
        [label("平均リクエスト所要時間", "Average request time"), ms(a.total), label("受付から完了まで・待ち時間を含む", "From enqueue to completion, including waiting")],
        [waitLabel, ms(a.wait), label("実行枠・開始間隔・レート制限の待ち", "Waiting for slots, start spacing, and rate limits")],
        [netLabel, ms(a.network), label("所要時間 − 拡張内の待ち（平均）", "Average total time minus waiting")],
        [label("失敗 / 全リクエスト", "Failed / all requests"), `${a.failures} / ${a.samples}`, label("HTTPエラー・通信失敗を含む", "Includes HTTP and transport errors")],
      ].map(([title, value, hint]) => <article className="options-metric-card" key={title}><strong>{title}</strong><p>{value}</p><span className="options-hint">{hint}</span></article>)}
    </div>
    <div className="perf-facts">
      <span>{label("所要時間 p95", "Request time p95")}: <b>{ms(a.p95)}</b></span>
      <span>{label("レート制限待ちの記録", "Recorded rate-limit waits")}: <b>{a.rateWaits}</b></span>
      <span>{label("受付時の最大滞留数（実行中＋待機）", "Peak outstanding at enqueue (active + queued)")}: <b>{a.peakOutstanding ?? "—"}</b></span>
      <span>{label("内訳を計測できたリクエスト", "Requests with measured breakdown")}: <b>{a.pairedSamples} / {a.samples}</b></span>
    </div>
    <div className="perf-charts">
      {["latency", "count"].map(kind => <figure className="options-analysis-card" key={kind}>
        <figcaption><strong>{kind === "latency" ? label("待ち時間と通信・応答の推移", "Waiting and response over time") : label("リクエスト数と失敗の推移", "Requests and failures over time")}</strong>
          <p className="options-hint">{label("最終記録までの20分・1分ごと", "20 minutes ending at the last record · 1-minute buckets")}</p></figcaption>
        <div className="perf-legend">{kind === "latency" ? <><span className="perf-key perf-key--wait">{waitLabel}</span><span className="perf-key perf-key--network">{netLabel}</span></> : <><span className="perf-key perf-key--network">{label("成功", "Succeeded")}</span><span className="perf-key perf-key--error">{label("失敗", "Failed")}</span></>}</div>
        <svg className="perf-chart" viewBox="0 0 640 180" role="img" aria-label={kind === "latency" ? label("平均所要時間の内訳、単位ms", "Mean request time breakdown in milliseconds") : label("リクエスト数、単位件／分", "Requests per minute")}>
          <text x="0" y="14">{kind === "latency" ? `${Math.ceil(maxMs)} ms` : `${maxCount} ${label("件/分", "/min")}`}</text>
          <path d="M58 20H634 M58 140H634" className="perf-grid"/><text x="0" y="143">0</text>
          {a.buckets.map((b, i) => {
            const first = kind === "latency" ? b.network : b.count - b.errors;
            const second = kind === "latency" ? b.wait : b.errors;
            const max = kind === "latency" ? maxMs : maxCount;
            const h1 = (first ?? 0) / max * 120, h2 = (second ?? 0) / max * 120;
            return <g key={i} tabIndex={0}><title>{`${date(b.start)} · ${b.count} ${label("件", "requests")} · ${waitLabel}: ${ms(b.wait)} · ${netLabel}: ${ms(b.network)} · ${label("失敗", "failed")}: ${b.errors}`}</title>
              <rect className="perf-hit" x={60 + i * 28.5} y="20" width="25" height="122"/>
              <rect className="perf-bar-network" x={60 + i * 28.5} y={140 - h1} width="23" height={h1}/>
              <rect className={kind === "latency" ? "perf-bar-wait" : "perf-bar-error"} x={60 + i * 28.5} y={140 - h1 - h2} width="23" height={h2}/>
            </g>;
          })}
          {[0, 5, 10, 15, 19].map(i => <text key={i} x={60 + i * 28.5} y="164" textAnchor={i === 19 ? "end" : "start"}>{a.end === null ? "—" : time(a.buckets[i].start)}</text>)}
        </svg>
        <p className="options-hint">{label("空白は該当する記録なし。棒にポインターを合わせると値を表示します。", "Blank buckets have no matching samples. Hover a bar for values.")}</p>
      </figure>)}
    </div>
  </div>;
}

import React, { useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import type { TraceLogEntry } from "../traceLog";
import { analyzePerformance, normalizePerformanceRequests } from "./performanceAnalysis";
import { EMPTY_REQUEST_FILTER, filterPerformanceRequests, PERFORMANCE_REQUEST_PAGE_SIZE, type PerformanceRequestFilter } from "./performanceDrilldown";

export function PerformanceOverview({ entries, language, capturing }: { entries: TraceLogEntry[]; language: string; capturing: boolean }) {
  const a = useMemo(() => analyzePerformance(entries), [entries]);
  const requests = useMemo(() => normalizePerformanceRequests(entries), [entries]);
  const [filter, setFilter] = useState<PerformanceRequestFilter>(EMPTY_REQUEST_FILTER);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const details = useRef<HTMLElement>(null);
  const filtered = useMemo(() => filterPerformanceRequests(requests, filter), [requests, filter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PERFORMANCE_REQUEST_PAGE_SIZE));
  const effectivePage = Math.min(page, pageCount - 1);
  const displayed = filtered.slice(effectivePage * PERFORMANCE_REQUEST_PAGE_SIZE, (effectivePage + 1) * PERFORMANCE_REQUEST_PAGE_SIZE);
  const chooseFilter = (next: PerformanceRequestFilter, reveal = false) => {
    setFilter(next); setPage(0); setExpanded(null);
    if (reveal) {
      requestAnimationFrame(() => { details.current?.scrollIntoView({ behavior: "auto", block: "start" }); details.current?.focus({ preventScroll: true }); });
    }
  };
  const chooseMinute = (start: number, failedOnly: boolean) => chooseFilter({ failedOnly, minuteStart: start, status: "all", query: "" }, true);
  const chartData = useMemo(() => a.buckets.map(bucket => ({ ...bucket, succeeded: bucket.count - bucket.errors })), [a.buckets]);
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
      ].map(([title, value, hint]) => <article className="options-metric-card" key={title}><strong>{title}</strong><p>{value}</p><span className="options-hint">{hint}</span></article>)}
      <button type="button" className="options-metric-card perf-metric-action" data-testid="performance-failed-metric"
        onClick={() => chooseFilter({ ...EMPTY_REQUEST_FILTER, failedOnly: true }, true)} aria-controls="performance-request-details">
        <strong>{label("失敗 / 全リクエスト", "Failed / all requests")}</strong><p>{a.failures} / {a.samples}</p>
        <span className="options-hint">{label("失敗したリクエストを確認 →", "Inspect failed requests →")}</span>
      </button>
    </div>
    <div className="perf-facts">
      <span>{label("所要時間 p95", "Request time p95")}: <b>{ms(a.p95)}</b></span>
      <span>{label("レート制限待ちの記録", "Recorded rate-limit waits")}: <b>{a.rateWaits}</b></span>
      <span>{label("受付時の最大滞留数（実行中＋待機）", "Peak outstanding at enqueue (active + queued)")}: <b>{a.peakOutstanding ?? "—"}</b></span>
      <span>{label("内訳を計測できたリクエスト", "Requests with measured breakdown")}: <b>{a.pairedSamples} / {a.samples}</b></span>
    </div>
    <div className="perf-charts">
      {(["latency", "count"] as const).map(kind => <figure className="options-analysis-card" key={kind} data-testid={`performance-chart-${kind}`}>
        <figcaption><strong>{kind === "latency" ? label("待ち時間と通信・応答の推移", "Waiting and response over time") : label("リクエスト数と失敗の推移", "Requests and failures over time")}</strong>
          <p className="options-hint">{label("最終記録までの20分・1分ごと", "20 minutes ending at the last record · 1-minute buckets")} · {kind === "latency" ? label("平均 ms", "mean ms") : label("件／分", "requests/min")}</p></figcaption>
        <div className="perf-legend">{kind === "latency" ? <><span className="perf-key perf-key--wait">{waitLabel}</span><span className="perf-key perf-key--network">{netLabel}</span></> : <><span className="perf-key perf-key--network">{label("成功", "Succeeded")}</span><span className="perf-key perf-key--error">{label("失敗", "Failed")}</span></>}</div>
        <div className="perf-recharts-host" role="group" aria-label={kind === "latency" ? label("平均所要時間の内訳、単位ms", "Mean request time breakdown in milliseconds") : label("リクエスト数、単位件／分", "Requests per minute")}>
          <BarChart responsive style={{ width: "100%", minWidth: 0 }} height={240} data={chartData} accessibilityLayer margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--perf-grid, #d6deea)" />
            <XAxis dataKey="start" tickFormatter={value => a.end === null ? "—" : time(Number(value))} minTickGap={28} tick={{ fill: "var(--perf-muted, #62728a)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis width={56} allowDecimals={kind === "latency"} tickFormatter={value => Number(value).toLocaleString(language)} tick={{ fill: "var(--perf-muted, #62728a)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip labelFormatter={value => date(Number(value))} formatter={(value, name) => [kind === "latency" ? ms(typeof value === "number" ? value : null) : `${value ?? 0} ${label("件", "requests")}`, name]}
              contentStyle={{ background: "var(--perf-surface, #fff)", borderColor: "var(--perf-grid, #d6deea)", color: "var(--perf-text, #18263b)", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "var(--perf-text, #18263b)" }} cursor={{ fill: "var(--perf-selection, #eaf0f8)" }} />
            <Bar dataKey={kind === "latency" ? "network" : "succeeded"} name={kind === "latency" ? netLabel : label("成功", "Succeeded")} stackId="requests" fill="var(--perf-network, #4f83b6)" isAnimationActive={false}
              onClick={data => chooseMinute(Number(data.payload.start), false)} cursor="pointer" />
            <Bar dataKey={kind === "latency" ? "wait" : "errors"} name={kind === "latency" ? waitLabel : label("失敗", "Failed")} stackId="requests" fill={kind === "latency" ? "var(--perf-wait, #a97937)" : "var(--perf-error, #b83e42)"} isAnimationActive={false}
              onClick={data => chooseMinute(Number(data.payload.start), kind === "count")} cursor="pointer" />
          </BarChart>
        </div>
        <p className="options-hint">{label("空白は記録なし。棒を選択すると、その時間帯のリクエストを表示します。", "Blank buckets have no records. Select a bar to inspect that minute's requests.")}</p>
      </figure>)}
    </div>
    <section className="perf-request-details" id="performance-request-details" data-testid="performance-request-details" aria-labelledby="perf-request-heading" tabIndex={-1} ref={details}>
      <header className="perf-request-heading"><div><h3 id="perf-request-heading">{label("リクエストを調べる", "Inspect requests")}</h3><p className="options-hint">{label("失敗件数やグラフから絞り込み、各行を開いて原因を確認できます。", "Filter from a metric or chart, then expand a row to inspect its cause.")}</p></div>
        <span role="status" aria-live="polite" data-testid="performance-result-count">{filtered.length} / {requests.length} {label("件", "requests")}</span>
      </header>
      <div className="perf-request-filters">
        <div className="perf-filter-segment" role="group" aria-label={label("結果", "Outcome")}>
          <button type="button" data-testid="performance-filter-all" aria-pressed={!filter.failedOnly} onClick={() => chooseFilter({ ...filter, failedOnly: false })}>{label("すべて", "All")}</button>
          <button type="button" data-testid="performance-filter-failed" aria-pressed={filter.failedOnly} onClick={() => chooseFilter({ ...filter, failedOnly: true })}>{label("失敗のみ", "Failed only")}</button>
        </div>
        <label>{label("時間帯", "Time range")}<select data-testid="performance-time-filter" disabled={a.end === null} value={filter.minuteStart ?? "all"} onChange={event => chooseFilter({ ...filter, minuteStart: event.target.value === "all" ? null : Number(event.target.value) })}>
          <option value="all">{label("保存ログ全体", "All retained records")}</option>
          {(a.end === null ? [] : a.buckets).map(bucket => <option key={bucket.start} value={bucket.start}>{time(bucket.start)} · {bucket.count} {label("件", "requests")} / {label("失敗", "failed")} {bucket.errors}</option>)}
        </select></label>
        <label>{label("ステータス", "Status")}<select data-testid="performance-status-filter" value={filter.status} onChange={event => chooseFilter({ ...filter, status: event.target.value })}>
          <option value="all">{label("すべて", "All")}</option><option value="no-http">{label("HTTP応答なし／不明", "No / unknown HTTP response")}</option>
          {[...new Set(requests.flatMap(request => request.status === null ? [] : [request.status]))].sort((a, b) => a - b).map(status => <option key={status} value={status}>HTTP {status}</option>)}
        </select></label>
        <label className="perf-request-search">{label("API・エラーを検索", "Search API or error")}<input type="search" data-testid="performance-request-search" value={filter.query} onChange={event => chooseFilter({ ...filter, query: event.target.value })} placeholder={label("パス、呼び出し元、エラー", "Path, caller, or error")} /></label>
        <button type="button" className="options-button" data-testid="performance-reset-filters" onClick={() => chooseFilter(EMPTY_REQUEST_FILTER)} disabled={!filter.failedOnly && filter.minuteStart === null && filter.status === "all" && !filter.query}>{label("絞り込みを解除", "Reset filters")}</button>
      </div>
      <p className="perf-active-filter" data-testid="performance-active-filter">{filter.failedOnly ? label("失敗のみ", "Failed only") : label("すべての結果", "All outcomes")} · {filter.minuteStart === null ? label("保存ログ全体", "All retained records") : `${date(filter.minuteStart)} – ${time(filter.minuteStart + 60_000)}`}{filter.status !== "all" ? ` · ${filter.status === "no-http" ? label("HTTP応答なし／不明", "No / unknown HTTP response") : `HTTP ${filter.status}`}` : ""}{filter.query ? ` · “${filter.query}”` : ""}</p>
      {!displayed.length ? <p className="perf-request-empty" role="status" data-testid="performance-request-empty">{requests.length ? label("条件に一致するリクエストはありません。絞り込みを変更してください。", "No requests match these filters. Adjust the selection.") : label("リクエストの記録がありません。記録をONにして操作してください。", "No requests recorded. Enable recording and repeat the interaction.")}</p> : <div className="perf-request-table-scroll"><table className="perf-request-table" data-testid="performance-request-table">
        <caption className="perf-sr-only">{label("保存ログのリクエスト。各行の詳細ボタンで内訳を確認できます。", "Retained requests. Expand a row for its timing and error details.")}</caption>
        <thead><tr>{[label("時刻", "Time"), label("結果", "Outcome"), "API", label("所要時間", "Duration"), label("待ち時間", "Queue wait"), label("詳細", "Details")].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead>
        <tbody>{displayed.map(request => <React.Fragment key={request.key}>
          <tr data-testid="performance-request-row" data-request-id={request.key}>
            <td><time dateTime={new Date(request.entry.timestamp).toISOString()} title={date(request.entry.timestamp)}>{time(request.entry.timestamp)}</time></td>
            <td><span className={`perf-request-outcome${request.failed ? " perf-request-outcome--failed" : ""}`}>{request.status === null ? label("HTTP応答なし／不明", "No / unknown HTTP response") : `HTTP ${request.status}`}</span></td>
            <td className="perf-request-path"><strong>{request.method}</strong> <code>{request.path}</code></td><td>{ms(request.total)}</td><td>{ms(request.queueWait)}</td>
            <td><button type="button" className="perf-request-expand options-button" data-testid="performance-request-expand" aria-expanded={expanded === request.key} aria-controls={`performance-request-${request.key}`} onClick={() => setExpanded(expanded === request.key ? null : request.key)}>{expanded === request.key ? label("閉じる", "Close") : label("詳細", "Details")}</button></td>
          </tr>
          {expanded === request.key && <tr className="perf-request-detail-row"><td colSpan={6}><div className="perf-request-expanded" data-testid="performance-request-expanded" id={`performance-request-${request.key}`}>
              <h4>{request.method} {request.path}</h4><dl>
                <dt>{label("日時", "Recorded at")}</dt><dd>{date(request.entry.timestamp)}</dd>
                <dt>{label("結果", "Outcome")}</dt><dd>{request.failed ? label("失敗", "Failed") : label("成功", "Succeeded")} · {request.status === null ? label("HTTPステータス未記録", "HTTP status not recorded") : `HTTP ${request.status}`}</dd>
                <dt>{label("所要時間", "Duration")}</dt><dd>{ms(request.total)}</dd><dt>{label("拡張内の待ち", "Waiting inside Deck")}</dt><dd>{ms(request.queueWait)}</dd><dt>{netLabel}</dt><dd>{ms(request.network)}</dd>
                <dt>{label("呼び出し元", "Caller")}</dt><dd>{request.reason || "—"}</dd>
                <dt>{label("処理", "Purpose")}</dt><dd>{typeof request.entry.payload?.purpose === "string" ? request.entry.payload.purpose : "—"}</dd>
                <dt>{label("優先度", "Priority")}</dt><dd>{typeof request.entry.payload?.priority === "string" ? request.entry.payload.priority : "—"}</dd>
                <dt>{label("受付時の滞留数", "Outstanding at enqueue")}</dt><dd>{typeof request.entry.payload?.queueDepth === "number" ? request.entry.payload.queueDepth : "—"}</dd>
                {request.error && <><dt>{label("エラー", "Error")}</dt><dd className="perf-error-message">{request.error}</dd></>}
              </dl><p className="options-hint">{request.network === null ? label("通信・応答の内訳は計測されていません。未計測は0 msを意味しません。", "The response breakdown was not measured. Missing values do not mean zero milliseconds.") : label("通信・応答には通信と本文読み取りを含みます。", "Network / response includes transport and body reading.")}</p>
            </div></td></tr>}
        </React.Fragment>)}</tbody>
      </table></div>}
      <div className="perf-request-pagination"><span>{filtered.length ? `${effectivePage * PERFORMANCE_REQUEST_PAGE_SIZE + 1}–${Math.min(filtered.length, (effectivePage + 1) * PERFORMANCE_REQUEST_PAGE_SIZE)} / ${filtered.length}` : "0 / 0"}</span>
        <button type="button" className="options-button" data-testid="performance-page-previous" disabled={effectivePage === 0} onClick={() => setPage(effectivePage - 1)}>{label("前へ", "Previous")}</button>
        <button type="button" className="options-button" data-testid="performance-page-next" disabled={effectivePage + 1 >= pageCount} onClick={() => setPage(effectivePage + 1)}>{label("次へ", "Next")}</button>
      </div>
    </section>
  </div>;
}

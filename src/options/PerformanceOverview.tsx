import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import type { TraceLogEntry } from "../traceLog";
import { analyzePerformance, normalizePerformanceRequests, recommendPerformanceDraft } from "./performanceAnalysis";
import { EMPTY_REQUEST_FILTER, filterPerformanceRequests, PERFORMANCE_REQUEST_PAGE_SIZE, type PerformanceRequestFilter } from "./performanceDrilldown";
import { TRACE_STATE_STORAGE_KEY, TRACE_STORAGE_MESSAGE, type TraceMinuteAggregate } from "../traceProtocol";

export function PerformanceOverview({ entries, language, capturing, onReviewAdvice }: { entries: TraceLogEntry[]; language: string; capturing: boolean; onReviewAdvice?: (preset: "low" | "high") => void }) {
  const a = useMemo(() => analyzePerformance(entries), [entries]);
  const requests = useMemo(() => normalizePerformanceRequests(entries), [entries]);
  const advice = useMemo(() => recommendPerformanceDraft(entries), [entries]);
  const http429Count = requests.filter(request => request.status === 429).length;
  const purposeGroups = useMemo(() => {
    const groups = new Map<string, number[]>();
    for (const request of requests) {
      const dimension = request.purpose ? `purpose:${request.purpose}` : request.priority ? `priority:${request.priority}` : "";
      if (dimension && request.wait !== null) groups.set(dimension, [...(groups.get(dimension) ?? []), request.wait]);
    }
    return [...groups].map(([dimension, waits]) => ({ dimension, count: waits.length, waitMs: Math.round(waits.reduce((sum, wait) => sum + wait, 0) / waits.length) }))
      .filter(group => group.count >= 3).sort((a, b) => b.waitMs - a.waitMs).slice(0, 3);
  }, [requests]);
  const [filter, setFilter] = useState<PerformanceRequestFilter>(EMPTY_REQUEST_FILTER);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [trendDays, setTrendDays] = useState(1);
  const [aggregates, setAggregates] = useState<TraceMinuteAggregate[]>([]);
  const [aggregateError, setAggregateError] = useState(false);
  const [aggregateRetry, setAggregateRetry] = useState(0);
  const [detailEntries, setDetailEntries] = useState<TraceLogEntry[]>([]);
  const [detailHasMore, setDetailHasMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const lastRevisionRefreshAt = useRef(0);
  const revisionRefreshTimer = useRef<number | null>(null);
  const detailQueryKey = `${JSON.stringify(filter)}:${page}:${detailRetry}:${capturing}`;
  const previousDetailQueryKey = useRef(detailQueryKey);
  const [expiredMinute, setExpiredMinute] = useState(false);
  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return;
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (!changes[TRACE_STATE_STORAGE_KEY] || revisionRefreshTimer.current !== null) return;
      const delay = Math.max(0, 2_000 - (Date.now() - lastRevisionRefreshAt.current));
      revisionRefreshTimer.current = window.setTimeout(() => {
        revisionRefreshTimer.current = null;
        lastRevisionRefreshAt.current = Date.now();
        setRefreshRevision(value => value + 1);
      }, delay);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
      if (revisionRefreshTimer.current !== null) window.clearTimeout(revisionRefreshTimer.current);
      revisionRefreshTimer.current = null;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const manualChange = previousDetailQueryKey.current !== detailQueryKey;
    previousDetailQueryKey.current = detailQueryKey;
    if (manualChange) { setDetailEntries([]); setDetailHasMore(false); setDetailLoading(true); setDetailError(false); }
    const to = filter.minuteStart === null ? Date.now() : filter.minuteEnd ?? filter.minuteStart + 60_000;
    const from = filter.minuteStart === null ? Date.now() - 24 * 60 * 60_000 : filter.minuteStart;
    if (from < Date.now() - 24 * 60 * 60_000) { setExpiredMinute(true); setDetailLoading(false); return () => { active = false; }; }
    setExpiredMinute(false);
    void chrome.runtime.sendMessage({ type: TRACE_STORAGE_MESSAGE, operation: "query", requestsOnly: true, from, to, offset: page * PERFORMANCE_REQUEST_PAGE_SIZE, limit: PERFORMANCE_REQUEST_PAGE_SIZE, failedOnly: filter.failedOnly, status: filter.status === "all" || filter.status === "no-http" ? filter.status : Number(filter.status), query: filter.query })
      .then((response: { success?: boolean; entries?: TraceLogEntry[]; hasMore?: boolean } | undefined) => {
        if (!active) return;
        if (!response?.success || !Array.isArray(response.entries)) { setDetailError(true); setDetailLoading(false); return; }
        setDetailEntries(response.entries); setDetailHasMore(Boolean(response.hasMore)); setDetailError(false); setDetailLoading(false);
      }).catch(() => { if (active) { setDetailError(true); setDetailLoading(false); } });
    return () => { active = false; };
  }, [filter, page, refreshRevision, detailRetry, capturing, detailQueryKey]);
  useEffect(() => {
    let active = true;
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) { setAggregateError(true); return () => { active = false; }; }
    const from = Date.now() - trendDays * 24 * 60 * 60_000;
    void chrome.runtime.sendMessage({ type: TRACE_STORAGE_MESSAGE, operation: "aggregates", from, to: Date.now() })
      .then((response: { success?: boolean; aggregates?: TraceMinuteAggregate[] } | undefined) => {
        if (!active) return;
        if (response?.success && Array.isArray(response.aggregates)) { setAggregates(response.aggregates); setAggregateError(false); }
        else setAggregateError(true);
      }).catch(() => { if (active) setAggregateError(true); });
    return () => { active = false; };
  }, [trendDays, refreshRevision, capturing, aggregateRetry]);
  const details = useRef<HTMLElement>(null);
  const filtered = useMemo(() => filterPerformanceRequests(normalizePerformanceRequests(detailEntries), EMPTY_REQUEST_FILTER), [detailEntries]);
  const availableStatuses = useMemo(() => [...new Set([...requests, ...normalizePerformanceRequests(detailEntries)].flatMap(request => request.status === null ? [] : [request.status]))].sort((a, b) => a - b), [requests, detailEntries]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PERFORMANCE_REQUEST_PAGE_SIZE));
  const effectivePage = page;
  const displayed = filtered;
  const chooseFilter = (next: PerformanceRequestFilter, reveal = false) => {
    setFilter(next); setPage(0); setExpanded(null); setDetailError(false); setDetailEntries([]); setDetailHasMore(false); setDetailLoading(true);
    if (reveal) {
      requestAnimationFrame(() => { details.current?.scrollIntoView({ behavior: "auto", block: "start" }); details.current?.focus({ preventScroll: true }); });
    }
  };
  const chooseMinute = (start: number, end: number, failedOnly: boolean) => { if (start < Date.now() - 24 * 60 * 60_000) { setExpiredMinute(true); chooseFilter({ ...EMPTY_REQUEST_FILTER, minuteStart: start, minuteEnd: end }, true); return; } setExpiredMinute(false); chooseFilter({ failedOnly, minuteStart: start, minuteEnd: end, status: "all", query: "" }, true); };
  const chartData = useMemo(() => {
    const rangeEnd = Date.now();
    const rangeStart = rangeEnd - trendDays * 24 * 60 * 60_000;
    const binMs = Math.max(60_000, Math.ceil((rangeEnd - rangeStart) / (299 * 60_000)) * 60_000);
    const bins = new Map<number, TraceMinuteAggregate[]>();
    for (const bucket of aggregates) {
      const start = Math.floor(bucket.start / binMs) * binMs;
      bins.set(start, [...(bins.get(start) ?? []), bucket]);
    }
    const grouped: Array<{ start: number; end: number; count: number | null; errors: number | null; succeeded: number | null; wait: number | null; network: number | null }> = [];
    const firstStart = Math.floor(rangeStart / binMs) * binMs;
    for (let start = firstStart; start < rangeEnd; start += binMs) {
      const rows = bins.get(start) ?? [];
      if (!rows.length) { grouped.push({ start, end: start + binMs, count: null, errors: null, succeeded: null, wait: null, network: null }); continue; }
      const total = rows.reduce((sum, row) => sum + row.count, 0), errors = rows.reduce((sum, row) => sum + row.errors, 0);
      const waitCount = rows.reduce((sum, row) => sum + row.waitCount, 0), networkCount = rows.reduce((sum, row) => sum + row.networkCount, 0);
      grouped.push({ start, end: start + binMs, count: total, errors, succeeded: total - errors,
        wait: waitCount ? rows.reduce((sum,row)=>sum+row.waitSum,0)/waitCount : null,
        network: networkCount ? rows.reduce((sum,row)=>sum+row.networkSum,0)/networkCount : null });
    }
    return { rows: grouped, binMs };
  }, [aggregates, trendDays]);
  const aggregateSummary = useMemo(() => aggregates.reduce((sum, bucket) => ({
    count: sum.count + bucket.count, errors: sum.errors + bucket.errors,
    totalSum: sum.totalSum + bucket.totalSum, totalCount: sum.totalCount + bucket.totalCount,
    waitSum: sum.waitSum + bucket.waitSum, waitCount: sum.waitCount + bucket.waitCount,
    networkSum: sum.networkSum + bucket.networkSum, networkCount: sum.networkCount + bucket.networkCount,
    rateLimited: sum.rateLimited + bucket.rateLimited, clientLimiterWaits: sum.clientLimiterWaits + bucket.clientLimiterWaits,
    maxOutstanding: Math.max(sum.maxOutstanding, bucket.maxOutstanding),
  }), { count: 0, errors: 0, totalSum: 0, totalCount: 0, waitSum: 0, waitCount: 0, networkSum: 0, networkCount: 0, rateLimited: 0, clientLimiterWaits: 0, maxOutstanding: 0 }), [aggregates]);
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
  const findingTitle = a.samples === 0 && aggregateSummary.count > 0
    ? label("直近の詳細サンプルはありません（期間集計は残っています）", "No recent detail sample (range aggregates remain)")
    : titles[a.status];
  const waitLabel = label("拡張内の待ち", "Waiting inside Deck");
  const netLabel = label("通信・応答", "Network / response");
  return <div className="perf-overview" data-testid="performance-overview">
    <section className={`perf-finding perf-finding--${a.status}`} aria-labelledby="perf-finding-title">
      <div className="perf-period">{label("直近100件以内の詳細サンプル診断", "Diagnosis from up to 100 recent detail samples")} · {capturing ? label("記録中", "Recording") : label("記録OFF", "Recording off")}</div>
      <h3 id="perf-finding-title">{findingTitle}</h3><p>{a.samples === 0 && aggregateSummary.count > 0 ? label("詳細ログの保持期間を過ぎたため、期間集計から原因を判定できません。", "Detailed logs have expired, so the remaining aggregates cannot diagnose a cause.") : hints[a.status]}</p>
      <p className="options-hint">{a.start !== null && a.end !== null ? `${date(a.start)} → ${date(a.end)} · ${a.samples} ${label("リクエスト", "requests")}` : label("記録待ち", "Awaiting samples")}</p>
      <p className="options-hint">{label("この診断は直近100件以内の詳細サンプルに基づきます。下の件数と平均値は選択期間の保存集計です。現在のキュー待ち数や操作全体の所要時間ではありません。", "This diagnosis uses up to 100 recent detail samples. Counts and means below use saved aggregates for the selected range. They do not represent the live queue or full interaction time.")}</p>
    </section>
    {advice && <section className="options-callout" data-testid="performance-advice" aria-live="polite">
      <strong>{advice.preset === "high" ? label("キュー待ちに関する提案", "Queue wait suggestion") : label("通信・応答時間に関する提案", "Network / response suggestion")}</strong>
      <p>{advice.preset === "high"
        ? label(`${advice.count} 件の計測済みリクエスト: 平均キュー待ち ${advice.waitMs.toLocaleString(language)} ms、クライアント側レート待ち ${advice.rateWaits} 件。HTTP 429・失敗・古い記録・遅い通信応答がないため、上限内の高プリセットを提案します。`, `${advice.count} paired requests: ${advice.waitMs.toLocaleString(language)} ms average queue wait and ${advice.rateWaits} client-side rate waits. With no HTTP 429s, failures, stale samples, or slow network response, a bounded High preset is suggested.`)
        : label(`${advice.count} 件の計測済みリクエストで通信・応答の p95 が1,000 ms以上のため、取得量を抑える低プリセットを提案します。HTTP 429 は ${http429Count} 件です。`, `${advice.count} paired requests have a network / response p95 of at least 1,000 ms, so a Low preset is suggested to reduce request load. HTTP 429 count: ${http429Count}.`)}</p>
      <p className="options-hint">{advice.preset === "high" ? label("提案: 上限内で取得レートを上げてキューを処理します。これはサーバー容量を測定した結果ではありません。適用前に具体的な値を確認し、必要なら戻してください。", "Suggestion: raise request budgets within configured bounds to drain the queue. This does not measure server capacity. Review the concrete values before applying and revert if needed.") : label("提案: 低プリセットで取得レートを下げ、遅い応答への負荷を抑えます。", "Suggestion: use the Low preset to reduce request rates while responses are slow.")}</p>
      {onReviewAdvice && <button type="button" className="options-button" data-testid="performance-advice-apply" onClick={() => onReviewAdvice(advice.preset)}>{label("値を確認", "Review values")}</button>}
    </section>}
    {!advice && a.samples > 0 && <p className="options-hint" data-testid="performance-advice-limits">{a.failures > 0
      ? label(`失敗 ${a.failures} 件（うち HTTP 429 ${http429Count} 件）のため、負荷を上げるプリセットは提案しません。失敗リクエストを確認してください。`, `${a.failures} failed requests, including ${http429Count} HTTP 429s. No higher-load preset is suggested; inspect failed requests.`)
      : a.pairedSamples < 10
        ? label("プリセット提案には10件以上の計測済みリクエストが必要です。", "Preset advice requires at least 10 requests with paired timing data.")
        : a.end !== null && a.start !== null && a.end - a.start < 120_000
          ? label("プリセット提案には2分以上の計測期間が必要です。", "Preset advice requires a sample window of at least two minutes.")
          : a.end !== null && Date.now() - a.end > 24 * 60 * 60_000
            ? label("ログが古いため、プリセットを提案しません。新しい記録で再確認してください。", "No preset advice is offered from stale logs. Record a fresh sample and review again.")
            : label("現在の記録からは、負荷設定を変える根拠が足りません。", "The current records do not provide enough evidence to change request load settings.")}</p>}
    <div className="perf-metrics">
      {[
        [label("平均リクエスト所要時間", "Average request time"), ms(aggregateSummary.totalCount ? aggregateSummary.totalSum / aggregateSummary.totalCount : null), label("選択期間の保存集計・待ち時間を含む", "Persisted aggregate for selected range, including waiting")],
        [waitLabel, ms(aggregateSummary.waitCount ? aggregateSummary.waitSum / aggregateSummary.waitCount : null), label("選択期間の計測済み平均", "Measured mean for selected range")],
        [netLabel, ms(aggregateSummary.networkCount ? aggregateSummary.networkSum / aggregateSummary.networkCount : null), label("選択期間の計測済み平均", "Measured mean for selected range")],
      ].map(([title, value, hint]) => <article className="options-metric-card" key={title}><strong>{title}</strong><p>{value}</p><span className="options-hint">{hint}</span></article>)}
      <button type="button" className="options-metric-card perf-metric-action" data-testid="performance-failed-metric"
        onClick={() => chooseFilter({ ...EMPTY_REQUEST_FILTER, failedOnly: true }, true)} aria-controls="performance-request-details">
        <strong>{label("失敗 / 全リクエスト（選択期間）", "Failed / all requests (selected range)")}</strong><p>{aggregateSummary.errors} / {aggregateSummary.count}</p>
        <span className="options-hint">{label("失敗したリクエストを確認 →", "Inspect failed requests →")}</span>
      </button>
    </div>
    <div className="perf-facts">
      <span>{label("所要時間 p95", "Request time p95")}: <b>{label("選択期間では未算出（詳細ページの標本値ではありません）", "Unavailable from aggregates (no raw percentile computed)")}</b></span>
      <span>{label("レート制限待ちの記録", "Recorded rate-limit waits")}: <b>{aggregateSummary.clientLimiterWaits}</b></span>
      <span>{label("補足", "Note")}: {label("レート待ちはクライアント内の待機ログで、HTTP 429 ではありません。429 は失敗リクエスト詳細で確認します。", "Rate waits are client-side throttle events, not HTTP 429. Inspect failed request details for actual 429 responses.")}</span>
      <span>{label("受付時の最大滞留数（実行中＋待機）", "Peak outstanding at enqueue (active + queued)")}: <b>{aggregateSummary.maxOutstanding || "—"}</b></span>
      <span>{label("内訳を計測できたリクエスト", "Requests with measured breakdown")}: <b>{aggregateSummary.totalCount} {label("件", "requests")}</b></span>
    </div>
    {purposeGroups.length > 0 && <section className="perf-facts" data-testid="performance-purpose-evidence" aria-label={label("処理別の待ち時間根拠", "Queue wait evidence by purpose or priority")}>
      {purposeGroups.map(group => {
        const separator = group.dimension.indexOf(":");
        const dimension = group.dimension.slice(0, separator);
        const value = group.dimension.slice(separator + 1);
        return <button key={group.dimension} type="button" className="options-button options-button--ghost" onClick={() => chooseFilter({ ...EMPTY_REQUEST_FILTER, query: value }, true)}>
          {dimension === "purpose" ? label("処理", "Purpose") : label("優先度", "Priority")}: {value} · {group.count} {label("計測済み", "measured")} · {ms(group.waitMs)} {label("平均待ち · 詳細を表示", "avg wait · inspect requests")}
        </button>;
      })}
    </section>}
    <div className="options-field perf-trend-range"><label htmlFor="performance-trend-range">{label("傾向の期間", "Trend range")}</label><select id="performance-trend-range" className="options-input" data-testid="performance-trend-range" value={trendDays} onChange={event => setTrendDays(Number(event.target.value))}><option value={1}>{label("24時間", "24 hours")}</option><option value={3}>{label("3日", "3 days")}</option><option value={7}>{label("7日", "7 days")}</option></select></div>
    <div className="perf-charts">
      {(["latency", "count"] as const).map(kind => <figure className="options-analysis-card" key={kind} data-testid={`performance-chart-${kind}`}>
        <figcaption><strong>{kind === "latency" ? label("待ち時間と通信・応答の推移", "Waiting and response over time") : label("リクエスト数と失敗の推移", "Requests and failures over time")}</strong>
          <p className="options-hint">{label("選択範囲の1分ごとの保存集計", "Persisted 1-minute aggregates for the selected range")} · {kind === "latency" ? label("平均 ms", "mean ms") : `${label("件／", "requests per ")}${Math.round(chartData.binMs / 60_000)} ${label("分", "minutes")}`}</p></figcaption>
        <div className="perf-legend">{kind === "latency" ? <><span className="perf-key perf-key--wait">{waitLabel}</span><span className="perf-key perf-key--network">{netLabel}</span></> : <><span className="perf-key perf-key--network">{label("成功", "Succeeded")}</span><span className="perf-key perf-key--error">{label("失敗", "Failed")}</span></>}</div>
        <div className="perf-recharts-host" role="group" aria-label={kind === "latency" ? label("平均所要時間の内訳、単位ms", "Mean request time breakdown in milliseconds") : label("リクエスト数、単位件／分", "Requests per minute")}>
          <BarChart responsive style={{ width: "100%", minWidth: 0 }} height={240} data={chartData.rows} accessibilityLayer margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--perf-grid, #d6deea)" />
            <XAxis dataKey="start" tickFormatter={value => trendDays === 1 ? time(Number(value)) : date(Number(value))} minTickGap={28} tick={{ fill: "var(--perf-muted, #62728a)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis width={56} allowDecimals={kind === "latency"} tickFormatter={value => Number(value).toLocaleString(language)} tick={{ fill: "var(--perf-muted, #62728a)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip labelFormatter={value => date(Number(value))} formatter={(value, name) => [kind === "latency" ? ms(typeof value === "number" ? value : null) : `${value ?? 0} ${label("件", "requests")}`, name]}
              contentStyle={{ background: "var(--perf-surface, #fff)", borderColor: "var(--perf-grid, #d6deea)", color: "var(--perf-text, #18263b)", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "var(--perf-text, #18263b)" }} cursor={{ fill: "var(--perf-selection, #eaf0f8)" }} />
            <Bar dataKey={kind === "latency" ? "network" : "succeeded"} name={kind === "latency" ? netLabel : label("成功", "Succeeded")} stackId="requests" fill="var(--perf-network, #4f83b6)" isAnimationActive={false}
              onClick={data => chooseMinute(Number(data.payload.start), Number(data.payload.end), false)} cursor="pointer" />
            <Bar dataKey={kind === "latency" ? "wait" : "errors"} name={kind === "latency" ? waitLabel : label("失敗", "Failed")} stackId="requests" fill={kind === "latency" ? "var(--perf-wait, #a97937)" : "var(--perf-error, #b83e42)"} isAnimationActive={false}
              onClick={data => chooseMinute(Number(data.payload.start), Number(data.payload.end), kind === "count")} cursor="pointer" />
          </BarChart>
        </div>
        <p className="options-hint">{label(`空白は記録なし。棒は${Math.round(chartData.binMs / 60_000)}分単位です。選択するとその期間の詳細を表示します。`, `Blank buckets have no records. Each bar covers ${Math.round(chartData.binMs / 60_000)} minutes; select one to inspect that range.`)}</p>
      </figure>)}
    </div>
    {aggregateError && <p className="options-hint" role="alert">{label("保存集計を読み込めませんでした。", "Could not load saved aggregates.")} <button type="button" className="options-button" onClick={() => setAggregateRetry(value => value + 1)}>{label("再試行", "Retry")}</button></p>}
    <p className="options-hint" data-testid="performance-retention-note">{label("グラフは1分ごとの保存集計です。リクエスト詳細は直近24時間のみ保持し、古いグラフの棒から詳細を開けない場合があります。", "Charts use persisted 1-minute aggregates. Request details are retained for 24 hours, so older bars may not have drilldown records.")}</p>
    <section className="perf-request-details" id="performance-request-details" data-testid="performance-request-details" aria-labelledby="perf-request-heading" tabIndex={-1} ref={details}>
      <header className="perf-request-heading"><div><h3 id="perf-request-heading">{label("リクエストを調べる", "Inspect requests")}</h3><p className="options-hint">{label("失敗件数やグラフから絞り込み、各行を開いて原因を確認できます。", "Filter from a metric or chart, then expand a row to inspect its cause.")}</p></div>
        <span role="status" aria-live="polite" data-testid="performance-result-count">{filtered.length}{detailHasMore ? "+" : ""} {label("件（このページ）", "requests (this page)")}</span>
      </header>
      <div className="perf-request-filters">
        <div className="perf-filter-segment" role="group" aria-label={label("結果", "Outcome")}>
          <button type="button" data-testid="performance-filter-all" aria-pressed={!filter.failedOnly} onClick={() => chooseFilter({ ...filter, failedOnly: false })}>{label("すべて", "All")}</button>
          <button type="button" data-testid="performance-filter-failed" aria-pressed={filter.failedOnly} onClick={() => chooseFilter({ ...filter, failedOnly: true })}>{label("失敗のみ", "Failed only")}</button>
        </div>
        <label>{label("時間帯", "Time range")}<select data-testid="performance-time-filter" disabled={a.end === null} value={filter.minuteStart ?? "all"} onChange={event => { const start = event.target.value === "all" ? null : Number(event.target.value); chooseFilter({ ...filter, minuteStart: start, minuteEnd: start === null ? undefined : start + 60_000 }); }}>
          <option value="all">{label("保存ログ全体", "All retained records")}</option>
          {(a.end === null ? [] : a.buckets).map(bucket => <option key={bucket.start} value={bucket.start}>{filter.minuteStart === bucket.start && filter.minuteEnd !== undefined && filter.minuteEnd > bucket.start + 60_000
            ? `${date(bucket.start)} – ${date(filter.minuteEnd)} · ${label("グラフ期間", "chart range")}`
            : `${time(bucket.start)} · ${bucket.count} ${label("件", "requests")} / ${label("失敗", "failed")} ${bucket.errors}`}</option>)}
        </select></label>
        <label>{label("ステータス", "Status")}<select data-testid="performance-status-filter" value={filter.status} onChange={event => chooseFilter({ ...filter, status: event.target.value })}>
          <option value="all">{label("すべて", "All")}</option><option value="no-http">{label("HTTP応答なし／不明", "No / unknown HTTP response")}</option>
          {availableStatuses.map(status => <option key={status} value={status}>HTTP {status}</option>)}
        </select></label>
        <label className="perf-request-search">{label("API・エラーを検索", "Search API or error")}<input type="search" data-testid="performance-request-search" value={filter.query} onChange={event => chooseFilter({ ...filter, query: event.target.value })} placeholder={label("パス、呼び出し元、エラー", "Path, caller, or error")} /></label>
        <button type="button" className="options-button" data-testid="performance-reset-filters" onClick={() => chooseFilter(EMPTY_REQUEST_FILTER)} disabled={!filter.failedOnly && filter.minuteStart === null && filter.status === "all" && !filter.query}>{label("絞り込みを解除", "Reset filters")}</button>
      </div>
      <p className="perf-active-filter" data-testid="performance-active-filter">{filter.failedOnly ? label("失敗のみ", "Failed only") : label("すべての結果", "All outcomes")} · {filter.minuteStart === null ? label("保存ログ全体", "All retained records") : `${date(filter.minuteStart)} – ${date(filter.minuteEnd ?? filter.minuteStart + 60_000)}`}{filter.status !== "all" ? ` · ${filter.status === "no-http" ? label("HTTP応答なし／不明", "No / unknown HTTP response") : `HTTP ${filter.status}`}` : ""}{filter.query ? ` · “${filter.query}”` : ""}</p>
      {detailError && <p role="alert" className="perf-request-empty">{label("リクエスト詳細を読み込めませんでした。", "Could not load request details.")} <button type="button" className="options-button" onClick={() => setDetailRetry(value => value + 1)}>{label("再試行", "Retry")}</button></p>}
      {detailLoading && <p role="status" className="perf-request-empty">{label("リクエスト詳細を読み込み中…", "Loading request details…")}</p>}
      {expiredMinute && <p role="status" className="perf-request-empty" data-testid="performance-detail-expired">{label("この時間帯の集計は残っていますが、詳細ログの保持期間（24時間）を過ぎています。", "Aggregates remain for this period, but detailed logs have expired after 24 hours.")}</p>}
      {!displayed.length && !expiredMinute && !detailError && !detailLoading ? <p className="perf-request-empty" role="status" data-testid="performance-request-empty">{label("条件に一致するリクエストはありません。絞り込みを変更してください。", "No requests match these filters. Adjust the selection.")}</p> : displayed.length > 0 && !detailLoading ? <div className="perf-request-table-scroll"><table className="perf-request-table" data-testid="performance-request-table">
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
      </table></div> : null}
      <div className="perf-request-pagination"><span>{label("ページ", "Page")} {effectivePage + 1} · {filtered.length} {label("件", "requests")}{detailHasMore ? " +" : ""}</span>
        <button type="button" className="options-button" data-testid="performance-page-previous" disabled={effectivePage === 0} onClick={() => { setDetailEntries([]); setDetailHasMore(false); setDetailLoading(true); setExpanded(null); setPage(effectivePage - 1); }}>{label("前へ", "Previous")}</button>
        <button type="button" className="options-button" data-testid="performance-page-next" disabled={!detailHasMore} onClick={() => { setDetailEntries([]); setDetailHasMore(false); setDetailLoading(true); setExpanded(null); setPage(effectivePage + 1); }}>{label("次へ", "Next")}</button>
      </div>
    </section>
  </div>;
}

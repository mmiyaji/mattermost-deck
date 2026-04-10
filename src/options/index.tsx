import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { CustomSelect, type CustomSelectOption } from "../ui/CustomSelect";
import i18n from "../ui/i18n";
import {
  DEFAULT_COLUMN_COLORS,
  DEFAULT_SETTINGS,
  MAX_FONT_SCALE_PERCENT,
  MAX_PREFERRED_COLUMN_WIDTH,
  MAX_PREFERRED_RAIL_WIDTH,
  MIN_POLLING_INTERVAL_SECONDS,
  MIN_FONT_SCALE_PERCENT,
  MIN_PREFERRED_COLUMN_WIDTH,
  MIN_PREFERRED_RAIL_WIDTH,
  loadDeckSettings,
  normaliseFontScalePercent,
  normaliseHealthCheckPath,
  normalisePollingIntervalSeconds,
  normalisePreferredColumnWidth,
  normalisePreferredRailWidth,
  normaliseServerUrl,
  originToPermissionPattern,
  resolveTheme,
  saveDeckSettings,
  type ColumnColorKey,
  type DeckLanguage,
  type DeckSettings,
  type DeckTheme,
  type PostClickAction,
} from "../ui/settings";
import {
  createDeckProfile,
  deleteDeckProfile,
  duplicateDeckProfile,
  loadDeckProfiles,
  renameDeckProfile,
  switchDeckProfile,
  type DeckProfileSummary,
} from "../ui/profiles";
import { clearTraceEntries, getTraceEntries, isTraceCaptureEnabled, setTraceCaptureEnabled, subscribeTraceEntries, type TraceLogEntry } from "../traceLog";

const REPO_URL = "https://github.com/mmiyaji/mattermost-deck";
const PRIVACY_URL = "https://github.com/mmiyaji/mattermost-deck/blob/main/PRIVACY.md";
const TERMS_URL = "https://github.com/mmiyaji/mattermost-deck/blob/main/TERMS.md";
const PAT_ENABLE_URL = "https://docs.mattermost.com/administration-guide/configure/integrations-configuration-settings.html";
const PAT_GUIDE_URL = "https://docs.mattermost.com/agents/mcpserver/README.html";
const STORE_URL = ""; // Chrome Web Store URL (fill in after publication)
const AUTHOR_NAME = "mmiyaji";
const COPYRIGHT_YEAR = "2026";

type ActivePanel = "guide" | "conn" | "profiles" | "realtime" | "appearance" | "behavior" | "performance" | "security";

function useOptionsText() {
  const { t } = useTranslation();
  return useMemo(() => ({
    title: t("options.title"),
    version: t("options.version"),
    guideTitle: t("options.guideTitle"),
    connTitle: t("options.connTitle"),
    connDesc: t("options.connDesc"),
    profilesTitle: t("options.profilesTitle", { defaultValue: "Profiles" }),
    profilesDesc: t("options.profilesDesc", { defaultValue: "Profiles let you save multiple setting sets for the same Mattermost server after the basic connection is working." }),
    profilesRecommendedTitle: t("options.profilesRecommendedTitle", { defaultValue: "Recommended order" }),
    profilesRecommendedBody: t("options.profilesRecommendedBody", { defaultValue: "Set and save your Mattermost Server URL in Connection first. After the extension can connect to the server, use profiles only if you need separate settings for roles such as Ops, Support, or Night Shift." }),
    profilesHowItWorksLabel: t("options.profilesHowItWorksLabel", { defaultValue: "How profiles work" }),
    profilesHowItWorksBody1: t("options.profilesHowItWorksBody1", { defaultValue: "Profiles are grouped by server origin. Each profile stores a different settings set for the same Mattermost server." }),
    profilesHowItWorksBody2: t("options.profilesHowItWorksBody2", { defaultValue: "They are optional. If you only use one server setup, you can ignore this page and keep using the default profile." }),
    profilesSectionLabel: t("options.profilesSectionLabel", { defaultValue: "Profiles" }),
    currentProfileLabel: t("options.currentProfileLabel", { defaultValue: "Current Profile" }),
    currentProfilePlaceholder: t("options.currentProfilePlaceholder", { defaultValue: "Select a profile" }),
    profilesForOrigin: t("options.profilesForOrigin", { defaultValue: "Profiles for {{origin}}" }),
    profilesNeedsConnection: t("options.profilesNeedsConnection", { defaultValue: "Save a Mattermost Server URL in Connection before managing profiles." }),
    createProfileLabel: t("options.createProfileLabel", { defaultValue: "Create Profile" }),
    createProfilePlaceholder: t("options.createProfilePlaceholder", { defaultValue: "Ops, Support, Night Shift" }),
    createProfileButton: t("options.createProfileButton", { defaultValue: "Create" }),
    createProfileHint: t("options.createProfileHint", { defaultValue: "A new profile starts as a copy of the current settings for this server." }),
    manageCurrentProfileLabel: t("options.manageCurrentProfileLabel", { defaultValue: "Manage Current Profile" }),
    renameCurrentProfilePlaceholder: t("options.renameCurrentProfilePlaceholder", { defaultValue: "Rename current profile" }),
    renameProfileButton: t("options.renameProfileButton", { defaultValue: "Rename" }),
    duplicateProfileButton: t("options.duplicateProfileButton", { defaultValue: "Duplicate" }),
    deleteProfileButton: t("options.deleteProfileButton", { defaultValue: "Delete" }),
    deleteProfileHint: t("options.deleteProfileHint", { defaultValue: "Delete always asks for confirmation. One profile must remain for each server." }),
    profilesCreateNeedsServerUrl: t("options.profilesCreateNeedsServerUrl", { defaultValue: "Save a valid Mattermost Server URL before creating profiles." }),
    profilesCopySuffix: t("options.profilesCopySuffix", { defaultValue: "Copy" }),
    profilesDeleteConfirm: t("options.profilesDeleteConfirm", { defaultValue: "Delete profile \"{{name}}\"? This cannot be undone." }),
    profilesDeleteLastError: t("options.profilesDeleteLastError", { defaultValue: "At least one profile must remain for this server." }),
    serverUrlLabel: t("options.serverUrlLabel"),
    serverUrlPlaceholder: t("options.serverUrlPlaceholder"),
    teamSlugLabel: t("options.teamSlugLabel"),
    teamSlugPlaceholder: t("options.teamSlugPlaceholder"),
    targetHint: t("options.targetHint"),
    advanced: t("options.advanced"),
    routeKindsLabel: t("options.routeKindsLabel"),
    routeKindsHint: t("options.routeKindsHint"),
    healthCheckLabel: t("options.healthCheckLabel"),
    healthCheckHint: t("options.healthCheckHint"),
    realtimeTitle: t("options.realtimeTitle"),
    realtimeDesc: t("options.realtimeDesc"),
    patLabel: t("options.patLabel"),
    patPlaceholder: t("options.patPlaceholder"),
    patHelp: t("options.patHelp"),
    patEnableLink: t("options.patEnableLink"),
    patGuideLink: t("options.patGuideLink"),
    pollingLabel: t("options.pollingLabel"),
    pollingHint: t("options.pollingHint", { min: MIN_POLLING_INTERVAL_SECONDS }),
    show: t("options.show"),
    hide: t("options.hide"),
    appearanceTitle: t("options.appearanceTitle"),
    appearanceDesc: t("options.appearanceDesc"),
    themeLabel: t("options.themeLabel"),
    languageLabel: t("options.languageLabel"),
    fontScaleLabel: t("options.fontScaleLabel"),
    fontScaleHint: t("options.fontScaleHint", { min: MIN_FONT_SCALE_PERCENT, max: MAX_FONT_SCALE_PERCENT }),
    paneWidthLabel: t("options.paneWidthLabel"),
    paneWidthHint: t("options.paneWidthHint", { min: MIN_PREFERRED_RAIL_WIDTH, max: MAX_PREFERRED_RAIL_WIDTH }),
    columnWidthLabel: t("options.columnWidthLabel"),
    columnWidthHint: t("options.columnWidthHint", { min: MIN_PREFERRED_COLUMN_WIDTH, max: MAX_PREFERRED_COLUMN_WIDTH }),
    compactModeLabel: t("options.compactModeLabel"),
    compactModeHint: t("options.compactModeHint"),
    showImagePreviewsLabel: t("options.showImagePreviewsLabel"),
    showImagePreviewsHint: t("options.showImagePreviewsHint"),
    themeSystem: t("options.themeSystem"),
    themeMattermost: t("options.themeMattermost"),
    themeDark: t("options.themeDark"),
    themeLight: t("options.themeLight"),
    languageJa: t("options.languageJa"),
    languageEn: t("options.languageEn"),
    languageDe: t("options.languageDe"),
    languageZhCn: t("options.languageZhCn"),
    languageFr: t("options.languageFr"),
    behaviorTitle: t("options.behaviorTitle"),
    behaviorDesc: t("options.behaviorDesc"),
    performanceTitle: t("options.performanceTitle", { defaultValue: "Performance" }),
    performanceDesc: t("options.performanceDesc", { defaultValue: "Review request trends, latency, and trace logs captured from large Mattermost workspaces." }),
    performanceCaptureLabel: t("options.performanceCaptureLabel", { defaultValue: "Trace capture" }),
    performanceCaptureHint: t("options.performanceCaptureHint", { defaultValue: "Enable this only while reproducing a problem. Logs are stored inside the extension and can be exported as JSONL." }),
    performanceRetentionHint: t("options.performanceRetentionHint", { defaultValue: "Turning trace capture off clears stored entries. Logs older than 24 hours are removed automatically." }),
    performanceExpandWide: t("options.performanceExpandWide", { defaultValue: "Expand performance view" }),
    performanceCollapseWide: t("options.performanceCollapseWide", { defaultValue: "Collapse performance view" }),
    performanceExport: t("options.performanceExport", { defaultValue: "Export JSONL" }),
    performanceClear: t("options.performanceClear", { defaultValue: "Clear logs" }),
    performanceEmpty: t("options.performanceEmpty", { defaultValue: "No trace logs captured yet." }),
    performanceEntries: t("options.performanceEntries", { defaultValue: "Entries" }),
    performanceApiRequests: t("options.performanceApiRequests", { defaultValue: "API requests" }),
    performanceErrorRate: t("options.performanceErrorRate", { defaultValue: "Error rate" }),
    performanceAvgLatency: t("options.performanceAvgLatency", { defaultValue: "Avg latency" }),
    performanceP95Latency: t("options.performanceP95Latency", { defaultValue: "P95 latency" }),
    performanceQueueWait: t("options.performanceQueueWait", { defaultValue: "Avg queue wait" }),
    performanceApiRate: t("options.performanceApiRate", { defaultValue: "API request trend" }),
    performanceLatencyTrend: t("options.performanceLatencyTrend", { defaultValue: "Latency trend" }),
    performanceTopEndpoints: t("options.performanceTopEndpoints", { defaultValue: "Top endpoints" }),
    performanceSlowEndpoints: t("options.performanceSlowEndpoints", { defaultValue: "Slow endpoints" }),
    performanceEndpointSummary: t("options.performanceEndpointSummary", { defaultValue: "API endpoint summary" }),
    performanceMethodMix: t("options.performanceMethodMix", { defaultValue: "Method mix" }),
    performanceRateLimitWaits: t("options.performanceRateLimitWaits", { defaultValue: "Rate-limit waits" }),
    performanceEndpointUrl: t("options.performanceEndpointUrl", { defaultValue: "Endpoint URL" }),
    performanceRecentTrace: t("options.performanceRecentTrace", { defaultValue: "Recent trace" }),
    performancePurpose: t("options.performancePurpose", { defaultValue: "Purpose" }),
    performanceEndpoint: t("options.performanceEndpoint", { defaultValue: "Endpoint" }),
    performanceRequests: t("options.performanceRequests", { defaultValue: "Requests" }),
    performanceAvg: t("options.performanceAvg", { defaultValue: "Avg" }),
    performanceP95: t("options.performanceP95", { defaultValue: "P95" }),
    performanceErrors: t("options.performanceErrors", { defaultValue: "Errors" }),
    performanceErrorRateShort: t("options.performanceErrorRateShort", { defaultValue: "Error %" }),
    performanceTime: t("options.performanceTime", { defaultValue: "Time" }),
    performanceSource: t("options.performanceSource", { defaultValue: "Source" }),
    performanceEvent: t("options.performanceEvent", { defaultValue: "Event" }),
    performanceStatus: t("options.performanceStatus", { defaultValue: "Status" }),
    performanceDuration: t("options.performanceDuration", { defaultValue: "Duration" }),
    performanceQueue: t("options.performanceQueue", { defaultValue: "Queue" }),
    performanceMethod: t("options.performanceMethod", { defaultValue: "Method" }),
    performanceSortBy: t("options.performanceSortBy", { defaultValue: "Sort by" }),
    postClickActionLabel: t("options.postClickActionLabel"),
    postClickActionHint: t("options.postClickActionHint"),
    highlightKeywordsLabel: t("options.highlightKeywordsLabel", { defaultValue: "Highlight Keywords" }),
    highlightKeywordsHint: t("options.highlightKeywordsHint", { defaultValue: "Comma-separated words or phrases to highlight in posts. Leave empty to highlight your own username by default." }),
    highlightKeywordsPlaceholder: t("options.highlightKeywordsPlaceholder", { defaultValue: "deploy,error,customer" }),
    patStorageLabel: t("options.patStorageLabel", { defaultValue: "PAT storage" }),
    guideDiagramTitle: t("options.guideDiagramTitle", { defaultValue: "Mattermost Deck" }),
    guideDiagramMentions: t("options.guideDiagramMentions", { defaultValue: "@ mentions" }),
    guideDiagramDm: t("options.guideDiagramDm", { defaultValue: "DM Watch" }),
    guideDiagramMattermost: t("options.guideDiagramMattermost", { defaultValue: "Mattermost" }),
    guideDiagramDeck: t("options.guideDiagramDeck", { defaultValue: "Deck overlay" }),
    highZIndexLabel: t("options.highZIndexLabel"),
    highZIndexHint: t("options.highZIndexHint"),
    reversedPostOrderLabel: t("options.reversedPostOrderLabel"),
    reversedPostOrderHint: t("options.reversedPostOrderHint"),
    paneIdentityLabel: t("options.paneIdentityLabel"),
    paneIdentityHint: t("options.paneIdentityHint"),
    colorAccentsLabel: t("options.colorAccentsLabel"),
    securityTitle: t("options.securityTitle"),
    securityBody: t("options.securityBody"),
    securityBody2: t("options.securityBody2"),
    securityBody3: t("options.securityBody3"),
    openMattermost: t("options.openMattermost"),
    save: t("options.save"),
    saving: t("options.saving"),
    saved: t("options.saved"),
    invalidServerUrl: t("options.invalidServerUrl"),
    permissionDenied: t("options.permissionDenied"),
    privacyPolicy: t("options.privacyPolicy"),
    termsOfUse: t("options.termsOfUse"),
    github: t("options.github"),
    storeLink: t("options.storeLink"),
  }), [t]);
}

function NavIconGuide(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function NavIconConn(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function NavIconProfiles(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 19a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4" />
      <circle cx="12" cy="8" r="3" />
      <path d="M4 5h4" />
      <path d="M4 9h3" />
    </svg>
  );
}

function NavIconRealtime(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function NavIconAppearance(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function NavIconBehavior(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 3l14 9-7 1-4 7-3-17z" />
    </svg>
  );
}

function NavIconPerformance(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19h16" />
      <path d="M7 16l3-4 3 2 4-6" />
      <circle cx="7" cy="16" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="13" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="17" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function NavIconSecurity(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

type TraceApiEntry = TraceLogEntry & {
  payload?: {
    method?: string;
    path?: string;
    fullPath?: string;
    purpose?: string;
    status?: number;
    durationMs?: number;
    queueWaitMs?: number;
    failed?: boolean;
  };
};

type PerformanceEndpointRow = {
  path: string;
  purpose: string;
  count: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  errorCount: number;
};

type EndpointSummarySortKey = "purpose" | "count" | "avgLatencyMs" | "p95LatencyMs" | "errorRate";
type ApiTraceSortKey = "timestamp" | "purpose" | "status" | "durationMs";

function useTraceLogSnapshot(): [TraceLogEntry[], boolean] {
  const [entries, setEntries] = useState<TraceLogEntry[]>(() => getTraceEntries());
  const [enabled, setEnabled] = useState(() => isTraceCaptureEnabled());

  useEffect(() => subscribeTraceEntries(() => {
    setEntries(getTraceEntries());
    setEnabled(isTraceCaptureEnabled());
  }), []);

  return [entries, enabled];
}

function computeAverage(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeP95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[index] ?? 0;
}

function formatMs(value: number): string {
  return `${Math.round(value)} ms`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function buildBucketSeries(entries: TraceLogEntry[], bucketMs: number, buckets: number, filter: (entry: TraceLogEntry) => boolean): number[] {
  const now = Date.now();
  const series = Array.from({ length: buckets }, () => 0);

  for (const entry of entries) {
    if (!filter(entry)) {
      continue;
    }
    const age = now - entry.timestamp;
    if (age < 0 || age >= bucketMs * buckets) {
      continue;
    }
    const index = buckets - 1 - Math.floor(age / bucketMs);
    if (index >= 0 && index < buckets) {
      series[index] += 1;
    }
  }

  return series;
}

function MiniBarChart({ values, ariaLabel }: { values: number[]; ariaLabel: string }): React.JSX.Element {
  const width = 320;
  const height = 88;
  const maxValue = Math.max(...values, 1);
  const barWidth = width / Math.max(values.length, 1);

  return (
    <svg className="options-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      {values.map((value, index) => {
        const normalized = value / maxValue;
        const barHeight = Math.max(2, normalized * (height - 12));
        const x = index * barWidth + 2;
        const y = height - barHeight - 4;
        return <rect key={index} x={x} y={y} width={Math.max(4, barWidth - 4)} height={barHeight} rx="3" />;
      })}
    </svg>
  );
}

function SortableHeader({
  active,
  direction,
  label,
  onClick,
}: {
  active: boolean;
  direction: "asc" | "desc";
  label: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button type="button" className={`options-table-sort${active ? " is-active" : ""}`} onClick={onClick}>
      <span>{label}</span>
      <span className="options-table-sort-indicator" aria-hidden="true">
        {active ? (direction === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
}

// CSS

const pageCss = `
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :root {
    color-scheme: dark;
    font-family: "Segoe UI", sans-serif;
    font-size: 14px;
  }

  html, body {
    height: 100%;
  }

  body {
    overflow: hidden;
    background: linear-gradient(160deg, #0f1824 0%, #0b121d 100%);
    color: #e5eefb;
  }

  body[data-theme="light"] {
    background: #dde8f5;
    color: #16263b;
  }

  /* App shell */
  .options-app {
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Topbar */
  .options-topbar {
    flex: none;
    height: 54px;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 20px;
    border-bottom: 1px solid rgba(123, 178, 255, 0.12);
    background: rgba(8, 15, 26, 0.5);
    backdrop-filter: blur(10px);
  }

  body[data-theme="light"] .options-topbar {
    background: rgba(224, 236, 250, 0.92);
    border-bottom-color: rgba(84, 120, 168, 0.2);
  }

  .options-topbar-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .options-topbar-brand img {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    flex: none;
  }

  .options-topbar-brand h1 {
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
  }

  .options-version {
    padding: 3px 9px;
    border-radius: 999px;
    background: rgba(123, 178, 255, 0.1);
    color: #8facd5;
    font-size: 11px;
    white-space: nowrap;
    flex: none;
  }

  body[data-theme="light"] .options-version {
    color: #496583;
  }

  .options-topbar-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
  }

  .options-status {
    font-size: 12px;
    color: #8facd5;
    white-space: nowrap;
  }

  body[data-theme="light"] .options-status {
    color: #496583;
  }

  /* Body */
  .options-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    min-height: 0;
  }

  /* Sidebar */
  .options-sidebar {
    width: 196px;
    flex: none;
    display: flex;
    flex-direction: column;
    border-right: 1px solid rgba(123, 178, 255, 0.1);
    background: rgba(8, 15, 26, 0.25);
    overflow-y: auto;
  }

  body[data-theme="light"] .options-sidebar {
    background: rgba(210, 226, 244, 0.45);
    border-right-color: rgba(84, 120, 168, 0.16);
  }

  .options-sidebar-nav {
    flex: 1;
    padding: 10px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .options-nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 12px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: #8facd5;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, color 0.1s;
    line-height: 1;
  }

  .options-nav-item:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #e5eefb;
  }

  .options-nav-item.active {
    background: rgba(31, 157, 255, 0.15);
    color: #7bc8ff;
    font-weight: 500;
  }

  .options-nav-icon {
    flex: none;
    display: flex;
    align-items: center;
    line-height: 0;
  }

  body[data-theme="light"] .options-nav-item {
    color: #496583;
  }

  body[data-theme="light"] .options-nav-item:hover {
    background: rgba(0, 0, 0, 0.05);
    color: #16263b;
  }

  body[data-theme="light"] .options-nav-item.active {
    background: rgba(31, 157, 255, 0.12);
    color: #0f71d7;
  }

  .options-sidebar-open-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 8px 10px;
    margin-bottom: 8px;
    border-radius: 8px;
    border: 1px solid rgba(123, 178, 255, 0.18);
    background: rgba(123, 178, 255, 0.07);
    color: #a7c0e4;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }

  .options-sidebar-open-btn:hover:not(:disabled) {
    background: rgba(123, 178, 255, 0.14);
    color: #e5eefb;
  }

  .options-sidebar-open-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  body[data-theme="light"] .options-sidebar-open-btn {
    background: rgba(15, 113, 215, 0.07);
    border-color: rgba(84, 120, 168, 0.2);
    color: #496583;
  }

  body[data-theme="light"] .options-sidebar-open-btn:hover:not(:disabled) {
    background: rgba(15, 113, 215, 0.12);
    color: #16263b;
  }

  .options-sidebar-footer {
    flex: none;
    padding: 12px 14px 16px;
    border-top: 1px solid rgba(123, 178, 255, 0.1);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  body[data-theme="light"] .options-sidebar-footer {
    border-top-color: rgba(84, 120, 168, 0.16);
  }

  .options-sidebar-footer a {
    font-size: 12px;
    color: rgba(123, 178, 255, 0.6);
    text-decoration: none;
    line-height: 1.6;
  }

  .options-sidebar-footer a:hover {
    color: #7bb2ff;
    text-decoration: underline;
  }

  .options-sidebar-copyright {
    font-size: 11px;
    color: rgba(143, 172, 213, 0.4);
    margin-top: 4px;
  }

  body[data-theme="light"] .options-sidebar-footer a {
    color: rgba(15, 113, 215, 0.7);
  }

  body[data-theme="light"] .options-sidebar-copyright {
    color: rgba(73, 101, 131, 0.5);
  }

  /* Content */
  .options-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .options-panel-scroll {
    flex: 1;
    overflow-y: auto;
  }

  .options-panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 740px;
    margin: 0 auto;
    width: 100%;
    padding: 28px 32px;
  }

  .options-panel--wide {
    max-width: min(1480px, calc(100vw - 120px));
  }

  /* Save footer */
  .options-save-footer {
    flex: none;
    padding: 13px 32px;
    border-top: 1px solid rgba(123, 178, 255, 0.12);
    background: rgba(9, 16, 27, 0.75);
    backdrop-filter: blur(12px);
  }

  .options-save-footer-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    max-width: 740px;
    margin: 0 auto;
    width: 100%;
  }

  body[data-theme="light"] .options-save-footer {
    background: #dde8f5;
    backdrop-filter: none;
    border-top-color: rgba(84, 120, 168, 0.18);
  }

  .options-panel-header {
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(123, 178, 255, 0.1);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
  }

  .options-panel-header-copy {
    min-width: 0;
    flex: 1;
  }

  .options-panel-header > h2,
  .options-panel-header > p {
    flex: 0 0 100%;
  }

  .options-panel-header h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }

  .options-panel-header p {
    margin: 5px 0 0;
    margin-top: 5px;
    font-size: 13px;
    color: #8facd5;
    line-height: 1.55;
  }

  .options-panel-expand {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    border: 1px solid rgba(123, 178, 255, 0.18);
    background: rgba(123, 178, 255, 0.08);
    color: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .options-panel-expand:hover {
    background: rgba(123, 178, 255, 0.14);
  }

  body[data-theme="light"] .options-panel-header p {
    color: #496583;
  }

  /* Grid */
  .options-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  .options-grid--target {
    grid-template-columns: 1fr 200px;
  }

  /* Field */
  .options-field {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .options-label {
    font-size: 12px;
    color: #8facd5;
  }

  body[data-theme="light"] .options-label {
    color: #496583;
  }

  .options-label--required {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .options-required-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 18px;
    padding: 0 7px;
    border-radius: 999px;
    background: rgba(255, 122, 122, 0.14);
    color: #ff9a9a;
    font-size: 11px;
    font-weight: 700;
  }

  .options-required-hint {
    font-size: 12px;
    color: #ffb0b0;
    line-height: 1.5;
  }

  /* Inputs */
  .options-input {
    height: 38px;
    padding: 0 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(123, 178, 255, 0.18);
    border-radius: 9px;
    color: inherit;
    font: inherit;
    font-size: 13px;
  }

  .options-input:focus {
    outline: none;
    border-color: rgba(123, 178, 255, 0.5);
    box-shadow: 0 0 0 2px rgba(123, 178, 255, 0.1);
  }

  body[data-theme="light"] .options-input {
    background: rgba(255, 255, 255, 0.88);
  }

  .options-input--required-missing {
    border-color: rgba(255, 122, 122, 0.72);
    box-shadow: 0 0 0 1px rgba(255, 122, 122, 0.16);
  }

  .options-hint {
    font-size: 11px;
    color: rgba(143, 172, 213, 0.7);
    line-height: 1.5;
  }

  body[data-theme="light"] .options-hint {
    color: rgba(73, 101, 131, 0.8);
  }

  /* Buttons */
  .options-button {
    height: 36px;
    padding: 0 16px;
    border-radius: 9px;
    border: none;
    background: linear-gradient(180deg, #1f9dff, #0f71d7);
    color: #fff;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .options-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .options-button--ghost {
    background: rgba(123, 178, 255, 0.1);
    border: 1px solid rgba(123, 178, 255, 0.18);
    color: inherit;
  }

  /* Inline row */
  .options-inline {
    display: flex;
    gap: 8px;
  }

  .options-inline .options-input {
    flex: 1;
  }

  /* Radio / Checkbox */
  .options-choice-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .options-choice {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    cursor: pointer;
  }

  .options-choice input {
    accent-color: #1f9dff;
    flex: none;
    margin-top: 1px;
  }

  /* Callout */
  .options-callout {
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid rgba(123, 178, 255, 0.18);
    background: rgba(123, 178, 255, 0.07);
    font-size: 13px;
    color: #8facd5;
    line-height: 1.55;
  }

  .options-callout strong {
    display: block;
    margin-bottom: 4px;
    font-size: 13px;
    color: #e5eefb;
  }

  .options-callout p {
    margin: 0;
  }

  body[data-theme="light"] .options-callout {
    color: #496583;
  }

  body[data-theme="light"] .options-callout strong {
    color: #16263b;
  }

  /* Inline links */
  .options-inline-links {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
  }

  .options-inline-links a {
    font-size: 13px;
    color: #7bb2ff;
    text-decoration: none;
  }

  .options-inline-links a:hover {
    text-decoration: underline;
  }

  /* Subsection */
  .options-subsection {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .options-stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .options-copy {
    font-size: 13px;
    line-height: 1.6;
    color: #8facd5;
  }

  body[data-theme="light"] .options-copy {
    color: #496583;
  }

  .options-subsection-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(143, 172, 213, 0.6);
  }

  .options-divider {
    height: 1px;
    background: rgba(123, 178, 255, 0.1);
  }

  /* Color grid */
  .options-color-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(76px, 1fr));
    gap: 10px;
  }

  .options-color-item {
    display: flex;
    flex-direction: column;
    gap: 5px;
    align-items: center;
    padding: 10px 8px;
    border-radius: 9px;
    border: 1px solid rgba(123, 178, 255, 0.12);
    background: rgba(255, 255, 255, 0.02);
  }

  body[data-theme="light"] .options-color-item {
    background: rgba(255, 255, 255, 0.7);
  }

  .options-color-item span {
    font-size: 11px;
    color: #8facd5;
  }

  .options-color-item input[type="color"] {
    width: 44px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid rgba(123, 178, 255, 0.18);
    background: none;
    cursor: pointer;
    padding: 2px;
  }

  /* Install banner */
  .options-install-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    margin-bottom: 4px;
    background: rgba(28, 88, 217, 0.16);
    border: 1px solid rgba(28, 88, 217, 0.38);
    border-radius: 10px;
  }

  .options-install-banner-body strong {
    display: block;
    font-size: 13px;
    margin-bottom: 3px;
  }

  .options-install-banner-body p {
    font-size: 12px;
    color: #8facd5;
    margin: 0;
  }

  .options-install-banner-actions {
    display: flex;
    gap: 8px;
    flex: none;
  }

  /* Setup banner */
  .options-setup-banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 11px 14px;
    border-radius: 9px;
    background: rgba(217, 119, 6, 0.13);
    border: 1px solid rgba(217, 119, 6, 0.4);
    font-size: 13px;
    line-height: 1.5;
  }

  .options-setup-banner p {
    margin: 0;
  }

  /* Guide */
  .options-guide-diagram {
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid rgba(123, 178, 255, 0.12);
    line-height: 0;
  }

  .options-steps {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .options-step {
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }

  .options-step-num {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: rgba(31, 157, 255, 0.18);
    color: #1f9dff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    flex: none;
    margin-top: 1px;
  }

  .options-step-content {
    flex: 1;
  }

  .options-step-title {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 3px;
  }

  .options-step-desc {
    font-size: 12px;
    color: #8facd5;
    line-height: 1.55;
  }

  body[data-theme="light"] .options-step-desc {
    color: #496583;
  }

  .options-col-types {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }

  .options-col-type {
    padding: 12px;
    border-radius: 9px;
    border: 1px solid rgba(123, 178, 255, 0.12);
    background: rgba(255, 255, 255, 0.025);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  body[data-theme="light"] .options-col-type {
    background: rgba(255, 255, 255, 0.5);
    border-color: rgba(84, 120, 168, 0.14);
  }

  .options-col-type-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .options-col-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
  }

  .options-col-type-name {
    font-size: 13px;
    font-weight: 500;
  }

  .options-col-type-desc {
    font-size: 11px;
    color: #8facd5;
    line-height: 1.5;
  }

  body[data-theme="light"] .options-col-type-desc {
    color: #496583;
  }

  .options-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
  }

  .options-metric-card,
  .options-analysis-card {
    padding: 14px;
    border-radius: 10px;
    border: 1px solid rgba(123, 178, 255, 0.12);
    background: rgba(255, 255, 255, 0.03);
  }

  body[data-theme="light"] .options-metric-card,
  body[data-theme="light"] .options-analysis-card {
    background: rgba(255, 255, 255, 0.72);
    border-color: rgba(84, 120, 168, 0.14);
  }

  .options-analysis-card--full {
    grid-column: 1 / -1;
  }

  .options-metric-card strong,
  .options-analysis-card strong {
    display: block;
    font-size: 12px;
    color: #8facd5;
  }

  .options-metric-card p {
    margin-top: 8px;
    font-size: 24px;
    font-weight: 700;
    color: #e5eefb;
  }

  body[data-theme="light"] .options-metric-card p {
    color: #16263b;
  }

  .options-analysis-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 10px;
  }

  .options-analysis-header span {
    font-size: 12px;
    color: #8facd5;
  }

  .options-chart {
    width: 100%;
    height: 88px;
    display: block;
  }

  .options-chart rect {
    fill: rgba(123, 178, 255, 0.75);
  }

  .options-table-wrap {
    overflow-x: auto;
  }

  .options-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .options-table th,
  .options-table td {
    padding: 8px 0;
    text-align: left;
    vertical-align: top;
    border-top: 1px solid rgba(123, 178, 255, 0.08);
  }

  .options-table thead th {
    padding-top: 0;
    border-top: none;
  }

  .options-table-sort {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: none;
    background: transparent;
    color: #8facd5;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .options-table-sort.is-active,
  .options-table-sort:hover {
    color: #e5eefb;
  }

  .options-table-sort-indicator {
    font-size: 11px;
  }

  .options-table-main {
    min-width: 0;
    color: #e5eefb;
  }

  .options-table-url {
    font-family: Consolas, "Courier New", monospace;
    font-size: 11px;
    color: #8facd5;
    word-break: break-all;
  }

  .options-log-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .options-log-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    font-size: 12px;
  }

  .options-log-row--stack {
    display: block;
  }

  .options-log-main {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #e5eefb;
  }

  .options-log-meta {
    flex: none;
    color: #8facd5;
  }

  body[data-theme="light"] .options-log-main {
    color: #16263b;
  }

  body[data-theme="light"] .options-table-sort {
    color: #496583;
  }

  body[data-theme="light"] .options-table-sort.is-active,
  body[data-theme="light"] .options-table-sort:hover,
  body[data-theme="light"] .options-table-main {
    color: #16263b;
  }

  body[data-theme="light"] .options-table-url {
    color: #496583;
  }

  .options-endpoint-details {
    margin-top: 6px;
    color: #8facd5;
  }

  .options-endpoint-details summary {
    cursor: pointer;
    user-select: none;
  }

  .options-endpoint-url {
    margin-top: 6px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
    word-break: break-all;
    font-family: Consolas, "Courier New", monospace;
    font-size: 11px;
    color: #e5eefb;
  }

  body[data-theme="light"] .options-endpoint-url {
    background: rgba(255, 255, 255, 0.88);
    color: #16263b;
  }

  @media (max-width: 520px) {
    .options-col-types { grid-template-columns: repeat(2, 1fr); }
  }

  /* CustomSelect (scoped) */
  .options-content .mm-custom-select {
    position: relative;
  }

  .options-content .mm-custom-select-button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    height: 38px;
    padding: 0 12px;
    border: 1px solid rgba(123, 178, 255, 0.18);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    text-align: left;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }

  body[data-theme="light"] .options-content .mm-custom-select-button {
    background: rgba(255, 255, 255, 0.88);
  }

  .options-content .mm-custom-select-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .options-content .mm-custom-select-label--placeholder {
    color: #8facd5;
  }

  .options-content .mm-custom-select-chevron {
    width: 11px; height: 11px;
    stroke: currentColor; stroke-width: 1.8; fill: none;
    stroke-linecap: round; stroke-linejoin: round;
    transform: rotate(90deg);
    transition: transform 140ms ease;
    flex: none;
  }

  .options-content .mm-custom-select-chevron--expanded {
    transform: rotate(-90deg);
  }

  .options-content .mm-custom-select-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0; right: 0;
    max-height: 220px;
    overflow-y: auto;
    padding: 5px;
    border: 1px solid rgba(123, 178, 255, 0.18);
    border-radius: 10px;
    background: #152235;
    box-shadow: 0 16px 28px rgba(4, 10, 20, 0.3);
    z-index: 10;
  }

  body[data-theme="light"] .options-content .mm-custom-select-menu {
    background: #ffffff;
  }

  .options-content .mm-custom-select-current {
    padding: 4px 4px 6px;
  }

  .options-content .mm-custom-select-current-label {
    display: block;
    padding: 8px 10px;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.04);
    font-size: 13px;
  }

  body[data-theme="light"] .options-content .mm-custom-select-current-label {
    background: rgba(0, 0, 0, 0.04);
  }

  .options-content .mm-custom-select-divider {
    height: 1px;
    margin: 0 4px 6px;
    background: rgba(123, 178, 255, 0.14);
  }

  .options-content .mm-custom-select-option {
    display: block;
    width: 100%;
    padding: 9px 10px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }

  .options-content .mm-custom-select-option:hover,
  .options-content .mm-custom-select-option--selected {
    background: rgba(123, 178, 255, 0.12);
  }

  .options-content .mm-custom-select-search {
    padding: 4px 4px 5px;
  }

  .options-content .mm-custom-select-search-input {
    width: 100%;
    padding: 6px 9px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    font: inherit;
    font-size: 13px;
    outline: none;
  }

  .options-content .mm-custom-select-search-input:focus {
    border-color: rgba(123, 178, 255, 0.55);
  }

  .options-content .mm-custom-select-empty {
    padding: 9px 10px;
    color: rgba(255, 255, 255, 0.38);
    font-size: 13px;
    text-align: center;
  }

  @media (max-width: 720px) {
    .options-sidebar { width: 52px; }
    .options-nav-item span:last-child { display: none; }
    .options-nav-icon { margin: 0 auto; }
    .options-sidebar-footer { display: none; }
    .options-grid, .options-grid--target { grid-template-columns: 1fr; }
    .options-panel { padding: 16px; }
    .options-save-footer { padding: 12px 16px; }
    .options-save-footer-inner { max-width: 100%; }
  }
`;

// Helpers

function getManifestVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "0.0.0";
  }
}

// Component

function OptionsApp(): React.JSX.Element {
  const [settings, setSettings] = useState<DeckSettings>(DEFAULT_SETTINGS);
  const [initialServerUrl, setInitialServerUrl] = useState("");
  const [profileOrigin, setProfileOrigin] = useState("");
  const [profiles, setProfiles] = useState<DeckProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [renameProfileName, setRenameProfileName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showPat, setShowPat] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>("conn");
  const [performanceWide, setPerformanceWide] = useState(false);
  const installBannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showInstallBanner) {
      installBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [showInstallBanner]);

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = pageCss;
    document.head.append(style);
    return () => { style.remove(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const next = await loadDeckSettings();
      if (!cancelled) {
        setSettings(next);
        setInitialServerUrl(next.serverUrl);
        setProfileOrigin(next.serverUrl);
        setLoaded(true);
        const profileSnapshot = await loadDeckProfiles(next.serverUrl || undefined);
        if (!cancelled) {
          setProfiles(profileSnapshot.profiles);
          setActiveProfileId(profileSnapshot.activeProfileId);
        }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  const refreshProfiles = async (origin: string) => {
    const snapshot = await loadDeckProfiles(origin || undefined);
    setProfiles(snapshot.profiles);
    setActiveProfileId(snapshot.activeProfileId);
    setProfileOrigin(origin);
  };

  useEffect(() => {
    const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
    setRenameProfileName(activeProfile?.name ?? "");
  }, [activeProfileId, profiles]);

  useEffect(() => {
    document.body.dataset.theme = resolveTheme(settings.theme);
    document.documentElement.lang = settings.language;
  }, [settings.language, settings.theme]);

  const { t } = useTranslation();
  useEffect(() => { void i18n.changeLanguage(settings.language); }, [settings.language]);
  const text = useOptionsText();
  const version = useMemo(() => getManifestVersion(), []);
  const patStorageSessionLabel = t("options.patStorageSessionLabel");
  const patStoragePersistentLabel = t("options.patStoragePersistentLabel");
  const patStorageHint = t("options.patStorageHint");

  const themeOptions = useMemo<CustomSelectOption[]>(
    () => [
      { value: "system", label: text.themeSystem },
      { value: "mattermost", label: text.themeMattermost },
      { value: "dark", label: text.themeDark },
      { value: "light", label: text.themeLight },
    ],
    [text],
  );
  const languageOptions = useMemo<CustomSelectOption[]>(
    () => [
      { value: "ja",    label: text.languageJa },
      { value: "en",    label: text.languageEn },
      { value: "de",    label: text.languageDe },
      { value: "zh-CN", label: text.languageZhCn },
      { value: "fr",    label: text.languageFr },
    ],
    [text],
  );
  const postClickActionOptions = useMemo<CustomSelectOption[]>(
    () => [
      { value: "navigate", label: t("options.postClickNavigate") },
      { value: "none", label: t("options.postClickNone") },
      { value: "ask", label: t("options.postClickAsk") },
    ],
    [t],
  );
  const paneColorLabels = useMemo<Record<ColumnColorKey, string>>(
    () => ({
      mentions: t("options.paneTypeMentions"),
      channelWatch: t("options.paneTypeChannelWatch"),
      dmWatch: t("options.paneTypeDmWatch"),
      keywordWatch: t("options.paneTypeKeywordWatch"),
      search: t("options.paneTypeSearch"),
      saved: t("options.paneTypeSaved"),
      diagnostics: t("options.paneTypeDiagnostics", { defaultValue: "Diagnostics" }),
    }),
    [t],
  );
  const [traceEntries, traceCaptureEnabled] = useTraceLogSnapshot();
  const [endpointSummarySort, setEndpointSummarySort] = useState<{ key: EndpointSummarySortKey; direction: "asc" | "desc" }>({
    key: "count",
    direction: "desc",
  });
  const [recentTraceSort, setRecentTraceSort] = useState<{ key: ApiTraceSortKey; direction: "asc" | "desc" }>({
    key: "timestamp",
    direction: "desc",
  });
  const apiTraceEntries = useMemo(
    () => traceEntries.filter((entry): entry is TraceApiEntry => entry.source === "api" && entry.event === "request.complete"),
    [traceEntries],
  );
  const apiTraceLogEntries = useMemo(
    () => traceEntries.filter((entry): entry is TraceApiEntry => entry.source === "api" && (entry.event === "request.complete" || entry.event === "request.error")),
    [traceEntries],
  );
  const requestTimeline = useMemo(
    () => buildBucketSeries(traceEntries, 60_000, 20, (entry) => entry.source === "api" && entry.event === "request.complete"),
    [traceEntries],
  );
  const latencyTimeline = useMemo(
    () =>
      Array.from({ length: 20 }, (_, index) => {
        const now = Date.now();
        const bucketEnd = now - ((19 - index) * 60_000);
        const bucketStart = bucketEnd - 60_000;
        const values = apiTraceEntries
          .filter((entry) => entry.timestamp >= bucketStart && entry.timestamp < bucketEnd)
          .map((entry) => Number(entry.payload?.durationMs ?? 0))
          .filter((value) => Number.isFinite(value) && value > 0);
        return values.length > 0 ? computeAverage(values) : 0;
      }),
    [apiTraceEntries],
  );
  const performanceSummary = useMemo(() => {
    const durations = apiTraceEntries
      .map((entry) => Number(entry.payload?.durationMs ?? 0))
      .filter((value) => Number.isFinite(value) && value > 0);
    const queueWaits = apiTraceEntries
      .map((entry) => Number(entry.payload?.queueWaitMs ?? 0))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const failures = apiTraceEntries.filter((entry) => Boolean(entry.payload?.failed)).length;
    const endpointCounts = new Map<string, number>();
    const endpointPurpose = new Map<string, string>();
    const endpointDurations = new Map<string, number[]>();
    const endpointErrors = new Map<string, number>();
    let getCount = 0;
    let postCount = 0;

    for (const entry of apiTraceEntries) {
      const path = entry.payload?.path ?? "(unknown)";
      endpointCounts.set(path, (endpointCounts.get(path) ?? 0) + 1);
      if (entry.payload?.purpose) {
        endpointPurpose.set(path, entry.payload.purpose);
      }
      const duration = Number(entry.payload?.durationMs ?? 0);
      if (Number.isFinite(duration) && duration > 0) {
        endpointDurations.set(path, [...(endpointDurations.get(path) ?? []), duration]);
      }
      if (Boolean(entry.payload?.failed)) {
        endpointErrors.set(path, (endpointErrors.get(path) ?? 0) + 1);
      }
      if (entry.payload?.method === "GET") {
        getCount += 1;
      } else if (entry.payload?.method === "POST") {
        postCount += 1;
      }
    }

    const rateLimitWaits = traceEntries.filter((entry) => entry.source === "api" && entry.event === "request.rate_limit_wait").length;

    const endpointRows = [...endpointCounts.entries()]
      .map(([path, count]) => ({
        path,
        count,
        purpose: endpointPurpose.get(path) ?? "Other API request",
        avgLatencyMs: computeAverage(endpointDurations.get(path) ?? []),
        p95LatencyMs: computeP95(endpointDurations.get(path) ?? []),
        errorCount: endpointErrors.get(path) ?? 0,
      }))
      .filter((row) => row.count > 0);

    return {
      totalEntries: traceEntries.length,
      apiRequests: apiTraceEntries.length,
      errorRate: apiTraceEntries.length > 0 ? failures / apiTraceEntries.length : 0,
      avgLatencyMs: computeAverage(durations),
      p95LatencyMs: computeP95(durations),
      avgQueueWaitMs: computeAverage(queueWaits),
      getCount,
      postCount,
      rateLimitWaits,
      endpointRows,
    };
  }, [apiTraceEntries, traceEntries]);
  const endpointSummaryRows = useMemo(() => {
    const multiplier = endpointSummarySort.direction === "asc" ? 1 : -1;
    return performanceSummary.endpointRows
      .slice()
      .sort((left, right) => {
        if (endpointSummarySort.key === "purpose") {
          return left.purpose.localeCompare(right.purpose) * multiplier;
        }
        if (endpointSummarySort.key === "avgLatencyMs") {
          return (left.avgLatencyMs - right.avgLatencyMs) * multiplier;
        }
        if (endpointSummarySort.key === "p95LatencyMs") {
          return (left.p95LatencyMs - right.p95LatencyMs) * multiplier;
        }
        if (endpointSummarySort.key === "errorRate") {
          return (((left.errorCount / left.count) || 0) - ((right.errorCount / right.count) || 0)) * multiplier;
        }
        return (left.count - right.count) * multiplier;
      })
      .slice(0, 10);
  }, [endpointSummarySort, performanceSummary.endpointRows]);
  const recentTraceRows = useMemo(() => {
    const multiplier = recentTraceSort.direction === "asc" ? 1 : -1;
    return apiTraceLogEntries
      .slice()
      .sort((left, right) => {
        if (recentTraceSort.key === "purpose") {
          return String(left.payload?.purpose ?? "").localeCompare(String(right.payload?.purpose ?? "")) * multiplier;
        }
        if (recentTraceSort.key === "status") {
          return ((Number(left.payload?.status ?? 0)) - Number(right.payload?.status ?? 0)) * multiplier;
        }
        if (recentTraceSort.key === "durationMs") {
          return ((Number(left.payload?.durationMs ?? 0)) - Number(right.payload?.durationMs ?? 0)) * multiplier;
        }
        return (left.timestamp - right.timestamp) * multiplier;
      })
      .slice(0, 40);
  }, [apiTraceLogEntries, recentTraceSort]);
  const serverUrlMissing = settings.serverUrl.trim().length === 0;

  const handleSave = async () => {
    const normalizedServerUrl = normaliseServerUrl(settings.serverUrl);
    if (!normalizedServerUrl) {
      setSaveError(text.invalidServerUrl);
      return;
    }

    const isFirstSave = !initialServerUrl;
    setSaving(true);
    setSavedNotice(false);
    setSaveError(null);
    try {
      const requestedOrigin = originToPermissionPattern(normalizedServerUrl);
      if (!requestedOrigin) {
        setSaveError(text.invalidServerUrl);
        return;
      }

      const granted = await chrome.permissions.request({ origins: [requestedOrigin] });
      if (!granted) {
        setSaveError(text.permissionDenied);
        return;
      }

      const previousOrigin = originToPermissionPattern(initialServerUrl);
      await saveDeckSettings({
        ...settings,
        serverUrl: normalizedServerUrl,
        healthCheckPath: normaliseHealthCheckPath(settings.healthCheckPath),
      }, normalizedServerUrl);
      if (previousOrigin && previousOrigin !== requestedOrigin) {
        await chrome.permissions.remove({ origins: [previousOrigin] }).catch(() => undefined);
      }
      await chrome.runtime.sendMessage({ type: "mattermost-deck:sync-content-script" }).catch(() => undefined);
      setInitialServerUrl(normalizedServerUrl);
      await refreshProfiles(normalizedServerUrl);
      setSavedNotice(true);
      if (isFirstSave) setShowInstallBanner(true);
      window.setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const navItems: { id: ActivePanel; icon: React.JSX.Element; label: string }[] = [
    { id: "guide",      icon: <NavIconGuide />,       label: text.guideTitle },
    { id: "conn",       icon: <NavIconConn />,        label: text.connTitle },
    { id: "profiles",   icon: <NavIconProfiles />,    label: text.profilesTitle },
    { id: "realtime",   icon: <NavIconRealtime />,    label: text.realtimeTitle },
    { id: "appearance", icon: <NavIconAppearance />,  label: text.appearanceTitle },
    { id: "behavior",   icon: <NavIconBehavior />,    label: text.behaviorTitle },
    { id: "performance", icon: <NavIconPerformance />, label: text.performanceTitle },
    { id: "security",   icon: <NavIconSecurity />,    label: text.securityTitle },
  ];
  const targetProfileOrigin = normaliseServerUrl(settings.serverUrl) || profileOrigin || initialServerUrl;
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;
  const canDeleteProfile = activeProfile !== null && profiles.length > 1;
  const profileOptions = useMemo<CustomSelectOption[]>(
    () => profiles.map((profile) => ({ value: profile.id, label: profile.name })),
    [profiles],
  );

  const handleSwitchProfile = async (profileId: string) => {
    if (!profileId || !targetProfileOrigin) {
      return;
    }
    await switchDeckProfile(profileId);
    const next = await loadDeckSettings(targetProfileOrigin);
    setSettings(next);
    setInitialServerUrl(next.serverUrl);
    await refreshProfiles(targetProfileOrigin);
  };

  const handleCreateProfile = async () => {
    if (!targetProfileOrigin) {
      setSaveError(text.profilesCreateNeedsServerUrl);
      return;
    }

    const name = newProfileName.trim();
    if (!name) {
      return;
    }

    const profile = await createDeckProfile(name, targetProfileOrigin);
    await switchDeckProfile(profile.id);
    await saveDeckSettings({
      ...settings,
      serverUrl: targetProfileOrigin,
      healthCheckPath: normaliseHealthCheckPath(settings.healthCheckPath),
    }, targetProfileOrigin);
    const next = await loadDeckSettings(targetProfileOrigin);
    setSettings(next);
    setInitialServerUrl(next.serverUrl);
    setNewProfileName("");
    await refreshProfiles(targetProfileOrigin);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleRenameProfile = async () => {
    if (!activeProfile) {
      return;
    }

    const name = renameProfileName.trim();
    if (!name) {
      return;
    }

    await renameDeckProfile(activeProfile.id, name);
    await refreshProfiles(targetProfileOrigin);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleDuplicateProfile = async () => {
    if (!activeProfile || !targetProfileOrigin) {
      return;
    }

    const duplicate = await duplicateDeckProfile(activeProfile.id, `${activeProfile.name} ${text.profilesCopySuffix}`);
    if (!duplicate) {
      return;
    }

    await switchDeckProfile(duplicate.id);
    await saveDeckSettings({
      ...settings,
      serverUrl: targetProfileOrigin,
      healthCheckPath: normaliseHealthCheckPath(settings.healthCheckPath),
    }, targetProfileOrigin);
    const next = await loadDeckSettings(targetProfileOrigin);
    setSettings(next);
    setInitialServerUrl(next.serverUrl);
    await refreshProfiles(targetProfileOrigin);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleDeleteProfile = async () => {
    if (!activeProfile || !canDeleteProfile) {
      return;
    }

    const confirmed = window.confirm(t("options.profilesDeleteConfirm", { name: activeProfile.name }));
    if (!confirmed) {
      return;
    }

    const result = await deleteDeckProfile(activeProfile.id);
    if (!result.deleted) {
      setSaveError(text.profilesDeleteLastError);
      return;
    }

    if (result.nextActiveProfileId) {
      await switchDeckProfile(result.nextActiveProfileId);
    }
    const next = await loadDeckSettings(targetProfileOrigin);
    setSettings(next);
    setInitialServerUrl(next.serverUrl);
    await refreshProfiles(targetProfileOrigin);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleToggleTraceCapture = () => {
    setTraceCaptureEnabled(!traceCaptureEnabled);
  };

  const handleExportTraceJsonl = () => {
    const lines = traceEntries
      .slice()
      .reverse()
      .map((entry) =>
        JSON.stringify({
          ts: new Date(entry.timestamp).toISOString(),
          source: entry.source,
          level: entry.level,
          event: entry.event,
          ...(entry.payload ? { payload: entry.payload } : {}),
        }),
      );
    const blob = new Blob([lines.join("\n")], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mattermost-deck-trace-${Date.now()}.jsonl`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleClearTraceLog = () => {
    clearTraceEntries();
  };

  return (
    <div className="options-app">

      {/* Topbar */}
      <header className="options-topbar">
        <div className="options-topbar-brand">
          <img src="assets/icons/icon-48.png" alt="" width="28" height="28" />
          <h1>{text.title}</h1>
          <span className="options-version">{text.version} {version}</span>
        </div>
      </header>

      {/* Body */}
      <div className="options-body">

        {/* Sidebar */}
        <nav className="options-sidebar">
          <div className="options-sidebar-nav">
            {navItems.map(({ id, icon, label }) => (
              <button
                key={id}
                type="button"
                className={`options-nav-item${activePanel === id ? " active" : ""}`}
                onClick={() => setActivePanel(id)}
              >
                <span className="options-nav-icon">{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="options-sidebar-footer">
            <button
              type="button"
              className="options-sidebar-open-btn"
              disabled={!settings.serverUrl}
              onClick={() => {
                if (settings.serverUrl) {
                  void chrome.tabs.create({ url: settings.serverUrl });
                }
              }}
            >
              {text.openMattermost}
            </button>
            {STORE_URL && (
              <a href={STORE_URL} target="_blank" rel="noreferrer">{text.storeLink}</a>
            )}
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer">{text.privacyPolicy}</a>
            <a href={TERMS_URL} target="_blank" rel="noreferrer">{text.termsOfUse}</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer">{text.github}</a>
            <span className="options-sidebar-copyright">(c) {COPYRIGHT_YEAR} {AUTHOR_NAME}</span>
          </div>
        </nav>

        {/* Content */}
        <main className="options-content">
          <div className="options-panel-scroll">

          {/* Install PWA banner */}
          {showInstallBanner && (
            <div ref={installBannerRef} className="options-install-banner">
              <div className="options-install-banner-body">
                <strong>
                  {t("options.installPwaTitle")}
                </strong>
                <p>
                  {t("options.installPwaDesc")}
                </p>
              </div>
              <div className="options-install-banner-actions">
                <button
                  type="button"
                  className="options-button"
                  onClick={() => {
                    void chrome.runtime.sendMessage({ type: "mattermost-deck:install-pwa", url: settings.serverUrl });
                    setShowInstallBanner(false);
                  }}
                >
                  {t("options.installPwaInstall")}
                </button>
                <button
                  type="button"
                  className="options-button options-button--ghost"
                  onClick={() => setShowInstallBanner(false)}
                >
                  {t("options.installPwaLater")}
                </button>
              </div>
            </div>
          )}

          {/* Panel: Guide */}
          {activePanel === "guide" && (
            <div className="options-panel">
              <div className="options-panel-header">
                <h2>{text.guideTitle}</h2>
                <p>
                  {t("options.guideDesc")}
                </p>
              </div>

              {/* Browser layout diagram */}
              <div className="options-guide-diagram">
                <svg viewBox="0 0 680 260" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={t("options.guideLayoutAlt")}>
                  {/* browser chrome */}
                  <rect width="680" height="260" fill="#0b1322" />
                  <rect width="680" height="32" fill="#111d2e" />
                  {/* tab bar dots */}
                  <circle cx="18" cy="16" r="5" fill="#ff5f57" />
                  <circle cx="36" cy="16" r="5" fill="#febc2e" />
                  <circle cx="54" cy="16" r="5" fill="#28c840" />
                  {/* address bar */}
                  <rect x="80" y="8" width="280" height="16" rx="4" fill="#1a2842" />
                  <text x="220" y="20" textAnchor="middle" fill="#8facd5" fontSize="10" fontFamily="monospace">https://mattermost.example.com</text>
                  {/* Mattermost main area */}
                  <rect x="0" y="32" width="400" height="228" fill="#16202c" />
                  {/* MM sidebar */}
                  <rect x="0" y="32" width="60" height="228" fill="#0e1924" />
                  {/* MM channel list */}
                  <rect x="60" y="32" width="120" height="228" fill="#131e2b" />
                  <rect x="72" y="48" width="88" height="8" rx="3" fill="#1f2e3f" />
                  <rect x="72" y="62" width="68" height="8" rx="3" fill="#1f3a5c" />
                  <rect x="72" y="76" width="72" height="8" rx="3" fill="#1f2e3f" />
                  <rect x="72" y="90" width="60" height="8" rx="3" fill="#1f2e3f" />
                  {/* MM main content */}
                  <rect x="180" y="32" width="220" height="228" fill="#16202c" />
                  {/* posts */}
                  <rect x="196" y="56" width="180" height="10" rx="3" fill="#1f2e3f" />
                  <rect x="196" y="72" width="140" height="8" rx="3" fill="#1c2a3a" />
                  <rect x="196" y="100" width="180" height="10" rx="3" fill="#1f2e3f" />
                  <rect x="196" y="116" width="100" height="8" rx="3" fill="#1c2a3a" />
                  <rect x="196" y="144" width="180" height="10" rx="3" fill="#1f2e3f" />
                  <rect x="196" y="160" width="160" height="8" rx="3" fill="#1c2a3a" />
                  {/* Deck rail */}
                  <rect x="400" y="32" width="280" height="228" fill="#0f1a2b" />
                  {/* deck header */}
                  <rect x="400" y="32" width="280" height="36" fill="#0b1322" />
                  <text x="416" y="55" fill="#7bb2ff" fontSize="12" fontWeight="600" fontFamily="sans-serif">{text.guideDiagramTitle}</text>
                  {/* column dividers */}
                  <line x1="540" y1="68" x2="540" y2="260" stroke="#1a2a3f" strokeWidth="1" />
                  {/* column 1 header */}
                  <rect x="404" y="72" width="128" height="22" rx="4" fill="#1a2842" />
                  <text x="468" y="87" textAnchor="middle" fill="#2f6fed" fontSize="10" fontFamily="sans-serif">{text.guideDiagramMentions}</text>
                  {/* column 1 cards */}
                  <rect x="404" y="100" width="128" height="36" rx="4" fill="#162030" />
                  <rect x="410" y="106" width="80" height="7" rx="2" fill="#1f2e42" />
                  <rect x="410" y="118" width="60" height="6" rx="2" fill="#1a2838" />
                  <rect x="404" y="142" width="128" height="36" rx="4" fill="#162030" />
                  <rect x="410" y="148" width="90" height="7" rx="2" fill="#1f2e42" />
                  <rect x="410" y="160" width="50" height="6" rx="2" fill="#1a2838" />
                  <rect x="404" y="184" width="128" height="36" rx="4" fill="#162030" />
                  <rect x="410" y="190" width="70" height="7" rx="2" fill="#1f2e42" />
                  <rect x="410" y="202" width="80" height="6" rx="2" fill="#1a2838" />
                  {/* column 2 header */}
                  <rect x="544" y="72" width="128" height="22" rx="4" fill="#1a2842" />
                  <text x="608" y="87" textAnchor="middle" fill="#8b5cf6" fontSize="10" fontFamily="sans-serif">{text.guideDiagramDm}</text>
                  {/* column 2 cards */}
                  <rect x="544" y="100" width="128" height="36" rx="4" fill="#162030" />
                  <rect x="550" y="106" width="70" height="7" rx="2" fill="#1f2e42" />
                  <rect x="550" y="118" width="90" height="6" rx="2" fill="#1a2838" />
                  <rect x="544" y="142" width="128" height="36" rx="4" fill="#162030" />
                  <rect x="550" y="148" width="100" height="7" rx="2" fill="#1f2e42" />
                  <rect x="550" y="160" width="60" height="6" rx="2" fill="#1a2838" />
                  {/* label arrow */}
                  <text x="414" y="250" fill="#496583" fontSize="9" fontFamily="sans-serif">{text.guideDiagramMattermost}</text>
                  <text x="544" y="250" fill="#7bb2ff" fontSize="9" fontFamily="sans-serif">{text.guideDiagramDeck}</text>
                  <line x1="400" y1="244" x2="400" y2="236" stroke="#496583" strokeWidth="1" />
                </svg>
              </div>

              {/* Setup steps */}
              <div className="options-subsection">
                <span className="options-subsection-label">
                  {t("options.guideSetupLabel")}
                </span>
                <div className="options-steps">
                  <div className="options-step">
                    <div className="options-step-num">1</div>
                    <div className="options-step-content">
                      <div className="options-step-title">
                        {t("options.guideStep1Title")}
                      </div>
                      <div className="options-step-desc">
                        {t("options.guideStep1Desc")}
                      </div>
                    </div>
                  </div>
                  <div className="options-step">
                    <div className="options-step-num">2</div>
                    <div className="options-step-content">
                      <div className="options-step-title">
                        {t("options.guideStep2Title")}
                      </div>
                      <div className="options-step-desc">
                        {t("options.guideStep2Desc")}
                      </div>
                    </div>
                  </div>
                  <div className="options-step">
                    <div className="options-step-num">3</div>
                    <div className="options-step-content">
                      <div className="options-step-title">
                        {t("options.guideStep3Title")}
                      </div>
                      <div className="options-step-desc">
                        {t("options.guideStep3Desc")}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="options-divider" />

              {/* Column types */}
              <div className="options-subsection">
                <span className="options-subsection-label">
                  {t("options.guidePaneTypesLabel")}
                </span>
                <div className="options-col-types">
                  {[
                    { key: "mentions",     color: "#2f6fed", name: t("options.paneTypeMentions"),     desc: t("options.paneTypeMentionsDesc") },
                    { key: "channelWatch", color: "#1f9d7a", name: t("options.paneTypeChannelWatch"), desc: t("options.paneTypeChannelWatchDesc") },
                    { key: "dmWatch",      color: "#8b5cf6", name: t("options.paneTypeDmWatch"),      desc: t("options.paneTypeDmWatchDesc") },
                    { key: "keywordWatch", color: "#d97706", name: t("options.paneTypeKeywordWatch"), desc: t("options.paneTypeKeywordWatchDesc") },
                    { key: "search",       color: "#0891b2", name: t("options.paneTypeSearch"),       desc: t("options.paneTypeSearchDesc") },
                    { key: "saved",        color: "#c2410c", name: t("options.paneTypeSaved"),        desc: t("options.paneTypeSavedDesc") },
                  ].map(({ key, color, name, desc }) => (
                    <div key={key} className="options-col-type">
                      <div className="options-col-type-header">
                        <div className="options-col-dot" style={{ background: color }} />
                        <span className="options-col-type-name">{name}</span>
                      </div>
                      <div className="options-col-type-desc">{desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Panel: Connection */}
          {activePanel === "conn" && (
            <div className="options-panel">
              <div className="options-panel-header">
                <h2>{text.connTitle}</h2>
                <p>{text.connDesc}</p>
              </div>

              {loaded && !initialServerUrl && (
                <div className="options-setup-banner">
                  <span>⚠️</span>
                  <p>
                    {t("options.setupWarning")}
                  </p>
                </div>
              )}

              <div className="options-grid options-grid--target">
                <label className="options-field">
                  <span className="options-label options-label--required">
                    <span>{text.serverUrlLabel}</span>
                    <span className="options-required-badge">
                      {t("options.serverUrlRequired")}
                    </span>
                  </span>
                  <input
                    className={`options-input${serverUrlMissing ? " options-input--required-missing" : ""}`}
                    type="url"
                    placeholder={text.serverUrlPlaceholder}
                    value={settings.serverUrl}
                    onChange={(e) => setSettings((s) => ({ ...s, serverUrl: e.target.value }))}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {serverUrlMissing && (
                    <span className="options-required-hint">
                      {t("options.serverUrlRequiredHint")}
                    </span>
                  )}
                </label>
                <label className="options-field">
                  <span className="options-label">{text.teamSlugLabel}</span>
                  <input
                    className="options-input"
                    type="text"
                    placeholder={text.teamSlugPlaceholder}
                    value={settings.teamSlug}
                    onChange={(e) => setSettings((s) => ({ ...s, teamSlug: e.target.value }))}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <span className="options-hint">{text.targetHint}</span>
                </label>
              </div>

              <div className="options-callout" role="note">
                <strong>
                  {t("options.firstSavePermTitle")}
                </strong>
                <p>
                  {t("options.firstSavePermDesc")}
                </p>
              </div>

              <div className="options-divider" />

              <div className="options-subsection">
                <span className="options-subsection-label">{text.advanced}</span>
                <div className="options-grid">
                  <label className="options-field">
                    <span className="options-label">{text.routeKindsLabel}</span>
                    <input
                      className="options-input"
                      type="text"
                      value={settings.allowedRouteKinds}
                      onChange={(e) => setSettings((s) => ({ ...s, allowedRouteKinds: e.target.value }))}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <span className="options-hint">{text.routeKindsHint}</span>
                  </label>
                  <label className="options-field">
                    <span className="options-label">{text.healthCheckLabel}</span>
                    <input
                      className="options-input"
                      type="text"
                      value={settings.healthCheckPath}
                      onChange={(e) => setSettings((s) => ({ ...s, healthCheckPath: e.target.value }))}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <span className="options-hint">{text.healthCheckHint}</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Panel: Profiles */}
          {activePanel === "profiles" && (
            <div className="options-panel">
              <div className="options-panel-header">
                <h2>{text.profilesTitle}</h2>
                <p>{text.profilesDesc}</p>
              </div>

              <div className="options-callout" role="note">
                <strong>{text.profilesRecommendedTitle}</strong>
                <p>
                  {text.profilesRecommendedBody}
                </p>
              </div>

              <div className="options-subsection">
                <span className="options-subsection-label">{text.profilesHowItWorksLabel}</span>
                <div className="options-stack">
                  <p className="options-copy">{text.profilesHowItWorksBody1}</p>
                  <p className="options-copy">{text.profilesHowItWorksBody2}</p>
                </div>
              </div>

              <div className="options-subsection">
                <span className="options-subsection-label">{text.profilesSectionLabel}</span>
                <div className="options-grid">
                  <label className="options-field">
                    <span className="options-label">{text.currentProfileLabel}</span>
                    <CustomSelect
                      options={profileOptions}
                      value={activeProfileId}
                      placeholder={text.currentProfilePlaceholder}
                      allowClear={false}
                      onChange={(value) => void handleSwitchProfile(value)}
                      disabled={profiles.length === 0}
                    />
                    <span className="options-hint">
                      {targetProfileOrigin
                        ? t("options.profilesForOrigin", { origin: targetProfileOrigin })
                        : text.profilesNeedsConnection}
                    </span>
                  </label>
                  <label className="options-field">
                    <span className="options-label">{text.createProfileLabel}</span>
                    <div className="options-inline">
                      <input
                        className="options-input"
                        type="text"
                        value={newProfileName}
                        onChange={(e) => setNewProfileName(e.target.value)}
                        placeholder={text.createProfilePlaceholder}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="options-button"
                        onClick={() => void handleCreateProfile()}
                        disabled={!newProfileName.trim()}
                      >
                        {text.createProfileButton}
                      </button>
                    </div>
                    <span className="options-hint">{text.createProfileHint}</span>
                  </label>
                  <label className="options-field">
                    <span className="options-label">{text.manageCurrentProfileLabel}</span>
                    <div className="options-inline">
                      <input
                        className="options-input"
                        type="text"
                        value={renameProfileName}
                        onChange={(e) => setRenameProfileName(e.target.value)}
                        placeholder={text.renameCurrentProfilePlaceholder}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={!activeProfile}
                      />
                      <button
                        type="button"
                        className="options-button options-button--ghost"
                        onClick={() => void handleRenameProfile()}
                        disabled={!activeProfile || !renameProfileName.trim() || renameProfileName.trim() === activeProfile.name}
                      >
                        {text.renameProfileButton}
                      </button>
                    </div>
                    <div className="options-inline">
                      <button
                        type="button"
                        className="options-button options-button--ghost"
                        onClick={() => void handleDuplicateProfile()}
                        disabled={!activeProfile}
                      >
                        {text.duplicateProfileButton}
                      </button>
                      <button
                        type="button"
                        className="options-button options-button--ghost"
                        onClick={() => void handleDeleteProfile()}
                        disabled={!canDeleteProfile}
                      >
                        {text.deleteProfileButton}
                      </button>
                    </div>
                    <span className="options-hint">{text.deleteProfileHint}</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Panel: Realtime */}
          {activePanel === "realtime" && (
            <div className="options-panel">
              <div className="options-panel-header">
                <h2>{text.realtimeTitle}</h2>
                <p>{text.realtimeDesc}</p>
              </div>

              {/* Polling vs Realtime comparison */}
              <div className="options-grid">
                <div className="options-callout" role="note">
                  <strong>
                    {t("options.pollingModeTitle")}
                  </strong>
                  <p>
                    {t("options.pollingModeDesc", { sec: settings.pollingIntervalSeconds })}
                  </p>
                </div>
                <div className="options-callout" role="note" style={{ borderColor: "rgba(31, 157, 255, 0.3)", background: "rgba(31, 157, 255, 0.07)" }}>
                  <strong>
                    {t("options.realtimeModeTitle")}
                  </strong>
                  <p>
                    {t("options.realtimeModeDesc")}
                  </p>
                </div>
              </div>

              <div className="options-inline-links">
                <a href={PAT_ENABLE_URL} target="_blank" rel="noreferrer">{text.patEnableLink}</a>
                <a href={PAT_GUIDE_URL} target="_blank" rel="noreferrer">{text.patGuideLink}</a>
              </div>

              <div className="options-grid">
                <label className="options-field">
                  <span className="options-label">{text.patLabel}</span>
                  <div className="options-inline">
                    <input
                      className="options-input"
                      type={showPat ? "text" : "password"}
                      placeholder={text.patPlaceholder}
                      value={settings.wsPat}
                      onChange={(e) => setSettings((s) => ({ ...s, wsPat: e.target.value }))}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="options-button options-button--ghost"
                      onClick={() => setShowPat((v) => !v)}
                    >
                      {showPat ? text.hide : text.show}
                    </button>
                  </div>
                  <div className="options-choice-row" role="radiogroup" aria-label={text.patStorageLabel}>
                    <label className="options-choice">
                      <input
                        type="radio"
                        name="pat-storage"
                        checked={!settings.persistPat}
                        onChange={() => setSettings((s) => ({ ...s, persistPat: false }))}
                      />
                      <span>{patStorageSessionLabel}</span>
                    </label>
                    <label className="options-choice">
                      <input
                        type="radio"
                        name="pat-storage"
                        checked={settings.persistPat}
                        onChange={() => setSettings((s) => ({ ...s, persistPat: true }))}
                      />
                      <span>{patStoragePersistentLabel}</span>
                    </label>
                  </div>
                  <span className="options-hint">{patStorageHint}</span>
                </label>
                <label className="options-field">
                  <span className="options-label">{text.pollingLabel}</span>
                  <input
                    className="options-input"
                    type="number"
                    min={MIN_POLLING_INTERVAL_SECONDS}
                    max={300}
                    step={1}
                    value={settings.pollingIntervalSeconds}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        pollingIntervalSeconds: normalisePollingIntervalSeconds(e.target.value),
                      }))
                    }
                  />
                  <span className="options-hint">{text.pollingHint}</span>
                </label>
              </div>

              <div className="options-callout" role="note">
                <strong>{t("options.getPatTitle")}</strong>
                <p>{text.patHelp}</p>
              </div>
            </div>
          )}

          {/* Panel: Appearance */}
          {activePanel === "appearance" && (
            <div className="options-panel">
              <div className="options-panel-header">
                <h2>{text.appearanceTitle}</h2>
                <p>{text.appearanceDesc}</p>
              </div>

              <div className="options-grid">
                <label className="options-field">
                  <span className="options-label">{text.themeLabel}</span>
                  <CustomSelect
                    options={themeOptions}
                    value={settings.theme}
                    placeholder={text.themeSystem}
                    allowClear={false}
                    onChange={(v) => setSettings((s) => ({ ...s, theme: v as DeckTheme }))}
                  />
                </label>
                <label className="options-field">
                  <span className="options-label">{text.languageLabel}</span>
                  <CustomSelect
                    options={languageOptions}
                    value={settings.language}
                    placeholder={text.languageJa}
                    allowClear={false}
                    onChange={(v) => setSettings((s) => ({ ...s, language: v as DeckLanguage }))}
                  />
                </label>
                <label className="options-field">
                  <span className="options-label">{text.fontScaleLabel}</span>
                  <input
                    className="options-input"
                    type="number"
                    min={MIN_FONT_SCALE_PERCENT}
                    max={MAX_FONT_SCALE_PERCENT}
                    step={1}
                    value={settings.fontScalePercent}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        fontScalePercent: normaliseFontScalePercent(e.target.value),
                      }))
                    }
                  />
                  <span className="options-hint">{text.fontScaleHint}</span>
                </label>
                <label className="options-field">
                  <span className="options-label">{text.paneWidthLabel}</span>
                  <input
                    className="options-input"
                    type="number"
                    min={MIN_PREFERRED_RAIL_WIDTH}
                    max={MAX_PREFERRED_RAIL_WIDTH}
                    step={10}
                    value={settings.preferredRailWidth}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        preferredRailWidth: normalisePreferredRailWidth(e.target.value),
                      }))
                    }
                  />
                  <span className="options-hint">{text.paneWidthHint}</span>
                </label>
                <label className="options-field">
                  <span className="options-label">{text.columnWidthLabel}</span>
                  <input
                    className="options-input"
                    type="number"
                    min={MIN_PREFERRED_COLUMN_WIDTH}
                    max={MAX_PREFERRED_COLUMN_WIDTH}
                    step={10}
                    value={settings.preferredColumnWidth}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        preferredColumnWidth: normalisePreferredColumnWidth(e.target.value),
                      }))
                    }
                  />
                  <span className="options-hint">{text.columnWidthHint}</span>
                </label>
                <label className="options-field">
                  <span className="options-label">{text.compactModeLabel}</span>
                  <label className="options-choice">
                    <input
                      type="checkbox"
                      checked={settings.compactMode}
                      onChange={(e) => setSettings((s) => ({ ...s, compactMode: e.target.checked }))}
                    />
                    <span>{text.compactModeHint}</span>
                  </label>
                </label>
                <label className="options-field">
                  <span className="options-label">{text.showImagePreviewsLabel}</span>
                  <label className="options-choice">
                    <input
                      type="checkbox"
                      checked={settings.showImagePreviews}
                      onChange={(e) => setSettings((s) => ({ ...s, showImagePreviews: e.target.checked }))}
                    />
                    <span>{text.showImagePreviewsHint}</span>
                  </label>
                </label>
              </div>

              <div className="options-divider" />

              <div className="options-subsection">
                <span className="options-subsection-label">{text.paneIdentityLabel}</span>
                <p className="options-hint">{text.paneIdentityHint}</p>
                <label className="options-choice">
                  <input
                    type="checkbox"
                    checked={settings.columnColorEnabled}
                    onChange={(e) => setSettings((s) => ({ ...s, columnColorEnabled: e.target.checked }))}
                  />
                  <span>{text.colorAccentsLabel}</span>
                </label>
                <div className="options-color-grid">
                  {(Object.keys(DEFAULT_COLUMN_COLORS) as ColumnColorKey[]).map((key) => (
                    <label key={key} className="options-color-item">
                      <input
                        type="color"
                        value={settings.columnColors[key]}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            columnColors: { ...s.columnColors, [key]: e.target.value },
                          }))
                        }
                      />
                      <span>{paneColorLabels[key]}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Panel: Behavior */}
          {activePanel === "behavior" && (
            <div className="options-panel">
              <div className="options-panel-header">
                <h2>{text.behaviorTitle}</h2>
                <p>{text.behaviorDesc}</p>
              </div>

              <div className="options-grid">
                <label className="options-field">
                  <span className="options-label">{text.postClickActionLabel}</span>
                  <CustomSelect
                    options={postClickActionOptions}
                    value={settings.postClickAction}
                    placeholder={t("options.postClickNavigate")}
                    allowClear={false}
                    onChange={(v) => setSettings((s) => ({ ...s, postClickAction: v as PostClickAction }))}
                  />
                  <span className="options-hint">{text.postClickActionHint}</span>
                </label>
                <label className="options-field">
                  <span className="options-label">{text.highlightKeywordsLabel}</span>
                  <input
                    className="options-input"
                    type="text"
                    value={settings.highlightKeywords}
                    onChange={(e) => setSettings((s) => ({ ...s, highlightKeywords: e.target.value }))}
                    placeholder={text.highlightKeywordsPlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <span className="options-hint">{text.highlightKeywordsHint}</span>
                </label>
                <label className="options-field">
                  <span className="options-label">{text.highZIndexLabel}</span>
                  <label className="options-choice">
                    <input
                      type="checkbox"
                      checked={settings.highZIndex}
                      onChange={(e) => setSettings((s) => ({ ...s, highZIndex: e.target.checked }))}
                    />
                    <span>{text.highZIndexHint}</span>
                  </label>
                </label>
                <label className="options-field">
                  <span className="options-label">{text.reversedPostOrderLabel}</span>
                  <label className="options-choice">
                    <input
                      type="checkbox"
                      checked={settings.reversedPostOrder}
                      onChange={(e) => setSettings((s) => ({ ...s, reversedPostOrder: e.target.checked }))}
                    />
                    <span>{text.reversedPostOrderHint}</span>
                  </label>
                </label>
              </div>

            </div>
          )}

          {/* Panel: Performance */}
          {activePanel === "performance" && (
            <div className={`options-panel${performanceWide ? " options-panel--wide" : ""}`}>
              <div className="options-panel-header">
                <div className="options-panel-header-copy">
                  <h2>{text.performanceTitle}</h2>
                  <p>{text.performanceDesc}</p>
                </div>
                <button
                  type="button"
                  className="options-panel-expand"
                  onClick={() => setPerformanceWide((current) => !current)}
                  title={performanceWide ? text.performanceCollapseWide : text.performanceExpandWide}
                  aria-label={performanceWide ? text.performanceCollapseWide : text.performanceExpandWide}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {performanceWide ? (
                      <>
                        <path d="M9 4H4v5" />
                        <path d="M15 4h5v5" />
                        <path d="M20 15v5h-5" />
                        <path d="M4 15v5h5" />
                        <path d="M4 9l5-5" />
                        <path d="M20 9l-5-5" />
                        <path d="M20 15l-5 5" />
                        <path d="M4 15l5 5" />
                      </>
                    ) : (
                      <>
                        <path d="M9 4H4v5" />
                        <path d="M15 4h5v5" />
                        <path d="M20 15v5h-5" />
                        <path d="M4 15v5h5" />
                        <path d="M9 9L4 4" />
                        <path d="M15 9l5-5" />
                        <path d="M15 15l5 5" />
                        <path d="M9 15l-5 5" />
                      </>
                    )}
                  </svg>
                </button>
              </div>

              <div className="options-callout" role="note">
                <strong>{text.performanceCaptureLabel}</strong>
                <p>{text.performanceCaptureHint}</p>
                <p style={{ marginTop: "6px" }}>{text.performanceRetentionHint}</p>
                <div className="options-inline" style={{ marginTop: "12px" }}>
                  <label className="options-choice">
                    <input
                      type="checkbox"
                      checked={traceCaptureEnabled}
                      onChange={handleToggleTraceCapture}
                    />
                    <span>{traceCaptureEnabled ? "ON" : "OFF"}</span>
                  </label>
                  <button
                    type="button"
                    className="options-button options-button--ghost"
                    onClick={handleExportTraceJsonl}
                    disabled={traceEntries.length === 0}
                  >
                    {text.performanceExport}
                  </button>
                  <button
                    type="button"
                    className="options-button options-button--ghost"
                    onClick={handleClearTraceLog}
                    disabled={traceEntries.length === 0}
                  >
                    {text.performanceClear}
                  </button>
                </div>
              </div>

              <div className="options-metric-grid">
                <article className="options-metric-card">
                  <strong>{text.performanceEntries}</strong>
                  <p>{performanceSummary.totalEntries.toLocaleString()}</p>
                </article>
                <article className="options-metric-card">
                  <strong>{text.performanceApiRequests}</strong>
                  <p>{performanceSummary.apiRequests.toLocaleString()}</p>
                </article>
                <article className="options-metric-card">
                  <strong>{text.performanceErrorRate}</strong>
                  <p>{formatPercent(performanceSummary.errorRate)}</p>
                </article>
                <article className="options-metric-card">
                  <strong>{text.performanceAvgLatency}</strong>
                  <p>{formatMs(performanceSummary.avgLatencyMs)}</p>
                </article>
                <article className="options-metric-card">
                  <strong>{text.performanceP95Latency}</strong>
                  <p>{formatMs(performanceSummary.p95LatencyMs)}</p>
                </article>
                <article className="options-metric-card">
                  <strong>{text.performanceQueueWait}</strong>
                  <p>{formatMs(performanceSummary.avgQueueWaitMs)}</p>
                </article>
                <article className="options-metric-card">
                  <strong>{text.performanceMethodMix}</strong>
                  <p>{performanceSummary.getCount} / {performanceSummary.postCount}</p>
                </article>
                <article className="options-metric-card">
                  <strong>{text.performanceRateLimitWaits}</strong>
                  <p>{performanceSummary.rateLimitWaits.toLocaleString()}</p>
                </article>
              </div>

              <div className="options-grid">
                <article className="options-analysis-card">
                  <div className="options-analysis-header">
                    <strong>{text.performanceApiRate}</strong>
                    <span>{performanceSummary.apiRequests.toLocaleString()}</span>
                  </div>
                  <MiniBarChart values={requestTimeline} ariaLabel={text.performanceApiRate} />
                </article>
                <article className="options-analysis-card">
                  <div className="options-analysis-header">
                    <strong>{text.performanceLatencyTrend}</strong>
                    <span>{formatMs(performanceSummary.p95LatencyMs)}</span>
                  </div>
                  <MiniBarChart values={latencyTimeline} ariaLabel={text.performanceLatencyTrend} />
                </article>
              </div>

              <div className="options-grid">
                <article className="options-analysis-card options-analysis-card--full">
                  <div className="options-analysis-header">
                    <strong>{text.performanceEndpointSummary}</strong>
                    <span>{endpointSummaryRows.length}</span>
                  </div>
                  {endpointSummaryRows.length > 0 ? (
                    <div className="options-table-wrap">
                      <table className="options-table">
                        <thead>
                          <tr>
                            <th>
                              <SortableHeader
                                active={endpointSummarySort.key === "purpose"}
                                direction={endpointSummarySort.direction}
                                label={text.performancePurpose}
                                onClick={() => setEndpointSummarySort((current) => ({
                                  key: "purpose",
                                  direction: current.key === "purpose" && current.direction === "desc" ? "asc" : "desc",
                                }))}
                              />
                            </th>
                            <th>
                              <span className="options-table-sort is-active">{text.performanceEndpoint}</span>
                            </th>
                            <th>
                              <SortableHeader
                                active={endpointSummarySort.key === "count"}
                                direction={endpointSummarySort.direction}
                                label={text.performanceRequests}
                                onClick={() => setEndpointSummarySort((current) => ({
                                  key: "count",
                                  direction: current.key === "count" && current.direction === "desc" ? "asc" : "desc",
                                }))}
                              />
                            </th>
                            <th>
                              <SortableHeader
                                active={endpointSummarySort.key === "avgLatencyMs"}
                                direction={endpointSummarySort.direction}
                                label={text.performanceAvg}
                                onClick={() => setEndpointSummarySort((current) => ({
                                  key: "avgLatencyMs",
                                  direction: current.key === "avgLatencyMs" && current.direction === "desc" ? "asc" : "desc",
                                }))}
                              />
                            </th>
                            <th>
                              <SortableHeader
                                active={endpointSummarySort.key === "p95LatencyMs"}
                                direction={endpointSummarySort.direction}
                                label={text.performanceP95}
                                onClick={() => setEndpointSummarySort((current) => ({
                                  key: "p95LatencyMs",
                                  direction: current.key === "p95LatencyMs" && current.direction === "desc" ? "asc" : "desc",
                                }))}
                              />
                            </th>
                            <th>
                              <SortableHeader
                                active={endpointSummarySort.key === "errorRate"}
                                direction={endpointSummarySort.direction}
                                label={text.performanceErrorRateShort}
                                onClick={() => setEndpointSummarySort((current) => ({
                                  key: "errorRate",
                                  direction: current.key === "errorRate" && current.direction === "desc" ? "asc" : "desc",
                                }))}
                              />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {endpointSummaryRows.map(({ path, count, purpose, avgLatencyMs, p95LatencyMs, errorCount }) => (
                            <tr key={path}>
                              <td>
                                <div className="options-table-url">{path}</div>
                              </td>
                              <td>
                                <div className="options-table-main" title={`${purpose}\n${path}`}>{purpose}</div>
                              </td>
                              <td>{count}</td>
                              <td>{formatMs(avgLatencyMs)}</td>
                              <td>{formatMs(p95LatencyMs)}</td>
                              <td>{formatPercent(count > 0 ? errorCount / count : 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="options-hint">{text.performanceEmpty}</p>
                  )}
                </article>
                <article className="options-analysis-card options-analysis-card--full">
                  <div className="options-analysis-header">
                    <strong>{text.performanceRecentTrace}</strong>
                    <span>{apiTraceLogEntries.length}</span>
                  </div>
                  {apiTraceLogEntries.length > 0 ? (
                    <div className="options-table-wrap">
                      <table className="options-table">
                        <thead>
                          <tr>
                            <th>
                              <SortableHeader
                                active={recentTraceSort.key === "timestamp"}
                                direction={recentTraceSort.direction}
                                label={text.performanceTime}
                                onClick={() => setRecentTraceSort((current) => ({
                                  key: "timestamp",
                                  direction: current.key === "timestamp" && current.direction === "desc" ? "asc" : "desc",
                                }))}
                              />
                            </th>
                            <th>
                              <SortableHeader
                                active={recentTraceSort.key === "purpose"}
                                direction={recentTraceSort.direction}
                                label={text.performancePurpose}
                                onClick={() => setRecentTraceSort((current) => ({
                                  key: "purpose",
                                  direction: current.key === "purpose" && current.direction === "desc" ? "asc" : "desc",
                                }))}
                              />
                            </th>
                            <th>
                              <span className="options-table-sort is-active">{text.performanceEndpointUrl}</span>
                            </th>
                            <th>
                              <SortableHeader
                                active={recentTraceSort.key === "status"}
                                direction={recentTraceSort.direction}
                                label={text.performanceStatus}
                                onClick={() => setRecentTraceSort((current) => ({
                                  key: "status",
                                  direction: current.key === "status" && current.direction === "desc" ? "asc" : "desc",
                                }))}
                              />
                            </th>
                            <th>
                              <SortableHeader
                                active={recentTraceSort.key === "durationMs"}
                                direction={recentTraceSort.direction}
                                label={text.performanceDuration}
                                onClick={() => setRecentTraceSort((current) => ({
                                  key: "durationMs",
                                  direction: current.key === "durationMs" && current.direction === "desc" ? "asc" : "desc",
                                }))}
                              />
                            </th>
                            <th>
                              <span className="options-table-sort is-active">{text.performanceMethod}</span>
                            </th>
                            <th>
                              <span className="options-table-sort is-active">{text.performanceQueue}</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {recentTraceRows.map((entry) => (
                            <tr key={`${entry.timestamp}-${entry.source}-${entry.event}`}>
                              <td>{new Date(entry.timestamp).toLocaleTimeString()}</td>
                              <td>{entry.payload?.purpose ?? "-"}</td>
                              <td>
                                <div className="options-table-url">{String(entry.payload?.fullPath ?? entry.payload?.path ?? "-")}</div>
                              </td>
                              <td>{entry.payload?.status ?? "-"}</td>
                              <td>{formatMs(Number(entry.payload?.durationMs ?? 0))}</td>
                              <td>{entry.payload?.method ?? "-"}</td>
                              <td>{formatMs(Number(entry.payload?.queueWaitMs ?? 0))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="options-hint">{text.performanceEmpty}</p>
                  )}
                </article>
              </div>
            </div>
          )}

          {/* Panel: Security */}
          {activePanel === "security" && (
            <div className="options-panel">
              <div className="options-panel-header">
                <h2>{text.securityTitle}</h2>
              </div>
              <div className="options-callout" role="note">
                <p>{text.securityBody}</p>
                <p style={{ marginTop: "8px" }}>{text.securityBody2}</p>
                <p style={{ marginTop: "8px" }}>{text.securityBody3}</p>
              </div>
            </div>
          )}

          </div>{/* options-panel-scroll */}

          {/* Save footer */}
          <footer className="options-save-footer">
            <div className="options-save-footer-inner">
              <span className="options-status">
                {loaded ? saveError ?? (savedNotice ? text.saved : "") : text.saving}
              </span>
              <button
                type="button"
                className="options-button"
                onClick={() => void handleSave()}
                disabled={!loaded || saving}
              >
                {saving ? text.saving : text.save}
              </button>
            </div>
          </footer>

        </main>
      </div>
    </div>
  );
}

// Mount

const root = document.getElementById("options-root");
if (!(root instanceof HTMLDivElement)) {
  throw new Error("Missing options root.");
}

createRoot(root).render(<OptionsApp />);

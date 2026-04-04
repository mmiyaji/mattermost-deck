import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CustomSelect, type CustomSelectOption } from "../ui/CustomSelect";
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

const REPO_URL = "https://github.com/mmiyaji/mattermost-deck";
const PRIVACY_URL = "https://github.com/mmiyaji/mattermost-deck/blob/main/PRIVACY.md";
const TERMS_URL = "https://github.com/mmiyaji/mattermost-deck/blob/main/TERMS.md";
const PAT_ENABLE_URL = "https://docs.mattermost.com/administration-guide/configure/integrations-configuration-settings.html";
const PAT_GUIDE_URL = "https://docs.mattermost.com/agents/mcpserver/README.html";
const AUTHOR_NAME = "mmiyaji";
const COPYRIGHT_YEAR = "2026";

type OptionsText = {
  title: string;
  subtitle: string;
  version: string;
  targetTitle: string;
  targetBody: string;
  serverUrlLabel: string;
  serverUrlPlaceholder: string;
  teamSlugLabel: string;
  teamSlugPlaceholder: string;
  targetHint: string;
  advanced: string;
  routeKindsLabel: string;
  routeKindsHint: string;
  healthCheckLabel: string;
  healthCheckHint: string;
  realtimeTitle: string;
  realtimeBody: string;
  patLabel: string;
  patPlaceholder: string;
  patHelp: string;
  patEnableLink: string;
  patGuideLink: string;
  pollingLabel: string;
  pollingHint: string;
  show: string;
  hide: string;
  appearanceTitle: string;
  appearanceBody: string;
  appearanceAdvanced: string;
  themeLabel: string;
  languageLabel: string;
  fontScaleLabel: string;
  fontScaleHint: string;
  paneWidthLabel: string;
  paneWidthHint: string;
  columnWidthLabel: string;
  columnWidthHint: string;
  themeSystem: string;
  themeMattermost: string;
  themeDark: string;
  themeLight: string;
  languageJa: string;
  languageEn: string;
  save: string;
  saving: string;
  saved: string;
  invalidServerUrl: string;
  securityTitle: string;
  securityBody: string;
  securityBody2: string;
  securityBody3: string;
  privacyPolicy: string;
  termsOfUse: string;
  github: string;
};

const TEXT: Record<DeckLanguage, OptionsText> = {
  ja: {
    title: "Mattermost Deck Settings",
    subtitle: "対象 URL、チーム、詳細ガード、見た目、リアルタイム設定を管理します。",
    version: "Version",
    targetTitle: "Target",
    targetBody: "拡張は設定した Mattermost Server URL 上でのみ有効です。team slug を空にすると全チーム、指定するとそのチーム配下だけで有効になります。",
    serverUrlLabel: "Mattermost Server URL",
    serverUrlPlaceholder: "https://mattermost.example.com",
    teamSlugLabel: "Team Slug",
    teamSlugPlaceholder: "myteam",
    targetHint: "通常は Server URL だけ設定すれば十分です。",
    advanced: "詳細設定",
    routeKindsLabel: "Allowed Route Kinds",
    routeKindsHint: "既定は channels,messages です。拡張はこの URL パターンでのみ有効化されます。",
    healthCheckLabel: "Health Check API Path",
    healthCheckHint: "既定は /api/v4/users/me です。描画前にこの API が正常応答するか確認します。",
    realtimeTitle: "Realtime",
    realtimeBody: "PAT を保存したときだけ WebSocket を有効にします。未設定時は REST ポーリングで更新します。",
    patLabel: "Mattermost PAT",
    patPlaceholder: "Personal Access Token を入力",
    patHelp: "作成場所: User Settings > Security > Personal Access Tokens。管理者側で PAT が有効になっている必要があります。",
    patEnableLink: "PAT の有効化",
    patGuideLink: "取得方法の公式案内",
    pollingLabel: "Polling Interval (seconds)",
    pollingHint: `Realtime 無効時の取得間隔です。下限は ${MIN_POLLING_INTERVAL_SECONDS} 秒です。`,
    show: "表示",
    hide: "非表示",
    appearanceTitle: "Appearance",
    appearanceBody: "Mattermost を選ぶと、現在開いている Mattermost 本体の配色に右ペインを寄せます。",
    appearanceAdvanced: "詳細設定",
    themeLabel: "Theme",
    languageLabel: "Language",
    fontScaleLabel: "Font Size (%)",
    fontScaleHint: `${MIN_FONT_SCALE_PERCENT}% 〜 ${MAX_FONT_SCALE_PERCENT}% で設定します。`,
    paneWidthLabel: "Pane Width (px)",
    paneWidthHint: `${MIN_PREFERRED_RAIL_WIDTH}px 〜 ${MAX_PREFERRED_RAIL_WIDTH}px で設定します。保存済みの手動リサイズ幅がない場合の初期値として使われます。`,
    columnWidthLabel: "Column Width (px)",
    columnWidthHint: `${MIN_PREFERRED_COLUMN_WIDTH}px 〜 ${MAX_PREFERRED_COLUMN_WIDTH}px で設定します。`,
    themeSystem: "System",
    themeMattermost: "Mattermost",
    themeDark: "Dark",
    themeLight: "Light",
    languageJa: "日本語",
    languageEn: "English",
    save: "保存",
    saving: "保存中...",
    saved: "保存しました",
    invalidServerUrl: "Mattermost Server URL を正しい origin 形式で入力してください。",
    securityTitle: "Security",
    securityBody: "PAT は平文ではなく、拡張内で復号可能なクライアント側暗号化を施して保存します。",
    securityBody2: "ただし鍵もクライアント側にあるため、これは最低限の秘匿化です。完全な保護ではありません。",
    securityBody3: "高権限トークンは避け、可能なら専用の低権限トークンを使ってください。",
    privacyPolicy: "プライバシーポリシー",
    termsOfUse: "利用規約",
    github: "GitHub",
  },
  en: {
    title: "Mattermost Deck Settings",
    subtitle: "Manage the target URL, team, detailed guards, appearance, and realtime behavior.",
    version: "Version",
    targetTitle: "Target",
    targetBody: "The extension runs only on the configured Mattermost Server URL. Leave team slug blank to enable on all teams, or set it to scope activation to one team.",
    serverUrlLabel: "Mattermost Server URL",
    serverUrlPlaceholder: "https://mattermost.example.com",
    teamSlugLabel: "Team Slug",
    teamSlugPlaceholder: "myteam",
    targetHint: "In most cases, configuring the Server URL is enough.",
    advanced: "Advanced",
    routeKindsLabel: "Allowed Route Kinds",
    routeKindsHint: "Default is channels,messages. The extension activates only on these URL patterns.",
    healthCheckLabel: "Health Check API Path",
    healthCheckHint: "Default is /api/v4/users/me. The extension confirms this endpoint before rendering.",
    realtimeTitle: "Realtime",
    realtimeBody: "WebSocket is enabled only when a PAT is saved. Without a PAT, the deck updates via REST polling.",
    patLabel: "Mattermost PAT",
    patPlaceholder: "Paste a personal access token",
    patHelp: "Create it from User Settings > Security > Personal Access Tokens. Personal access tokens must also be enabled by an administrator.",
    patEnableLink: "Enable PATs",
    patGuideLink: "Official setup guide",
    pollingLabel: "Polling Interval (seconds)",
    pollingHint: `Used only when realtime is off. The minimum is ${MIN_POLLING_INTERVAL_SECONDS} seconds.`,
    show: "Show",
    hide: "Hide",
    appearanceTitle: "Appearance",
    appearanceBody: "When set to Mattermost, the right rail follows the colors of the currently open Mattermost page.",
    appearanceAdvanced: "Advanced",
    themeLabel: "Theme",
    languageLabel: "Language",
    fontScaleLabel: "Font Size (%)",
    fontScaleHint: `Configurable from ${MIN_FONT_SCALE_PERCENT}% to ${MAX_FONT_SCALE_PERCENT}%.`,
    paneWidthLabel: "Pane Width (px)",
    paneWidthHint: `Configurable from ${MIN_PREFERRED_RAIL_WIDTH}px to ${MAX_PREFERRED_RAIL_WIDTH}px. Used as the initial width when no saved manual resize exists.`,
    columnWidthLabel: "Column Width (px)",
    columnWidthHint: `Configurable from ${MIN_PREFERRED_COLUMN_WIDTH}px to ${MAX_PREFERRED_COLUMN_WIDTH}px.`,
    themeSystem: "System",
    themeMattermost: "Mattermost",
    themeDark: "Dark",
    themeLight: "Light",
    languageJa: "Japanese",
    languageEn: "English",
    save: "Save",
    saving: "Saving...",
    saved: "Saved",
    invalidServerUrl: "Enter the Mattermost Server URL as a valid origin.",
    securityTitle: "Security",
    securityBody: "The PAT is no longer stored as plain text. It is saved using client-side encryption that the extension can decrypt locally.",
    securityBody2: "Because the key also lives on the client, this is only a minimum layer of protection and not a complete security boundary.",
    securityBody3: "Avoid high-privilege tokens. Prefer a dedicated lower-privilege token when possible.",
    privacyPolicy: "Privacy Policy",
    termsOfUse: "Terms of Use",
    github: "GitHub",
  },
};

const pageCss = `
  :root {
    color-scheme: dark;
    font-family: "Segoe UI", sans-serif;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-height: 100vh;
    background: linear-gradient(180deg, #0f1824, #0b121d);
    color: #e5eefb;
  }

  body[data-theme="light"] {
    background: linear-gradient(180deg, #eef4fb, #dde8f5);
    color: #16263b;
  }

  .options-shell {
    max-width: 960px;
    margin: 0 auto;
    padding: 40px 24px 56px;
  }

  .options-header,
  .options-section {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(123, 178, 255, 0.16);
    border-radius: 18px;
  }

  body[data-theme="light"] .options-header,
  body[data-theme="light"] .options-section {
    background: rgba(255, 255, 255, 0.78);
    border-color: rgba(84, 120, 168, 0.14);
  }

  .options-header {
    padding: 24px;
  }

  .options-header-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .options-title {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }

  .options-title img {
    width: 48px;
    height: 48px;
    flex: none;
    border-radius: 6px;
  }

  .options-version {
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(123, 178, 255, 0.12);
    color: #8facd5;
    font-size: 12px;
    white-space: nowrap;
  }

  .options-header h1,
  .options-header p,
  .options-section h2,
  .options-section p,
  .options-footer-meta p {
    margin: 0;
  }

  .options-header p {
    margin-top: 8px;
    color: #8facd5;
  }

  body[data-theme="light"] .options-header p,
  body[data-theme="light"] .options-section p,
  body[data-theme="light"] .options-label,
  body[data-theme="light"] .options-status,
  body[data-theme="light"] .options-version,
  body[data-theme="light"] .options-footer-meta p {
    color: #496583;
  }

  .options-stack {
    display: flex;
    flex-direction: column;
    gap: 18px;
    margin-top: 24px;
  }

  .options-section {
    padding: 20px;
  }

  .options-section p {
    margin-top: 6px;
    color: #8facd5;
    line-height: 1.5;
  }

  .options-grid {
    display: grid;
    grid-template-columns: 1fr 220px;
    gap: 14px;
    margin-top: 18px;
  }

  .options-color-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 14px;
    margin-top: 18px;
  }

  .options-color-item {
    padding: 12px;
    border: 1px solid rgba(123, 178, 255, 0.14);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.03);
  }

  .options-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .options-label {
    font-size: 13px;
    color: #a7c0e4;
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
    min-height: 20px;
    padding: 0 8px;
    border-radius: 999px;
    background: rgba(255, 122, 122, 0.14);
    color: #ff9a9a;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .options-input--required-missing {
    border-color: rgba(255, 122, 122, 0.72);
    box-shadow: 0 0 0 1px rgba(255, 122, 122, 0.16);
  }

  .options-required-hint {
    margin-top: 8px;
    color: #ffb0b0;
    font-size: 12px;
    line-height: 1.5;
  }

  .options-input,
  .options-button {
    min-height: 42px;
    border-radius: 14px;
    border: 1px solid rgba(123, 178, 255, 0.18);
    padding: 0 14px;
    font: inherit;
  }

  .options-input {
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
  }

  body[data-theme="light"] .options-input {
    background: rgba(255, 255, 255, 0.88);
  }

  .options-inline {
    display: flex;
    gap: 10px;
  }

  .options-choice-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 10px;
  }

  .options-choice {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: inherit;
    font-size: 13px;
  }

  .options-button {
    background: linear-gradient(180deg, #1f9dff, #0f71d7);
    color: #fff;
    cursor: pointer;
    border: 0;
    padding: 0 16px;
  }

  .options-button--ghost {
    background: rgba(123, 178, 255, 0.12);
    color: inherit;
    border: 1px solid rgba(123, 178, 255, 0.18);
  }

  .options-details {
    margin-top: 16px;
    border-top: 1px solid rgba(123, 178, 255, 0.12);
    padding-top: 14px;
  }

  .options-callout {
    margin-top: 14px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid rgba(123, 178, 255, 0.18);
    background: rgba(123, 178, 255, 0.08);
    color: inherit;
  }

  .options-callout strong {
    display: block;
    margin-bottom: 6px;
    font-size: 13px;
  }

  .options-callout p {
    margin: 0;
    color: inherit;
    line-height: 1.5;
  }

  .options-details summary {
    cursor: pointer;
    color: #a7c0e4;
    font-size: 13px;
    user-select: none;
  }

  .options-details[open] summary {
    margin-bottom: 12px;
  }

  .options-setup-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    margin-bottom: 20px;
    background: rgba(217, 119, 6, 0.15);
    border: 1px solid rgba(217, 119, 6, 0.45);
    border-radius: 10px;
    font-size: 13px;
  }

  .options-setup-banner-icon {
    font-size: 18px;
    flex: none;
  }

  .options-setup-banner p {
    margin: 0;
    opacity: 0.9;
  }

  .options-install-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-top: 24px;
    padding: 16px 18px;
    background: rgba(28, 88, 217, 0.18);
    border: 1px solid rgba(28, 88, 217, 0.4);
    border-radius: 12px;
  }

  .options-install-banner-body {
    min-width: 0;
  }

  .options-install-banner-body strong {
    display: block;
    font-size: 14px;
    margin-bottom: 4px;
  }

  .options-install-banner-body p {
    font-size: 13px;
    opacity: 0.75;
    margin: 0;
  }

  .options-install-banner-actions {
    display: flex;
    gap: 8px;
    flex: none;
  }

  .options-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 24px;
  }

  .options-status {
    font-size: 13px;
    color: #8facd5;
  }

  .options-footer-meta {
    margin-top: 18px;
    padding: 8px 0 0;
    text-align: center;
  }

  .options-footer-links {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin-top: 12px;
    justify-content: center;
  }

  .options-footer-links a {
    color: #7bb2ff;
    text-decoration: none;
  }

  .options-footer-links a:hover {
    text-decoration: underline;
  }

  .options-inline-links {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 8px;
  }

  .options-inline-links a {
    color: #7bb2ff;
    text-decoration: none;
  }

  .options-inline-links a:hover {
    text-decoration: underline;
  }

  .options-shell .mm-custom-select {
    position: relative;
  }

  .options-shell .mm-custom-select-button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 42px;
    padding: 10px 12px;
    border: 1px solid rgba(123, 178, 255, 0.18);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  body[data-theme="light"] .options-shell .mm-custom-select-button {
    background: rgba(255, 255, 255, 0.88);
  }

  .options-shell .mm-custom-select-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .options-shell .mm-custom-select-label--placeholder {
    color: #8facd5;
  }

  .options-shell .mm-custom-select-chevron {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    stroke-width: 1.7;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    transform: rotate(90deg);
    transition: transform 140ms ease;
  }

  .options-shell .mm-custom-select-chevron--expanded {
    transform: rotate(-90deg);
  }

  .options-shell .mm-custom-select-menu {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    right: 0;
    max-height: 220px;
    overflow-y: auto;
    padding: 6px;
    border: 1px solid rgba(123, 178, 255, 0.18);
    border-radius: 14px;
    background: #152235;
    box-shadow: 0 18px 32px rgba(4, 10, 20, 0.28);
    z-index: 10;
  }

  .options-shell .mm-custom-select-current {
    padding: 4px 4px 8px;
  }

  .options-shell .mm-custom-select-current-label {
    display: block;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
  }

  .options-shell .mm-custom-select-current-label--placeholder {
    color: #8facd5;
  }

  .options-shell .mm-custom-select-divider {
    height: 1px;
    margin: 0 6px 8px;
    background: rgba(123, 178, 255, 0.18);
  }

  body[data-theme="light"] .options-shell .mm-custom-select-menu {
    background: #ffffff;
  }

  body[data-theme="light"] .options-color-item,
  body[data-theme="light"] .options-shell .mm-custom-select-current-label {
    background: rgba(255, 255, 255, 0.88);
  }

  .options-shell .mm-custom-select-option {
    display: block;
    width: 100%;
    padding: 10px 12px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .options-shell .mm-custom-select-option:hover,
  .options-shell .mm-custom-select-option--selected {
    background: rgba(123, 178, 255, 0.14);
  }

  .options-shell .mm-custom-select-search {
    padding: 4px 6px 6px;
  }

  .options-shell .mm-custom-select-search-input {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.07);
    color: inherit;
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
  }

  .options-shell .mm-custom-select-search-input:focus {
    border-color: rgba(123, 178, 255, 0.6);
    box-shadow: 0 0 0 2px rgba(123, 178, 255, 0.18);
  }

  .options-shell .mm-custom-select-empty {
    padding: 10px 12px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 13px;
    text-align: center;
  }

  @media (max-width: 820px) {
    .options-grid {
      grid-template-columns: 1fr;
    }

    .options-footer {
      flex-direction: column;
      align-items: stretch;
    }

    .options-header-top {
      flex-direction: column;
    }
  }
`;

function getManifestVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "0.0.0";
  }
}

function OptionsApp(): React.JSX.Element {
  const [settings, setSettings] = useState<DeckSettings>(DEFAULT_SETTINGS);
  const [initialServerUrl, setInitialServerUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showPat, setShowPat] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
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
    return () => {
      style.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const next = await loadDeckSettings();
      if (!cancelled) {
        setSettings(next);
        setInitialServerUrl(next.serverUrl);
        setLoaded(true);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.body.dataset.theme = resolveTheme(settings.theme);
    document.documentElement.lang = settings.language;
  }, [settings.language, settings.theme]);


  const text = useMemo(() => TEXT[settings.language], [settings.language]);
  const version = useMemo(() => getManifestVersion(), []);
  const patStorageSessionLabel = settings.language === "ja" ? "Session only" : "Session only";
  const patStoragePersistentLabel = settings.language === "ja" ? "Persist across restarts" : "Persist across restarts";
  const patStorageHint =
    settings.language === "ja"
      ? "既定は session only です。ブラウザ再起動後も保持したい場合だけ persist を選んでください。"
      : "Use session-only storage by default. Choose persistent storage only if you want the token kept across browser restarts.";
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
      { value: "ja", label: text.languageJa },
      { value: "en", label: text.languageEn },
    ],
    [text],
  );
  const postClickActionOptions = useMemo<CustomSelectOption[]>(
    () => [
      { value: "navigate", label: settings.language === "ja" ? "遷移" : "Navigate" },
      { value: "none", label: settings.language === "ja" ? "何もしない" : "Do nothing" },
      { value: "ask", label: settings.language === "ja" ? "動作を選ぶ" : "Choose action" },
    ],
    [settings.language],
  );
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
        setSaveError(
          settings.language === "ja"
            ? "Mattermost origin への Chrome 権限が拒否されたため、有効化できませんでした。もう一度 Save を押すと再度許可ダイアログを表示できます。"
            : "Chrome permission for the configured Mattermost origin was denied, so the extension could not be activated. Press Save again to show the permission dialog again.",
        );
        return;
      }

      const previousOrigin = originToPermissionPattern(initialServerUrl);
      await saveDeckSettings({
        ...settings,
        serverUrl: normalizedServerUrl,
        healthCheckPath: normaliseHealthCheckPath(settings.healthCheckPath),
      });
      if (previousOrigin && previousOrigin !== requestedOrigin) {
        await chrome.permissions.remove({ origins: [previousOrigin] }).catch(() => undefined);
      }
      await chrome.runtime.sendMessage({ type: "mattermost-deck:sync-content-script" }).catch(() => undefined);
      setInitialServerUrl(normalizedServerUrl);
      setSavedNotice(true);
      if (isFirstSave) setShowInstallBanner(true);
      window.setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="options-shell">
      <header className="options-header">
        <div className="options-header-top">
          <div className="options-title">
            <img src="assets/icons/icon-48.png" alt="" width="48" height="48" />
            <div>
            <h1>{text.title}</h1>
            <p>{text.subtitle}</p>
            </div>
          </div>
          <div className="options-version">
            {text.version} {version}
          </div>
        </div>
      </header>

      <div className="options-stack">
        {loaded && !initialServerUrl && (
          <div className="options-setup-banner">
            <span className="options-setup-banner-icon">⚠️</span>
            <p>
              {settings.language === "ja"
                ? "初期設定が完了していません。Server URL を入力して Save してください。"
                : "Initial setup is not complete. Enter the Server URL and press Save."}
            </p>
          </div>
        )}

        <section className="options-section">
          <h2>{text.targetTitle}</h2>
          <p>{text.targetBody}</p>
          <div className="options-grid">
            <label className="options-field">
              <span className="options-label options-label--required">
                <span>{text.serverUrlLabel}</span>
                <span className="options-required-badge">{settings.language === "ja" ? "※必須設定" : "Required"}</span>
              </span>
              <input
                className={`options-input${serverUrlMissing ? " options-input--required-missing" : ""}`}
                type="url"
                placeholder={text.serverUrlPlaceholder}
                value={settings.serverUrl}
                onChange={(event) => setSettings((current) => ({ ...current, serverUrl: event.target.value }))}
                autoComplete="off"
                spellCheck={false}
              />
              {serverUrlMissing ? (
                <div className="options-required-hint">
                  {settings.language === "ja"
                    ? "拡張機能を有効化するには Mattermost Server URL の設定が必要です。"
                    : "Mattermost Server URL is required before the extension can be activated."}
                </div>
              ) : null}
            </label>
            <label className="options-field">
              <span className="options-label">{text.teamSlugLabel}</span>
              <input
                className="options-input"
                type="text"
                placeholder={text.teamSlugPlaceholder}
                value={settings.teamSlug}
                onChange={(event) => setSettings((current) => ({ ...current, teamSlug: event.target.value }))}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
          <p>{text.targetHint}</p>
          <div className="options-callout" role="note">
            <strong>{settings.language === "ja" ? "初回保存時の権限許可" : "Chrome permission on first save"}</strong>
            <p>
              {settings.language === "ja"
                ? "Server URL を初めて保存すると、Chrome から対象 Mattermost サーバーへの権限許可が求められます。拡張機能を有効化するには、この許可を承認してください。"
                : "When you save the server URL for the first time, Chrome asks for permission to access that Mattermost server. Approve the request to activate the extension on that server."}
            </p>
          </div>

          <details className="options-details">
            <summary>{text.advanced}</summary>
            <div className="options-grid">
              <label className="options-field">
                <span className="options-label">{text.routeKindsLabel}</span>
                <input
                  className="options-input"
                  type="text"
                  value={settings.allowedRouteKinds}
                  onChange={(event) => setSettings((current) => ({ ...current, allowedRouteKinds: event.target.value }))}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p>{text.routeKindsHint}</p>
              </label>
              <label className="options-field">
                <span className="options-label">{text.healthCheckLabel}</span>
                <input
                  className="options-input"
                  type="text"
                  value={settings.healthCheckPath}
                  onChange={(event) => setSettings((current) => ({ ...current, healthCheckPath: event.target.value }))}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p>{text.healthCheckHint}</p>
              </label>
            </div>
          </details>
        </section>

        <section className="options-section">
          <h2>{text.realtimeTitle}</h2>
          <p>{text.realtimeBody}</p>
          <p>{text.patHelp}</p>
          <div className="options-inline-links">
            <a href={PAT_ENABLE_URL} target="_blank" rel="noreferrer">
              {text.patEnableLink}
            </a>
            <a href={PAT_GUIDE_URL} target="_blank" rel="noreferrer">
              {text.patGuideLink}
            </a>
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
                  onChange={(event) => setSettings((current) => ({ ...current, wsPat: event.target.value }))}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="button" className="options-button options-button--ghost" onClick={() => setShowPat((current) => !current)}>
                  {showPat ? text.hide : text.show}
                </button>
              </div>
              <div className="options-choice-row" role="radiogroup" aria-label="PAT Storage">
                <label className="options-choice">
                  <input
                    type="radio"
                    name="pat-storage"
                    checked={!settings.persistPat}
                    onChange={() => setSettings((current) => ({ ...current, persistPat: false }))}
                  />
                  <span>{patStorageSessionLabel}</span>
                </label>
                <label className="options-choice">
                  <input
                    type="radio"
                    name="pat-storage"
                    checked={settings.persistPat}
                    onChange={() => setSettings((current) => ({ ...current, persistPat: true }))}
                  />
                  <span>{patStoragePersistentLabel}</span>
                </label>
              </div>
              <p>{patStorageHint}</p>
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
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    pollingIntervalSeconds: normalisePollingIntervalSeconds(event.target.value),
                  }))
                }
              />
              <p>{text.pollingHint}</p>
            </label>
          </div>
        </section>

        <section className="options-section">
          <h2>{text.appearanceTitle}</h2>
          <p>{text.appearanceBody}</p>
          <div className="options-grid">
            <label className="options-field">
              <span className="options-label">{text.themeLabel}</span>
              <CustomSelect
                options={themeOptions}
                value={settings.theme}
                placeholder={text.themeSystem}
                allowClear={false}
                onChange={(value) => setSettings((current) => ({ ...current, theme: value as DeckTheme }))}
              />
            </label>
            <label className="options-field">
              <span className="options-label">{text.languageLabel}</span>
              <CustomSelect
                options={languageOptions}
                value={settings.language}
                placeholder={text.languageJa}
                allowClear={false}
                onChange={(value) => setSettings((current) => ({ ...current, language: value as DeckLanguage }))}
              />
            </label>
          </div>
          <details className="options-details">
            <summary>{text.appearanceAdvanced}</summary>
            <div className="options-grid">
              <label className="options-field">
                <span className="options-label">{text.fontScaleLabel}</span>
                <input
                  className="options-input"
                  type="number"
                  min={MIN_FONT_SCALE_PERCENT}
                  max={MAX_FONT_SCALE_PERCENT}
                  step={1}
                  value={settings.fontScalePercent}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      fontScalePercent: normaliseFontScalePercent(event.target.value),
                    }))
                  }
                />
                <p>{text.fontScaleHint}</p>
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
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      preferredRailWidth: normalisePreferredRailWidth(event.target.value),
                    }))
                  }
                />
                <p>{text.paneWidthHint}</p>
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
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      preferredColumnWidth: normalisePreferredColumnWidth(event.target.value),
                    }))
                  }
                />
                <p>{text.columnWidthHint}</p>
              </label>
              <label className="options-field">
                <span className="options-label">Compact Mode</span>
                <label className="options-choice">
                  <input
                    type="checkbox"
                    checked={settings.compactMode}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        compactMode: event.target.checked,
                      }))
                    }
                  />
                  <span>Use denser cards and tighter spacing in the deck.</span>
                </label>
              </label>
              <label className="options-field">
                <span className="options-label">Post Click Action</span>
                <CustomSelect
                  options={postClickActionOptions}
                  value={settings.postClickAction}
                  placeholder="Navigate"
                  allowClear={false}
                  onChange={(value) =>
                    setSettings((current) => ({
                      ...current,
                      postClickAction: value as PostClickAction,
                    }))
                  }
                />
                <p>Choose how post cards behave when clicked. Dragging to select text never opens a thread.</p>
              </label>
            </div>
            <div className="options-grid">
              <label className="options-field">
                <span className="options-label">Pane Identity</span>
                <p>Pane type icons are always shown. Enable color accents to add a colored top border to cards in each pane.</p>
                <label className="options-choice">
                  <input
                    type="checkbox"
                    checked={settings.columnColorEnabled}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        columnColorEnabled: event.target.checked,
                      }))
                    }
                  />
                  <span>Enable color accents</span>
                </label>
              </label>
            </div>
            <div className="options-color-grid">
              {(Object.keys(DEFAULT_COLUMN_COLORS) as ColumnColorKey[]).map((key) => (
                <label key={key} className="options-field options-color-item">
                  <span className="options-label">{key}</span>
                  <input
                    className="options-input"
                    type="color"
                    value={settings.columnColors[key]}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        columnColors: {
                          ...current.columnColors,
                          [key]: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </details>
        </section>

        <section className="options-section">
          <h2>{text.securityTitle}</h2>
          <p>{text.securityBody}</p>
          <p>{text.securityBody2}</p>
          <p>{text.securityBody3}</p>
        </section>
      </div>

      {showInstallBanner && (
        <div ref={installBannerRef} className="options-install-banner">
          <div className="options-install-banner-body">
            <strong>{settings.language === "ja" ? "📲 Mattermostをアプリとしてインストール" : "📲 Install Mattermost as an App"}</strong>
            <p>
              {settings.language === "ja"
                ? "タスクバーやスタートメニューから直接起動できるようになります。"
                : "You can launch it directly from the taskbar or Start menu."}
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
              {settings.language === "ja" ? "インストール" : "Install"}
            </button>
            <button
              type="button"
              className="options-button options-button--ghost"
              onClick={() => setShowInstallBanner(false)}
            >
              {settings.language === "ja" ? "後で" : "Later"}
            </button>
          </div>
        </div>
      )}

      <footer className="options-footer">
        <div className="options-status">{loaded ? saveError ?? (savedNotice ? text.saved : "") : text.saving}</div>
        <button type="button" className="options-button" onClick={handleSave} disabled={!loaded || saving}>
          {saving ? text.saving : text.save}
        </button>
      </footer>

      <section className="options-footer-meta">
        <p>
          © {COPYRIGHT_YEAR} {AUTHOR_NAME}
        </p>
        <div className="options-footer-links">
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
            {text.privacyPolicy}
          </a>
          <a href={TERMS_URL} target="_blank" rel="noreferrer">
            {text.termsOfUse}
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            {text.github}
          </a>
        </div>
      </section>
    </div>
  );
}

const root = document.getElementById("options-root");
if (!(root instanceof HTMLDivElement)) {
  throw new Error("Missing options root.");
}

createRoot(root).render(<OptionsApp />);

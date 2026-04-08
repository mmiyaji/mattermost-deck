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
import { createDeckProfile, loadDeckProfiles, switchDeckProfile, type DeckProfileSummary } from "../ui/profiles";

const REPO_URL = "https://github.com/mmiyaji/mattermost-deck";
const PRIVACY_URL = "https://github.com/mmiyaji/mattermost-deck/blob/main/PRIVACY.md";
const TERMS_URL = "https://github.com/mmiyaji/mattermost-deck/blob/main/TERMS.md";
const PAT_ENABLE_URL = "https://docs.mattermost.com/administration-guide/configure/integrations-configuration-settings.html";
const PAT_GUIDE_URL = "https://docs.mattermost.com/agents/mcpserver/README.html";
const STORE_URL = ""; // Chrome Web Store URL (fill in after publication)
const AUTHOR_NAME = "mmiyaji";
const COPYRIGHT_YEAR = "2026";

type ActivePanel = "guide" | "conn" | "realtime" | "appearance" | "behavior" | "security";

function useOptionsText() {
  const { t } = useTranslation();
  return useMemo(() => ({
    title: t("options.title"),
    version: t("options.version"),
    guideTitle: t("options.guideTitle"),
    connTitle: t("options.connTitle"),
    connDesc: t("options.connDesc"),
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
    postClickActionLabel: t("options.postClickActionLabel"),
    postClickActionHint: t("options.postClickActionHint"),
    highlightKeywordsLabel: t("options.highlightKeywordsLabel", { defaultValue: "Highlight Keywords" }),
    highlightKeywordsHint: t("options.highlightKeywordsHint", { defaultValue: "Comma-separated words or phrases to highlight in posts." }),
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


// 髫ｨ貂可髫ｨ貂可 Sidebar nav icons (Feather-style SVG) 髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可

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

function NavIconSecurity(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// 髫ｨ貂可髫ｨ貂可 CSS 髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可

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

  /* 髫ｨ貂可髫ｨ貂可 App shell 髫ｨ貂可髫ｨ貂可 */
  .options-app {
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* 髫ｨ貂可髫ｨ貂可 Topbar 髫ｨ貂可髫ｨ貂可 */
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

  /* 髫ｨ貂可髫ｨ貂可 Body 髫ｨ貂可髫ｨ貂可 */
  .options-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    min-height: 0;
  }

  /* 髫ｨ貂可髫ｨ貂可 Sidebar 髫ｨ貂可髫ｨ貂可 */
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

  /* 髫ｨ貂可髫ｨ貂可 Content 髫ｨ貂可髫ｨ貂可 */
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

  /* 髫ｨ貂可髫ｨ貂可 Save footer 髫ｨ貂可髫ｨ貂可 */
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
  }

  .options-panel-header h2 {
    font-size: 17px;
    font-weight: 600;
  }

  .options-panel-header p {
    margin-top: 5px;
    font-size: 13px;
    color: #8facd5;
    line-height: 1.55;
  }

  body[data-theme="light"] .options-panel-header p {
    color: #496583;
  }

  /* 髫ｨ貂可髫ｨ貂可 Grid 髫ｨ貂可髫ｨ貂可 */
  .options-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  .options-grid--target {
    grid-template-columns: 1fr 200px;
  }

  /* 髫ｨ貂可髫ｨ貂可 Field 髫ｨ貂可髫ｨ貂可 */
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

  /* 髫ｨ貂可髫ｨ貂可 Inputs 髫ｨ貂可髫ｨ貂可 */
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

  /* 髫ｨ貂可髫ｨ貂可 Buttons 髫ｨ貂可髫ｨ貂可 */
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

  /* 髫ｨ貂可髫ｨ貂可 Inline row 髫ｨ貂可髫ｨ貂可 */
  .options-inline {
    display: flex;
    gap: 8px;
  }

  .options-inline .options-input {
    flex: 1;
  }

  /* 髫ｨ貂可髫ｨ貂可 Radio / Checkbox 髫ｨ貂可髫ｨ貂可 */
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

  /* 髫ｨ貂可髫ｨ貂可 Callout 髫ｨ貂可髫ｨ貂可 */
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

  /* 髫ｨ貂可髫ｨ貂可 Inline links 髫ｨ貂可髫ｨ貂可 */
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

  /* 髫ｨ貂可髫ｨ貂可 Subsection 髫ｨ貂可髫ｨ貂可 */
  .options-subsection {
    display: flex;
    flex-direction: column;
    gap: 12px;
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

  /* 髫ｨ貂可髫ｨ貂可 Color grid 髫ｨ貂可髫ｨ貂可 */
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

  /* 髫ｨ貂可髫ｨ貂可 Install banner 髫ｨ貂可髫ｨ貂可 */
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

  /* 髫ｨ貂可髫ｨ貂可 Setup banner 髫ｨ貂可髫ｨ貂可 */
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

  /* 髫ｨ貂可髫ｨ貂可 Guide 髫ｨ貂可髫ｨ貂可 */
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

  @media (max-width: 520px) {
    .options-col-types { grid-template-columns: repeat(2, 1fr); }
  }

  /* 髫ｨ貂可髫ｨ貂可 CustomSelect (scoped) 髫ｨ貂可髫ｨ貂可 */
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

// 髫ｨ貂可髫ｨ貂可 Helpers 髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可

function getManifestVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "0.0.0";
  }
}

// 髫ｨ貂可髫ｨ貂可 Component 髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可

function OptionsApp(): React.JSX.Element {
  const [settings, setSettings] = useState<DeckSettings>(DEFAULT_SETTINGS);
  const [initialServerUrl, setInitialServerUrl] = useState("");
  const [profileOrigin, setProfileOrigin] = useState("");
  const [profiles, setProfiles] = useState<DeckProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showPat, setShowPat] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>("conn");
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
    { id: "realtime",   icon: <NavIconRealtime />,    label: text.realtimeTitle },
    { id: "appearance", icon: <NavIconAppearance />,  label: text.appearanceTitle },
    { id: "behavior",   icon: <NavIconBehavior />,    label: text.behaviorTitle },
    { id: "security",   icon: <NavIconSecurity />,    label: text.securityTitle },
  ];
  const targetProfileOrigin = normaliseServerUrl(settings.serverUrl) || profileOrigin || initialServerUrl;

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
      setSaveError("Save a valid Mattermost Server URL before creating profiles.");
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

  return (
    <div className="options-app">

      {/* 髫ｨ貂可髫ｨ貂可 Topbar 髫ｨ貂可髫ｨ貂可 */}
      <header className="options-topbar">
        <div className="options-topbar-brand">
          <img src="assets/icons/icon-48.png" alt="" width="28" height="28" />
          <h1>{text.title}</h1>
          <span className="options-version">{text.version} {version}</span>
        </div>
      </header>

      {/* 髫ｨ貂可髫ｨ貂可 Body 髫ｨ貂可髫ｨ貂可 */}
      <div className="options-body">

        {/* 髫ｨ貂可髫ｨ貂可 Sidebar 髫ｨ貂可髫ｨ貂可 */}
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

        {/* 髫ｨ貂可髫ｨ貂可 Content 髫ｨ貂可髫ｨ貂可 */}
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

          {/* 髫ｨ貂可髫ｨ貂可 Panel: 髣厄ｽｴ繝ｻ・ｿ驍ｵ・ｺ郢晢ｽｻ陝・ｿ 髫ｨ貂可髫ｨ貂可 */}
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
                  <text x="416" y="55" fill="#7bb2ff" fontSize="12" fontWeight="600" fontFamily="sans-serif">Mattermost Deck</text>
                  {/* column dividers */}
                  <line x1="540" y1="68" x2="540" y2="260" stroke="#1a2a3f" strokeWidth="1" />
                  {/* column 1 header */}
                  <rect x="404" y="72" width="128" height="22" rx="4" fill="#1a2842" />
                  <text x="468" y="87" textAnchor="middle" fill="#2f6fed" fontSize="10" fontFamily="sans-serif">@ mentions</text>
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
                  <text x="608" y="87" textAnchor="middle" fill="#8b5cf6" fontSize="10" fontFamily="sans-serif">DM Watch</text>
                  {/* column 2 cards */}
                  <rect x="544" y="100" width="128" height="36" rx="4" fill="#162030" />
                  <rect x="550" y="106" width="70" height="7" rx="2" fill="#1f2e42" />
                  <rect x="550" y="118" width="90" height="6" rx="2" fill="#1a2838" />
                  <rect x="544" y="142" width="128" height="36" rx="4" fill="#162030" />
                  <rect x="550" y="148" width="100" height="7" rx="2" fill="#1f2e42" />
                  <rect x="550" y="160" width="60" height="6" rx="2" fill="#1a2838" />
                  {/* label arrow */}
                  <text x="414" y="250" fill="#496583" fontSize="9" fontFamily="sans-serif">Mattermost</text>
                  <text x="544" y="250" fill="#7bb2ff" fontSize="9" fontFamily="sans-serif">Deck overlay</text>
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

          {/* 髫ｨ貂可髫ｨ貂可 Panel: 髫ｰ證ｦ・ｽ・･鬩搾ｽｯ郢晢ｽｻ髫ｨ貂可髫ｨ貂可 */}
          {activePanel === "conn" && (
            <div className="options-panel">
              <div className="options-panel-header">
                <h2>{text.connTitle}</h2>
                <p>{text.connDesc}</p>
              </div>

              <div className="options-subsection">
                <span className="options-subsection-label">Profiles</span>
                <div className="options-grid">
                  <label className="options-field">
                    <span className="options-label">Current Profile</span>
                    <select
                      className="options-input"
                      value={activeProfileId}
                      onChange={(e) => void handleSwitchProfile(e.target.value)}
                      disabled={profiles.length === 0}
                    >
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                    <span className="options-hint">
                      {targetProfileOrigin
                        ? `Profiles for ${targetProfileOrigin}`
                        : "Save a Mattermost Server URL to manage per-origin profiles."}
                    </span>
                  </label>
                  <label className="options-field">
                    <span className="options-label">Create Profile</span>
                    <div className="options-inline">
                      <input
                        className="options-input"
                        type="text"
                        value={newProfileName}
                        onChange={(e) => setNewProfileName(e.target.value)}
                        placeholder="Ops, Support, Night Shift"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="options-button"
                        onClick={() => void handleCreateProfile()}
                        disabled={!newProfileName.trim()}
                      >
                        Create
                      </button>
                    </div>
                    <span className="options-hint">A new profile starts as a copy of the current settings for this server.</span>
                  </label>
                </div>
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

          {/* 髫ｨ貂可髫ｨ貂可 Panel: 驛｢譎｢・ｽ・ｪ驛｢・ｧ繝ｻ・｢驛｢譎｢・ｽ・ｫ驛｢・ｧ繝ｻ・ｿ驛｢・ｧ繝ｻ・､驛｢譎｢・｣・ｰ 髫ｨ貂可髫ｨ貂可 */}
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
                  <div className="options-choice-row" role="radiogroup" aria-label="PAT Storage">
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

          {/* 髫ｨ貂可髫ｨ貂可 Panel: 髯樊ｺｷ繝ｻ繝ｻ・ｦ繝ｻ・ｳ 髫ｨ貂可髫ｨ貂可 */}
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
            </div>
          )}

          {/* 髫ｨ貂可髫ｨ貂可 Panel: 髯ｷ蜥ｲ・ｩ繧托ｽｽ・ｽ郢晢ｽｻ髫ｨ貂可髫ｨ貂可 */}
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
                    placeholder="Navigate"
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
                    placeholder="deploy,error,customer"
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
                      <span>{key}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 髫ｨ貂可髫ｨ貂可 Panel: 驛｢・ｧ繝ｻ・ｻ驛｢・ｧ繝ｻ・ｭ驛｢譎｢・ｽ・･驛｢譎｢・ｽ・ｪ驛｢譏ｴ繝ｻ邵ｺ繝ｻ髫ｨ貂可髫ｨ貂可 */}
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

          {/* 髫ｨ貂可髫ｨ貂可 Save footer 髫ｨ貂可髫ｨ貂可 */}
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

// 髫ｨ貂可髫ｨ貂可 Mount 髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可髫ｨ貂可

const root = document.getElementById("options-root");
if (!(root instanceof HTMLDivElement)) {
  throw new Error("Missing options root.");
}

createRoot(root).render(<OptionsApp />);

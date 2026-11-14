import React, { useEffect, useRef, useState } from "react";
import type { DeckTheme } from "./settings";

export type MattermostThemeStyle = React.CSSProperties & {
  ["--deck-bg"]?: string;
  ["--deck-bg-elevated"]?: string;
  ["--deck-bg-soft"]?: string;
  ["--deck-panel"]?: string;
  ["--deck-panel-2"]?: string;
  ["--deck-card"]?: string;
  ["--deck-card-soft"]?: string;
  ["--deck-border"]?: string;
  ["--deck-border-strong"]?: string;
  ["--deck-text"]?: string;
  ["--deck-text-soft"]?: string;
  ["--deck-text-faint"]?: string;
  ["--deck-topbar-text"]?: string;
  ["--deck-topbar-text-soft"]?: string;
  ["--deck-accent"]?: string;
  ["--deck-accent-strong"]?: string;
  ["--deck-accent-soft"]?: string;
  ["--deck-accent-text"]?: string;
  ["--deck-button-bg"]?: string;
  ["--deck-button-text"]?: string;
  ["--deck-badge-bg"]?: string;
  ["--deck-badge-text"]?: string;
  ["--deck-highlight-bg"]?: string;
  ["--deck-highlight-text"]?: string;
  ["--deck-success"]?: string;
  ["--deck-warn"]?: string;
  ["--deck-danger"]?: string;
};

export function toDeckDebugStyleRecord(style: MattermostThemeStyle | null | undefined): Record<string, string> | null {
  if (!style) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(style).filter(
      ([key, value]) => key.startsWith("--deck-") && typeof value === "string" && value.length > 0,
    ),
  );
}

export const MATTERMOST_THEME_CACHE_KEY = "mattermostDeck.themeCache.v1";

export function getMattermostThemeCacheStorageKey(): string {
  return `${MATTERMOST_THEME_CACHE_KEY}:${window.location.origin}`;
}
export function serialiseMattermostThemeStyle(style: MattermostThemeStyle | undefined): string {
  return JSON.stringify(style ?? {});
}

export function loadCachedMattermostThemeStyle(): MattermostThemeStyle | undefined {
  try {
    const raw = window.localStorage.getItem(getMattermostThemeCacheStorageKey());
    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }

    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith("--deck-") && typeof value === "string" && value.length > 0) {
        next[key] = value;
      }
    }
    return Object.keys(next).length > 0 ? (next as MattermostThemeStyle) : undefined;
  } catch {
    return undefined;
  }
}

export function saveCachedMattermostThemeStyle(style: MattermostThemeStyle): void {
  try {
    const next = serialiseMattermostThemeStyle(style);
    if (window.localStorage.getItem(getMattermostThemeCacheStorageKey()) === next) {
      return;
    }
    window.localStorage.setItem(getMattermostThemeCacheStorageKey(), next);
  } catch {
    return;
  }
}

export function queryFirst(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }

  return null;
}

export function readElementTextColor(selectors: string[]): string | undefined {
  const element = queryFirst(selectors);
  if (!element) {
    return undefined;
  }
  const color = window.getComputedStyle(element).color.trim();
  return color.length > 0 ? color : undefined;
}

export function readElementBackgroundColor(selectors: string[]): string | undefined {
  const element = queryFirst(selectors);
  if (!element) {
    return undefined;
  }
  const backgroundColor = window.getComputedStyle(element).backgroundColor.trim();
  if (!backgroundColor || backgroundColor === "rgba(0, 0, 0, 0)" || backgroundColor === "transparent") {
    return undefined;
  }
  return backgroundColor;
}

export function rgbaFromRgb(color: string, alpha: number): string {
  const match = color.match(/\d+/g);
  if (!match || match.length < 3) {
    return color;
  }

  const [r, g, b] = match;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function lightenRgb(color: string, ratio: number): string {
  const match = color.match(/\d+/g);
  if (!match || match.length < 3) {
    return color;
  }

  const [r, g, b] = match.slice(0, 3).map(Number);
  const mix = (value: number) => Math.round(value + (255 - value) * ratio);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function parseCssColor(color: string): [number, number, number] | null {
  const trimmed = color.trim();
  const rgbMatch = trimmed.match(/\d+(?:\.\d+)?/g);
  if (rgbMatch && rgbMatch.length >= 3) {
    return [Number(rgbMatch[0]), Number(rgbMatch[1]), Number(rgbMatch[2])];
  }

  const hex = trimmed.replace("#", "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [
      Number.parseInt(`${hex[0]}${hex[0]}`, 16),
      Number.parseInt(`${hex[1]}${hex[1]}`, 16),
      Number.parseInt(`${hex[2]}${hex[2]}`, 16),
    ];
  }

  return null;
}

export function relativeLuminance(color: string): number {
  const rgb = parseCssColor(color);
  if (!rgb) {
    return 0;
  }

  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(left: string, right: string): number {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

export function pickBestAccent(background: string, candidates: Array<string | undefined>, fallback: string): string {
  const usable = candidates.filter((candidate): candidate is string => {
    if (!candidate || !candidate.trim()) return false;
    // Reject transparent colors because parseCssColor ignores alpha.
    // would produce a spuriously high contrast ratio (21) and beat every real accent color.
    const alphaMatch = candidate.match(/rgba\([^)]+,\s*([\d.]+)\s*\)/i);
    if (alphaMatch && parseFloat(alphaMatch[1]) < 0.05) return false;
    return true;
  });
  if (usable.length === 0) {
    return fallback;
  }

  return usable
    .map((candidate) => ({ candidate, score: contrastRatio(candidate, background) }))
    .sort((left, right) => right.score - left.score)[0]?.candidate ?? fallback;
}

export function pickReadableForeground(background: string, candidates: Array<string | undefined>, fallback: string): string {
  return pickBestAccent(background, candidates, fallback);
}

export function colorMixFallback(primary: string, secondary: string, ratio = 0.32): string {
  const left = parseCssColor(primary);
  const right = parseCssColor(secondary);
  if (!left || !right) {
    return primary;
  }

  const mix = (a: number, b: number) => Math.round(a * ratio + b * (1 - ratio));
  return `rgb(${mix(left[0], right[0])}, ${mix(left[1], right[1])}, ${mix(left[2], right[2])})`;
}

export function darkenRgb(color: string, ratio: number): string {
  const match = color.match(/\d+/g);
  if (!match || match.length < 3) {
    return color;
  }

  const [r, g, b] = match.slice(0, 3).map(Number);
  const mix = (value: number) => Math.round(value * (1 - ratio));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function readCssVar(style: CSSStyleDeclaration, name: string): string | undefined {
  const value = style.getPropertyValue(name).trim();
  return value.length > 0 ? value : undefined;
}

export function readMattermostThemeValue(
  rootStyle: CSSStyleDeclaration,
  names: readonly string[],
  fallback?: string,
): string {
  for (const name of names) {
    const value = readCssVar(rootStyle, name);
    if (value) {
      return value;
    }
  }
  return fallback ?? "";
}

export function extractMattermostThemeStyle(): MattermostThemeStyle {
  const rootElement = document.documentElement;
  const sidebar = queryFirst(["#SidebarContainer", ".SidebarContainer", ".sidebar-left-container"]);
  const sidebarTeamButton = queryFirst(["#sidebarTeamMenuButton"]);
  const appBody = queryFirst([".app__body", ".app__body-center-channel", ".app__content"]);
  const channelHeader = queryFirst([".channel-header", ".channel-header--info", ".center-channel__header"]);
  const postArea = queryFirst([".post-list", ".center-channel", ".app__content"]);
  const button = queryFirst(["button.btn.btn-primary", ".btn.btn-primary", "button[color='primary']"]);
  const link = queryFirst(["a", ".link", ".style--none"]);

  const rootStyle = getComputedStyle(rootElement);
  const sidebarStyle = sidebar ? getComputedStyle(sidebar) : rootStyle;
  const sidebarTeamButtonStyle = sidebarTeamButton ? getComputedStyle(sidebarTeamButton) : sidebarStyle;
  const appBodyStyle = appBody ? getComputedStyle(appBody) : rootStyle;
  const channelHeaderStyle = channelHeader ? getComputedStyle(channelHeader) : rootStyle;
  const postAreaStyle = postArea ? getComputedStyle(postArea) : rootStyle;
  const buttonStyle = button ? getComputedStyle(button) : rootStyle;
  const linkStyle = link ? getComputedStyle(link) : rootStyle;

  const sidebarBg = readMattermostThemeValue(
    rootStyle,
    ["--sidebar-bg", "--sidebar-header-bg", "--sidebar-bg-rgb"],
    sidebarStyle.backgroundColor || "rgb(20, 93, 191)",
  );
  const sidebarHeaderBg = readMattermostThemeValue(
    rootStyle,
    ["--sidebar-header-bg", "--sidebar-bg"],
    channelHeaderStyle.backgroundColor || sidebarBg,
  );
  // CSS variable is preferred over computed element color.
  // In Mattermost 9.5, the sidebar container's computed `color` reflects the
  // inherited center-channel text (dark grey), not the sidebar text (white).
  // Reading --sidebar-text first avoids picking up the wrong fallback color.
  const sidebarText =
    readMattermostThemeValue(rootStyle, ["--sidebar-text", "--sidebar-header-text-color"]) ||
    sidebarTeamButtonStyle.color ||
    sidebarStyle.color ||
    "rgb(255, 255, 255)";
  const sidebarTextSoft =
    readMattermostThemeValue(rootStyle, ["--sidebar-text-80", "--sidebar-header-text-color-80"]) ||
    (sidebarTeamButtonStyle.color ? rgbaFromRgb(sidebarTeamButtonStyle.color, 0.8) : undefined) ||
    rgbaFromRgb(sidebarText, 0.8);
  // --sidebar-teambar-bg is the Global Header background (added in later 9.x).
  // Prefer it over --sidebar-header-bg so the deck topbar matches the
  // Mattermost Global Header rather than the sidebar channel-list header.
  const shellBg = readMattermostThemeValue(
    rootStyle,
    ["--sidebar-teambar-bg", "--sidebar-header-bg", "--sidebar-bg"],
    appBodyStyle.backgroundColor || sidebarHeaderBg,
  );
  const shellBgSoft = readMattermostThemeValue(
    rootStyle,
    ["--sidebar-text-08", "--center-channel-bg-08"],
    lightenRgb(shellBg, 0.03),
  );
  const centerBg = readMattermostThemeValue(
    rootStyle,
    ["--center-channel-bg", "--center-channel-bg-88"],
    postAreaStyle.backgroundColor || "rgb(255, 255, 255)",
  );
  const centerText = readMattermostThemeValue(
    rootStyle,
    ["--center-channel-color", "--center-channel-text", "--center-channel-color-88"],
    postAreaStyle.color || "rgb(61, 60, 64)",
  );
  const centerTextSoft = readMattermostThemeValue(
    rootStyle,
    ["--center-channel-color-72", "--center-channel-color-64"],
    rgbaFromRgb(centerText, 0.72),
  );
  const centerTextFaint = readMattermostThemeValue(
    rootStyle,
    ["--center-channel-color-56", "--center-channel-color-48"],
    rgbaFromRgb(centerText, 0.58),
  );
  const border = readMattermostThemeValue(
    rootStyle,
    ["--center-channel-color-16", "--center-channel-color-24"],
    rgbaFromRgb(centerText, 0.12),
  );
  const borderStrong = readMattermostThemeValue(
    rootStyle,
    ["--center-channel-color-24", "--center-channel-color-32"],
    rgbaFromRgb(centerText, 0.18),
  );
  const accent = pickBestAccent(
    centerBg,
    [
      readMattermostThemeValue(rootStyle, ["--button-bg"]),
      readMattermostThemeValue(rootStyle, ["--link-color"]),
      readMattermostThemeValue(rootStyle, ["--sidebar-text-active-border"]),
      readMattermostThemeValue(rootStyle, ["--mention-highlight-link"]),
      buttonStyle.backgroundColor,
      linkStyle.color,
    ],
    buttonStyle.backgroundColor || linkStyle.color || "rgb(22, 109, 224)",
  );
  const accentSoft = rgbaFromRgb(accent, 0.14);
  const accentText = pickReadableForeground(
    accent,
    [
      readMattermostThemeValue(rootStyle, ["--button-color"]),
      centerText,
      "rgb(255, 255, 255)",
      "rgb(27, 29, 34)",
    ],
    "rgb(255, 255, 255)",
  );
  const buttonBg = readMattermostThemeValue(rootStyle, ["--button-bg"], accent);
  const buttonText = readMattermostThemeValue(
    rootStyle,
    ["--button-color"],
    pickReadableForeground(buttonBg, ["rgb(255, 255, 255)", centerText], "rgb(255, 255, 255)"),
  );
  const badgeBg = readMattermostThemeValue(rootStyle, ["--mention-bg"], accent);
  const badgeText = readMattermostThemeValue(
    rootStyle,
    ["--mention-color"],
    pickReadableForeground(badgeBg, [centerText, "rgb(255, 255, 255)", "rgb(27, 29, 34)"], centerText),
  );
  const highlightBg = readElementBackgroundColor([
    ".post-message__text .mention--highlight",
    ".post__content .mention--highlight",
    ".mention--highlight",
  ]) ?? readMattermostThemeValue(
    rootStyle,
    ["--mention-highlight-bg"],
    colorMixFallback(accent, "#ffe082"),
  );
  const highlightText = readElementTextColor([
    ".post-message__text .mention--highlight .mention-link",
    ".post__content .mention--highlight .mention-link",
    ".mention--highlight .mention-link",
    ".post-message__text .mention--highlight",
    ".post__content .mention--highlight",
    ".mention--highlight",
  ]) ?? readMattermostThemeValue(
    rootStyle,
    ["--mention-highlight-link", "--mention-color"],
    pickReadableForeground(
      highlightBg,
      [centerText, "rgb(27, 29, 34)", "rgb(255, 255, 255)"],
      "rgb(27, 29, 34)",
    ),
  );
  const warn = readMattermostThemeValue(rootStyle, ["--away-indicator"], "rgb(255, 188, 66)");
  const success = readMattermostThemeValue(rootStyle, ["--online-indicator"], "rgb(6, 214, 160)");
  const danger = readMattermostThemeValue(rootStyle, ["--error-text", "--error-text-color"], "rgb(247, 67, 67)");

  return {
    "--deck-bg": shellBg,
    "--deck-bg-elevated": shellBg,
    "--deck-bg-soft": shellBgSoft,
    "--deck-panel": centerBg,
    "--deck-panel-2": centerBg,
    "--deck-card": colorMixFallback(centerText, centerBg, 0.04),
    "--deck-card-soft": centerBg,
    "--deck-border": border,
    "--deck-border-strong": borderStrong,
    "--deck-text": centerText,
    "--deck-text-soft": centerTextSoft,
    "--deck-text-faint": centerTextFaint,
    "--deck-topbar-text": sidebarText,
    "--deck-topbar-text-soft": sidebarTextSoft,
    "--deck-accent": accent,
    "--deck-accent-strong": darkenRgb(accent, 0.08),
    "--deck-accent-soft": accentSoft,
    "--deck-accent-text": accentText,
    "--deck-button-bg": buttonBg,
    "--deck-button-text": buttonText,
    "--deck-badge-bg": badgeBg,
    "--deck-badge-text": badgeText,
    "--deck-highlight-bg": highlightBg,
    "--deck-highlight-text": highlightText,
    "--deck-success": success,
    "--deck-warn": warn,
    "--deck-danger": danger,
  };
}

export function useMattermostThemeStyle(theme: DeckTheme): {
  initialSource: "cache" | "extract" | "none";
  style: MattermostThemeStyle | undefined;
} {
  const initialSourceRef = useRef<"cache" | "extract" | "none">("none");
  const [style, setStyle] = useState<MattermostThemeStyle | undefined>(() => {
    if (theme !== "mattermost") {
      initialSourceRef.current = "none";
      return undefined;
    }

    const cached = loadCachedMattermostThemeStyle();
    if (cached) {
      initialSourceRef.current = "cache";
      return cached;
    }

    initialSourceRef.current = "extract";
    return extractMattermostThemeStyle();
  });
  const serialisedStyleRef = useRef(serialiseMattermostThemeStyle(style));

  useEffect(() => {
    serialisedStyleRef.current = serialiseMattermostThemeStyle(style);
  }, [style]);

  useEffect(() => {
    if (theme !== "mattermost" || !style) {
      return;
    }
    saveCachedMattermostThemeStyle(style);
  }, [style, theme]);

  useEffect(() => {
    if (theme !== "mattermost") {
      initialSourceRef.current = "none";
      serialisedStyleRef.current = serialiseMattermostThemeStyle(undefined);
      setStyle(undefined);
      return;
    }

    let frameId: number | null = null;

    const apply = () => {
      frameId = null;
      const next = extractMattermostThemeStyle();
      const serialisedNext = serialiseMattermostThemeStyle(next);
      if (serialisedNext === serialisedStyleRef.current) {
        return;
      }

      serialisedStyleRef.current = serialisedNext;
      setStyle(next);
      saveCachedMattermostThemeStyle(next);
    };

    const scheduleApply = () => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(apply);
    };

    apply();
    const themeAttributeTargets = [
      document.documentElement,
      document.body,
      document.getElementById("root"),
      document.getElementById("app"),
    ].filter((target): target is HTMLElement => target instanceof HTMLElement);
    const observer = new MutationObserver((mutations) => {
      const themeSourceChanged = mutations.some((mutation) => {
        if (mutation.type === "attributes") {
          return (
            themeAttributeTargets.includes(mutation.target as HTMLElement) ||
            mutation.target instanceof HTMLStyleElement ||
            (
              mutation.target instanceof HTMLLinkElement &&
              mutation.target.rel === "stylesheet"
            )
          );
        }

        if (
          mutation.target instanceof HTMLStyleElement ||
          mutation.target.parentElement instanceof HTMLStyleElement
        ) {
          return true;
        }

        return [...mutation.addedNodes, ...mutation.removedNodes].some(
          (node) =>
            node instanceof HTMLStyleElement ||
            (
              node instanceof HTMLLinkElement &&
              node.rel === "stylesheet"
            ) ||
            (
              node instanceof Element &&
              Boolean(node.querySelector("style, link[rel='stylesheet']"))
            ),
        );
      });
      if (themeSourceChanged) {
        scheduleApply();
      }
    });
    observer.observe(document.documentElement, {
      subtree: false,
      childList: false,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    if (document.head) {
      observer.observe(document.head, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["href", "media", "disabled"],
      });
    }
    observer.observe(document.body, {
      subtree: false,
      childList: false,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    for (const target of themeAttributeTargets) {
      if (target === document.documentElement || target === document.body) {
        continue;
      }
      observer.observe(target, {
        subtree: false,
        childList: false,
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }

    return () => {
      observer.disconnect();
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [theme]);

  return {
    initialSource: initialSourceRef.current,
    style,
  };
}

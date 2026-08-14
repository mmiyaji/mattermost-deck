import { describe, expect, it } from "vitest";
import de from "./locales/de.json";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import zhCn from "./locales/zh-CN.json";

interface LocaleTree {
  [key: string]: string | LocaleTree;
}

function flattenLocale(value: LocaleTree, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof child === "string" ? [[path, child]] : Object.entries(flattenLocale(child, path));
    }),
  );
}

const locales = { ja, de, fr, "zh-CN": zhCn } as const;
const english = flattenLocale(en);
const performancePurposeKeys = [
  "performancePurposeCurrentUserProfile",
  "performancePurposeBatchUserLookup",
  "performancePurposeJoinedTeams",
  "performancePurposeDirectAndGroupChannels",
  "performancePurposeResolveChannelByTeamAndName",
  "performancePurposeResolveTeamByName",
  "performancePurposeTeamChannelList",
  "performancePurposeCurrentUserChannelMembershipList",
  "performancePurposeMarkChannelAsViewed",
  "performancePurposeCurrentUserChannelMembership",
  "performancePurposeChannelMembers",
  "performancePurposeRecentChannelPosts",
  "performancePurposeChannelDetails",
  "performancePurposeSavedOrFlaggedPosts",
  "performancePurposeTeamUnreadCounts",
  "performancePurposeTeamPostSearch",
  "performancePurposePostAttachmentMetadata",
  "performancePurposeHealthCheck",
  "performancePurposeOtherApiRequest",
] as const;

function interpolationPlaceholders(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map((match) => match[1])
    .sort();
}

describe("UI locale coverage", () => {
  it.each(Object.entries(locales))("keeps %s keys in parity with English", (_locale, resource) => {
    const translated = flattenLocale(resource);
    expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
    expect(Object.values(translated).every((value) => value.trim().length > 0)).toBe(true);
  });

  it.each(Object.entries(locales))("keeps %s interpolation placeholders in parity with English", (_locale, resource) => {
    const translated = flattenLocale(resource);
    for (const [key, englishValue] of Object.entries(english)) {
      expect(interpolationPlaceholders(translated[key]), key).toEqual(interpolationPlaceholders(englishValue));
    }
  });

  it.each(Object.entries(locales))("does not fall back to English for critical %s guidance", (_locale, resource) => {
    const translated = flattenLocale(resource);
    for (const key of [
      "deck.startWithChannel",
      "deck.retry",
      "deck.failedToLoadPosts",
      "deck.loadingMentions",
      "deck.refreshingMentions",
      "deck.mentionUpdatesAvailable_other",
      "deck.showMentionUpdates_other",
      "deck.loadingMentionsProgress",
      "deck.loadingMentionsTeamsProgress",
      "deck.refreshingCachedMentionsProgress",
      "deck.showingCachedMentions",
      "deck.loadingSearchResults",
      "deck.noSavedPosts",
      "deck.diagnosticsTitle",
      "options.autoAdjustThreadLayoutHint",
      "options.documentTitle",
      "options.performanceTitle",
      "options.saveFailed",
      "options.releaseNotesOpen",
      "options.releaseNote105PostActivation",
      "options.releaseNote104Compatibility",
      "options.releaseNote104StoreGate",
      "options.releaseNote104BoundedMentions",
      "options.releaseNote104Realtime",
      "options.releaseNote104Runtime",
      "options.releaseNote104Accessibility",
      "options.releaseNote103RhsSizing",
      "options.releaseNote103ManualResize",
      "options.releaseNote103Observation",
      "options.releaseNote103Runtime",
      "options.releaseNote103Soak",
      "options.releaseNote102ThreadLayout",
      "options.releaseNote102Navigation",
      "options.releaseNote102Compatibility",
      "options.releaseNote102TeamScope",
      "options.releaseNote102ReadMarkers",
      "options.releaseNote102Permissions",
      "options.releaseNote100MentionCoverage",
      "options.officialWebsite",
      "options.websiteCta",
      ...performancePurposeKeys.map((key) => `options.${key}`),
    ]) {
      expect(translated[key]).not.toBe(english[key]);
    }
  });

  it("describes Saved panes using Mattermost's user-facing saved-post terminology", () => {
    expect({
      en: en.options.paneTypeSavedDesc,
      ja: ja.options.paneTypeSavedDesc,
      de: de.options.paneTypeSavedDesc,
      fr: fr.options.paneTypeSavedDesc,
      "zh-CN": zhCn.options.paneTypeSavedDesc,
    }).toEqual({
      en: "Posts you save in Mattermost for later",
      ja: "Mattermost で後から確認するために保存した投稿",
      de: "In Mattermost für später gespeicherte Beiträge",
      fr: "Publications enregistrées dans Mattermost pour plus tard",
      "zh-CN": "在 Mattermost 中保存以便稍后查看的帖子",
    });
  });

  it("keeps the Japanese add menu and permission recovery guidance localized", () => {
    expect({
      mentions: ja.deck.addMentions,
      channel: ja.deck.addChannelWatch,
      dm: ja.deck.addDmWatch,
      search: ja.deck.addSearch,
      saved: ja.deck.addSaved,
      views: ja.deck.viewsLabel,
    }).toEqual({
      mentions: "メンション",
      channel: "チャンネル監視",
      dm: "DM／グループ",
      search: "検索",
      saved: "保存済み",
      views: "ビュー",
    });
    expect(ja.options.permissionDenied).toContain("「保存」");
    expect(ja.options.permissionDenied).not.toContain("Save");
  });

  it("does not describe team selection as a fixed-team requirement", () => {
    expect(de.deck.selectATeamDesc).toBe("Bitte zuerst ein Team auswählen.");
    expect(fr.deck.selectATeamDesc).toBe("Choisissez d’abord une équipe.");
    expect(zhCn.deck.selectATeamDesc).toBe("请先选择团队。");
  });

  it("uses Mattermost-specific Chinese terminology consistently", () => {
    for (const value of [
      zhCn.deck.openPostConfirm,
      zhCn.options.postClickActionHint,
      zhCn.options.releaseNote102ThreadLayout,
      zhCn.options.releaseNote102ReadMarkers,
      zhCn.options.releaseNote100ThreadSemantics,
      zhCn.options.releaseNote100Responsive,
      zhCn.options.releaseNote100E2E,
    ]) {
      expect(value).toContain("话题");
      expect(value).not.toMatch(/讨论串|线程|主题/);
    }
    expect(zhCn.options.profilesRecommendedBody).toContain("“连接”");
    expect(zhCn.options.profilesNeedsConnection).toContain("“连接”");
    expect(zhCn.options.reversedPostOrderLabel).not.toContain("投稿");
    expect(zhCn.options.reversedPostOrderHint).not.toContain("投稿");
  });

  it("keeps French release guidance and all-team totals semantically precise", () => {
    expect(fr.deck.threadLayoutCollapsedStatus).toContain("forcer manuellement");
    expect(fr.options.releaseNote104Realtime).toContain("à l’échelle du canal");
    expect(fr.options.releaseNote104Accessibility).toContain("nouvelle tentative");
    expect(fr.deck.mentionBadgeAllTeams_one).toContain("au total");
    expect(fr.deck.mentionBadgeAllTeams_other).toContain("au total");
    expect(de.deck.mentionBadgeAllTeams_one).toContain("insgesamt");
    expect(de.deck.mentionBadgeAllTeams_other).toContain("insgesamt");
  });

  it("provides localized names for the built-in default profile", () => {
    expect({
      en: en.options.profilesDefaultName,
      ja: ja.options.profilesDefaultName,
      de: de.options.profilesDefaultName,
      fr: fr.options.profilesDefaultName,
      "zh-CN": zhCn.options.profilesDefaultName,
    }).toEqual({
      en: "Default",
      ja: "既定",
      de: "Standard",
      fr: "Par défaut",
      "zh-CN": "默认",
    });
  });
});

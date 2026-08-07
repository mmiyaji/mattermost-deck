export const PERFORMANCE_PURPOSE_TRANSLATION_KEYS = {
  "Current user profile": "options.performancePurposeCurrentUserProfile",
  "Batch user lookup": "options.performancePurposeBatchUserLookup",
  "Joined teams": "options.performancePurposeJoinedTeams",
  "Direct and group channels": "options.performancePurposeDirectAndGroupChannels",
  "Resolve channel by team and name": "options.performancePurposeResolveChannelByTeamAndName",
  "Resolve team by name": "options.performancePurposeResolveTeamByName",
  "Team channel list": "options.performancePurposeTeamChannelList",
  "Current user channel membership list": "options.performancePurposeCurrentUserChannelMembershipList",
  "Mark channel as viewed": "options.performancePurposeMarkChannelAsViewed",
  "Current user channel membership": "options.performancePurposeCurrentUserChannelMembership",
  "Channel members": "options.performancePurposeChannelMembers",
  "Recent channel posts": "options.performancePurposeRecentChannelPosts",
  "Channel details": "options.performancePurposeChannelDetails",
  "Saved or flagged posts": "options.performancePurposeSavedOrFlaggedPosts",
  "Team unread counts": "options.performancePurposeTeamUnreadCounts",
  "Team post search": "options.performancePurposeTeamPostSearch",
  "Post attachment metadata": "options.performancePurposePostAttachmentMetadata",
  "Health check": "options.performancePurposeHealthCheck",
  "Other API request": "options.performancePurposeOtherApiRequest",
} as const;

export type PerformancePurposeTranslationKey =
  (typeof PERFORMANCE_PURPOSE_TRANSLATION_KEYS)[keyof typeof PERFORMANCE_PURPOSE_TRANSLATION_KEYS];

export function localizePerformancePurpose(
  purpose: unknown,
  translate: (key: PerformancePurposeTranslationKey) => string,
): string {
  const normalized = typeof purpose === "string" ? purpose.trim() : "";
  if (!normalized) {
    return translate(PERFORMANCE_PURPOSE_TRANSLATION_KEYS["Other API request"]);
  }

  const translationKey =
    PERFORMANCE_PURPOSE_TRANSLATION_KEYS[normalized as keyof typeof PERFORMANCE_PURPOSE_TRANSLATION_KEYS];
  return translationKey ? translate(translationKey) : normalized;
}

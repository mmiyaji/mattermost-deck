export const INSTALL_LANGUAGE_ATTRIBUTE = "data-mattermost-deck-install-language";
export const INSTALL_LANGUAGE_READY_EVENT = "mattermost-deck-install-language-ready";
export const INSTALL_GUIDE_READY_ATTRIBUTE = "data-mattermost-deck-install-guide-ready";
export const INSTALL_GUIDE_READY_EVENT = "mattermost-deck-install-guide-ready";

export function waitForDocumentElement(): Promise<HTMLElement> {
  if (document.documentElement) return Promise.resolve(document.documentElement);

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      observer.disconnect();
      resolve(document.documentElement);
    });
    observer.observe(document, { childList: true });
  });
}

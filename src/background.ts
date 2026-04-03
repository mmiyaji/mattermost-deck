chrome.runtime.onInstalled.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "mattermost-deck:open-options") {
    void chrome.runtime.openOptionsPage();
  }
});

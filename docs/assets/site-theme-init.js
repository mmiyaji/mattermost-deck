(() => {
  try {
    const saved = window.localStorage.getItem("mattermost-deck-site-theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.dataset.theme = saved;
    }
  } catch {
    // The page can still follow the system theme when storage is unavailable.
  }
})();

(() => {
  const storageKey = "mattermost-deck-site-language";
  const supportedLanguages = ["ja", "en"];

  const getSavedLanguage = () => {
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  };

  const saveLanguage = (language) => {
    try {
      window.localStorage.setItem(storageKey, language);
    } catch {
      // The current page can still switch languages when storage is unavailable.
    }
  };

  const getUrlLanguage = () => {
    const requested = new URLSearchParams(window.location.search).get("lang");
    return supportedLanguages.includes(requested) ? requested : null;
  };

  const getInitialLanguage = () => {
    const requested = getUrlLanguage();
    if (requested) {
      return requested;
    }

    const saved = getSavedLanguage();
    if (supportedLanguages.includes(saved)) {
      return saved;
    }

    return window.navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
  };

  const updateUrlLanguage = (language) => {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", language);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const localizeInternalLinks = (language) => {
    document.querySelectorAll("a[data-lang-link]").forEach((link) => {
      const rawHref = link.getAttribute("href");
      if (!rawHref || rawHref.startsWith("#")) {
        return;
      }

      const url = new URL(rawHref, window.location.href);
      if (url.origin !== window.location.origin) {
        return;
      }
      url.searchParams.set("lang", language);
      link.setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
    });
  };

  const setText = (element, language) => {
    const value = language === "ja" ? element.dataset.i18nJa : element.dataset.i18nEn;
    if (value) {
      element.textContent = value;
    }
  };

  const setAttribute = (element, language, attributeName, japaneseKey, englishKey) => {
    const value = language === "ja" ? element.dataset[japaneseKey] : element.dataset[englishKey];
    if (value) {
      element.setAttribute(attributeName, value);
    }
  };

  const scrollToLegalSection = (sectionName, updateHistory) => {
    const target = Array.from(
      document.querySelectorAll("[data-legal-section]"),
    ).find((candidate) => (
      candidate.dataset.legalSection === sectionName &&
      !candidate.closest("[hidden]")
    ));
    if (!target) {
      return false;
    }

    target.scrollIntoView({ block: "start" });
    if (updateHistory) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#${sectionName}`,
      );
    }
    return true;
  };

  const setLanguage = (language, options = {}) => {
    const nextLanguage = supportedLanguages.includes(language) ? language : "ja";
    document.documentElement.lang = nextLanguage;
    document.documentElement.dataset.lang = nextLanguage;
    saveLanguage(nextLanguage);

    if (options.updateUrl) {
      updateUrlLanguage(nextLanguage);
    }

    document.querySelectorAll("[data-i18n-ja][data-i18n-en]").forEach((element) => {
      setText(element, nextLanguage);
    });
    document.querySelectorAll("[data-i18n-aria-ja][data-i18n-aria-en]").forEach((element) => {
      setAttribute(element, nextLanguage, "aria-label", "i18nAriaJa", "i18nAriaEn");
    });
    document.querySelectorAll("[data-i18n-alt-ja][data-i18n-alt-en]").forEach((element) => {
      setAttribute(element, nextLanguage, "alt", "i18nAltJa", "i18nAltEn");
    });
    document.querySelectorAll("[data-i18n-content-ja][data-i18n-content-en]").forEach((element) => {
      setAttribute(element, nextLanguage, "content", "i18nContentJa", "i18nContentEn");
    });
    document.querySelectorAll("[data-lang-panel]").forEach((element) => {
      element.hidden = element.dataset.langPanel !== nextLanguage;
    });
    document.querySelectorAll("[data-lang-choice]").forEach((button) => {
      const selected = button.dataset.langChoice === nextLanguage;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });

    localizeInternalLinks(nextLanguage);
    const currentSection = window.location.hash.slice(1);
    if (currentSection) {
      window.requestAnimationFrame(() => {
        scrollToLegalSection(currentSection, false);
      });
    }
  };

  const setupImageDialog = () => {
    const dialog = document.querySelector("#image-dialog");
    const dialogImage = dialog?.querySelector("img");
    const closeButton = dialog?.querySelector("[data-dialog-close]");
    if (!(dialog instanceof HTMLDialogElement) || !(dialogImage instanceof HTMLImageElement)) {
      return;
    }

    const close = () => {
      if (dialog.open) {
        dialog.close();
      }
    };

    document.querySelectorAll("[data-image-dialog]").forEach((trigger) => {
      trigger.addEventListener("click", () => {
        const image = trigger.querySelector("img");
        const source = trigger.getAttribute("data-image-dialog");
        if (!source || !(image instanceof HTMLImageElement)) {
          return;
        }

        dialogImage.src = source;
        dialogImage.alt = image.alt;
        dialog.showModal();
        closeButton?.focus();
      });
    });

    closeButton?.addEventListener("click", close);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        close();
      }
    });
  };

  const setupLegalToc = () => {
    document.querySelectorAll('.legal-toc a[href^="#"]').forEach((link) => {
      link.addEventListener("click", (event) => {
        const sectionName = link.getAttribute("href")?.slice(1);
        if (!sectionName) {
          return;
        }

        if (scrollToLegalSection(sectionName, true)) {
          event.preventDefault();
        }
      });
    });

    const initialSection = window.location.hash.slice(1);
    if (initialSection) {
      window.requestAnimationFrame(() => {
        scrollToLegalSection(initialSection, false);
      });
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    setLanguage(getInitialLanguage());

    document.querySelectorAll("[data-lang-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        setLanguage(button.dataset.langChoice, { updateUrl: true });
      });
    });

    document.querySelectorAll("[data-current-year]").forEach((element) => {
      element.textContent = String(new Date().getFullYear());
    });

    setupImageDialog();
    setupLegalToc();
  });
})();

(() => {
  const storageKey = "mattermost-deck-site-language";
  const themeStorageKey = "mattermost-deck-site-theme";
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
    document.querySelectorAll("[data-i18n-caption-ja][data-i18n-caption-en]").forEach((element) => {
      setAttribute(element, nextLanguage, "data-description", "i18nCaptionJa", "i18nCaptionEn");
    });
    document.querySelectorAll("[data-lang-panel]").forEach((element) => {
      element.hidden = element.dataset.langPanel !== nextLanguage;
    });
    document.querySelectorAll("[data-lang-choice]").forEach((button) => {
      const selected = button.dataset.langChoice === nextLanguage;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    document.querySelectorAll("[data-lang-select]").forEach((select) => {
      select.value = nextLanguage;
      const current = document.querySelector("[data-lang-current]");
      if (current) {
        current.textContent = select.selectedOptions?.[0]?.textContent ?? nextLanguage;
      }
    });

    localizeInternalLinks(nextLanguage);
    const currentSection = window.location.hash.slice(1);
    if (currentSection) {
      window.requestAnimationFrame(() => {
        scrollToLegalSection(currentSection, false);
      });
    }
    document.dispatchEvent(new CustomEvent("site:languagechange", { detail: { language: nextLanguage } }));
  };

  const setupThemeToggle = () => {
    const toggle = document.querySelector("[data-theme-toggle]");
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
    let theme = getSavedTheme();

    const applyTheme = () => {
      if (theme === "auto") {
        delete document.documentElement.dataset.theme;
      } else {
        document.documentElement.dataset.theme = theme;
      }
      const dark = theme === "dark" || (theme === "auto" && systemDark.matches);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#15181c" : "#ffffff");
      const label = dark ? toggle?.dataset.i18nToLightJa : toggle?.dataset.i18nToDarkJa;
      const englishLabel = dark ? toggle?.dataset.i18nToLightEn : toggle?.dataset.i18nToDarkEn;
      const activeLanguage = document.documentElement.lang === "en" ? englishLabel : label;
      if (toggle && activeLanguage) {
        toggle.setAttribute("aria-label", activeLanguage);
        toggle.setAttribute("title", activeLanguage);
      }
    };

    toggle?.addEventListener("click", () => {
      const currentlyDark = theme === "dark" || (theme === "auto" && systemDark.matches);
      theme = currentlyDark ? "light" : "dark";
      try {
        window.localStorage.setItem(themeStorageKey, theme);
      } catch {
        // Theme changes still apply to this page if storage is unavailable.
      }
      applyTheme();
    });
    systemDark.addEventListener?.("change", () => {
      if (theme === "auto") {
        applyTheme();
      }
    });
    document.addEventListener("site:languagechange", applyTheme);
    applyTheme();
  };

  const getSavedTheme = () => {
    try {
      const saved = window.localStorage.getItem(themeStorageKey);
      return saved === "light" || saved === "dark" ? saved : "auto";
    } catch {
      return "auto";
    }
  };

  const setupCatalogLightbox = () => {
    if (typeof window.GLightbox !== "function") {
      return;
    }
    let lightbox = null;
    const refresh = () => {
      lightbox?.destroy();
      lightbox = window.GLightbox({ selector: ".glightbox", touchNavigation: true, loop: true });
    };
    document.addEventListener("site:languagechange", refresh);
    refresh();
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

  const setupSectionNavigation = () => {
    const links = Array.from(document.querySelectorAll(".nav a[data-section-link][href^='#']"));
    const sections = links.map((link) => document.getElementById(link.getAttribute("href").slice(1))).filter(Boolean);
    if (!links.length || !sections.length) {
      return;
    }

    let lockedSection = null;
    let releaseTimer = 0;
    let frame = 0;
    const setCurrent = (section) => {
      links.forEach((link) => {
        if (section && link.getAttribute("href") === `#${section.id}`) {
          link.setAttribute("aria-current", "location");
        } else {
          link.removeAttribute("aria-current");
        }
      });
    };
    const updateFromScroll = () => {
      frame = 0;
      if (lockedSection) {
        setCurrent(lockedSection);
        return;
      }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
        setCurrent(sections[sections.length - 1]);
        return;
      }
      const headerBottom = document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0;
      const scrollPaddingTop = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      const threshold = Math.max(headerBottom + 80, scrollPaddingTop + 8);
      let current = null;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= threshold) {
          current = section;
        } else {
          break;
        }
      }
      setCurrent(current);
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateFromScroll);
    };
    const releaseLock = () => {
      lockedSection = null;
      window.clearTimeout(releaseTimer);
      scheduleUpdate();
    };
    const onScrollKey = (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) releaseLock();
    };

    links.forEach((link) => link.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const section = document.getElementById(link.getAttribute("href").slice(1));
      if (!section) return;
      event.preventDefault();
      if (window.location.hash !== `#${section.id}`) window.history.pushState(null, "", `#${section.id}`);
      lockedSection = section;
      setCurrent(section);
      window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(releaseLock, 1400);
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }));

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("wheel", releaseLock, { passive: true });
    window.addEventListener("touchstart", releaseLock, { passive: true });
    window.addEventListener("keydown", onScrollKey);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scrollend", releaseLock);
    window.addEventListener("popstate", () => {
      const section = sections.find((candidate) => `#${candidate.id}` === window.location.hash);
      if (section) {
        lockedSection = section;
        setCurrent(section);
        window.clearTimeout(releaseTimer);
        releaseTimer = window.setTimeout(releaseLock, 1400);
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        releaseLock();
      }
    });
    window.addEventListener("hashchange", scheduleUpdate);
    window.addEventListener("load", scheduleUpdate, { once: true });
    document.addEventListener("site:languagechange", scheduleUpdate);
    scheduleUpdate();
  };

  document.addEventListener("DOMContentLoaded", () => {
    setLanguage(getInitialLanguage());

    document.querySelectorAll("[data-lang-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        setLanguage(button.dataset.langChoice, { updateUrl: true });
      });
    });
    document.querySelectorAll("[data-lang-select]").forEach((select) => {
      select.addEventListener("change", () => {
        const language = select.value;
        if (supportedLanguages.includes(language)) {
          saveLanguage(language);
          setLanguage(language, { updateUrl: true });
        }
      });
    });

    document.querySelectorAll("[data-current-year]").forEach((element) => {
      element.textContent = String(new Date().getFullYear());
    });

    setupImageDialog();
    setupCatalogLightbox();
    setupThemeToggle();
    setupLegalToc();
    setupSectionNavigation();
  });
})();

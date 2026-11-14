# Site replacement candidate

Production-structured version of `mock/deck-tone.html`. It uses the same markup hooks as the
current `docs/` site (`data-i18n-*`, `data-lang-panel`, `data-section-link`, `data-theme-toggle`,
GLightbox), so `assets/site.js` and `assets/site-theme-init.js` keep working.

Files that differ from `docs/`:

- `index.html` (new)
- `assets/homepage-c.css` (new)
- `assets/site.js` (lightbox gallery limited to the images visible for the current language and theme)
- `assets/shots/*.png` (24 screenshots: overview, two rows, wide, right pane, settings; ja/en, light/dark)

Apply (not done yet; `docs/` is unchanged):

```bash
cp -r mock/site-candidate/index.html mock/site-candidate/assets docs/
```

Also update the version/design notes in `docs/site-design-validation.md` after applying.

Checked on a staged copy of `docs/` with the candidate files overlaid:

- `scripts/check-site.mjs` and `scripts/test-site-navigation.mjs` pass.
- Served with the CSP from `docs/_headers`: no console errors other than the GLightbox
  `style-src-attr` warning, no horizontal overflow and no broken images at 360–1920 px,
  light/dark, ja/en (Chromium only).
- Language select, theme toggle, section navigation and the lightbox gallery work.

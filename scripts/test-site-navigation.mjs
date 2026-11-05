import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const source = fs.readFileSync(path.resolve("docs/assets/site.js"), "utf8");
const listeners = new Map();
const documentListeners = new Map();
const animationFrames = [];
let headerBottom = 51;
let scrollPaddingTop = 52;
const sections = ["features", "workflow", "screens", "faq"].map((id) => ({
  id,
  top: 300,
  scrollCalls: 0,
  getBoundingClientRect() { return { top: this.top }; },
  scrollIntoView() { this.scrollCalls += 1; },
}));
const attributes = new Map([["aria-current", "page"]]);

const sectionLinks = sections.map((section) => {
  const linkListeners = new Map();
  const linkAttributes = new Map([["href", `#${section.id}`]]);
  return {
    target: "",
    hasAttribute(name) { return linkAttributes.has(name); },
    getAttribute(name) { return linkAttributes.get(name) ?? null; },
    setAttribute(name, value) { linkAttributes.set(name, value); },
    removeAttribute(name) { linkAttributes.delete(name); },
    addEventListener(name, listener) { linkListeners.set(name, listener); },
    click(event = {}) {
      const clickEvent = {
        button: 0,
        defaultPrevented: false,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault() { this.defaultPrevented = true; },
        ...event,
      };
      linkListeners.get("click")(clickEvent);
      return clickEvent;
    },
    current() { return linkAttributes.get("aria-current") ?? null; },
  };
});
const legalLink = {
  getAttribute(name) { return name === "aria-current" ? attributes.get(name) : null; },
};
const document = {
  documentElement: { lang: "", dataset: {}, scrollHeight: 2500, setAttribute() {} },
  dispatchEvent(event) {
    (documentListeners.get(event.type) ?? []).forEach((listener) => listener(event));
  },
  addEventListener(name, listener) {
    if (name === "DOMContentLoaded") {
      listener();
      return;
    }
    const current = documentListeners.get(name) ?? [];
    current.push(listener);
    documentListeners.set(name, current);
  },
  querySelectorAll(selector) {
    return selector === ".nav a[data-section-link][href^='#']" ? sectionLinks : [];
  },
  querySelector(selector) {
    return selector === ".site-header" ? { getBoundingClientRect: () => ({ bottom: headerBottom }) } : null;
  },
  getElementById(id) { return sections.find((section) => section.id === id) ?? null; },
};
const window = {
  location: { href: "https://site.invalid/", pathname: "/", search: "", hash: "" },
  navigator: { language: "en" },
  localStorage: { getItem() { return null; }, setItem() {} },
  history: {
    pushes: 0,
    replaceState() {},
    pushState(_state, _title, hash) {
      this.pushes += 1;
      window.location.hash = hash;
    },
  },
  scrollY: 0,
  innerHeight: 600,
  addEventListener(name, listener) {
    const current = listeners.get(name) ?? [];
    current.push(listener);
    listeners.set(name, current);
  },
  requestAnimationFrame(callback) {
    animationFrames.push(callback);
    return animationFrames.length;
  },
  getComputedStyle() { return { scrollPaddingTop: `${scrollPaddingTop}px` }; },
  matchMedia() { return { matches: false, addEventListener() {} }; },
  setTimeout() { return 1; },
  clearTimeout() {},
};
const fire = (name, event = {}) => (listeners.get(name) ?? []).forEach((listener) => listener(event));
const flushFrames = () => {
  while (animationFrames.length) animationFrames.shift()();
};

vm.runInNewContext(source, {
  document,
  window,
  URL,
  URLSearchParams,
  HTMLDialogElement: class {},
  HTMLImageElement: class {},
  HTMLElement: class {},
  CustomEvent: class { constructor(type) { this.type = type; } },
  getComputedStyle: () => ({ scrollPaddingTop: `${scrollPaddingTop}px` }),
});

assert.equal(sectionLinks.every((link) => link.current() === null), true, "hero has no active section link");
assert.equal(legalLink.getAttribute("aria-current"), "page", "legal page current state is independent");

sections[0].top = 80;
fire("scroll");
flushFrames();
assert.equal(sectionLinks[0].current(), "location", "section becomes current at the sticky header");

sectionLinks[1].click();
assert.equal(sectionLinks[1].current(), "location", "click selects its section immediately");
assert.equal(window.history.pushes, 1, "first click adds a history entry");
sectionLinks[1].click();
assert.equal(window.history.pushes, 1, "repeated click on the current hash does not duplicate history");

const modifiedClick = sectionLinks[2].click({ ctrlKey: true });
assert.equal(modifiedClick.defaultPrevented, false, "modified click keeps browser new-tab behavior");
assert.equal(window.history.pushes, 1, "modified click does not update history");

sections[1].top = 70;
fire("wheel");
fire("scroll");
flushFrames();
assert.equal(sectionLinks[1].current(), "location", "manual wheel scroll releases click lock immediately");
assert.equal(legalLink.getAttribute("aria-current"), "page", "section updates preserve legal page state");

sections[3].top = 700;
window.scrollY = 2000;
fire("scroll");
flushFrames();
assert.equal(sectionLinks[3].current(), "location", "bottom of page selects the final section");

sections[0].top = 30;
sections[1].top = 180;
window.scrollY = 0;
fire("scroll");
flushFrames();
assert.equal(sectionLinks[3].current(), null, "leaving the final section clears its selected state");
sections[1].top = 81;
headerBottom = 51;
scrollPaddingTop = 52;
document.dispatchEvent(new CustomEvent("site:languagechange"));
flushFrames();
assert.equal(sectionLinks[1].current(), "location", "language layout shift keeps the visible section current below C header/padding");

console.log("Site navigation behavior checks passed.");

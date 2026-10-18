/* Superpowers for GitHub: one plain JavaScript file for the content script. */
(function () {
  "use strict";

  const DEFAULT_PATTERNS = {
    tests: ["**/test/**", "**/tests/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*"],
    docs: ["**/docs/**", "**/doc/**", "**/*.md", "**/*.mdx", "**/*.rst", "**/*.adoc"],
    generated: ["**/snapshots/**", "**/__snapshots__/**", "**/*.snap", "**/*.min.js", "**/*.min.css", "**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock", "**/Cargo.lock", "**/composer.lock", "**/Gemfile.lock", "**/poetry.lock", "**/go.sum"]
  };
  const DEFAULT_SHORTCUTS = {
    tests: "Shift+T", docs: "Shift+D", generated: "Shift+G", deleted: "Shift+X",
    review: "Ctrl+Shift+Enter", ready: "Shift+R", conversation: "Shift+C", files: "Shift+F",
    collapse: "Shift+K", expand: "Shift+E", toggleViewed: "Shift+V"
  };

  function globMatches(path, glob) {
    let source = "";
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === "*" && glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { i++; source += "(?:.*/)?"; }
        else source += ".*";
      } else if (c === "*") source += "[^/]*";
      else source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${source}$`, "i").test(path);
  }

  function classifyFile(path, patterns) {
    const normalized = path.replace(/^\//, "");
    for (const kind of ["tests", "docs", "generated"]) if (patterns[kind].some((glob) => globMatches(normalized, glob))) return kind;
    return null;
  }

  function parseShortcut(value) {
    const parts = value.split("+").map((part) => part.trim().toLowerCase());
    if (!parts.length || !parts[parts.length - 1]) return null;
    return { key: parts[parts.length - 1], shift: parts.includes("shift"), ctrl: parts.includes("ctrl"), alt: parts.includes("alt"), meta: parts.includes("meta") || parts.includes("cmd") || parts.includes("command") };
  }

  function shortcutMatches(event, shortcut) {
    const parsed = parseShortcut(shortcut);
    if (!parsed) return false;
    const raw = event.key.toLowerCase();
    const key = raw === " " ? "space" : raw === "return" ? "enter" : raw;
    return key === parsed.key && event.shiftKey === parsed.shift && event.ctrlKey === parsed.ctrl && event.altKey === parsed.alt && event.metaKey === parsed.meta;
  }

  function readViewedState(ariaLabel, ariaPressed, ariaChecked, inputChecked) {
    const label = (ariaLabel || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (/^not viewed$/.test(label) || /\bmark as viewed\b/.test(label)) return false;
    if (/^viewed$/.test(label) || /\bunmark as viewed\b/.test(label) || ariaPressed === "true" || ariaChecked === "true") return true;
    if (ariaPressed === "false" || ariaChecked === "false") return false;
    return inputChecked === null ? null : inputChecked;
  }

  function nextViewedState(states) { return states.length ? !states.every(Boolean) : null; }

  function currentFileIndex(bounds, viewportHeight, activeIndex) {
    if (!bounds.length) return null;
    if (activeIndex !== undefined && activeIndex >= 0 && activeIndex < bounds.length) return activeIndex;
    const visible = bounds.findIndex(({ top, bottom }) => bottom > 0 && top < viewportHeight);
    if (visible >= 0) return visible;
    let current = -1;
    for (let i = 0; i < bounds.length; i++) {
      if (bounds[i].top <= 0) current = i;
      else if (current < 0) return i;
      else break;
    }
    return current >= 0 ? current : 0;
  }

  function isSubmitReviewButtonText(text) {
    return text.replace(/\s+/g, " ").trim().toLowerCase().startsWith("submit review");
  }

  function shouldIgnoreShortcutTarget(target) {
    if (typeof Element === "undefined" || !(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox'], .CodeMirror, .monaco-editor, .ProseMirror"));
  }

  const api = { DEFAULT_PATTERNS, DEFAULT_SHORTCUTS, globMatches, classifyFile, parseShortcut, shortcutMatches, readViewedState, nextViewedState, currentFileIndex, isSubmitReviewButtonText, shouldIgnoreShortcutTarget };
  if (typeof module === "object" && module.exports) module.exports = api;

  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function startContent() {
    const $ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const hydratedPRs = new Set();
    const shiftKCollapsedPRs = new Set();
    const steppedFileIndexes = new Map();
    let running = false;

    function setStatus(message) { console.info(`[Superpowers for GitHub] ${message}`); }
    function prPath() { return location.pathname.match(/^\/[^/]+\/[^/]+\/pull\/\d+/)?.[0] || ""; }
    async function perform(action) {
      if (running) return;
      running = true;
      try { await action(); }
      catch (error) { console.error(`[Superpowers for GitHub] Action failed: ${String(error)}`); }
      finally { running = false; }
    }
    function controlLabel(control) {
      const labelledBy = clean(control.getAttribute("aria-labelledby")).split(" ").map((id) => document.getElementById(id)?.textContent || "").join(" ");
      return clean([control.getAttribute("aria-label"), control.getAttribute("title"), labelledBy, control.textContent].filter(Boolean).join(" "));
    }
    function fileCards() {
      const result = []; const seen = new Set();
      for (const element of $("[data-diff-header-wrapper], [data-tagsearch-path], .js-file, .file")) {
        const path = clean(element.getAttribute("data-tagsearch-path") || element.getAttribute("data-path") || element.querySelector("[data-path]")?.dataset.path || element.querySelector(".file-info a, h3 a code, h3 a, a[title]")?.getAttribute("title") || element.querySelector(".file-info a, h3 a code, h3 a")?.textContent).replace(/[\u200b-\u200f\u2060\ufeff]/g, "");
        if (!path || seen.has(path) || path.includes("/pull/") || !element.querySelector("button")) continue;
        seen.add(path); result.push({ element, path });
      }
      return result;
    }
    async function hydrateFilesOnce() {
      const key = prPath();
      if (!key || hydratedPRs.has(key)) return;
      const originalY = window.scrollY;
      const step = Math.max(400, Math.floor(window.innerHeight * 0.75));
      let y = 0; let stableAtBottom = 0; let previousHeight = 0;
      try {
        for (let pass = 0; pass < 120; pass++) {
          const height = document.documentElement.scrollHeight;
          const maxY = Math.max(0, height - window.innerHeight);
          if (y < maxY) { y = Math.min(y + step, maxY); window.scrollTo(0, y); await sleep(120); continue; }
          window.scrollTo(0, maxY); await sleep(180);
          const nextHeight = document.documentElement.scrollHeight;
          if (nextHeight === previousHeight) stableAtBottom++; else stableAtBottom = 0;
          if (stableAtBottom >= 2) break;
          previousHeight = nextHeight; y = Math.max(y, nextHeight - window.innerHeight - step);
        }
        hydratedPRs.add(key);
      } finally { window.scrollTo(0, originalY); }
    }
    function isDeleted(card) {
      const header = card.element.querySelector("[data-testid='file-header'], .file-header, .file-info") || card.element;
      const text = `${card.element.getAttribute("data-status") || ""} ${header.textContent || ""}`.toLowerCase();
      return /\bdeleted\b|\bremoved\b|\bstatus:\s*d\b/.test(text) || Boolean(card.element.querySelector(".octicon-diff-removed, [aria-label*='deleted' i]"));
    }
    function viewedControl(card) {
      for (const control of $("button, [role=checkbox], input[type=checkbox]", card)) {
        if (!/(un)?mark as viewed|\bviewed\b/i.test(controlLabel(control))) continue;
        return { element: control, viewed: readViewedState(control.getAttribute("aria-label"), control.getAttribute("aria-pressed"), control.getAttribute("aria-checked"), control instanceof HTMLInputElement ? control.checked : null) };
      }
      return null;
    }
    async function bulkFiles(kind) {
      if (!hydratedPRs.has(prPath())) setStatus("Loading files once so GitHub mounts lazy diff headers…");
      await hydrateFilesOnce(); setStatus("Finding files…");
      const cards = fileCards().filter((card) => kind === "deleted" ? isDeleted(card) : classifyFile(card.path, DEFAULT_PATTERNS) === kind);
      if (!cards.length) { setStatus("No matching files found on this page."); return; }
      const failures = []; const targets = [];
      for (const card of cards) {
        try {
          let control = viewedControl(card.element);
          if (!control) {
            const loadButton = $("button", card.element).find((button) => /load diff|show diff|expand file/i.test(controlLabel(button)));
            if (loadButton) { loadButton.click(); await sleep(100); control = viewedControl(card.element); }
          }
          if (!control) throw new Error("GitHub viewed control not found");
          if (control.viewed === null) throw new Error("GitHub viewed state could not be determined; left unchanged");
          targets.push({ card, control: { element: control.element, viewed: control.viewed } });
        } catch (error) { failures.push(`${card.path}: ${String(error)}`); }
      }
      const shouldView = nextViewedState(targets.map(({ control }) => control.viewed));
      if (shouldView === null) { setStatus(`No files could be processed${failures.length ? `; ${failures.length} failed (${failures.slice(0, 3).join("; ")})` : ""}.`); return; }
      let done = 0; let changed = 0; let alreadyInTargetState = 0;
      for (const { card, control } of targets) {
        setStatus(`Processing ${done + failures.length + 1}/${cards.length}: ${card.path}`);
        try {
          if (control.viewed !== shouldView) {
            control.element.click(); await sleep(160);
            if (viewedControl(card.element)?.viewed !== shouldView) throw new Error(`GitHub did not confirm the ${shouldView ? "viewed" : "not viewed"} state`);
            changed++;
          } else alreadyInTargetState++;
          const visibility = $("button", card.element).find((button) => shouldView ? /^collapse( file)?$/i.test(controlLabel(button)) : /^expand( file)?$/i.test(controlLabel(button)));
          if (visibility) visibility.click();
          done++;
        } catch (error) { failures.push(`${card.path}: ${String(error)}`); }
      }
      const suffix = failures.length ? `; ${failures.length} failed (${failures.slice(0, 3).join("; ")})` : "";
      setStatus(`${done}/${cards.length} processed (${changed} changed, ${alreadyInTargetState} already ${shouldView ? "viewed" : "not viewed"}; now ${shouldView ? "viewed" : "not viewed"})${suffix}`);
    }
    async function collapseExpand(expand, unviewedOnly) {
      await hydrateFilesOnce(); let changed = 0; let failed = 0; let skippedViewed = 0;
      for (const card of fileCards()) {
        if (expand && unviewedOnly) {
          const state = viewedControl(card.element)?.viewed;
          if (state === true) { skippedViewed++; continue; }
          if (state === null || state === undefined) { failed++; continue; }
        }
        const target = $("button", card.element).find((button) => expand ? /^expand( file)?$/i.test(controlLabel(button)) : /^collapse( file)?$/i.test(controlLabel(button)));
        if (target) try { target.click(); changed++; await sleep(30); } catch { failed++; }
      }
      const skipped = skippedViewed ? `; ${skippedViewed} viewed files stayed collapsed` : "";
      setStatus(`${changed} files ${expand ? "expanded" : "collapsed"}${skipped}${failed ? `; ${failed} failed` : ""}. Viewed status unchanged.`);
    }
    async function rotateCollapse() {
      const key = prPath(); const expandUnviewed = shiftKCollapsedPRs.has(key);
      await collapseExpand(expandUnviewed, expandUnviewed);
      if (expandUnviewed) shiftKCollapsedPRs.delete(key); else shiftKCollapsedPRs.add(key);
      steppedFileIndexes.delete(key);
    }
    async function stepCollapsedDiffs(direction) {
      const key = prPath();
      if (!shiftKCollapsedPRs.has(key)) return;
      const cards = fileCards();
      if (!cards.length) { setStatus("No loaded diff files to step through."); return; }
      const current = steppedFileIndexes.get(key);
      const nextIndex = current === undefined ? (direction > 0 ? 0 : cards.length - 1) : current + direction;
      if (nextIndex < 0 || nextIndex >= cards.length) { setStatus("No more diff files in that direction."); return; }
      const previous = current === undefined ? undefined : cards[current];
      if (previous) {
        const collapse = $("button", previous.element).find((button) => /^collapse( file)?$/i.test(controlLabel(button)));
        if (collapse) { collapse.click(); await sleep(80); }
      }
      const target = cards[nextIndex]; target.element.scrollIntoView({ block: "start", behavior: "smooth" });
      const expand = $("button", target.element).find((button) => /^expand( file)?$/i.test(controlLabel(button)));
      if (expand) { expand.click(); await sleep(100); }
      if (!$("button", target.element).some((button) => /^collapse( file)?$/i.test(controlLabel(button)))) { setStatus(`Could not expand ${target.path}.`); return; }
      steppedFileIndexes.set(key, nextIndex); setStatus(`Showing diff ${nextIndex + 1}/${cards.length}: ${target.path}`);
    }
    async function toggleCurrentFileViewed() {
      const key = prPath(); const cards = fileCards();
      const index = currentFileIndex(cards.map(({ element }) => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; }), window.innerHeight, steppedFileIndexes.get(key));
      if (index === null) { setStatus("No diff file is available to mark viewed."); return; }
      const card = cards[index]; const state = viewedControl(card.element);
      if (!state) { setStatus(`Viewed control not found for ${card.path}.`); return; }
      if (state.viewed === null) { setStatus(`Viewed state could not be determined for ${card.path}; left unchanged.`); return; }
      state.element.click(); await sleep(160);
      const updated = viewedControl(card.element)?.viewed;
      if (updated === state.viewed) throw new Error(`GitHub did not toggle viewed status for ${card.path}`);
      setStatus(`${updated ? "Marked viewed" : "Marked not viewed"}: ${card.path}`);
    }
    function findButton(...expressions) { return $("button, [role=button]").find((element) => expressions.some((expression) => expression.test(clean(element.getAttribute("aria-label") || element.textContent)))); }
    function navigatePRTab(tab) {
      const match = location.pathname.match(/^(\/[^/]+\/[^/]+\/pull\/\d+)(?:\/.*)?$/);
      if (!match) { setStatus("Pull request navigation links not found on this page."); return; }
      const href = `${match[1]}${tab === "files" ? "/changes" : ""}`;
      const link = $("a[href]").find((anchor) => { try { return new URL(anchor.href).pathname === href; } catch { return false; } });
      if (!link) { setStatus(`${tab === "files" ? "Files changed" : "Conversation"} tab link not found.`); return; }
      link.click();
    }
    function openReview() {
      const submit = $("button[data-component='Button']").find((button) => isSubmitReviewButtonText(clean(button.textContent)));
      if (!submit) { setStatus("Submit review button not found. Open the review form first."); return; }
      submit.click(); setStatus("Clicked GitHub's Submit review button.");
    }
    function markReady() {
      const target = findButton(/^ready for review$/i);
      if (!target) { setStatus("Ready for review action not found; this may not be a draft PR."); return; }
      target.click(); setStatus("GitHub's Ready for review action activated.");
    }
    function onKeydown(event) {
      if (running || !/^\/[^/]+\/[^/]+\/pull\/\d+/.test(location.pathname) || shouldIgnoreShortcutTarget(event.target)) return;
      if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && shiftKCollapsedPRs.has(prPath())) {
        const key = event.key.toLowerCase();
        if (key === "j" || key === "k") { event.preventDefault(); event.stopPropagation(); void perform(() => stepCollapsedDiffs(key === "j" ? 1 : -1)); return; }
      }
      const shortcuts = DEFAULT_SHORTCUTS;
      const actions = [
        ["tests", () => bulkFiles("tests")], ["docs", () => bulkFiles("docs")], ["generated", () => bulkFiles("generated")],
        ["deleted", () => bulkFiles("deleted")], ["review", openReview], ["ready", markReady],
        ["conversation", () => navigatePRTab("conversation")], ["files", () => navigatePRTab("files")],
        ["collapse", rotateCollapse], ["expand", () => collapseExpand(true, false)], ["toggleViewed", toggleCurrentFileViewed]
      ];
      for (const [name, action] of actions) {
        const macReviewAlias = name === "review" && event.metaKey && !event.ctrlKey && event.shiftKey && ["enter", "return"].includes(event.key.toLowerCase());
        if (!shortcutMatches(event, shortcuts[name] || "") && !macReviewAlias) continue;
        event.preventDefault(); event.stopPropagation(); void perform(action); return;
      }
    }
    document.addEventListener("keydown", onKeydown, true);
  }

  if (typeof document !== "undefined") {
    if (typeof chrome !== "undefined" && /^\/[^/]+\/[^/]+\/pull\/\d+/.test(location.pathname)) startContent();
  }
})();

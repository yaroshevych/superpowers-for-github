import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../superpowers.js");

test("default patterns classify nested test, docs and generated files", () => {
  assert.equal(core.classifyFile("src/components/Button.test.tsx", core.DEFAULT_PATTERNS), "tests");
  assert.equal(core.classifyFile("docs/guide/intro.md", core.DEFAULT_PATTERNS), "docs");
  assert.equal(core.classifyFile("packages/app/pnpm-lock.yaml", core.DEFAULT_PATTERNS), "generated");
  assert.equal(core.classifyFile("src/index.ts", core.DEFAULT_PATTERNS), null);
});

test("double star patterns match a root directory and nested directories", () => {
  assert.equal(core.globMatches("tests/a.test.ts", "**/*.test.*"), true);
  assert.equal(core.globMatches("packages/app/tests/a.ts", "**/tests/**"), true);
  assert.equal(core.globMatches("src/testimony/a.ts", "**/test/**"), false);
});



test("shortcut parser matches modifier state exactly", () => {
  const event = { key: "t", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false };
  assert.equal(core.shortcutMatches(event, "Shift+T"), true);
  assert.equal(core.shortcutMatches({ ...event, ctrlKey: true }, "Shift+T"), false);
  assert.equal(core.shortcutMatches({ ...event, key: "Return", ctrlKey: true }, "Ctrl+Shift+Enter"), true);
  assert.deepEqual(core.parseShortcut("Ctrl+Shift+Enter"), { key: "enter", shift: true, ctrl: true, alt: false, meta: false });
});

test("review shortcut target matches GitHub's split Submit review button label", () => {
  assert.equal(core.isSubmitReviewButtonText("Submit review Review"), true);
  assert.equal(core.isSubmitReviewButtonText("Submit reviewReview"), true);
  assert.equal(core.isSubmitReviewButtonText("Review changes"), false);
});

test("viewed-state detection is idempotent for GitHub diff labels", () => {
  assert.equal(core.readViewedState("Not Viewed", "false", null, null), false);
  assert.equal(core.readViewedState("Viewed", "false", null, null), true);
  assert.equal(core.readViewedState("Mark as viewed", null, null, null), false);
  assert.equal(core.readViewedState("Unmark as viewed", null, null, null), true);
  assert.equal(core.readViewedState(null, "true", null, null), true);
  assert.equal(core.readViewedState(null, null, null, null), null);
});

test("viewed shortcuts toggle the whole matching group", () => {
  assert.equal(core.nextViewedState([false, false]), true);
  assert.equal(core.nextViewedState([true, true]), false);
  assert.equal(core.nextViewedState([true, false]), true);
  assert.equal(core.nextViewedState([]), null);
});

test("current file selection follows viewport position or active j/k file", () => {
  assert.equal(core.currentFileIndex([], 800), null);
  assert.equal(core.currentFileIndex([{ top: 40, bottom: 80 }, { top: 500, bottom: 540 }], 800), 0);
  assert.equal(core.currentFileIndex([{ top: -900, bottom: -850 }, { top: 30, bottom: 70 }, { top: 250, bottom: 300 }], 800), 1);
  assert.equal(core.currentFileIndex([{ top: -900, bottom: -850 }, { top: 30, bottom: 70 }, { top: 250, bottom: 300 }], 800, 2), 2);
});

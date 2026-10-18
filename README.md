# Superpowers for GitHub

A lightweight Chrome/Chromium Manifest V3 extension for GitHub pull requests. Its logic lives in one plain JavaScript file, `superpowers.js`. No Node.js, npm install, TypeScript compiler or build step is needed to install or edit it.

## Install in Chrome or Chromium

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this folder (the one containing `manifest.json`).
3. After changing `superpowers.js`, click the extension's **Reload** button and refresh open GitHub PR tabs.

Or run `./install.sh [destination]` to copy the three extension files to another folder, then load that folder as unpacked.

## Safari on macOS

For a temporary install, open **Safari → Settings → Advanced**, enable **Show features for web developers**, then choose **Developer → Add Temporary Extension…** and select this folder. Safari removes temporary extensions when it quits or after 24 hours.

The `safari/` folder also contains a macOS app wrapper. Open `Superpowers for GitHub.app` once, then enable it in **Safari → Settings → Extensions**. The bundled JavaScript is copied from the root `superpowers.js`; rebuild the Xcode app after updating it. Safari 17 or later may require **Settings → Developer → Allow unsigned extensions** for local builds.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| Shift+T | Toggle test files viewed; collapse when viewed, expand when cleared |
| Shift+D | Toggle documentation files viewed; collapse when viewed, expand when cleared |
| Shift+G | Toggle generated files, snapshots and lockfiles viewed; collapse when viewed, expand when cleared |
| Shift+X | Toggle deleted files viewed; collapse when viewed, expand when cleared |
| Ctrl+Shift+Enter | Click GitHub's **Submit review** button (⌘+Shift+Enter also works on Mac) |
| Shift+R | Mark a draft PR ready for review |
| Shift+C | Open Conversation |
| Shift+F | Open Files changed |
| Shift+K | Rotate between collapsing all diffs and expanding only unviewed diffs |
| Shift+E | Expand all diffs |
| j / k | After Shift+K collapses all: expand the next / previous diff, collapsing the one you left |
| Shift+V | Toggle viewed status for the top visible file; targets the active file while using j/k |

The review shortcut clicks the visible **Submit review** button, so it submits the review. Shortcuts are ignored while focus is in an input, textarea, editable region or editor. Action progress and failures are written to the page's developer console; there is no in-page UI.

## Shortcut reference

Open the extension's **Details → Extension options** in `chrome://extensions` to view the shortcut list. Shortcuts and file patterns are built in and not configurable. Default patterns cover common test folders and suffixes, documentation, snapshots, minified assets and common lockfiles.

## Limitations

GitHub changes its page markup, and the extension uses GitHub's visible controls rather than a private API. The first file bulk action visits the PR once so GitHub mounts lazy diff headers, then restores the original scroll position; later actions on that PR skip the sweep. The extension reports files whose controls or viewed state it could not read.

Run the focused helper tests with `node --test tests/core.test.mjs` (Node.js built-in test runner; no install step).

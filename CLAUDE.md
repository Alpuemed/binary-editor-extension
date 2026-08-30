# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension ("Hex Editor") that lets users open any file in a hex
grid view via VS Code's Custom Editor API and edit bytes directly, with full
undo/redo integration, insert/delete, and find. See `README.md` for the
user-facing feature list and a detailed architecture/data-flow writeup —
read it before making non-trivial changes, since the extension-host ↔
webview split and the edit model are not obvious from any single file.

## Commands

```
npm install         # install deps
npm run watch        # esbuild watch build of extension + webview + tests; then F5 in VS Code to launch an Extension Development Host
npm run compile       # one-off build (same three esbuild entry points)
npm run check-types    # tsc --noEmit over src/ and media/
npm run lint         # eslint src
npm test           # compiles, then runs the integration suite in a headless VS Code (vscode-test)
npm run package       # production build + vsce package (.vsix)
```

Run a single test by narrowing `.vscode-test.mjs`'s `files` glob, or:
`npx vscode-test --grep "<test name>"`.

There is no separate "unit test" layer — `src/test/*.test.ts` are VS Code
integration tests that run inside a real (headless) VS Code instance via
`@vscode/test-cli`/`@vscode/test-electron`, because the code under test is
built entirely against the `vscode` API surface.

## Architecture

Two runtime environments, one message protocol between them:

- **Extension host** (`src/`, Node.js, has full `vscode` API access): owns
  the byte buffer and edit history. `HexDocument` (`src/hexDocument.ts`) is
  the single source of truth — all edits are represented as splices
  (`{ offset, oldBytes, newBytes }`), which uniformly cover overwrite/
  insert/delete and make inverting an edit (for undo) trivial.
  `HexEditorProvider` (`src/hexEditorProvider.ts`) is the
  `vscode.CustomEditorProvider<HexDocument>` — it wires webview messages to
  `HexDocument.makeEdit(...)` calls and pushes the resulting byte buffer
  back out to every webview panel on the document.
- **Webview** (`media/main.ts`, browser sandbox, no `vscode` API — only
  `postMessage`): renders a virtualized hex/ASCII grid (only visible rows
  are ever in the DOM), owns cursor/selection/keyboard handling, and does
  find client-side. It applies edits optimistically to its local copy for
  responsive typing, but the extension host's `update` message is always
  authoritative — this is also how `Ctrl+Z`/`Ctrl+Y` (handled entirely by
  VS Code calling into `HexDocument`) end up reflected in the webview
  without the webview knowing anything about VS Code's undo stack.
- `src/protocol.ts` defines the message shapes and is imported by both
  sides, so host and webview can't silently drift out of sync.

Bundling: esbuild (`esbuild.js`) builds three separate entry points —
`src/extension.ts` → `dist/extension.js` (CJS, Node, `vscode` external),
`media/main.ts` → `dist/webview.js` (IIFE, browser), and
`src/test/*.test.ts` → `dist/test/*.test.js` (CJS, Node, `vscode`+`mocha`
external). There is no framework in the webview by design — it's direct DOM
manipulation — so changes to `media/main.ts` don't need a component model,
just care around the virtualization/render loop.

## Known v1 limitations (intentional, not bugs)

- Whole file loaded into memory on both sides — not designed for very large
  (100MB+) files yet. Would need chunked reads + a virtualized data model
  (not just a virtualized view) to support that.
- Find scans the in-memory buffer client-side in the webview.

If a task pushes on either of these, treat it as a scope change worth
flagging rather than silently reworking the data model.

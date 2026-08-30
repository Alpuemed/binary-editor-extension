# Hex Editor

A VS Code extension that lets you view and edit binary files as a hex grid,
using VS Code's [Custom Editor API](https://code.visualstudio.com/api/extension-guides/custom-editors).

## Features

- Open any file in the hex view via the "Open With Hex Editor" command (right-click in the Explorer, or `Ctrl+Shift+P` on an open file) or "Open With..." → "Hex Editor".
- Click a byte in the hex or ASCII pane to select it, then type to edit:
  - In the hex pane, type two hex digits to overwrite a byte.
  - In the ASCII pane, type a character to overwrite a byte.
- `Insert` inserts a zero byte at the cursor; `Delete`/`Backspace` remove a byte.
- `Ctrl+Z` / `Ctrl+Y` (or `Cmd+Z` / `Cmd+Shift+Z` on macOS) undo/redo through VS Code's normal edit stack.
- `Ctrl+F` / `Cmd+F` focuses the find box. Enter a hex byte sequence (e.g. `4a 6f`) or plain text to search; `Enter`/`Shift+Enter` step to the next/previous match.
- `Ctrl+S` saves back to the original file, same as any other editor.

## Development

```
npm install
npm run watch
```

Then press `F5` in VS Code to launch an Extension Development Host with the extension loaded.

### Commands

| Command | What it does |
| --- | --- |
| `npm run compile` | One-off esbuild bundle of the extension and webview. |
| `npm run watch` | Rebuilds on file change; used by the `F5` launch config. |
| `npm run check-types` | Type-checks everything with `tsc --noEmit`. |
| `npm run lint` | Lints `src/` with ESLint. |
| `npm test` | Runs the integration test suite in a headless VS Code instance (compiles first). |
| `npm run package` | Bundles a production build (`npm run build`) and packages a `.vsix` with `vsce`. |

To run a single test file, edit `.vscode-test.mjs`'s `files` glob or pass `--grep <pattern>` to `vscode-test` directly (`npx vscode-test --grep "registers"`).

## Architecture

- `src/extension.ts` — activation entry point; registers the custom editor provider and the `binaryEditor.openHexEditor` command.
- `src/hexDocument.ts` — the `HexDocument` model (implements `vscode.CustomDocument`). Owns the byte buffer and the edit history, and is the single source of truth VS Code's undo/redo stack talks to. Edits are represented as splices (`{ offset, oldBytes, newBytes }`), which uniformly cover overwrite/insert/delete and make computing an inverse (for undo) trivial.
- `src/hexEditorProvider.ts` — the `vscode.CustomEditorProvider<HexDocument>` implementation. Bridges `HexDocument` to one or more webview panels: forwards document changes to webviews via `postMessage`, and turns webview edit messages into `HexDocument.makeEdit` calls. Also implements save/save-as/revert/backup by delegating to the document.
- `src/protocol.ts` — the message types shared between the extension host and the webview (`src/hexEditorProvider.ts` and `media/main.ts` both import from here, so the two sides can't drift apart silently).
- `media/main.ts` — the webview UI: a virtualized hex grid (only visible rows are in the DOM; a spacer div + `translateY` fake the full scroll height), cursor/selection handling, keyboard-driven editing and navigation, and client-side find. It keeps its own copy of the byte buffer for responsiveness (optimistic local edits) but always re-syncs to whatever the host sends in an `update` message, which is the authoritative state — this is what makes undo/redo "just work" in the webview without it needing to know anything about VS Code's edit stack.
- `media/main.css` — styling, using VS Code's theme CSS variables so the view matches the active color theme.

### Data flow for an edit

1. User types in the webview → `media/main.ts` applies the change to its local `bytes` copy (for instant feedback) and posts an `edit`/`insert`/`delete` message.
2. `HexEditorProvider` turns that message into a `ByteEdit` splice and calls `document.makeEdit(...)`.
3. `HexDocument` applies the splice, records it, and fires `onDidChangeDocument` (which VS Code uses for its undo/redo stack) and `onDidChangeContent`.
4. `HexEditorProvider` listens to `onDidChangeContent` and posts the new full byte buffer back to every webview showing that document — including the one that originated the edit, which just overwrites its optimistic copy with the (identical) authoritative one.
5. If the user hits `Ctrl+Z`, VS Code calls the `undo()` closure captured in step 3, which reverses the splice on `HexDocument` and re-fires `onDidChangeContent`, which flows back to the webview the same way.

### Known limitations (by design, for v1)

- The whole file is loaded into memory in both the extension host and the webview — fine for small/medium files, but multi-GB files would need chunked reads and a virtualized data model, not just a virtualized view.
- Find scans the in-memory buffer client-side in the webview; fine at this scale, but would need to move host-side (or be indexed) if large-file support is added later.

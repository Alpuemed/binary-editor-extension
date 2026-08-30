import type { HostToWebviewMessage } from '../src/protocol';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const ROW_BYTES = 16;
const ROW_HEIGHT = 20;
const OVERSCAN_ROWS = 8;

type Pane = 'hex' | 'ascii';

const vscodeApi = acquireVsCodeApi();

const hexScroller = document.getElementById('hex-scroller') as HTMLDivElement;
const hexSizer = document.getElementById('hex-sizer') as HTMLDivElement;
const hexRows = document.getElementById('hex-rows') as HTMLDivElement;
const hexHeader = document.getElementById('hex-header') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const findInput = document.getElementById('find-input') as HTMLInputElement;

let bytes = new Uint8Array(0);
let fileName = '';
let cursor: { offset: number; pane: Pane } = { offset: 0, pane: 'hex' };
let pendingNibble: number | null = null;
const editedOffsets = new Set<number>();

let currentMatches: number[] = [];
let matchLength = 0;
let activeMatchIndex = -1;
let activeMatchOffset: number | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function printable(value: number): string {
  return value >= 32 && value < 127 ? String.fromCharCode(value) : '.';
}

function rowStartOf(offset: number): number {
  return offset - (offset % ROW_BYTES);
}

function pageRows(): number {
  return Math.max(1, Math.floor(hexScroller.clientHeight / ROW_HEIGHT) - 1);
}

function buildHeader(): void {
  hexHeader.replaceChildren();
  const offsetLabel = document.createElement('span');
  offsetLabel.textContent = 'Offset';

  const hexLabels = document.createElement('div');
  hexLabels.className = 'hex-bytes';
  for (let i = 0; i < ROW_BYTES; i++) {
    const span = document.createElement('span');
    span.className = 'byte-cell';
    span.textContent = i.toString(16).padStart(2, '0').toUpperCase();
    hexLabels.appendChild(span);
  }

  const asciiLabel = document.createElement('span');
  asciiLabel.textContent = 'ASCII';

  hexHeader.append(offsetLabel, hexLabels, asciiLabel);
}

function buildRow(rowIndex: number): HTMLElement {
  const rowStart = rowIndex * ROW_BYTES;
  const row = document.createElement('div');
  row.className = 'hex-row';

  const offsetEl = document.createElement('span');
  offsetEl.className = 'offset';
  offsetEl.textContent = rowStart.toString(16).padStart(8, '0');

  const hexEl = document.createElement('div');
  hexEl.className = 'hex-bytes';
  const asciiEl = document.createElement('div');
  asciiEl.className = 'hex-ascii';

  for (let i = 0; i < ROW_BYTES; i++) {
    const offset = rowStart + i;
    const hexCell = document.createElement('span');
    hexCell.className = 'byte-cell';
    hexCell.dataset.offset = String(offset);
    hexCell.dataset.pane = 'hex';

    const asciiCell = document.createElement('span');
    asciiCell.className = 'ascii-cell';
    asciiCell.dataset.offset = String(offset);
    asciiCell.dataset.pane = 'ascii';

    if (offset < bytes.length) {
      const value = bytes[offset];
      hexCell.textContent = value.toString(16).padStart(2, '0');
      asciiCell.textContent = printable(value);
      if (editedOffsets.has(offset)) {
        hexCell.classList.add('edited');
        asciiCell.classList.add('edited');
      }
    } else if (offset > bytes.length) {
      hexCell.style.visibility = 'hidden';
      asciiCell.style.visibility = 'hidden';
    }

    if (offset === cursor.offset) {
      (cursor.pane === 'hex' ? hexCell : asciiCell).classList.add('cursor');
    }
    if (activeMatchOffset !== null && offset >= activeMatchOffset && offset < activeMatchOffset + matchLength) {
      hexCell.classList.add('active-match');
      asciiCell.classList.add('active-match');
    }

    hexEl.appendChild(hexCell);
    asciiEl.appendChild(asciiCell);
  }

  row.append(offsetEl, hexEl, asciiEl);
  return row;
}

function render(): void {
  const totalRows = Math.floor(bytes.length / ROW_BYTES) + 1;
  hexSizer.style.height = `${totalRows * ROW_HEIGHT}px`;

  const scrollTop = hexScroller.scrollTop;
  const clientHeight = hexScroller.clientHeight || ROW_HEIGHT * 20;
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const visibleRowCount = Math.ceil(clientHeight / ROW_HEIGHT) + OVERSCAN_ROWS * 2;
  const lastRow = Math.min(totalRows - 1, firstRow + visibleRowCount);

  hexRows.style.transform = `translateY(${firstRow * ROW_HEIGHT}px)`;
  hexRows.replaceChildren();
  for (let r = firstRow; r <= lastRow; r++) {
    hexRows.appendChild(buildRow(r));
  }

  updateStatus();
}

function updateStatus(): void {
  const offsetStr = cursor.offset.toString(16).padStart(8, '0');
  let matchStr = '';
  if (currentMatches.length > 0) {
    matchStr = ` · match ${activeMatchIndex + 1}/${currentMatches.length}`;
  } else if (findInput.value.trim().length > 0) {
    matchStr = ' · no matches';
  }
  statusEl.textContent = `${fileName} · ${bytes.length.toLocaleString()} bytes · offset 0x${offsetStr}${matchStr}`;
}

function ensureCursorVisible(): void {
  const row = Math.floor(cursor.offset / ROW_BYTES);
  const rowTop = row * ROW_HEIGHT;
  const rowBottom = rowTop + ROW_HEIGHT;
  if (rowTop < hexScroller.scrollTop) {
    hexScroller.scrollTop = rowTop;
  } else if (rowBottom > hexScroller.scrollTop + hexScroller.clientHeight) {
    hexScroller.scrollTop = rowBottom - hexScroller.clientHeight;
  }
}

function setCursor(offset: number, pane: Pane): void {
  cursor = { offset: clamp(offset, 0, bytes.length), pane };
  pendingNibble = null;
  ensureCursorVisible();
  render();
}

function moveCursor(delta: number): void {
  setCursor(cursor.offset + delta, cursor.pane);
}

function applyByteEdit(offset: number, newByte: number): void {
  if (offset >= bytes.length) {
    return;
  }
  const next = bytes.slice();
  next[offset] = newByte;
  bytes = next;
  editedOffsets.add(offset);
  vscodeApi.postMessage({ type: 'edit', offset, newByte });
  render();
}

function insertByteAtCursor(value = 0): void {
  const offset = cursor.offset;
  const next = new Uint8Array(bytes.length + 1);
  next.set(bytes.subarray(0, offset), 0);
  next[offset] = value;
  next.set(bytes.subarray(offset), offset + 1);
  bytes = next;
  editedOffsets.add(offset);
  vscodeApi.postMessage({ type: 'insert', offset, bytes: [value] });
  setCursor(offset, cursor.pane);
}

function deleteAt(offset: number): void {
  if (offset < 0 || offset >= bytes.length) {
    return;
  }
  const next = new Uint8Array(bytes.length - 1);
  next.set(bytes.subarray(0, offset), 0);
  next.set(bytes.subarray(offset + 1), offset);
  bytes = next;
  vscodeApi.postMessage({ type: 'delete', offset, length: 1 });
}

function deleteByteAtCursor(): void {
  const offset = cursor.offset;
  deleteAt(offset);
  setCursor(offset, cursor.pane);
}

function backspaceAtCursor(): void {
  if (cursor.offset === 0) {
    return;
  }
  const offset = cursor.offset - 1;
  deleteAt(offset);
  setCursor(offset, cursor.pane);
}

function typeHexNibble(char: string): void {
  const digit = parseInt(char, 16);
  const offset = cursor.offset;
  if (offset >= bytes.length) {
    insertByteAtCursor(0);
  }
  const current = bytes[offset] ?? 0;
  if (pendingNibble === null) {
    pendingNibble = digit;
    applyByteEdit(offset, (digit << 4) | (current & 0x0f));
  } else {
    const newValue = (pendingNibble << 4) | digit;
    pendingNibble = null;
    applyByteEdit(offset, newValue);
    setCursor(offset + 1, 'hex');
  }
}

function typeAsciiChar(char: string): void {
  const code = char.charCodeAt(0);
  if (code > 0xff) {
    return;
  }
  const offset = cursor.offset;
  if (offset >= bytes.length) {
    insertByteAtCursor(code);
  } else {
    applyByteEdit(offset, code);
  }
  setCursor(offset + 1, 'ascii');
}

function parseQuery(query: string): Uint8Array | null {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const stripped = trimmed.replace(/\s+/g, '');
  if (/^[0-9a-fA-F]+$/.test(stripped) && stripped.length % 2 === 0) {
    const out = new Uint8Array(stripped.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(stripped.substr(i * 2, 2), 16);
    }
    return out;
  }
  return new TextEncoder().encode(query);
}

function computeMatches(pattern: Uint8Array): number[] {
  const matches: number[] = [];
  outer: for (let i = 0; i <= bytes.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (bytes[i + j] !== pattern[j]) {
        continue outer;
      }
    }
    matches.push(i);
  }
  return matches;
}

function runFind(direction: 1 | -1): void {
  const pattern = parseQuery(findInput.value);
  if (!pattern) {
    currentMatches = [];
    activeMatchIndex = -1;
    activeMatchOffset = null;
    render();
    return;
  }

  currentMatches = computeMatches(pattern);
  matchLength = pattern.length;

  if (currentMatches.length === 0) {
    activeMatchIndex = -1;
    activeMatchOffset = null;
    render();
    return;
  }

  activeMatchIndex =
    activeMatchIndex === -1
      ? 0
      : (activeMatchIndex + direction + currentMatches.length) % currentMatches.length;
  activeMatchOffset = currentMatches[activeMatchIndex];
  cursor = { offset: activeMatchOffset, pane: 'hex' };
  ensureCursorVisible();
  render();
}

hexRows.addEventListener('mousedown', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-offset]');
  if (!target) {
    return;
  }
  e.preventDefault();
  pendingNibble = null;
  setCursor(Number(target.dataset.offset), target.dataset.pane as Pane);
});

hexScroller.addEventListener('scroll', () => render());
window.addEventListener('resize', () => render());

findInput.addEventListener('input', () => {
  currentMatches = [];
  activeMatchIndex = -1;
  activeMatchOffset = null;
  render();
});

document.getElementById('find-next')?.addEventListener('click', () => runFind(1));
document.getElementById('find-prev')?.addEventListener('click', () => runFind(-1));

document.addEventListener('keydown', (e) => {
  if (document.activeElement === findInput) {
    if (e.key === 'Enter') {
      e.preventDefault();
      runFind(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      findInput.blur();
    }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    findInput.focus();
    findInput.select();
    return;
  }

  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      moveCursor(-1);
      return;
    case 'ArrowRight':
      e.preventDefault();
      moveCursor(1);
      return;
    case 'ArrowUp':
      e.preventDefault();
      moveCursor(-ROW_BYTES);
      return;
    case 'ArrowDown':
      e.preventDefault();
      moveCursor(ROW_BYTES);
      return;
    case 'PageUp':
      e.preventDefault();
      moveCursor(-ROW_BYTES * pageRows());
      return;
    case 'PageDown':
      e.preventDefault();
      moveCursor(ROW_BYTES * pageRows());
      return;
    case 'Home':
      e.preventDefault();
      setCursor(e.ctrlKey || e.metaKey ? 0 : rowStartOf(cursor.offset), cursor.pane);
      return;
    case 'End':
      e.preventDefault();
      setCursor(
        e.ctrlKey || e.metaKey ? bytes.length : Math.min(bytes.length, rowStartOf(cursor.offset) + ROW_BYTES - 1),
        cursor.pane
      );
      return;
    case 'Tab':
      e.preventDefault();
      setCursor(cursor.offset, cursor.pane === 'hex' ? 'ascii' : 'hex');
      return;
    case 'Insert':
      e.preventDefault();
      insertByteAtCursor();
      return;
    case 'Delete':
      e.preventDefault();
      deleteByteAtCursor();
      return;
    case 'Backspace':
      e.preventDefault();
      backspaceAtCursor();
      return;
  }

  if (cursor.pane === 'hex') {
    if (/^[0-9a-fA-F]$/.test(e.key)) {
      e.preventDefault();
      typeHexNibble(e.key);
    }
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    typeAsciiChar(e.key);
  }
});

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  if (message.type === 'update') {
    bytes = Uint8Array.from(message.bytes);
    fileName = message.fileName;
    cursor.offset = clamp(cursor.offset, 0, bytes.length);
    render();
  }
});

buildHeader();
render();
vscodeApi.postMessage({ type: 'ready' });

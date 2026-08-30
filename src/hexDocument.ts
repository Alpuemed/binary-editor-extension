import * as vscode from 'vscode';
import { Disposable } from './dispose';

/**
 * A single change to the byte buffer, expressed as a splice: remove
 * `oldBytes.length` bytes at `offset` and insert `newBytes` in their place.
 * This one shape covers overwrite (equal lengths), insert (empty oldBytes)
 * and delete (empty newBytes), and its inverse is trivial to compute, which
 * is what makes undo/redo cheap.
 */
export interface ByteEdit {
  readonly offset: number;
  readonly oldBytes: Uint8Array;
  readonly newBytes: Uint8Array;
}

export class HexDocument extends Disposable implements vscode.CustomDocument {
  static async create(uri: vscode.Uri, backupId: string | undefined): Promise<HexDocument> {
    const dataUri = backupId ? vscode.Uri.parse(backupId) : uri;
    const bytes = await HexDocument.readFile(dataUri);
    return new HexDocument(uri, bytes);
  }

  private static async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    if (uri.scheme === 'untitled') {
      return new Uint8Array();
    }
    return new Uint8Array(await vscode.workspace.fs.readFile(uri));
  }

  private readonly _uri: vscode.Uri;
  private _bytes: Uint8Array;

  // Edits made since the document was opened, in order. `_savedEditCount`
  // marks how many of them are reflected on disk, so dirty state is just
  // `_edits.length !== _savedEditCount` and revert just truncates back to it.
  private _edits: ByteEdit[] = [];
  private _savedEditCount = 0;

  private constructor(uri: vscode.Uri, initialBytes: Uint8Array) {
    super();
    this._uri = uri;
    this._bytes = initialBytes;
  }

  public get uri(): vscode.Uri {
    return this._uri;
  }

  public get bytes(): Uint8Array {
    return this._bytes;
  }

  public get isDirty(): boolean {
    return this._edits.length !== this._savedEditCount;
  }

  private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
  public readonly onDidDispose = this._onDidDispose.event;

  /** Fires whenever the byte buffer changes, for any reason (edit, undo, redo, revert). */
  private readonly _onDidChangeContent = this._register(new vscode.EventEmitter<void>());
  public readonly onDidChangeContent = this._onDidChangeContent.event;

  /** Fires only for edits that VS Code's own undo/redo stack should know about. */
  private readonly _onDidChangeDocument = this._register(
    new vscode.EventEmitter<{
      readonly label: string;
      undo(): void;
      redo(): void;
    }>()
  );
  public readonly onDidChangeDocument = this._onDidChangeDocument.event;

  dispose(): void {
    this._onDidDispose.fire();
    super.dispose();
  }

  makeEdit(edit: ByteEdit, label: string): void {
    this.applySplice(edit);
    this._edits.push(edit);
    this._onDidChangeDocument.fire({
      label,
      undo: () => {
        this.applySplice(invert(edit));
        this._edits.pop();
        this._onDidChangeContent.fire();
      },
      redo: () => {
        this.applySplice(edit);
        this._edits.push(edit);
        this._onDidChangeContent.fire();
      },
    });
    this._onDidChangeContent.fire();
  }

  private applySplice(edit: ByteEdit): void {
    const before = this._bytes.subarray(0, edit.offset);
    const after = this._bytes.subarray(edit.offset + edit.oldBytes.length);
    const result = new Uint8Array(before.length + edit.newBytes.length + after.length);
    result.set(before, 0);
    result.set(edit.newBytes, before.length);
    result.set(after, before.length + edit.newBytes.length);
    this._bytes = result;
  }

  async save(cancellation: vscode.CancellationToken): Promise<void> {
    await this.saveAs(this._uri, cancellation);
    this._savedEditCount = this._edits.length;
  }

  async saveAs(targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
    if (cancellation.isCancellationRequested) {
      return;
    }
    await vscode.workspace.fs.writeFile(targetResource, this._bytes);
  }

  async revert(): Promise<void> {
    this._bytes = await HexDocument.readFile(this._uri);
    this._edits = [];
    this._savedEditCount = 0;
    this._onDidChangeContent.fire();
  }

  async backup(destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
    await this.saveAs(destination, cancellation);
    return {
      id: destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(destination);
        } catch {
          // Backup file may already be gone; nothing to do.
        }
      },
    };
  }
}

function invert(edit: ByteEdit): ByteEdit {
  return { offset: edit.offset, oldBytes: edit.newBytes, newBytes: edit.oldBytes };
}

import * as vscode from 'vscode';
import { ByteEdit, HexDocument } from './hexDocument';
import { HostToWebviewMessage, WebviewToHostMessage } from './protocol';
import { getNonce } from './util';

export class HexEditorProvider implements vscode.CustomEditorProvider<HexDocument> {
  public static readonly viewType = 'binaryEditor.hexView';

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new HexEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(HexEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  private readonly webviewsByDocument = new Map<string, Set<vscode.WebviewPanel>>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<HexDocument>
  >();
  public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<HexDocument> {
    const document = await HexDocument.create(uri, openContext.backupId);

    document.onDidChangeDocument((event) => {
      this._onDidChangeCustomDocument.fire({ document, ...event });
    });
    document.onDidChangeContent(() => {
      for (const panel of this.getWebviews(document.uri)) {
        this.postUpdate(panel, document);
      }
    });

    return document;
  }

  async resolveCustomEditor(
    document: HexDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.addWebview(document.uri, webviewPanel);

    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    webviewPanel.webview.onDidReceiveMessage((message: WebviewToHostMessage) =>
      this.handleMessage(document, webviewPanel, message)
    );
  }

  private handleMessage(
    document: HexDocument,
    webviewPanel: vscode.WebviewPanel,
    message: WebviewToHostMessage
  ): void {
    switch (message.type) {
      case 'ready':
        this.postUpdate(webviewPanel, document);
        return;
      case 'edit': {
        const edit: ByteEdit = {
          offset: message.offset,
          oldBytes: document.bytes.subarray(message.offset, message.offset + 1),
          newBytes: Uint8Array.of(message.newByte),
        };
        document.makeEdit(edit, 'Edit Byte');
        return;
      }
      case 'insert': {
        const edit: ByteEdit = {
          offset: message.offset,
          oldBytes: new Uint8Array(0),
          newBytes: Uint8Array.from(message.bytes),
        };
        document.makeEdit(edit, 'Insert Bytes');
        return;
      }
      case 'delete': {
        const edit: ByteEdit = {
          offset: message.offset,
          oldBytes: document.bytes.subarray(message.offset, message.offset + message.length),
          newBytes: new Uint8Array(0),
        };
        document.makeEdit(edit, 'Delete Bytes');
        return;
      }
    }
  }

  private postUpdate(panel: vscode.WebviewPanel, document: HexDocument): void {
    const message: HostToWebviewMessage = {
      type: 'update',
      bytes: Array.from(document.bytes),
      fileName: document.uri.path.split('/').pop() ?? document.uri.toString(),
    };
    void panel.webview.postMessage(message);
  }

  private addWebview(uri: vscode.Uri, panel: vscode.WebviewPanel): void {
    const key = uri.toString();
    const set = this.webviewsByDocument.get(key) ?? new Set<vscode.WebviewPanel>();
    set.add(panel);
    this.webviewsByDocument.set(key, set);
    panel.onDidDispose(() => {
      set.delete(panel);
      if (set.size === 0) {
        this.webviewsByDocument.delete(key);
      }
    });
  }

  private getWebviews(uri: vscode.Uri): vscode.WebviewPanel[] {
    return Array.from(this.webviewsByDocument.get(uri.toString()) ?? []);
  }

  public saveCustomDocument(document: HexDocument, cancellation: vscode.CancellationToken): Thenable<void> {
    return document.save(cancellation);
  }

  public saveCustomDocumentAs(
    document: HexDocument,
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken
  ): Thenable<void> {
    return document.saveAs(destination, cancellation);
  }

  public revertCustomDocument(document: HexDocument, _cancellation: vscode.CancellationToken): Thenable<void> {
    return document.revert();
  }

  public backupCustomDocument(
    document: HexDocument,
    context: vscode.CustomDocumentBackupContext,
    cancellation: vscode.CancellationToken
  ): Thenable<vscode.CustomDocumentBackup> {
    return document.backup(context.destination, cancellation);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.css')
    );
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Hex Editor</title>
</head>
<body>
  <div id="toolbar">
    <input id="find-input" type="text" placeholder="Find (hex bytes like 4a 6f or plain text)" />
    <button id="find-prev" title="Previous match">&uarr;</button>
    <button id="find-next" title="Next match">&darr;</button>
    <span id="status"></span>
  </div>
  <div id="hex-view">
    <div id="hex-header"></div>
    <div id="hex-scroller">
      <div id="hex-sizer"></div>
      <div id="hex-rows"></div>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

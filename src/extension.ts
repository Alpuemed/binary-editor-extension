import * as vscode from 'vscode';
import { HexEditorProvider } from './hexEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(HexEditorProvider.register(context));

  context.subscriptions.push(
    vscode.commands.registerCommand('binaryEditor.openHexEditor', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        void vscode.window.showErrorMessage('No file selected to open in Hex Editor.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', target, HexEditorProvider.viewType);
    })
  );
}

export function deactivate(): void {
  // Nothing to clean up: all state is owned by disposables registered
  // through context.subscriptions.
}

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension', () => {
  test('activates and registers the hex editor command', async () => {
    const extension = vscode.extensions.getExtension('local-dev.binary-editor-extension');
    assert.ok(extension, 'extension should be discoverable by id');

    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('binaryEditor.openHexEditor'),
      'binaryEditor.openHexEditor command should be registered'
    );
  });
});

/**
 * Message shapes exchanged between the extension host and the webview.
 * Shared between src/ (node) and media/ (browser) since both sides need to
 * agree on the wire format.
 */

export interface UpdateMessage {
  readonly type: 'update';
  readonly bytes: number[];
  readonly fileName: string;
}

export type HostToWebviewMessage = UpdateMessage;

export interface EditMessage {
  readonly type: 'edit';
  readonly offset: number;
  readonly newByte: number;
}

export interface InsertMessage {
  readonly type: 'insert';
  readonly offset: number;
  readonly bytes: number[];
}

export interface DeleteMessage {
  readonly type: 'delete';
  readonly offset: number;
  readonly length: number;
}

export interface ReadyMessage {
  readonly type: 'ready';
}

export type WebviewToHostMessage = EditMessage | InsertMessage | DeleteMessage | ReadyMessage;

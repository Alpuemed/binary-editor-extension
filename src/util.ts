import * as crypto from 'crypto';

export function getNonce(): string {
  return crypto.randomBytes(32).toString('base64url');
}
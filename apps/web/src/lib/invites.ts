import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes as base64url: 43 characters and 256 bits of entropy. */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this hash is stored, so a database leak does not expose usable invites (PRD §4). */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

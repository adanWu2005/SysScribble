import type { IncomingMessage } from 'node:http';
import { WS_BEARER_PREFIX, WS_SUBPROTOCOL, uuidSchema } from '@wb/shared';

/** Exact match against the allowlist. A missing Origin is rejected, not assumed safe (PRD §5.4). */
export function isAllowedOrigin(origin: string | undefined, allowed: ReadonlySet<string>): boolean {
  return typeof origin === 'string' && allowed.has(origin);
}

/** Extracts the JWT from `Sec-WebSocket-Protocol: wb.v1, bearer.<jwt>`. */
export function extractToken(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (!raw) return null;
  const protocols = raw.split(',').map((p) => p.trim());
  if (!protocols.includes(WS_SUBPROTOCOL)) return null;
  const bearer = protocols.find((p) => p.startsWith(WS_BEARER_PREFIX));
  if (!bearer) return null;
  const token = bearer.slice(WS_BEARER_PREFIX.length);
  return token.length > 0 ? token : null;
}

/** Accepts exactly `/rooms/<uuid>`. Everything else is refused before any lookup. */
export function parseRoomPath(url: string | undefined): string | null {
  if (!url) return null;
  const path = url.split('?', 1)[0] ?? '';
  const match = /^\/rooms\/([^/]+)$/.exec(path);
  const parsed = uuidSchema.safeParse(match?.[1]);
  return parsed.success ? parsed.data.toLowerCase() : null;
}

export function clientIp(req: IncomingMessage): string | undefined {
  return req.socket.remoteAddress;
}

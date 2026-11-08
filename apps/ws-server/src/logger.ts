import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: ['token', 'jwt', 'authorization', 'req.headers.authorization', 'req.headers["sec-websocket-protocol"]'],
      remove: true,
    },
  });
}

export type SecurityEvent =
  | 'origin_rejected'
  | 'jwt_rejected'
  | 'bad_room_path'
  | 'not_a_member'
  | 'kicked_user_reconnect'
  | 'too_many_sockets'
  | 'viewer_mutation_dropped'
  | 'room_over_quota_dropped'
  | 'malformed_frame'
  | 'awareness_spoof_dropped'
  | 'viewer_awareness_dropped'
  | 'rate_limited'
  | 'slow_consumer';

export interface SecurityFields {
  userId?: string;
  roomId?: string;
  ip?: string | undefined;
}

/** One shape for every security log line. Payload bytes are never logged. */
export function securityEvent(log: Logger, event: SecurityEvent, fields: SecurityFields = {}): void {
  log.warn({ security: true, event, ...fields }, event);
}

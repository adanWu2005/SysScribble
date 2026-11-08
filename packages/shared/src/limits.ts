/** Hard limits shared by both apps. Changing one here changes it everywhere. */

/** `ws` maxPayload — a frame larger than this is rejected before it is buffered (PRD §5.6). */
export const WS_MAX_PAYLOAD_BYTES = 1024 * 1024;

/** Per-socket token bucket: sustained rate and burst capacity (messages/second). */
export const WS_SOCKET_MSGS_PER_SEC = 60;
export const WS_SOCKET_BURST = 60;

/** Awareness payloads are tiny (cursor + name). Anything bigger is abuse. */
export const MAX_AWARENESS_PAYLOAD_BYTES = 8 * 1024;

/** Client-side awareness publish throttle, ≈25 Hz (PRD §3.2: 20–30 Hz). */
export const AWARENESS_THROTTLE_MS = 40;

/** The laser pointer samples the mouse at most this often (≈30 Hz). It is sent at the awareness rate. */
export const LASER_SAMPLE_MS = 33;
/** A viewport broadcast for Follow mode is sent at most this often (10 Hz). */
export const VIEWPORT_BROADCAST_MS = 100;
/** The Chaos Lab's latency slider goes up to this. */
export const MAX_ARTIFICIAL_LATENCY_MS = 2000;
/**
 * Frames released from the artificial delay queue are spaced at least this far apart (about 50 a
 * second), so lifting the delay after a long hold cannot burst past the server's per-socket limit.
 */
export const CHAOS_OUTBOUND_GAP_MS = 20;
/** A socket may ask for room stats at most this often. Extra requests are ignored. */
export const STATS_MIN_INTERVAL_MS = 400;
/** How often the Chaos Lab samples traffic and asks for room stats while it is open. */
export const TELEMETRY_POLL_MS = 1000;

/** How often a connected client measures round-trip latency. */
export const PING_INTERVAL_MS = 5_000;

/**
 * Client-side minimum gap between document frames. With awareness that caps a normal
 * client at 50 frames per second, safely under WS_SOCKET_MSGS_PER_SEC.
 */
export const DOC_SEND_INTERVAL_MS = 40;

/** Snapshot write-behind (PRD §3.3). */
export const FLUSH_DEBOUNCE_MS = 5_000;
export const FLUSH_MAX_WAIT_MS = 30_000;
/** Cross-instance flush lock TTL. Must exceed the slowest plausible Postgres write. */
export const FLUSH_LOCK_TTL_MS = 10_000;

/** Grace period before an empty room is evicted from memory. */
export const ROOM_EVICT_GRACE_MS = 2_000;

/** Invite tokens expire after 48 h (PRD §3.1). */
export const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

/** Presigned URL lifetimes (seconds). */
export const PRESIGN_PUT_TTL_SEC = 300;
export const PRESIGN_GET_TTL_SEC = 900;

/** Upload caps (PRD §5.6). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_ROOM_STORAGE_BYTES = 500 * 1024 * 1024;

/** LiveKit token TTL. */
export const LIVEKIT_TOKEN_TTL_SEC = 10 * 60;

/** Sliding-window REST rate limits (per user). */
export const RATE_LIMITS = {
  invite: { limit: 10, window: '1 h' },
  uploadUrl: { limit: 30, window: '1 h' },
  livekitToken: { limit: 20, window: '1 h' },
  roomCreate: { limit: 20, window: '1 h' },
  inviteAccept: { limit: 20, window: '1 h' },
  /** Declining an invitation from the dashboard. */
  inviteDecline: { limit: 40, window: '1 h' },
  /** Safety copies taken before a restore. */
  restore: { limit: 20, window: '1 h' },
  /** Downloads of one history entry, each up to 2 MiB out of Postgres. */
  snapshotRead: { limit: 120, window: '1 h' },
  /** Copying a workspace copies its uploaded files too, so it is costly. */
  roomDuplicate: { limit: 10, window: '1 h' },
  /** Dashboard thumbnails, each reading up to a dozen snapshots out of Postgres. */
  roomSummaries: { limit: 120, window: '1 h' },
  /** The dashboard's live headcount, polled about twice a minute while the tab is open. */
  presenceRead: { limit: 240, window: '1 h' },
} as const;
export type RateLimitKey = keyof typeof RATE_LIMITS;

/** Redis batching: outbound updates and awareness are merged for this long to save PAYG commands. */
export const REDIS_COALESCE_MS = 20;
/** While an instance is alone in a room, awareness is not published; it re-probes this often. */
export const AWARENESS_PROBE_MS = 5_000;
/** Pub/Sub is at-most-once, so instances exchange state vectors to repair lost messages. */
export const ANTI_ENTROPY_MS = 15_000;
/** Roles are re-read from Postgres this often, in case a control event was lost. */
export const ROLE_REVALIDATE_MS = 60_000;

export const WS_HEARTBEAT_MS = 30_000;
/** A socket that cannot drain this much queued output is terminated (slow-consumer DoS). */
export const WS_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
export const WS_MAX_SOCKETS_PER_USER_PER_ROOM = 8;
/** Frames queued while a room loads. */
export const WS_MAX_PENDING_FRAMES = 256;

/**
 * Version history (supabase/migrations/0006). The database enforces these. They are repeated here
 * so the UI can explain them and a test can keep the two in step.
 */
export const HISTORY_MAX_ENTRIES = 20;
export const HISTORY_MIN_INTERVAL_MS = 5 * 60 * 1000;
export const HISTORY_MAX_BYTES = 2 * 1024 * 1024;

/** Rooms whose encoded document exceeds this stop accepting edits (storage denial of wallet). */
export const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
/** A kicked user cannot reconnect for this long. */
export const KICK_BAN_MS = 60_000;

/**
 * The media figure the dashboard measures your usage against. It is a display budget only: what
 * is actually enforced is `MAX_ROOM_STORAGE_BYTES` for each workspace, checked at upload time.
 */
/** Most workspaces whose thumbnails one request may ask for. */
export const SUMMARY_MAX_IDS = 12;
/** A workspace with more uploaded files than this cannot be duplicated in one request. */
export const DUPLICATE_MAX_ASSETS = 100;

export const USER_MEDIA_BUDGET_BYTES = 100 * 1024 * 1024;

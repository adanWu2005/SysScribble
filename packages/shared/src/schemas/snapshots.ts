import { z } from 'zod';
import { uuidSchema } from './ids';

/** Version history: a bounded list of older saved states of a room. Owner and editor only. */

export const roomSnapshotParamsSchema = z.object({ roomId: uuidSchema, snapshotId: uuidSchema });
export type RoomSnapshotParams = z.infer<typeof roomSnapshotParamsSchema>;

export const snapshotSummarySchema = z.object({
  id: uuidSchema,
  /** `rooms.version` when this state was saved. */
  version: z.number().int(),
  sizeBytes: z.number().int().positive(),
  /** Null for an automatic entry. 'Before restore' for the safety copy made when restoring. */
  label: z.string().max(80).nullable(),
  createdAt: z.string(),
});
export type SnapshotSummary = z.infer<typeof snapshotSummarySchema>;

export const snapshotListResponseSchema = z.object({ snapshots: z.array(snapshotSummarySchema) });
export type SnapshotListResponse = z.infer<typeof snapshotListResponseSchema>;

/**
 * Asks the server to copy the room's current saved state into history. The reason is a fixed
 * word, never free text, so a label can only be one the server chose.
 */
export const checkpointRequestSchema = z.object({ reason: z.literal('before_restore') });
export type CheckpointRequest = z.infer<typeof checkpointRequestSchema>;

export const CHECKPOINT_LABEL = 'Before restore';

export const checkpointResponseSchema = z.object({
  /** Null when nothing had been saved yet, so there was nothing to keep. */
  checkpointId: uuidSchema.nullable(),
});
export type CheckpointResponse = z.infer<typeof checkpointResponseSchema>;

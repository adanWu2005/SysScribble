import { z } from 'zod';
import { MAX_UPLOAD_BYTES } from '../limits';
import { uuidSchema } from './ids';

/**
 * Closed allowlist (PRD §5.5). SVG is deliberately absent: it can carry <script>.
 * Adding a type here is a security review, not a config change.
 */
export const ALLOWED_UPLOAD_MIME = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;
export const allowedUploadMimeSchema = z.enum(ALLOWED_UPLOAD_MIME);
export type AllowedUploadMime = z.infer<typeof allowedUploadMimeSchema>;

export const MIME_EXTENSION: Readonly<Record<AllowedUploadMime, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Filenames are metadata only; the object key is server-generated. Still, keep them sane. */
const filenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\\/\x00-\x1f]+$/, 'Filename contains illegal characters');

export const uploadUrlRequestSchema = z.object({
  filename: filenameSchema,
  contentType: allowedUploadMimeSchema,
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
export type UploadUrlRequest = z.infer<typeof uploadUrlRequestSchema>;

export const uploadUrlResponseSchema = z.object({
  assetId: uuidSchema,
  objectKey: z.string(),
  uploadUrl: z.string().url(),
  expiresAt: z.string(),
  /** Headers the client MUST send on the PUT so the signature validates. */
  requiredHeaders: z.object({ 'Content-Type': z.string(), 'Content-Length': z.string() }),
});
export type UploadUrlResponse = z.infer<typeof uploadUrlResponseSchema>;

export const assetSchema = z.object({
  id: uuidSchema,
  roomId: uuidSchema,
  uploadedBy: uuidSchema,
  objectKey: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string(),
});
export type Asset = z.infer<typeof assetSchema>;

export const assetListResponseSchema = z.object({ assets: z.array(assetSchema) });
export const assetUrlResponseSchema = z.object({ url: z.string().url(), expiresAt: z.string() });

/** Server-generated key format. Clients never choose keys (PRD §5.2). */
export const R2_KEY_REGEX = /^rooms\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp|pdf)$/;

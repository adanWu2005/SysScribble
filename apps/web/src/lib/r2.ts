import 'server-only';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  MIME_EXTENSION,
  PRESIGN_GET_TTL_SEC,
  PRESIGN_PUT_TTL_SEC,
  R2_KEY_REGEX,
  type AllowedUploadMime,
} from '@wb/shared';
import { getServerEnv } from '@/lib/env.server';

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;
  const env = getServerEnv();
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    // R2 rejects the CRC32 checksum parameters newer SDKs add to presigned URLs by default.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return client;
}

/** Keys are always built here, from verified ids. Clients never supply one (PRD §5.2). */
export function buildObjectKey(roomId: string, assetId: string, mime: AllowedUploadMime): string {
  return `rooms/${roomId}/${assetId}.${MIME_EXTENSION[mime]}`;
}

function assertOwnKey(key: string): void {
  if (!R2_KEY_REGEX.test(key)) throw new Error('Refusing to act on a malformed object key');
}

/**
 * Signs Content-Type and Content-Length into the URL, so R2 rejects any other type or a
 * larger body (PRD §5.6). Without signableHeaders the presigner leaves both unsigned.
 */
export function presignPut(key: string, contentType: AllowedUploadMime, sizeBytes: number): Promise<string> {
  assertOwnKey(key);
  const command = new PutObjectCommand({
    Bucket: getServerEnv().R2_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: sizeBytes,
  });
  return getSignedUrl(getClient(), command, {
    expiresIn: PRESIGN_PUT_TTL_SEC,
    signableHeaders: new Set(['content-type', 'content-length']),
  });
}

/**
 * Time-limited read. The attachment disposition keeps a browser from rendering the object
 * as a page, while <img> and canvas use still work (PRD §5.5).
 */
export function presignGet(key: string, contentType: string): Promise<string> {
  assertOwnKey(key);
  const command = new GetObjectCommand({
    Bucket: getServerEnv().R2_BUCKET,
    Key: key,
    ResponseContentDisposition: 'attachment',
    ResponseContentType: contentType,
  });
  return getSignedUrl(getClient(), command, { expiresIn: PRESIGN_GET_TTL_SEC });
}

/** Copies one of our own objects to another of our own keys, inside the bucket. Both keys are checked. */
export async function copyObject(fromKey: string, toKey: string, contentType: string): Promise<void> {
  assertOwnKey(fromKey);
  assertOwnKey(toKey);
  const bucket = getServerEnv().R2_BUCKET;
  await getClient().send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: toKey,
      CopySource: `${bucket}/${fromKey}`,
      ContentType: contentType,
      MetadataDirective: 'REPLACE',
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  assertOwnKey(key);
  await getClient().send(new DeleteObjectCommand({ Bucket: getServerEnv().R2_BUCKET, Key: key }));
}

const S3_DELETE_BATCH = 1000;

export async function deleteObjects(keys: string[]): Promise<void> {
  keys.forEach(assertOwnKey);
  for (let i = 0; i < keys.length; i += S3_DELETE_BATCH) {
    const batch = keys.slice(i, i + S3_DELETE_BATCH);
    await getClient().send(
      new DeleteObjectsCommand({
        Bucket: getServerEnv().R2_BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
}

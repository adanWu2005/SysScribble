'use client';

import {
  ALLOWED_UPLOAD_MIME,
  MAX_UPLOAD_BYTES,
  allowedUploadMimeSchema,
  type UploadUrlResponse,
} from '@wb/shared';
import { Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import type * as Y from 'yjs';
import { ApiClientError, apiFetch } from '@/lib/fetcher';
import { addShape, newShapeId } from '@/lib/whiteboard/model';
import { ToolButton } from './Toolbar';

const MAX_PLACED_SIZE = 480;

interface UploadButtonProps {
  roomId: string;
  doc: Y.Doc;
  placeAt: () => { x: number; y: number };
}

function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Not a readable image'));
    };
    image.src = url;
  });
}

/** Bytes go straight to R2. Only the asset id enters the shared document (PRD §3.4). */
export function UploadButton({ roomId, doc, placeAt }: UploadButtonProps) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'uploading'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);

    const mime = allowedUploadMimeSchema.safeParse(file.type);
    if (!mime.success) {
      setError('Only PNG, JPEG, WebP and PDF files are allowed.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('Files can be at most 10 MB.');
      return;
    }

    setState('uploading');
    let assetId: string | null = null;
    try {
      const size = mime.data === 'application/pdf' ? null : await imageSize(file);
      const slot = await apiFetch<UploadUrlResponse>(`/api/rooms/${roomId}/upload-url`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, contentType: mime.data, sizeBytes: file.size }),
      });
      assetId = slot.assetId;

      // The browser sets Content-Length itself, to the signed value.
      const put = await fetch(slot.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mime.data },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);

      const { x, y } = placeAt();
      if (size) {
        const ratio = Math.min(1, MAX_PLACED_SIZE / Math.max(size.width, size.height));
        addShape(doc, {
          id: newShapeId(),
          type: 'image',
          x,
          y,
          rotation: 0,
          width: size.width * ratio,
          height: size.height * ratio,
          assetId,
        });
      } else {
        addShape(doc, {
          id: newShapeId(),
          type: 'file',
          x,
          y,
          rotation: 0,
          width: 180,
          height: 90,
          assetId,
          filename: file.name.slice(0, 200),
        });
      }
    } catch (err) {
      // Release the reservation, or the failed upload counts against the quota forever.
      if (assetId) {
        await apiFetch(`/api/rooms/${roomId}/assets/${assetId}`, { method: 'DELETE' }).catch(() => undefined);
      }
      setError(err instanceof ApiClientError ? err.message : 'The upload failed.');
    } finally {
      setState('idle');
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept={ALLOWED_UPLOAD_MIME.join(',')}
        onChange={(event) => void onChange(event)}
      />
      <ToolButton
        label={state === 'uploading' ? 'Uploading…' : 'Upload image or PDF'}
        disabled={state === 'uploading'}
        onClick={() => input.current?.click()}
      >
        <Upload size={17} aria-hidden />
      </ToolButton>
      {error ? (
        <span role="alert" className="self-center px-2 text-sm text-red-600">
          {error}
        </span>
      ) : null}
    </>
  );
}

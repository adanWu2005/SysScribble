'use client';

import type { Shape } from '@wb/shared';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useEffect, useState } from 'react';
import { Image as KonvaImage, Rect } from 'react-konva';
import { apiFetch } from '@/lib/fetcher';

type ImageShape = Extract<Shape, { type: 'image' }>;

/**
 * Loaded pictures, so one that scrolls out of view (it is not mounted while culled) and back does
 * not ask the API for a new link and download again. Bounded; the oldest goes first.
 */
const MAX_CACHED_IMAGES = 64;
const imageCache = new Map<string, HTMLImageElement>();

function remember(key: string, element: HTMLImageElement): void {
  imageCache.delete(key);
  imageCache.set(key, element);
  const oldest = imageCache.keys().next();
  if (imageCache.size > MAX_CACHED_IMAGES && !oldest.done) imageCache.delete(oldest.value);
}

interface ImageNodeProps {
  roomId: string;
  shape: ImageShape;
  id: string;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  listening: boolean;
  draggable: boolean;
  onMouseDown: (event: KonvaEventObject<MouseEvent>) => void;
  onTap: (event: KonvaEventObject<Event>) => void;
  onDragStart: () => void;
  onDragMove: (event: KonvaEventObject<DragEvent>) => void;
  onDragEnd: (event: KonvaEventObject<DragEvent>) => void;
}

/** Only the asset id is shared. Each viewer asks the API, which checks membership first. */
export function ImageNode({ roomId, shape, ...node }: ImageNodeProps) {
  const cacheKey = `${roomId}/${shape.assetId}`;
  const [image, setImage] = useState<HTMLImageElement | null>(() => imageCache.get(cacheKey) ?? null);

  useEffect(() => {
    if (imageCache.has(cacheKey)) return undefined;
    let active = true;
    apiFetch<{ url: string }>(`/api/rooms/${roomId}/assets/${shape.assetId}`)
      .then(({ url }) => {
        const element = new window.Image();
        element.crossOrigin = 'anonymous';
        element.onload = () => {
          remember(cacheKey, element);
          if (active) setImage(element);
        };
        element.src = url;
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [roomId, shape.assetId, cacheKey]);

  if (!image) return <Rect {...node} width={shape.width} height={shape.height} fill="#e5e7eb" />;
  return <KonvaImage {...node} image={image} width={shape.width} height={shape.height} />;
}

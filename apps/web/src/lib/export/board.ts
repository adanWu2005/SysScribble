import type { Shape } from '@wb/shared';
import { MAX_UPLOAD_BYTES } from '@wb/shared';
import { boardToSvg, pickPixelRatio, type SvgResult } from './svg';

/** Browser-side steps that turn the live board into a file. The drawing itself is in svg.ts. */

const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);
/** Embedding images inflates the file. Past this much they are left as placeholders. */
const MAX_EMBEDDED_BYTES = 40 * 1024 * 1024;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('unreadable')));
    reader.onerror = () => reject(new Error('unreadable'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Downloads one image and returns it as a `data:` URI. Only PNG, JPEG and WebP are accepted, by
 * the type the server reports, so a hostile file can never end up in the export as something else.
 */
async function fetchImageDataUri(url: string): Promise<{ uri: string; bytes: number } | null> {
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!IMAGE_TYPES.has(blob.type) || blob.size > MAX_UPLOAD_BYTES) return null;
    return { uri: await readAsDataUrl(blob), bytes: blob.size };
  } catch {
    return null;
  }
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Text width from a real canvas, so wrapping matches what the font will draw. */
function measureText(text: string, fontSize: number): number {
  if (measureContext === undefined) measureContext = document.createElement('canvas').getContext('2d');
  if (!measureContext) return Array.from(text).length * fontSize * 0.55;
  measureContext.font = `${fontSize}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  return measureContext.measureText(text).width;
}

export interface PreparedBoard extends SvgResult {
  /** Images that could not be embedded and are drawn as placeholders. */
  missingImages: number;
}

/** Builds the SVG for the board, fetching and embedding its images. Null for an empty board. */
export async function prepareBoardExport(
  shapes: readonly Shape[],
  fetchAssetUrl: (assetId: string) => Promise<string>,
): Promise<PreparedBoard | null> {
  const assetIds = Array.from(
    new Set(shapes.flatMap((shape) => (shape.type === 'image' ? [shape.assetId] : []))),
  );

  const images = new Map<string, string>();
  let budget = MAX_EMBEDDED_BYTES;
  let missing = 0;
  // One at a time keeps memory flat. The budget is checked before each download is kept.
  for (const assetId of assetIds) {
    try {
      const found = budget > 0 ? await fetchImageDataUri(await fetchAssetUrl(assetId)) : null;
      if (found && found.bytes <= budget) {
        images.set(assetId, found.uri);
        budget -= found.bytes;
      } else {
        missing += 1;
      }
    } catch {
      missing += 1;
    }
  }

  const result = boardToSvg(shapes, { images, measureText });
  return result ? { ...result, missingImages: missing } : null;
}

/** Draws an SVG into a canvas and returns it as a PNG. Larger boards get a lower resolution. */
export async function svgToPng(svg: string, width: number, height: number, wantedRatio = 2): Promise<Blob> {
  const ratio = pickPixelRatio(width, height, wantedRatio);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.width = width;
    image.height = height;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The board could not be drawn.'));
      image.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot draw the image.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be saved.'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

import type { Shape } from '@wb/shared';
import { arrowEndpoints, shapeBounds, unionBounds, type Box } from '@/lib/whiteboard/geometry';

/**
 * Draws the whiteboard as an SVG string. PNG export rasterizes this same SVG, so the two always
 * match, and a history preview uses it too.
 *
 * Everything in the output comes from validated shape data, and every piece of text goes through
 * `escapeXml`, so a shape's label can never become markup. The output has no script, no
 * foreignObject and no external reference: images are embedded as data URIs we built ourselves.
 */

export interface SvgOptions {
  /** Image bytes by asset id, as `data:` URIs. A missing image is drawn as a grey placeholder. */
  images?: ReadonlyMap<string, string>;
  /** Width of a piece of text in pixels. The browser passes a canvas measure. */
  measureText?: (text: string, fontSize: number) => number;
  /** Space around the content. */
  padding?: number;
  /** A fill behind everything. Null leaves the background transparent. */
  background?: string | null;
}

export interface SvgResult {
  svg: string;
  width: number;
  height: number;
}

const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const LINE_HEIGHT = 1.2;
const DEFAULT_PADDING = 40;
const HEX = /^#[0-9a-fA-F]{6}$/;
const DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/** XML 1.0 forbids most control characters, even escaped, so they are removed. */
const ILLEGAL_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

export function escapeXml(text: string): string {
  return text
    .replace(ILLEGAL_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function num(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0';
}

function color(value: string | undefined, fallback: string): string {
  return value !== undefined && HEX.test(value) ? value : fallback;
}

function approxWidth(text: string, fontSize: number): number {
  return Array.from(text).length * fontSize * 0.55;
}

/** Breaks text into lines no wider than `maxWidth`. A word wider than a line is split. */
export function wrapLines(
  text: string,
  maxWidth: number,
  fontSize: number,
  measure: (text: string, fontSize: number) => number = approxWidth,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter((part) => part !== '')) {
      const attempt = line === '' ? word : `${line} ${word}`;
      if (measure(attempt, fontSize) <= maxWidth) {
        line = attempt;
        continue;
      }
      if (line !== '') lines.push(line);
      line = '';
      let rest = word;
      // A single word too wide for the box: cut it where it stops fitting.
      while (rest !== '' && measure(rest, fontSize) > maxWidth) {
        const letters = Array.from(rest);
        // One letter wider than the box cannot be cut any further. It stays on its own line.
        // Without this the loop made no progress and never ended.
        if (letters.length === 1) break;
        let cut = letters.length - 1;
        while (cut > 1 && measure(letters.slice(0, cut).join(''), fontSize) > maxWidth) cut -= 1;
        lines.push(letters.slice(0, cut).join(''));
        rest = letters.slice(cut).join('');
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

interface TextBlock {
  lines: readonly string[];
  fontSize: number;
  fill: string;
  /** Left edge, or the center when `anchor` is middle. */
  x: number;
  top: number;
  anchor: 'start' | 'middle' | 'end';
  extra?: string;
}

function textBlock({ lines, fontSize, fill, x, top, anchor, extra = '' }: TextBlock): string {
  const rows = lines
    .map((line, index) => {
      const y = top + (index + 0.5) * fontSize * LINE_HEIGHT;
      return `<text x="${num(x)}" y="${num(y)}" dominant-baseline="central">${escapeXml(line)}</text>`;
    })
    .join('');
  return `<g font-size="${num(fontSize)}" fill="${fill}" text-anchor="${anchor}"${extra}>${rows}</g>`;
}

function border(shape: { stroke?: string | undefined; strokeWidth?: number | undefined }): string {
  if (!shape.stroke) return '';
  return ` stroke="${color(shape.stroke, '#111827')}" stroke-width="${num(shape.strokeWidth ?? 2)}"`;
}

function groupOpen(shape: Shape): string {
  const opacity = shape.opacity !== undefined && shape.opacity < 1 ? ` opacity="${num(shape.opacity)}"` : '';
  return `<g transform="translate(${num(shape.x)} ${num(shape.y)}) rotate(${num(shape.rotation)})"${opacity}>`;
}

function arrowSvg(shape: Extract<Shape, { type: 'arrow' }>, byId: ReadonlyMap<string, Shape>): string {
  const { start, end } = arrowEndpoints(shape, byId);
  const stroke = color(shape.stroke, '#111827');
  const length = 8 + shape.strokeWidth * 2;
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const half = length / 2;
  const baseX = end.x - Math.cos(angle) * length;
  const baseY = end.y - Math.sin(angle) * length;
  const left = { x: baseX + Math.sin(angle) * half, y: baseY - Math.cos(angle) * half };
  const right = { x: baseX - Math.sin(angle) * half, y: baseY + Math.cos(angle) * half };
  const opacity = shape.opacity !== undefined && shape.opacity < 1 ? ` opacity="${num(shape.opacity)}"` : '';
  return (
    `<g${opacity}>` +
    `<line x1="${num(start.x)}" y1="${num(start.y)}" x2="${num(baseX)}" y2="${num(baseY)}" stroke="${stroke}" stroke-width="${num(shape.strokeWidth)}" stroke-linecap="round"/>` +
    `<polygon points="${num(end.x)},${num(end.y)} ${num(left.x)},${num(left.y)} ${num(right.x)},${num(right.y)}" fill="${stroke}"/>` +
    `</g>`
  );
}

function shapeSvg(shape: Shape, byId: ReadonlyMap<string, Shape>, options: SvgOptions): string {
  const measure = options.measureText ?? approxWidth;

  switch (shape.type) {
    case 'rect': {
      const label = shape.text
        ? textLabel(shape.text, shape.width, shape.height, 16, 8, measure, 0, 0)
        : '';
      return `${groupOpen(shape)}<rect width="${num(shape.width)}" height="${num(shape.height)}" fill="${color(shape.fill, '#ffffff')}"${border(shape)}/>${label}</g>`;
    }
    case 'ellipse': {
      const label = shape.text
        ? textLabel(shape.text, shape.width, shape.height, 16, 8, measure, -shape.width / 2, -shape.height / 2)
        : '';
      return `${groupOpen(shape)}<ellipse rx="${num(shape.width / 2)}" ry="${num(shape.height / 2)}" fill="${color(shape.fill, '#ffffff')}"${border(shape)}/>${label}</g>`;
    }
    case 'sticky': {
      const inner = Math.max(1, shape.width - 20);
      const lines = wrapLines(shape.text, inner, 14, measure);
      const body = textBlock({ lines, fontSize: 14, fill: '#1f2937', x: 10, top: 10, anchor: 'start' });
      const author = shape.authorName
        ? textBlock({
            lines: [shape.authorName],
            fontSize: 10,
            fill: '#1f2937',
            x: shape.width - 10,
            top: shape.height - 22,
            anchor: 'end',
            extra: ' opacity="0.5"',
          })
        : '';
      return `${groupOpen(shape)}<rect width="${num(shape.width)}" height="${num(shape.height)}" rx="4" fill="${color(shape.fill, '#fde68a')}"${border(shape)}/>${body}${author}</g>`;
    }
    case 'text': {
      const lines = shape.width !== undefined ? wrapLines(shape.text, shape.width, shape.fontSize, measure) : shape.text.split('\n');
      return `${groupOpen(shape)}${textBlock({ lines, fontSize: shape.fontSize, fill: color(shape.fill, '#111827'), x: 0, top: 0, anchor: 'start' })}</g>`;
    }
    case 'path': {
      const stroke = color(shape.stroke, '#111827');
      if (shape.points.length < 4) {
        return `${groupOpen(shape)}<circle cx="${num(shape.points[0] ?? 0)}" cy="${num(shape.points[1] ?? 0)}" r="${num(shape.strokeWidth / 2)}" fill="${stroke}"/></g>`;
      }
      const points: string[] = [];
      for (let i = 0; i + 1 < shape.points.length; i += 2) {
        points.push(`${num(shape.points[i] ?? 0)},${num(shape.points[i + 1] ?? 0)}`);
      }
      return `${groupOpen(shape)}<polyline points="${points.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${num(shape.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
    }
    case 'arrow':
      return arrowSvg(shape, byId);
    case 'image': {
      const data = options.images?.get(shape.assetId);
      if (data !== undefined && DATA_IMAGE.test(data)) {
        return `${groupOpen(shape)}<image href="${data}" width="${num(shape.width)}" height="${num(shape.height)}" preserveAspectRatio="none"/></g>`;
      }
      const note = textBlock({
        lines: ['Image unavailable'],
        fontSize: 12,
        fill: '#6b7280',
        x: shape.width / 2,
        top: shape.height / 2 - 8,
        anchor: 'middle',
      });
      return `${groupOpen(shape)}<rect width="${num(shape.width)}" height="${num(shape.height)}" fill="#e5e7eb"/>${note}</g>`;
    }
    case 'file': {
      const lines = ['PDF', ...wrapLines(shape.filename, Math.max(1, shape.width - 20), 13, measure)];
      const body = textBlock({ lines, fontSize: 13, fill: '#1f2937', x: 10, top: 10, anchor: 'start' });
      return `${groupOpen(shape)}<rect width="${num(shape.width)}" height="${num(shape.height)}" rx="4" fill="#fecaca"/>${body}</g>`;
    }
  }
}

/** A label centered in a box, as rect and ellipse shapes draw theirs. */
function textLabel(
  text: string,
  width: number,
  height: number,
  fontSize: number,
  padding: number,
  measure: (text: string, fontSize: number) => number,
  originX: number,
  originY: number,
): string {
  const lines = wrapLines(text, Math.max(1, width - padding * 2), fontSize, measure);
  const blockHeight = lines.length * fontSize * LINE_HEIGHT;
  return textBlock({
    lines,
    fontSize,
    fill: '#1f2937',
    x: originX + width / 2,
    top: originY + Math.max(padding, (height - blockHeight) / 2),
    anchor: 'middle',
  });
}

/** The box that holds every shape. Null for an empty board. */
export function contentBounds(shapes: readonly Shape[]): Box | null {
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  return unionBounds(
    shapes.map((shape) => {
      if (shape.type !== 'arrow') return shapeBounds(shape);
      // An attached arrow's ends are on its shapes, so its free points can be stale.
      const { start, end } = arrowEndpoints(shape, byId);
      return {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      };
    }),
  );
}

/** Null when there is nothing to draw. */
export function boardToSvg(shapes: readonly Shape[], options: SvgOptions = {}): SvgResult | null {
  const bounds = contentBounds(shapes);
  if (!bounds) return null;

  const padding = options.padding ?? DEFAULT_PADDING;
  const x = Math.floor(bounds.x - padding);
  const y = Math.floor(bounds.y - padding);
  const width = Math.max(1, Math.ceil(bounds.width + padding * 2));
  const height = Math.max(1, Math.ceil(bounds.height + padding * 2));
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));

  const background = options.background === undefined ? '#ffffff' : options.background;
  const backdrop =
    background === null
      ? ''
      : `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color(background, '#ffffff')}"/>`;
  const body = shapes.map((shape) => shapeSvg(shape, byId, options)).join('');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}" font-family='${FONT}'>` +
    `${backdrop}${body}</svg>`;
  return { svg, width, height };
}

/**
 * The pixel ratio for a PNG. It aims for `wanted`, and backs off so the canvas stays inside what
 * browsers can allocate. A board scattered across a huge area gets a lower ratio, not a blank file.
 */
export function pickPixelRatio(width: number, height: number, wanted = 2, maxSide = 8192, maxPixels = 40_000_000): number {
  if (width <= 0 || height <= 0) return 1;
  const bySide = maxSide / Math.max(width, height);
  const byArea = Math.sqrt(maxPixels / (width * height));
  return Math.max(0.05, Math.min(wanted, bySide, byArea));
}

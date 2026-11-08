// @vitest-environment jsdom
import type { Shape } from '@wb/shared';
import { describe, expect, it } from 'vitest';
import { boardToSvg, contentBounds, escapeXml, pickPixelRatio, wrapLines } from '@/lib/export/svg';

const base = { rotation: 0 };
const rect = (id: string, x = 0, y = 0, extra: Partial<Shape> = {}): Shape =>
  ({ ...base, id, type: 'rect', x, y, width: 100, height: 50, fill: '#93c5fd', ...extra }) as Shape;
const ASSET = '0c5d7e8f-1234-4abc-9def-0123456789ab';

function parse(svg: string): Document {
  return new DOMParser().parseFromString(svg, 'image/svg+xml');
}

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('boardToSvg', () => {
  it('returns nothing for an empty board', () => {
    expect(boardToSvg([])).toBeNull();
  });

  it('sizes the picture to the content plus padding, and produces well-formed XML', () => {
    const result = boardToSvg([rect('a', 10, 20)], { padding: 40 });
    expect(result).not.toBeNull();
    expect(result?.width).toBe(180);
    expect(result?.height).toBe(130);
    const doc = parse(result?.svg ?? '');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.getAttribute('viewBox')).toBe('-30 -20 180 130');
  });

  it('draws a white background unless told otherwise', () => {
    expect(boardToSvg([rect('a')])?.svg).toContain('fill="#ffffff"');
    const clear = boardToSvg([rect('a')], { background: null })?.svg ?? '';
    expect(clear).not.toContain('fill="#ffffff"');
  });

  it('draws each shape type', () => {
    const shapes: Shape[] = [
      rect('r'),
      { ...base, id: 'e', type: 'ellipse', x: 200, y: 0, width: 80, height: 40, fill: '#86efac' },
      { ...base, id: 's', type: 'sticky', x: 0, y: 100, width: 160, height: 160, fill: '#fde68a', text: 'Hello', authorName: 'Ada' },
      { ...base, id: 't', type: 'text', x: 300, y: 0, text: 'Plain', fontSize: 20, fill: '#111827' },
      { ...base, id: 'p', type: 'path', x: 0, y: 300, points: [0, 0, 10, 10, 20, 0], stroke: '#111827', strokeWidth: 3 },
      { ...base, id: 'f', type: 'file', x: 0, y: 400, width: 180, height: 90, assetId: ASSET, filename: 'plan.pdf' },
    ];
    const doc = parse(boardToSvg(shapes)?.svg ?? '');
    expect(doc.querySelector('parsererror')).toBeNull();
    for (const tag of ['rect', 'ellipse', 'polyline', 'text']) expect(doc.querySelector(tag)).not.toBeNull();
    const text = doc.documentElement.textContent ?? '';
    for (const word of ['Hello', 'Ada', 'Plain', 'PDF', 'plan.pdf']) expect(text).toContain(word);
  });

  it('applies position, rotation and opacity', () => {
    const svg = boardToSvg([rect('a', 10, 20, { rotation: 30, opacity: 0.5 })])?.svg ?? '';
    expect(svg).toContain('translate(10 20) rotate(30)');
    expect(svg).toContain('opacity="0.5"');
  });

  it('draws a border only when one is set', () => {
    expect(boardToSvg([rect('a')])?.svg).not.toContain('stroke=');
    expect(boardToSvg([rect('a', 0, 0, { stroke: '#dc2626', strokeWidth: 4 })])?.svg).toContain('stroke="#dc2626" stroke-width="4"');
  });

  it('puts the ends of a connector on the shapes it joins', () => {
    const a = rect('a', 0, 0);
    const b = rect('b', 300, 0);
    const arrow: Shape = {
      ...base,
      id: 'link',
      type: 'arrow',
      x: 0,
      y: 0,
      points: [0, 0, 1, 1],
      stroke: '#111827',
      strokeWidth: 3,
      startShapeId: 'a',
      endShapeId: 'b',
    };
    const doc = parse(boardToSvg([a, b, arrow])?.svg ?? '');
    const line = doc.querySelector('line');
    expect(Number(line?.getAttribute('x1'))).toBeCloseTo(100);
    expect(doc.querySelector('polygon')).not.toBeNull();
  });

  it('includes an attached connector in the bounds even when its free points are stale', () => {
    const arrow: Shape = {
      ...base,
      id: 'link',
      type: 'arrow',
      x: 0,
      y: 0,
      points: [0, 0, 1, 1],
      stroke: '#111827',
      strokeWidth: 3,
      startShapeId: 'a',
      endShapeId: 'b',
    };
    const bounds = contentBounds([rect('a', 0, 0), rect('b', 500, 0), arrow]);
    expect(bounds?.width).toBe(600);
  });
});

describe('boardToSvg and hostile input', () => {
  const attack = '</text><script>alert(1)</script><foreignObject><iframe src="https://evil.test"></iframe></foreignObject>"\'&';

  function assertInert(svg: string) {
    const doc = parse(svg);
    expect(doc.querySelector('parsererror')).toBeNull();
    for (const tag of ['script', 'foreignObject', 'iframe', 'style', 'a', 'use']) {
      expect(doc.getElementsByTagName(tag)).toHaveLength(0);
    }
    expect(svg).not.toMatch(/<script|<foreignObject|<iframe|javascript:|onload=|onerror=/i);
    for (const element of Array.from(doc.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) expect(attribute.name.toLowerCase().startsWith('on')).toBe(false);
    }
  }

  it.each([
    ['sticky text', { ...base, id: 's', type: 'sticky', x: 0, y: 0, width: 160, height: 160, fill: '#fde68a', text: attack } as Shape],
    ['sticky author', { ...base, id: 's', type: 'sticky', x: 0, y: 0, width: 160, height: 160, fill: '#fde68a', text: 'x', authorName: attack } as Shape],
    ['rect label', rect('r', 0, 0, { text: attack })],
    ['free text', { ...base, id: 't', type: 'text', x: 0, y: 0, text: attack, fontSize: 20, fill: '#111827' } as Shape],
    ['pdf file name', { ...base, id: 'f', type: 'file', x: 0, y: 0, width: 180, height: 90, assetId: ASSET, filename: attack } as Shape],
  ])('keeps hostile %s as plain text', (_name, shape) => {
    const result = boardToSvg([shape]);
    assertInert(result?.svg ?? '');
    // The words survive as text. They simply never became elements.
    expect(parse(result?.svg ?? '').documentElement.textContent).toContain('alert(1)');
  });

  it('drops characters XML forbids, so the file still parses', () => {
    const svg = boardToSvg([{ ...base, id: 't', type: 'text', x: 0, y: 0, text: 'a\u0000b\u0008c￾d', fontSize: 20, fill: '#111827' } as Shape])?.svg ?? '';
    expect(parse(svg).querySelector('parsererror')).toBeNull();
    expect(parse(svg).documentElement.textContent).toContain('abcd');
  });

  it('refuses a color that is not a plain hex value', () => {
    const svg =
      boardToSvg([rect('a', 0, 0, { fill: 'url(javascript:alert(1))' as unknown as string, stroke: '" onload="alert(1)' })])?.svg ?? '';
    assertInert(svg);
    expect(svg).toContain('fill="#ffffff"');
  });

  it('embeds only PNG, JPEG and WebP data URIs, and shows a placeholder for anything else', () => {
    const image: Shape = { ...base, id: 'i', type: 'image', x: 0, y: 0, width: 50, height: 50, assetId: ASSET };
    expect(boardToSvg([image], { images: new Map([[ASSET, PNG]]) })?.svg).toContain(`href="${PNG}"`);

    for (const bad of [
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'javascript:alert(1)',
      'https://evil.test/x.png',
      `${PNG}" onload="alert(1)`,
      'data:text/html;base64,PHNjcmlwdD4=',
    ]) {
      const svg = boardToSvg([image], { images: new Map([[ASSET, bad]]) })?.svg ?? '';
      expect(svg).not.toContain('<image');
      expect(svg).toContain('Image unavailable');
      assertInert(svg);
    }
  });

  it('shows a placeholder for an image whose bytes were never fetched', () => {
    const image: Shape = { ...base, id: 'i', type: 'image', x: 0, y: 0, width: 50, height: 50, assetId: ASSET };
    expect(boardToSvg([image])?.svg).toContain('Image unavailable');
  });
});

describe('escapeXml', () => {
  it('escapes the five XML characters and drops forbidden ones', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
    expect(escapeXml('a\u0000b')).toBe('ab');
  });
});

describe('wrapLines', () => {
  const measure = (text: string) => text.length * 10;

  it('breaks at spaces to fit', () => {
    expect(wrapLines('one two three four', 90, 16, measure)).toEqual(['one two', 'three', 'four']);
  });

  it('keeps explicit line breaks and blank lines', () => {
    expect(wrapLines('a\n\nb', 100, 16, measure)).toEqual(['a', '', 'b']);
  });

  it('splits a word that is wider than the box', () => {
    const lines = wrapLines('abcdefghijklmnop', 50, 16, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('abcdefghijklmnop');
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(50);
  });

  it('terminates on a box too narrow for any letter', () => {
    expect(wrapLines('abc', 1, 16, measure).join('')).toBe('abc');
  });

  it('returns one empty line for empty text', () => {
    expect(wrapLines('', 100, 16, measure)).toEqual(['']);
  });
});

describe('pickPixelRatio', () => {
  it('uses the wanted ratio for a normal board', () => {
    expect(pickPixelRatio(1000, 800)).toBe(2);
  });

  it('backs off for a very large board, but never to nothing', () => {
    const ratio = pickPixelRatio(20_000, 15_000);
    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeGreaterThan(0);
    expect(20_000 * ratio).toBeLessThanOrEqual(8192);
    expect(20_000 * ratio * 15_000 * ratio).toBeLessThanOrEqual(40_000_000);
  });

  it('copes with a degenerate size', () => {
    expect(pickPixelRatio(0, 0)).toBe(1);
  });
});

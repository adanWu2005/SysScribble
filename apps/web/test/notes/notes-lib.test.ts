import type { Shape } from '@wb/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { clampSplit, DEFAULT_PREFS, parsePrefs, serializePrefs, splitFromPointer } from '@/lib/layout/prefs';
import {
  cleanLabel,
  describeShape,
  isShapeId,
  MAX_REF_LABEL,
  parseShapeHash,
  shapeLink,
} from '@/lib/notes/shapeRef';
import { SLASH_ITEMS, filterSlashItems, matchSlashTrigger } from '@/lib/notes/slash';
import { MAX_NOTES_TITLE, readNotesTitle, writeNotesTitle } from '@/lib/notes/title';

const ROOM = '2b9a3796-82a5-4c6f-b3ed-1da00920749b';
const SHAPE = '0c5d7e8f-1234-4abc-9def-0123456789ab';

describe('shape ids', () => {
  it('accepts ids a collaborator could plausibly write', () => {
    for (const id of [SHAPE, 'a', 'abc_DEF-123', 'x'.repeat(64)]) expect(isShapeId(id)).toBe(true);
  });

  it('rejects anything that could carry markup or a path', () => {
    for (const id of ['', 'x'.repeat(65), 'a b', 'a"b', '<x>', 'a/b', '../a', 'a;b', 'a&b=1', 7, null, undefined]) {
      expect(isShapeId(id)).toBe(false);
    }
  });
});

describe('shape links', () => {
  it('builds a link with the id in the fragment', () => {
    expect(shapeLink('http://localhost:3000', ROOM, SHAPE)).toBe(`http://localhost:3000/rooms/${ROOM}#shape=${SHAPE}`);
  });

  it('reads the id back out of a hash', () => {
    expect(parseShapeHash(`#shape=${SHAPE}`)).toBe(SHAPE);
  });

  it.each(['', '#', '#shape=', '#other=abc', '#shape=a%20b', '#shape=a&x=1', '#shape=%E0%A4%A', '#shape=<script>', 'shape=abc'])(
    'ignores the hash %j',
    (hash) => {
      expect(parseShapeHash(hash)).toBeNull();
    },
  );
});

describe('describing a shape', () => {
  const base = { id: 's', x: 0, y: 0, rotation: 0 };

  it('names the kind, plus a snippet of any text', () => {
    const rect: Shape = { ...base, type: 'rect', width: 1, height: 1, fill: '#ffffff' };
    expect(describeShape(rect)).toBe('Rectangle');
    expect(describeShape({ ...rect, text: '  Launch   plan ' })).toBe('Rectangle: Launch plan');
    const sticky: Shape = { ...base, type: 'sticky', width: 1, height: 1, fill: '#fde68a', text: 'Buy milk' };
    expect(describeShape(sticky)).toBe('Sticky note: Buy milk');
    const path: Shape = { ...base, type: 'path', points: [], stroke: '#111827', strokeWidth: 3 };
    expect(describeShape(path)).toBe('Drawing');
  });

  it('clips a long snippet with an ellipsis', () => {
    const sticky: Shape = { ...base, type: 'sticky', width: 1, height: 1, fill: '#fde68a', text: 'x'.repeat(100) };
    const label = describeShape(sticky);
    expect(label.endsWith('…')).toBe(true);
    expect(Array.from(label).length).toBeLessThan(70);
  });

  it('uses the file name for a PDF', () => {
    const file: Shape = { ...base, type: 'file', width: 1, height: 1, assetId: SHAPE.replace(/^0/, '1'), filename: 'plan.pdf' };
    expect(describeShape(file)).toBe('PDF: plan.pdf');
  });

  it('cleans an untrusted label', () => {
    expect(cleanLabel(undefined)).toBe('Shape');
    expect(cleanLabel(42)).toBe('Shape');
    expect(cleanLabel('   ')).toBe('Shape');
    expect(cleanLabel('a\u0000b\nc')).toBe('a b c');
    expect(Array.from(cleanLabel('é'.repeat(200))).length).toBe(MAX_REF_LABEL);
  });
});

describe('slash menu', () => {
  it('offers the eight commands from the spec', () => {
    expect(SLASH_ITEMS.map((item) => item.id)).toEqual(['h1', 'h2', 'h3', 'bullet', 'task', 'code', 'callout', 'divider']);
  });

  it.each([
    ['/', '', 1],
    ['/he', 'he', 3],
    ['hello /task', 'task', 5],
    ['a\t/c', 'c', 2],
  ])('opens for %j', (text, query, length) => {
    expect(matchSlashTrigger(text)).toEqual({ query, length });
  });

  it.each(['', 'hello', 'and/or', 'https://example.com', 'a/b', '/ two words', '//', 'x /a b'])('does not open for %j', (text) => {
    expect(matchSlashTrigger(text)).toBeNull();
  });

  it('lists everything for an empty query', () => {
    expect(filterSlashItems('')).toHaveLength(SLASH_ITEMS.length);
  });

  it('narrows by name, by keyword and by part of a name', () => {
    expect(filterSlashItems('head').map((i) => i.id)).toEqual(['h1', 'h2', 'h3']);
    expect(filterSlashItems('todo').map((i) => i.id)).toEqual(['task']);
    expect(filterSlashItems('hr').map((i) => i.id)).toEqual(['divider']);
    expect(filterSlashItems('list').map((i) => i.id)).toContain('bullet');
  });

  it('ranks names that start with the query first', () => {
    expect(filterSlashItems('c').map((i) => i.id).slice(0, 2)).toEqual(['code', 'callout']);
  });

  it('is case-insensitive and finds nothing for nonsense', () => {
    expect(filterSlashItems('CODE')[0]?.id).toBe('code');
    expect(filterSlashItems('zzzz')).toEqual([]);
  });
});

describe('layout preferences', () => {
  it('falls back to the default for missing or broken storage', () => {
    for (const raw of [null, '', 'not json', '[]', '7', 'null']) expect(parsePrefs(raw)).toEqual(DEFAULT_PREFS);
  });

  it('reads valid values and repairs bad fields one at a time', () => {
    expect(parsePrefs('{"mode":"canvas","split":0.55}')).toEqual({ mode: 'canvas', split: 0.55 });
    expect(parsePrefs('{"mode":"bogus","split":0.55}')).toEqual({ mode: 'split', split: 0.55 });
    expect(parsePrefs('{"mode":"notes","split":"wide"}')).toEqual({ mode: 'notes', split: DEFAULT_PREFS.split });
    expect(parsePrefs('{"mode":"notes","split":9}')).toEqual({ mode: 'notes', split: 0.8 });
  });

  it('round-trips', () => {
    const prefs = { mode: 'notes' as const, split: 0.3 };
    expect(parsePrefs(serializePrefs(prefs))).toEqual(prefs);
  });

  it('clamps the split and tolerates garbage', () => {
    expect(clampSplit(0)).toBe(0.2);
    expect(clampSplit(1)).toBe(0.8);
    expect(clampSplit(Number.NaN)).toBe(DEFAULT_PREFS.split);
    expect(clampSplit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PREFS.split);
  });

  it('follows the pointer inside the container', () => {
    expect(splitFromPointer(500, 100, 1000)).toBeCloseTo(0.4);
  });

  it('keeps both panes usable at the extremes', () => {
    const left = splitFromPointer(0, 0, 1000);
    const right = splitFromPointer(5000, 0, 1000);
    expect(left * 1000).toBeGreaterThanOrEqual(280);
    expect((1 - right) * 1000).toBeGreaterThanOrEqual(320);
  });

  it('falls back to the middle when the window is too narrow for both panes', () => {
    expect(splitFromPointer(100, 0, 500)).toBe(0.5);
    expect(splitFromPointer(100, 0, 0)).toBe(DEFAULT_PREFS.split);
  });
});

describe('notes title', () => {
  it('is empty until someone writes one', () => {
    expect(readNotesTitle(new Y.Doc())).toBe('');
  });

  it('is shared through the document', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    writeNotesTitle(a, 'Sprint notes');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readNotesTitle(b)).toBe('Sprint notes');
  });

  it('keeps a title to one line and a sane length', () => {
    const doc = new Y.Doc();
    writeNotesTitle(doc, 'one\ntwo\u0000three');
    expect(readNotesTitle(doc)).toBe('one two three');
    writeNotesTitle(doc, 'x'.repeat(1000));
    expect(readNotesTitle(doc)).toHaveLength(MAX_NOTES_TITLE);
  });

  it('ignores a title a collaborator wrote with the wrong type', () => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('notesTitle', { evil: true });
    expect(readNotesTitle(doc)).toBe('');
    doc.getMap('meta').set('notesTitle', 42);
    expect(readNotesTitle(doc)).toBe('');
  });
});

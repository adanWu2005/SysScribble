import { describe, expect, it } from 'vitest';
import { keyToAction, type KeyInfo } from '@/lib/whiteboard/shortcuts';

function key(k: string, mods: Partial<KeyInfo> = {}): KeyInfo {
  return { key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

const editor = { canEdit: true };
const viewer = { canEdit: false };

describe('board shortcuts', () => {
  it('maps the tool keys', () => {
    expect(keyToAction(key('v'), editor)).toEqual({ type: 'tool', tool: 'select' });
    expect(keyToAction(key('r'), editor)).toEqual({ type: 'tool', tool: 'rect' });
    expect(keyToAction(key('o'), editor)).toEqual({ type: 'tool', tool: 'ellipse' });
    expect(keyToAction(key('s'), editor)).toEqual({ type: 'tool', tool: 'sticky' });
    expect(keyToAction(key('p'), editor)).toEqual({ type: 'tool', tool: 'pen' });
    expect(keyToAction(key('a'), editor)).toEqual({ type: 'tool', tool: 'arrow' });
    expect(keyToAction(key('t'), editor)).toEqual({ type: 'tool', tool: 'text' });
    expect(keyToAction(key('l'), editor)).toEqual({ type: 'tool', tool: 'laser' });
    expect(keyToAction(key('R'), editor)).toEqual({ type: 'tool', tool: 'rect' });
  });

  it('maps delete and escape', () => {
    expect(keyToAction(key('Backspace'), editor)).toEqual({ type: 'delete' });
    expect(keyToAction(key('Delete'), editor)).toEqual({ type: 'delete' });
    expect(keyToAction(key('Escape'), editor)).toEqual({ type: 'escape' });
  });

  it('distinguishes undo from redo on both modifier keys', () => {
    expect(keyToAction(key('z', { ctrlKey: true }), editor)).toEqual({ type: 'undo' });
    expect(keyToAction(key('z', { metaKey: true }), editor)).toEqual({ type: 'undo' });
    expect(keyToAction(key('z', { ctrlKey: true, shiftKey: true }), editor)).toEqual({ type: 'redo' });
    expect(keyToAction(key('Z', { metaKey: true, shiftKey: true }), editor)).toEqual({ type: 'redo' });
    expect(keyToAction(key('y', { ctrlKey: true }), editor)).toEqual({ type: 'redo' });
  });

  it('maps duplicate, select all and zoom reset', () => {
    expect(keyToAction(key('d', { ctrlKey: true }), editor)).toEqual({ type: 'duplicate' });
    expect(keyToAction(key('a', { ctrlKey: true }), editor)).toEqual({ type: 'selectAll' });
    expect(keyToAction(key('0', { ctrlKey: true }), editor)).toEqual({ type: 'zoomReset' });
  });

  it('ignores unrelated keys and Alt combinations', () => {
    expect(keyToAction(key('x'), editor)).toBeNull();
    expect(keyToAction(key('r', { altKey: true }), editor)).toBeNull();
    expect(keyToAction(key('z', { ctrlKey: true, altKey: true }), editor)).toBeNull();
  });
});

describe('board shortcuts for a viewer', () => {
  it('offers no action that changes the document', () => {
    expect(keyToAction(key('Backspace'), viewer)).toBeNull();
    expect(keyToAction(key('Delete'), viewer)).toBeNull();
    expect(keyToAction(key('z', { ctrlKey: true }), viewer)).toBeNull();
    expect(keyToAction(key('z', { ctrlKey: true, shiftKey: true }), viewer)).toBeNull();
    expect(keyToAction(key('y', { ctrlKey: true }), viewer)).toBeNull();
    expect(keyToAction(key('d', { ctrlKey: true }), viewer)).toBeNull();
    for (const creating of ['r', 'o', 's', 'p', 'a', 't', 'l']) {
      expect(keyToAction(key(creating), viewer)).toBeNull();
    }
  });

  it('still allows local-only actions', () => {
    expect(keyToAction(key('v'), viewer)).toEqual({ type: 'tool', tool: 'select' });
    expect(keyToAction(key('Escape'), viewer)).toEqual({ type: 'escape' });
    expect(keyToAction(key('a', { ctrlKey: true }), viewer)).toEqual({ type: 'selectAll' });
    expect(keyToAction(key('0', { ctrlKey: true }), viewer)).toEqual({ type: 'zoomReset' });
  });
});

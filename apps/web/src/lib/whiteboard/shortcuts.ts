export type Tool = 'select' | 'rect' | 'ellipse' | 'sticky' | 'pen' | 'arrow' | 'text' | 'laser' | 'comment';

export type ShortcutAction =
  | { type: 'tool'; tool: Tool }
  | { type: 'delete' }
  | { type: 'escape' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'duplicate' }
  | { type: 'selectAll' }
  | { type: 'group' }
  | { type: 'ungroup' }
  | { type: 'zoomReset' }
  /** Open the cursor chat box. */
  | { type: 'chat' }
  /** Send reaction number `index` (0 to 4). */
  | { type: 'reaction'; index: number };

export interface KeyInfo {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const TOOL_KEYS: Readonly<Record<string, Tool>> = {
  v: 'select',
  r: 'rect',
  o: 'ellipse',
  s: 'sticky',
  p: 'pen',
  a: 'arrow',
  t: 'text',
  l: 'laser',
  c: 'comment',
};

/**
 * Maps a key press to a board action. A viewer gets only the actions that change nothing in
 * the shared document. This is a convenience, since the server drops a viewer's edits anyway.
 */
export function keyToAction(event: KeyInfo, ctx: { canEdit: boolean }): ShortcutAction | null {
  const key = event.key.toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;

  if (modifier) {
    if (event.altKey) return null;
    switch (key) {
      case 'z':
        return ctx.canEdit ? { type: event.shiftKey ? 'redo' : 'undo' } : null;
      case 'y':
        return ctx.canEdit ? { type: 'redo' } : null;
      case 'd':
        return ctx.canEdit ? { type: 'duplicate' } : null;
      case 'a':
        return { type: 'selectAll' };
      case 'g':
        return ctx.canEdit ? { type: event.shiftKey ? 'ungroup' : 'group' } : null;
      case '0':
        return { type: 'zoomReset' };
      default:
        return null;
    }
  }
  if (event.altKey) return null;

  if (key === 'escape') return { type: 'escape' };
  // Cursor chat and reactions never touch the document, so a viewer may use them.
  if (key === '/') return { type: 'chat' };
  if (key >= '1' && key <= '5' && key.length === 1) return { type: 'reaction', index: Number(key) - 1 };
  if (key === 'backspace' || key === 'delete') return ctx.canEdit ? { type: 'delete' } : null;

  const tool = TOOL_KEYS[key];
  if (!tool) return null;
  if (tool !== 'select' && !ctx.canEdit) return null;
  return { type: 'tool', tool };
}

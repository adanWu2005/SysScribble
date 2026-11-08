import type { BoardCommand } from '@/components/whiteboard/canvasApi';
import type { ViewMode } from '@/lib/layout/prefs';
import type { ThemePref } from '@/lib/theme/theme';
import { TEMPLATES } from '@/lib/whiteboard/templates';
import type { Tool } from '@/lib/whiteboard/shortcuts';
import type { PaletteCommand } from './commands';

export interface PaletteContext {
  canEdit: boolean;
  /** Runs a command on the board, and brings the board into view first if it is hidden. */
  perform: (command: BoardCommand) => void;
  setMode: (mode: ViewMode) => void;
  setTheme: (pref: ThemePref) => void;
  openHistory: () => void;
  openChaos: () => void;
}

const TOOLS: readonly { tool: Tool; title: string; key: string; keywords: string }[] = [
  { tool: 'select', title: 'Select tool', key: 'V', keywords: 'pointer move cursor' },
  { tool: 'rect', title: 'Rectangle tool', key: 'R', keywords: 'box square shape' },
  { tool: 'ellipse', title: 'Ellipse tool', key: 'O', keywords: 'circle oval shape' },
  { tool: 'sticky', title: 'Sticky note tool', key: 'S', keywords: 'note post-it' },
  { tool: 'pen', title: 'Pen tool', key: 'P', keywords: 'draw freehand pencil' },
  { tool: 'arrow', title: 'Arrow tool', key: 'A', keywords: 'connector line' },
  { tool: 'text', title: 'Text tool', key: 'T', keywords: 'label type' },
  { tool: 'comment', title: 'Comment tool', key: 'C', keywords: 'pin note discuss thread' },
  { tool: 'laser', title: 'Laser pointer', key: 'L', keywords: 'point present' },
];

const MODES: readonly { mode: ViewMode; title: string }[] = [
  { mode: 'notes', title: 'Show notes only' },
  { mode: 'split', title: 'Show notes and whiteboard' },
  { mode: 'canvas', title: 'Show whiteboard only' },
];

const THEMES: readonly { pref: ThemePref; title: string }[] = [
  { pref: 'light', title: 'Light theme' },
  { pref: 'dark', title: 'Dark theme' },
  { pref: 'system', title: 'Match system theme' },
];

/**
 * Every action the palette offers. A viewer is only offered what changes nothing in the shared
 * document, matching the keyboard. The server still drops a viewer's edits whatever the UI shows.
 */
export function buildCommands(ctx: PaletteContext): PaletteCommand[] {
  const board = (id: string, title: string, section: string, command: BoardCommand, extra: Partial<PaletteCommand> = {}): PaletteCommand => ({
    id,
    title,
    section,
    run: () => ctx.perform(command),
    ...extra,
  });

  const commands: PaletteCommand[] = [];

  for (const { tool, title, key, keywords } of TOOLS) {
    if (tool !== 'select' && !ctx.canEdit) continue;
    commands.push(board(`tool:${tool}`, title, 'Tools', { type: 'tool', tool }, { shortcut: key, keywords }));
  }

  if (ctx.canEdit) {
    commands.push(
      board('edit:undo', 'Undo', 'Edit', { type: 'undo' }, { shortcut: 'Ctrl+Z' }),
      board('edit:redo', 'Redo', 'Edit', { type: 'redo' }, { shortcut: 'Ctrl+Shift+Z' }),
      board('edit:duplicate', 'Duplicate selection', 'Edit', { type: 'duplicate' }, { shortcut: 'Ctrl+D', keywords: 'copy clone' }),
      board('edit:delete', 'Delete selection', 'Edit', { type: 'delete' }, { shortcut: 'Del', keywords: 'remove' }),
      board('edit:group', 'Group selection', 'Edit', { type: 'group' }, { shortcut: 'Ctrl+G', keywords: 'combine' }),
      board('edit:ungroup', 'Ungroup selection', 'Edit', { type: 'ungroup' }, { shortcut: 'Ctrl+Shift+G', keywords: 'split' }),
    );
  }
  commands.push(board('edit:selectAll', 'Select everything', 'Edit', { type: 'selectAll' }, { shortcut: 'Ctrl+A' }));

  commands.push(board('presence:chat', 'Open cursor chat', 'Presence', { type: 'chat' }, { shortcut: '/', keywords: 'message talk say' }));

  commands.push(
    board('view:fit', 'Zoom to fit everything', 'View', { type: 'fit' }, { keywords: 'show all' }),
    board('view:reset', 'Reset zoom to 100%', 'View', { type: 'zoomReset' }, { shortcut: 'Ctrl+0' }),
  );
  for (const { mode, title } of MODES) {
    commands.push({ id: `layout:${mode}`, title, section: 'Layout', keywords: 'view pane split', run: () => ctx.setMode(mode) });
  }
  for (const { pref, title } of THEMES) {
    commands.push({ id: `theme:${pref}`, title, section: 'Theme', keywords: 'dark light mode appearance night', run: () => ctx.setTheme(pref) });
  }

  if (ctx.canEdit) {
    for (const template of TEMPLATES) {
      commands.push(
        board(`template:${template.id}`, `Insert template: ${template.name}`, 'Templates', { type: 'template', id: template.id }, { keywords: template.description }),
      );
    }
    commands.push({ id: 'room:history', title: 'Open version history', section: 'Room', keywords: 'restore snapshot', run: ctx.openHistory });
  }
  commands.push({ id: 'room:chaos', title: 'Open the Chaos Lab', section: 'Room', keywords: 'latency telemetry ghost offline network', run: ctx.openChaos });

  return commands;
}

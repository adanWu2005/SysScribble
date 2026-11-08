import { describe, expect, it, vi } from 'vitest';
import type { BoardCommand } from '@/components/whiteboard/canvasApi';
import { buildCommands, type PaletteContext } from '@/lib/palette/build';
import { filterCommands } from '@/lib/palette/commands';
import { TEMPLATES } from '@/lib/whiteboard/templates';

function context(canEdit: boolean): PaletteContext & { performed: BoardCommand[] } {
  const performed: BoardCommand[] = [];
  return {
    canEdit,
    performed,
    perform: (command) => void performed.push(command),
    setMode: vi.fn(),
    setTheme: vi.fn(),
    openHistory: vi.fn(),
    openChaos: vi.fn(),
  };
}

describe('palette commands by role', () => {
  it('offers editors the editing tools, groups and every template', () => {
    const ids = buildCommands(context(true)).map((c) => c.id);
    expect(ids).toContain('tool:rect');
    expect(ids).toContain('edit:group');
    expect(ids).toContain('edit:delete');
    expect(ids).toContain('room:history');
    for (const template of TEMPLATES) expect(ids).toContain(`template:${template.id}`);
  });

  it('offers a viewer nothing that changes the shared document', () => {
    const ids = buildCommands(context(false)).map((c) => c.id);
    for (const forbidden of ['tool:rect', 'tool:pen', 'tool:sticky', 'tool:laser', 'edit:undo', 'edit:delete', 'edit:group', 'edit:duplicate', 'room:history']) {
      expect(ids).not.toContain(forbidden);
    }
    expect(ids.some((id) => id.startsWith('template:'))).toBe(false);
    // Looking around is fine.
    expect(ids).toContain('tool:select');
    expect(ids).toContain('view:fit');
    expect(ids).toContain('theme:dark');
    expect(ids).toContain('room:chaos');
  });

  it('has unique ids and a section for every command', () => {
    for (const canEdit of [true, false]) {
      const commands = buildCommands(context(canEdit));
      expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length);
      for (const command of commands) {
        expect(command.title.length).toBeGreaterThan(0);
        expect(command.section.length).toBeGreaterThan(0);
      }
    }
  });

  it('runs the board command it names', () => {
    const ctx = context(true);
    const commands = buildCommands(ctx);
    commands.find((c) => c.id === 'edit:group')?.run();
    commands.find((c) => c.id === 'template:kanban')?.run();
    commands.find((c) => c.id === 'view:fit')?.run();
    expect(ctx.performed).toEqual([{ type: 'group' }, { type: 'template', id: 'kanban' }, { type: 'fit' }]);
  });

  it('switches the theme and layout through the context', () => {
    const ctx = context(false);
    const commands = buildCommands(ctx);
    commands.find((c) => c.id === 'theme:dark')?.run();
    commands.find((c) => c.id === 'layout:canvas')?.run();
    expect(ctx.setTheme).toHaveBeenCalledWith('dark');
    expect(ctx.setMode).toHaveBeenCalledWith('canvas');
  });

  it('finds things the way a person would ask', () => {
    const commands = buildCommands(context(true));
    expect(filterCommands('dark', commands)[0]?.id).toBe('theme:dark');
    expect(filterCommands('kanban', commands)[0]?.id).toBe('template:kanban');
    expect(filterCommands('group', commands).map((c) => c.id)).toContain('edit:group');
    expect(filterCommands('circle', commands)[0]?.id).toBe('tool:ellipse');
  });
});

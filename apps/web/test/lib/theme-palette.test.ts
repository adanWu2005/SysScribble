import { describe, expect, it } from 'vitest';
import { filterCommands, moveHighlight, scoreCommand, type PaletteCommand } from '@/lib/palette/commands';
import { THEME_KEY, THEME_SCRIPT, nextThemePref, parseThemePref, resolveTheme } from '@/lib/theme/theme';

describe('theme rules', () => {
  it('treats anything unknown as following the system', () => {
    expect(parseThemePref('dark')).toBe('dark');
    expect(parseThemePref('light')).toBe('light');
    for (const bad of [null, undefined, '', 'DARK', 'blue', 5, {}, '<script>']) expect(parseThemePref(bad)).toBe('system');
  });

  it('resolves system by the system setting', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('cycles through all three and back', () => {
    expect(nextThemePref('system')).toBe('light');
    expect(nextThemePref('light')).toBe('dark');
    expect(nextThemePref('dark')).toBe('system');
  });
});

describe('the pre-paint theme script', () => {
  /** Runs the real script against a fake page and reports whether it switched dark mode on. */
  function runScript(stored: string | null, systemDark: boolean, storageThrows = false): boolean {
    let dark = false;
    const fakeWindow = {
      matchMedia: () => ({ matches: systemDark }),
    };
    const fakeStorage = {
      getItem: (key: string) => {
        if (storageThrows) throw new Error('blocked');
        return key === THEME_KEY ? stored : null;
      },
    };
    const fakeDocument = {
      documentElement: {
        classList: {
          toggle: (_name: string, on: boolean) => {
            dark = on;
          },
        },
      },
    };
    new Function('localStorage', 'matchMedia', 'document', THEME_SCRIPT)(fakeStorage, fakeWindow.matchMedia, fakeDocument);
    return dark;
  }

  it('agrees with resolveTheme for every combination', () => {
    for (const stored of ['light', 'dark', 'system', null, 'garbage']) {
      for (const systemDark of [true, false]) {
        const expected = resolveTheme(parseThemePref(stored), systemDark) === 'dark';
        expect(runScript(stored, systemDark)).toBe(expected);
      }
    }
  });

  it('does not throw when storage is blocked', () => {
    expect(() => runScript(null, true, true)).not.toThrow();
  });

  it('has no character that React escapes, so rendering it as text leaves it unchanged', () => {
    expect(THEME_SCRIPT).not.toMatch(/[&<>'"]/);
  });

  it('is a fixed script with nothing that could carry input', () => {
    expect(THEME_SCRIPT).not.toMatch(/innerHTML|eval\(|document\.write|fetch|XMLHttp/);
  });
});

const cmd = (id: string, title: string, section = 'General', keywords?: string): PaletteCommand => ({
  id,
  title,
  section,
  ...(keywords ? { keywords } : {}),
  run: () => undefined,
});

describe('command palette search', () => {
  const commands = [
    cmd('rect', 'Rectangle tool', 'Tools', 'box square'),
    cmd('dark', 'Toggle dark mode', 'View', 'theme night'),
    cmd('kanban', 'Insert Kanban board', 'Templates'),
    cmd('fit', 'Zoom to fit', 'View'),
    cmd('group', 'Group selection', 'Edit'),
  ];

  it('lists everything in order for an empty query', () => {
    expect(filterCommands('', commands).map((c) => c.id)).toEqual(['rect', 'dark', 'kanban', 'fit', 'group']);
    expect(filterCommands('   ', commands)).toHaveLength(5);
  });

  it('ranks a title match above a section match', () => {
    expect(filterCommands('zoom', commands)[0]?.id).toBe('fit');
  });

  it('finds by keyword and section', () => {
    expect(filterCommands('night', commands).map((c) => c.id)).toEqual(['dark']);
    expect(filterCommands('templates', commands).map((c) => c.id)).toEqual(['kanban']);
  });

  it('needs every word to match', () => {
    expect(filterCommands('dark mode', commands).map((c) => c.id)).toEqual(['dark']);
    expect(filterCommands('dark zebra', commands)).toEqual([]);
  });

  it('ignores case and accents', () => {
    expect(filterCommands('KANBAN', commands)).toHaveLength(1);
    expect(filterCommands('rectángle', commands)).toHaveLength(1);
  });

  it('matches loose typing of a long word but not a two-letter scrap', () => {
    expect(filterCommands('kbn', commands)).toHaveLength(1);
    expect(filterCommands('kb', commands)).toHaveLength(0);
  });

  it('honors the limit and scores a miss as zero', () => {
    expect(filterCommands('', commands, 2)).toHaveLength(2);
    expect(scoreCommand('qqq', commands[0]!)).toBe(0);
  });

  it('wraps the highlight in both directions and survives an empty list', () => {
    expect(moveHighlight(0, -1, 4)).toBe(3);
    expect(moveHighlight(3, 1, 4)).toBe(0);
    expect(moveHighlight(1, 1, 4)).toBe(2);
    expect(moveHighlight(5, 1, 0)).toBe(0);
  });
});

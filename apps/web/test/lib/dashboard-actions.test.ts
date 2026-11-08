import { describe, expect, it } from 'vitest';
import { ACTION_LABELS, actionsFor, roomLink } from '@/lib/dashboard/actions';

describe('which menu items a role is offered', () => {
  it('offers the owner everything, including delete', () => {
    expect(actionsFor('OWNER')).toEqual(['rename', 'duplicate', 'members', 'copyLink', 'delete']);
  });

  it('never offers an editor delete, and never offers a viewer anything that changes the workspace', () => {
    expect(actionsFor('EDITOR')).not.toContain('delete');
    expect(actionsFor('EDITOR')).toEqual(expect.arrayContaining(['rename', 'duplicate']));
    for (const forbidden of ['rename', 'duplicate', 'delete'] as const) expect(actionsFor('VIEWER')).not.toContain(forbidden);
    expect(actionsFor('VIEWER')).toEqual(['members', 'copyLink']);
  });

  it('has a label for every action', () => {
    for (const role of ['OWNER', 'EDITOR', 'VIEWER'] as const) {
      for (const action of actionsFor(role)) expect(ACTION_LABELS[action].length).toBeGreaterThan(0);
    }
  });

  it('builds a room link from the origin and id only', () => {
    expect(roomLink('https://app.example', 'abc')).toBe('https://app.example/rooms/abc');
    expect(roomLink('https://app.example', '../x')).toBe('https://app.example/rooms/..%2Fx');
  });
});

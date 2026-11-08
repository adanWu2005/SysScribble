import type { RoomRole } from '@wb/shared';

/**
 * Which `...` menu items a role is offered. This only decides what to SHOW. Every one of these is
 * enforced again by the API, so hiding an item here is convenience and never the access control.
 */
export type RoomAction = 'rename' | 'duplicate' | 'members' | 'copyLink' | 'delete';

export const ACTION_LABELS: Readonly<Record<RoomAction, string>> = {
  rename: 'Rename',
  duplicate: 'Duplicate',
  members: 'Members & invite',
  copyLink: 'Copy link',
  delete: 'Delete',
};

export function actionsFor(role: RoomRole): RoomAction[] {
  switch (role) {
    case 'OWNER':
      return ['rename', 'duplicate', 'members', 'copyLink', 'delete'];
    case 'EDITOR':
      return ['rename', 'duplicate', 'members', 'copyLink'];
    case 'VIEWER':
      return ['members', 'copyLink'];
  }
}

/** The address a teammate can open. It is the room page, which checks membership itself. */
export function roomLink(origin: string, roomId: string): string {
  return `${origin}/rooms/${encodeURIComponent(roomId)}`;
}

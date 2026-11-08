'use client';

import type { RoomRole } from '@wb/shared';
import { Eye } from 'lucide-react';
import { useMemo } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { usePeerRoster } from '@/components/whiteboard/useBoard';
import { useMemberRoles } from '@/hooks/useMemberRoles';
import { useSpeakingIds } from '@/lib/huddle/speaking';
import { groupPeers } from '@/lib/whiteboard/presence';

const MAX_AVATARS = 5;

const ROLE_LABEL: Readonly<Record<RoomRole, string>> = { OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer' };
const ROLE_LETTER: Readonly<Record<RoomRole, string>> = { OWNER: 'O', EDITOR: 'E', VIEWER: 'V' };

function initial(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

/** A pill with the role's name. Used for my own role next to the connection status. */
export function RoleBadge({ role }: { role: RoomRole }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-600 dark:border-neutral-600 dark:text-neutral-300">
      {role === 'VIEWER' ? <Eye size={11} aria-hidden /> : null}
      {ROLE_LABEL[role]}
    </span>
  );
}

interface AvatarProps {
  name: string;
  color: string;
  /** One letter in the corner, or null for none. */
  badge: string | null;
  highlighted?: boolean;
  /** Talking in the huddle right now. */
  speaking?: boolean;
}

/** Names render as React text nodes, so a hostile display name stays plain text (PRD §5.5). */
function Avatar({ name, color, badge, highlighted = false, speaking = false }: AvatarProps) {
  return (
    <span className="relative inline-flex">
      <span
        style={{ backgroundColor: color }}
        className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ${
          speaking
            ? 'ring-[3px] ring-green-500 motion-safe:animate-pulse'
            : highlighted
              ? 'ring-blue-500'
              : 'ring-white dark:ring-neutral-900'
        }`}
      >
        {initial(name)}
      </span>
      {speaking ? <span className="sr-only"> (speaking)</span> : null}
      {badge ? (
        <span
          aria-hidden
          className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-bold text-neutral-700 shadow ring-1 ring-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:ring-neutral-600"
        >
          {badge}
        </span>
      ) : null}
    </span>
  );
}

interface PresenceBarProps {
  roomId: string;
  awareness: Awareness;
  self: { id: string; name: string; color: string };
  selfRole: RoomRole;
  /** The user being followed, if any. */
  followUserId: string | null;
  onFollow: (userId: string | null) => void;
}

/**
 * Everyone in the room as an overlapping stack of avatars. Click someone to follow their view;
 * click again to stop. Roles come from the members API, never from awareness. A Chaos Lab ghost is
 * listed on its own, marked "G", and cannot be followed because it has no view of its own.
 */
export function PresenceBar({ roomId, awareness, self, selfRole, followUserId, onFollow }: PresenceBarProps) {
  const roster = usePeerRoster(awareness);
  const speaking = useSpeakingIds();
  const groups = useMemo(
    // The same person in two tabs is one avatar. My own other tabs are not "someone else".
    () => groupPeers(roster).filter((group) => group.userId !== self.id),
    [roster, self.id],
  );
  const roles = useMemberRoles(
    roomId,
    groups.filter((group) => !group.ghost).map((group) => group.userId),
    selfRole,
  );

  const shown = groups.slice(0, MAX_AVATARS);
  const hidden = groups.length - shown.length;

  return (
    <ul className="flex items-center -space-x-2" aria-label="People in this room">
      <li title={`You · ${ROLE_LABEL[selfRole]}`}>
        <Avatar name={self.name} color={self.color} badge={ROLE_LETTER[selfRole]} speaking={speaking.has(self.id)} />
        <span className="sr-only">
          {self.name} (you), {ROLE_LABEL[selfRole]}
        </span>
      </li>
      {shown.map((group) => {
        if (group.ghost) {
          return (
            <li key={group.userId} title={`${group.name} (simulated collaborator)`}>
              <Avatar name={group.name} color={group.color} badge="G" />
              <span className="sr-only">{group.name}, a simulated collaborator</span>
            </li>
          );
        }
        const role = roles.get(group.userId) ?? null;
        const following = followUserId === group.userId;
        const label = `${group.name}${role ? ` · ${ROLE_LABEL[role]}` : ''}`;
        return (
          <li key={group.userId}>
            <button
              type="button"
              aria-pressed={following}
              aria-label={following ? `Stop following ${label}` : `Follow ${label}`}
              title={following ? `Stop following ${label}` : `Follow ${label}`}
              onClick={() => onFollow(following ? null : group.userId)}
              className="rounded-full transition-transform hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
            >
              <Avatar
                name={group.name}
                color={group.color}
                badge={role ? ROLE_LETTER[role] : null}
                highlighted={following}
                speaking={speaking.has(group.userId)}
              />
            </button>
          </li>
        );
      })}
      {hidden > 0 ? (
        <li
          title={`${hidden} more`}
          className="relative z-0 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700 ring-2 ring-white dark:bg-neutral-700 dark:text-neutral-100 dark:ring-neutral-900"
        >
          +{hidden}
        </li>
      ) : null}
    </ul>
  );
}

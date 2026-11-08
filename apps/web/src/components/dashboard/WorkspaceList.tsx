'use client';

import type { RoomSummary, RoomWithRole } from '@wb/shared';
import { Star } from 'lucide-react';
import Link from 'next/link';
import { useNow } from '@/hooks/useNow';
import type { RoomAction } from '@/lib/dashboard/actions';
import { formatRelativeTime, type ViewMode } from '@/lib/dashboard/filter';
import { colorFor } from '@/lib/presence/color';
import { RoleBadge } from './RoleBadge';
import { RoomMenu } from './RoomMenu';

interface WorkspaceListProps {
  rooms: readonly RoomWithRole[];
  view: ViewMode;
  starred: ReadonlySet<string>;
  summaries: ReadonlyMap<string, RoomSummary>;
  /** People connected right now, by room id. A room nobody is in has no entry. */
  presence: Readonly<Record<string, number>>;
  onToggleStar: (roomId: string) => void;
  onAction: (room: RoomWithRole, action: RoomAction) => void;
}

function StarButton({ room, starred, onToggle }: { room: RoomWithRole; starred: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={starred}
      aria-label={starred ? `Remove ${room.title} from favorites` : `Add ${room.title} to favorites`}
      onClick={onToggle}
      className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:bg-neutral-800"
    >
      <Star size={16} aria-hidden className={starred ? 'fill-amber-400 text-amber-400' : ''} />
    </button>
  );
}

/** Shows a date until the browser's clock is known, then "5 minutes ago". */
function Updated({ iso }: { iso: string }) {
  const now = useNow();
  return <time dateTime={iso}>{now === null ? iso.slice(0, 10) : formatRelativeTime(iso, now)}</time>;
}

/** A pulsing green pill. The dot pulses only when motion is allowed; the words carry the meaning. */
function ActivePill({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
      <span aria-hidden className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
      </span>
      {count} active now
    </span>
  );
}

/** Names are user text and render as text nodes. The initial is the first letter, nothing more. */
function People({ summary }: { summary: RoomSummary | undefined }) {
  if (!summary || summary.memberCount === 0) return null;
  const extra = summary.memberCount - summary.people.length;
  return (
    <span
      className="flex items-center"
      title={`${summary.memberCount} member${summary.memberCount === 1 ? '' : 's'}`}
    >
      <span className="flex -space-x-1.5">
        {summary.people.map((name, index) => (
          <span
            key={`${name}-${index}`}
            aria-hidden
            style={{ backgroundColor: colorFor(name) }}
            className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-white dark:ring-neutral-900"
          >
            {(Array.from(name.trim())[0] ?? '?').toUpperCase()}
          </span>
        ))}
      </span>
      {extra > 0 ? <span className="ml-1.5 text-[11px] text-neutral-500">+{extra}</span> : null}
      <span className="sr-only">
        {summary.memberCount} member{summary.memberCount === 1 ? '' : 's'}
      </span>
    </span>
  );
}

/**
 * The banner: a drawing of the board when there is one, on the same dots as the canvas. The board is
 * always drawn on a light surface, because its colors are chosen for one.
 */
function Thumbnail({ summary }: { summary: RoomSummary | undefined }) {
  return (
    <span
      aria-hidden
      className="relative block h-28 overflow-hidden bg-neutral-100"
      style={{
        backgroundImage: 'radial-gradient(circle, rgba(115,115,115,0.4) 1px, transparent 1.4px)',
        backgroundSize: '14px 14px',
      }}
    >
      {summary?.thumbnail ? (
        // An <img>, never inline markup, so nothing inside the drawing can run.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={summary.thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain p-1" />
      ) : null}
      {summary ? (
        <span className="absolute bottom-1.5 left-2 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
          {summary.shapeCount === 0 ? 'Empty board' : `${summary.shapeCount} item${summary.shapeCount === 1 ? '' : 's'}`}
        </span>
      ) : null}
    </span>
  );
}

/** Titles are user text and render as text nodes only. */
export function WorkspaceList({ rooms, view, starred, summaries, presence, onToggleStar, onAction }: WorkspaceListProps) {
  if (view === 'table') {
    return (
      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                <span className="sr-only">Favorite</span>
              </th>
              <th scope="col" className="px-3 py-2">Name</th>
              <th scope="col" className="px-3 py-2">Role</th>
              <th scope="col" className="px-3 py-2">People</th>
              <th scope="col" className="px-3 py-2">Updated</th>
              <th scope="col" className="w-10 px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {rooms.map((room) => (
              <tr key={room.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/60">
                <td className="px-3 py-1.5">
                  <StarButton room={room} starred={starred.has(room.id)} onToggle={() => onToggleStar(room.id)} />
                </td>
                <td className="max-w-[18rem] px-3 py-2">
                  <span className="flex items-center gap-2">
                    <Link href={`/rooms/${room.id}`} className="truncate font-medium hover:underline">
                      {room.title}
                    </Link>
                    {presence[room.id] ? <ActivePill count={presence[room.id] ?? 0} /> : null}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <RoleBadge role={room.role} />
                </td>
                <td className="px-3 py-2">
                  <People summary={summaries.get(room.id)} />
                </td>
                <td className="px-3 py-2 text-neutral-500">
                  <Updated iso={room.updatedAt} />
                </td>
                <td className="px-3 py-1.5">
                  <RoomMenu title={room.title} role={room.role} onAction={(action) => onAction(room, action)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rooms.map((room) => {
        const summary = summaries.get(room.id);
        const active = presence[room.id] ?? 0;
        return (
          <li
            key={room.id}
            className="group relative flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white transition-shadow hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
          >
            <Link href={`/rooms/${room.id}`} className="flex flex-1 flex-col focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
              <Thumbnail summary={summary} />
              <span className="flex flex-col gap-2 p-4 pb-3">
                <span className="truncate pr-8 font-medium">{room.title}</span>
                <span className="flex items-center justify-between gap-2">
                  <RoleBadge role={room.role} />
                  <People summary={summary} />
                </span>
                <span className="text-xs text-neutral-500">
                  Updated <Updated iso={room.updatedAt} />
                </span>
              </span>
            </Link>

            {active > 0 ? (
              <div className="pointer-events-none absolute left-2 top-2">
                <ActivePill count={active} />
              </div>
            ) : null}
            <div className="absolute right-2 top-2 flex rounded-md bg-white/85 shadow-sm dark:bg-neutral-900/85">
              <StarButton room={room} starred={starred.has(room.id)} onToggle={() => onToggleStar(room.id)} />
            </div>
            <div className="absolute bottom-2 right-2">
              <RoomMenu title={room.title} role={room.role} onAction={(action) => onAction(room, action)} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

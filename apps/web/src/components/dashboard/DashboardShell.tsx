'use client';

import type { PendingInvite, RoomWithRole } from '@wb/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MembersDialog } from '@/components/members/MembersDialog';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useLocalPref } from '@/hooks/useLocalPref';
import { roomLink, type RoomAction } from '@/lib/dashboard/actions';
import { ApiClientError, apiFetch } from '@/lib/fetcher';
import {
  TAB_LABELS,
  selectRooms,
  tabCounts,
  type DashboardTab,
  type SortKey,
  type ViewMode,
} from '@/lib/dashboard/filter';
import {
  DASHBOARD_PREFS_KEY,
  parseDashboardPrefs,
  serializeDashboardPrefs,
} from '@/lib/dashboard/prefs';
import { STARS_KEY, parseStars, serializeStars, toggleStar } from '@/lib/dashboard/stars';
import { PendingInvites } from './PendingInvites';
import { TemplateGallery } from './TemplateGallery';
import { DashboardToolbar } from './DashboardToolbar';
import { DeleteDialog, RenameDialog } from './RoomDialogs';
import { Sidebar, type DashboardUser } from './Sidebar';
import { WorkspaceList } from './WorkspaceList';

interface DashboardShellProps {
  user: DashboardUser;
  rooms: readonly RoomWithRole[];
  usedBytes: number;
  invites: readonly PendingInvite[];
}

const EMPTY_MESSAGES: Readonly<Record<DashboardTab, string>> = {
  all: 'No workspaces yet. Pick a starting point above.',
  owned: 'You do not own any workspaces yet.',
  shared: 'Nothing has been shared with you yet.',
  starred: 'No favorites yet. Star a workspace to keep it here.',
};

/** The dashboard: a fixed sidebar, and a main area with search, sort, a view switch and the workspaces. */
export function DashboardShell({ user, rooms, usedBytes, invites }: DashboardShellProps) {
  const [tab, setTab] = useState<DashboardTab>('all');
  const [search, setSearch] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [dialog, setDialog] = useState<{ kind: 'rename' | 'delete' | 'members'; room: RoomWithRole } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [rawPrefs, savePrefs] = useLocalPref(DASHBOARD_PREFS_KEY);
  const prefs = useMemo(() => parseDashboardPrefs(rawPrefs), [rawPrefs]);
  const [rawStars, saveStars] = useLocalPref(STARS_KEY);
  const starIds = useMemo(() => parseStars(rawStars), [rawStars]);
  const starred = useMemo(() => new Set(starIds), [starIds]);

  const counts = useMemo(() => tabCounts(rooms, starred), [rooms, starred]);
  const shown = useMemo(() => selectRooms(rooms, { tab, search, sort: prefs.sort }, starred), [rooms, tab, search, prefs.sort, starred]);

  // Thumbnails and the live headcount are asked for only the rooms being shown.
  const { summaries, presence } = useDashboardData(useMemo(() => shown.slice(0, 36).map((room) => room.id), [shown]));

  useEffect(() => {
    if (notice === null) return undefined;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  const closeDialog = useCallback(() => setDialog(null), []);
  /** After the server accepted a change: refetch the list, which is rendered on the server. */
  const done = useCallback(
    (message: string) => {
      setDialog(null);
      setNotice(message);
      router.refresh();
    },
    [router],
  );

  async function onAction(room: RoomWithRole, action: RoomAction) {
    switch (action) {
      case 'rename':
      case 'delete':
      case 'members':
        setDialog({ kind: action, room });
        return;
      case 'copyLink':
        try {
          await navigator.clipboard.writeText(roomLink(window.location.origin, room.id));
          setNotice('Link copied.');
        } catch {
          setNotice('Could not copy the link.');
        }
        return;
      case 'duplicate':
        setNotice('Duplicating…');
        try {
          await apiFetch(`/api/rooms/${room.id}/duplicate`, { method: 'POST' });
          done('Workspace duplicated.');
        } catch (err) {
          setNotice(err instanceof ApiClientError ? err.message : 'Could not duplicate the workspace.');
        }
        return;
    }
  }

  // Ctrl or Cmd+K jumps to the search box from anywhere on the page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Escape closes the slide-over navigation on small screens.
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navOpen]);

  const setSort = (sort: SortKey) => savePrefs(serializeDashboardPrefs({ ...prefs, sort }));
  const setView = (view: ViewMode) => savePrefs(serializeDashboardPrefs({ ...prefs, view }));

  const sidebar = (
    <Sidebar
      user={user}
      tab={tab}
      counts={counts}
      usedBytes={usedBytes}
      onTab={(next) => {
        setTab(next);
        setNavOpen(false);
      }}
    />
  );

  return (
    <div className="arc-backdrop flex h-screen sm:p-3">
      <div className="flex min-w-0 flex-1 overflow-hidden bg-neutral-50 shadow-2xl sm:rounded-3xl dark:bg-neutral-950">
      <aside className="hidden shrink-0 md:block">{sidebar}</aside>

      {navOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Close navigation" onClick={() => setNavOpen(false)} className="absolute inset-0 bg-black/40" />
          <aside className="relative h-full w-[260px] shadow-xl">{sidebar}</aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardToolbar
          search={search}
          onSearch={setSearch}
          searchRef={searchRef}
          sort={prefs.sort}
          onSort={setSort}
          view={prefs.view}
          onView={setView}
          onOpenNav={() => setNavOpen(true)}
        />

        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
          <div className="mx-auto max-w-6xl">
            <PendingInvites invites={invites} onChanged={done} />
            <TemplateGallery />

            <h1 className="mb-4 mt-8 text-xl font-semibold">{TAB_LABELS[tab]}</h1>
            <div>
              {shown.length === 0 ? (
                <p className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-neutral-500 dark:border-neutral-700">
                  {search.trim() !== '' ? `No workspace matches “${search.trim()}”.` : EMPTY_MESSAGES[tab]}
                </p>
              ) : (
                <WorkspaceList
                  rooms={shown}
                  view={prefs.view}
                  starred={starred}
                  summaries={summaries}
                  presence={presence}
                  onAction={(room, action) => void onAction(room, action)}
                  onToggleStar={(roomId) => saveStars(serializeStars(toggleStar(starIds, roomId)))}
                />
              )}
            </div>
          </div>
        </main>
      </div>
      </div>

      {dialog?.kind === 'rename' ? <RenameDialog room={dialog.room} onClose={closeDialog} onDone={done} /> : null}
      {dialog?.kind === 'delete' ? <DeleteDialog room={dialog.room} onClose={closeDialog} onDone={done} /> : null}
      {dialog?.kind === 'members' ? (
        <MembersDialog roomId={dialog.room.id} currentUserId={user.id} role={dialog.room.role} open onClosed={closeDialog} />
      ) : null}

      {notice !== null ? (
        <p
          role="status"
          className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900"
        >
          {notice}
        </p>
      ) : null}
    </div>
  );
}

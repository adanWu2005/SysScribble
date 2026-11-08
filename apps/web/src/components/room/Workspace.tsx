'use client';

import { WS_CLOSE, canMutate, type RoomRole } from '@wb/shared';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { History, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { NotesEditor, type NotesApi } from '@/components/editor/NotesEditor';
import { MembersDialog } from '@/components/members/MembersDialog';
import { ChaosPanel } from '@/components/chaos/ChaosPanel';
import { CommandPalette } from '@/components/palette/CommandPalette';
import { ConnectionStatus } from '@/components/presence/ConnectionStatus';
import { PresenceBar, RoleBadge } from '@/components/presence/PresenceBar';
import type { BoardCommand, CanvasApi } from '@/components/whiteboard/canvasApi';
import { UploadButton } from '@/components/whiteboard/UploadButton';
import { useChaosState } from '@/hooks/useChaosState';
import { useGhosts } from '@/hooks/useGhosts';
import { useLayoutPrefs } from '@/hooks/useLayoutPrefs';
import { useRoomDoc, type RoomUser } from '@/hooks/useRoomDoc';
import { useTheme } from '@/hooks/useTheme';
import { parseShapeHash } from '@/lib/notes/shapeRef';
import { buildCommands } from '@/lib/palette/build';
import { colorFor } from '@/lib/presence/color';
import { ExportMenu } from './ExportMenu';
import { HistoryDrawer } from './HistoryDrawer';
import { SplitHandle } from './SplitHandle';
import { ThemeToggle } from './ThemeToggle';
import { ViewModeSwitch } from './ViewModeSwitch';

/** Konva and LiveKit need browser APIs, so neither renders on the server. */
const HuddlePanel = dynamic(() => import('@/components/huddle/HuddlePanel').then((m) => m.HuddlePanel), {
  ssr: false,
});
const Canvas = dynamic(() => import('@/components/whiteboard/Canvas'), { ssr: false });

const TERMINATED_MESSAGES: Readonly<Record<number, string>> = {
  [WS_CLOSE.REMOVED]: 'You were removed from this workspace.',
  [WS_CLOSE.KICKED]: 'The owner disconnected you from this workspace.',
  [WS_CLOSE.ROOM_DELETED]: 'This workspace was deleted.',
  [WS_CLOSE.FORBIDDEN]: 'You no longer have access to this workspace.',
  [WS_CLOSE.UNAUTHORIZED]: 'Could not connect. Check your session and try again.',
};

const NOTICE_MS = 3500;

interface WorkspaceProps {
  roomId: string;
  title: string;
  initialRole: RoomRole;
  userId: string;
  displayName: string;
}

export function Workspace({ roomId, title, initialRole, userId, displayName }: WorkspaceProps) {
  const user = useMemo<RoomUser>(
    () => ({ id: userId, name: displayName.slice(0, 80), color: colorFor(userId) }),
    [userId, displayName],
  );
  const { session, status, role, synced, latency, terminatedCode } = useRoomDoc(roomId, user, initialRole);
  const canEdit = canMutate(role);
  // Whose view the canvas is mirroring. It lives here because the avatars start it and the canvas obeys it.
  const [followUserId, setFollowUserId] = useState<string | null>(null);

  // ---- layout: which panes show, and how wide the notes are ----
  const { prefs, setMode, setSplit } = useLayoutPrefs();
  const [dragSplit, setDragSplit] = useState<number | null>(null);
  const split = dragSplit ?? prefs.split;
  const main = useRef<HTMLElement>(null);
  const showNotes = prefs.mode !== 'canvas';
  const showCanvas = prefs.mode !== 'notes';

  // ---- links between the notes and the whiteboard ----
  const canvasApi = useRef<CanvasApi | null>(null);
  const notesApi = useRef<NotesApi | null>(null);
  // Kept in state as well as the ref: the palette is built during render and may not read a ref there.
  const [canvasHandle, setCanvasHandle] = useState<CanvasApi | null>(null);
  const canvasReady = canvasHandle !== null;
  const [notice, setNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chaosOpen, setChaosOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { pref: themePref, setPref: setThemePref } = useTheme();
  const chaos = useChaosState(session?.provider ?? null);
  // Ghosts live here, not in the panel, so closing the panel does not stop them.
  const ghosts = useGhosts(roomId, userId, session);
  const hashHandled = useRef(false);

  const onCanvasApi = useCallback((api: CanvasApi | null) => {
    canvasApi.current = api;
    setCanvasHandle(api);
  }, []);
  const onNotesApi = useCallback((api: NotesApi | null) => {
    notesApi.current = api;
  }, []);
  const getNotesJson = useCallback(() => notesApi.current?.getJSON() ?? null, []);

  const mode = prefs.mode;
  const openShape = useCallback(
    (shapeId: string) => {
      // A badge clicked in Notes Only mode has nothing to fly to until the whiteboard is back.
      if (mode === 'notes') setMode('split');
      if (!canvasApi.current?.focusShape(shapeId)) setNotice('That shape is no longer on the whiteboard.');
    },
    [mode, setMode],
  );

  const insertInNotes = useCallback(
    (ref: { shapeId: string; label: string }) => {
      if (!notesApi.current?.insertShapeRef(ref)) {
        setNotice('The notes cannot be edited right now.');
        return;
      }
      if (mode === 'canvas') setMode('split');
      setNotice('Added to the notes.');
    },
    [mode, setMode],
  );

  // Cmd/Ctrl+K opens the palette from anywhere, including inside the notes and other text fields.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // A board command needs a visible board: in Notes Only the whiteboard is hidden and has no size.
  const perform = useCallback(
    (command: BoardCommand) => {
      if (mode === 'notes') {
        setMode('split');
        setTimeout(() => canvasHandle?.perform(command), 150);
        return;
      }
      canvasHandle?.perform(command);
    },
    [mode, setMode, canvasHandle],
  );
  const searchShapes = useCallback(
    (query: string, limit: number) => canvasHandle?.searchShapes(query, limit) ?? [],
    [canvasHandle],
  );
  const paletteCommands = useMemo(
    () =>
      buildCommands({
        canEdit,
        perform,
        setMode,
        setTheme: setThemePref,
        openHistory: () => setHistoryOpen(true),
        openChaos: () => setChaosOpen(true),
      }),
    [canEdit, perform, setMode, setThemePref],
  );

  // A link copied with "Copy link to shape" opens the room and flies to that shape, once.
  useEffect(() => {
    if (!synced || !canvasReady || hashHandled.current) return;
    hashHandled.current = true;
    const shapeId = parseShapeHash(window.location.hash);
    if (shapeId) openShape(shapeId);
  }, [synced, canvasReady, openShape]);

  useEffect(() => {
    if (notice === null) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (terminatedCode !== null) {
    return (
      <main className="arc-backdrop flex h-screen flex-col items-center justify-center gap-4 p-4 text-center text-white">
        <p>{TERMINATED_MESSAGES[terminatedCode] ?? 'This session has ended.'}</p>
        <Link href="/" className="arc-btn">
          Back to your workspaces
        </Link>
      </main>
    );
  }

  const splitView = prefs.mode === 'split';

  return (
    <div className="arc-backdrop flex h-screen flex-col gap-2 p-2 sm:gap-3 sm:p-3">
      <header className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-2 shadow-lg dark:bg-neutral-900">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">
          Workspaces
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-semibold">{title}</h1>
        <ViewModeSwitch mode={prefs.mode} onChange={setMode} />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-300 px-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <Search size={15} aria-hidden />
          <span className="hidden lg:inline">Commands</span>
          <kbd className="hidden rounded border border-neutral-300 px-1 font-sans text-xs text-neutral-500 lg:inline dark:border-neutral-600">
            Ctrl K
          </kbd>
          <span className="sr-only lg:hidden">Open command palette</span>
        </button>
        <ThemeToggle pref={themePref} onChange={setThemePref} />
        <ExportMenu
          roomId={roomId}
          title={title}
          doc={session?.doc ?? null}
          getNotesJson={getNotesJson}
          onNotice={setNotice}
        />
        {/* Version history is for people who can edit. The server checks that again on every request. */}
        {canEdit && session ? (
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-300 px-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <History size={15} aria-hidden />
            <span className="hidden lg:inline">History</span>
            <span className="sr-only lg:hidden">History</span>
          </button>
        ) : null}
        {session ? (
          <PresenceBar
            roomId={roomId}
            awareness={session.awareness}
            self={user}
            selfRole={role}
            followUserId={followUserId}
            onFollow={setFollowUserId}
          />
        ) : null}
        <HuddlePanel roomId={roomId} />
        <MembersDialog roomId={roomId} currentUserId={userId} role={role} />
        <RoleBadge role={role} />
        <ConnectionStatus
          status={status}
          synced={synced}
          latency={latency}
          chaos={chaos}
          open={chaosOpen}
          onToggle={() => setChaosOpen((open) => !open)}
        />
      </header>

      {session ? (
        <main
          ref={main}
          // The notes width is a CSS variable so only one style value changes while dragging.
          style={{ '--notes': `${split * 100}%` } as CSSProperties}
          className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-950 md:flex-row ${dragSplit !== null ? 'select-none' : ''}`}
        >
          {/* Both panes stay mounted. A hidden pane keeps its state, so switching view mode loses nothing. */}
          <section
            aria-label="Notes"
            className={`${showNotes ? '' : 'hidden'} min-h-0 min-w-0 overflow-hidden ${
              splitView
                ? 'flex-1 border-b border-neutral-200 dark:border-neutral-800 md:w-[var(--notes)] md:flex-none md:border-b-0'
                : 'flex-1'
            }`}
          >
            <NotesEditor
              key={session.doc.guid}
              session={session}
              user={user}
              canEdit={canEdit}
              onOpenShape={openShape}
              onApiReady={onNotesApi}
            />
          </section>

          {splitView ? <SplitHandle value={split} container={main} onDrag={setDragSplit} onCommit={setSplit} /> : null}

          <section aria-label="Whiteboard" className={`${showCanvas ? '' : 'hidden'} min-h-0 min-w-0 flex-1`}>
            <Canvas
              key={session.doc.guid}
              roomId={roomId}
              session={session}
              user={user}
              canEdit={canEdit}
              followUserId={followUserId}
              onFollowChange={setFollowUserId}
              onApiReady={onCanvasApi}
              onNotice={setNotice}
              {...(canEdit ? { onInsertInNotes: insertInNotes } : {})}
              toolbarExtras={(placeAt) => <UploadButton roomId={roomId} doc={session.doc} placeAt={placeAt} />}
            />
          </section>
        </main>
      ) : null}

      {chaosOpen && session ? (
        <ChaosPanel
          provider={session.provider}
          doc={session.doc}
          role={role}
          canEdit={canEdit}
          ghosts={ghosts}
          onClose={() => setChaosOpen(false)}
        />
      ) : null}

      {/* Closes itself if the role drops mid-session, since the server would refuse it anyway. */}
      {historyOpen && canEdit && session ? (
        <HistoryDrawer
          key={session.doc.guid}
          roomId={roomId}
          doc={session.doc}
          onClose={() => setHistoryOpen(false)}
          onNotice={setNotice}
        />
      ) : null}

      {paletteOpen ? (
        <CommandPalette
          commands={paletteCommands}
          searchShapes={searchShapes}
          onPickShape={openShape}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}

      {notice !== null ? (
        <p
          role="status"
          className="pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900"
        >
          {notice}
        </p>
      ) : null}
    </div>
  );
}

'use client';

import '@livekit/components-styles';
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from '@livekit/components-react';
import type { LivekitTokenResponse } from '@wb/shared';
import { Track, RoomEvent } from 'livekit-client';
import { Headphones, Maximize2, Mic, MicOff, Minimize2, PhoneOff, Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiClientError, apiFetch } from '@/lib/fetcher';
import { clearSpeakers, setSpeakers, useSpeakingIds } from '@/lib/huddle/speaking';
import { colorFor } from '@/lib/presence/color';

const MAX_CHIPS = 6;

/** Copies LiveKit's active-speaker list into the store the avatars and cursors read. */
function SpeakingBridge() {
  const room = useRoomContext();
  useEffect(() => {
    const update = () => setSpeakers(room.activeSpeakers.map((participant) => participant.identity));
    room.on(RoomEvent.ActiveSpeakersChanged, update);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, update);
      clearSpeakers();
    };
  }, [room]);
  return null;
}

function VideoGrid({ canPublish, expanded }: { canPublish: boolean; expanded: boolean }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <div className={`flex flex-col bg-black ${expanded ? 'min-h-0 flex-1' : 'h-48'}`}>
      <GridLayout tracks={tracks} className="min-h-0 flex-1">
        <ParticipantTile />
      </GridLayout>
      <ControlBar
        variation="minimal"
        controls={{ microphone: false, camera: canPublish, screenShare: canPublish, chat: false, leave: false }}
      />
    </div>
  );
}

const buttonClass =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500';

/** Who is in the huddle, each with a ring that lights up while they talk. */
function Roster() {
  const participants = useParticipants();
  const speaking = useSpeakingIds();
  const shown = participants.slice(0, MAX_CHIPS);
  const hidden = participants.length - shown.length;
  const talking = participants.filter((p) => speaking.has(p.identity)).map((p) => p.name || 'Someone');

  return (
    <>
      <ul className="flex items-center gap-1.5" aria-label="People in the huddle">
        {shown.map((participant) => {
          const name = participant.name || 'Guest';
          const active = speaking.has(participant.identity);
          return (
            <li key={participant.identity} title={`${name}${active ? ' (speaking)' : ''}`} className="relative">
              <span
                style={{ backgroundColor: colorFor(participant.identity) }}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white transition-shadow ${
                  active ? 'ring-[3px] ring-green-400 motion-safe:animate-pulse' : 'ring-2 ring-white/20'
                }`}
              >
                {(Array.from(name.trim())[0] ?? '?').toUpperCase()}
              </span>
              <span className="sr-only">{name}</span>
            </li>
          );
        })}
        {hidden > 0 ? <li className="px-1 text-xs text-neutral-300">+{hidden}</li> : null}
      </ul>
      {/* Screen readers hear who is talking without the ring. */}
      <span className="sr-only" role="status" aria-live="polite">
        {talking.length > 0 ? `Speaking: ${talking.join(', ')}` : ''}
      </span>
    </>
  );
}

/**
 * The huddle is a box in the bottom-right corner: who is in it, the video when it is open, and the
 * controls. The expand button turns the box into a full-screen view; Escape or the same button returns.
 */
function HuddleBar({ canPublish }: { canPublish: boolean }) {
  const room = useRoomContext();
  const { isMicrophoneEnabled, localParticipant } = useLocalParticipant();
  const [videoOpen, setVideoOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const full = videoOpen && expanded;

  useEffect(() => {
    if (!full) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [full]);

  async function toggleMic() {
    setMicError(null);
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch {
      setMicError('Could not use the microphone.');
    }
  }

  return (
    <div className={`pointer-events-none fixed z-40 ${full ? 'inset-3' : 'bottom-4 right-4'}`}>
      <div
        role="region"
        aria-label="Huddle"
        className={`pointer-events-auto flex flex-col overflow-hidden rounded-2xl bg-neutral-900/95 text-white shadow-2xl backdrop-blur ${
          full ? 'h-full w-full' : 'w-[min(22rem,calc(100vw-2rem))]'
        }`}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <Roster />
          </div>
          {videoOpen ? (
            <button
              type="button"
              aria-label={expanded ? 'Exit full screen' : 'Full screen'}
              title={expanded ? 'Exit full screen (Esc)' : 'Full screen'}
              onClick={() => setExpanded((open) => !open)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              {expanded ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
            </button>
          ) : null}
        </div>

        {videoOpen ? <VideoGrid canPublish={canPublish} expanded={full} /> : null}

        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          {canPublish ? (
            <button
              type="button"
              aria-pressed={isMicrophoneEnabled}
              onClick={() => void toggleMic()}
              className={`${buttonClass} ${isMicrophoneEnabled ? 'bg-white/15 hover:bg-white/25' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {isMicrophoneEnabled ? <Mic size={15} aria-hidden /> : <MicOff size={15} aria-hidden />}
              {isMicrophoneEnabled ? 'Mute' : 'Unmute'}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 text-xs text-neutral-300">
              <Headphones size={14} aria-hidden /> Listening
            </span>
          )}
          <button
            type="button"
            aria-pressed={videoOpen}
            onClick={() => {
              setVideoOpen((open) => !open);
              setExpanded(false);
            }}
            className={`${buttonClass} ${videoOpen ? 'bg-white/25' : 'bg-white/10 hover:bg-white/20'}`}
          >
            <Video size={15} aria-hidden />
            Video
          </button>
          <button type="button" onClick={() => void room.disconnect()} className={`${buttonClass} ml-auto bg-red-600 hover:bg-red-700`}>
            <PhoneOff size={15} aria-hidden />
            Leave
          </button>
          {micError ? (
            <span role="alert" className="w-full text-xs text-red-300">
              {micError}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function HuddlePanel({ roomId }: { roomId: string }) {
  const [session, setSession] = useState<LivekitTokenResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setPending(true);
    setError(null);
    try {
      setSession(await apiFetch<LivekitTokenResponse>(`/api/rooms/${roomId}/livekit-token`, { method: 'POST' }));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not join the huddle');
    } finally {
      setPending(false);
    }
  }

  if (!session) {
    return (
      <>
        <button
          type="button"
          disabled={pending}
          onClick={() => void join()}
          className="rounded border border-neutral-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-neutral-700"
        >
          {pending ? 'Joining…' : 'Join Huddle'}
        </button>
        {error ? (
          <span role="alert" className="text-sm text-red-600">
            {error}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <LiveKitRoom
      token={session.token}
      serverUrl={session.url}
      connect
      audio={session.canPublish}
      video={false}
      onDisconnected={() => {
        clearSpeakers();
        setSession(null);
      }}
      data-lk-theme="default"
      // LiveKit's wrapper is a full-width black box. It only provides context and theme variables, so it
      // must not take up any space in the page; the huddle box is fixed to the corner.
      style={{ display: 'contents' }}
    >
      <SpeakingBridge />
      <RoomAudioRenderer />
      <HuddleBar canPublish={session.canPublish} />
    </LiveKitRoom>
  );
}

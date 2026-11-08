'use client';

import { MAX_ARTIFICIAL_LATENCY_MS, type RoomRole } from '@wb/shared';
import type { RoomProvider } from '@wb/shared/client';
import { Activity, Bot, Plug, PlugZap, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type * as Y from 'yjs';
import type { Ghosts } from '@/hooks/useGhosts';
import { useTelemetry } from '@/hooks/useTelemetry';
import { formatBytes } from '@/lib/history/format';
import { formatAge, formatRate } from '@/lib/telemetry/rates';
import { Sparkline } from './Sparkline';

interface ChaosPanelProps {
  provider: RoomProvider;
  doc: Y.Doc;
  role: RoomRole;
  canEdit: boolean;
  ghosts: Ghosts;
  onClose: () => void;
}

function Card({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-700">
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">{hint}</p> : null}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5 border-t border-neutral-200 px-4 py-3 dark:border-neutral-700">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Live telemetry and network chaos for the person looking at it. Every control here is local to
 * this browser: it can slow or pause this client's own connection and start simulated collaborators,
 * and none of it loosens anything the server enforces.
 */
export function ChaosPanel({ provider, doc, role, canEdit, ghosts, onClose }: ChaosPanelProps) {
  const telemetry = useTelemetry(provider, doc, true);
  const { chaos, stats, perSecond } = telemetry;
  const [confirming, setConfirming] = useState(false);
  const [removeOnStop, setRemoveOnStop] = useState(true);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ghostsRunning = ghosts.ghosts.length > 0;
  // A first ghost for someone who can edit adds real content to a shared room, so it asks first.
  const needsConfirm = canEdit && !ghostsRunning;

  function addGhost() {
    if (needsConfirm && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    ghosts.spawn();
  }

  return (
    <div
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-label="Network and concurrency lab"
      className="fixed right-4 top-14 z-40 max-h-[calc(100vh-5rem)] w-[23rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-neutral-200 bg-white shadow-2xl focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
    >
      <header className="flex items-center gap-2 px-4 py-3">
        <Activity size={16} aria-hidden />
        <h2 className="flex-1 text-sm font-semibold">Network &amp; concurrency lab</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:bg-neutral-800"
        >
          <X size={16} aria-hidden />
        </button>
      </header>

      <Section title="Live telemetry" icon={<Activity size={13} aria-hidden />}>
        <div className="grid grid-cols-2 gap-2">
          <Card
            label="Inbound"
            value={
              <>
                {perSecond.inFrames}
                <span className="text-xs font-normal text-neutral-500"> pkt/s</span>
              </>
            }
            hint={`sync ${perSecond.inSync} · presence ${perSecond.inAwareness} · ${formatRate(perSecond.inBytes)}`}
          />
          <Card
            label="Outbound"
            value={
              <>
                {perSecond.outFrames}
                <span className="text-xs font-normal text-neutral-500"> pkt/s</span>
              </>
            }
            hint={`sync ${perSecond.outSync} · presence ${perSecond.outAwareness} · ${formatRate(perSecond.outBytes)}`}
          />
          <Card
            label="Y.Doc size"
            value={telemetry.docBytes === null ? '…' : formatBytes(telemetry.docBytes)}
            hint="compacted binary state"
          />
          <Card
            label="Unflushed edits"
            value={chaos.offline || stats === null ? '—' : stats.pendingEdits}
            hint="not yet in Postgres"
          />
          <Card
            label="Last flush"
            value={chaos.offline || stats === null ? '—' : formatAge(telemetry.sinceFlushMs)}
            hint={stats?.lastFlushOutcome ? `last attempt: ${stats.lastFlushOutcome}` : 'snapshot to Postgres'}
          />
          <Card label="Sockets here" value={chaos.offline || stats === null ? '—' : stats.sockets} hint="on this server instance" />
        </div>
        <Sparkline
          summary="Packets per second over the last minute, inbound and outbound"
          lines={[
            { label: 'in', values: telemetry.history.in, className: 'stroke-blue-500' },
            { label: 'out', values: telemetry.history.out, className: 'stroke-emerald-500' },
          ]}
        />
        <p className="flex gap-3 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-0.5 w-3 bg-blue-500" /> inbound
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-0.5 w-3 bg-emerald-500" /> outbound
          </span>
        </p>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          Flush numbers come from the server instance you are connected to. Another instance may have saved since.
        </p>
      </Section>

      <Section title="Network chaos" icon={<PlugZap size={13} aria-hidden />}>
        <div>
          <label htmlFor="chaos-latency" className="flex items-center justify-between text-sm">
            <span>Artificial latency</span>
            <span className="tabular-nums font-medium">{chaos.latencyMs} ms each way</span>
          </label>
          <input
            id="chaos-latency"
            type="range"
            min={0}
            max={MAX_ARTIFICIAL_LATENCY_MS}
            step={50}
            value={chaos.latencyMs}
            onChange={(event) => provider.setArtificialLatency(Number(event.target.value))}
            className="mt-1 w-full"
          />
          <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            Delays everything this browser sends and receives. Watch other people&apos;s cursors lag while edits still merge in order.
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-700">
          <div className="min-w-0 flex-1">
            <p id="chaos-offline-label" className="text-sm font-medium">
              Simulate split-brain
            </p>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              Cuts this browser off while you keep editing the notes and whiteboard. On reconnect both sides exchange what the other missed.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={chaos.offline}
            aria-labelledby="chaos-offline-label"
            onClick={() => provider.setOffline(!chaos.offline)}
            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
              chaos.offline ? 'bg-amber-500' : 'bg-neutral-300 dark:bg-neutral-600'
            }`}
          >
            <span
              aria-hidden
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${chaos.offline ? 'left-[1.375rem]' : 'left-0.5'}`}
            />
          </button>
        </div>

        {chaos.offline ? (
          <p role="status" className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <Plug size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Offline (simulated). <strong className="tabular-nums">{formatBytes(telemetry.unsyncedBytes) || '0 B'}</strong> of your edits are waiting to be sent.
            </span>
          </p>
        ) : null}
        {!chaos.offline && telemetry.reconcile ? (
          <p role="status" className="rounded-lg bg-emerald-50 p-2.5 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
            Reconnected and merged in <span className="tabular-nums">{telemetry.reconcile.durationMs} ms</span>: sent{' '}
            <span className="tabular-nums">{formatBytes(telemetry.reconcile.sentBytes)}</span>, received{' '}
            <span className="tabular-nums">{formatBytes(telemetry.reconcile.receivedBytes)}</span>. Nothing lost.
          </p>
        ) : null}
      </Section>

      <Section title="Ghost collaborators" icon={<Bot size={13} aria-hidden />}>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          A ghost is a second, real client of the server. It draws a figure-eight cursor
          {canEdit ? ', adds sticky notes, moves them, and types in the notes' : ''}, so you can test multiplayer alone.
          {!canEdit ? ` As a ${role.toLowerCase()} you get cursor-only ghosts, because the server would drop their edits.` : ''}
        </p>

        {ghostsRunning ? (
          <ul aria-label="Running ghosts" className="space-y-1">
            {ghosts.ghosts.map((ghost) => (
              <li key={ghost.index} className="flex items-center gap-2 text-sm">
                <span aria-hidden style={{ backgroundColor: ghost.color }} className="h-3 w-3 rounded-full" />
                {ghost.name}
              </li>
            ))}
          </ul>
        ) : null}

        {confirming ? (
          <div role="alert" className="space-y-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <p>Ghosts add sample sticky notes and text that everyone in this room will see. They can be removed when you stop them.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={addGhost}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900"
              >
                Add a ghost
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-white dark:border-neutral-600"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!ghosts.canSpawn}
              onClick={addGhost}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 dark:border-neutral-600 dark:hover:bg-neutral-800"
            >
              <Bot size={15} aria-hidden />
              {ghosts.canSpawn ? 'Spawn ghost collaborator' : `Maximum of ${ghosts.max} ghosts`}
            </button>
            {ghostsRunning ? (
              <button
                type="button"
                onClick={() => void ghosts.stopAll(removeOnStop)}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-neutral-600 dark:hover:bg-neutral-800"
              >
                Stop {ghosts.ghosts.length === 1 ? 'ghost' : 'all'}
              </button>
            ) : null}
          </div>
        )}

        {canEdit ? (
          <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
            <input type="checkbox" checked={removeOnStop} onChange={(event) => setRemoveOnStop(event.target.checked)} />
            Remove what ghosts added when I stop them
          </label>
        ) : null}
      </Section>
    </div>
  );
}

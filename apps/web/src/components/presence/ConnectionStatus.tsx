'use client';

import type { ChaosState, ProviderStatus } from '@wb/shared/client';

interface ConnectionStatusProps {
  status: ProviderStatus;
  synced: boolean;
  latency: number | null;
  /** What the Chaos Lab is imposing right now. */
  chaos: ChaosState;
  /** Whether the Chaos Lab panel is open. */
  open: boolean;
  onToggle: () => void;
}

type Tone = 'good' | 'slow' | 'bad' | 'wait';

const DOT: Readonly<Record<Tone, string>> = {
  good: 'bg-emerald-500',
  slow: 'bg-amber-500',
  bad: 'bg-red-500',
  wait: 'bg-amber-500 animate-pulse',
};

/**
 * "Live • 18ms" while connected and in sync. Otherwise it says what is going on. It is also the
 * button that opens the Network & concurrency lab.
 */
export function ConnectionStatus({ status, synced, latency, chaos, open, onToggle }: ConnectionStatusProps) {
  let tone: Tone;
  let text: string;

  if (chaos.offline) {
    tone = 'slow';
    text = 'Offline (simulated)';
  } else if (status === 'connected' && synced) {
    tone = latency !== null && latency > 400 ? 'bad' : latency !== null && latency > 150 ? 'slow' : 'good';
    text = latency === null ? 'Live' : `Live • ${latency}ms`;
  } else if (status === 'connected') {
    tone = 'wait';
    text = 'Syncing…';
  } else if (status === 'connecting') {
    tone = 'wait';
    text = 'Connecting…';
  } else {
    tone = 'bad';
    text = 'Offline / Reconnecting…';
  }

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Connection: ${text}. Open the network and concurrency lab.`}
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
        open
          ? 'border-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100'
          : 'border-transparent text-neutral-600 hover:border-neutral-300 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-800'
      }`}
    >
      <span role="status" className="inline-flex items-center gap-1.5">
        <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[tone]}`} />
        <span className="tabular-nums">{text}</span>
        {!chaos.offline && chaos.latencyMs > 0 ? (
          <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-100">
            +{chaos.latencyMs}ms sim
          </span>
        ) : null}
      </span>
    </button>
  );
}

'use client';

import { TELEMETRY_POLL_MS, type RoomStats } from '@wb/shared';
import type { ChaosState, FrameCounter, ReconcileReport, RoomProvider } from '@wb/shared/client';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { HISTORY_LENGTH, pushHistory, rate } from '@/lib/telemetry/rates';

export interface PerSecond {
  inFrames: number;
  outFrames: number;
  inBytes: number;
  outBytes: number;
  inSync: number;
  outSync: number;
  inAwareness: number;
  outAwareness: number;
}

export interface Telemetry {
  perSecond: PerSecond;
  /** Frames per second for the last minute. */
  history: { in: number[]; out: number[] };
  /** The document's compacted binary size, or null before the first sample. */
  docBytes: number | null;
  stats: RoomStats | null;
  /** How old the server numbers are on the server's own clock. Null if never flushed. */
  sinceFlushMs: number | null;
  chaos: ChaosState;
  unsyncedBytes: number;
  reconcile: ReconcileReport | null;
}

const ZERO: PerSecond = { inFrames: 0, outFrames: 0, inBytes: 0, outBytes: 0, inSync: 0, outSync: 0, inAwareness: 0, outAwareness: 0 };
/** Past this size, measuring the document every second would itself cost something. */
const BIG_DOC_BYTES = 1024 * 1024;

function copy(counter: FrameCounter): FrameCounter {
  return { ...counter };
}

/**
 * Live numbers for the Chaos Lab. It samples only while `enabled`, so a closed panel costs nothing:
 * no timer, no stats requests, and no measuring of the document.
 */
export function useTelemetry(provider: RoomProvider, doc: Y.Doc, enabled: boolean): Telemetry {
  const [telemetry, setTelemetry] = useState<Telemetry>(() => ({
    perSecond: ZERO,
    history: { in: [], out: [] },
    docBytes: null,
    stats: provider.roomStats,
    sinceFlushMs: null,
    chaos: provider.chaos,
    unsyncedBytes: 0,
    reconcile: provider.lastReconcile,
  }));

  useEffect(() => {
    if (!enabled) return undefined;

    let previous = { in: copy(provider.traffic.in), out: copy(provider.traffic.out), at: performance.now() };
    let tick = 0;

    const sinceFlush = (stats: RoomStats | null) =>
      stats && stats.lastFlushAt !== null ? Math.max(0, stats.serverTime - stats.lastFlushAt) : null;

    const sample = () => {
      const now = performance.now();
      const seconds = (now - previous.at) / 1000;
      const inNow = provider.traffic.in;
      const outNow = provider.traffic.out;
      const perSecond: PerSecond = {
        inFrames: rate(previous.in.frames, inNow.frames, seconds),
        outFrames: rate(previous.out.frames, outNow.frames, seconds),
        inBytes: rate(previous.in.bytes, inNow.bytes, seconds),
        outBytes: rate(previous.out.bytes, outNow.bytes, seconds),
        inSync: rate(previous.in.sync, inNow.sync, seconds),
        outSync: rate(previous.out.sync, outNow.sync, seconds),
        inAwareness: rate(previous.in.awareness, inNow.awareness, seconds),
        outAwareness: rate(previous.out.awareness, outNow.awareness, seconds),
      };
      previous = { in: copy(inNow), out: copy(outNow), at: now };
      tick += 1;

      setTelemetry((current) => {
        // Encoding the document is O(size). Every other second is plenty, and a big one is rarer still.
        const measure = current.docBytes === null || (tick % (current.docBytes > BIG_DOC_BYTES ? 10 : 2) === 0);
        return {
          ...current,
          perSecond,
          history: {
            in: pushHistory(current.history.in, perSecond.inFrames, HISTORY_LENGTH),
            out: pushHistory(current.history.out, perSecond.outFrames, HISTORY_LENGTH),
          },
          docBytes: measure ? Y.encodeStateAsUpdate(doc).byteLength : current.docBytes,
          unsyncedBytes: provider.unsyncedBytes(),
        };
      });
      provider.requestStats();
    };

    const offStats = provider.on('stats', (stats) => setTelemetry((current) => ({ ...current, stats, sinceFlushMs: sinceFlush(stats) })));
    const offChaos = provider.on('chaos', (chaos) => setTelemetry((current) => ({ ...current, chaos })));
    const offReconcile = provider.on('reconcile', (reconcile) => setTelemetry((current) => ({ ...current, reconcile })));

    sample();
    const timer = setInterval(sample, TELEMETRY_POLL_MS);
    return () => {
      clearInterval(timer);
      offStats();
      offChaos();
      offReconcile();
    };
  }, [provider, doc, enabled]);

  return telemetry;
}

'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { Rect } from 'react-konva';
import type { Box } from '@/lib/whiteboard/geometry';

const DURATION_MS = 1500;
const PULSES = 3;
const ACCENT = '#2563eb';

interface PulseRingProps {
  bounds: Box;
  startedAt: number;
  viewScale: number;
  onDone: () => void;
}

/** A ring that swells and fades around a shape a few times, to say "this is the one". */
export function PulseRing({ bounds, startedAt, viewScale, onDone }: PulseRingProps) {
  const [now, setNow] = useState(startedAt);
  const finish = useEffectEvent(onDone);

  useEffect(() => {
    let frame = 0;
    const tick = (time: number) => {
      setNow(time);
      if (time - startedAt < DURATION_MS) frame = requestAnimationFrame(tick);
      else finish();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [startedAt]);

  const progress = Math.min(1, Math.max(0, (now - startedAt) / DURATION_MS));
  const phase = (progress * PULSES) % 1;
  const pad = (4 + phase * 22) / viewScale;

  return (
    <Rect
      x={bounds.x - pad}
      y={bounds.y - pad}
      width={bounds.width + pad * 2}
      height={bounds.height + pad * 2}
      stroke={ACCENT}
      strokeWidth={3 / viewScale}
      cornerRadius={6 / viewScale}
      opacity={(1 - phase) * (1 - progress * 0.3)}
      listening={false}
    />
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { Circle, Layer, Line } from 'react-konva';
import type { Point } from '@/lib/whiteboard/geometry';
import { appendTrail, pruneTrail, trailAlpha, type TrailPoint } from '@/lib/whiteboard/presence';

export interface LaserEntry {
  /** Stable per person, so a trail is not split in two. */
  key: string;
  color: string;
  /** Where the laser is now, or null when its owner put it down. */
  point: Point | null;
}

interface Trail {
  color: string;
  points: TrailPoint[];
  head: Point | null;
}

interface TrailView extends Trail {
  key: string;
  now: number;
}

interface LaserLayerProps {
  entries: readonly LaserEntry[];
  viewScale: number;
}

/**
 * Fading laser trails. Only the laser's current position travels over the network. Each
 * browser builds the trail itself, which keeps the traffic tiny and the trail smooth. Nothing
 * here is ever written to the document.
 */
export function LaserLayer({ entries, viewScale }: LaserLayerProps) {
  const trails = useRef(new Map<string, Trail>());
  const frame = useRef<number | null>(null);
  const [views, setViews] = useState<TrailView[]>([]);

  useEffect(() => {
    const step = (now: number) => {
      const next: TrailView[] = [];
      for (const [key, trail] of trails.current) {
        trail.points = pruneTrail(trail.points, now);
        if (trail.points.length === 0 && !trail.head) {
          trails.current.delete(key);
          continue;
        }
        next.push({ key, now, color: trail.color, points: trail.points, head: trail.head });
      }
      setViews(next);
      // The loop runs only while something is visible, so an idle board costs nothing.
      frame.current = trails.current.size > 0 ? requestAnimationFrame(step) : null;
    };

    const now = performance.now();
    for (const entry of entries) {
      const trail = trails.current.get(entry.key) ?? { color: entry.color, points: [], head: null };
      trail.color = entry.color;
      trail.head = entry.point;
      if (entry.point) trail.points = appendTrail(trail.points, entry.point, now);
      trails.current.set(entry.key, trail);
    }
    if (frame.current === null && trails.current.size > 0) frame.current = requestAnimationFrame(step);
  }, [entries]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  const counter = 1 / viewScale;

  return (
    <Layer listening={false}>
      {views.flatMap((view) => {
        const segments = view.points.slice(1).map((point, index) => {
          const from = view.points[index];
          if (!from) return null;
          const alpha = trailAlpha(point, view.now);
          return (
            <Line
              key={`${view.key}-${point.t}-${index}`}
              points={[from.x, from.y, point.x, point.y]}
              stroke={view.color}
              strokeWidth={(1.5 + 4.5 * alpha) * counter}
              opacity={alpha}
              lineCap="round"
            />
          );
        });
        return [
          ...segments,
          view.head ? (
            <Circle
              key={`${view.key}-head`}
              x={view.head.x}
              y={view.head.y}
              radius={6 * counter}
              fill={view.color}
              shadowColor={view.color}
              shadowBlur={14}
              shadowOpacity={0.9}
            />
          ) : null,
        ];
      })}
    </Layer>
  );
}

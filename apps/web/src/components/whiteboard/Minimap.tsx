'use client';

import type { Shape } from '@wb/shared';
import { useRef, type PointerEvent } from 'react';
import { shapeBounds, unionBounds, type Point } from '@/lib/whiteboard/geometry';
import { viewportBounds, type Size, type View } from '@/lib/whiteboard/viewport';

const WIDTH = 192;
const HEIGHT = 128;
const PADDING = 8;

interface MinimapProps {
  shapes: readonly Shape[];
  view: View;
  size: Size;
  /** Called with the world point the camera should center on. */
  onNavigate: (center: Point) => void;
}

function shapeColor(shape: Shape): string {
  if (shape.type === 'path' || shape.type === 'arrow') return shape.stroke;
  if ('fill' in shape) return shape.fill;
  return '#9ca3af';
}

/** A small map of the whole board. Click or drag on it to move the camera. */
export function Minimap({ shapes, view, size, onNavigate }: MinimapProps) {
  const surface = useRef<SVGSVGElement>(null);
  const visible = viewportBounds(view, size);
  const world = unionBounds([...shapes.map(shapeBounds), visible]) ?? visible;

  const ratio = Math.min(
    (WIDTH - PADDING * 2) / Math.max(1, world.width),
    (HEIGHT - PADDING * 2) / Math.max(1, world.height),
  );
  const offsetX = (WIDTH - world.width * ratio) / 2 - world.x * ratio;
  const offsetY = (HEIGHT - world.height * ratio) / 2 - world.y * ratio;

  function navigate(event: PointerEvent<SVGSVGElement>) {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    onNavigate({
      x: (event.clientX - rect.left - offsetX) / ratio,
      y: (event.clientY - rect.top - offsetY) / ratio,
    });
  }

  return (
    <svg
      ref={surface}
      role="img"
      aria-label="Minimap. Click or drag to move around the board."
      width={WIDTH}
      height={HEIGHT}
      className="absolute bottom-16 right-3 z-10 cursor-pointer touch-none rounded-2xl border border-neutral-200 bg-white/95 shadow-md dark:border-neutral-700 dark:bg-neutral-800/95"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        navigate(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) navigate(event);
      }}
    >
      {shapes.map((shape) => {
        const box = shapeBounds(shape);
        return (
          <rect
            key={shape.id}
            x={box.x * ratio + offsetX}
            y={box.y * ratio + offsetY}
            width={Math.max(1.5, box.width * ratio)}
            height={Math.max(1.5, box.height * ratio)}
            fill={shapeColor(shape)}
            opacity={0.75}
            rx={1}
          />
        );
      })}
      <rect
        x={visible.x * ratio + offsetX}
        y={visible.y * ratio + offsetY}
        width={visible.width * ratio}
        height={visible.height * ratio}
        fill="rgba(37, 99, 235, 0.08)"
        stroke="#2563eb"
        strokeWidth={1.5}
      />
    </svg>
  );
}

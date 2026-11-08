'use client';

import type { Shape } from '@wb/shared';
import type { Group as GroupNode } from 'konva/lib/Group';
import type { Layer as LayerNode } from 'konva/lib/Layer';
import { useEffect, useRef } from 'react';
import { Circle, Group, Label, Layer, Line, Rect, Tag, Text } from 'react-konva';
import { shapeBounds, unionBounds, type Point } from '@/lib/whiteboard/geometry';
import { smoothTo } from '@/lib/whiteboard/presence';
import type { Peer } from './useBoard';

/** An arrow-shaped pointer, tip at the origin. */
const CURSOR_POINTS = [0, 0, 0, 16, 4.5, 12.5, 8, 19, 10.5, 18, 7, 11.5, 12, 11.5];

interface PeerLayerProps {
  peers: readonly Peer[];
  byId: ReadonlyMap<string, Shape>;
  viewScale: number;
  /** User ids talking in the huddle. Their cursors get a green ring. */
  speaking: ReadonlySet<string>;
}

/**
 * Other people's cursors and selections. Cursor positions arrive about 25 times a second, so
 * each cursor glides toward its latest position every frame instead of jumping. The animation
 * moves Konva nodes directly, which keeps React out of the per-frame path.
 */
export function PeerLayer({ peers, byId, viewScale, speaking }: PeerLayerProps) {
  const layer = useRef<LayerNode>(null);
  const nodes = useRef(new Map<number, GroupNode>());
  const shown = useRef(new Map<number, Point>());
  const targets = useRef(new Map<number, Point>());

  useEffect(() => {
    const next = new Map<number, Point>();
    for (const peer of peers) if (peer.pointer) next.set(peer.clientId, peer.pointer);
    targets.current = next;
    // Forget cursors that left, so one that returns appears in place instead of sliding in.
    for (const id of shown.current.keys()) if (!next.has(id)) shown.current.delete(id);
  }, [peers]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(100, now - last);
      last = now;
      let moved = false;
      for (const [id, node] of nodes.current) {
        const target = targets.current.get(id);
        const current = shown.current.get(id);
        if (!target || !current) continue;
        const next = smoothTo(current, target, elapsed);
        if (next.x === current.x && next.y === current.y) continue;
        shown.current.set(id, next);
        node.position(next);
        moved = true;
      }
      if (moved) layer.current?.batchDraw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  function attach(id: number, node: GroupNode | null, pointer: Point) {
    if (!node) {
      nodes.current.delete(id);
      return;
    }
    nodes.current.set(id, node);
    const start = shown.current.get(id) ?? pointer;
    shown.current.set(id, start);
    node.position(start);
  }

  const pad = 4 / viewScale;
  const counter = 1 / viewScale;

  return (
    <Layer ref={layer} listening={false}>
      {peers.flatMap((peer) => {
        const rings = peer.selection?.flatMap((id) => {
          const shape = byId.get(id);
          return shape ? [shape] : [];
        });
        if (!rings || rings.length === 0) return [];
        const bounds = unionBounds(rings.map(shapeBounds));
        return [
          <Group key={`selection-${peer.clientId}`}>
            {rings.map((shape) => {
              const box = shapeBounds(shape);
              return (
                <Rect
                  key={shape.id}
                  x={box.x - pad}
                  y={box.y - pad}
                  width={box.width + pad * 2}
                  height={box.height + pad * 2}
                  stroke={peer.user.color}
                  strokeWidth={2 * counter}
                  cornerRadius={3 * counter}
                />
              );
            })}
            {bounds ? (
              <Group x={bounds.x - pad} y={bounds.y - pad - 18 * counter} scaleX={counter} scaleY={counter}>
                <Label>
                  <Tag fill={peer.user.color} cornerRadius={3} />
                  <Text text={peer.user.name} fontSize={11} padding={3} fill="#ffffff" />
                </Label>
              </Group>
            ) : null}
          </Group>,
        ];
      })}
      {peers.flatMap((peer) =>
        peer.pointer
          ? [
              <Group
                key={`cursor-${peer.clientId}`}
                ref={(node) => attach(peer.clientId, node, peer.pointer ?? { x: 0, y: 0 })}
                scaleX={counter}
                scaleY={counter}
              >
                {/* A ghost shares its user's id, so only a real cursor can be the one speaking. */}
                {peer.ghost !== true && speaking.has(peer.user.id) ? (
                  <Circle x={4} y={8} radius={17} stroke="#22c55e" strokeWidth={3} opacity={0.9} />
                ) : null}
                <Line points={CURSOR_POINTS} closed fill={peer.user.color} stroke="#ffffff" strokeWidth={1.2} lineJoin="round" />
                <Label x={12} y={16}>
                  <Tag fill={peer.user.color} cornerRadius={4} />
                  <Text text={peer.user.name} fontSize={11} padding={4} fill="#ffffff" />
                </Label>
              </Group>,
            ]
          : [],
      )}
    </Layer>
  );
}

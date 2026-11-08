'use client';

import type { Shape } from '@wb/shared';
import type { Node } from 'konva/lib/Node';
import type { Transformer as TransformerNode } from 'konva/lib/shapes/Transformer';
import { useEffect, useRef } from 'react';
import { Layer, Rect, Transformer } from 'react-konva';
import { shapeBounds, unionBounds, type Box } from '@/lib/whiteboard/geometry';
import { MIN_SHAPE_SIZE, transformPatch } from '@/lib/whiteboard/transform';

const ALL_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-right',
  'middle-left',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];
const CORNER_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const ACCENT = '#2563eb';
const GROUP_COLOR = '#7c3aed';

interface SelectionLayerProps {
  selected: readonly Shape[];
  /** Resize and rotate handles are for editors with the select tool. */
  canTransform: boolean;
  /** A viewer sees which shapes are selected, with a plain outline and no handles. */
  showOutline: boolean;
  /** One dashed box around each selected group, so a group reads as a single object. */
  groupBoxes: readonly Box[];
  viewScale: number;
  marquee: Box | null;
  onTransformStart: () => void;
  onTransformEnd: (patches: Record<string, Partial<Shape>>) => void;
}

/** Marquee, resize and rotate handles, and the selection outline. */
export function SelectionLayer({
  selected,
  canTransform,
  showOutline,
  groupBoxes,
  viewScale,
  marquee,
  onTransformStart,
  onTransformEnd,
}: SelectionLayerProps) {
  const transformer = useRef<TransformerNode>(null);

  // Connectors have no box of their own, because their ends follow the shapes they join.
  const targets = canTransform ? selected.filter((shape) => shape.type !== 'arrow') : [];
  const onlyText = targets.length > 0 && targets.every((shape) => shape.type === 'text');

  // Nodes can be replaced between renders (an image swaps its placeholder when it loads),
  // so the handles are re-attached every render. Setting identical nodes is skipped.
  useEffect(() => {
    const tr = transformer.current;
    const stage = tr?.getStage();
    if (!tr || !stage) return;
    const nodes = targets.flatMap((shape): Node[] => {
      const node = stage.findOne(`#${shape.id}`);
      return node ? [node] : [];
    });
    const current = tr.nodes();
    if (nodes.length !== current.length || nodes.some((node, index) => node !== current[index])) tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  });

  function finish() {
    const tr = transformer.current;
    if (!tr) return;
    const byId = new Map(targets.map((shape) => [shape.id, shape]));
    const patches: Record<string, Partial<Shape>> = {};
    for (const node of tr.nodes()) {
      const shape = byId.get(node.id());
      if (!shape) continue;
      const patch = transformPatch(shape, {
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
      });
      // The scale now lives in the shape's own size, so the node goes back to 1.
      node.scaleX(1);
      node.scaleY(1);
      if (patch) patches[shape.id] = patch;
    }
    onTransformEnd(patches);
  }

  const outline = showOutline ? unionBounds(selected.map(shapeBounds)) : null;

  return (
    <Layer>
      {canTransform ? (
        <Transformer
          ref={transformer}
          flipEnabled={false}
          rotateEnabled
          keepRatio={onlyText}
          enabledAnchors={onlyText ? CORNER_ANCHORS : ALL_ANCHORS}
          rotationSnaps={[0, 90, 180, 270]}
          rotationSnapTolerance={5}
          anchorSize={9}
          anchorCornerRadius={2}
          anchorStroke={ACCENT}
          anchorFill="#ffffff"
          borderStroke={ACCENT}
          boundBoxFunc={(previous, next) =>
            Math.abs(next.width) < MIN_SHAPE_SIZE * viewScale || Math.abs(next.height) < MIN_SHAPE_SIZE * viewScale
              ? previous
              : next
          }
          onTransformStart={onTransformStart}
          onTransformEnd={finish}
        />
      ) : null}
      {outline ? (
        <Rect
          x={outline.x}
          y={outline.y}
          width={outline.width}
          height={outline.height}
          stroke={ACCENT}
          strokeWidth={1.5 / viewScale}
          dash={[6 / viewScale, 4 / viewScale]}
          listening={false}
        />
      ) : null}
      {groupBoxes.map((box) => (
        <Rect
          key={`${box.x}:${box.y}:${box.width}:${box.height}`}
          x={box.x - 4 / viewScale}
          y={box.y - 4 / viewScale}
          width={box.width + 8 / viewScale}
          height={box.height + 8 / viewScale}
          stroke={GROUP_COLOR}
          strokeWidth={1.5 / viewScale}
          dash={[2 / viewScale, 4 / viewScale]}
          listening={false}
        />
      ))}
      {marquee ? (
        <Rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.width}
          height={marquee.height}
          fill="rgba(37, 99, 235, 0.08)"
          stroke={ACCENT}
          strokeWidth={1 / viewScale}
          listening={false}
        />
      ) : null}
    </Layer>
  );
}

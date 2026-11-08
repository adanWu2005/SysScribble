'use client';

import type { Shape } from '@wb/shared';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Arrow, Ellipse, Group, Line, Rect, Text } from 'react-konva';
import { arrowEndpoints } from '@/lib/whiteboard/geometry';
import { displayInk } from '@/lib/whiteboard/style';
import { ImageNode } from './ImageNode';

interface ShapeNodeProps {
  shape: Shape;
  /** Every shape by id. Connectors read it to find the shapes they are attached to. */
  byId: ReadonlyMap<string, Shape>;
  roomId: string;
  /** Whether the node takes pointer events. Off for drawing tools and while panning. */
  interactive: boolean;
  draggable: boolean;
  /** Dark board: the default ink is drawn light so it stays visible. */
  dark: boolean;
  selected: boolean;
  /** Hides the drawn text while the editor overlay is showing it. */
  editing: boolean;
  onPress: (id: string, additive: boolean) => void;
  onDragStart: (id: string) => void;
  /** May return a corrected position (a snap), which the node is moved to. */
  onDragMove: (id: string, x: number, y: number, bypassSnap: boolean) => { x: number; y: number } | void;
  onDragEnd: (id: string, x: number, y: number, bypassSnap: boolean) => void;
  onEditText: (id: string) => void;
  onOpenFile: (assetId: string) => void;
}

const LINE_HEIGHT = 1.2;

/** No border unless one was set. Konva rejects an explicit `undefined`, so the keys are left out. */
function borderProps(shape: { stroke?: string | undefined; strokeWidth?: number | undefined }, dark: boolean) {
  return shape.stroke ? { stroke: displayInk(shape.stroke, dark), strokeWidth: shape.strokeWidth ?? 2 } : { strokeWidth: 0 };
}

/** Text is drawn to canvas by Konva, so a label can never become markup (PRD §5.5). */
export function ShapeNode({
  shape,
  byId,
  roomId,
  interactive,
  draggable,
  dark,
  selected,
  editing,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
  onEditText,
  onOpenFile,
}: ShapeNodeProps) {
  const common = {
    id: shape.id,
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation,
    opacity: shape.opacity ?? 1,
    listening: interactive,
    draggable,
    onMouseDown: (event: KonvaEventObject<MouseEvent>) => {
      // Only the primary button selects. The middle button pans, which the stage handles.
      if (event.evt.button !== 0) return;
      event.cancelBubble = true;
      onPress(shape.id, event.evt.shiftKey);
    },
    onTap: (event: KonvaEventObject<Event>) => {
      event.cancelBubble = true;
      onPress(shape.id, false);
    },
    onDragStart: () => onDragStart(shape.id),
    onDragMove: (event: KonvaEventObject<DragEvent>) => {
      const corrected = onDragMove(shape.id, event.target.x(), event.target.y(), event.evt.altKey);
      if (corrected) event.target.position(corrected);
    },
    onDragEnd: (event: KonvaEventObject<DragEvent>) =>
      onDragEnd(shape.id, event.target.x(), event.target.y(), event.evt.altKey),
  };
  const edit = {
    onDblClick: () => onEditText(shape.id),
    onDblTap: () => onEditText(shape.id),
  };

  switch (shape.type) {
    case 'rect':
      return (
        <Group {...common} {...edit}>
          <Rect width={shape.width} height={shape.height} fill={shape.fill} {...borderProps(shape, dark)} />
          <Text
            visible={!editing}
            text={shape.text ?? ''}
            width={shape.width}
            height={shape.height}
            padding={8}
            align="center"
            verticalAlign="middle"
            fontSize={16}
            lineHeight={LINE_HEIGHT}
            fill="#1f2937"
            listening={false}
          />
        </Group>
      );
    case 'ellipse':
      return (
        <Group {...common} {...edit}>
          <Ellipse radiusX={shape.width / 2} radiusY={shape.height / 2} fill={shape.fill} {...borderProps(shape, dark)} />
          <Text
            visible={!editing}
            x={-shape.width / 2}
            y={-shape.height / 2}
            text={shape.text ?? ''}
            width={shape.width}
            height={shape.height}
            padding={8}
            align="center"
            verticalAlign="middle"
            fontSize={16}
            lineHeight={LINE_HEIGHT}
            fill="#1f2937"
            listening={false}
          />
        </Group>
      );
    case 'sticky':
      return (
        <Group {...common} {...edit}>
          <Rect
            width={shape.width}
            height={shape.height}
            fill={shape.fill}
            cornerRadius={4}
            {...borderProps(shape, dark)}
            shadowColor="#000000"
            shadowBlur={8}
            shadowOpacity={0.15}
            shadowOffsetY={2}
          />
          <Text
            visible={!editing}
            text={shape.text}
            width={shape.width}
            height={shape.height}
            padding={10}
            fontSize={14}
            lineHeight={LINE_HEIGHT}
            fill="#1f2937"
            listening={false}
          />
          {shape.authorName ? (
            <Text
              x={10}
              y={shape.height - 20}
              width={shape.width - 20}
              text={shape.authorName}
              fontSize={10}
              align="right"
              wrap="none"
              ellipsis
              fill="#1f2937"
              opacity={0.5}
              listening={false}
            />
          ) : null}
        </Group>
      );
    case 'text':
      return (
        <Text
          {...common}
          {...edit}
          visible={!editing}
          text={shape.text === '' ? ' ' : shape.text}
          {...(shape.width !== undefined ? { width: shape.width } : {})}
          fontSize={shape.fontSize}
          lineHeight={LINE_HEIGHT}
          fill={displayInk(shape.fill, dark)}
        />
      );
    case 'file':
      return (
        <Group {...common} onDblClick={() => onOpenFile(shape.assetId)} onDblTap={() => onOpenFile(shape.assetId)}>
          <Rect width={shape.width} height={shape.height} fill="#fecaca" cornerRadius={4} />
          <Text
            text={`PDF\n${shape.filename}`}
            width={shape.width}
            height={shape.height}
            padding={10}
            fontSize={13}
            fill="#1f2937"
            listening={false}
          />
        </Group>
      );
    case 'path':
      return (
        <Line
          {...common}
          points={shape.points}
          stroke={displayInk(shape.stroke, dark)}
          strokeWidth={shape.strokeWidth}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(12, shape.strokeWidth)}
        />
      );
    case 'image':
      return <ImageNode {...common} roomId={roomId} shape={shape} />;
    case 'arrow': {
      const { start, end } = arrowEndpoints(shape, byId);
      const attached = shape.startShapeId !== undefined || shape.endShapeId !== undefined;
      return (
        <Arrow
          {...common}
          // A connected arrow follows its shapes, so dragging it on its own would do nothing.
          draggable={draggable && !attached}
          points={[start.x - shape.x, start.y - shape.y, end.x - shape.x, end.y - shape.y]}
          stroke={displayInk(shape.stroke, dark)}
          fill={displayInk(shape.stroke, dark)}
          strokeWidth={shape.strokeWidth}
          pointerLength={8 + shape.strokeWidth * 2}
          pointerWidth={8 + shape.strokeWidth * 2}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(14, shape.strokeWidth)}
          shadowColor="#2563eb"
          shadowBlur={selected ? 10 : 0}
          shadowOpacity={selected ? 0.9 : 0}
        />
      );
    }
  }
}

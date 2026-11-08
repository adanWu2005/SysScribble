'use client';

import type { Shape } from '@wb/shared';
import { useState } from 'react';
import { localBox } from '@/lib/whiteboard/geometry';
import type { View } from '@/lib/whiteboard/viewport';

type TextShape = Extract<Shape, { type: 'sticky' | 'rect' | 'ellipse' | 'text' }>;

export function isTextEditable(shape: Shape): shape is TextShape {
  return shape.type === 'sticky' || shape.type === 'rect' || shape.type === 'ellipse' || shape.type === 'text';
}

const LINE_HEIGHT = 1.2;
const LABEL_PADDING = 8;
const STICKY_PADDING = 10;

interface TextEditorOverlayProps {
  shape: TextShape;
  view: View;
  /** Called once, when editing ends, with the final text. */
  onDone: (text: string) => void;
}

function fontSizeOf(shape: TextShape): number {
  if (shape.type === 'text') return shape.fontSize;
  return shape.type === 'sticky' ? 14 : 16;
}

/**
 * A native textarea laid over the shape for typing. The result is stored as a plain string
 * and drawn by Konva, so the text can never become markup (PRD §5.5).
 */
export function TextEditorOverlay({ shape, view, onDone }: TextEditorOverlayProps) {
  const [value, setValue] = useState(shape.text ?? '');
  const box = localBox(shape);
  const fontSize = fontSizeOf(shape);
  const centered = shape.type === 'rect' || shape.type === 'ellipse';
  const padding = shape.type === 'sticky' ? STICKY_PADDING : LABEL_PADDING;

  // Konva centers rect and ellipse labels vertically, and a textarea cannot, so pad it by hand.
  const lines = value.split('\n').length;
  const topPadding = centered ? Math.max(padding, (box.height - lines * fontSize * LINE_HEIGHT) / 2) : padding;
  const isText = shape.type === 'text';

  return (
    <div
      style={{
        position: 'absolute',
        left: shape.x * view.scale + view.x,
        top: shape.y * view.scale + view.y,
        transformOrigin: '0 0',
        transform: `scale(${view.scale}) rotate(${shape.rotation}deg)`,
        pointerEvents: 'none',
      }}
      className="z-20"
    >
      <textarea
        autoFocus
        aria-label="Shape text"
        maxLength={2000}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => onDone(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
            event.currentTarget.blur();
          }
        }}
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: isText ? Math.max(box.width + 24, 160) : box.width,
          height: isText ? Math.max(box.height + 12, fontSize * 1.6) : box.height,
          paddingTop: isText ? 0 : topPadding,
          paddingLeft: isText ? 2 : padding,
          paddingRight: isText ? 2 : padding,
          paddingBottom: isText ? 0 : padding,
          fontSize,
          lineHeight: LINE_HEIGHT,
          color: isText ? shape.fill : '#1f2937',
          textAlign: centered ? 'center' : 'left',
          pointerEvents: 'auto',
        }}
        className={`resize-none overflow-hidden border-0 bg-transparent font-sans focus:outline-none ${
          isText ? 'outline-dashed outline-1 outline-blue-500' : 'ring-2 ring-blue-500'
        }`}
      />
    </div>
  );
}

import type { ShortcutAction } from '@/lib/whiteboard/shortcuts';
import type { TemplateId } from '@/lib/whiteboard/templates';

/** Things the command palette can ask the board to do, beyond what a key press can. */
export type BoardCommand = ShortcutAction | { type: 'fit' } | { type: 'template'; id: TemplateId };

/** A shape found by the palette's search. The label is already cleaned for display. */
export interface ShapeHit {
  id: string;
  label: string;
}

/** What the rest of the room can ask of the whiteboard. */
export interface CanvasApi {
  /**
   * Selects a shape, flies the camera to it and pulses its border. Returns false when there is
   * no such shape. If the canvas is hidden it waits until the canvas is shown, and still returns true.
   */
  focusShape: (shapeId: string) => boolean;
  /** Runs a board command as if its key had been pressed. Editing commands do nothing for a viewer. */
  perform: (command: BoardCommand) => void;
  /** Shapes whose kind or text contains the query, for "go to" in the palette. */
  searchShapes: (query: string, limit: number) => ShapeHit[];
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { createBoardUndoManager } from '@/lib/whiteboard/model';

export interface BoardHistory {
  undo: () => void;
  redo: () => void;
  /** Ends the current undo step, so the next edit starts a new one. Call it at gesture ends. */
  stopCapturing: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Undo and redo for the local user's own board edits. A viewer gets no manager at all, so
 * there is nothing for a stray shortcut to act on.
 */
export function useBoardHistory(doc: Y.Doc, enabled: boolean): BoardHistory {
  const manager = useRef<ReturnType<typeof createBoardUndoManager> | null>(null);
  const [depth, setDepth] = useState({ undo: 0, redo: 0 });

  useEffect(() => {
    if (!enabled) return undefined;
    const undoManager = createBoardUndoManager(doc);
    manager.current = undoManager;
    const refresh = () => setDepth({ undo: undoManager.undoStack.length, redo: undoManager.redoStack.length });
    undoManager.on('stack-item-added', refresh);
    undoManager.on('stack-item-popped', refresh);
    undoManager.on('stack-cleared', refresh);
    return () => {
      undoManager.off('stack-item-added', refresh);
      undoManager.off('stack-item-popped', refresh);
      undoManager.off('stack-cleared', refresh);
      undoManager.destroy();
      manager.current = null;
    };
  }, [doc, enabled]);

  const undo = useCallback(() => manager.current?.undo(), []);
  const redo = useCallback(() => manager.current?.redo(), []);
  const stopCapturing = useCallback(() => manager.current?.stopCapturing(), []);

  return {
    undo,
    redo,
    stopCapturing,
    canUndo: enabled && depth.undo > 0,
    canRedo: enabled && depth.redo > 0,
  };
}

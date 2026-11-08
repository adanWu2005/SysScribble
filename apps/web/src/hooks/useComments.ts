'use client';

import type { CommentThread } from '@wb/shared';
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { commentsRoot, readThreads } from '@/lib/comments/model';

/** Live, schema-checked comment threads. Re-renders at most once per animation frame. */
export function useComments(doc: Y.Doc): CommentThread[] {
  const [threads, setThreads] = useState<CommentThread[]>(() => readThreads(doc));

  useEffect(() => {
    let frame: number | null = null;
    const refresh = () => {
      frame ??= requestAnimationFrame(() => {
        frame = null;
        setThreads(readThreads(doc));
      });
    };
    const root = commentsRoot(doc);
    root.observeDeep(refresh);
    refresh();
    return () => {
      root.unobserveDeep(refresh);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [doc]);

  return threads;
}

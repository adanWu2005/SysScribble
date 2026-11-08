import { Y_KEYS, canMutate } from '@wb/shared';
import { RoomProvider, type SocketFactory } from '@wb/shared/client';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { Point } from '@/lib/whiteboard/geometry';
import { addShape, deleteShapes, newShapeId, shapesRoot, updateShape } from '@/lib/whiteboard/model';
import {
  MAX_GHOST_CHARS,
  MAX_GHOST_STICKIES,
  NOTE_PHRASES,
  STICKY_COLORS,
  STICKY_TEXTS,
  between,
  easeInOut,
  figureEight,
  ghostColor,
  ghostName,
  lerpPoint,
  pick,
  type Random,
} from './behavior';

export interface GhostAnchor {
  /** The world point at the middle of the real user's screen, and their zoom. */
  x: number;
  y: number;
  scale: number;
}

export interface GhostOptions {
  /** 1 to 3. Decides the name, the color and the phase of the path. */
  index: number;
  /** The real user's id. The server insists a socket carries its own authenticated id. */
  userId: string;
  roomId: string;
  url: string;
  getToken: () => Promise<string>;
  createSocket: SocketFactory;
  getAnchor: () => GhostAnchor;
  onTerminated?: (code: number) => void;
  random?: Random;
  /** Tests pass false to drive the ghost by hand without a network. */
  connect?: boolean;
  tickMs?: number;
}

const DEFAULT_TICK_MS = 50;
/** Long enough for the provider to send its last merged update before it is destroyed. */
const FLUSH_GRACE_MS = 150;
const MAX_LINE_CHARS = 120;

interface Move {
  id: string;
  from: Point;
  to: Point;
  startedAt: number;
  durationMs: number;
}

/**
 * A simulated collaborator, so one person can try multiplayer alone.
 *
 * It is a second, independent Yjs replica with its own awareness and its own WebSocket, signed in
 * as the same user under another display name. Everything it does goes through the real server,
 * so the server's role checks, rate limits and awareness rules apply to it exactly as to a person.
 * A ghost of a viewer can move a cursor and nothing else, because that is all the server allows.
 */
export class GhostClient {
  readonly name: string;
  readonly index: number;
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  readonly provider: RoomProvider;

  private readonly random: Random;
  private readonly startedAt = Date.now();
  private readonly phase: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private stopping = false;

  private readonly stickyIds: string[] = [];
  private readonly stickyPositions = new Map<string, Point>();
  private move: Move | null = null;
  private nextStickyAt = 0;
  private nextMoveAt = 0;

  private readonly paragraphs: Y.XmlElement[] = [];
  private currentText: Y.XmlText | null = null;
  private lineChars = 0;
  private totalChars = 0;
  private phrase = '';
  private phrasePos = 0;
  private nextTypeAt = 0;

  constructor(private readonly options: GhostOptions) {
    this.index = options.index;
    this.name = ghostName(options.index);
    this.random = options.random ?? Math.random;
    this.phase = (options.index - 1) * ((2 * Math.PI) / 3);

    this.awareness.setLocalState({
      user: { id: options.userId, name: this.name, color: ghostColor(options.index) },
      ghost: true,
    });
    this.provider = new RoomProvider({
      url: options.url,
      roomId: options.roomId,
      doc: this.doc,
      awareness: this.awareness,
      getToken: options.getToken,
      createSocket: options.createSocket,
      connect: options.connect ?? true,
    });
    if (options.onTerminated) this.provider.on('terminated', options.onTerminated);

    const now = Date.now();
    this.nextStickyAt = now + between(this.random, 1500, 3000);
    this.nextMoveAt = now + between(this.random, 4000, 7000);
    this.nextTypeAt = now + between(this.random, 800, 2000);
  }

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => this.step(Date.now()), this.options.tickMs ?? DEFAULT_TICK_MS);
  }

  /** Whether the server currently lets this ghost's user edit. A viewer's ghost is cursor-only. */
  get canEdit(): boolean {
    return this.provider.role !== null && canMutate(this.provider.role);
  }

  get stickyCount(): number {
    return this.stickyIds.length;
  }

  get typedChars(): number {
    return this.totalChars;
  }

  /** One beat of behavior. Public so tests can drive it with a fake clock. */
  step(now: number): void {
    if (this.stopped || this.stopping) return;
    const anchor = this.options.getAnchor();
    const seconds = (now - this.startedAt) / 1000;
    const pointer = figureEight(seconds, { x: anchor.x, y: anchor.y }, 160 / Math.max(0.1, anchor.scale), this.phase);
    // Any role may show a cursor. Everything below needs the right to edit.
    this.awareness.setLocalStateField('pointer', pointer);

    if (!this.canEdit) return;
    this.stepMove(now);
    this.stepSticky(now, pointer);
    this.stepType(now);
  }

  private stepSticky(now: number, near: Point): void {
    if (now < this.nextStickyAt || this.stickyIds.length >= MAX_GHOST_STICKIES) return;
    this.nextStickyAt = now + between(this.random, 6000, 11000);

    const id = newShapeId();
    const x = near.x - 80;
    const y = near.y - 80;
    addShape(this.doc, {
      id,
      type: 'sticky',
      x,
      y,
      rotation: 0,
      width: 160,
      height: 120,
      fill: pick(this.random, STICKY_COLORS),
      text: pick(this.random, STICKY_TEXTS),
      authorName: this.name,
    });
    this.stickyIds.push(id);
    this.stickyPositions.set(id, { x, y });
  }

  private stepMove(now: number): void {
    const active = this.move;
    if (active) {
      const t = (now - active.startedAt) / active.durationMs;
      const at = lerpPoint(active.from, active.to, easeInOut(t));
      if (!shapesRoot(this.doc).has(active.id)) {
        this.endMove(now);
        return;
      }
      updateShape(this.doc, active.id, { x: at.x, y: at.y });
      this.stickyPositions.set(active.id, at);
      if (t >= 1) this.endMove(now);
      return;
    }

    if (now < this.nextMoveAt) return;
    // A note someone deleted is forgotten rather than moved.
    for (let i = this.stickyIds.length - 1; i >= 0; i--) {
      const id = this.stickyIds[i];
      if (id !== undefined && !shapesRoot(this.doc).has(id)) {
        this.stickyIds.splice(i, 1);
        this.stickyPositions.delete(id);
      }
    }
    if (this.stickyIds.length === 0) {
      this.nextMoveAt = now + 2000;
      return;
    }
    const id = pick(this.random, this.stickyIds);
    const from = this.stickyPositions.get(id) ?? { x: 0, y: 0 };
    const to = { x: from.x + between(this.random, -140, 140), y: from.y + between(this.random, -100, 100) };
    this.move = { id, from, to, startedAt: now, durationMs: 900 };
    this.awareness.setLocalStateField('selection', [id]);
  }

  private endMove(now: number): void {
    this.move = null;
    this.awareness.setLocalStateField('selection', []);
    this.nextMoveAt = now + between(this.random, 5000, 9000);
  }

  private stepType(now: number): void {
    if (now < this.nextTypeAt || this.totalChars >= MAX_GHOST_CHARS) return;

    if (this.phrasePos >= this.phrase.length) {
      this.phrase = pick(this.random, NOTE_PHRASES);
      this.phrasePos = 0;
    }
    const char = this.phrase[this.phrasePos];
    if (char === undefined) return;

    if (!this.currentText || this.lineChars >= MAX_LINE_CHARS) this.openParagraph();
    this.currentText?.insert(this.currentText.length, char);
    this.phrasePos += 1;
    this.lineChars += 1;
    this.totalChars += 1;

    const finishedPhrase = this.phrasePos >= this.phrase.length;
    this.nextTypeAt = now + (finishedPhrase ? between(this.random, 2000, 3500) : between(this.random, 110, 330));
  }

  /** A new paragraph of the ghost's own, after whatever else is in the notes. */
  private openParagraph(): void {
    const fragment = this.doc.getXmlFragment(Y_KEYS.notes);
    const paragraph = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    paragraph.insert(0, [text]);
    fragment.insert(fragment.length, [paragraph]);
    this.paragraphs.push(paragraph);
    this.currentText = text;
    this.lineChars = 0;
  }

  /** Deletes the sticky notes and paragraphs this ghost made. Returns how many things were removed. */
  removeContent(): number {
    let removed = 0;
    this.doc.transact(() => {
      const ids = this.stickyIds.filter((id) => shapesRoot(this.doc).has(id));
      deleteShapes(this.doc, ids);
      removed += ids.length;

      const fragment = this.doc.getXmlFragment(Y_KEYS.notes);
      for (const paragraph of this.paragraphs) {
        const index = fragment.toArray().indexOf(paragraph);
        if (index >= 0) {
          fragment.delete(index, 1);
          removed += 1;
        }
      }
    });
    this.stickyIds.length = 0;
    this.stickyPositions.clear();
    this.paragraphs.length = 0;
    this.currentText = null;
    this.move = null;
    return removed;
  }

  /** Stops the ghost and closes its socket. With `removeContent`, tidies up what it added first. */
  async stop(removeContent: boolean): Promise<void> {
    if (this.stopped || this.stopping) return;
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (removeContent && this.canEdit) {
      this.removeContent();
      // The provider batches outgoing edits for a few milliseconds. Closing at once would lose them.
      await new Promise((resolve) => setTimeout(resolve, FLUSH_GRACE_MS));
    }
    this.stopped = true;
    this.provider.destroy();
    this.awareness.destroy();
    this.doc.destroy();
  }
}

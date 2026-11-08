'use client';

import {
  CHAT_LINGER_MS,
  LASER_SAMPLE_MS,
  MAX_CURSOR_CHAT_CHARS,
  REACTION_EMOJI,
  REACTION_MS,
  VIEWPORT_BROADCAST_MS,
  type Shape,
} from '@wb/shared';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Stage as StageType } from 'konva/lib/Stage';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Arrow, Ellipse, Layer, Line, Rect, Stage } from 'react-konva';
import { useBoardHistory } from '@/hooks/useBoardHistory';
import { useComments } from '@/hooks/useComments';
import { useHotkeys, useSpaceHeld } from '@/hooks/useHotkeys';
import type { RoomSession, RoomUser } from '@/hooks/useRoomDoc';
import { useIsDark } from '@/hooks/useTheme';
import { useSpeakingIds } from '@/lib/huddle/speaking';
import { useViewport } from '@/hooks/useViewport';
import { apiFetch } from '@/lib/fetcher';
import { describeShape, isShapeId, shapeLink } from '@/lib/notes/shapeRef';
import {
  boxesIntersect,
  distance,
  hitConnectable,
  normalizeBox,
  shapeBounds,
  unionBounds,
  type Box,
  type Point,
} from '@/lib/whiteboard/geometry';
import {
  DEFAULT_STROKE,
  DEFAULT_STROKE_WIDTH,
  createArrowShape,
  createShapeAt,
  createShapeInBox,
  type CreatableTool,
  type DraggableTool,
} from '@/lib/whiteboard/factory';
import { cullShapes } from '@/lib/whiteboard/culling';
import { canGroup, canUngroup, expandToGroups, groupBoxes } from '@/lib/whiteboard/groups';
import {
  addShape,
  addShapes,
  deleteShapes,
  duplicateShapes,
  groupShapes,
  moveToBack,
  moveToFront,
  newShapeId,
  ungroupShapes,
  updateShape,
  updateShapes,
} from '@/lib/whiteboard/model';
import { SNAP_THRESHOLD_PX, computeSnap, type Guide } from '@/lib/whiteboard/snap';
import { buildTemplate, type TemplateId } from '@/lib/whiteboard/templates';
import { followTarget, sharedToView, viewToShared } from '@/lib/whiteboard/presence';
import type { ShortcutAction } from '@/lib/whiteboard/shortcuts';
import { stylePatch, supportsStyle, type StyleKey } from '@/lib/whiteboard/style';
import {
  centerOn,
  fitView,
  gridGap,
  screenToWorld,
  zoomAt,
  type Size,
  type View,
} from '@/lib/whiteboard/viewport';
import type { BoardCommand, CanvasApi, ShapeHit } from './canvasApi';
import { CommentLayer } from './CommentLayer';
import { CursorChatInput, EphemeralLayer, useReactionBursts } from './EphemeralLayer';
import { LaserLayer, type LaserEntry } from './LaserLayer';
import { Minimap } from './Minimap';
import { PeerLayer } from './PeerLayer';
import { PulseRing } from './PulseRing';
import { PropertyBar } from './PropertyBar';
import { SelectionLayer } from './SelectionLayer';
import { ShapeNode } from './ShapeNode';
import { TextEditorOverlay, isTextEditable } from './TextEditorOverlay';
import { Toolbar, type Tool } from './Toolbar';
import { usePeers, useShapes } from './useBoard';
import { ZoomHud } from './ZoomHud';

const MAX_PATH_NUMBERS = 4000;
const MIN_ARROW_PX = 8;
const MIN_MARQUEE_PX = 3;
const MIN_DRAG_PX = 5;
const ZOOM_STEP = 1.25;
const WHEEL_ZOOM_SPEED = 0.0015;
const ACCENT = '#2563eb';
const GUIDE_COLOR = '#ec4899';
const MAX_SEARCH_HITS = 8;

interface CanvasProps {
  roomId: string;
  session: RoomSession;
  user: RoomUser;
  canEdit: boolean;
  /** The person whose view this canvas is mirroring, or null. */
  followUserId: string | null;
  onFollowChange: (userId: string | null) => void;
  /** Lets the room fly the camera to a shape, for badges in the notes. */
  onApiReady?: (api: CanvasApi | null) => void;
  /** Puts a badge for a shape into the notes. Left out when the notes cannot be edited. */
  onInsertInNotes?: (ref: { shapeId: string; label: string }) => void;
  /** A short message for the room to show, such as "Link copied". */
  onNotice: (message: string) => void;
  /** Extra toolbar controls, such as image upload. */
  toolbarExtras?: (placeAt: () => { x: number; y: number }) => ReactNode;
}

interface ArrowDraft {
  start: Point;
  startShapeId: string | undefined;
  end: Point;
  hoverId: string | undefined;
}

/** A rectangle, ellipse or sticky being dragged out. Nothing is written to the board until release. */
interface ShapeDraft {
  tool: DraggableTool;
  origin: Point;
  end: Point;
}

interface MarqueeDrag {
  origin: Point;
  additive: boolean;
  base: readonly string[];
}

function ShapePreview({ draft, viewScale }: { draft: ShapeDraft; viewScale: number }) {
  const box = normalizeBox(draft.origin, draft.end);
  const common = {
    stroke: ACCENT,
    strokeWidth: 2 / viewScale,
    dash: [6 / viewScale, 4 / viewScale],
    fill: 'rgba(37, 99, 235, 0.08)',
  };
  if (draft.tool === 'ellipse') {
    return <Ellipse x={box.x + box.width / 2} y={box.y + box.height / 2} radiusX={box.width / 2} radiusY={box.height / 2} {...common} />;
  }
  return <Rect x={box.x} y={box.y} width={box.width} height={box.height} {...common} />;
}

export default function Canvas({
  roomId,
  session,
  user,
  canEdit,
  followUserId,
  onFollowChange,
  onApiReady,
  onInsertInNotes,
  onNotice,
  toolbarExtras,
}: CanvasProps) {
  const { doc, awareness } = session;
  const shapes = useShapes(doc);
  const peers = usePeers(awareness);
  const history = useBoardHistory(doc, canEdit);
  const { view, setView, animateTo, getView } = useViewport();
  const spaceHeld = useSpaceHeld();

  const container = useRef<HTMLDivElement>(null);
  const stage = useRef<StageType>(null);
  const drawing = useRef<{ id: string; originX: number; originY: number; points: number[] } | null>(null);
  const panning = useRef<{ screen: Point; view: typeof view } | null>(null);
  const marqueeDrag = useRef<MarqueeDrag | null>(null);
  const draftRef = useRef<ArrowDraft | null>(null);
  const shapeDraftRef = useRef<ShapeDraft | null>(null);
  const [shapeDraft, setShapeDraftState] = useState<ShapeDraft | null>(null);
  const moving = useRef<{ starts: Map<string, Point>; startBounds: Box | null; others: Box[] } | null>(null);
  const lastLaserAt = useRef(0);
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastViewportAt = useRef(0);
  const latestViewport = useRef<{ view: View; size: Size } | null>(null);

  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [tool, setTool] = useState<Tool>('select');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [draft, setDraftState] = useState<ArrowDraft | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [localLaser, setLocalLaser] = useState<Point | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const threads = useComments(doc);
  // A new comment waits here, in world units, until it is posted or cancelled.
  const [draftPin, setDraftPin] = useState<Point | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [chatAt, setChatAt] = useState<Point | null>(null);
  const lastPointer = useRef<{ screen: Point; world: Point } | null>(null);
  const reactionCount = useRef(0);
  const lastReactionAt = useRef(0);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatText = useRef('');
  const { bursts, spawn: spawnBurst } = useReactionBursts(awareness);
  const dark = useIsDark();
  const speaking = useSpeakingIds();
  const [pulse, setPulse] = useState<{ id: string; startedAt: number } | null>(null);
  // A badge clicked while the whiteboard is hidden waits here until it has a size to fly with.
  const pendingFocus = useRef<string | null>(null);
  const focusRef = useRef<(id: string) => boolean>(() => false);

  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const byId = useMemo(() => new Map(shapes.map((shape) => [shape.id, shape])), [shapes]);
  // A shape deleted by someone else drops out of the selection without any extra bookkeeping.
  const activeIds = useMemo(() => selectedIds.filter((id) => byId.has(id)), [selectedIds, byId]);
  const selectedShapes = useMemo(
    () => activeIds.flatMap((id) => {
      const shape = byId.get(id);
      return shape ? [shape] : [];
    }),
    [activeIds, byId],
  );
  const editing = editingId !== null ? byId.get(editingId) : undefined;

  // Only shapes near the screen are rendered. The selection, the shape being edited and the
  // pulsing shape always are: handles and the text editor find their node by id.
  const visibleShapes = cullShapes(
    shapes,
    byId,
    view,
    size,
    new Set([...activeIds, ...(editingId !== null ? [editingId] : []), ...(pulse ? [pulse.id] : [])]),
  );

  const getPointers = (): { screen: Point; world: Point } | null => {
    const screen = stage.current?.getPointerPosition();
    const world = stage.current?.getRelativePointerPosition();
    return screen && world ? { screen, world } : null;
  };

  const placeAt = () => screenToWorld(view, { x: size.width / 2, y: size.height / 2 });

  function setShapeDraft(next: ShapeDraft | null) {
    shapeDraftRef.current = next;
    setShapeDraftState(next);
  }

  function setDraft(next: ArrowDraft | null) {
    draftRef.current = next;
    setDraftState(next);
  }

  /** Exactly these ids. For shapes that were just created and are not in `shapes` yet. */
  function select(ids: string[]) {
    setSelectedIds(ids);
  }

  /** These ids plus the rest of any group they belong to, so a group is always picked whole. */
  function selectWithGroups(ids: string[]) {
    setSelectedIds(expandToGroups(ids, shapes));
  }

  // ---- presence: following, the laser, and what others see of me ----

  /** Any gesture of my own that moves the camera ends Follow mode. */
  function leaveFollow() {
    if (followUserId !== null) onFollowChange(null);
  }

  function setLaser(point: Point | null) {
    awareness.setLocalStateField('laser', point);
    setLocalLaser(point);
  }

  function chooseTool(next: Tool) {
    if (next !== 'laser' && localLaser !== null) setLocalLaser(null);
    setTool(next);
  }

  const laserActive = tool === 'laser' && canEdit;

  // A laser says "I am editing", so it goes off when the tool changes or edit rights end.
  // The server drops it from a viewer regardless, so this is only the polite half.
  useEffect(() => {
    if (laserActive) return;
    if (awareness.getLocalState()?.['laser'] != null) awareness.setLocalStateField('laser', null);
  }, [laserActive, awareness]);

  // Which shapes I have selected, for the rings other people see. Keyed by content so a drag,
  // which rebuilds the array every frame, does not broadcast every frame.
  const selectionKey = JSON.stringify(activeIds);
  useEffect(() => {
    const ids: unknown = JSON.parse(selectionKey);
    awareness.setLocalStateField('selection', Array.isArray(ids) ? ids.slice(0, 64) : []);
  }, [selectionKey, awareness]);

  // Where I am looking, at most ten times a second, for anyone following me.
  useEffect(() => {
    latestViewport.current = { view, size };
    if (size.width === 0 || viewportTimer.current !== null) return;
    const wait = Math.max(0, VIEWPORT_BROADCAST_MS - (Date.now() - lastViewportAt.current));
    viewportTimer.current = setTimeout(() => {
      viewportTimer.current = null;
      lastViewportAt.current = Date.now();
      const latest = latestViewport.current;
      if (latest) awareness.setLocalStateField('viewport', viewToShared(latest.view, latest.size));
    }, wait);
  }, [view, size, awareness]);
  useEffect(
    () => () => {
      if (viewportTimer.current !== null) clearTimeout(viewportTimer.current);
    },
    [],
  );

  // Follow mode: mirror the followed person's camera. Their view arrives as a center and a
  // zoom, so it fits my screen size. Primitives are the dependencies so a moving cursor,
  // which changes the peer object but not the viewport, does not restart the animation.
  const followed = followUserId !== null ? followTarget(peers, followUserId) : undefined;
  const followCx = followed?.viewport?.cx;
  const followCy = followed?.viewport?.cy;
  const followScale = followed?.viewport?.scale;
  useEffect(() => {
    if (followCx === undefined || followCy === undefined || followScale === undefined || size.width === 0) return;
    animateTo(sharedToView({ cx: followCx, cy: followCy, scale: followScale }, size), 140);
  }, [followCx, followCy, followScale, size, animateTo]);

  const followPresent = followUserId !== null && peers.some((peer) => peer.ghost !== true && peer.user.id === followUserId);
  useEffect(() => {
    if (followUserId !== null && !followPresent) onFollowChange(null);
  }, [followUserId, followPresent, onFollowChange]);
  const followName =
    followUserId !== null ? peers.find((peer) => peer.ghost !== true && peer.user.id === followUserId)?.user.name : undefined;

  const laserEntries = useMemo<LaserEntry[]>(
    () => [
      ...peers.map((peer) => ({ key: `peer-${peer.clientId}`, color: peer.user.color, point: peer.laser ?? null })),
      { key: 'me', color: user.color, point: laserActive ? localLaser : null },
    ],
    [peers, user.color, laserActive, localLaser],
  );

  // ---- stage pointer handling ----

  function onPointerDown(event: KonvaEventObject<MouseEvent | TouchEvent>) {
    const pointers = getPointers();
    if (!pointers) return;
    const { screen, world } = pointers;
    const evt = event.evt;
    const button = evt instanceof MouseEvent ? evt.button : 0;

    // Middle button, or space plus the primary button, pans. Shapes ignore both.
    if (button === 1 || (spaceHeld && button === 0)) {
      evt.preventDefault();
      leaveFollow();
      panning.current = { screen, view: getView() };
      setIsPanning(true);
      return;
    }
    if (button !== 0) return;

    if (tool === 'select') {
      // Shapes take their own presses, so only the empty background reaches here.
      if (event.target !== event.target.getStage()) return;
      const additive = evt.shiftKey;
      if (!additive) select([]);
      marqueeDrag.current = { origin: world, additive, base: additive ? activeIds : [] };
      return;
    }
    if (tool === 'comment') {
      if (!canEdit) return;
      setOpenThreadId(null);
      setDraftPin(world);
      setTool('select');
      return;
    }
    if (!canEdit || tool === 'laser') return;

    if (tool === 'pen') {
      history.stopCapturing();
      const id = newShapeId();
      const points = [0, 0];
      drawing.current = { id, originX: world.x, originY: world.y, points };
      addShape(doc, {
        id,
        type: 'path',
        x: world.x,
        y: world.y,
        rotation: 0,
        points,
        stroke: DEFAULT_STROKE,
        strokeWidth: DEFAULT_STROKE_WIDTH,
      });
      awareness.setLocalStateField('drawing', true);
      return;
    }

    if (tool === 'arrow') {
      const hit = hitConnectable(shapes, world);
      setDraft({ start: world, startShapeId: hit?.id, end: world, hoverId: hit?.id });
      return;
    }

    if (tool !== 'text') {
      // Press, drag to the size you want, release. A plain click still makes a default-sized one.
      setShapeDraft({ tool, origin: world, end: world });
      return;
    }

    history.stopCapturing();
    const shape = createShapeAt(tool satisfies CreatableTool, world, user.name);
    addShape(doc, shape);
    select([shape.id]);
    setTool('select');
    if (shape.type === 'text') {
      // Without this the click would move focus to the canvas and close the editor at once.
      evt.preventDefault();
      setEditingId(shape.id);
    }
  }

  function onPointerMove() {
    const pointers = getPointers();
    if (!pointers) return;
    const { screen, world } = pointers;
    lastPointer.current = pointers;

    const pan = panning.current;
    if (pan) {
      setView({ ...pan.view, x: pan.view.x + screen.x - pan.screen.x, y: pan.view.y + screen.y - pan.screen.y });
      return;
    }

    awareness.setLocalStateField('pointer', { x: world.x, y: world.y });

    if (laserActive && Date.now() - lastLaserAt.current >= LASER_SAMPLE_MS) {
      lastLaserAt.current = Date.now();
      setLaser({ x: world.x, y: world.y });
    }

    const drag = marqueeDrag.current;
    if (drag) {
      setMarquee(normalizeBox(drag.origin, world));
      return;
    }

    const sizing = shapeDraftRef.current;
    if (sizing) {
      setShapeDraft({ ...sizing, end: world });
      return;
    }

    const arrowDraft = draftRef.current;
    if (arrowDraft) {
      const hit = hitConnectable(shapes, world);
      setDraft({ ...arrowDraft, end: world, hoverId: hit?.id });
      return;
    }

    const stroke = drawing.current;
    if (!stroke || stroke.points.length >= MAX_PATH_NUMBERS) return;
    stroke.points = [...stroke.points, world.x - stroke.originX, world.y - stroke.originY];
    updateShape(doc, stroke.id, { points: stroke.points });
  }

  function onPointerUp() {
    if (panning.current) {
      panning.current = null;
      setIsPanning(false);
    }

    const drag = marqueeDrag.current;
    if (drag) {
      marqueeDrag.current = null;
      if (marquee && (marquee.width * view.scale > MIN_MARQUEE_PX || marquee.height * view.scale > MIN_MARQUEE_PX)) {
        const hits = shapes.filter((shape) => boxesIntersect(marquee, shapeBounds(shape))).map((shape) => shape.id);
        selectWithGroups(drag.additive ? Array.from(new Set([...drag.base, ...hits])) : hits);
      }
      setMarquee(null);
    }

    const sizing = shapeDraftRef.current;
    if (sizing) {
      setShapeDraft(null);
      if (canEdit) {
        const box = normalizeBox(sizing.origin, sizing.end);
        const dragged = box.width * view.scale > MIN_DRAG_PX || box.height * view.scale > MIN_DRAG_PX;
        history.stopCapturing();
        const shape = dragged
          ? createShapeInBox(sizing.tool, box, user.name)
          : createShapeAt(sizing.tool, sizing.origin, user.name);
        addShape(doc, shape);
        select([shape.id]);
        setTool('select');
        history.stopCapturing();
      }
    }

    const arrowDraft = draftRef.current;
    if (arrowDraft) {
      setDraft(null);
      const hit = hitConnectable(shapes, arrowDraft.end);
      const tooShort = distance(arrowDraft.start, arrowDraft.end) * view.scale < MIN_ARROW_PX;
      if (canEdit && !(tooShort && !hit)) {
        history.stopCapturing();
        const arrow = createArrowShape(arrowDraft.start, arrowDraft.end, arrowDraft.startShapeId, hit?.id);
        // An arrow from a shape back to itself with no drag is a stray click, not a connector.
        if (!(arrowDraft.startShapeId !== undefined && arrowDraft.startShapeId === hit?.id && tooShort)) {
          addShape(doc, arrow);
          select([arrow.id]);
          setTool('select');
        }
        history.stopCapturing();
      }
    }

    if (drawing.current) {
      awareness.setLocalStateField('drawing', false);
      history.stopCapturing();
    }
    drawing.current = null;
  }

  function onWheel(event: KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();
    const pointer = stage.current?.getPointerPosition();
    if (!pointer) return;
    leaveFollow();
    // Firefox reports lines, not pixels, for a notched wheel.
    const delta = event.evt.deltaY * (event.evt.deltaMode === 1 ? 33 : 1);
    if (event.evt.ctrlKey || event.evt.metaKey) {
      setView((current) => zoomAt(current, pointer, current.scale * Math.exp(-delta * WHEEL_ZOOM_SPEED)));
    } else {
      setView((current) => ({ ...current, x: current.x - event.evt.deltaX, y: current.y - delta }));
    }
  }

  // ---- shape handlers ----

  function onShapePress(id: string, additive: boolean) {
    const group = expandToGroups([id], shapes);
    setSelectedIds((current) => {
      const allIn = group.every((member) => current.includes(member));
      if (additive) {
        // Shift toggles the whole group, never a single member of it.
        return allIn ? current.filter((existing) => !group.includes(existing)) : Array.from(new Set([...current, ...group]));
      }
      return allIn ? current : group;
    });
  }

  function onShapeDragStart(id: string) {
    setInteracting(true);
    history.stopCapturing();
    const ids = activeIds.includes(id) ? activeIds : expandToGroups([id], shapes);
    if (!activeIds.includes(id)) select(ids);
    const starts = new Map<string, Point>();
    const movingBounds: Box[] = [];
    for (const movingId of ids) {
      const shape = byId.get(movingId);
      if (!shape) continue;
      starts.set(movingId, { x: shape.x, y: shape.y });
      movingBounds.push(shapeBounds(shape));
    }
    // What the dragged shapes can line up with: every other shape that has edges of its own.
    const others = shapes.filter((shape) => !starts.has(shape.id) && shape.type !== 'arrow').map(shapeBounds);
    moving.current = { starts, startBounds: unionBounds(movingBounds), others };
  }

  /** Moves the dragged shapes, snapped to the guides unless Alt is held. Returns the node's snapped spot. */
  function onShapeDragMove(id: string, x: number, y: number, bypassSnap: boolean): { x: number; y: number } | undefined {
    const drag = moving.current;
    const origin = drag?.starts.get(id);
    if (!drag || !origin) return undefined;
    let dx = x - origin.x;
    let dy = y - origin.y;

    let nextGuides: Guide[] = [];
    if (!bypassSnap && drag.startBounds) {
      const snap = computeSnap(
        { ...drag.startBounds, x: drag.startBounds.x + dx, y: drag.startBounds.y + dy },
        drag.others,
        SNAP_THRESHOLD_PX / view.scale,
      );
      dx += snap.dx;
      dy += snap.dy;
      nextGuides = snap.guides;
    }
    setGuides((previous) => (previous.length === 0 && nextGuides.length === 0 ? previous : nextGuides));

    const patches: Record<string, Partial<Shape>> = {};
    for (const [movingId, start] of drag.starts) patches[movingId] = { x: start.x + dx, y: start.y + dy };
    updateShapes(doc, patches);
    return { x: origin.x + dx, y: origin.y + dy };
  }

  function onShapeDragEnd(id: string, x: number, y: number, bypassSnap: boolean) {
    onShapeDragMove(id, x, y, bypassSnap);
    moving.current = null;
    setGuides([]);
    setInteracting(false);
    history.stopCapturing();
  }

  function onTransformEnd(patches: Record<string, Partial<Shape>>) {
    updateShapes(doc, patches);
    setInteracting(false);
    history.stopCapturing();
  }

  function finishEditing(text: string) {
    const shape = editing;
    setEditingId(null);
    if (!shape || !canEdit) return;
    // A text box left empty is removed rather than kept invisible.
    if (shape.type === 'text' && text.trim() === '') deleteShapes(doc, [shape.id]);
    else updateShape(doc, shape.id, { text });
    history.stopCapturing();
  }

  function openFile(assetId: string) {
    apiFetch<{ url: string }>(`/api/rooms/${roomId}/assets/${assetId}`)
      .then(({ url }) => window.location.assign(url))
      .catch(() => undefined);
  }

  // ---- actions shared by the keyboard, the toolbar and the property bar ----

  function removeSelection() {
    if (!canEdit || activeIds.length === 0) return;
    history.stopCapturing();
    deleteShapes(doc, activeIds);
    history.stopCapturing();
    select([]);
  }

  function duplicateSelection() {
    if (!canEdit || activeIds.length === 0) return;
    history.stopCapturing();
    select(duplicateShapes(doc, activeIds));
    history.stopCapturing();
  }

  function groupSelection() {
    if (!canEdit || !canGroup(selectedShapes)) return;
    history.stopCapturing();
    groupShapes(doc, activeIds);
    history.stopCapturing();
  }

  function ungroupSelection() {
    if (!canEdit || !canUngroup(selectedShapes)) return;
    history.stopCapturing();
    ungroupShapes(doc, activeIds);
    history.stopCapturing();
  }

  /** Drops a starter board in the middle of the screen as one change, then shows all of it. */
  function insertTemplate(id: TemplateId) {
    if (!canEdit || size.width === 0) return;
    const current = getView();
    const center = screenToWorld(current, { x: size.width / 2, y: size.height / 2 });
    const created = buildTemplate(id, center, user.name);
    history.stopCapturing();
    addShapes(doc, created);
    history.stopCapturing();
    select(created.map((shape) => shape.id));
    setTool('select');
    const bounds = unionBounds(created.filter((shape) => shape.type !== 'arrow').map(shapeBounds));
    if (bounds) {
      leaveFollow();
      const scale = Math.min(fitView(bounds, size, 80).scale, 1);
      animateTo(centerOn(current, size, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, scale));
    }
  }

  // ---- cursor chat and reactions: awareness only, never the document ----

  function sendReaction(index: number) {
    const emoji = REACTION_EMOJI[index];
    const at = lastPointer.current?.world;
    if (!emoji || !at) return;
    const now = Date.now();
    // Holding a key down must not flood the room.
    if (now - lastReactionAt.current < 150) return;
    lastReactionAt.current = now;
    reactionCount.current += 1;
    awareness.setLocalStateField('reaction', { emoji, n: reactionCount.current });
    spawnBurst(emoji, at);
    if (reactionTimer.current !== null) clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => awareness.setLocalStateField('reaction', null), REACTION_MS);
  }

  function openChat() {
    if (chatTimer.current !== null) clearTimeout(chatTimer.current);
    chatTimer.current = null;
    chatText.current = '';
    setChatAt(lastPointer.current?.screen ?? { x: size.width / 2, y: size.height / 2 });
  }

  function changeChat(text: string) {
    chatText.current = text;
    awareness.setLocalStateField('chat', text === '' ? null : { text: text.slice(0, MAX_CURSOR_CHAT_CHARS) });
  }

  /** The bubble stays for a moment after the box closes, then goes. */
  function closeChat() {
    setChatAt(null);
    if (chatTimer.current !== null) clearTimeout(chatTimer.current);
    chatTimer.current = setTimeout(() => awareness.setLocalStateField('chat', null), chatText.current === '' ? 0 : CHAT_LINGER_MS);
  }

  useEffect(
    () => () => {
      if (reactionTimer.current !== null) clearTimeout(reactionTimer.current);
      if (chatTimer.current !== null) clearTimeout(chatTimer.current);
    },
    [],
  );

  function applyStyle(key: StyleKey, value: string | number) {
    if (!canEdit) return;
    const patch = stylePatch(key, value);
    if (!patch) return;
    const patches: Record<string, Partial<Shape>> = {};
    for (const shape of selectedShapes) if (supportsStyle(shape, key)) patches[shape.id] = patch;
    updateShapes(doc, patches);
  }

  function zoomBy(factor: number) {
    leaveFollow();
    const current = getView();
    animateTo(zoomAt(current, { x: size.width / 2, y: size.height / 2 }, current.scale * factor));
  }

  function fitToScreen() {
    leaveFollow();
    animateTo(fitView(unionBounds(shapes.map(shapeBounds)), size));
  }

  // ---- links between the notes and the board ----

  function focusShape(id: string): boolean {
    const shape = byId.get(id);
    if (!shape) return false;
    selectWithGroups([id]);
    setPulse({ id, startedAt: performance.now() });
    if (size.width === 0) {
      pendingFocus.current = id;
      return true;
    }
    leaveFollow();
    const bounds = shapeBounds(shape);
    // Close enough to see the shape, never so close that a small one fills the screen.
    const scale = Math.min(fitView(bounds, size, 160).scale, 1.5);
    animateTo(centerOn(getView(), size, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, scale));
    return true;
  }

  useEffect(() => {
    focusRef.current = focusShape;
  });

  useEffect(() => {
    if (size.width === 0 || pendingFocus.current === null) return;
    const id = pendingFocus.current;
    pendingFocus.current = null;
    focusRef.current(id);
  }, [size]);

  function runCommand(command: BoardCommand) {
    if (command.type === 'fit') fitToScreen();
    else if (command.type === 'template') insertTemplate(command.id);
    else onAction(command);
  }

  function findShapes(query: string, limit: number): ShapeHit[] {
    const needle = query.trim().toLowerCase();
    if (needle === '') return [];
    const hits: ShapeHit[] = [];
    for (const shape of shapes) {
      const label = describeShape(shape);
      if (!label.toLowerCase().includes(needle)) continue;
      hits.push({ id: shape.id, label });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  // The api object is stable, so it reads the latest handlers through refs.
  const commandRef = useRef(runCommand);
  const searchRef = useRef(findShapes);
  useEffect(() => {
    commandRef.current = runCommand;
    searchRef.current = findShapes;
  });
  const api = useMemo<CanvasApi>(
    () => ({
      focusShape: (id) => focusRef.current(id),
      perform: (command) => commandRef.current(command),
      searchShapes: (query, limit) => searchRef.current(query, Math.min(limit, MAX_SEARCH_HITS)),
    }),
    [],
  );
  useEffect(() => {
    onApiReady?.(api);
    return () => onApiReady?.(null);
  }, [api, onApiReady]);

  function insertSelectionInNotes() {
    const shape = selectedShapes[0];
    if (!shape || !onInsertInNotes) return;
    if (!isShapeId(shape.id)) {
      onNotice('This shape cannot be linked.');
      return;
    }
    onInsertInNotes({ shapeId: shape.id, label: describeShape(shape) });
  }

  function copySelectionLink() {
    const shape = selectedShapes[0];
    if (!shape) return;
    if (!isShapeId(shape.id)) {
      onNotice('This shape cannot be linked.');
      return;
    }
    try {
      navigator.clipboard
        .writeText(shapeLink(window.location.origin, roomId, shape.id))
        .then(() => onNotice('Link to shape copied.'))
        .catch(() => onNotice('Could not copy the link.'));
    } catch {
      onNotice('Could not copy the link.');
    }
  }

  function onAction(action: ShortcutAction) {
    switch (action.type) {
      case 'tool':
        chooseTool(action.tool);
        return;
      case 'delete':
        removeSelection();
        return;
      case 'chat':
        openChat();
        return;
      case 'reaction':
        sendReaction(action.index);
        return;
      case 'escape':
        if (draftPin) setDraftPin(null);
        else if (openThreadId !== null) setOpenThreadId(null);
        else if (shapeDraftRef.current) setShapeDraft(null);
        else if (draftRef.current) setDraft(null);
        else if (tool !== 'select') chooseTool('select');
        else select([]);
        return;
      case 'undo':
        history.undo();
        return;
      case 'redo':
        history.redo();
        return;
      case 'duplicate':
        duplicateSelection();
        return;
      case 'selectAll':
        select(shapes.map((shape) => shape.id));
        return;
      case 'group':
        groupSelection();
        return;
      case 'ungroup':
        ungroupSelection();
        return;
      case 'zoomReset':
        zoomBy(1 / getView().scale);
        return;
    }
  }

  useHotkeys(canEdit, editingId === null, onAction);

  // ---- layout ----

  const bounds = unionBounds(selectedShapes.map(shapeBounds));
  const anchor: Box | null = bounds
    ? {
        x: bounds.x * view.scale + view.x,
        y: bounds.y * view.scale + view.y,
        width: bounds.width * view.scale,
        height: bounds.height * view.scale,
      }
    : null;

  const interactive = tool === 'select' && !spaceHeld;
  const showPropertyBar = canEdit && anchor !== null && !interacting && editingId === null && tool === 'select';

  const gap = gridGap(view.scale) * view.scale;
  const surface: CSSProperties = {
    backgroundImage: 'radial-gradient(circle, rgba(115, 115, 115, 0.45) 1px, transparent 1.4px)',
    backgroundSize: `${gap}px ${gap}px`,
    backgroundPosition: `${view.x - gap / 2}px ${view.y - gap / 2}px`,
    cursor: isPanning ? 'grabbing' : spaceHeld ? 'grab' : tool === 'select' ? 'default' : 'crosshair',
  };

  const pulseShape = pulse ? byId.get(pulse.id) : undefined;
  const hoverShape = draft?.hoverId !== undefined ? byId.get(draft.hoverId) : undefined;
  const hoverBounds = hoverShape ? shapeBounds(hoverShape) : null;

  return (
    <div
      ref={container}
      style={surface}
      className="relative h-full w-full select-none overflow-hidden bg-neutral-100 dark:bg-neutral-900"
    >
      {canEdit ? (
        <Toolbar
          tool={tool}
          onToolChange={chooseTool}
          onDelete={removeSelection}
          canDelete={activeIds.length > 0}
          onUndo={history.undo}
          onRedo={history.redo}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
        >
          {toolbarExtras?.(placeAt)}
        </Toolbar>
      ) : (
        <p className="absolute left-3 top-3 z-10 rounded-lg border border-neutral-200 bg-white/95 px-3 py-1.5 text-sm shadow-md dark:border-neutral-700 dark:bg-neutral-800/95">
          View only
        </p>
      )}

      {followUserId !== null && followName !== undefined ? (
        <div
          role="status"
          className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-blue-600 py-1 pl-3 pr-1.5 text-sm text-white shadow-lg"
        >
          <span>Following {followName}</span>
          <button
            type="button"
            onClick={() => onFollowChange(null)}
            className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium hover:bg-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            Stop
          </button>
        </div>
      ) : null}

      {size.width > 0 ? (
        <Stage
          ref={stage}
          width={size.width}
          height={size.height}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          onMouseDown={onPointerDown}
          onTouchStart={onPointerDown}
          onMouseMove={onPointerMove}
          onTouchMove={onPointerMove}
          onMouseUp={onPointerUp}
          onTouchEnd={onPointerUp}
          onWheel={onWheel}
          onMouseLeave={() => {
            // Leaving the canvas mid-drag finishes the shape where it got to; the release would be lost.
            if (shapeDraftRef.current) onPointerUp();
            if (localLaser !== null) setLaser(null);
          }}
        >
          <Layer>
            {visibleShapes.map((shape) => (
              <ShapeNode
                key={shape.id}
                shape={shape}
                byId={byId}
                roomId={roomId}
                interactive={interactive}
                draggable={canEdit && interactive}
                dark={dark}
                selected={activeIds.includes(shape.id)}
                editing={shape.id === editingId}
                onPress={onShapePress}
                onDragStart={onShapeDragStart}
                onDragMove={onShapeDragMove}
                onDragEnd={onShapeDragEnd}
                onEditText={(id) => canEdit && setEditingId(id)}
                onOpenFile={openFile}
              />
            ))}
          </Layer>
          <SelectionLayer
            selected={selectedShapes}
            canTransform={canEdit && tool === 'select' && editingId === null && !spaceHeld}
            showOutline={!canEdit}
            groupBoxes={groupBoxes(selectedShapes)}
            viewScale={view.scale}
            marquee={marquee}
            onTransformStart={() => {
              setInteracting(true);
              history.stopCapturing();
            }}
            onTransformEnd={onTransformEnd}
          />
          <Layer listening={false}>
            {guides.map((guide) => (
              <Line
                key={`${guide.axis}-${guide.at}-${guide.from}`}
                points={
                  guide.axis === 'x'
                    ? [guide.at, guide.from, guide.at, guide.to]
                    : [guide.from, guide.at, guide.to, guide.at]
                }
                stroke={GUIDE_COLOR}
                strokeWidth={1 / view.scale}
              />
            ))}
            {shapeDraft ? <ShapePreview draft={shapeDraft} viewScale={view.scale} /> : null}
            {pulse && pulseShape ? (
              <PulseRing
                bounds={shapeBounds(pulseShape)}
                startedAt={pulse.startedAt}
                viewScale={view.scale}
                onDone={() => setPulse(null)}
              />
            ) : null}
            {draft ? (
              <>
                <Arrow
                  points={[draft.start.x, draft.start.y, draft.end.x, draft.end.y]}
                  stroke={ACCENT}
                  fill={ACCENT}
                  strokeWidth={2 / view.scale}
                  dash={[6 / view.scale, 4 / view.scale]}
                  pointerLength={10 / view.scale}
                  pointerWidth={10 / view.scale}
                />
                {hoverBounds ? (
                  <Rect
                    x={hoverBounds.x}
                    y={hoverBounds.y}
                    width={hoverBounds.width}
                    height={hoverBounds.height}
                    stroke={ACCENT}
                    strokeWidth={2 / view.scale}
                    dash={[6 / view.scale, 4 / view.scale]}
                  />
                ) : null}
              </>
            ) : null}
          </Layer>
          <PeerLayer peers={peers} byId={byId} viewScale={view.scale} speaking={speaking} />
          <LaserLayer entries={laserEntries} viewScale={view.scale} />
        </Stage>
      ) : null}

      <EphemeralLayer peers={peers} bursts={bursts} view={view} />
      <CommentLayer
        doc={doc}
        threads={threads}
        view={view}
        size={size}
        canEdit={canEdit}
        user={user}
        draft={draftPin}
        openId={openThreadId}
        showResolved={showResolved}
        onOpen={setOpenThreadId}
        onDraftDone={() => setDraftPin(null)}
        onToggleResolved={() => setShowResolved((value) => !value)}
      />
      {chatAt ? <CursorChatInput at={chatAt} color={user.color} onChange={changeChat} onClose={closeChat} /> : null}

      {showPropertyBar && anchor ? (
        <PropertyBar
          selected={selectedShapes}
          anchor={anchor}
          container={size}
          onStyle={applyStyle}
          onFront={() => moveToFront(doc, activeIds)}
          onBack={() => moveToBack(doc, activeIds)}
          onDuplicate={duplicateSelection}
          {...(canGroup(selectedShapes) ? { onGroup: groupSelection } : {})}
          {...(canUngroup(selectedShapes) ? { onUngroup: ungroupSelection } : {})}
          onDelete={removeSelection}
          onCopyLink={copySelectionLink}
          {...(onInsertInNotes ? { onInsertInNotes: insertSelectionInNotes } : {})}
        />
      ) : null}

      {editing && isTextEditable(editing) ? (
        <TextEditorOverlay key={editing.id} shape={editing} view={view} onDone={finishEditing} />
      ) : null}

      {minimapOpen ? (
        <Minimap
          shapes={shapes}
          view={view}
          size={size}
          onNavigate={(center) => {
            leaveFollow();
            setView(centerOn(getView(), size, center));
          }}
        />
      ) : null}
      <ZoomHud
        scale={view.scale}
        minimapOpen={minimapOpen}
        drawn={visibleShapes.length}
        total={shapes.length}
        onZoomIn={() => zoomBy(ZOOM_STEP)}
        onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
        onReset={() => zoomBy(1 / getView().scale)}
        onFit={fitToScreen}
        onToggleMinimap={() => setMinimapOpen((open) => !open)}
      />
    </div>
  );
}

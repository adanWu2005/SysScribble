import type { Shape } from '@wb/shared';
import { shapeBounds, unionBounds, type Point } from './geometry';
import { DEFAULT_STROKE, createArrowShape } from './factory';
import { newShapeId } from './model';

/**
 * Starter boards. Each builder returns plain shapes with fresh ids, centered on a point, and
 * the caller writes them in one transaction so a template is one network update and one undo step.
 */

export type TemplateId = 'kanban' | 'retro' | 'flowchart' | 'swot' | 'architecture';

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  description: string;
}

export const TEMPLATES: readonly TemplateInfo[] = [
  { id: 'kanban', name: 'Kanban board', description: 'To do, doing and done columns' },
  { id: 'retro', name: 'Retrospective', description: 'Went well, to improve, actions' },
  { id: 'flowchart', name: 'Flowchart', description: 'Start, steps, a decision and an end' },
  { id: 'architecture', name: 'System architecture', description: 'Client, API, Redis and Postgres boxes' },
  { id: 'swot', name: 'SWOT analysis', description: 'Strengths, weaknesses, opportunities, threats' },
];

const HEADER_SIZE = 22;

function rect(x: number, y: number, width: number, height: number, fill: string, text?: string): Shape {
  const base = { id: newShapeId(), type: 'rect' as const, x, y, rotation: 0, width, height, fill };
  return text === undefined ? base : { ...base, text };
}

function ellipse(cx: number, cy: number, width: number, height: number, fill: string, text: string): Shape {
  return { id: newShapeId(), type: 'ellipse', x: cx, y: cy, rotation: 0, width, height, fill, text };
}

function label(x: number, y: number, text: string, fontSize = HEADER_SIZE): Shape {
  return { id: newShapeId(), type: 'text', x, y, rotation: 0, text, fontSize, fill: DEFAULT_STROKE };
}

function sticky(x: number, y: number, text: string, fill: string, authorName: string): Shape {
  return {
    id: newShapeId(),
    type: 'sticky',
    x,
    y,
    rotation: 0,
    width: 200,
    height: 120,
    fill,
    text,
    authorName: authorName.slice(0, 80),
  };
}

interface Column {
  title: string;
  fill: string;
  notes: readonly string[];
}

function columns(cols: readonly Column[], authorName: string): Shape[] {
  const colWidth = 240;
  const gap = 24;
  const out: Shape[] = [];
  cols.forEach((col, index) => {
    const x = index * (colWidth + gap);
    out.push(rect(x, 0, colWidth, 460, col.fill));
    out.push(label(x + 16, 14, col.title));
    col.notes.forEach((note, row) => out.push(sticky(x + 20, 60 + row * 140, note, '#fde68a', authorName)));
  });
  return out;
}

function flowchart(): Shape[] {
  const start = ellipse(110, 40, 160, 70, '#86efac', 'Start');
  const step = rect(30, 140, 160, 70, '#93c5fd', 'Do the work');
  const decision = rect(30, 260, 160, 80, '#fde68a', 'Done?');
  const end = ellipse(110, 440, 160, 70, '#fca5a5', 'End');
  // Connectors attach by id; their free points are only the fallback if an end shape is deleted.
  const link = (from: Shape, to: Shape, fromAt: Point, toAt: Point): Shape =>
    createArrowShape(fromAt, toAt, from.id, to.id);
  return [
    start,
    step,
    decision,
    end,
    link(start, step, { x: 110, y: 75 }, { x: 110, y: 140 }),
    link(step, decision, { x: 110, y: 210 }, { x: 110, y: 260 }),
    link(decision, end, { x: 110, y: 340 }, { x: 110, y: 405 }),
  ];
}

function architecture(): Shape[] {
  const client = rect(0, 110, 150, 80, '#bfdbfe', 'Client');
  const api = rect(250, 110, 150, 80, '#c4b5fd', 'API');
  const redis = rect(500, 0, 150, 80, '#fca5a5', 'Redis');
  const postgres = rect(500, 220, 150, 80, '#86efac', 'Postgres');
  const link = (from: Shape, to: Shape): Shape => {
    const a = shapeBounds(from);
    const b = shapeBounds(to);
    return createArrowShape(
      { x: a.x + a.width / 2, y: a.y + a.height / 2 },
      { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      from.id,
      to.id,
    );
  };
  return [client, api, redis, postgres, link(client, api), link(api, redis), link(api, postgres)];
}

function swot(authorName: string): Shape[] {
  const cell = (col: number, row: number, title: string, fill: string): Shape[] => {
    const x = col * 280;
    const y = row * 240;
    return [rect(x, y, 260, 220, fill), label(x + 14, y + 12, title), sticky(x + 30, y + 60, '', '#fde68a', authorName)];
  };
  return [
    ...cell(0, 0, 'Strengths', '#dcfce7'),
    ...cell(1, 0, 'Weaknesses', '#fee2e2'),
    ...cell(0, 1, 'Opportunities', '#dbeafe'),
    ...cell(1, 1, 'Threats', '#ffedd5'),
  ];
}

function build(id: TemplateId, authorName: string): Shape[] {
  switch (id) {
    case 'kanban':
      return columns(
        [
          { title: 'To do', fill: '#f3f4f6', notes: ['First task', 'Second task'] },
          { title: 'Doing', fill: '#e0f2fe', notes: ['Task in progress'] },
          { title: 'Done', fill: '#dcfce7', notes: [] },
        ],
        authorName,
      );
    case 'retro':
      return columns(
        [
          { title: 'Went well', fill: '#dcfce7', notes: ['What worked?'] },
          { title: 'To improve', fill: '#fee2e2', notes: ['What got in the way?'] },
          { title: 'Action items', fill: '#dbeafe', notes: ['Who does what next?'] },
        ],
        authorName,
      );
    case 'flowchart':
      return flowchart();
    case 'architecture':
      return architecture();
    case 'swot':
      return swot(authorName);
  }
}

function shifted(shape: Shape, dx: number, dy: number): Shape {
  return { ...shape, x: shape.x + dx, y: shape.y + dy };
}

/** The template's shapes, back to front, with the whole thing centered on `center`. */
export function buildTemplate(id: TemplateId, center: Point, authorName: string): Shape[] {
  const shapes = build(id, authorName);
  const bounds = unionBounds(shapes.filter((shape) => shape.type !== 'arrow').map(shapeBounds));
  if (!bounds) return shapes;
  const dx = center.x - (bounds.x + bounds.width / 2);
  const dy = center.y - (bounds.y + bounds.height / 2);
  return shapes.map((shape) => shifted(shape, dx, dy));
}

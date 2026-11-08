import type { Shape } from '@wb/shared';
import { shapeBounds, unionBounds, type Box } from './geometry';

/** Grouping rules, pure. A group is every shape that carries the same `groupId`. Groups are flat. */

/** The ids plus every other member of any group they belong to, in board order. */
export function expandToGroups(ids: readonly string[], shapes: readonly Shape[]): string[] {
  const wanted = new Set(ids);
  const groups = new Set<string>();
  for (const shape of shapes) {
    if (wanted.has(shape.id) && shape.groupId !== undefined) groups.add(shape.groupId);
  }
  if (groups.size === 0) return shapes.filter((shape) => wanted.has(shape.id)).map((shape) => shape.id);
  return shapes
    .filter((shape) => wanted.has(shape.id) || (shape.groupId !== undefined && groups.has(shape.groupId)))
    .map((shape) => shape.id);
}

/** Grouping needs two or more shapes that are not already exactly one group. */
export function canGroup(selected: readonly Shape[]): boolean {
  if (selected.length < 2) return false;
  const first = selected[0]?.groupId;
  return first === undefined || selected.some((shape) => shape.groupId !== first);
}

export function canUngroup(selected: readonly Shape[]): boolean {
  return selected.some((shape) => shape.groupId !== undefined);
}

/** One dashed box per group in the selection, so a group reads as one object. */
export function groupBoxes(selected: readonly Shape[]): Box[] {
  const byGroup = new Map<string, Shape[]>();
  for (const shape of selected) {
    if (shape.groupId === undefined) continue;
    byGroup.set(shape.groupId, [...(byGroup.get(shape.groupId) ?? []), shape]);
  }
  const boxes: Box[] = [];
  for (const members of byGroup.values()) {
    const box = unionBounds(members.map(shapeBounds));
    if (box) boxes.push(box);
  }
  return boxes;
}

/** The `/` command menu: what it offers, when it opens, and how typing narrows it. */

export type SlashCommandId = 'h1' | 'h2' | 'h3' | 'bullet' | 'task' | 'code' | 'callout' | 'divider';

export interface SlashItem {
  id: SlashCommandId;
  label: string;
  hint: string;
  /** Extra words that also find this item, so "todo" finds the checklist. */
  keywords: readonly string[];
}

export const SLASH_ITEMS: readonly SlashItem[] = [
  { id: 'h1', label: 'Heading 1', hint: 'Large section title', keywords: ['h1', 'title', 'heading'] },
  { id: 'h2', label: 'Heading 2', hint: 'Medium section title', keywords: ['h2', 'subtitle', 'heading'] },
  { id: 'h3', label: 'Heading 3', hint: 'Small section title', keywords: ['h3', 'heading'] },
  { id: 'bullet', label: 'Bullet list', hint: 'A simple list', keywords: ['ul', 'list', 'unordered'] },
  { id: 'task', label: 'Task checklist', hint: 'Track to-dos with checkboxes', keywords: ['todo', 'check', 'checkbox', 'task'] },
  { id: 'code', label: 'Code block', hint: 'Monospaced code', keywords: ['pre', 'snippet', 'code'] },
  { id: 'callout', label: 'Callout', hint: 'Highlight something important', keywords: ['note', 'info', 'tip', 'warning', 'box'] },
  { id: 'divider', label: 'Divider', hint: 'A horizontal rule', keywords: ['hr', 'line', 'rule', 'separator'] },
];

/**
 * Decides whether the text before the cursor is a slash command in progress. The slash has to
 * start the block or follow a space, so a URL or "and/or" does not open the menu.
 * `length` counts the slash and the query, which is how much to delete when a command runs.
 */
export function matchSlashTrigger(textBefore: string): { query: string; length: number } | null {
  const match = /(?:^|\s)\/([a-z0-9]*)$/i.exec(textBefore);
  if (!match) return null;
  const query = match[1] ?? '';
  return { query, length: query.length + 1 };
}

/** Items that match what has been typed after the slash. Names that start with it come first. */
export function filterSlashItems(query: string): SlashItem[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...SLASH_ITEMS];

  const scored: { item: SlashItem; score: number }[] = [];
  for (const item of SLASH_ITEMS) {
    const label = item.label.toLowerCase();
    const words = [label, ...item.keywords];
    let score = -1;
    if (label.startsWith(needle)) score = 0;
    else if (words.some((word) => word.startsWith(needle))) score = 1;
    else if (label.includes(needle)) score = 2;
    if (score >= 0) scored.push({ item, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((entry) => entry.item);
}

/** The command palette's data and search, with no React in it. */

export interface PaletteCommand {
  id: string;
  title: string;
  /** Group label shown beside the title, such as "Tools" or "Templates". */
  section: string;
  /** Extra words that should find this command. */
  keywords?: string;
  /** A hint of the key combination, display only. */
  shortcut?: string;
  run: () => void;
}

function norm(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** True when every letter of `needle` appears in `haystack` in order. */
function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const char of haystack) {
    if (char === needle[at]) at += 1;
    if (at === needle.length) return true;
  }
  return needle.length === 0;
}

function scoreToken(token: string, title: string, rest: string): number {
  const words = title.split(/[^a-z0-9]+/);
  if (title.startsWith(token)) return 100;
  if (words.some((word) => word.startsWith(token))) return 80;
  if (title.includes(token)) return 60;
  if (rest.includes(token)) return 30;
  if (token.length >= 3 && isSubsequence(token, title)) return 15;
  return 0;
}

/** Higher is better; 0 means the command does not match. Every word of the query must match. */
export function scoreCommand(query: string, command: PaletteCommand): number {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;
  const title = norm(command.title);
  const rest = norm(`${command.section} ${command.keywords ?? ''}`);
  let total = 0;
  for (const token of tokens) {
    const score = scoreToken(token, title, rest);
    if (score === 0) return 0;
    total += score;
  }
  return total;
}

/** The matching commands, best first. An empty query lists them in their given order. */
export function filterCommands(query: string, commands: readonly PaletteCommand[], limit = 12): PaletteCommand[] {
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(query, command) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.command);
}

/** Moves the highlighted row, wrapping at both ends. */
export function moveHighlight(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((current + delta) % count) + count) % count;
}

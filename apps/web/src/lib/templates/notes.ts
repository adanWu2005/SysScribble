import type { RoomTemplateId } from '@wb/shared';

/**
 * The starting text for each template, as ProseMirror JSON. It is only ever built into a document
 * through the editor's own schema (see build.ts), so it can contain nothing the editor could not.
 */

export interface NotesJson {
  type: 'doc';
  content: NodeJson[];
}

export interface NodeJson {
  type: string;
  attrs?: Record<string, unknown>;
  content?: NodeJson[];
  text?: string;
}

const text = (value: string): NodeJson => ({ type: 'text', text: value });
const paragraph = (value: string): NodeJson => ({ type: 'paragraph', content: [text(value)] });
const heading = (level: 1 | 2 | 3, value: string): NodeJson => ({ type: 'heading', attrs: { level }, content: [text(value)] });
const bullets = (items: readonly string[]): NodeJson => ({
  type: 'bulletList',
  content: items.map((item) => ({ type: 'listItem', content: [paragraph(item)] })),
});
const tasks = (items: readonly string[]): NodeJson => ({
  type: 'taskList',
  content: items.map((item) => ({ type: 'taskItem', attrs: { checked: false }, content: [paragraph(item)] })),
});
const callout = (value: string): NodeJson => ({ type: 'callout', content: [paragraph(value)] });

function rfc(): NodeJson[] {
  return [
    callout('Status: Draft. Replace the prompts below. The diagram on the whiteboard shows the proposed request path.'),
    heading(2, 'Summary'),
    paragraph('One paragraph: what is being proposed and why now.'),
    heading(2, 'Context'),
    paragraph('What exists today, and what is painful about it.'),
    heading(2, 'Goals and non-goals'),
    bullets(['Goal: ', 'Goal: ', 'Non-goal: ']),
    heading(2, 'Proposed design'),
    paragraph('Describe how the client, API, cache and database work together. Link shapes from the whiteboard here.'),
    heading(3, 'Data model'),
    paragraph('Tables, keys and indexes that change.'),
    heading(3, 'Failure modes'),
    bullets(['What happens when Redis is down?', 'What happens when Postgres is slow?']),
    heading(2, 'Alternatives considered'),
    bullets(['Option A and why not', 'Option B and why not']),
    heading(2, 'Open questions'),
    tasks(['Question for the team', 'Question for security review']),
    heading(2, 'Rollout plan'),
    tasks(['Behind a flag', 'Canary', 'Full rollout', 'Remove the flag']),
  ];
}

function kanban(): NodeJson[] {
  return [
    heading(2, 'Sprint goals'),
    bullets(['Goal 1: ', 'Goal 2: ', 'Goal 3: ']),
    heading(2, 'Definition of done'),
    tasks(['Code reviewed', 'Tests written and passing', 'Documented', 'Deployed']),
    heading(2, 'Capacity and risks'),
    paragraph('Who is out, and what could slow us down.'),
    heading(2, 'Notes'),
    paragraph('Decisions and links from stand-ups go here.'),
  ];
}

function retro(): NodeJson[] {
  return [
    callout('Add a sticky to each column on the whiteboard, then group similar ones and vote.'),
    heading(2, 'Ground rules'),
    bullets(['Focus on the process, not the people', 'Everyone speaks', 'End with owners and dates']),
    heading(2, 'Discussion'),
    paragraph('Themes that came up.'),
    heading(2, 'Action items'),
    tasks(['Action: owner, due date', 'Action: owner, due date']),
  ];
}

/** The notes for a template, or null for a blank room. */
export function templateNotes(id: RoomTemplateId): NotesJson | null {
  switch (id) {
    case 'blank':
      return null;
    case 'rfc':
      return { type: 'doc', content: rfc() };
    case 'kanban':
      return { type: 'doc', content: kanban() };
    case 'retro':
      return { type: 'doc', content: retro() };
  }
}

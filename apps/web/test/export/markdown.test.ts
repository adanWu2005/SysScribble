// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { notesSchemaExtensions } from '@/components/editor/extensions';
import { escapeMarkdown, notesToMarkdown } from '@/lib/export/markdown';
import { exportFileName, fileStem } from '@/lib/export/files';

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const t = (text: string, ...marks: string[]) => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const md = (json: unknown, options = {}) => notesToMarkdown(json, options);

describe('blocks', () => {
  it('writes headings and paragraphs separated by blank lines', () => {
    const out = md(doc({ type: 'heading', attrs: { level: 2 }, content: [t('Plan')] }, p(t('First')), p(t('Second'))));
    expect(out).toBe('## Plan\n\nFirst\n\nSecond\n');
  });

  it('clamps heading levels', () => {
    expect(md(doc({ type: 'heading', attrs: { level: 99 }, content: [t('x')] }))).toBe('###### x\n');
    expect(md(doc({ type: 'heading', attrs: { level: -3 }, content: [t('x')] }))).toBe('# x\n');
    expect(md(doc({ type: 'heading', attrs: { level: 'big' }, content: [t('x')] }))).toBe('# x\n');
  });

  it('writes bullet, ordered and nested lists', () => {
    const list = {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p(t('one')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('inner'))] }] }] },
        { type: 'listItem', content: [p(t('two'))] },
      ],
    };
    expect(md(doc(list))).toBe('- one\n  - inner\n- two\n');

    const ordered = { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(t('a'))] }, { type: 'listItem', content: [p(t('b'))] }] };
    expect(md(doc(ordered))).toBe('3. a\n4. b\n');
  });

  it('writes task lists with their checked state', () => {
    const tasks = {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [p(t('done'))] },
        { type: 'taskItem', attrs: { checked: false }, content: [p(t('todo'))] },
      ],
    };
    expect(md(doc(tasks))).toBe('- [x] done\n- [ ] todo\n');
  });

  it('writes code blocks with a fence longer than any backticks inside', () => {
    const code = { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = "```";' }] };
    expect(md(doc(code))).toBe('````ts\nconst a = "```";\n````\n');
  });

  it('drops a language that could break out of the fence line', () => {
    const code = { type: 'codeBlock', attrs: { language: 'ts\n<script>' }, content: [{ type: 'text', text: 'x' }] };
    expect(md(doc(code))).toBe('```\nx\n```\n');
  });

  it('writes quotes, callouts and rules', () => {
    expect(md(doc({ type: 'blockquote', content: [p(t('quoted'))] }))).toBe('> quoted\n');
    expect(md(doc({ type: 'callout', content: [p(t('careful'))] }))).toBe('> [!NOTE]\n> careful\n');
    expect(md(doc(p(t('a')), { type: 'horizontalRule' }, p(t('b'))))).toBe('a\n\n---\n\nb\n');
  });

  it('skips empty paragraphs so blank lines do not pile up', () => {
    expect(md(doc(p(t('a')), p(), p(), p(t('b'))))).toBe('a\n\nb\n');
  });

  it('writes a title as a heading', () => {
    expect(md(doc(p(t('body'))), { title: 'Sprint *notes*' })).toBe('# Sprint \\*notes\\*\n\nbody\n');
    expect(md(doc(p(t('body'))), { title: '   ' })).toBe('body\n');
  });

  it('gives a note that is empty or not a document as just a newline', () => {
    for (const bad of [null, undefined, 'text', 7, [], {}, { type: 7 }, doc()]) expect(md(bad)).toBe('\n');
  });
});

describe('inline formatting', () => {
  it('writes each mark', () => {
    expect(md(doc(p(t('b', 'bold'), t(' '), t('i', 'italic'), t(' '), t('s', 'strike'), t(' '), t('h', 'highlight'), t(' '), t('u', 'underline'))))).toBe(
      '**b** *i* ~~s~~ ==h== <u>u</u>\n',
    );
  });

  it('nests marks and keeps spaces outside the markers', () => {
    expect(md(doc(p(t('both', 'bold', 'italic'))))).toBe('***both***\n');
    expect(md(doc(p(t(' padded ', 'bold'))))).toBe(' **padded** \n');
  });

  it('writes code spans, widening the fence around backticks and not escaping inside', () => {
    expect(md(doc(p(t('a*b_c', 'code'))))).toBe('`a*b_c`\n');
    expect(md(doc(p(t('x`y', 'code'))))).toBe('``x`y``\n');
  });

  it('writes a hard break', () => {
    expect(md(doc(p(t('a'), { type: 'hardBreak' }, t('b'))))).toBe('a  \nb\n');
  });

  it('keeps only safe links', () => {
    const link = (href: string) => ({ type: 'text', text: 'go', marks: [{ type: 'link', attrs: { href } }] });
    expect(md(doc(p(link('https://example.com/a?b=1'))))).toBe('[go](https://example.com/a?b=1)\n');
    expect(md(doc(p(link('mailto:me@example.com'))))).toBe('[go](mailto:me@example.com)\n');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.test', '']) {
      expect(md(doc(p(link(bad))))).toBe('go\n');
    }
  });

  it('keeps a link destination from closing early', () => {
    const link = { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'https://e.test/a)b(c d' } }] };
    expect(md(doc(p(link)))).toBe('[x](https://e.test/a%29b%28c%20d)\n');
  });
});

describe('shape badges', () => {
  const badge = (shapeId: unknown, label: unknown) => ({ type: 'shapeRef', attrs: { shapeId, label } });

  it('links to the shape when a link can be built', () => {
    const out = md(doc(p(t('see '), badge('abc-1', 'Sticky note: Hi'))), {
      linkForShape: (id: string) => `https://app.test/rooms/r#shape=${id}`,
    });
    expect(out).toBe('see [Sticky note: Hi](https://app.test/rooms/r#shape=abc-1)\n');
  });

  it('leaves plain text when there is no link', () => {
    expect(md(doc(p(badge('abc', 'Box'))))).toBe('[Box]\n');
  });

  it('never builds a link for a bad id or an unsafe URL', () => {
    const options = { linkForShape: () => 'javascript:alert(1)' };
    expect(md(doc(p(badge('abc', 'Box'))), options)).toBe('[Box]\n');
    let called = false;
    md(doc(p(badge('a b<>', 'Box'))), { linkForShape: () => ((called = true), 'https://x.test') });
    expect(called).toBe(false);
  });

  it('cleans and escapes a hostile label', () => {
    expect(md(doc(p(badge('abc', '*[x](javascript:alert(1))*\u0000'))))).toBe('[\\*\\[x\\](javascript:alert(1))\\*]\n');
  });
});

describe('escaping', () => {
  it('stops plain text from becoming formatting', () => {
    expect(escapeMarkdown('*a* _b_ `c` [d] <e> ~f~ | \\')).toBe('\\*a\\* \\_b\\_ \\`c\\` \\[d\\] \\<e\\> \\~f\\~ \\| \\\\');
  });

  it('stops a line from becoming a heading, quote, list item or numbered item', () => {
    expect(md(doc(p(t('# not a heading'))))).toBe('\\# not a heading\n');
    expect(md(doc(p(t('> not a quote'))))).toBe('\\> not a quote\n');
    expect(md(doc(p(t('- not a list'))))).toBe('\\- not a list\n');
    expect(md(doc(p(t('1. not numbered'))))).toBe('1\\. not numbered\n');
  });

  it('keeps a script tag as visible text', () => {
    expect(md(doc(p(t('<script>alert(1)</script>'))))).toBe('\\<script\\>alert(1)\\</script\\>\n');
  });
});

describe('untrusted structure', () => {
  it('keeps the text of an unknown node and drops its structure', () => {
    const odd = { type: 'script', content: [t('alert(1)')] };
    expect(md(doc(odd))).toBe('alert(1)\n');
  });

  it('ignores malformed marks and attributes', () => {
    const bad = { type: 'text', text: 'x', marks: [null, 7, { type: 3 }, { type: 'link', attrs: 'oops' }] };
    expect(md(doc(p(bad)))).toBe('x\n');
  });

  it('survives absurd nesting without crashing', () => {
    let node: unknown = p(t('deep'));
    for (let i = 0; i < 5000; i++) node = { type: 'blockquote', content: [node] };
    expect(() => md(doc(node))).not.toThrow();
  });
});

describe('from a real editor', () => {
  const editors: Editor[] = [];
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
  });

  it('exports what the editor produced', () => {
    const editor = new Editor({
      extensions: notesSchemaExtensions(),
      content:
        '<h1>Title</h1><p>Some <strong>bold</strong> and <mark>marked</mark> text.</p>' +
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>done</p></div></li></ul>' +
        '<div data-callout class="callout"><p>careful</p></div>' +
        '<p>see <span data-shape-ref="abc-1" data-label="Box"></span></p>',
    });
    editors.push(editor);
    const out = md(editor.getJSON(), { linkForShape: (id: string) => `https://app.test/#shape=${id}` });
    expect(out).toContain('# Title');
    expect(out).toContain('Some **bold** and ==marked== text.');
    expect(out).toContain('- [x] done');
    expect(out).toContain('> [!NOTE]\n> careful');
    expect(out).toContain('see [Box](https://app.test/#shape=abc-1)');
  });
});

describe('file names', () => {
  it('keeps a safe stem', () => {
    expect(fileStem('Sprint Planning / Q4: "final"')).toBe('Sprint-Planning-Q4-final');
    expect(fileStem('../../etc/passwd')).toBe('etcpasswd');
    expect(fileStem('???')).toBe('workspace');
    expect(fileStem('x'.repeat(200))).toHaveLength(60);
    expect(fileStem('Café notes')).toBe('Cafe-notes');
  });

  it('builds a dated name', () => {
    expect(exportFileName('My Board', 'whiteboard', 'png', new Date('2026-11-07T12:00:00Z'))).toBe(
      'My-Board-whiteboard-2026-11-07.png',
    );
  });
});

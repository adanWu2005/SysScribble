// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { notesSchemaExtensions } from '@/components/editor/extensions';

const editors: Editor[] = [];

function build(content: string): Editor {
  const editor = new Editor({ extensions: notesSchemaExtensions(), content });
  editors.push(editor);
  return editor;
}

const htmlOf = (content: string) => build(content).getHTML();

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('the closed notes schema, against pasted HTML', () => {
  it('drops script, iframe, img and style elements', () => {
    const html = htmlOf(
      '<p>safe</p><script>alert(1)</script><iframe src="https://evil.test"></iframe>' +
        '<img src="x" onerror="alert(1)"><style>body{display:none}</style>',
    );
    expect(html).toContain('safe');
    for (const bad of ['<script', '<iframe', '<img', '<style', 'onerror', 'alert']) {
      expect(html.toLowerCase()).not.toContain(bad);
    }
  });

  it('drops event handler and style attributes', () => {
    const html = htmlOf('<p onclick="alert(1)" style="color:red" id="x">hi</p>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('id="x"');
  });

  it('keeps no link that is not http, https or mailto', () => {
    const html = htmlOf(
      '<p><a href="javascript:alert(1)">a</a> <a href="data:text/html,x">b</a> <a href="https://ok.test">c</a></p>',
    );
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:');
    expect(html).toContain('https://ok.test');
  });

  it('highlights without any inline CSS', () => {
    const html = htmlOf('<p><mark style="background:url(https://evil.test/track)" data-color="red">x</mark></p>');
    expect(html).toContain('<mark>x</mark>');
    expect(html).not.toContain('evil.test');
    expect(html).not.toContain('style');
  });

  it('has no raw HTML node at all', () => {
    const names = build('').schema.nodes;
    for (const name of Object.keys(names)) expect(name.toLowerCase()).not.toMatch(/html|raw|embed|iframe/);
  });
});

describe('the formatting nodes', () => {
  it('round-trips the supported blocks', () => {
    const source =
      '<h1>One</h1><h2>Two</h2><h3>Three</h3><ul><li><p>bullet</p></li></ul>' +
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>done</p></div></li></ul>' +
      '<div data-callout class="callout"><p>careful</p></div><pre><code>let a = 1</code></pre><hr>';
    const html = htmlOf(source);
    for (const expected of ['<h1>', '<h2>', '<h3>', '<ul>', 'data-type="taskList"', 'data-callout', '<pre>', '<hr']) {
      expect(html).toContain(expected);
    }
  });

  it('limits headings to three levels', () => {
    expect(htmlOf('<h4>deep</h4>')).not.toContain('<h4');
  });
});

describe('shape badges', () => {
  it('reads a valid badge', () => {
    const html = htmlOf('<p>see <span data-shape-ref="abc-123_x" data-label="My box"></span></p>');
    expect(html).toContain('data-shape-ref="abc-123_x"');
    expect(html).toContain('>My box</span>');
  });

  it.each([
    ['an id with spaces and markup', 'a b<script>'],
    ['an empty id', ''],
    ['an id that is too long', 'x'.repeat(65)],
    ['an id with quotes', 'a"onmouseover="alert(1)'],
  ])('refuses a badge with %s', (_name, id) => {
    const editor = build('');
    const wrapper = document.createElement('div');
    const span = document.createElement('span');
    span.setAttribute('data-shape-ref', id);
    wrapper.append(span);
    editor.commands.setContent(wrapper.innerHTML);
    expect(editor.getHTML()).not.toContain('shape-ref');
  });

  it('draws a hostile label as text', () => {
    const editor = build('');
    editor.commands.insertContent({
      type: 'shapeRef',
      attrs: { shapeId: 'abc', label: '<img src=x onerror=alert(1)>' },
    });
    const html = editor.getHTML();
    // Parse it the way a browser would. The markup in the label must not become an element,
    // whether it ends up in the visible text or in the data-label attribute.
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.querySelector('img')).toBeNull();
    expect(parsed.querySelector('[onerror]')).toBeNull();
    expect(parsed.querySelector('.shape-ref')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  it('clips a long label and strips control characters', () => {
    const editor = build('');
    editor.commands.insertContent({
      type: 'shapeRef',
      attrs: { shapeId: 'abc', label: `${'x'.repeat(500)}\u0000\u0007` },
    });
    const label = /data-label="([^"]*)"/.exec(editor.getHTML())?.[1] ?? '';
    expect(label.length).toBeLessThanOrEqual(60);
    expect(label).not.toMatch(/[\u0000-\u001f]/);
  });
});

describe('content that arrives over Yjs', () => {
  function collaborative(prepare: (fragment: Y.XmlFragment) => void): Editor {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('notes');
    prepare(fragment);
    const editor = new Editor({
      extensions: [...notesSchemaExtensions(), Collaboration.configure({ fragment })],
    });
    editors.push(editor);
    return editor;
  }

  it('never writes a hostile badge id into an attribute', () => {
    const editor = collaborative((fragment) => {
      const paragraph = new Y.XmlElement('paragraph');
      const badge = new Y.XmlElement('shapeRef');
      badge.setAttribute('shapeId', '"><script>alert(1)</script>');
      badge.setAttribute('label', 'x');
      paragraph.insert(0, [badge]);
      fragment.insert(0, [paragraph]);
    });
    const html = editor.getHTML();
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert');
  });

  it('does not render a node type the schema does not define', () => {
    let editor: Editor | undefined;
    expect(() => {
      editor = collaborative((fragment) => {
        const evil = new Y.XmlElement('script');
        evil.insert(0, [new Y.XmlText('alert(1)')]);
        const paragraph = new Y.XmlElement('paragraph');
        paragraph.insert(0, [new Y.XmlText('kept')]);
        fragment.insert(0, [evil, paragraph]);
      });
    }).not.toThrow();
    const html = editor?.getHTML() ?? '';
    expect(html).not.toContain('<script');
  });
});

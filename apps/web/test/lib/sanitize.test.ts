// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isSafeUrl, sanitize } from '@/lib/sanitize';

describe('isSafeUrl', () => {
  it.each(['https://example.com', 'http://example.com/a?b=1', 'mailto:a@b.c', '/relative', '#anchor'])(
    'allows %s',
    (url) => {
      expect(isSafeUrl(url)).toBe(true);
    },
  );

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('blocks %s', (url) => {
    expect(isSafeUrl(url)).toBe(false);
  });
});

describe('sanitize', () => {
  it('removes the multiplayer stored XSS payload from the PRD', () => {
    const clean = sanitize('<p>hi</p><img src=x onerror=alert(document.cookie)>');
    expect(clean).not.toContain('onerror');
    expect(clean).toContain('<p>hi</p>');
  });

  it.each([
    '<script>alert(1)</script>',
    '<svg onload=alert(1)></svg>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
    '<div style="background:url(javascript:alert(1))">x</div>',
    '<form action="https://evil.example"><input name="p"></form>',
  ])('neutralizes %s', (payload) => {
    const clean = sanitize(payload).toLowerCase();
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onload');
    expect(clean).not.toContain('<form');
  });
});

import DOMPurify from 'dompurify';

const SAFE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

/** Link allowlist for the editor. Blocks javascript:, data:, vbscript: and friends (PRD §5.5). */
export function isSafeUrl(value: string): boolean {
  try {
    // A base URL lets relative links parse. Parsing also defeats case and whitespace tricks.
    return SAFE_PROTOCOLS.has(new URL(value, 'https://relative.invalid').protocol);
  } catch {
    return false;
  }
}

/**
 * Sanitizes rich content rendered outside the TipTap schema. Browser only. The editor
 * itself has a closed schema, so this is for exports and previews.
 */
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'svg', 'math'],
    FORBID_ATTR: ['style', 'srcset'],
  });
}

/** Light, dark, or follow the system. Pure, so the rules are testable; the browser glue is in `useTheme`. */

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = 'wb:theme';
export const THEME_ORDER: readonly ThemePref[] = ['system', 'light', 'dark'];

/** Anything that is not a known value (a stale or tampered storage entry) means "follow the system". */
export function parseThemePref(raw: unknown): ThemePref {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

export function nextThemePref(pref: ThemePref): ThemePref {
  const index = THEME_ORDER.indexOf(pref);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? 'system';
}

/**
 * Runs in the <head> before the first paint so a dark page never flashes white. It is a constant
 * with no user input in it, and the page's CSP nonce is what lets it run. It must stay in step
 * with `resolveTheme`; a test runs it against that function.
 *
 * It is rendered as plain text, which React escapes, so it contains none of the characters React
 * escapes (& < > quotes). Strings use backticks and the logic uses ternaries instead of &&.
 */
export const THEME_SCRIPT = [
  '(function(){try{',
  'var p=localStorage.getItem(`' + THEME_KEY + '`);',
  'var d=p===`dark`||(p!==`light`?matchMedia(`(prefers-color-scheme: dark)`).matches:false);',
  'document.documentElement.classList.toggle(`dark`,d);',
  '}catch(e){}})();',
].join('');

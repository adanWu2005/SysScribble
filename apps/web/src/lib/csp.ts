export interface CspOptions {
  nonce: string;
  isDev: boolean;
  supabaseUrl: string;
  wsUrl: string;
  livekitUrl: string;
}

const R2 = 'https://*.r2.cloudflarestorage.com';

/**
 * Per-request policy. Scripts need the nonce, so an injected <script> or inline handler
 * does not run even if sanitizing ever fails (PRD §5.5). `strict-dynamic` lets the trusted
 * bootstrap load its own chunks. Styles keep 'unsafe-inline' because Konva, TipTap and
 * LiveKit set inline styles.
 */
export function buildCsp({ nonce, isDev, supabaseUrl, wsUrl, livekitUrl }: CspOptions): string {
  const connect = [
    "'self'",
    supabaseUrl,
    supabaseUrl.replace(/^http/, 'ws'),
    wsUrl,
    livekitUrl,
    'wss://*.livekit.cloud',
    'https://*.livekit.cloud',
    R2,
    ...(isDev ? ['ws://localhost:*'] : []),
  ];
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${R2}`,
    `connect-src ${connect.filter((source) => source.length > 0).join(' ')}`,
    "media-src 'self' blob: mediastream:",
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

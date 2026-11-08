import 'server-only';
import { Resend } from 'resend';
import { publicEnv } from '@/lib/env';
import { getServerEnv } from '@/lib/env.server';

let client: Resend | null = null;

function getClient(): Resend {
  client ??= new Resend(getServerEnv().RESEND_API_KEY);
  return client;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Room titles are user input. Unescaped, they could inject markup into a trusted email. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export function inviteUrl(token: string): string {
  // A fragment never reaches a server, so the token stays out of access logs and referrers.
  return `${publicEnv.NEXT_PUBLIC_APP_URL}/invite#${token}`;
}

export interface InviteEmail {
  to: string;
  roomTitle: string;
  token: string;
}

export async function sendInviteEmail({ to, roomTitle, token }: InviteEmail): Promise<void> {
  const link = inviteUrl(token);
  const { error } = await getClient().emails.send({
    from: getServerEnv().RESEND_FROM,
    to,
    subject: 'You have been invited to a workspace',
    text: `You have been invited to collaborate on "${roomTitle}".\n\nAccept within 48 hours:\n${link}\n`,
    html: `<p>You have been invited to collaborate on <strong>${escapeHtml(roomTitle)}</strong>.</p>
<p><a href="${escapeHtml(link)}">Accept the invitation</a>. This link expires in 48 hours and works once.</p>`,
  });
  if (error) throw new Error(`Resend rejected the email: ${error.name}: ${error.message}`);
}

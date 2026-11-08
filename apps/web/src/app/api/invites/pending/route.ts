import { json, route } from '@/lib/api';
import { requireUser } from '@/lib/auth/requireUser';
import { listPendingInvitesForEmail } from '@/lib/db/invites';

export const dynamic = 'force-dynamic';

/**
 * GET /api/invites/pending — invitations addressed to the caller's own email. The email comes from
 * the verified JWT and nothing in the request can name another one.
 */
export const GET = route(async ({ req }) => {
  const user = await requireUser(req);
  const invites = user.email ? await listPendingInvitesForEmail(user.email) : [];
  return json({ invites });
});

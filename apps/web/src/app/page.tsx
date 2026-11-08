import { Landing } from '@/components/landing/Landing';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { listPendingInvitesForEmail } from '@/lib/db/invites';
import { getOwnProfile } from '@/lib/db/profile';
import { listRoomsForUser } from '@/lib/db/rooms';
import { sumMediaBytes } from '@/lib/db/usage';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Signed-out visitors get the welcome page; signed-in people get their workspaces, at the same URL.
  if (!user) return <Landing />;

  // Only rooms this user belongs to are listed, and only they are counted toward the media total.
  const rooms = await listRoomsForUser(user.id);
  const email = user.email ?? '';
  // Invitations are matched on the signed-in account's own verified email, never on anything sent by the browser.
  const [profile, usedBytes, invites] = await Promise.all([
    getOwnProfile(user.id),
    sumMediaBytes(rooms.map((room) => room.id)),
    // The banner is an extra: if it cannot load (for instance before migration 0007 is applied), the
    // dashboard still opens without it.
    email ? listPendingInvitesForEmail(email).catch(() => []) : Promise.resolve([]),
  ]);

  return (
    <DashboardShell
      user={{ id: user.id, name: profile.displayName ?? (email.split('@')[0] || 'You'), email }}
      rooms={rooms}
      usedBytes={usedBytes}
      invites={invites}
    />
  );
}

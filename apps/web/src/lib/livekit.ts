import 'server-only';
import { LIVEKIT_TOKEN_TTL_SEC, canMutate, type RoomRole } from '@wb/shared';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { publicEnv } from '@/lib/env';
import { getServerEnv } from '@/lib/env.server';

export function huddleRoomName(roomId: string): string {
  return `room-${roomId}`;
}

/**
 * Scoped to one room. Viewers listen only (PRD §3.5). canPublish is off for them as well
 * as canPublishData, because a grant with only the latter would still let them send
 * audio and video.
 */
export async function mintHuddleToken(roomId: string, userId: string, name: string, role: RoomRole): Promise<string> {
  const env = getServerEnv();
  const writable = canMutate(role);
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: userId,
    name,
    ttl: LIVEKIT_TOKEN_TTL_SEC,
  });
  token.addGrant({
    room: huddleRoomName(roomId),
    roomJoin: true,
    canSubscribe: true,
    canPublish: writable,
    canPublishData: writable,
  });
  return token.toJwt();
}

function serviceClient(): RoomServiceClient {
  const env = getServerEnv();
  const host = publicEnv.NEXT_PUBLIC_LIVEKIT_URL.replace(/^ws/, 'http');
  return new RoomServiceClient(host, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
}

/**
 * A token only gates the join, so a downgraded user already in a call must be changed
 * live. Failure is expected when they are not in a call, and is never fatal.
 */
export async function setHuddlePermissions(roomId: string, userId: string, role: RoomRole): Promise<void> {
  const writable = canMutate(role);
  await serviceClient()
    .updateParticipant(huddleRoomName(roomId), userId, {
      permission: { canSubscribe: true, canPublish: writable, canPublishData: writable },
    })
    .catch(() => undefined);
}

export async function removeFromHuddle(roomId: string, userId: string): Promise<void> {
  await serviceClient()
    .removeParticipant(huddleRoomName(roomId), userId)
    .catch(() => undefined);
}

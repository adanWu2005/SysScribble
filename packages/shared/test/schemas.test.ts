import { describe, expect, it } from 'vitest';
import { controlEventSchema, roomIdFromChannel } from '../src/control-events';
import { MAX_UPLOAD_BYTES } from '../src/limits';
import { uuidSchema } from '../src/schemas/ids';
import { acceptInviteSchema, createInviteSchema } from '../src/schemas/invites';
import { createRoomSchema } from '../src/schemas/rooms';
import { R2_KEY_REGEX, uploadUrlRequestSchema } from '../src/schemas/uploads';
import { shapeSchema } from '../src/schemas/whiteboard';

const ROOM = '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';

describe('uuid guard', () => {
  it('rejects SQL-ish input', () => {
    expect(uuidSchema.safeParse("' OR 1=1 --").success).toBe(false);
    expect(uuidSchema.safeParse(ROOM).success).toBe(true);
  });
});

describe('uploads', () => {
  it('rejects SVG and other unlisted MIME types', () => {
    for (const contentType of ['image/svg+xml', 'text/html', 'application/javascript', 'image/gif']) {
      const r = uploadUrlRequestSchema.safeParse({ filename: 'a', contentType, sizeBytes: 10 });
      expect(r.success, contentType).toBe(false);
    }
  });

  it('accepts the four safe types up to the byte cap', () => {
    const r = uploadUrlRequestSchema.safeParse({
      filename: 'photo.png',
      contentType: 'image/png',
      sizeBytes: MAX_UPLOAD_BYTES,
    });
    expect(r.success).toBe(true);
    expect(
      uploadUrlRequestSchema.safeParse({ filename: 'x', contentType: 'image/png', sizeBytes: MAX_UPLOAD_BYTES + 1 })
        .success,
    ).toBe(false);
  });

  it('rejects path traversal in filenames', () => {
    expect(
      uploadUrlRequestSchema.safeParse({ filename: '../../etc/passwd', contentType: 'image/png', sizeBytes: 1 })
        .success,
    ).toBe(false);
  });

  it('object key regex only matches server-generated keys', () => {
    expect(R2_KEY_REGEX.test(`rooms/${ROOM}/${ROOM}.png`)).toBe(true);
    expect(R2_KEY_REGEX.test(`rooms/${ROOM}/../other/x.png`)).toBe(false);
    expect(R2_KEY_REGEX.test(`rooms/${ROOM}/${ROOM}.svg`)).toBe(false);
  });
});

describe('invites', () => {
  it('normalises email to lowercase', () => {
    const r = createInviteSchema.parse({ email: '  Alice@Example.COM ' });
    expect(r.email).toBe('alice@example.com');
    expect(r.role).toBe('EDITOR');
  });

  it('accepts only 43-char base64url tokens', () => {
    expect(acceptInviteSchema.safeParse({ token: 'a'.repeat(43) }).success).toBe(true);
    expect(acceptInviteSchema.safeParse({ token: 'a'.repeat(42) }).success).toBe(false);
    expect(acceptInviteSchema.safeParse({ token: 'a'.repeat(42) + '=' }).success).toBe(false);
  });
});

describe('rooms', () => {
  it('defaults and trims the title', () => {
    expect(createRoomSchema.parse({}).title).toBe('Untitled Workspace');
    expect(createRoomSchema.parse({ title: '  Plan  ' }).title).toBe('Plan');
    expect(createRoomSchema.safeParse({ title: 'x'.repeat(121) }).success).toBe(false);
  });
});

describe('control events', () => {
  it('parses a role change and extracts the room id from a channel', () => {
    const ev = controlEventSchema.parse({ type: 'ROLE_CHANGED', roomId: ROOM, userId: ROOM, role: 'VIEWER' });
    expect(ev.type).toBe('ROLE_CHANGED');
    expect(roomIdFromChannel(`room:${ROOM}:control`)).toBe(ROOM);
    expect(roomIdFromChannel('room:nope:control')).toBeNull();
  });
});

describe('shapes', () => {
  it('rejects a shape with a non-finite coordinate or bad colour', () => {
    expect(
      shapeSchema.safeParse({ id: 'a', type: 'rect', x: Number.POSITIVE_INFINITY, y: 0, width: 1, height: 1, fill: '#ffffff' })
        .success,
    ).toBe(false);
    expect(
      shapeSchema.safeParse({ id: 'a', type: 'rect', x: 0, y: 0, width: 1, height: 1, fill: 'javascript:alert(1)' }).success,
    ).toBe(false);
  });
});

import { DUPLICATE_MAX_ASSETS, type Asset, type Shape } from '@wb/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ApiError } from '@/lib/api';
import { duplicateRoom, remapAssets } from '@/lib/db/duplicate';
import { addShapes, readShapes } from '@/lib/whiteboard/model';

const mocks = vi.hoisted(() => ({
  listAssets: vi.fn(),
  reserveAsset: vi.fn(),
  createRoom: vi.fn(),
  deleteRoom: vi.fn(),
  setInitialSnapshot: vi.fn(),
  copyObject: vi.fn(),
  deleteObjects: vi.fn(),
  buildObjectKey: vi.fn(),
  snapshot: { bytes: null as Uint8Array | null },
}));

vi.mock('@/lib/db/assets', () => ({ listAssets: mocks.listAssets, reserveAsset: mocks.reserveAsset }));
vi.mock('@/lib/db/rooms', () => ({
  createRoom: mocks.createRoom,
  deleteRoom: mocks.deleteRoom,
  setInitialSnapshot: mocks.setInitialSnapshot,
}));
vi.mock('@/lib/r2', () => ({
  copyObject: mocks.copyObject,
  deleteObjects: mocks.deleteObjects,
  buildObjectKey: mocks.buildObjectKey,
}));
vi.mock('@wb/shared/server', () => ({ byteaToBytes: (value: unknown) => value }));
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { yjs_snapshot: mocks.snapshot.bytes }, error: null }) }),
      }),
    }),
  }),
}));

const OWNER = '11111111-2222-4333-8444-555555555555';
const SOURCE = '8b2f6c7e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';
const COPY = '9c3a7d8f-2b3c-4d4e-8f90-1b2c3d4e5f60';
const OLD_ASSET = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const asset = (id: string, over: Partial<Asset> = {}): Asset => ({
  id,
  roomId: SOURCE,
  uploadedBy: OWNER,
  objectKey: `rooms/${SOURCE}/${id}.png`,
  mimeType: 'image/png',
  sizeBytes: 1000,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

const base = { rotation: 0, x: 0, y: 0, width: 10, height: 10 };
const image = (id: string, assetId: string): Shape => ({ ...base, id, type: 'image', assetId });
const rect = (id: string): Shape => ({ ...base, id, type: 'rect', fill: '#ffffff' });

function snapshotWith(shapes: Shape[]): Uint8Array {
  const doc = new Y.Doc();
  addShapes(doc, shapes);
  return Y.encodeStateAsUpdate(doc);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.snapshot.bytes = snapshotWith([rect('r'), image('i', OLD_ASSET)]);
  mocks.listAssets.mockResolvedValue([asset(OLD_ASSET)]);
  mocks.reserveAsset.mockResolvedValue(true);
  mocks.createRoom.mockImplementation(async (_owner: string, title: string) => ({ id: COPY, title }));
  mocks.deleteRoom.mockResolvedValue(undefined);
  mocks.setInitialSnapshot.mockResolvedValue(undefined);
  mocks.copyObject.mockResolvedValue(undefined);
  mocks.deleteObjects.mockResolvedValue(undefined);
  mocks.buildObjectKey.mockImplementation((room: string, id: string) => `rooms/${room}/${id}.png`);
});

describe('remapAssets', () => {
  it('points copied pictures at their new files and removes ones that were not copied', () => {
    const doc = new Y.Doc();
    addShapes(doc, [rect('r'), image('kept', OLD_ASSET), image('lost', 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee')]);
    remapAssets(doc, new Map([[OLD_ASSET, 'dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee']]));
    const shapes = readShapes(doc);
    expect(shapes.map((s) => s.id).sort()).toEqual(['kept', 'r']);
    const kept = shapes.find((s) => s.id === 'kept');
    expect(kept && 'assetId' in kept && kept.assetId).toBe('dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });
});

describe('duplicateRoom', () => {
  it('copies the board into a new room owned by the caller, with its files at new keys', async () => {
    const room = await duplicateRoom(SOURCE, 'Plan', OWNER);
    expect(room.id).toBe(COPY);
    expect(mocks.createRoom).toHaveBeenCalledWith(OWNER, 'Plan (copy)');

    // The file is copied from the source key to a key under the NEW room, never the old one.
    const [from, to] = mocks.copyObject.mock.calls[0] as [string, string];
    expect(from).toBe(`rooms/${SOURCE}/${OLD_ASSET}.png`);
    expect(to.startsWith(`rooms/${COPY}/`)).toBe(true);
    expect(mocks.reserveAsset).toHaveBeenCalledWith(expect.objectContaining({ roomId: COPY, uploadedBy: OWNER }));

    // The stored board points at the new asset, so nothing in the copy refers to the old room's file.
    const [, bytes] = mocks.setInitialSnapshot.mock.calls[0] as [string, Uint8Array];
    const doc = new Y.Doc();
    Y.applyUpdate(doc, bytes);
    const picture = readShapes(doc).find((s) => s.type === 'image');
    expect(picture && 'assetId' in picture && picture.assetId).not.toBe(OLD_ASSET);
    expect(mocks.deleteRoom).not.toHaveBeenCalled();
  });

  it('keeps a long title within the limit', async () => {
    await duplicateRoom(SOURCE, 'x'.repeat(120), OWNER);
    const title = (mocks.createRoom.mock.calls[0] as [string, string])[1];
    expect(Array.from(title).length).toBeLessThanOrEqual(120);
    expect(title.endsWith(' (copy)')).toBe(true);
  });

  it('copies an empty workspace without a snapshot', async () => {
    mocks.snapshot.bytes = null;
    mocks.listAssets.mockResolvedValue([]);
    await duplicateRoom(SOURCE, 'Empty', OWNER);
    expect(mocks.setInitialSnapshot).not.toHaveBeenCalled();
  });

  it('refuses a workspace with too many files before creating anything', async () => {
    mocks.listAssets.mockResolvedValue(Array.from({ length: DUPLICATE_MAX_ASSETS + 1 }, (_, i) => asset(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)));
    await expect(duplicateRoom(SOURCE, 'Big', OWNER)).rejects.toMatchObject({ status: 413 });
    expect(mocks.createRoom).not.toHaveBeenCalled();
  });

  it('copies nothing and removes the new room when there is no storage left', async () => {
    mocks.reserveAsset.mockResolvedValue(false);
    await expect(duplicateRoom(SOURCE, 'Plan', OWNER)).rejects.toMatchObject({ status: 413, code: 'STORAGE_QUOTA_EXCEEDED' });
    expect(mocks.copyObject).not.toHaveBeenCalled();
    expect(mocks.deleteRoom).toHaveBeenCalledWith(COPY);
  });

  it('removes the new room and the files already copied when a copy fails midway', async () => {
    mocks.copyObject.mockRejectedValueOnce(new Error('r2 down'));
    await expect(duplicateRoom(SOURCE, 'Plan', OWNER)).rejects.toThrow('r2 down');
    expect(mocks.deleteRoom).toHaveBeenCalledWith(COPY);
    expect(mocks.deleteObjects).toHaveBeenCalledTimes(1);
    const keys = (mocks.deleteObjects.mock.calls[0] as [string[]])[0];
    expect(keys.every((key) => key.startsWith(`rooms/${COPY}/`))).toBe(true);
  });

  it('removes the new room when storing the board fails', async () => {
    mocks.setInitialSnapshot.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'x'));
    await expect(duplicateRoom(SOURCE, 'Plan', OWNER)).rejects.toMatchObject({ status: 500 });
    expect(mocks.deleteRoom).toHaveBeenCalledWith(COPY);
  });

  it('never deletes the source room or its files', async () => {
    mocks.copyObject.mockRejectedValueOnce(new Error('boom'));
    await expect(duplicateRoom(SOURCE, 'Plan', OWNER)).rejects.toThrow();
    for (const call of mocks.deleteRoom.mock.calls) expect(call[0]).not.toBe(SOURCE);
    for (const call of mocks.deleteObjects.mock.calls) {
      for (const key of call[0] as string[]) expect(key).not.toContain(SOURCE);
    }
  });
});

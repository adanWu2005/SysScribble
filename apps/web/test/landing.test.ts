import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from '../src/app/page';
import { Landing } from '@/components/landing/Landing';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  listRoomsForUser: vi.fn(),
  listPendingInvitesForEmail: vi.fn(),
  getOwnProfile: vi.fn(),
  sumMediaBytes: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('@/lib/db/rooms', () => ({ listRoomsForUser: mocks.listRoomsForUser }));
vi.mock('@/lib/db/invites', () => ({ listPendingInvitesForEmail: mocks.listPendingInvitesForEmail }));
vi.mock('@/lib/db/profile', () => ({ getOwnProfile: mocks.getOwnProfile }));
vi.mock('@/lib/db/usage', () => ({ sumMediaBytes: mocks.sumMediaBytes }));
vi.mock('@/components/dashboard/DashboardShell', () => ({ DashboardShell: () => null }));

const html = () => renderToStaticMarkup(createElement(Landing));

beforeEach(() => vi.clearAllMocks());

describe('landing page', () => {
  it('carries the brand, the headline and every section', () => {
    const out = html();
    expect(out).toContain('SysScribble');
    expect(out).toContain('Think in prose.');
    expect(out).toContain('Real-Time Notes &amp; Whiteboard Workspace');
    for (const text of ['Dual-pane workspace', 'Conflict-free real-time sync', 'Voice huddles and instant exports']) {
      expect(out).toContain(text);
    }
    for (const text of ['Create a room', 'Invite collaborators', 'Build together, live', '© SysScribble']) {
      expect(out).toContain(text);
    }
  });

  it('links to the sign-in and sign-up forms and to its own features section', () => {
    const out = html();
    expect(out).toContain('href="/login"');
    expect(out).toContain('href="/login?mode=signup"');
    expect(out).toContain('href="#features"');
    expect(out).toContain('id="features"');
  });

  it('is static markup: no scripts, no inline HTML injection, no handlers', () => {
    const out = html();
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/\son[a-z]+=/i);
  });
});

describe('GET / routing', () => {
  it('shows the landing page to a signed-out visitor, without reading any workspace data', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const out = renderToStaticMarkup(await DashboardPage());
    expect(out).toContain('Think in prose.');
    expect(mocks.listRoomsForUser).not.toHaveBeenCalled();
    expect(mocks.listPendingInvitesForEmail).not.toHaveBeenCalled();
  });

  it('shows the dashboard, not the landing page, to a signed-in user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.co' } } });
    mocks.listRoomsForUser.mockResolvedValue([]);
    mocks.listPendingInvitesForEmail.mockResolvedValue([]);
    mocks.getOwnProfile.mockResolvedValue({ displayName: 'Ada' });
    mocks.sumMediaBytes.mockResolvedValue(0);
    const out = renderToStaticMarkup(await DashboardPage());
    expect(out).not.toContain('Think in prose.');
    expect(mocks.listRoomsForUser).toHaveBeenCalledWith('u1');
  });
});

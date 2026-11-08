# Supabase setup

1. Create a project at https://supabase.com. In **Settings → Billing** enable the **Spend Cap**.
2. In **Authentication → Providers** enable Email, and optionally GitHub and Google. Add
   `http://localhost:3000/auth/callback` (and your production URL) to **Redirect URLs**.
3. Apply the migrations in order. Either:
   - `supabase init && supabase link --project-ref <ref> && supabase db push` (uses this folder), or
   - paste each file from `migrations/` into the SQL editor, `0001` → `0006`.
4. Copy **Project URL**, **anon key** and **service_role key** into the env files described in
   the root `.env.example`. If your project still uses the legacy HS256 JWT secret, copy it to
   `SUPABASE_JWT_SECRET`; otherwise leave it blank and the servers verify tokens against the
   project's JWKS endpoint.

The service-role key bypasses RLS. It is used only by `apps/ws-server` and by Next.js route
handlers **after** they have performed their own `requireRoomRole` check. It must never be
shipped to the browser.

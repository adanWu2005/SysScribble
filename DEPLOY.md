# Deploying SysScribble on Railway

Two Railway services from one GitHub repo, plus the external services you already use
(Supabase, Upstash, Cloudflare R2, LiveKit, Resend).

| Service | What it runs | Config file |
|---|---|---|
| `web` | Next.js app and REST API | `railway.web.json` |
| `ws` | Realtime WebSocket server | `railway.ws.json` |

Never paste a secret into a chat, an issue or a commit. Set them only in Railway's Variables tab.

## 0. Before you start

1. **Rotate the secrets that were exposed earlier**: the Upstash token and the Supabase service-role
   (secret) key. Use only the new values below.
2. In the Supabase SQL editor, confirm migrations `0001`–`0007` in `supabase/migrations` are applied
   (especially `0006_snapshot_history.sql` and `0007_pending_invites.sql`).
3. Push this repo to GitHub (see "Git" at the bottom).

## 1. Create the project

1. railway.com → **New Project → Deploy from GitHub repo** → pick this repo. Railway creates one service.
2. Rename it `ws`. Add a second service from the same repo (**+ New → GitHub Repo**) and name it `web`.

## 2. Realtime service (`ws`)

**Settings**
- Config as code → path: `/railway.ws.json`
- Networking → **Generate Domain**. You get `https://<something>.up.railway.app`. Your WebSocket address
  is the same host with `wss://`.

**Variables**
| Name | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | the NEW service-role key |
| `SUPABASE_JWT_SECRET` | leave unset to verify with the project's JWKS (or the legacy secret if you use one) |
| `REDIS_URL` | Upstash TCP address, starts with `rediss://` |
| `ALLOWED_ORIGINS` | your site's exact origin, e.g. `https://app.example.com` (no trailing slash, no path) |
| `LOG_LEVEL` | `info` |

`PORT` is set by Railway. The service refuses to start if a variable is missing or malformed, and the
health check is `/healthz`.

## 3. Web service (`web`)

**Settings**
- Config as code → path: `/railway.web.json`
- Networking → **Generate Domain** (or add your own custom domain).

**Variables** (the `NEXT_PUBLIC_*` ones are baked in at build time, so set them BEFORE the first deploy)
| Name | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (publishable) key |
| `NEXT_PUBLIC_APP_URL` | this service's public origin, e.g. `https://app.example.com` |
| `NEXT_PUBLIC_WS_URL` | `wss://<ws service domain>` |
| `NEXT_PUBLIC_LIVEKIT_URL` | LiveKit project URL (`wss://…livekit.cloud`) |
| `SUPABASE_SERVICE_ROLE_KEY` | the NEW service-role key |
| `SUPABASE_JWT_SECRET` | same as the ws service (or unset) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | the NEW Upstash REST values |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Cloudflare R2 |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit |
| `RESEND_API_KEY`, `RESEND_FROM` | Resend (sender on a verified domain) |

Deploy `ws` first, copy its domain into `NEXT_PUBLIC_WS_URL`, then deploy `web`.
If you change a `NEXT_PUBLIC_*` value later, redeploy `web` so it is rebuilt.

## 4. Update the other services for the live domain

- **Supabase → Authentication → URL Configuration**: Site URL = your site origin; add
  `<site origin>/auth/callback` to Redirect URLs.
- **GitHub OAuth app**: Homepage URL = your site origin. (Callback URL stays Supabase's.)
- **Google OAuth client**: add your site origin under Authorized JavaScript origins.
  If the consent screen is still "Testing", only listed test users can sign in until you publish it.
- **Cloudflare R2 bucket → CORS**: allow your site origin for `PUT`, `GET`, `HEAD` with the headers
  `Content-Type` and `Content-Length`, otherwise browser uploads fail.
- **Resend**: verify the sending domain so invite emails deliver.

## 5. Check it works

1. Open the site signed out: the welcome page loads. Sign up and sign in.
2. Create a workspace from a template; it should open with content.
3. Open the same room in two browsers: edits and cursors sync (this proves `NEXT_PUBLIC_WS_URL` and
   `ALLOWED_ORIGINS`).
4. Upload an image (R2 CORS), invite a second account (Resend), start a huddle (LiveKit).
5. Railway → `ws` → Deploy logs: no `rejected origin` or `invalid environment` warnings.

## Troubleshooting

- **Realtime says "disconnected"**: `NEXT_PUBLIC_WS_URL` must be `wss://` and `ALLOWED_ORIGINS` must match
  the site origin exactly.
- **Social sign-in lands on the wrong page**: Supabase Site URL or Redirect URLs.
- **Build fails on the web service**: a `NEXT_PUBLIC_*` variable is missing.
- **Scaling `ws` beyond one instance** works (Redis Pub/Sub joins them). Keep `web` and `ws` as separate services.

## Git

```
git init -b main
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
`.gitignore` excludes every `.env` file except `.env.example`.

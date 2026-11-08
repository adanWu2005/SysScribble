# Whiteboard

A real-time collaborative workspace: rich-text notes, an infinite canvas, and audio/video huddles,
built on a custom WebSocket server with Yjs instead of a managed sync service.

- [PRD.md](PRD.md) is the product spec.
- [CLAUDE.md](CLAUDE.md) holds the stack, the security rules and the verification commands.

```
apps/web          Next.js frontend and REST API
apps/ws-server    Stateful WebSocket server (Yjs, Redis Pub/Sub, snapshot persistence)
packages/shared   Zod schemas, wire protocol, role matrix, the Yjs room provider
packages/config   Shared TypeScript and ESLint presets
supabase/         SQL migrations
```

## Requirements

Node 22 LTS is recommended. Node 20 works, but Supabase has deprecated it and it is past end of life.

## Setup

1. Install dependencies with `npm install`.
2. Follow [supabase/README.md](supabase/README.md) to create the project and apply the migrations.
3. Create the other services below, then copy `.env.example` into `apps/web/.env.local` and
   `apps/ws-server/.env`, and fill in the values.

| Service | What to set up |
|---|---|
| Upstash Redis | A database, with a Max Monthly Spend Limit. The web app uses the REST URL and token, and the WS server uses the `rediss://` URL. |
| Cloudflare R2 | A private bucket and an API token scoped to it, plus the CORS rule below. |
| LiveKit Cloud | A project. Copy the WebSocket URL, API key and API secret. |
| Resend | A verified sending domain with DKIM and SPF, and an API key. |

R2 CORS rule, required for browser uploads and for images on the canvas:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

## Running

```bash
npm run dev:ws    # WebSocket server on port 4001
npm run dev:web   # Next.js on port 3000
```

To run a second instance, start `npm run dev:ws -w apps/ws-server -- --port 4002` and point some
clients at it with `NEXT_PUBLIC_WS_URL`.

## Verifying

```bash
npm run typecheck
npm run lint
npm test              # unit, integration, and migrations on real Postgres (PGlite)
npm run test:chaos    # the four PRD chaos tests, needs redis-server on PATH or TEST_REDIS_URL
npm run audit:bundle  # production build, then scan the client bundle for secrets
```

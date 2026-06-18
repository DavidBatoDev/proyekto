# realtime/ — Cloudflare Worker + Durable Objects

Realtime transport for Proyekto's **collaborative** features (roadmap canvas +
chat), replacing Supabase Realtime for those paths. Notifications and the
dashboard projects grid stay on Supabase Realtime (they are trigger-driven).

## How it works

- **One Durable Object per room.** Room keys (`ROOMS.idFromName(key)`):
  - `roadmap:{roadmapId}` — presence, cursors, `data_changed`.
  - `chatroom:{roomId}` — typing broadcast.
  - `user:{userId}` — per-user inbox fan-in (chat message/reaction/read invalidation).
- **The Worker is the gatekeeper.** On `GET /ws?room=<key>&token=<jwt>` it
  verifies the Supabase JWT (HS256, same secret as the backend guard) and — for
  non-`user` rooms — calls the backend `POST /api/realtime/authorize` to confirm
  access, then hands the socket to the DO.
- **Backend fan-out** posts to `POST /publish` (auth: `x-realtime-token`) with
  `{ room, event, payload }`; the Worker forwards it to the room's DO, which
  broadcasts to every connected socket.
- Uses the **WebSocket Hibernation API**, so idle rooms cost nothing.

## Develop

```bash
cd realtime
npm install
cp .dev.vars.example .dev.vars   # fill in SUPABASE_JWT_SECRET + REALTIME_PUBLISH_TOKEN
npm run dev                      # wrangler dev (default http://localhost:8787)
npm run typecheck
npm test
```

## Deploy

```bash
wrangler secret put SUPABASE_JWT_SECRET
wrangler secret put REALTIME_PUBLISH_TOKEN
npm run deploy
```

Set `BACKEND_AUTHORIZE_URL` and `ALLOWED_ORIGINS` per environment in
`wrangler.toml` (or the dashboard). Durable Objects require a Workers plan that
includes them; SQLite-backed DOs (used here) are available on the free plan.

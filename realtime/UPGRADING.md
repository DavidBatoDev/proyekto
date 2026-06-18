# Upgrading the realtime Worker: Free → Workers Paid

This Worker runs on the **Cloudflare Workers Free plan at $0** today. It uses
**SQLite-backed Durable Objects** (`new_sqlite_classes` in `wrangler.toml`),
which are available on the Free plan — so no paid subscription is needed to run
it. This doc explains when and how to move to **Workers Paid ($5/mo)**, and what
changes when you do.

> Exact free-tier limits and prices change over time. The numbers below are
> approximate and "as of writing" — always confirm against Cloudflare's pricing
> pages before relying on them:
> - https://developers.cloudflare.com/workers/platform/pricing/
> - https://developers.cloudflare.com/durable-objects/platform/pricing/

## Free plan capabilities (what you get at $0)

All Free limits are **per-day, reset at 00:00 UTC**, and are **hard caps with no
overage** — exceed one and further requests are throttled/rejected until reset.

### Workers (the `realtime` Worker — the gatekeeper)

| Limit | Free allocation (approx.) | What consumes it here |
|---|---|---|
| Requests | **100,000 / day** | One per `GET /ws` connection + one per backend `POST /publish`. WebSocket *messages* after connect do **not** re-invoke the Worker, so they don't count here. |
| CPU time | **10 ms / request** | The Worker only verifies a JWT + forwards — well under 10 ms. |
| Subrequests | **50 / request** | We make 1 (the backend `/authorize` call). |

### Durable Objects (SQLite-backed — the rooms)

| Limit | Free allocation (approx.) | What consumes it here |
|---|---|---|
| Requests | **100,000 / day** | **Each incoming WebSocket message = 1 request** (cursor moves ≤10/s per mover, node-drags ~40/s while dragging, typing, and each chat fan-out to a recipient inbox). Outgoing fan-out is **not** counted. This is the limit you'll hit first. |
| Duration | **~13,000 GB-s / day** | Wall-clock time a room is *active* × 128 MB. Idle/hibernating sockets cost nothing; cursor streaming keeps a room active. |
| SQLite storage | **5 GB total** | **~0** — this Worker stores no rows (in-memory + hibernation only). |
| SQLite rows read / written | **5M / 100k per day** | **~0** — same reason. |

There is no separate hard cap on *concurrent WebSocket connections*; you're
effectively bounded by the daily **requests** and **duration** allocations above.

### What that buys you in practice

Translating the two binding limits (with the client-side presence gating on, so
solo roadmap usage sends **nothing**):

- **DO requests — 100k/day.** Cursors at ~10/s ≈ 600/min per actively-moving
  user. So ~**165 user-minutes/day of active cursor movement in a shared room**
  (≈ 80 min/day of two people moving at once), *plus* chat: each message costs
  ~1 request per recipient inbox, so a few hundred chat messages/day to small
  rooms is only low-thousands of requests. Connections add ~1 each.
- **DO duration — ~13k GB-s/day.** At 128 MB per active room that's roughly
  **~29 room-active-hours/day** before the cap — generous, since rooms hibernate
  the moment nobody's streaming.
- **Worker requests — 100k/day.** Connections + backend publishes. Even
  thousands of tab-opens and tens of thousands of writes/day stay well under.

**Bottom line:** Free comfortably covers **dev, staging, a canary, and
small-team / early-stage production**. You'll bump the **DO requests** cap first
— under sustained simultaneous multi-user cursor movement or heavy chat — and
that's the trigger to upgrade.

## Free vs Paid — the one difference that matters

| | Free ($0) | Workers Paid ($5/mo) |
|---|---|---|
| SQLite Durable Objects | ✅ included | ✅ included |
| Limits | **Daily caps** (Worker requests, DO requests, DO duration) | Much higher monthly included amounts |
| Over the limit | **Throttled / rejected until the daily reset** (realtime can stop mid-day) | **Billed as overage** (keeps working) |
| Cost | $0 | $5 base + usage |

The functional code is identical on both. The real reason to upgrade is to stop
hitting a **hard daily ceiling** — on Free, once you exhaust the day's
allotment, new connections/messages fail until midnight UTC, which for a
realtime feature means collaboration silently stops for users during peak hours.

## When to upgrade — the signals

Upgrade when you see any of these in the **Cloudflare dashboard → Workers & Pages
→ your Worker → Metrics** (or via `wrangler tail`):

- **Requests being throttled / `1015`-type rate-limit errors**, or a daily
  metric flat-lining at a ceiling and resetting at 00:00 UTC.
- Daily **Worker requests** approaching the free ceiling — driven mainly by
  WebSocket connects (one per roadmap/chat tab) and backend `/publish` calls.
- Daily **Durable Object requests** approaching the ceiling — driven by
  co-presence cursor/drag messages and chat fan-out (one incoming WS message =
  one DO request).
- Users reporting cursors/live-drag/chat updates "stop working later in the day."

Rough rule of thumb (see the cost estimate in the project notes): **early-stage
/ small-team usage fits comfortably on Free**; once you have steady simultaneous
multi-user editing or busier chat, you'll bump the daily caps and want Paid.

## How to upgrade (≈2 minutes, no redeploy)

Upgrading is an **account-level billing change** — you do **not** touch code,
`wrangler.toml`, secrets, the Worker URL, or redeploy anything.

1. Cloudflare dashboard → **Workers & Pages** → **Plans** (or **Manage account →
   Billing → Subscriptions**).
2. Subscribe to **Workers Paid** ($5/mo).
3. Done. The already-deployed Worker and its Durable Objects immediately get the
   higher limits and overage billing. No `wrangler deploy` needed.

Nothing in this repo changes:
- `wrangler.toml` stays the same (SQLite DOs work on both plans).
- `SUPABASE_JWT_SECRET`, `REALTIME_PUBLISH_TOKEN`, `SUPABASE_URL`,
  `BACKEND_AUTHORIZE_URL`, `ALLOWED_ORIGINS` — unchanged.
- The backend (`REALTIME_WORKER_URL`) and web (`VITE_REALTIME_URL`) — unchanged.

## What it costs after upgrading

$5/mo base, which includes generous monthly allotments; you only pay overage
beyond them (verify current figures):

- **Worker requests:** ~10M included, then ~$0.30 / million.
- **Durable Object requests:** ~1M included, then ~$0.15 / million (1 incoming
  WebSocket message = 1 request; outgoing fan-out is **not** request-billed).
- **Durable Object duration:** ~400,000 GB-s included, then ~$12.50 / million
  GB-s (billed only while a DO is active; idle hibernating sockets are free).
- **SQLite storage:** ~$0 — this Worker stores no rows (in-memory + hibernation
  only).

At low-to-moderate volume with the client-side presence gating in place (cursors
/ drags don't broadcast into an empty room), expect roughly **$5 + a few dollars
of usage**. See the cost-scenario notes for ballpark figures at larger scale.

## Keep an eye on cost (optional but recommended)

- Watch **Metrics → Durable Objects** for monthly **requests** and **GB-s
  duration**; multiply by the rates above to project the bill.
- Set a **billing/usage notification** (dashboard → Notifications) so you're
  alerted before a surprise.

## Downgrading back to Free

You can switch back to the Free plan the same way (Plans → downgrade). The Worker
keeps running, but you're subject to the daily caps again — fine for a quiet
period or if you migrate realtime elsewhere.

## Reminder: instant rollback is separate from billing

Independent of plan, you can always disable the DO transport entirely by unsetting
`VITE_REALTIME_URL` in the web build (clients fall back to Supabase Realtime).
Plan changes affect *limits/cost*; the env flag affects *whether the feature is
used at all*.

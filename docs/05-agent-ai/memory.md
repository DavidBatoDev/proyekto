# Memory

> **Last updated:** 2026-07-09 · **Status:** current

The agent has three layers of memory, each with a different lifetime: **fast session
state** in Redis (this conversation), a **durable snapshot** in Postgres (survives
Redis TTL), and **per-roadmap memories** shared across collaborators. A summarizer
keeps long threads from blowing the context window.

> Nothing important is lost when Redis expires: the memory-class state is snapshotted
> into `roadmap_ai_sessions.metadata.agent_state` and restored on the next turn.

## 1. Session state (Redis)

Upstash Redis holds one JSON document per session under
`roadmap:ai:session:{session_id}`, with a `:v` version key for **atomic
compare-and-set** writes ([`session_store.py`](../../agent/app/core/session_store.py)).
TTL is `SESSION_TTL_SECONDS` (default 14400 = 4h), refreshed on every read. The
document carries:

- **Pending plan** — a `propose_plan` awaiting confirmation.
- **Undo / revert log** — `change_history`, `recent_applied_changes`,
  `applied_change_ids` (what to invert on `revert_changes`).
- **Recents** — recently resolved node targets (so follow-ups don't re-resolve).
- **Conversation summary** — the compacted older history (below).
- Plus short-lived caches (roadmap overview, handle map, actor, memory notes) and the
  staged `operations`.

## 2. Durable snapshot (Postgres)

Because Redis expires, after any turn that changed memory-class state a snapshot is
pushed **fire-and-forget** to the backend at
`roadmap_ai_sessions.metadata.agent_state`
([`agent_state_snapshot.py`](../../agent/app/api/routes/sessions_support/agent_state_snapshot.py)).
Only the memory fields are included (pending plan, resolutions, change log, summary) —
caches are excluded and refetched next turn. There's a ~32 KB soft cap with ordered
trimming (the pending plan is dropped last). On rehydration the web replays this into
the new session's metadata, so a resumed conversation keeps its plan, undo log, and
summary.

## 3. Conversation summarizer

Long threads are compacted with a **two-phase, single-writer** design
([`summarizer.py`](../../agent/app/core/v2/summarizer.py)) so summarization never races
the request path:

- **Compute (post-turn, background, side key):** when message count passes
  `AGENT_SUMMARY_TRIGGER_MESSAGES` (default 40), a background job folds everything
  beyond `AGENT_SUMMARY_KEEP_MESSAGES` (default 30), summarizes on
  `AGENT_SUMMARY_MODEL` (default `gpt-4o-mini`, capped at `AGENT_SUMMARY_MAX_CHARS` =
  4000), and writes a *candidate* to a side Redis key — never the session doc.
- **Apply (turn start, request path):** the next turn validates the candidate against
  the current messages via first/last SHA-256 fingerprints; on a match it folds the
  summary into `metadata.conversation_summary`, bumps the fold count, and truncates
  the folded messages. The summary then rides the durable snapshot and is injected
  into context as "# Earlier conversation summary".

## 4. Durable per-roadmap memories

Long-lived preferences that outlive any session and are **shared across
collaborators** live in the `roadmap_ai_memories` table. They're injected into the
system prompt as **"# Memory notes (durable preferences for this roadmap)"** with a
`memory_id` and `source` per note.

- **Managed from chat** — the model calls `save_memory` (persist one preference,
  `source = user_request | inferred`) or `forget_memory` (deactivate by id). These run
  mid-loop through the backend AI-memory endpoints; on success the brain invalidates
  its cached notes so the next turn refetches.
- **Fetched via the backend** — the agent reads them through
  `nest_client.ai_memories_list` (short TTL cache), never touching the DB directly.

## Where each layer lives

| Layer | Store | Lifetime | Scope |
| --- | --- | --- | --- |
| Session state | Upstash Redis | `SESSION_TTL_SECONDS` (4h), snapshotted | One conversation |
| Durable snapshot | Postgres `metadata.agent_state` | Persistent | One conversation (survives TTL) |
| Conversation summary | Redis + snapshot | Persistent | One conversation |
| Roadmap memories | Postgres `roadmap_ai_memories` | Persistent | All collaborators on the roadmap |

## See also

- [v2-loop.md](./v2-loop.md) — how the loop reads and writes this state.
- [setup-and-deploy.md](./setup-and-deploy.md#configuration) — the summarizer/TTL tunables.

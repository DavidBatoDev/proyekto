# Memory

> **Last updated:** 2026-09-05 · **Status:** current

The agent keeps state in four layers with different lifetimes: the **session
document** in Redis (this conversation, including the active run), the **trace
store** in Redis (progress events any instance can serve), a **durable snapshot** in
Postgres (memory-class state that survives Redis TTL), and **per-roadmap memories**
shared across collaborators. A summarizer keeps long threads from blowing the context
window.

> Nothing important is lost when Redis expires: at every checkpoint or terminal the
> memory-class state (pending plan, undo log, recents, summary, the run) is
> snapshotted into `roadmap_ai_sessions.metadata.agent_state` and replayed on the
> next session create.

## 1. Session document (Redis)

[`session_store.py`](../../agent/app/core/session_store.py) keeps one JSON document per
session in Upstash Redis with TTL `SESSION_TTL_SECONDS` (default 14400 = 4h),
refreshed on every read. Keys hang off `REDIS_SESSION_KEY_PREFIX`
(`roadmap:ai:session`) so an operator finds everything a session owns under one
prefix:

| Key | Type | Purpose |
| --- | --- | --- |
| `roadmap:ai:session:{session_id}` | string (JSON) | The `AgentSession` document |
| `...:{session_id}:v` | string | Storage version for `save_cas` compare-and-set writes (the request path under the run lock uses a blind `update`) |
| `...:{session_id}:summary_candidate` | string (JSON) | The summarizer's side-key candidate (below) |
| `...:{session_id}:run_lock` | string | Per-session run lock: `SET NX EX` with a random token, TTL `AGENT_RUN_LOCK_TTL_SECONDS` (300s), released by compare-and-delete |
| `...:{session_id}:run:{run_id}:transcript` | JSON list | A paused investigate loop's echoed transcript, TTL `AGENT_RUN_TRANSCRIPT_TTL_SECONDS` (900s) |
| `...:{session_id}:run:{run_id}:cancel` | flag | Set by `POST .../cancel`; the running step polls it between turns, phases and batches |

The `AgentSession` document ([`contracts/sessions.py`](../../agent/app/core/contracts/sessions.py)):

| Field | Meaning |
| --- | --- |
| `session_id` | Equals the `roadmap_ai_sessions.id` row when the web supplied it on create |
| `scope` | `{kind:"roadmap", roadmap_id}` or `{kind:"workspace", workspace_id}`; a pre-scope document with only `roadmap_id` is upgraded on load |
| `roadmap_id` | Legacy mirror of `scope.roadmap_id` (None in workspace scope), never authoritative |
| `owner_key` | Who created it: the actor id, or `Guest <id>`. Messages, continue, cancel and trace reads from anyone else are 404 |
| `base_revision`, `revision_token` | Legacy focus-roadmap anchors; per-roadmap tokens live in `metadata.roadmaps[rid]` |
| `staged_operations_version`, `version` | Response-compat counter bumped per staged batch; the storage optimistic-lock version |
| `messages[]` | The conversation (`role`, `content`, `tool_calls`, `tool_call_id`); the user and assistant turns of a run land together at **segment end** |
| `metadata` | `SessionMetadata` (below) |

`SessionMetadata`:

| Field | Class | Meaning |
| --- | --- | --- |
| `roadmaps{}` | cache | Per-roadmap `RoadmapContext` keyed by roadmap id: `title`, `project_id`, `workspace_id`, `handle_prefix` (None = focus), `overview_summary`, `handle_map`, `revision_token`, `base_revision`, `memory_notes`, `project_context`, `role`, `last_used_at`. LRU capped at `AGENT_MAX_LOADED_ROADMAPS` (6); the scope focus and the run's focus set are never evicted |
| `next_handle_prefix_index` | cache | Next `R{n}` prefix to hand out (monotonic, never reused) |
| `workspace_context` (+`_fetched_at`) | cache | Workspace-scope overview from `GET /api/ai/context/overview`, TTL `AGENT_CACHE_TTL_SECONDS` (600s) |
| `actor_context` | cache | `actor_id`, `display_name`, `roadmap_role` (None in workspace scope), fetched once per session as the user |
| `run` | memory | The active `RunState` (None between runs) - see below |
| `run_history[]` | memory | The last 5 finished runs as `RunSummary` (`run_id`, `status`, `phase`, `trace_ids`, `committed_roadmap_ids`, `error_code`, timestamps) |
| `pending_plan` | memory | A proposal awaiting confirmation: `kind = plan` (titles per `targets[]`) or `edits` (concrete operations per target); each target has `roadmap_id`, `committed`, and its own staleness anchors |
| `recent_resolved_targets[]` | memory | Recently resolved nodes (with `roadmap_id`) so follow-ups and deictic references do not re-resolve; 20 entries, 24h |
| `change_history[]`, `recent_applied_changes[]`, `applied_change_ids[]` | memory | The undo log: one `ChangeGroup` per commit (with `roadmap_id` and `run_id`) that `revert_changes` inverts deterministically |
| `conversation_summary`, `conversation_summary_folded_count` | memory | The compacted older history (below) |

### Run state

`RunState` ([`contracts/runs.py`](../../agent/app/core/contracts/runs.py)) is the part of
the document the run machine mutates; it also rides the snapshot.

| Field | Meaning |
| --- | --- |
| `run_id` (UUIDv4), `status`, `phase`, `next`, `checkpoint` | The state-machine position: `running \| awaiting_user \| done \| failed \| cancelled`; `investigate \| propose \| execute \| verify`; `continue \| await_user \| done`; `clarifier \| proposal \| null` |
| `trace_id`, `segments[]` | The current segment's trace and every segment (`trace_id`, `started_at`, `ended_at`, `from_phase`, `ended_with`) |
| `step` | HTTP requests served for this run; capped by `AGENT_RUN_MAX_STEPS` (8) |
| `scope`, `focus_roadmap_ids[]` | The session scope and the roadmaps this run works on (scope focus + referenced + loaded by tools); never evicted mid-run |
| `user_message`, `raw_user_message` | The folded text handed to the model (sentinels resolved) and the raw body |
| `refs[]`, `resolved_refs[]` | The composer refs and their once-per-run hydration |
| `clarifier`, `asked_in_phase`, `plan_id` | The checkpoint payloads: the clarifier card, where to resume after an answer, the pending plan id |
| `batches[]` | `RunBatch`: `batch_id`, `roadmap_id`, `roadmap_title`, `operations[]`, `operations_hash`, `assistant_message`, `source` (`stage_edits \| proposal \| revert`), `contains_delete`, `needs_materialize`, `materialize_transcript_key` |
| `commits[]` | `RunCommit`: `batch_id`, `roadmap_id`, `idempotency_key`, `operations_hash`, `status` (`pending \| committed \| failed \| skipped`), `attempts`, `change_id`, `revision_token_after`, `semantic_diff_summary`, `impacted_summary`, `impacted_items[]`, `error_code`, `error_message`, `history_recorded` (the operations themselves stay on the batch so the document does not double) |
| `execute_cursor`, `loop_transcript_key`, `batches_truncated` | The next batch to run; the side key of a paused investigate; set when the snapshot ladder dropped batch operations (the run can report but not resume execute: `RUN_STATE_LOST`) |
| `phase_usage{}`, `tokens{}`, `reasoning_effort{}` | Per-phase turns/tool calls, summed input/output/total/cached tokens, effort per phase |
| `verify`, `error`, `final_message`, `cancel_requested` | The `VerifyReport` (`status`, `checks[]`, `summary`, `follow_up_plan_id`), the failure `{code, message}`, the closing text, the cancel flag |

## 2. Trace store (Redis)

Cloud Run runs several agent instances with no session affinity, so the web's trace
poll can land on an instance that never saw the trace. Progress events therefore live
in Redis ([`trace/store.py`](../../agent/app/core/trace/store.py)), under
`REDIS_TRACE_KEY_PREFIX` (`roadmap:ai:trace`):

| Key | Type | Contents |
| --- | --- | --- |
| `roadmap:ai:trace:{trace_id}` | hash | `session_id`, `roadmap_id`, `user_id`, `owner_key`, `run_id`, `phase`, `started_at`, `completed_at`, `done`, `head_seq`, `run_next` |
| `roadmap:ai:trace:{trace_id}:events` | list | JSON events, `RPUSH` + `LTRIM` to the last 250 |

Both keys are re-`EXPIRE`d to `AGENT_TRACE_TTL_SECONDS` (900s) on every flush, so an
active trace never ages out mid-step. `capture()` never does network I/O on the
calling thread: events go to a per-process active buffer and are flushed in one
Upstash pipeline every `AGENT_TRACE_FLUSH_EVERY_EVENTS` (5) events or
`AGENT_TRACE_FLUSH_INTERVAL_SECONDS` (0.5s), and unconditionally in `step()`'s
`finally`. Reads serve memory while this process holds the trace active and the
cursor is inside the buffered range; otherwise `HGETALL` + `LLEN` + `LRANGE` with
`first_seq = head_seq - llen`. A trace whose `session_id` or `owner_key` does not match
the caller reads as missing (404). `done` flips when a `run_step_completed` event
carries `run_next != "continue"`. Without Upstash (tests, local runs) an in-memory
backend provides the same semantics.

## 3. Durable snapshot (Postgres)

Because Redis expires, [`runtime/snapshot.py`](../../agent/app/core/runtime/snapshot.py)
pushes the **memory-class** fields (`pending_plan`, `recent_resolved_targets`,
`recent_applied_changes`, `change_history`, `applied_change_ids`,
`conversation_summary` + count, `run`, `run_history`) fire-and-forget to the
backend, by scope: `PUT /api/roadmaps/:id/ai-sessions/:sid/agent-state` or
`PUT /api/workspaces/:id/ai-sessions/:sid/agent-state`, into
`roadmap_ai_sessions.metadata.agent_state`. Caches (`roadmaps{}`,
`workspace_context`, `actor_context`) are excluded and refetched next turn.

- **Snapshot version 2** (`snapshot_version: 2`; v1 snapshots load unchanged).
- **Checkpoint-only push.** The flow pushes only when the step ended a segment
  (a checkpoint or a terminal) **and** the snapshot fingerprint changed. The
  fingerprint ignores `saved_at` and the run's volatile fields (`updated_at`, `step`,
  `tokens`, `phase_usage`), so a plain `continue` never pushes.
- **Size ladder.** Soft cap 32 KB (the backend enforces a 64 KB hard limit). When
  over: `recent_applied_changes` -> 5; `change_history` -> 5, 2, 1 groups;
  `recent_resolved_targets` -> last 10; then the run ladder: `run_history` -> 3 -> 0,
  drop `run.commits[*].impacted_items`, drop `run.batches[*].operations` and set
  `batches_truncated = true` (a rehydrated mid-execute run reports honestly with
  `RUN_STATE_LOST`), drop `run` entirely when it is terminal; `pending_plan` is
  dropped **last**. Still over the cap -> the push is skipped and logged.
- **Rehydration.** On a cold thread load or a `SESSION_NOT_FOUND`, the web reads the
  agent state and replays it into `POST /agent/sessions` `metadata` (with the last
  message turns as `seed_messages`). Actor-context keys are stripped from that
  payload - the actor is always fetched from the backend as the user, never trusted
  from the client.

## 4. Conversation summarizer

Long threads are compacted with a **two-phase, single-writer** design
([`runtime/summarizer.py`](../../agent/app/core/runtime/summarizer.py)) so summarization
never races the request path:

- **Compute (post-step, background, side key):** when message count passes
  `AGENT_SUMMARY_TRIGGER_MESSAGES` (40), a background task folds everything beyond
  `AGENT_SUMMARY_KEEP_MESSAGES` (30), summarizes on `AGENT_SUMMARY_MODEL`
  (`gpt-4o-mini`, capped at `AGENT_SUMMARY_MAX_CHARS` = 4000), and writes a
  *candidate* to `...:{session_id}:summary_candidate` - never the session document.
- **Apply (step start, request path, under the run lock):** the next step validates
  the candidate against the current messages via first/last SHA-256 fingerprints; on
  a match it folds the summary into `metadata.conversation_summary`, bumps the fold
  count, and truncates the folded messages. The summary rides the durable snapshot and
  is injected as `# Earlier conversation summary`.

## 5. Durable per-roadmap memories

Long-lived preferences that outlive any session and are **shared across
collaborators** live in the `roadmap_ai_memories` table - always per roadmap (there
are no workspace-tier memories yet). They are injected into the stable prompt prefix
as `# Memory notes`, grouped per loaded roadmap, with a `memory_id` and `source`
per note; `Project-wide:` notes apply to every roadmap in the project.

- **Managed from chat** - the model calls `save_memory` (one preference,
  `source = user_request | inferred`, optional `scope: "project"` and `category`) or
  `forget_memory` (deactivate by id). In workspace scope, or with several roadmaps
  loaded, `roadmap_id` is required. These run mid-loop through the backend AI-memory
  endpoints; on success the cached notes are invalidated so the next turn refetches.
- **Fetched via the backend** - `nest_client.ai_memories_list`, cached on the
  roadmap context for `AGENT_CACHE_TTL_SECONDS`; the agent never touches the DB.
- **Semantic mode** - above `AGENT_MEMORY_SEMANTIC_THRESHOLD` (15) cached notes, the
  inject-all block is replaced by a per-turn top-8 retrieval keyed on the user
  message (`ai_memories_relevant`), rendered as the tail block `# Relevant memories`
  so the cached prefix stays byte-stable.

## Where each layer lives

| Layer | Store | Lifetime | Scope |
| --- | --- | --- | --- |
| Session document (incl. the run) | Upstash Redis `roadmap:ai:session:*` | `SESSION_TTL_SECONDS` (4h), snapshotted | One conversation |
| Run lock, transcripts, cancel flag | Upstash Redis side keys | 300s / 900s / 900s | One run |
| Trace events | Upstash Redis `roadmap:ai:trace:*` | `AGENT_TRACE_TTL_SECONDS` (15 min after the last flush) | One segment |
| Durable snapshot | Postgres `roadmap_ai_sessions.metadata.agent_state` | Persistent | One conversation (survives TTL) |
| Conversation summary | Redis + snapshot | Persistent | One conversation |
| Roadmap memories | Postgres `roadmap_ai_memories` | Persistent | All collaborators on the roadmap |

## See also

- [runs-and-phases.md](./runs-and-phases.md) - how the run machine reads and writes this state.
- [setup-and-deploy.md](./setup-and-deploy.md#configuration) - the TTL, lock, trace and summarizer tunables.

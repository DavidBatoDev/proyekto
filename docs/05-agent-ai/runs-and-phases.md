# Runs & Phases

> **Last updated:** 2026-09-05 · **Status:** current

Every user message to the Proyekto agent is a **run**: a server-side state machine the
Python agent owns, persisted in the Redis session and the durable snapshot, that moves
through **investigate -> propose -> execute -> verify**. The phases that need a model
all reuse one loop engine ([`agent/app/core/engine/loop.py`](../../agent/app/core/engine/loop.py))
with a phase-specific tool catalog and prompt tail; transitions are driven by the
terminal tool the model calls, never by an intent classifier. Edits to the session's
focus roadmap still land in one request exactly as before; anything wider (another
roadmap, several roadmaps, a large or deleting workspace-scope edit) becomes a
proposal the user confirms, then executes with one commit per roadmap and a verify
report. There is no feature flag: the run machine is always on.

> One HTTP request is one **step** of a run. `POST /messages` starts it; the web
> calls `POST /runs/{run_id}/continue` while `run.next == "continue"`. Any agent
> instance can continue any run (Cloud Run has no session affinity), because run
> state and trace events both live in Upstash Redis.

## The run at a glance

```
 POST /agent/sessions/{id}/messages   {message, refs[], capabilities:["continue"]}
        |
        v
 +----------------+   stage_edits   +--------+  policy: execute   +---------+   +--------+
 |  investigate   |---------------->| policy |------------------->| execute |-->| verify |--> done
 | (loop engine)  |                 +--------+                    +---------+   +--------+
 |  read tools,   |                     | policy: propose             ^  one commit      |
 |  one terminal  |   propose /         v                             |  per roadmap     | follow-up
 +----------------+   revise ------>+---------+  awaiting_user        |                  v
        | ask_user                  | propose |----------------> [user confirms] -----> awaiting_user
        v                           +---------+   (proposal)                            (proposal)
   awaiting_user                         ^
   (clarifier) --[answer]--> resumes     |  verify may attach a follow-up proposal
        | revert_changes                 |
        +------> execute (no policy gate)
```

Each step returns `run: {run_id, trace_id, status, phase, next, checkpoint, ...}`.
`next` is `continue` (call continue), `await_user` (a clarifier or proposal is on
screen) or `done` (terminal: `done | failed | cancelled`).

## Scope, focus roadmap and handles

A session has a **scope** ([`contracts/runs.py`](../../agent/app/core/contracts/runs.py)
`SessionScope`): `{kind:"roadmap", roadmap_id}` or `{kind:"workspace", workspace_id}`.

| Scope | Focus roadmap | Handles | What the agent may touch |
| --- | --- | --- | --- |
| `roadmap` | The scope roadmap (bare `E1` / `E1.F2` / `M1` handles) | Other loaded roadmaps get `R{n}.` prefixes | Anything the user can access; read tools default `roadmap_id` to the focus |
| `workspace` | None - every loaded roadmap is prefixed | `R2.E1`, `R3.M1`, ... | Anything the user can access, including items shared from outside the workspace; `roadmap_id` is required on roadmap reads |

- The `R{n}` index (`metadata.next_handle_prefix_index`) is monotonic per session and
  never reused, so the merged handle map across loaded roadmaps is collision-free
  ([`runtime/handles.py`](../../agent/app/core/runtime/handles.py)). The registry
  expands handles to uuids at parse time; `validate_batch_roadmap` rejects a batch
  whose node belongs to another loaded roadmap with `HANDLE_ROADMAP_MISMATCH`.
- `scope.key` (`roadmap:{id}` / `workspace:{id}`) is the prompt-cache key for
  investigate and verify; materialize and repair loops use `roadmap:{rid}` for the
  roadmap they are pinned to ([`runtime/scope.py`](../../agent/app/core/runtime/scope.py)).
- Loaded roadmaps live in `metadata.roadmaps` (an LRU capped at
  `AGENT_MAX_LOADED_ROADMAPS`, default 6, that never evicts the scope focus or the
  run's `focus_roadmap_ids`).

## Endpoints

All five routes live in [`agent/app/api/routes/sessions.py`](../../agent/app/api/routes/sessions.py)
under `/agent/sessions`. Auth is the forwarded Supabase bearer or `X-Guest-User-Id`;
the agent authorizes nothing itself - every backend call is made as the user - but
it does enforce session **ownership**: the creator's `owner_key` (actor id, or
`Guest <id>`) is stored on the session and every later call from another caller is
a 404.

| Route | Body / notes | Returns |
| --- | --- | --- |
| `POST /agent/sessions` | `{session_id?, scope? \| roadmap_id? (legacy), base_revision?, revision_token?, metadata?, seed_messages?}`. Auth **required** (401 `AUTH_REQUIRED`). Roadmap scope calls `GET /roadmaps/:id/ai/context/actor`; workspace scope calls `GET /workspaces/:id`; a 403/404 from either is 404 `SESSION_SCOPE_NOT_FOUND`. An existing `session_id` is a no-clobber no-op. | `{session_id, scope, roadmap_id (mirror), base_revision, revision_token, created_at}` |
| `POST /agent/sessions/{id}/messages` | `{message, refs?: [{kind,id,label?}] (<=20), capabilities?: ["continue"]}`. `X-Trace-Id` names the new segment's trace. Absent `continue` = legacy sync mode. | `MessageResponse` |
| `POST /agent/sessions/{id}/runs/{run_id}/continue` | No body. Ignores `X-Trace-Id` and reuses `run.trace_id`. | `MessageResponse` |
| `POST /agent/sessions/{id}/runs/{run_id}/cancel` | Sets the cancel side key; finalizes synchronously when no step holds the lock, otherwise the running step observes it between turns, phases and batches. | `{run: RunView}` |
| `GET /agent/sessions/{id}/traces/{trace_id}/events` | `after_seq`, `limit` (1-200), `detail=verbose\|structured`. Redis-backed, owner-checked. | `{trace_id, session_id, roadmap_id, run_id, phase, events[], next_seq, done, started_at, completed_at, elapsed_ms}` |

`MessageResponse` is a strict superset of the pre-run shape
([`contracts/sessions.py`](../../agent/app/core/contracts/sessions.py)): the legacy
fields (`assistant_message`, `parse_mode`, `intent_type`, `response_mode`,
`operations` = ops committed to the **focus** roadmap this step,
`staged_operations_version`, `staged_operations_count`, `plan_proposal`, `clarifier`,
`provider_used`, `fallback_used`, `provider_error_code`, `debug_trace_id`,
`commit_summary` = the focus roadmap's commit this step) plus:

- `commits: RunCommitView[]` - cumulative for the run; `operations` is attached **only**
  on commits made in this step.
- `run: RunView` - `{run_id, trace_id, status, phase, next, checkpoint, step, scope,
  focus_roadmap_ids, refs: ResolvedRef[], batches[], commits[] (never with
  operations), verify, error, created_at, updated_at}`.
- `parse_mode` gains `run_step` (the step ended with `next: "continue"`, no assistant
  text yet) and `run_report` (the verify report closed the run).

## The state machine

`RunState` ([`contracts/runs.py`](../../agent/app/core/contracts/runs.py)) carries
`status: running | awaiting_user | done | failed | cancelled`,
`phase: investigate | propose | execute | verify`, `next: continue | await_user | done`,
`checkpoint: clarifier | proposal | null`, `step` (HTTP requests served, capped by
`AGENT_RUN_MAX_STEPS`), one **segment** per trace (a user send or a checkpoint answer
mints a trace; continues reuse it), `batches[]`, `commits[]`, `execute_cursor`,
`verify` and `error`. The full field list is in [memory.md](./memory.md#run-state).

### Input table (`orchestrator.start_or_resume_from_input`)

| Input | Existing run | Result |
| --- | --- | --- |
| Plain message | none / terminal | New run in `investigate` (a `run_started` event) |
| Plain message | `awaiting_user` | Existing run `cancelled` (`superseded_by_new_message`) and archived; new run. The pending plan is **kept** |
| Plain message | `running` in investigate/propose (a crashed request) | Existing run `failed` (`RUN_ABANDONED`); new run |
| Plain message | `running` in execute with pending commits | **409 `RUN_IN_PROGRESS`** with `run.next = "continue"` - the client must finish that run first |
| `__clarifier_answer__` | awaiting a clarifier | Same run resumes in `asked_in_phase` on a new segment/trace |
| `__plan_answers__` | awaiting | Same run resumes in `investigate` on a new segment |
| `__plan_decision__` confirm | awaiting a proposal (matching `plan_id`) | Same run resumes in `execute`; batches are rebuilt from `pending_plan.targets`, skipping targets already committed |
| `__plan_decision__` confirm | no matching run | New run started directly in `execute` |
| `__plan_decision__` confirm | no pending plan | Run is `done` immediately ("There is no proposal awaiting confirmation."), no model call |
| `__plan_decision__` reject | any | Pending plan discarded; run `cancelled` (`user_rejected`), no model call |
| `continue` | `running` and `next == "continue"` | The phase resumes |
| `continue` | `run_id` is not the session's run | 404 `RUN_NOT_FOUND` |
| `continue` | any other status | 409 `RUN_NOT_CONTINUABLE` (body carries `run`) |

Every step first checks ownership, then takes the per-session **run lock**
(`SET NX EX`, TTL `AGENT_RUN_LOCK_TTL_SECONDS` = 300s; a held lock is 409
`RUN_IN_PROGRESS`), applies any pending conversation-summary compaction, increments
`step` (past `AGENT_RUN_MAX_STEPS` = 8 the run fails with `RUN_STEP_LIMIT`), and calls
`advance()`. A continue whose batch operations were dropped by the snapshot ladder
(`batches_truncated`) while commits are still pending fails with `RUN_STATE_LOST`
rather than guessing.

### Transition table (`orchestrator.apply_transition`)

| Phase | Outcome | Next state |
| --- | --- | --- |
| investigate | `chat` (plain text) | `done` |
| investigate | `clarifier` (`ask_user`) | `awaiting_user`, checkpoint `clarifier`, `asked_in_phase = investigate` |
| investigate | `budget` (turn/tool-call budget exhausted) | `done` with the budget clarifier card |
| investigate | `proposal` (`propose` / `revise_proposal`) | propose phase records it -> `awaiting_user`, checkpoint `proposal` |
| investigate | `batches` (`stage_edits`) | Checkpoint policy (below): **execute** -> batches staged, `running` in `execute`; **propose** -> recorded as an `edits` proposal -> `awaiting_user` |
| investigate | `revert` (`revert_changes`) | Revert batch(es) staged -> `running` in `execute` (no policy gate) |
| investigate | `paused` (soft budget hit at a turn boundary) | `next = continue`; the loop transcript is saved to a Redis side key and replayed on the next step (legacy sync mode: `failed`, `RUN_TIMEOUT`) |
| investigate | `cancelled` | `cancelled` (`user_cancelled`) |
| investigate | `error` | `failed` (`provider_error`, fallback text). `PROPOSAL_TARGET_REQUIRED` / `PROPOSAL_TARGET_INACCESSIBLE` / `PROPOSAL_INVALID` instead re-enter investigate **once** with a `# Run` feedback note, then `done` with "I couldn't record that proposal" |
| propose | deterministic - no model call | `proposal` -> `awaiting_user`; "no plan to revise" -> `done` |
| execute | `executed` | `running` in `verify` (a cancel that landed mid-execute is carried along) |
| execute | `paused` (next batch does not fit the hard deadline, or a materialize loop paused) | `next = continue` |
| execute | anything else | `failed` (`EXECUTE_FAILED`) |
| verify | `verified` with a follow-up proposal | `awaiting_user`, checkpoint `proposal` |
| verify | `verified`, cancel requested | `cancelled` |
| verify | `verified` | `done` with the report text |

`advance()` loops while the run is `running`, persisting the session after every
transition, and returns to the client when the run leaves `running`, when a phase
paused, or (clients with `continue`) when the soft step budget has passed.

### Response modes (`orchestrator._modes`)

| Run state at step end | `response_mode` | `parse_mode` |
| --- | --- | --- |
| still `running` | `chat` | `run_step` |
| checkpoint `proposal` | `plan_proposal` | `plan_proposal` |
| checkpoint `clarifier` (or a budget card) | `chat` | `clarifier` |
| a commit landed this step | `edit_plan` | `run_report` when verify reported, else `edit_plan` |
| verify reported, nothing committed | `chat` | `run_report` |
| plain answer that used read tools | `chat` | `context_answer` |
| everything else | `chat` | `chat` |

## Checkpoint policy

`runs.checkpoint_decision` ([`runtime/runs.py`](../../agent/app/core/runtime/runs.py))
decides, for the `stage_edits` batches one investigate turn produced, whether to
execute immediately or to propose first. Reverts never reach it; `propose` always
awaits confirmation.

| Scope | Batches | Decision (reason) |
| --- | --- | --- |
| any | more than one roadmap | propose (`multi_roadmap`) |
| roadmap | the focus roadmap, <= `AGENT_DIRECT_EDIT_MAX_OPERATIONS_FOCUS` (90) ops, **deletes included** | execute (`focus_roadmap`) - the in-roadmap behaviour byte for byte |
| roadmap | the focus roadmap, more than 90 ops | propose (`too_many_operations`) |
| roadmap | any non-focus roadmap | propose (`non_focus_roadmap`) |
| workspace | contains a `delete_node` | propose (`contains_delete`) |
| workspace | more than `AGENT_DIRECT_EDIT_MAX_OPERATIONS` (15) ops | propose (`too_many_operations`) |
| workspace | one roadmap, no deletes, <= 15 ops | execute (`small_single_roadmap`) |

Both thresholds are clamped tunables (0-200), not flags. The decision is logged as a
`checkpoint_policy` event with `decision`, `reason`, `batches` and `operations`.

## The phases

### investigate ([`phases/investigate.py`](../../agent/app/core/runtime/phases/investigate.py))

Loads the context the turn needs (the focus roadmap in roadmap scope; the workspace
overview in workspace scope; memory notes and the project pack for the focus roadmap;
@-refs hydrated once per run; top-k semantic memories above
`AGENT_MEMORY_SEMANTIC_THRESHOLD`), then runs the loop engine with the investigate
catalog until the model ends the turn with one terminal tool or plain text.

- **Reasoning effort** starts at `OPENAI_V2_REASONING_EFFORT` (default `low`) and
  escalates to at least `medium` on a hard turn; the trigger (first match wins) is
  `pending_plan`, `ambiguous_title` (a mentioned title shared by several nodes in the
  merged handle map), `plan_request`, `multi_roadmap_refs` (two or more accessible
  referenced roadmaps) or `workspace_scope`. Logged as `reasoning_effort_selected`.
- **Budgets** are `AGENT_V2_MAX_TURNS` (8) and `AGENT_V2_MAX_TOOL_CALLS` (24) per
  phase entry; a resumed investigate continues its own counters
  (`run.phase_usage.investigate`).
- **Pause/resume**: past the soft step budget the loop stops only at a turn boundary,
  never mid-call, and hands back the echoed transcript. It is stored at
  `{prefix}:{session_id}:run:{run_id}:transcript` for `AGENT_RUN_TRANSCRIPT_TTL_SECONDS`
  (900s); a missing transcript restarts the phase with a "(restarted)" note.
- Several `stage_edits` calls in one response become one batch per roadmap; mixing
  terminal kinds in one response is fed back as `MULTIPLE_TERMINALS`; a
  parse/contract failure on `stage_edits` is fed back too, so the model self-corrects
  inside the same loop.

### propose ([`phases/propose.py`](../../agent/app/core/runtime/phases/propose.py))

Deterministic - **no model call**. It records the session's `pending_plan` from
either a `propose` payload (`kind = plan`, titles only, one `targets[]` entry per
roadmap; absent targets default to the focus roadmap, and in workspace scope that is
`PROPOSAL_TARGET_REQUIRED`), a `revise_proposal` payload (merged into the existing
plan), or `stage_edits` batches the policy sent for confirmation (`kind = edits`,
concrete operations plus human `summary_lines`). Every target roadmap is loaded (or
`PROPOSAL_TARGET_INACCESSIBLE`), and each carries its own staleness anchors
(`base_revision`, `revision_token`, `overview_hash`).

### execute ([`phases/execute.py`](../../agent/app/core/runtime/phases/execute.py))

One independent commit per roadmap batch, in `execute_cursor` order:

1. Batches are (re)built from `pending_plan.targets` on confirm, skipping targets
   already `committed`, and one pending `RunCommit` with its own `idempotency_key`
   is persisted per batch **before any network call**.
2. A batch starts only when `elapsed + reserve <= AGENT_RUN_HARD_DEADLINE_SECONDS`
   (165s). The reserve is the full batch reserve (`OPENAI_MODEL_TIMEOUT_SECONDS` +
   3 x `NEST_TIMEOUT_SECONDS` = 150s) for batches that may call the model
   (materialize, proposal, revert) and only the Nest tail (3 x 20s) for a direct
   `stage_edits` batch. Otherwise the phase pauses (`next = continue`).
3. `kind = plan` targets are **materialized** first: a mini loop pinned to that
   roadmap (`materialize_tools`, effort at least `medium`,
   `AGENT_EXECUTE_MAX_TURNS` = 4 / `AGENT_EXECUTE_MAX_TOOL_CALLS` = 10) turns the
   titles into a `stage_edits` call. A pause here saves its own transcript
   (`batch.materialize_transcript_key`).
4. Every referenced node is re-checked against the batch's roadmap
   (`HANDLE_ROADMAP_MISMATCH` fails the batch before any call).
5. Proposal, materialized and revert batches are **previewed** through
   `POST /roadmaps/:id/ai/preview`, with one repair iteration (a single
   `stage_edits`-only model turn fed the validation issues) and one `STALE_REVISION`
   re-preview. Direct focus-roadmap edits skip preview and commit directly, as before.
6. `POST /roadmaps/:id/ai/commit` with `operations`, `revision_token`,
   `idempotency_key`, `include_roadmap: false`, plus `session_id` and `run_id` for
   attribution. Retry policy: `STALE_REVISION` -> refresh the token and retry once
   with the **same** key; transient 5xx/408/429 -> sleep 1s and retry once; a 400 is
   enriched with the first invalid operation. The key is reused only while the
   operations hash is unchanged - a repair or re-materialize mints a fresh one.
7. Progress is persisted after every commit; a failed batch never stops the next
   one. On a resumed step with pending commits, `GET /api/ai/context/changes?run_id=`
   marks batches the backend already recorded as committed before anything is
   re-sent. Cancel between batches skips the rest (`CANCELLED`).

### verify ([`phases/verify.py`](../../agent/app/core/runtime/phases/verify.py))

Deterministic checks over `run.commits` - `all_batches_committed`, per commit
`diff_matches_plan` (expected vs. `impacted_summary` counts), `revision_advanced`,
`history_recorded`, and `no_repairs_needed` - produce a `VerifyReport` with status
`verified | partial | failed | nothing_to_verify`. Then **at most one model call**
(2 turns, tools = `propose` only) writes the user-facing report and may attach a
follow-up proposal (`follow_up_plan_id`); it never re-applies anything. The model
call is skipped when the step is already past its soft budget, and a provider
failure falls back to the deterministic summary. Emits `verify_completed`.

## Tool catalog per phase

Built in [`runtime/tools.py`](../../agent/app/core/runtime/tools.py) from deep copies
of the shared registry so the operation schema stays in lockstep with the Pydantic
model (the backend schema gate greps the registry's `required=` literals, which this
module never edits). Counts below are from importing the builders.

| Phase / loop | Tools |
| --- | --- |
| investigate (33 baseline; 35 with a pending plan + knowledge search) | 17 roadmap reads + 9 cross-scope reads (+ `search_knowledge`) + 3 non-terminal writes + terminals `stage_edits`, `propose`, (`revise_proposal` only while a proposal is pending), `ask_user`, `revert_changes` |
| execute / materialize (18) | The 17 roadmap reads and `stage_edits`, all pinned to the target roadmap (`roadmap_id` enum of one value) |
| execute / repair (1) | `stage_edits` pinned to the batch's roadmap |
| verify (1) | `propose` with `targets` required |

**Roadmap reads (17):** `get_roadmap_summary`, `get_roadmap_overview` (loads a roadmap
into context and assigns it `R{n}` handles), `resolve_node_reference`, `search_nodes`,
`search_tasks`, `get_node_details`, `get_children_from_resolution`,
`get_features_by_epic`, `get_feature_details`, `get_epics_by_roadmap`,
`get_epic_progress`, `list_members`, `get_tasks_assigned_to_me`, `get_tasks_by_status`,
`get_tasks_by_parent`, `get_overdue_tasks`, `get_blocked_items`. Each takes
`roadmap_id`: optional in roadmap scope (the dispatcher defaults it to the focus),
required in workspace scope. A missing id is `MISSING_ROADMAP_ID`, a non-uuid is
`INVALID_ROADMAP_ID`; backend 403/404 stay mapped to tool errors (that is the
authorization path).

**Cross-scope reads (9, served by `/api/ai/context/*`):** `get_workspace_overview`,
`list_roadmaps`, `search_everything`, `list_my_tasks`, and the project-keyed
`get_project_brief`, `list_project_resources`, `list_project_meetings`,
`list_project_members`, `get_member_details` (`project_id` optional in roadmap scope,
required otherwise). `search_knowledge` is exposed only when
`AGENT_KNOWLEDGE_SEARCH_ENABLED` is on.

**Non-terminal writes (5):** `save_memory`, `forget_memory` (`roadmap_id` required in
workspace scope), `add_task_comments`, `create_roadmap` (POST /api/roadmaps as the
user; standalone or attached via `project_id`), `attach_roadmap_to_project` (PATCH
/api/roadmaps/:id with `project_id`). Projects and roadmaps are one-to-one: the
backend answers 409 `PROJECT_ALREADY_HAS_ROADMAP` for a second roadmap, and both
tools drop the cached workspace overview so the next turn sees the new state.

**Terminals:** `stage_edits` (the registry planning tool renamed; gains `roadmap_id`,
drops `revision_operations` and the old dual-target/clarifier contract text, forces
`operations.minItems = 1`), `propose` (was `propose_plan`; gains `targets[]`),
`revise_proposal`, `ask_user` (1-4 batched questions with clickable options),
`revert_changes(change_id?, roadmap_id?)`.

## Refs (`@`-mentions)

The composer sends `refs: [{kind, id, label?}]` with `kind` in
`project | roadmap | epic | feature | task | milestone | team`, at most
`AGENT_MAX_REFS_PER_MESSAGE` (20). [`runtime/refs.py`](../../agent/app/core/runtime/refs.py)
hydrates them **once per run** through `POST /api/ai/context/resolve-refs` (the
backend fails closed per ref: `accessible: false` with `NOT_FOUND`, `FORBIDDEN`, ...;
non-uuid ids never go over the wire and fail as `NOT_FOUND`; a transport failure marks
the batch `RESOLVE_FAILED`). Results live on `run.resolved_refs` and come back on
`RunView.refs` with `title`, `status`, `roadmap_id`, `project_id`, `workspace_id` and a
nearest-first `parent_chain`, so the web can render chips.

Accessible refs that point at a roadmap join `run.focus_roadmap_ids`; up to
`AGENT_MAX_LOADED_ROADMAPS - 1` (5) of them auto-load in ref order, the rest are
rendered as "not loaded; call get_roadmap_overview". In workspace scope a single
accessible referenced roadmap also becomes the default `roadmap_id` for reads that
omit it. Refs **bias, never restrict** - the prompt says so explicitly. They render
as the per-turn tail block:

```
# Referenced items (mentioned by the user; a hint about what they mean, never a limit on what you may look at)
- @Onboarding -> epic "Onboarding" (E3) in roadmap "Mobile app" (focus), project "Acme"
- @Q4 plan -> roadmap "Q4 plan" (R2), project "Acme"
- @Old roadmap -> not accessible (FORBIDDEN) -- tell the user you cannot see it
```

The web persists the mention spans on the user turn in
`roadmap_ai_messages.metadata.refs` (64 KB ceiling per message).

## Prompt layout and the cache invariant

[`runtime/prompt.py`](../../agent/app/core/runtime/prompt.py) assembles the system
prompt as `STATIC_PREFIX + SCOPE_BLOCK + STATE_BLOCKS + TAIL`:

| Part | Blocks | Changes when |
| --- | --- | --- |
| Static prefix | [`prompts/system.md`](../../agent/app/core/runtime/prompts/system.md) | Never (byte-identical across sessions) |
| Scope block | `# Scope` | Per session |
| State blocks (fixed order) | `# Focus roadmap`, `# Loaded roadmaps`, `# Workspace overview`, `# Project context`, `# Earlier conversation summary`, `# Memory notes`, `# Pending proposal awaiting user confirmation`, `# Recently resolved items`, `# Recent changes`, `# Actor` | Only when cached state changes (a roadmap loads, a commit lands) |
| Tail (always last) | `# Referenced items`, `# Relevant memories`, `# Run` (`phase_investigate.md` only on a resumed investigate; `phase_execute.md` and `phase_verify.md` always) | Every turn |

**Invariant:** nothing per-turn may render above `# Actor`. The prefix through that
block is what the provider's prompt cache keys on (`prompt_cache_key = scope.key`),
and the `cache` line of the lifecycle block must not regress to 0% on multi-turn
sessions. The full roadmap is never re-stuffed; the model fetches detail on demand.

## Budgets

| Budget | Value | What it bounds |
| --- | --- | --- |
| Soft step budget | `AGENT_RUN_STEP_BUDGET_SECONDS` = 90s | Loops stop starting new model turns past it; `advance()` returns `next: continue` at the next phase boundary; verify skips its model call |
| Hard deadline | `AGENT_RUN_HARD_DEADLINE_SECONDS` = 165s | Per request, under the web's 180s axios timeout and Cloud Run's 300s; raised to the soft budget if configured lower |
| Batch reserve | `OPENAI_MODEL_TIMEOUT_SECONDS` (90) + 3 x `NEST_TIMEOUT_SECONDS` (20) = 150s | What must still fit before a model-calling batch starts (direct edits reserve only the 60s Nest tail) |
| Steps per run | `AGENT_RUN_MAX_STEPS` = 8 | ~24 minutes at 180s each; the web caps a run's polling at 30 minutes |
| Run lock | `AGENT_RUN_LOCK_TTL_SECONDS` = 300s | >= the Cloud Run request timeout so a dead request never overlaps a live one |
| Loop turns / tool calls | `AGENT_V2_MAX_TURNS` = 8, `AGENT_V2_MAX_TOOL_CALLS` = 24 (materialize: 4 / 10) | Per phase entry |

## Legacy sync mode

A `/messages` body without `capabilities: ["continue"]` (an old web bundle, a stale
tab, the Capacitor OTA bundle) runs in **sync mode**: the investigate deadline
stretches to the last turn that fits the hard deadline, a pause becomes `failed`
(`RUN_TIMEOUT`) instead of `next: continue`, and execute **skips** the batches that do
not fit (`SKIPPED_BUDGET`, "Confirm the proposal again to apply the remaining
roadmaps") rather than pausing; the pending plan keeps its per-target `committed`
flags so a re-confirm resumes only what is missing. Direct focus-roadmap edits
behave exactly as before: one request, one commit. The legacy create body
(`roadmap_id` instead of `scope`) is accepted for the same release.

## Error codes

| Route | Status / code | Meaning; what the web does |
| --- | --- | --- |
| create | 401 `AUTH_REQUIRED` | No bearer and no guest id |
| create | 404 `SESSION_SCOPE_NOT_FOUND` | The roadmap actor lookup or workspace lookup returned 403/404 (existence is never revealed) |
| any | 503 `SESSION_STORE_UNAVAILABLE` | Redis is not configured / unreachable (`retryable: true`) |
| messages / continue / cancel / traces | 404 `SESSION_NOT_FOUND` | Missing or expired session, **or an owner mismatch**; the web rehydrates from the durable snapshot and retries once |
| messages | 409 `RUN_IN_PROGRESS` `{run}` | The run lock is held, or a crashed execute still has pending commits; the web adopts `run`, drives continue, then re-sends the queued message |
| continue | 404 `RUN_NOT_FOUND` | `run_id` is not the session's current run; terminal for the web |
| continue | 409 `RUN_NOT_CONTINUABLE` `{run}` | The run is not `running`/`continue`; the web settles from the body, no retry |
| continue | 409 `RUN_IN_PROGRESS` `{run}` | Another instance holds the lock; the web polls continue every 3s for up to 150s, then shows Resume/Stop |
| cancel | 404 `RUN_NOT_FOUND` | As above |
| traces | 404 `TRACE_EVENTS_NOT_FOUND` | Unknown trace, another session's trace, or another owner's trace |

Run-level failures surface on `run.error.code`: `RUN_TIMEOUT` (sync mode),
`RUN_STEP_LIMIT`, `RUN_ABANDONED`, `RUN_STATE_LOST`, `EXECUTE_FAILED`,
`provider_error`, `INVALID_PHASE`; per-commit failures on
`commits[].error_code` (`STALE_REVISION`, `IDEMPOTENCY_KEY_REUSED`,
`HANDLE_ROADMAP_MISMATCH`, `EMPTY_BATCH`, `VALIDATION_FAILED`, `SKIPPED_BUDGET`,
`CANCELLED`, ...).

## Trace events

Every `log_event` with a `trace_id` is captured into the Redis trace store (see
[memory.md](./memory.md#2-trace-store-redis)) and served by the trace route; the web
timeline decides what to show. Run-specific events and their `details`:

| Event | Details | Web timeline |
| --- | --- | --- |
| `run_started` | `run_id`, `phase`, `step`, `scope_kind`, `refs_count` | hidden |
| `phase_entered` | `phase`, `step`, `commits_done`, `commits_total` | hidden (patches the banner phase / progress) |
| `phase_completed` | `phase`, `step`, `outcome` | hidden |
| `run_step_completed` | `run_id`, `phase`, `step`, `run_next`, `run_status`, `checkpoint`, `elapsed_ms` | hidden; sets `done` on the trace (`run_next != "continue"`) |
| `run_checkpoint` | `run_id`, `phase`, `checkpoint`, `plan_id` | hidden |
| `refs_resolved` | `refs_total`, `refs_accessible`, `refs_inaccessible`, `loaded_roadmap_ids` | hidden |
| `checkpoint_policy` | `decision`, `reason`, `batches`, `operations` (verbose detail only; no structured picker) | log / verbose only |
| `reasoning_effort_selected` | `phase`, `effort`, `escalated`, `trigger` (verbose detail only; no structured picker) | log / verbose only |
| `commit_started` | `roadmap_id`, `roadmap_title`, `batch_id`, `operations_count`, `attempt` | curated row |
| `commit_completed` | `roadmap_id`, `roadmap_title`, `batch_id`, `change_id`, `operations_count`, `commit_ms`, `impacted_item_count`, `impacted_summary`, `impacted_items`, `history_recorded` | curated row |
| `commit_failed` | `roadmap_id`, `roadmap_title`, `batch_id`, `error_code`, `error_message`, `upstream_status`, `invalid_operation`, `attempt`, `impacted_items` | curated row (status `error`) |
| `verify_completed` | `status`, `summary_text`, `checks[]`, `follow_up_plan_id`, `commits_total`, `commits_committed` | curated row (status `error` when `failed`) |

The pre-run events (`message_received`, `route_selected`, `tool_call_requested`,
`tool_call_result`, `provider_*`, `assistant_delta`, `assistant_thought`,
`session_staged_state`, `message_completed`) are unchanged; `auto_commit_async_*`
events no longer exist. The optional realtime push envelope gained `run_id` and
`phase`.

## The `logs.txt` lifecycle block

With `AGENT_LOG_FILE` set and `AGENT_LOG_JSON=false`,
[`logging_utils.py`](../../agent/app/core/logging_utils.py) renders one
human-readable `AI REQUEST: <TITLE>` block per HTTP request (a message **or** a
continue), keyed by trace id and flushed when that request's `message_completed`
fires. Message and tool content is redacted unless `AGENT_LOG_INCLUDE_CONTENT=true`.

```
------------------------------------------------------------------------------
AI REQUEST: <title from parse_mode, else intent_type>
------------------------------------------------------------------------------
trace_id     ...
session_id   ...
roadmap_id   ... (the focus roadmap; "-" in workspace scope)

USER
  <message summary>

ACTOR
  source / present / role

ROUTING
  classified / mode (response_mode) / tool_mode / recovery parse_mode

TOOL CALL
  1. <tool_name>  - <arg>: ...  - result: ...  - tool_error_code: ...

LLM OPERATIONS
  <index>: - op: ... - node_type: ...   (one entry per staged operation)

RESPONSE
  provider / fallback / staged / ops / elapsed ms / lane (route_lane, e.g.
  run_execute_executed) / stop / action / react_loop turns= budget= end= /
  clarifier / guard / retry_calls / retry_dedupe / retry_auto / validation /
  tokens in= out= total= / cache <cached-prefix ratio>

ASSISTANT
  <assistant message summary>
------------------------------------------------------------------------------
```

The run fields themselves (`run_id`, `phase`, `step`, `run_next`, `run_status`,
`commits_committed`, `commits_failed`, `owner_key`) are on the `message_completed`
and `run_step_completed` event lines that precede the block, not inside it. Watch
the `cache` line across turns of one session: it is the only signal that the prompt
ordering above is paying off.

## Files

| Path | Role |
| --- | --- |
| [`agent/app/core/runtime/orchestrator.py`](../../agent/app/core/runtime/orchestrator.py) | `step()`, the input table, `advance()`, `apply_transition()`, `finalize_step()`, `request_cancel()` |
| [`agent/app/core/runtime/runs.py`](../../agent/app/core/runtime/runs.py) | Run constructors, transition mutators, the checkpoint policy, `RunView` projections |
| [`agent/app/core/runtime/phases/`](../../agent/app/core/runtime/phases/) | `investigate.py`, `propose.py`, `execute.py`, `verify.py` |
| [`agent/app/core/runtime/service.py`](../../agent/app/core/runtime/service.py) | `RuntimeService` (DI root), `StepContext` (auth, trace id, budgets, cancel probe, per-step accumulators), ownership helpers |
| [`agent/app/core/runtime/tools.py`](../../agent/app/core/runtime/tools.py) | The per-phase, per-scope tool catalogs |
| [`agent/app/core/runtime/terminal.py`](../../agent/app/core/runtime/terminal.py) | Terminal handlers per loop (`for_investigate`, `for_materialize`, `for_verify`, repair) |
| [`agent/app/core/runtime/prompt.py`](../../agent/app/core/runtime/prompt.py) + `prompts/` | Prompt assembly and the cache invariant |
| [`agent/app/core/runtime/refs.py`](../../agent/app/core/runtime/refs.py) | Ref hydration, auto-load, the `# Referenced items` block |
| [`agent/app/core/runtime/handles.py`](../../agent/app/core/runtime/handles.py), [`scope.py`](../../agent/app/core/runtime/scope.py), [`context_cache.py`](../../agent/app/core/runtime/context_cache.py), [`overview.py`](../../agent/app/core/runtime/overview.py) | Handles, scope helpers, the per-roadmap LRU and outlines |
| [`agent/app/core/runtime/staging.py`](../../agent/app/core/runtime/staging.py), [`revert.py`](../../agent/app/core/runtime/revert.py), [`snapshot.py`](../../agent/app/core/runtime/snapshot.py), [`summarizer.py`](../../agent/app/core/runtime/summarizer.py), [`sentinels.py`](../../agent/app/core/runtime/sentinels.py) | Batch staging, deterministic revert, the durable snapshot, compaction, web sentinels |
| [`agent/app/core/engine/`](../../agent/app/core/engine/) | `loop.py` (the tool-calling loop), `llm_client.py` (Responses API wrapper: streaming, reasoning, self-heal, `OPENAI_MODEL_TIMEOUT_SECONDS`), `progress.py`, `tool_results.py` |
| [`agent/app/core/contracts/runs.py`](../../agent/app/core/contracts/runs.py) | `SessionScope`, `ContextRef`/`ResolvedRef`, `RunBatch`, `RunCommit`, `VerifyReport`, `RunState`, `RunView` |
| [`agent/app/api/routes/sessions_support/flows.py`](../../agent/app/api/routes/sessions_support/flows.py) | The create / message / continue / cancel flows and the snapshot push after a step |
| [`agent/app/core/trace/store.py`](../../agent/app/core/trace/store.py) | The Redis-backed trace store |

## See also

- [memory.md](./memory.md) - the session document, run fields, trace keys, snapshot.
- [operations-schema.md](./operations-schema.md) - the shared operations contract.
- [setup-and-deploy.md](./setup-and-deploy.md#configuration) - every tunable and default.
- [Architecture -> cross-service flows](../02-architecture/cross-service-flows.md#flow-1--roadmap-ai-edit) - the hop-by-hop request path.

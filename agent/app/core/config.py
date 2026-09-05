from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_AGENT_ROOT = Path(__file__).resolve().parents[2]


def _clamp_int(value: int, low: int, high: int) -> int:
    if value < low:
        return low
    if value > high:
        return high
    return value


def _clamp_float(value: float, low: float, high: float) -> float:
    if value < low:
        return low
    if value > high:
        return high
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_AGENT_ROOT / '.env'),
        env_file_encoding='utf-8',
        case_sensitive=False,
        extra='ignore',
    )

    app_name: str = Field(default='Roadmap AI Agent', alias='APP_NAME')
    app_env: str = Field(default='development', alias='APP_ENV')
    app_host: str = Field(default='0.0.0.0', alias='APP_HOST')
    app_port: int = Field(default=8010, alias='APP_PORT')

    nest_api_base_url: str = Field(default='http://localhost:8000/api', alias='NEST_API_BASE_URL')
    nest_timeout_seconds: float = Field(default=20.0, alias='NEST_TIMEOUT_SECONDS')

    # Realtime worker push for AI-trace progress events (app/core/realtime_push.py).
    # Same env names as the NestJS backend's RealtimePublisher; unset = dormant
    # (the web keeps polling — push is purely a latency reduction).
    realtime_worker_url: str | None = Field(default=None, alias='REALTIME_WORKER_URL')
    realtime_publish_token: str | None = Field(default=None, alias='REALTIME_PUBLISH_TOKEN')
    agent_realtime_trace_push_enabled: bool = Field(
        default=False,
        alias='AGENT_REALTIME_TRACE_PUSH_ENABLED',
    )

    openai_api_key: str | None = Field(default=None, alias='OPENAI_API_KEY')

    # ------------------------------------------------------------------
    # Project-brief generator (app/core/briefs) — a single stateless call,
    # not the v2 loop. Reached only from the NestJS backend, which is what
    # authenticates the human; agent_internal_token is the shared secret that
    # keeps it from being an open OpenAI proxy, and is required outside
    # development -- unset there fails the endpoint closed.
    # ------------------------------------------------------------------
    agent_internal_token: str | None = Field(default=None, alias='AGENT_INTERNAL_TOKEN')
    # Falls back to openai_model_v2 when unset, so there is one model knob to
    # turn until the two genuinely need to diverge.
    agent_brief_model: str | None = Field(default=None, alias='AGENT_BRIEF_MODEL')
    agent_brief_max_output_tokens: int = Field(
        default=3000,
        alias='AGENT_BRIEF_MAX_OUTPUT_TOKENS',
    )

    # 4h working-session window. Expiry is benign: the durable agent-state
    # snapshot (roadmap_ai_sessions.metadata.agent_state) restores pending
    # plans / undo history / recents on rehydration.
    session_ttl_seconds: int = Field(default=14400, alias='SESSION_TTL_SECONDS')
    upstash_redis_rest_url: str | None = Field(default=None, alias='UPSTASH_REDIS_REST_URL')
    upstash_redis_rest_token: str | None = Field(default=None, alias='UPSTASH_REDIS_REST_TOKEN')
    redis_session_key_prefix: str = Field(default='roadmap:ai:session', alias='REDIS_SESSION_KEY_PREFIX')
    max_operations_per_request: int = Field(default=90, alias='MAX_OPERATIONS_PER_REQUEST')
    # Counts `Message` rows including structured tool-call pairs
    # (assistant(tool_calls=...) + tool(tool_call_id=...)). A single resolver
    # call is 2 messages, so this needs more headroom than a pure text-chat
    # default would suggest.
    max_chat_history_messages: int = Field(default=30, alias='MAX_CHAT_HISTORY_MESSAGES')

    agent_log_level: str = Field(default='DEBUG', alias='AGENT_LOG_LEVEL')
    agent_log_json: bool = Field(default=False, alias='AGENT_LOG_JSON')
    agent_log_color: str = Field(default='auto', alias='AGENT_LOG_COLOR')
    agent_log_include_content: bool = Field(default=False, alias='AGENT_LOG_INCLUDE_CONTENT')
    agent_log_file: str | None = Field(default=None, alias='AGENT_LOG_FILE')
    agent_log_to_console: bool = Field(default=True, alias='AGENT_LOG_TO_CONSOLE')
    agent_progress_events_enabled: bool = Field(
        default=True,
        alias='AGENT_PROGRESS_EVENTS_ENABLED',
    )
    agent_progress_events_allow_verbose: bool = Field(
        default=True,
        alias='AGENT_PROGRESS_EVENTS_ALLOW_VERBOSE',
    )
    agent_cache_ttl_seconds: int = Field(default=600, alias='AGENT_CACHE_TTL_SECONDS')
    agent_project_context_enabled: bool = Field(
        default=True,
        alias='AGENT_PROJECT_CONTEXT_ENABLED',
    )
    # Ships dark: exposes the search_knowledge tool only once the backend
    # knowledge pipeline (KNOWLEDGE_INGEST_ENABLED + scheduler) is live.
    agent_knowledge_search_enabled: bool = Field(
        default=False,
        alias='AGENT_KNOWLEDGE_SEARCH_ENABLED',
    )
    # Above this many cached memory notes the inject-all "# Memory notes"
    # block switches to per-turn top-k semantic retrieval rendered as a tail
    # block (keeps the cached prompt prefix stable). Clamped to [0, 100].
    agent_memory_semantic_threshold: int = Field(
        default=15,
        alias='AGENT_MEMORY_SEMANTIC_THRESHOLD',
    )
    # In-turn resolve-lookup cache lifetime. The ToolDispatcher (and its cache)
    # is rebuilt every message turn, so this TTL only bounds staleness WITHIN a
    # single turn — it never leaks across turns or sessions. A long multi-tool
    # turn (up to AGENT_V2_MAX_TURNS round-trips) can exceed 30s wall-clock and
    # re-fetch a label it already resolved; defaulting to the 300s clamp ceiling
    # keeps a resolved node cached for the whole turn. Still capped at 300 so a
    # misconfig can't cache a stale read for an unbounded time.
    agent_resolve_cache_ttl_seconds: int = Field(
        default=300,
        alias='AGENT_RESOLVE_CACHE_TTL_SECONDS',
    )
    agent_resolve_parallel_variants_enabled: bool = Field(
        default=True,
        alias='AGENT_RESOLVE_PARALLEL_VARIANTS_ENABLED',
    )

    # ------------------------------------------------------------------
    # Loop engine (app/core/engine) + runtime (app/core/runtime): the only
    # roadmap-AI brain. runtime.orchestrator.step drives the phases
    # (investigate -> propose -> execute -> verify); every model-facing
    # phase runs the same hand-rolled tool-calling loop on ONE model (no
    # separate classifier). The AGENT_V2_* / OPENAI_V2_* env names are kept
    # for deploy compatibility.
    # ------------------------------------------------------------------
    # Single knob for the v2 loop's model id. Set to whatever GPT-5 variant
    # the org exposes (e.g. 'gpt-5', 'gpt-5.4', 'gpt-5.4-mini').
    openai_model_v2: str = Field(default='gpt-5.4-mini', alias='OPENAI_MODEL_V2')
    agent_v2_max_turns: int = Field(default=8, alias='AGENT_V2_MAX_TURNS')
    # 24 (was 14): sized so exhaustive-read Q&A ("explain every epic in
    # detail") fits — on a ~8-feature roadmap the model fetches details per
    # node and 14 ran out before it could write the answer (v2_budget
    # clarifier). Edit turns still use a handful of calls; the cap remains the
    # runaway guard.
    agent_v2_max_tool_calls: int = Field(default=24, alias='AGENT_V2_MAX_TOOL_CALLS')
    openai_v2_max_output_tokens: int | None = Field(
        default=4000,
        alias='OPENAI_V2_MAX_OUTPUT_TOKENS',
    )
    openai_v2_reasoning_effort: str | None = Field(
        default='low',
        alias='OPENAI_V2_REASONING_EFFORT',
    )
    # GPT-5 reasoning models reject non-default temperature, so v2 omits it by
    # default (None → not sent). Set a float only if the configured model
    # accepts it.
    openai_v2_temperature: float | None = Field(
        default=None,
        alias='OPENAI_V2_TEMPERATURE',
    )
    # Stream v2 model calls (Responses API stream=True) so assistant text can
    # be surfaced to the web as throttled `assistant_delta` progress events
    # while the loop runs. The final Response object is identical either way;
    # false = kill switch back to plain non-streaming calls.
    openai_v2_streaming_enabled: bool = Field(
        default=True,
        alias='OPENAI_V2_STREAMING_ENABLED',
    )
    # Ask the Responses API for sanitized reasoning summaries
    # (reasoning.summary='auto') and surface them as `assistant_thought`
    # progress events — the "thought" lines between tool steps in the web
    # activity timeline. Independent of streaming: the non-streaming path
    # extracts summaries from the terminal response's reasoning items.
    openai_v2_reasoning_summary_enabled: bool = Field(
        default=False,
        alias='OPENAI_V2_REASONING_SUMMARY_ENABLED',
    )

    # ------------------------------------------------------------------
    # Conversation compaction (app/core/runtime/summarizer.py). When a session
    # exceeds TRIGGER messages, the oldest turns beyond KEEP are folded into
    # a rolling summary (computed post-turn on SUMMARY_MODEL, applied at the
    # next turn start) and truncated from Redis. The summary rides the
    # durable agent-state snapshot.
    # ------------------------------------------------------------------
    agent_summary_model: str = Field(default='gpt-4o-mini', alias='AGENT_SUMMARY_MODEL')
    agent_summary_trigger_messages: int = Field(
        default=40,
        alias='AGENT_SUMMARY_TRIGGER_MESSAGES',
    )
    agent_summary_keep_messages: int = Field(
        default=30,
        alias='AGENT_SUMMARY_KEEP_MESSAGES',
    )
    agent_summary_max_chars: int = Field(
        default=4000,
        alias='AGENT_SUMMARY_MAX_CHARS',
    )

    # ------------------------------------------------------------------
    # Run orchestration (session-orchestrated phases: investigate ->
    # propose -> execute -> verify). Every knob below is a clamped number,
    # never an on/off switch — the run machine is always on.
    #
    # Time budget invariant: STEP_BUDGET is the SOFT budget (the loop stops
    # starting new model turns past it); HARD_DEADLINE is the per-request
    # ceiling, under the web's 180s axios timeout and Cloud Run's 300s.
    # BATCH_RESERVE = OPENAI_MODEL_TIMEOUT_SECONDS + 3 * NEST_TIMEOUT_SECONDS
    # (one uninterruptible model call plus refresh/preview/commit); execute
    # starts a batch only when elapsed + BATCH_RESERVE <= HARD_DEADLINE.
    # ------------------------------------------------------------------
    agent_run_step_budget_seconds: float = Field(
        default=90.0,
        alias='AGENT_RUN_STEP_BUDGET_SECONDS',
    )
    agent_run_hard_deadline_seconds: float = Field(
        default=165.0,
        alias='AGENT_RUN_HARD_DEADLINE_SECONDS',
    )
    # HTTP requests (message + continues) one run may consume. 8 x ~180s
    # bounds a run at ~24 minutes; the web caps polling at 30.
    agent_run_max_steps: int = Field(default=8, alias='AGENT_RUN_MAX_STEPS')
    # Per-session run lock (SET NX EX). >= the Cloud Run request timeout so a
    # dead request can never overlap a live one.
    agent_run_lock_ttl_seconds: int = Field(
        default=300,
        alias='AGENT_RUN_LOCK_TTL_SECONDS',
    )
    # Paused loop transcripts (investigate / materialize) live this long as
    # Redis side keys; a missing transcript restarts the read-only phase.
    agent_run_transcript_ttl_seconds: int = Field(
        default=900,
        alias='AGENT_RUN_TRANSCRIPT_TTL_SECONDS',
    )
    # Checkpoint policy (D4). Workspace scope: a single-roadmap, delete-free
    # batch up to this many ops executes without confirmation.
    agent_direct_edit_max_operations: int = Field(
        default=15,
        alias='AGENT_DIRECT_EDIT_MAX_OPERATIONS',
    )
    # Roadmap scope: a batch targeting the FOCUS roadmap executes immediately
    # up to this many ops, deletes included (today's in-roadmap behaviour).
    agent_direct_edit_max_operations_focus: int = Field(
        default=90,
        alias='AGENT_DIRECT_EDIT_MAX_OPERATIONS_FOCUS',
    )
    # Materialize mini loop (titles -> operations per proposal target).
    agent_execute_max_turns: int = Field(default=4, alias='AGENT_EXECUTE_MAX_TURNS')
    agent_execute_max_tool_calls: int = Field(
        default=10,
        alias='AGENT_EXECUTE_MAX_TOOL_CALLS',
    )
    # Context-cache LRU size (never evicts the run's focus roadmaps); at most
    # (this - 1) referenced roadmaps auto-load on step 1.
    agent_max_loaded_roadmaps: int = Field(default=6, alias='AGENT_MAX_LOADED_ROADMAPS')
    # @-references accepted per message (the backend resolver takes 1..25).
    agent_max_refs_per_message: int = Field(default=20, alias='AGENT_MAX_REFS_PER_MESSAGE')
    # Per-call OpenAI client timeout (was hardcoded 90 in openai_client.py).
    openai_model_timeout_seconds: float = Field(
        default=90.0,
        alias='OPENAI_MODEL_TIMEOUT_SECONDS',
    )

    # ------------------------------------------------------------------
    # Redis-backed trace store (app/core/trace/store.py). Keys
    # `{prefix}:{trace_id}` (hash) + `{prefix}:{trace_id}:events` (list);
    # both re-EXPIRE on every flush so an active trace never ages out.
    # ------------------------------------------------------------------
    redis_trace_key_prefix: str = Field(
        default='roadmap:ai:trace',
        alias='REDIS_TRACE_KEY_PREFIX',
    )
    agent_trace_ttl_seconds: int = Field(default=900, alias='AGENT_TRACE_TTL_SECONDS')
    # Flush the per-process event buffer every N events or every INTERVAL
    # seconds, whichever comes first (one Upstash pipeline per flush).
    agent_trace_flush_every_events: int = Field(
        default=5,
        alias='AGENT_TRACE_FLUSH_EVERY_EVENTS',
    )
    agent_trace_flush_interval_seconds: float = Field(
        default=0.5,
        alias='AGENT_TRACE_FLUSH_INTERVAL_SECONDS',
    )

    @field_validator('agent_run_step_budget_seconds')
    @classmethod
    def normalize_agent_run_step_budget_seconds(cls, value: float) -> float:
        return _clamp_float(value, 10.0, 280.0)

    @field_validator('agent_run_hard_deadline_seconds')
    @classmethod
    def normalize_agent_run_hard_deadline_seconds(cls, value: float) -> float:
        # Under Cloud Run's 300s request timeout with room for the final
        # persist + trace flush.
        return _clamp_float(value, 30.0, 280.0)

    @field_validator('agent_run_max_steps')
    @classmethod
    def normalize_agent_run_max_steps(cls, value: int) -> int:
        return _clamp_int(value, 1, 32)

    @field_validator('agent_run_lock_ttl_seconds')
    @classmethod
    def normalize_agent_run_lock_ttl_seconds(cls, value: int) -> int:
        return _clamp_int(value, 60, 3600)

    @field_validator('agent_run_transcript_ttl_seconds')
    @classmethod
    def normalize_agent_run_transcript_ttl_seconds(cls, value: int) -> int:
        return _clamp_int(value, 60, 14400)

    @field_validator(
        'agent_direct_edit_max_operations',
        'agent_direct_edit_max_operations_focus',
    )
    @classmethod
    def normalize_agent_direct_edit_max_operations(cls, value: int) -> int:
        return _clamp_int(value, 0, 200)

    @field_validator('agent_execute_max_turns')
    @classmethod
    def normalize_agent_execute_max_turns(cls, value: int) -> int:
        return _clamp_int(value, 1, 16)

    @field_validator('agent_execute_max_tool_calls')
    @classmethod
    def normalize_agent_execute_max_tool_calls(cls, value: int) -> int:
        return _clamp_int(value, 1, 60)

    @field_validator('agent_max_loaded_roadmaps')
    @classmethod
    def normalize_agent_max_loaded_roadmaps(cls, value: int) -> int:
        return _clamp_int(value, 1, 20)

    @field_validator('agent_max_refs_per_message')
    @classmethod
    def normalize_agent_max_refs_per_message(cls, value: int) -> int:
        # The backend resolver accepts at most 25 refs per call.
        return _clamp_int(value, 0, 25)

    @field_validator('openai_model_timeout_seconds')
    @classmethod
    def normalize_openai_model_timeout_seconds(cls, value: float) -> float:
        return _clamp_float(value, 5.0, 280.0)

    @field_validator('redis_trace_key_prefix')
    @classmethod
    def normalize_redis_trace_key_prefix(cls, value: str) -> str:
        normalized = (value or '').strip().rstrip(':')
        return normalized or 'roadmap:ai:trace'

    @field_validator('agent_trace_ttl_seconds')
    @classmethod
    def normalize_agent_trace_ttl_seconds(cls, value: int) -> int:
        return _clamp_int(value, 60, 86400)

    @field_validator('agent_trace_flush_every_events')
    @classmethod
    def normalize_agent_trace_flush_every_events(cls, value: int) -> int:
        return _clamp_int(value, 1, 100)

    @field_validator('agent_trace_flush_interval_seconds')
    @classmethod
    def normalize_agent_trace_flush_interval_seconds(cls, value: float) -> float:
        return _clamp_float(value, 0.05, 10.0)

    @model_validator(mode='after')
    def normalize_run_budget_order(self) -> 'Settings':
        # The hard deadline is a ceiling on the soft budget: a step budget
        # above it would let the loop start a turn it can never finish.
        if self.agent_run_hard_deadline_seconds < self.agent_run_step_budget_seconds:
            self.agent_run_hard_deadline_seconds = self.agent_run_step_budget_seconds
        return self

    @property
    def agent_run_batch_reserve_seconds(self) -> float:
        """Seconds execute must have left before starting a batch: one
        uninterruptible model call plus refresh/preview/commit."""
        return self.openai_model_timeout_seconds + 3 * self.nest_timeout_seconds

    @field_validator('agent_memory_semantic_threshold')
    @classmethod
    def normalize_agent_memory_semantic_threshold(cls, value: int) -> int:
        if value < 0:
            return 0
        if value > 100:
            return 100
        return value

    @field_validator('agent_v2_max_turns')
    @classmethod
    def normalize_agent_v2_max_turns(cls, value: int) -> int:
        if value < 1:
            return 1
        if value > 16:
            return 16
        return value

    @field_validator('agent_v2_max_tool_calls')
    @classmethod
    def normalize_agent_v2_max_tool_calls(cls, value: int) -> int:
        if value < 1:
            return 1
        if value > 60:
            return 60
        return value

    @field_validator('openai_v2_reasoning_effort')
    @classmethod
    def normalize_openai_v2_reasoning_effort(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip().lower()
        if not normalized:
            return None
        if normalized not in {'minimal', 'low', 'medium', 'high'}:
            return 'low'
        return normalized

    @field_validator('nest_api_base_url')
    @classmethod
    def normalize_nest_api_base_url(cls, value: str) -> str:
        normalized = value.rstrip('/')
        if normalized.endswith('/api'):
            return normalized
        return f'{normalized}/api'

    @field_validator('agent_log_color')
    @classmethod
    def normalize_agent_log_color(cls, value: str) -> str:
        normalized = (value or 'auto').strip().lower()
        if normalized not in {'auto', 'on', 'off'}:
            return 'auto'
        return normalized

    @field_validator('agent_resolve_cache_ttl_seconds')
    @classmethod
    def normalize_agent_resolve_cache_ttl_seconds(cls, value: int) -> int:
        if value < 0:
            return 0
        if value > 300:
            return 300
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reload_settings() -> Settings:
    get_settings.cache_clear()
    return get_settings()

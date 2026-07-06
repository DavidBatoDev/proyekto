from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_AGENT_ROOT = Path(__file__).resolve().parents[2]


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

    nest_api_base_url: str = Field(default='http://localhost:8001/api', alias='NEST_API_BASE_URL')
    nest_timeout_seconds: float = Field(default=20.0, alias='NEST_TIMEOUT_SECONDS')

    openai_api_key: str | None = Field(default=None, alias='OPENAI_API_KEY')

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

    # False = commit synchronously inside the message turn. This keeps the
    # roadmap overview + handle-map fresh for the NEXT turn (so a follow-up
    # rename/delete targets the just-committed node correctly) and clears
    # staged ops before the next edit. True backgrounds the commit for a
    # faster response but races subsequent turns against stale state.
    agent_async_auto_commit_enabled: bool = Field(
        default=False,
        alias='AGENT_ASYNC_AUTO_COMMIT_ENABLED',
    )

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
    # v2 single-loop agent (app/core/v2) — the only roadmap-AI brain.
    # AgentService.plan_message routes to the lean hand-rolled tool-calling
    # loop. The whole loop runs on ONE model (no separate classifier).
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

    # ------------------------------------------------------------------
    # Conversation compaction (app/core/v2/summarizer.py). When a session
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

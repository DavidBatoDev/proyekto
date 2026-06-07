from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, field_validator
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
    openai_model: str = Field(default='gpt-5-mini', alias='OPENAI_MODEL')
    openai_temperature: float = Field(default=0.2, alias='OPENAI_TEMPERATURE')
    openai_reasoning_effort: str | None = Field(
        default='low',
        alias='OPENAI_REASONING_EFFORT',
    )
    # Caps the output of chat replies and roadmap-query answers (NOT the
    # planner, NOT the classifier). Legacy alias kept one release:
    # OPENAI_MAX_TOKENS.
    openai_chat_max_tokens: int | None = Field(
        default=1200,
        alias='OPENAI_CHAT_MAX_TOKENS',
        validation_alias=AliasChoices(
            'OPENAI_CHAT_MAX_TOKENS',
            'OPENAI_MAX_TOKENS',
        ),
    )
    # Default output budget for the EDIT lane's operation-staging planner
    # when no narrower profile applies. Renamed from OPENAI_PLANNER_DEFAULT_MAX_TOKENS
    # to disambiguate from the new plan-mode lane (`OPENAI_PLAN_MAX_TOKENS`).
    # Legacy aliases: OPENAI_PLANNER_DEFAULT_MAX_TOKENS, OPENAI_PLANNER_MAX_TOKENS.
    openai_edit_default_max_tokens: int | None = Field(
        default=3000,
        alias='OPENAI_EDIT_DEFAULT_MAX_TOKENS',
        validation_alias=AliasChoices(
            'OPENAI_EDIT_DEFAULT_MAX_TOKENS',
            'OPENAI_PLANNER_DEFAULT_MAX_TOKENS',
            'OPENAI_PLANNER_MAX_TOKENS',
        ),
    )
    # Expanded budget used for the `repair_retry` profile when the previous
    # edit-lane attempt truncated or missed its tool call. Legacy aliases:
    # OPENAI_PLANNER_REPAIR_MAX_TOKENS, OPENAI_PLANNER_RETRY_MAX_TOKENS.
    openai_edit_repair_max_tokens: int | None = Field(
        default=6000,
        alias='OPENAI_EDIT_REPAIR_MAX_TOKENS',
        validation_alias=AliasChoices(
            'OPENAI_EDIT_REPAIR_MAX_TOKENS',
            'OPENAI_PLANNER_REPAIR_MAX_TOKENS',
            'OPENAI_PLANNER_RETRY_MAX_TOKENS',
        ),
    )
    # Tighter budget used when the sub-intent classifier identifies the
    # turn as a narrow single-dimension edit (rename_only, delete_only,
    # status_change_only, move_only). Legacy aliases:
    # OPENAI_PLANNER_NARROW_EDIT_MAX_TOKENS, OPENAI_PLANNER_SCOPED_MAX_TOKENS.
    openai_edit_narrow_max_tokens: int | None = Field(
        default=2000,
        alias='OPENAI_EDIT_NARROW_MAX_TOKENS',
        validation_alias=AliasChoices(
            'OPENAI_EDIT_NARROW_MAX_TOKENS',
            'OPENAI_PLANNER_NARROW_EDIT_MAX_TOKENS',
            'OPENAI_PLANNER_SCOPED_MAX_TOKENS',
        ),
    )
    # Plan-mode phase needs headroom for reasoning tokens PLUS a full JSON
    # envelope (summary, goal, rationale, proposed_hierarchy). Without an
    # explicit cap GPT-5 reasoning models default to ~900 tokens, which the
    # model exhausts on reasoning alone — leaving empty surface content.
    openai_plan_max_tokens: int | None = Field(
        default=8000,
        alias='OPENAI_PLAN_MAX_TOKENS',
    )
    # Plan-revision output is a tiny `revision_operations` patch, not a full
    # proposed_hierarchy. The tighter ceiling is both a telemetry signal and
    # a hard backstop: if the model forgets to emit ops and regresses to a
    # full envelope, truncation kicks in before it burns 4000 tokens.
    openai_plan_revision_max_tokens: int | None = Field(
        default=1500,
        alias='OPENAI_PLAN_REVISION_MAX_TOKENS',
    )
    openai_classifier_model: str = Field(
        default='gpt-4o-mini',
        alias='OPENAI_CLASSIFIER_MODEL',
    )
    openai_classifier_max_tokens: int | None = Field(
        default=120,
        alias='OPENAI_CLASSIFIER_MAX_TOKENS',
    )
    openai_classifier_temperature: float = Field(
        default=0.0,
        alias='OPENAI_CLASSIFIER_TEMPERATURE',
    )
    agent_llm_intent_classifier_enabled: bool = Field(
        default=True,
        alias='AGENT_LLM_INTENT_CLASSIFIER_ENABLED',
    )

    session_ttl_seconds: int = Field(default=1800, alias='SESSION_TTL_SECONDS')
    upstash_redis_rest_url: str | None = Field(default=None, alias='UPSTASH_REDIS_REST_URL')
    upstash_redis_rest_token: str | None = Field(default=None, alias='UPSTASH_REDIS_REST_TOKEN')
    redis_session_key_prefix: str = Field(default='roadmap:ai:session', alias='REDIS_SESSION_KEY_PREFIX')
    max_operations_per_request: int = Field(default=90, alias='MAX_OPERATIONS_PER_REQUEST')
    # Both caps count `Message` rows including structured tool-call
    # pairs (assistant(tool_calls=...) + tool(tool_call_id=...)). A
    # single resolver call is 2 messages, so these need more headroom
    # than a pure text-chat default would suggest.
    max_chat_history_messages: int = Field(default=30, alias='MAX_CHAT_HISTORY_MESSAGES')
    max_edit_history_messages: int = Field(default=30, alias='MAX_EDIT_HISTORY_MESSAGES')
    max_edit_tool_turns: int = Field(default=4, alias='MAX_EDIT_TOOL_TURNS')
    max_context_tool_turns: int = Field(default=4, alias='MAX_CONTEXT_TOOL_TURNS')
    max_discovery_tool_calls: int = Field(default=6, alias='MAX_DISCOVERY_TOOL_CALLS')
    max_repeated_tool_calls_per_signature: int = Field(
        default=2,
        alias='MAX_REPEATED_TOOL_CALLS_PER_SIGNATURE',
    )
    agent_edit_planner_repair_retries: int = Field(
        default=1,
        alias='AGENT_EDIT_PLANNER_REPAIR_RETRIES',
        validation_alias=AliasChoices(
            'AGENT_REACT_REPAIR_RETRIES',
            'AGENT_EDIT_PLANNER_REPAIR_RETRIES',
        ),
    )
    agent_edit_planner_max_attempts: int = Field(
        default=2,
        alias='AGENT_EDIT_PLANNER_MAX_ATTEMPTS',
        validation_alias=AliasChoices(
            'AGENT_REACT_MAX_ATTEMPTS',
            'AGENT_EDIT_PLANNER_MAX_ATTEMPTS',
        ),
    )
    agent_max_total_llm_calls_per_message: int = Field(
        default=8,
        alias='AGENT_MAX_TOTAL_LLM_CALLS_PER_MESSAGE',
    )
    agent_hybrid_react_enabled: bool = Field(
        default=True,
        alias='AGENT_HYBRID_REACT_ENABLED',
    )
    agent_edit_actionable_failure_clarifier_enabled: bool = Field(
        default=True,
        alias='AGENT_EDIT_ACTIONABLE_FAILURE_CLARIFIER_ENABLED',
    )
    agent_draft_graph_enabled: bool = Field(
        default=False,
        alias='AGENT_DRAFT_GRAPH_ENABLED',
    )
    agent_async_auto_commit_enabled: bool = Field(
        default=True,
        alias='AGENT_ASYNC_AUTO_COMMIT_ENABLED',
    )
    # When True the `roadmap_plan` intent routes to the plan_proposal lane —
    # the agent produces a structured plan without staging ops; a follow-up
    # confirm_action triggers the edit lane with a synthesized plan prompt.
    # Default False preserves the current behavior (plan_only routes through
    # the edit lane and stages ops immediately).
    agent_plan_proposal_enabled: bool = Field(
        default=True,
        alias='AGENT_PLAN_PROPOSAL_ENABLED',
    )
    agent_strict_mutation_authority_enabled: bool = Field(
        default=True,
        alias='AGENT_STRICT_MUTATION_AUTHORITY_ENABLED',
    )
    inline_preview_max_bytes: int = Field(
        default=262144,
        alias='INLINE_PREVIEW_MAX_BYTES',
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
    agent_resolve_cache_ttl_seconds: int = Field(
        default=30,
        alias='AGENT_RESOLVE_CACHE_TTL_SECONDS',
    )
    agent_resolve_parallel_variants_enabled: bool = Field(
        default=True,
        alias='AGENT_RESOLVE_PARALLEL_VARIANTS_ENABLED',
    )

    # ------------------------------------------------------------------
    # v2 single-loop agent (app/core/v2). When enabled (globally or per
    # session via metadata.brain_version='v2'), AgentService.plan_message
    # routes to the lean hand-rolled tool-calling loop instead of the v1
    # 6-route orchestrator. Same HTTP contract, schema, Redis store.
    # ------------------------------------------------------------------
    agent_v2_enabled: bool = Field(default=False, alias='AGENT_V2_ENABLED')
    # Single knob for the v2 loop's model id. The whole loop runs on ONE
    # model (no separate classifier). Set to whatever GPT-5 variant the org
    # exposes (e.g. 'gpt-5', 'gpt-5.4').
    openai_model_v2: str = Field(default='gpt-5.4-mini', alias='OPENAI_MODEL_V2')
    agent_v2_max_turns: int = Field(default=8, alias='AGENT_V2_MAX_TURNS')
    agent_v2_max_tool_calls: int = Field(default=14, alias='AGENT_V2_MAX_TOOL_CALLS')
    openai_v2_max_output_tokens: int | None = Field(
        default=4000,
        alias='OPENAI_V2_MAX_OUTPUT_TOKENS',
    )
    openai_v2_reasoning_effort: str | None = Field(
        default='low',
        alias='OPENAI_V2_REASONING_EFFORT',
    )
    # GPT-5 reasoning models reject non-default temperature on chat
    # completions, so v2 omits it by default (None → not sent). Set a float
    # only if the configured model accepts it.
    openai_v2_temperature: float | None = Field(
        default=None,
        alias='OPENAI_V2_TEMPERATURE',
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

    @field_validator('openai_reasoning_effort')
    @classmethod
    def normalize_openai_reasoning_effort(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip().lower()
        if not normalized:
            return None
        if normalized not in {'low', 'medium', 'high'}:
            return 'low'
        return normalized

    @field_validator('openai_chat_max_tokens')
    @classmethod
    def normalize_openai_chat_max_tokens(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value < 64:
            return 64
        if value > 8192:
            return 8192
        return value

    @field_validator('openai_edit_default_max_tokens')
    @classmethod
    def normalize_openai_edit_default_max_tokens(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value < 64:
            return 64
        if value > 8192:
            return 8192
        return value

    @field_validator('openai_edit_repair_max_tokens')
    @classmethod
    def normalize_openai_edit_repair_max_tokens(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value < 64:
            return 64
        if value > 8192:
            return 8192
        return value

    @field_validator('openai_edit_narrow_max_tokens')
    @classmethod
    def normalize_openai_edit_narrow_max_tokens(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value < 64:
            return 64
        if value > 8192:
            return 8192
        return value

    @field_validator('openai_plan_max_tokens')
    @classmethod
    def normalize_openai_plan_max_tokens(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value < 256:
            return 256
        if value > 8192:
            return 8192
        return value

    @field_validator('openai_classifier_max_tokens')
    @classmethod
    def normalize_openai_classifier_max_tokens(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value < 32:
            return 32
        if value > 512:
            return 512
        return value

    @field_validator('openai_classifier_temperature')
    @classmethod
    def normalize_openai_classifier_temperature(cls, value: float) -> float:
        if value < 0.0:
            return 0.0
        if value > 1.0:
            return 1.0
        return value

    @field_validator('agent_edit_planner_repair_retries')
    @classmethod
    def normalize_agent_edit_planner_repair_retries(cls, value: int) -> int:
        if value < 0:
            return 0
        if value > 3:
            return 3
        return value

    @field_validator('agent_edit_planner_max_attempts')
    @classmethod
    def normalize_agent_edit_planner_max_attempts(cls, value: int) -> int:
        if value < 1:
            return 1
        if value > 4:
            return 4
        return value

    @field_validator('agent_max_total_llm_calls_per_message')
    @classmethod
    def normalize_agent_max_total_llm_calls_per_message(cls, value: int) -> int:
        if value < 1:
            return 1
        if value > 16:
            return 16
        return value

    @field_validator('max_edit_history_messages')
    @classmethod
    def normalize_max_edit_history_messages(cls, value: int) -> int:
        if value < 0:
            return 0
        if value > 16:
            return 16
        return value

    @field_validator('agent_resolve_cache_ttl_seconds')
    @classmethod
    def normalize_agent_resolve_cache_ttl_seconds(cls, value: int) -> int:
        if value < 0:
            return 0
        if value > 300:
            return 300
        return value

    @property
    def agent_react_repair_retries(self) -> int:
        return self.agent_edit_planner_repair_retries

    @property
    def agent_react_max_attempts(self) -> int:
        return self.agent_edit_planner_max_attempts


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reload_settings() -> Settings:
    get_settings.cache_clear()
    return get_settings()

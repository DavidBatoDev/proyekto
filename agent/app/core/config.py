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
    openai_model: str = Field(default='gpt-5.3-mini', alias='OPENAI_MODEL')
    openai_temperature: float = Field(default=0.2, alias='OPENAI_TEMPERATURE')
    openai_reasoning_effort: str | None = Field(
        default='low',
        alias='OPENAI_REASONING_EFFORT',
    )
    openai_max_tokens: int | None = Field(default=None, alias='OPENAI_MAX_TOKENS')
    openai_planner_max_tokens: int | None = Field(
        default=1200,
        alias='OPENAI_PLANNER_MAX_TOKENS',
    )
    openai_planner_retry_max_tokens: int | None = Field(
        default=2000,
        alias='OPENAI_PLANNER_RETRY_MAX_TOKENS',
    )
    openai_simple_edit_max_tokens: int | None = Field(
        default=320,
        alias='OPENAI_SIMPLE_EDIT_MAX_TOKENS',
    )

    session_ttl_seconds: int = Field(default=1800, alias='SESSION_TTL_SECONDS')
    upstash_redis_rest_url: str | None = Field(default=None, alias='UPSTASH_REDIS_REST_URL')
    upstash_redis_rest_token: str | None = Field(default=None, alias='UPSTASH_REDIS_REST_TOKEN')
    redis_session_key_prefix: str = Field(default='roadmap:ai:session', alias='REDIS_SESSION_KEY_PREFIX')
    max_operations_per_request: int = Field(default=25, alias='MAX_OPERATIONS_PER_REQUEST')
    max_chat_history_messages: int = Field(default=8, alias='MAX_CHAT_HISTORY_MESSAGES')
    max_edit_history_messages: int = Field(default=4, alias='MAX_EDIT_HISTORY_MESSAGES')
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
    agent_llm_first_mode_enabled: bool = Field(
        default=True,
        alias='AGENT_LLM_FIRST_MODE_ENABLED',
    )
    agent_edit_assignee_autofix_enabled: bool = Field(
        default=True,
        alias='AGENT_EDIT_ASSIGNEE_AUTOFIX_ENABLED',
    )
    agent_edit_actionable_failure_clarifier_enabled: bool = Field(
        default=False,
        alias='AGENT_EDIT_ACTIONABLE_FAILURE_CLARIFIER_ENABLED',
    )
    agent_draft_graph_enabled: bool = Field(
        default=False,
        alias='AGENT_DRAFT_GRAPH_ENABLED',
    )
    agent_async_auto_commit_enabled: bool = Field(
        default=False,
        alias='AGENT_ASYNC_AUTO_COMMIT_ENABLED',
    )
    agent_simple_edit_planner_profile_enabled: bool = Field(
        default=False,
        alias='AGENT_SIMPLE_EDIT_PLANNER_PROFILE_ENABLED',
    )
    # Keep disabled by default to preserve hybrid behavior; enable for strict planner authority.
    agent_strict_mutation_authority_enabled: bool = Field(
        default=False,
        alias='AGENT_STRICT_MUTATION_AUTHORITY_ENABLED',
    )
    agent_strict_preview_fingerprint: bool = Field(
        default=True,
        alias='AGENT_STRICT_PREVIEW_FINGERPRINT',
    )
    inline_preview_max_bytes: int = Field(
        default=262144,
        alias='INLINE_PREVIEW_MAX_BYTES',
    )

    agent_log_level: str = Field(default='DEBUG', alias='AGENT_LOG_LEVEL')
    agent_log_json: bool = Field(default=True, alias='AGENT_LOG_JSON')
    agent_log_color: str = Field(default='auto', alias='AGENT_LOG_COLOR')
    agent_log_include_content: bool = Field(default=False, alias='AGENT_LOG_INCLUDE_CONTENT')
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
        default=False,
        alias='AGENT_RESOLVE_PARALLEL_VARIANTS_ENABLED',
    )

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

    @field_validator('openai_max_tokens')
    @classmethod
    def normalize_openai_max_tokens(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value < 64:
            return 64
        if value > 4096:
            return 4096
        return value

    @field_validator('openai_planner_max_tokens')
    @classmethod
    def normalize_openai_planner_max_tokens(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value < 64:
            return 64
        if value > 4096:
            return 4096
        return value

    @field_validator('openai_planner_retry_max_tokens')
    @classmethod
    def normalize_openai_planner_retry_max_tokens(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value < 64:
            return 64
        if value > 4096:
            return 4096
        return value

    @field_validator('openai_simple_edit_max_tokens')
    @classmethod
    def normalize_openai_simple_edit_max_tokens(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value < 64:
            return 64
        if value > 4096:
            return 4096
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

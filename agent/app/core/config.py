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
    openai_model: str = Field(default='gpt-5.3-mini', alias='OPENAI_MODEL')
    openai_temperature: float = Field(default=0.2, alias='OPENAI_TEMPERATURE')

    session_ttl_seconds: int = Field(default=1800, alias='SESSION_TTL_SECONDS')
    upstash_redis_rest_url: str | None = Field(default=None, alias='UPSTASH_REDIS_REST_URL')
    upstash_redis_rest_token: str | None = Field(default=None, alias='UPSTASH_REDIS_REST_TOKEN')
    redis_session_key_prefix: str = Field(default='roadmap:ai:session', alias='REDIS_SESSION_KEY_PREFIX')
    max_operations_per_request: int = Field(default=25, alias='MAX_OPERATIONS_PER_REQUEST')
    max_chat_history_messages: int = Field(default=8, alias='MAX_CHAT_HISTORY_MESSAGES')
    max_edit_tool_turns: int = Field(default=6, alias='MAX_EDIT_TOOL_TURNS')
    max_context_tool_turns: int = Field(default=4, alias='MAX_CONTEXT_TOOL_TURNS')
    max_discovery_tool_calls: int = Field(default=4, alias='MAX_DISCOVERY_TOOL_CALLS')
    max_repeated_tool_calls_per_signature: int = Field(
        default=2,
        alias='MAX_REPEATED_TOOL_CALLS_PER_SIGNATURE',
    )
    deterministic_fastpath_search_sla_ms: int = Field(
        default=2000,
        alias='DETERMINISTIC_FASTPATH_SEARCH_SLA_MS',
    )
    inline_preview_max_bytes: int = Field(
        default=262144,
        alias='INLINE_PREVIEW_MAX_BYTES',
    )

    agent_log_level: str = Field(default='DEBUG', alias='AGENT_LOG_LEVEL')
    agent_log_json: bool = Field(default=True, alias='AGENT_LOG_JSON')
    agent_log_include_content: bool = Field(default=False, alias='AGENT_LOG_INCLUDE_CONTENT')
    agent_cache_ttl_seconds: int = Field(default=600, alias='AGENT_CACHE_TTL_SECONDS')

    @field_validator('nest_api_base_url')
    @classmethod
    def normalize_nest_api_base_url(cls, value: str) -> str:
        normalized = value.rstrip('/')
        if normalized.endswith('/api'):
            return normalized
        return f'{normalized}/api'


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reload_settings() -> Settings:
    get_settings.cache_clear()
    return get_settings()

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
    openai_model: str = Field(default='gpt-5-mini', alias='OPENAI_MODEL')
    openai_temperature: float = Field(default=0.2, alias='OPENAI_TEMPERATURE')
    gemini_api_key: str | None = Field(default=None, alias='GEMINI_API_KEY')
    gemini_model: str = Field(default='gemini-2.5-flash', alias='GEMINI_MODEL')
    gemini_temperature: float = Field(default=0.2, alias='GEMINI_TEMPERATURE')
    gemini_max_retries: int = Field(default=0, alias='GEMINI_MAX_RETRIES')

    llm_primary_provider: str = Field(default='gemini', alias='LLM_PRIMARY_PROVIDER')
    llm_fallback_provider: str = Field(default='openai', alias='LLM_FALLBACK_PROVIDER')

    session_ttl_seconds: int = Field(default=1800, alias='SESSION_TTL_SECONDS')
    max_operations_per_request: int = Field(default=25, alias='MAX_OPERATIONS_PER_REQUEST')
    max_chat_history_messages: int = Field(default=8, alias='MAX_CHAT_HISTORY_MESSAGES')
    max_edit_tool_turns: int = Field(default=6, alias='MAX_EDIT_TOOL_TURNS')
    max_context_tool_turns: int = Field(default=4, alias='MAX_CONTEXT_TOOL_TURNS')

    agent_log_level: str = Field(default='DEBUG', alias='AGENT_LOG_LEVEL')
    agent_log_json: bool = Field(default=True, alias='AGENT_LOG_JSON')
    agent_log_include_content: bool = Field(default=False, alias='AGENT_LOG_INCLUDE_CONTENT')
    agent_low_quota_mode: bool = Field(default=False, alias='AGENT_LOW_QUOTA_MODE')
    agent_quota_daily_limit: int = Field(default=0, alias='AGENT_QUOTA_DAILY_LIMIT')
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

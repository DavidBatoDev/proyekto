from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    app_name: str = 'Roadmap AI Agent'
    app_env: str = 'development'
    app_host: str = '0.0.0.0'
    app_port: int = 8010

    nest_api_base_url: str = 'http://localhost:8001/api'
    nest_timeout_seconds: float = 20.0

    openai_api_key: str | None = None
    openai_model: str = 'gpt-5-mini'
    openai_temperature: float = 0.2

    session_ttl_seconds: int = 1800
    max_operations_per_request: int = 25
    max_chat_history_messages: int = 8

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

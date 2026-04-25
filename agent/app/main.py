import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.sessions import router as sessions_router
from app.api.routes.sessions_support.runtime import configure_runtime_resolver
from app.core.config import get_settings
from app.core.logging_utils import configure_logging
from app.core.orchestration.agent_service import AgentService
from app.core.session_store import SessionStore

settings = get_settings()
configure_logging(settings)
app = FastAPI(title=settings.app_name)

_cors_origins_raw = os.environ.get(
    'AGENT_CORS_ORIGINS',
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173',
)
_allow_origins = [o.strip() for o in _cors_origins_raw.split(',') if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions_router)


def _resolve_agent_runtime() -> tuple[SessionStore, AgentService]:
    runtime = getattr(app.state, 'agent_runtime', None)
    if runtime is not None:
        return runtime

    store = SessionStore()
    service = AgentService(store)
    runtime = (store, service)
    app.state.agent_runtime = runtime
    return runtime


configure_runtime_resolver(_resolve_agent_runtime)


@app.get('/')
def root() -> dict[str, str]:
    return {'status': 'ok', 'env': settings.app_env}

@app.get('/health')
def health() -> dict[str, str]:
    return {'status': 'ok', 'env': settings.app_env}

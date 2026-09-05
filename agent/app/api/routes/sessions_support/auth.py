"""Forwarded-auth resolution for the agent session routes.

The web calls the agent directly and attaches either the user's Supabase
bearer or the guest id; the agent never authorizes anything itself — it
forwards that value on every NestJS call so the backend decides per request.
The only agent-side identity decision is session OWNERSHIP: a session stores
the ``owner_key`` its creator's auth identified (the actor id, or
``Guest <id>``) and every later message/continue/cancel/trace read must come
from the same caller (see ``runtime.service.caller_matches_owner``).
"""

from __future__ import annotations

from fastapi import HTTPException, Request

from app.core.runtime.service import (  # noqa: F401 — re-exports
    caller_matches_owner,
    owner_key_from_auth,
)


def resolve_forward_auth(request: Request) -> str | None:
    """Composite auth value to forward to NestJS: the raw bearer when the
    caller is authenticated, otherwise the guest session id encoded as
    'Guest <id>' (translated back to the X-Guest-User-Id header by
    NestRoadmapClient's outbound header builders). Returns None when the
    request carries neither."""
    auth = request.headers.get('Authorization')
    if auth:
        return auth
    guest = request.headers.get('X-Guest-User-Id')
    if guest:
        return f'Guest {guest}'
    return None


def require_forward_auth(request: Request) -> str:
    """``resolve_forward_auth`` or 401 ``AUTH_REQUIRED``."""
    auth = resolve_forward_auth(request)
    if not auth:
        raise HTTPException(
            status_code=401,
            detail={
                'code': 'AUTH_REQUIRED',
                'message': 'Authentication is required (bearer token or guest id).',
            },
        )
    return auth

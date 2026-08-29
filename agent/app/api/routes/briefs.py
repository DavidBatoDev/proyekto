"""The project-brief generator endpoint.

Unlike the session routes, this one is NOT called from the browser. The web app
posts to the NestJS backend, which validates the caller's Supabase session and
forwards here with a shared secret. The asymmetry is deliberate: every other
agent endpoint ends up at NestJS for the data it touches, so authorization is
enforced there anyway. This one touches no data — it just spends OpenAI credits
— which would make an unauthenticated route a metered open proxy.
"""

import logging

from fastapi import APIRouter, Header, HTTPException, Request

from app.core.briefs.generator import generate_brief
from app.core.config import get_settings
from app.core.contracts.briefs import GenerateBriefRequest, GenerateBriefResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/briefs', tags=['briefs'])


def _authorize(settings, provided: str | None) -> None:
    expected = settings.agent_internal_token
    if expected:
        if not provided or provided != expected:
            raise HTTPException(status_code=401, detail='invalid internal token')
        return

    # No secret configured. Fine on a developer machine, never in a deployed
    # environment: failing closed here is what stops a misconfigured deploy
    # from quietly exposing the generator.
    if settings.app_env != 'development':
        logger.error(
            'briefs.generate blocked: AGENT_INTERNAL_TOKEN is unset in %s',
            settings.app_env,
        )
        raise HTTPException(status_code=503, detail='generator not configured')


@router.post('/generate', response_model=GenerateBriefResponse)
async def generate(
    payload: GenerateBriefRequest,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias='X-Internal-Token'),
) -> GenerateBriefResponse:
    settings = get_settings()
    _authorize(settings, x_internal_token)

    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail='openai key not configured')

    client = getattr(request.app.state, 'brief_client', None)
    if client is None:
        try:
            from openai import OpenAI
        except Exception as exc:  # pragma: no cover - import guard
            logger.exception('openai sdk unavailable')
            raise HTTPException(status_code=503, detail='openai sdk unavailable') from exc
        client = OpenAI(api_key=settings.openai_api_key, timeout=60)
        request.app.state.brief_client = client

    try:
        return generate_brief(
            payload,
            client=client,
            model=settings.agent_brief_model or settings.openai_model_v2,
            max_output_tokens=settings.agent_brief_max_output_tokens,
        )
    except ValueError as exc:
        # A bad draft is not a server fault the caller can retry into a
        # different answer, but it IS worth one retry from the UI, so 502.
        logger.warning('brief generation produced an unusable draft: %s', exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

"""Shared fakes for the run-machine tests: an in-memory session store (with
the run lock / side keys), a scripted NestJS client and a scripted LLM
client that stands in for ``LLMClient`` in every phase module."""

from __future__ import annotations

import contextlib
import json
import logging
from typing import Any
from uuid import uuid4

from fastapi.exceptions import HTTPException

from app.core.config import get_settings
from app.core.contracts.sessions import AgentSession, Message
from app.core.engine.llm_client import LLMResponse, ToolCall
from app.core.runtime.phases import execute as execute_mod
from app.core.runtime.phases import investigate as investigate_mod
from app.core.runtime.phases import verify as verify_mod
from app.core.runtime.service import RuntimeService

LOGGER = logging.getLogger('runtime-fakes')

ALPHA = '11111111-1111-1111-1111-111111111111'
BETA = '22222222-2222-2222-2222-222222222222'
WORKSPACE = '33333333-3333-3333-3333-333333333333'
USER = '44444444-4444-4444-4444-444444444444'
ALPHA_EPIC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
ALPHA_FEATURE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
BETA_EPIC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
AUTH = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0NDQ0NDQ0NC00NDQ0LTQ0NDQtNDQ0NC00NDQ0NDQ0NDQ0NDQifQ.sig'
OTHER_AUTH = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI5OTk5OTk5OS05OTk5LTQ5OTktODk5OS05OTk5OTk5OTk5OTkifQ.sig'


def settings_with(**updates: Any) -> Any:
    base = {
        'openai_v2_streaming_enabled': False,
        'openai_v2_reasoning_summary_enabled': False,
        'agent_project_context_enabled': False,
        'agent_knowledge_search_enabled': False,
        'agent_realtime_trace_push_enabled': False,
        'agent_memory_semantic_threshold': 100,
        'nest_timeout_seconds': 1.0,
        'openai_model_timeout_seconds': 5.0,
        'agent_run_step_budget_seconds': 60.0,
        'agent_run_hard_deadline_seconds': 120.0,
    }
    base.update(updates)
    return get_settings().model_copy(update=base)


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------


class MemoryStore:
    def __init__(self) -> None:
        self.docs: dict[str, str] = {}
        self.locks: dict[str, str] = {}
        self.side: dict[str, str] = {}
        self.update_calls = 0
        self.lock_events: list[str] = []
        self.key_prefix = 'test:ai:session'
        self.redis = None

    # -- sessions ------------------------------------------------------------
    def create(self, session: AgentSession) -> AgentSession:
        self.docs[session.session_id] = session.model_dump_json()
        return session

    def get(self, session_id: str) -> AgentSession | None:
        raw = self.docs.get(session_id)
        if raw is None:
            return None
        return AgentSession.model_validate_json(raw)

    def update(self, session: AgentSession) -> AgentSession:
        self.update_calls += 1
        self.docs[session.session_id] = session.model_dump_json()
        return session

    def save_cas(self, session: AgentSession) -> AgentSession:
        return self.update(session)

    def append_message(self, session, role, content, *, tool_calls=None, tool_call_id=None):
        session.messages.append(
            Message(role=role, content=content, tool_calls=tool_calls, tool_call_id=tool_call_id)
        )
        return self.update(session)

    # -- summarizer side channel ---------------------------------------------
    def get_summary_candidate(self, session_id: str):
        return None

    def delete_summary_candidate(self, session_id: str) -> None:
        return None

    def set_summary_candidate(self, session_id: str, payload: dict) -> None:
        return None

    # -- side keys / locks ---------------------------------------------------
    def side_key(self, session_id: str, *parts: str) -> str:
        return ':'.join([f'{self.key_prefix}:{session_id}', *parts])

    def run_key(self, session_id: str, run_id: str, suffix: str) -> str:
        return self.side_key(session_id, 'run', run_id, suffix)

    def run_lock_key(self, session_id: str) -> str:
        return self.side_key(session_id, 'run_lock')

    def put_side_key(self, key: str, payload: Any, ttl_seconds: int) -> None:
        self.side[key] = json.dumps(payload)

    def get_side_key(self, key: str) -> Any | None:
        raw = self.side.get(key)
        return json.loads(raw) if raw is not None else None

    def delete_side_key(self, key: str) -> None:
        self.side.pop(key, None)

    def exists(self, key: str) -> bool:
        return key in self.side or key in self.locks

    def acquire_run_lock(self, session_id: str, ttl_seconds: int) -> str | None:
        key = self.run_lock_key(session_id)
        if key in self.locks:
            self.lock_events.append('held')
            return None
        token = uuid4().hex
        self.locks[key] = token
        self.lock_events.append('acquired')
        return token

    def release_run_lock(self, session_id: str, token: str | None) -> bool:
        key = self.run_lock_key(session_id)
        if token and self.locks.get(key) == token:
            del self.locks[key]
            self.lock_events.append('released')
            return True
        return False

    def hold_lock(self, session_id: str) -> None:
        self.locks[self.run_lock_key(session_id)] = 'foreign'


# ---------------------------------------------------------------------------
# NestJS client
# ---------------------------------------------------------------------------


def roadmap_summary(roadmap_id: str, title: str, *, token: str = 'tok-1', epics: list[dict] | None = None) -> dict:
    epics = epics if epics is not None else [
        {
            'id': ALPHA_EPIC if roadmap_id == ALPHA else BETA_EPIC,
            'title': f'{title} epic',
            'feature_count': 1,
            'features': [{'id': ALPHA_FEATURE if roadmap_id == ALPHA else f'{roadmap_id[:8]}-feat', 'title': f'{title} feature'}],
        }
    ]
    return {
        'roadmap_id': roadmap_id,
        'title': title,
        'status': 'active',
        'revision_token': token,
        'epic_count': len(epics),
        'epics': epics,
        'project': {'id': f'project-{title.lower()}', 'workspace_id': WORKSPACE},
    }


def _nest_error(status: int, code: str, message: str = '') -> HTTPException:
    return HTTPException(
        status_code=status,
        detail={'upstream': 'nestjs', 'detail': {'statusCode': status, 'code': code, 'message': message or code}},
    )


class FakeNest:
    def __init__(self, roadmaps: dict[str, dict] | None = None) -> None:
        self.roadmaps: dict[str, dict] = roadmaps if roadmaps is not None else {
            ALPHA: roadmap_summary(ALPHA, 'Alpha'),
            BETA: roadmap_summary(BETA, 'Beta'),
        }
        self.actor = {'actor_id': USER, 'display_name': 'Ana', 'roadmap_role': 'owner'}
        self.actor_error: HTTPException | None = None
        self.workspace_error: HTTPException | None = None
        self.commit_calls: list[dict[str, Any]] = []
        self.commit_errors: list[HTTPException | None] = []
        self.commit_hook = None
        self.preview_calls: list[dict[str, Any]] = []
        self.preview_results: list[dict[str, Any] | HTTPException] = []
        self.summary_calls: list[str] = []
        self.changes_rows: list[dict[str, Any]] = []
        self.changes_calls: list[dict[str, Any]] = []
        self.resolve_calls: list[list[dict[str, Any]]] = []
        self.resolved: dict[tuple[str, str], dict[str, Any]] = {}
        self.snapshot_puts: list[tuple[str, str]] = []
        self.commit_counter = 0

    async def context_actor(self, *, roadmap_id, auth_header, trace_id=None):
        if self.actor_error is not None:
            raise self.actor_error
        if roadmap_id not in self.roadmaps:
            raise _nest_error(404, 'NOT_FOUND', 'Roadmap not found')
        return dict(self.actor)

    async def ai_context_actor(self, auth_header, trace_id=None):
        if self.actor_error is not None:
            raise self.actor_error
        return {'actor_id': self.actor['actor_id'], 'display_name': self.actor['display_name']}

    async def workspace_get(self, workspace_id, auth_header, trace_id=None):
        if self.workspace_error is not None:
            raise self.workspace_error
        return {'id': workspace_id, 'name': 'Acme'}

    async def context_summary(self, *, roadmap_id, preview_id, auth_header, trace_id=None):
        self.summary_calls.append(roadmap_id)
        payload = self.roadmaps.get(roadmap_id)
        if payload is None:
            raise _nest_error(404, 'NOT_FOUND', 'Roadmap not found')
        return json.loads(json.dumps(payload))

    async def ai_memories_list(self, *, roadmap_id, auth_header, trace_id=None):
        return {'memories': []}

    async def context_features(self, *, roadmap_id, auth_header=None, trace_id=None, **kwargs):
        payload = self.roadmaps.get(roadmap_id) or {}
        features = [
            {'id': feature['id'], 'title': feature['title'], 'epic_id': epic['id'], 'status': 'planned'}
            for epic in payload.get('epics') or []
            for feature in epic.get('features') or []
        ]
        return {'roadmap_id': roadmap_id, 'features': features}

    async def context_search(self, *, roadmap_id, query, limit=None, auth_header=None, trace_id=None, **kwargs):
        payload = self.roadmaps.get(roadmap_id) or {}
        matches = [
            {'id': epic['id'], 'type': 'epic', 'title': epic['title'], 'confidence': 0.9}
            for epic in payload.get('epics') or []
        ]
        return {'query': query, 'matches': matches}

    async def ai_memories_relevant(self, **kwargs):
        return {'memories': []}

    async def context_project(self, *, roadmap_id, auth_header, trace_id=None):
        return {'project': None}

    async def ai_context_overview(self, workspace_id, auth_header, trace_id=None):
        return {
            'workspace': {'id': workspace_id, 'name': 'Acme'},
            'projects': [{'id': 'project-alpha', 'title': 'Alpha app', 'lane': 'current'}],
            'roadmaps': [
                {'id': rid, 'name': payload['title'], 'project_id': f'project-{payload["title"].lower()}', 'lane': 'current'}
                for rid, payload in self.roadmaps.items()
            ],
            'teams': [],
        }

    async def resolve_refs(self, refs, auth_header, trace_id=None):
        self.resolve_calls.append(list(refs))
        out = []
        for ref in refs:
            key = (ref['kind'], ref['id'])
            entry = self.resolved.get(key)
            if entry is None:
                if ref['kind'] == 'roadmap' and ref['id'] in self.roadmaps:
                    entry = {'accessible': True, 'title': self.roadmaps[ref['id']]['title']}
                else:
                    entry = {'accessible': False, 'error_code': 'NOT_FOUND'}
            out.append({'kind': ref['kind'], 'id': ref['id'], **entry})
        return {'refs': out}

    async def ai_context_changes(self, auth_header, trace_id=None, *, run_id=None, session_id=None, limit=None):
        self.changes_calls.append({'run_id': run_id, 'session_id': session_id})
        return {'changes': list(self.changes_rows)}

    async def put_session_agent_state(self, *, roadmap_id, session_id, payload, auth_header, trace_id=None):
        self.snapshot_puts.append(('roadmap', roadmap_id))
        return {}

    async def put_workspace_session_agent_state(self, *, workspace_id, session_id, payload, auth_header, trace_id=None):
        self.snapshot_puts.append(('workspace', workspace_id))
        return {}

    async def preview(self, roadmap_id, payload, auth_header, trace_id=None):
        self.preview_calls.append({'roadmap_id': roadmap_id, 'payload': payload})
        if self.preview_results:
            result = self.preview_results.pop(0)
            if isinstance(result, HTTPException):
                raise result
            return result
        return {'preview_id': 'prev-1', 'revision_token': payload.get('revision_token'), 'validation_issues': []}

    async def commit(self, roadmap_id, payload, auth_header, trace_id=None, *, session_id=None, run_id=None):
        self.commit_calls.append(
            {'roadmap_id': roadmap_id, 'payload': dict(payload), 'session_id': session_id, 'run_id': run_id}
        )
        if self.commit_hook is not None:
            self.commit_hook(self, roadmap_id, payload)
        if self.commit_errors:
            error = self.commit_errors.pop(0)
            if error is not None:
                raise error
        self.commit_counter += 1
        changes = []
        for op in payload.get('operations') or []:
            name = op.get('op')
            if name in {'add_epic', 'add_feature', 'add_task', 'add_milestone'}:
                node_type = name[4:]
                changes.append(
                    {
                        'type': 'NODE_ADDED',
                        'node': {'id': str(uuid4()), 'type': node_type, 'title': (op.get('data') or {}).get('title')},
                    }
                )
            elif name == 'delete_node':
                changes.append(
                    {
                        'type': 'NODE_REMOVED',
                        'node': {'id': op.get('node_id'), 'type': op.get('node_type') or 'epic', 'title': None},
                    }
                )
            else:
                changes.append(
                    {
                        'type': 'FIELD_CHANGED',
                        'node': {'id': op.get('node_id'), 'type': op.get('node_type') or 'epic', 'title': None},
                    }
                )
        summary = {
            'NODE_ADDED': sum(1 for c in changes if c['type'] == 'NODE_ADDED'),
            'NODE_REMOVED': sum(1 for c in changes if c['type'] == 'NODE_REMOVED'),
        }
        token = f'tok-after-{self.commit_counter}'
        if roadmap_id in self.roadmaps:
            self.roadmaps[roadmap_id]['revision_token'] = token
        return {
            'change_id': str(uuid4()),
            'revision_token': token,
            'semantic_diff': {'summary': summary, 'changes': changes},
            'history_recorded': True,
        }


# ---------------------------------------------------------------------------
# LLM
# ---------------------------------------------------------------------------


def tool_resp(name: str, args: dict[str, Any], content: str | None = None, call_id: str | None = None) -> LLMResponse:
    return LLMResponse(
        content=content,
        tool_calls=[
            ToolCall(
                id=call_id or f'call_{name}_{uuid4().hex[:6]}',
                name=name,
                arguments=args,
                raw_arguments=json.dumps(args),
            )
        ],
    )


def multi_tool_resp(*calls: tuple[str, dict[str, Any]]) -> LLMResponse:
    return LLMResponse(
        content=None,
        tool_calls=[
            ToolCall(id=f'call_{index}_{name}', name=name, arguments=args, raw_arguments=json.dumps(args))
            for index, (name, args) in enumerate(calls)
        ],
    )


def text_resp(text: str) -> LLMResponse:
    return LLMResponse(content=text, tool_calls=[])


class ProviderDown(RuntimeError):
    pass


class FakeLLM:
    """Scripted stand-in for LLMClient: every phase's client pops from one
    shared queue. Queue an exception instance to simulate a provider failure."""

    script: list[Any] = []
    calls: list[dict[str, Any]] = []
    instances: list['FakeLLM'] = []

    def __init__(self, settings, model=None, prompt_cache_key=None):
        self.prompt_cache_key = prompt_cache_key
        self.model = model
        FakeLLM.instances.append(self)

    def complete(self, messages, tools, **kwargs):
        if not FakeLLM.script:
            raise AssertionError('FakeLLM script exhausted')
        item = FakeLLM.script.pop(0)
        if callable(item) and not isinstance(item, Exception):
            item = item()
        FakeLLM.calls.append(
            {
                'messages': [dict(m) for m in messages],
                'tools': [t['function']['name'] for t in tools],
                'kwargs': dict(kwargs),
                'prompt_cache_key': self.prompt_cache_key,
            }
        )
        if isinstance(item, Exception):
            raise item
        return item

    @classmethod
    def reset(cls, script: list[Any] | None = None) -> None:
        cls.script = list(script or [])
        cls.calls = []
        cls.instances = []


@contextlib.contextmanager
def patched_llm(script: list[Any] | None = None):
    FakeLLM.reset(script)
    originals = (investigate_mod.LLMClient, execute_mod.LLMClient, verify_mod.LLMClient)
    investigate_mod.LLMClient = FakeLLM
    execute_mod.LLMClient = FakeLLM
    verify_mod.LLMClient = FakeLLM
    try:
        yield FakeLLM
    finally:
        investigate_mod.LLMClient, execute_mod.LLMClient, verify_mod.LLMClient = originals


# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------


def make_service(store: MemoryStore | None = None, nest: FakeNest | None = None, settings: Any = None) -> RuntimeService:
    return RuntimeService(
        store or MemoryStore(),
        settings=settings or settings_with(),
        nest_client=nest or FakeNest(),
        logger=LOGGER,
    )


def roadmap_session(session_id: str = 'sess-alpha', *, owner_key: str = USER) -> AgentSession:
    return AgentSession(session_id=session_id, roadmap_id=ALPHA, owner_key=owner_key)


def workspace_session(session_id: str = 'sess-ws', *, owner_key: str = USER) -> AgentSession:
    return AgentSession(
        session_id=session_id,
        scope={'kind': 'workspace', 'workspace_id': WORKSPACE},
        owner_key=owner_key,
    )


def add_epics(count: int, prefix: str = 'Epic') -> list[dict[str, Any]]:
    return [{'op': 'add_epic', 'data': {'title': f'{prefix} {index + 1}'}} for index in range(count)]


def stage_args(operations: list[dict[str, Any]], *, roadmap_id: str | None = None, message: str = 'Staged.') -> dict[str, Any]:
    args: dict[str, Any] = {'assistant_message': message, 'operations': operations}
    if roadmap_id:
        args['roadmap_id'] = roadmap_id
    return args

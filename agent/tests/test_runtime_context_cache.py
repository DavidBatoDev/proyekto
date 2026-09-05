"""Per-roadmap context caches: focus roadmap bare, `R{n}` prefixes monotonic
and never reused, LRU that respects the focus set, overview invalidation, the
tool callback that registers a roadmap mid-loop, and the memory-notes /
project-context / workspace-overview loaders."""

from __future__ import annotations

import asyncio
import logging
import unittest
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.contracts.runs import RunState
from app.core.contracts.sessions import AgentSession
from app.core.runtime import context_cache

FOCUS = '11111111-1111-1111-1111-111111111111'
BETA = '22222222-2222-2222-2222-222222222222'
GAMMA = '33333333-3333-3333-3333-333333333333'
DELTA = '44444444-4444-4444-4444-444444444444'
_LOGGER = logging.getLogger('context-cache-tests')


def _summary(roadmap_id: str, title: str, *, token: str = 'tok-1', epics: int = 2) -> dict:
    return {
        'roadmap_id': roadmap_id,
        'title': title,
        'status': 'active',
        'revision_token': token,
        'epic_count': epics,
        'epics': [
            {
                'id': f'{roadmap_id[:8]}-epic-{index}',
                'title': f'{title} epic {index}',
                'feature_count': 1,
                'features': [{'id': f'{roadmap_id[:8]}-feat-{index}', 'title': f'Feature {index}'}],
            }
            for index in range(1, epics + 1)
        ],
        'project': {'id': f'project-{title.lower()}', 'workspace_id': 'ws-1'},
    }


class _Nest:
    def __init__(self):
        self.summaries: dict[str, dict] = {}
        self.errors: dict[str, Exception] = {}
        self.summary_calls: list[str] = []
        self.memory_calls: list[str] = []
        self.project_calls: list[str] = []
        self.overview_calls: list[str | None] = []
        self.memories = [{'id': 'm-1', 'content': 'Name epics by quarter', 'source': 'user_request'}]
        self.overview_payload = {'workspace': {'id': 'ws-1', 'name': 'Acme'}, 'projects': [], 'roadmaps': [], 'teams': []}

    async def context_summary(self, *, roadmap_id, preview_id, auth_header, trace_id=None):
        self.summary_calls.append(roadmap_id)
        if roadmap_id in self.errors:
            raise self.errors[roadmap_id]
        return self.summaries[roadmap_id]

    async def ai_memories_list(self, *, roadmap_id, auth_header, trace_id=None):
        self.memory_calls.append(roadmap_id)
        return {'memories': self.memories}

    async def context_project(self, *, roadmap_id, auth_header, trace_id=None):
        self.project_calls.append(roadmap_id)
        return {'project': {'id': f'project-of-{roadmap_id[:8]}', 'title': 'Apollo'}}

    async def ai_context_overview(self, workspace_id, auth_header, trace_id=None):
        self.overview_calls.append(workspace_id)
        return self.overview_payload


def _settings(**updates):
    return get_settings().model_copy(update={'agent_max_loaded_roadmaps': 6, 'agent_cache_ttl_seconds': 600, **updates})


def _deps(nest, **setting_updates):
    return dict(
        auth_header='Bearer t',
        trace_id='trace-1',
        settings=_settings(**setting_updates),
        nest_client=nest,
        logger=_LOGGER,
        run_async_call=asyncio.run,
    )


def _load(session, nest, roadmap_id, **kwargs):
    return context_cache.load_roadmap(session=session, roadmap_id=roadmap_id, **_deps(nest, **kwargs.pop('settings_updates', {})), **kwargs)


class LoadRoadmapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.nest = _Nest()
        for roadmap_id, title in ((FOCUS, 'Alpha'), (BETA, 'Beta'), (GAMMA, 'Gamma'), (DELTA, 'Delta')):
            self.nest.summaries[roadmap_id] = _summary(roadmap_id, title)
        self.session = AgentSession(roadmap_id=FOCUS)

    def test_focus_roadmap_keeps_bare_handles_and_mirrors_the_token(self) -> None:
        context = _load(self.session, self.nest, FOCUS)
        assert context is not None
        self.assertIsNone(context.handle_prefix)
        self.assertTrue(context.is_focus)
        self.assertEqual(set(context.handle_map), {'E1', 'E1.F1', 'E2', 'E2.F1'})
        self.assertEqual(context.handle_map['E1']['roadmap_id'], FOCUS)
        self.assertIn('E1. Alpha epic 1', context.overview_summary or '')
        self.assertEqual(context.title, 'Alpha')
        self.assertEqual(context.project_id, 'project-alpha')
        self.assertEqual(context.workspace_id, 'ws-1')
        self.assertEqual(context.revision_token, 'tok-1')
        self.assertEqual(self.session.revision_token, 'tok-1')
        self.assertTrue(context_cache.is_loaded(self.session, FOCUS))

    def test_non_focus_prefixes_are_monotonic_and_never_reused(self) -> None:
        beta = _load(self.session, self.nest, BETA)
        gamma = _load(self.session, self.nest, GAMMA)
        assert beta is not None and gamma is not None
        self.assertEqual(beta.handle_prefix, 'R1')
        self.assertEqual(gamma.handle_prefix, 'R2')
        self.assertEqual(set(beta.handle_map), {'R1.E1', 'R1.E1.F1', 'R1.E2', 'R1.E2.F1'})
        self.assertIn('R2.E1. Gamma epic 1', gamma.overview_summary or '')
        # The session's legacy token mirror is the FOCUS roadmap's only.
        self.assertIsNone(self.session.revision_token)
        # Drop beta and reload it: a fresh index, never R1 again.
        self.session.metadata.roadmaps.pop(BETA)
        reloaded = _load(self.session, self.nest, BETA)
        assert reloaded is not None
        self.assertEqual(reloaded.handle_prefix, 'R3')
        self.assertEqual(self.session.metadata.next_handle_prefix_index, 4)

    def test_a_loaded_roadmap_keeps_its_prefix_across_reloads(self) -> None:
        first = _load(self.session, self.nest, BETA)
        second = _load(self.session, self.nest, BETA, force=True)
        assert first is not None and second is not None
        self.assertEqual(first.handle_prefix, second.handle_prefix)
        self.assertEqual(self.nest.summary_calls, [BETA, BETA])

    def test_cached_outline_is_not_refetched(self) -> None:
        _load(self.session, self.nest, FOCUS)
        _load(self.session, self.nest, FOCUS)
        self.assertEqual(self.nest.summary_calls, [FOCUS])

    def test_inaccessible_roadmap_returns_none_without_registering(self) -> None:
        self.nest.errors[BETA] = HTTPException(status_code=404, detail='nope')
        self.assertIsNone(_load(self.session, self.nest, BETA))
        self.assertNotIn(BETA, self.session.metadata.roadmaps)
        self.nest.errors[GAMMA] = RuntimeError('boom')
        self.assertIsNone(_load(self.session, self.nest, GAMMA))
        self.assertEqual(self.session.metadata.next_handle_prefix_index, 1)

    def test_no_auth_returns_the_cached_context_or_none(self) -> None:
        self.assertIsNone(
            context_cache.load_roadmap(session=self.session, roadmap_id=BETA, **{**_deps(self.nest), 'auth_header': None})
        )
        self.assertEqual(self.nest.summary_calls, [])

    def test_lru_evicts_the_least_recently_used_but_never_the_focus_set(self) -> None:
        run = RunState(trace_id='t', scope=self.session.scope, focus_roadmap_ids=[FOCUS, BETA])
        _load(self.session, self.nest, FOCUS, run=run, settings_updates={'agent_max_loaded_roadmaps': 2})
        _load(self.session, self.nest, BETA, run=run, settings_updates={'agent_max_loaded_roadmaps': 2})
        _load(self.session, self.nest, GAMMA, run=run, settings_updates={'agent_max_loaded_roadmaps': 2})
        # Cap is 2 but focus + run focus set are protected -> gamma stays too
        # until something evictable exists.
        self.assertEqual(set(self.session.metadata.roadmaps), {FOCUS, BETA, GAMMA})
        gamma = self.session.metadata.roadmaps[GAMMA]
        gamma.last_used_at = gamma.last_used_at - timedelta(minutes=5)
        _load(self.session, self.nest, DELTA, run=run, settings_updates={'agent_max_loaded_roadmaps': 2})
        self.assertEqual(set(self.session.metadata.roadmaps), {FOCUS, BETA, DELTA})

    def test_touch_and_protected_ids(self) -> None:
        _load(self.session, self.nest, BETA)
        before = self.session.metadata.roadmaps[BETA].last_used_at
        self.session.metadata.roadmaps[BETA].last_used_at = before - timedelta(minutes=1)
        context_cache.touch(self.session, BETA)
        self.assertGreaterEqual(self.session.metadata.roadmaps[BETA].last_used_at, before)
        run = RunState(trace_id='t', scope=self.session.scope, focus_roadmap_ids=[GAMMA])
        self.assertEqual(context_cache.protected_roadmap_ids(self.session, run), {FOCUS, GAMMA})

    def test_invalidate_overview_keeps_prefix_and_title(self) -> None:
        _load(self.session, self.nest, BETA)
        context_cache.invalidate_overview(self.session, BETA)
        context = self.session.metadata.roadmaps[BETA]
        self.assertIsNone(context.overview_summary)
        self.assertIsNone(context.overview_fetched_at)
        self.assertEqual(context.handle_map, {})
        self.assertEqual(context.handle_prefix, 'R1')
        self.assertEqual(context.title, 'Beta')
        self.assertFalse(context_cache.is_loaded(self.session, BETA))
        reloaded = _load(self.session, self.nest, BETA)
        assert reloaded is not None
        self.assertEqual(reloaded.handle_prefix, 'R1')
        self.assertIn('R1.E1', reloaded.handle_map)

    def test_refresh_focus_for_run_loads_scope_and_run_focus_ids(self) -> None:
        run = RunState(trace_id='t', scope=self.session.scope, focus_roadmap_ids=[BETA])
        loaded = context_cache.refresh_focus_for_run(session=self.session, run=run, **_deps(self.nest))
        self.assertEqual([context.roadmap_id for context in loaded], [FOCUS, BETA])
        self.assertEqual(self.nest.summary_calls, [FOCUS, BETA])
        context_cache.invalidate_overview(self.session, FOCUS)
        context_cache.refresh_focus_for_run(session=self.session, run=run, **_deps(self.nest))
        self.assertEqual(self.nest.summary_calls, [FOCUS, BETA, FOCUS])


class OnRoadmapLoadedCallbackTests(unittest.TestCase):
    def test_callback_registers_prefixed_context_and_extends_the_focus_set(self) -> None:
        session = AgentSession(roadmap_id=FOCUS)
        run = RunState(trace_id='t', scope=session.scope, focus_roadmap_ids=[FOCUS])
        callback = context_cache.make_on_roadmap_loaded(session=session, run=run, settings=_settings(), logger=_LOGGER)
        loaded = callback(BETA, _summary(BETA, 'Beta'))
        assert loaded is not None
        self.assertEqual(loaded['handle_prefix'], 'R1')
        self.assertIn('R1.E1. Beta epic 1', loaded['outline'])
        self.assertEqual(run.focus_roadmap_ids, [FOCUS, BETA])
        self.assertEqual(session.metadata.roadmaps[BETA].handle_prefix, 'R1')
        # The focus roadmap registered through a tool read keeps bare handles.
        focus_loaded = callback(FOCUS, _summary(FOCUS, 'Alpha'))
        assert focus_loaded is not None
        self.assertIsNone(focus_loaded['handle_prefix'])
        self.assertIn('E1. Alpha epic 1', focus_loaded['outline'])

    def test_callback_ignores_bad_input(self) -> None:
        session = AgentSession(roadmap_id=FOCUS)
        callback = context_cache.make_on_roadmap_loaded(session=session)
        self.assertIsNone(callback('', {}))
        self.assertIsNone(callback(BETA, 'nope'))  # type: ignore[arg-type]
        self.assertEqual(session.metadata.roadmaps, {})


class MemoryNotesTests(unittest.TestCase):
    def test_focus_context_is_created_lazily_and_cached_by_ttl(self) -> None:
        nest = _Nest()
        session = AgentSession(roadmap_id=FOCUS)
        context_cache.ensure_memory_notes(session=session, **_deps(nest))
        context_cache.ensure_memory_notes(session=session, **_deps(nest))
        self.assertEqual(nest.memory_calls, [FOCUS])
        context = session.metadata.roadmaps[FOCUS]
        self.assertEqual(context.memory_notes[0]['content'], 'Name epics by quarter')
        self.assertIsNone(context.overview_fetched_at)
        context.memory_notes_fetched_at = context.memory_notes_fetched_at - timedelta(seconds=601)
        context_cache.ensure_memory_notes(session=session, **_deps(nest))
        self.assertEqual(nest.memory_calls, [FOCUS, FOCUS])

    def test_invalidate_one_or_all(self) -> None:
        nest = _Nest()
        session = AgentSession(roadmap_id=FOCUS)
        _load(session, nest if nest.summaries.update({BETA: _summary(BETA, 'Beta')}) is None else nest, BETA)
        context_cache.ensure_memory_notes(session=session, **_deps(nest))
        context_cache.ensure_memory_notes(session=session, roadmap_id=BETA, **_deps(nest))
        self.assertEqual(nest.memory_calls, [FOCUS, BETA])
        context_cache.invalidate_memory_notes(session, BETA)
        self.assertIsNone(session.metadata.roadmaps[BETA].memory_notes)
        self.assertIsNotNone(session.metadata.roadmaps[FOCUS].memory_notes)
        context_cache.invalidate_memory_notes(session)
        self.assertIsNone(session.metadata.roadmaps[FOCUS].memory_notes)

    def test_non_focus_roadmap_needs_a_loaded_context(self) -> None:
        nest = _Nest()
        session = AgentSession(roadmap_id=FOCUS)
        context_cache.ensure_memory_notes(session=session, roadmap_id=BETA, **_deps(nest))
        self.assertEqual(nest.memory_calls, [])

    def test_workspace_scope_without_roadmap_is_a_noop(self) -> None:
        nest = _Nest()
        session = AgentSession(scope={'kind': 'workspace', 'workspace_id': 'ws-1'})
        context_cache.ensure_memory_notes(session=session, **_deps(nest))
        self.assertEqual(nest.memory_calls, [])
        self.assertEqual(session.metadata.roadmaps, {})


class WorkspaceOverviewTests(unittest.TestCase):
    def test_roadmap_scope_never_fetches(self) -> None:
        nest = _Nest()
        session = AgentSession(roadmap_id=FOCUS)
        self.assertIsNone(context_cache.ensure_workspace_overview(session=session, **_deps(nest)))
        self.assertEqual(nest.overview_calls, [])

    def test_workspace_scope_caches_under_ttl(self) -> None:
        nest = _Nest()
        session = AgentSession(scope={'kind': 'workspace', 'workspace_id': 'ws-1'})
        payload = context_cache.ensure_workspace_overview(session=session, **_deps(nest))
        assert payload is not None
        self.assertEqual(payload['workspace']['name'], 'Acme')
        context_cache.ensure_workspace_overview(session=session, **_deps(nest))
        self.assertEqual(nest.overview_calls, ['ws-1'])
        session.metadata.workspace_context_fetched_at = (
            datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=601)
        )
        context_cache.ensure_workspace_overview(session=session, **_deps(nest))
        self.assertEqual(nest.overview_calls, ['ws-1', 'ws-1'])
        context_cache.ensure_workspace_overview(session=session, force=True, **_deps(nest))
        self.assertEqual(len(nest.overview_calls), 3)

    def test_failure_keeps_the_previous_payload(self) -> None:
        nest = _Nest()
        session = AgentSession(scope={'kind': 'workspace', 'workspace_id': 'ws-1'})
        context_cache.ensure_workspace_overview(session=session, **_deps(nest))

        async def _boom(workspace_id, auth_header, trace_id=None):
            raise HTTPException(status_code=503, detail='down')

        nest.ai_context_overview = _boom  # type: ignore[assignment]
        session.metadata.workspace_context_fetched_at = (
            datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=601)
        )
        payload = context_cache.ensure_workspace_overview(session=session, **_deps(nest))
        assert payload is not None
        self.assertEqual(payload['workspace']['name'], 'Acme')


if __name__ == '__main__':
    unittest.main()

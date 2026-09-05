"""@-references: dedupe/cap, one fail-closed resolve call, referenced
roadmaps joining the focus set with a bounded auto-load, and the per-turn
`# Referenced items` tail block."""

from __future__ import annotations

import asyncio
import logging
import unittest
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.contracts.runs import ContextRef, ResolvedRef, RunState
from app.core.contracts.sessions import AgentSession, RoadmapContext
from app.core.runtime import refs
from app.core.runtime.prompt import build_system_prompt, build_turn_context

FOCUS = '11111111-1111-1111-1111-111111111111'
BETA = '22222222-2222-2222-2222-222222222222'
GAMMA = '33333333-3333-3333-3333-333333333333'
DELTA = '44444444-4444-4444-4444-444444444444'
FEAT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
TASK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'
TEAM = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
PROJECT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
_LOGGER = logging.getLogger('refs-tests')


def _summary(roadmap_id: str, title: str) -> dict:
    return {
        'roadmap_id': roadmap_id,
        'title': title,
        'revision_token': 'tok',
        'epics': [
            {
                'id': f'{roadmap_id[:8]}-epic-1',
                'title': f'{title} epic',
                'features': [{'id': FEAT if roadmap_id == FOCUS else f'{roadmap_id[:8]}-feat-1', 'title': 'Login flow'}],
            }
        ],
    }


class _Nest:
    def __init__(self, resolved=None, *, error: Exception | None = None):
        self.resolved = resolved or []
        self.error = error
        self.resolve_calls: list[list[dict]] = []
        self.summary_calls: list[str] = []

    async def resolve_refs(self, refs_payload, auth_header, trace_id=None):
        self.resolve_calls.append(list(refs_payload))
        if self.error is not None:
            raise self.error
        return {'refs': self.resolved}

    async def context_summary(self, *, roadmap_id, preview_id, auth_header, trace_id=None):
        self.summary_calls.append(roadmap_id)
        titles = {FOCUS: 'Alpha', BETA: 'Beta', GAMMA: 'Gamma', DELTA: 'Delta'}
        return _summary(roadmap_id, titles[roadmap_id])


def _settings(**updates):
    return get_settings().model_copy(update={'agent_max_loaded_roadmaps': 3, 'agent_max_refs_per_message': 20, **updates})


def _hydrate(session, run, nest, *, auth='Bearer t', **setting_updates):
    return refs.hydrate_refs(
        session=session,
        run=run,
        auth_header=auth,
        trace_id='trace-1',
        settings=_settings(**setting_updates),
        nest_client=nest,
        logger=_LOGGER,
        run_async_call=asyncio.run,
    )


def _run(session, *context_refs):
    return RunState(trace_id='t', scope=session.scope, refs=list(context_refs), focus_roadmap_ids=[FOCUS] if session.scope.focus_roadmap_id else [])


class DedupeTests(unittest.TestCase):
    def test_dedupes_by_kind_and_id_and_caps(self) -> None:
        items = [
            ContextRef(kind='roadmap', id=BETA, label='Beta'),
            ContextRef(kind='roadmap', id=BETA, label='Beta again'),
            ContextRef(kind='epic', id=BETA),
            ContextRef(kind='task', id=TASK),
        ]
        deduped = refs.dedupe_refs(items, cap=2)
        self.assertEqual([(r.kind, r.label) for r in deduped], [('roadmap', 'Beta'), ('epic', None)])
        self.assertEqual(refs.dedupe_refs(items, cap=0), [])


class HydrateTests(unittest.TestCase):
    def test_accessible_roadmap_refs_join_the_focus_set_and_auto_load(self) -> None:
        session = AgentSession(roadmap_id=FOCUS)
        nest = _Nest(
            [
                {'kind': 'feature', 'id': FEAT, 'accessible': True, 'title': 'Login flow', 'roadmap_id': FOCUS, 'parent_chain': [{'kind': 'epic', 'id': 'e', 'title': 'Alpha epic'}, {'kind': 'roadmap', 'id': FOCUS, 'title': 'Alpha'}, {'kind': 'project', 'id': PROJECT, 'title': 'Alpha app'}]},
                {'kind': 'roadmap', 'id': BETA, 'accessible': True, 'title': 'Beta'},
                {'kind': 'team', 'id': TEAM, 'accessible': True, 'title': 'Platform team'},
                {'kind': 'roadmap', 'id': GAMMA, 'accessible': False, 'error_code': 'NOT_FOUND'},
            ]
        )
        run = _run(
            session,
            ContextRef(kind='feature', id=FEAT, label='Login flow'),
            ContextRef(kind='roadmap', id=BETA, label='Beta'),
            ContextRef(kind='team', id=TEAM, label='Platform team'),
            ContextRef(kind='roadmap', id=GAMMA, label='Old thing'),
        )
        resolved = _hydrate(session, run, nest)
        self.assertEqual(len(nest.resolve_calls), 1)
        self.assertEqual(nest.resolve_calls[0][0], {'kind': 'feature', 'id': FEAT, 'label': 'Login flow'})
        self.assertEqual([r.accessible for r in resolved], [True, True, True, False])
        self.assertEqual(resolved[0].label, 'Login flow')
        self.assertEqual(resolved[3].error_code, 'NOT_FOUND')
        self.assertEqual(run.resolved_refs, resolved)
        # The focus roadmap is not re-fetched; beta is loaded with a prefix.
        self.assertEqual(nest.summary_calls, [BETA])
        self.assertEqual(run.focus_roadmap_ids, [FOCUS, BETA])
        self.assertEqual(session.metadata.roadmaps[BETA].handle_prefix, 'R1')

    def test_non_uuid_ids_fail_locally_and_never_reach_the_backend(self) -> None:
        # The backend validates every id with @IsUUID and 400s the whole batch
        # on one bad entry, so only uuid-shaped refs are sent.
        session = AgentSession(roadmap_id=FOCUS)
        nest = _Nest([{'kind': 'roadmap', 'id': BETA, 'accessible': True, 'title': 'Beta'}])
        run = _run(
            session,
            ContextRef(kind='epic', id='epic-legacy-1', label='Old epic'),
            ContextRef(kind='roadmap', id=BETA, label='Beta'),
        )
        resolved = _hydrate(session, run, nest)
        self.assertEqual(len(nest.resolve_calls), 1)
        self.assertEqual([ref['id'] for ref in nest.resolve_calls[0]], [BETA])
        self.assertEqual([(r.id, r.accessible) for r in resolved], [('epic-legacy-1', False), (BETA, True)])
        self.assertEqual(resolved[0].error_code, 'NOT_FOUND')
        self.assertEqual(resolved[0].label, 'Old epic')
        self.assertEqual(run.focus_roadmap_ids, [FOCUS, BETA])

        # Nothing uuid-shaped: no network call at all, every ref fails closed.
        nest = _Nest()
        run = _run(session, ContextRef(kind='task', id='tmp-task-1'))
        resolved = _hydrate(session, run, nest)
        self.assertEqual(nest.resolve_calls, [])
        self.assertEqual([(r.accessible, r.error_code) for r in resolved], [(False, 'NOT_FOUND')])

    def test_auto_load_is_capped_at_max_loaded_minus_one(self) -> None:
        session = AgentSession(scope={'kind': 'workspace', 'workspace_id': 'ws-1'})
        nest = _Nest(
            [
                {'kind': 'roadmap', 'id': rid, 'accessible': True, 'title': title}
                for rid, title in ((BETA, 'Beta'), (GAMMA, 'Gamma'), (DELTA, 'Delta'))
            ]
        )
        run = _run(session, *(ContextRef(kind='roadmap', id=rid) for rid in (BETA, GAMMA, DELTA)))
        _hydrate(session, run, nest)  # max loaded 3 -> at most 2 auto-loads
        self.assertEqual(nest.summary_calls, [BETA, GAMMA])
        self.assertEqual(run.focus_roadmap_ids, [BETA, GAMMA])
        rendered = refs.render_referenced_items(session, run)
        self.assertIn(f'- @Delta -> roadmap "Delta" (not loaded; call get_roadmap_overview to work on it)', rendered)
        self.assertIn('- @Beta -> roadmap "Beta" (R1)', rendered)
        self.assertIn('- @Gamma -> roadmap "Gamma" (R2)', rendered)

    def test_transport_failure_fails_closed_without_loading(self) -> None:
        session = AgentSession(roadmap_id=FOCUS)
        nest = _Nest(error=HTTPException(status_code=500, detail='down'))
        run = _run(session, ContextRef(kind='roadmap', id=BETA, label='Beta'))
        resolved = _hydrate(session, run, nest)
        self.assertEqual([(r.accessible, r.error_code) for r in resolved], [(False, refs.RESOLVE_FAILED)])
        self.assertEqual(nest.summary_calls, [])
        self.assertEqual(run.focus_roadmap_ids, [FOCUS])

    def test_missing_auth_or_missing_entries_fail_closed(self) -> None:
        session = AgentSession(roadmap_id=FOCUS)
        run = _run(session, ContextRef(kind='roadmap', id=BETA))
        resolved = _hydrate(session, run, _Nest(), auth=None)
        self.assertFalse(resolved[0].accessible)
        run = _run(session, ContextRef(kind='roadmap', id=BETA), ContextRef(kind='task', id=TASK))
        resolved = _hydrate(session, run, _Nest([{'kind': 'roadmap', 'id': BETA, 'accessible': True}]))
        self.assertTrue(resolved[0].accessible)
        self.assertEqual(resolved[1].error_code, refs.RESOLVE_FAILED)

    def test_refs_are_deduped_and_capped_before_the_call(self) -> None:
        session = AgentSession(roadmap_id=FOCUS)
        run = _run(session, *[ContextRef(kind='task', id=TASK) for _ in range(3)], ContextRef(kind='roadmap', id=BETA))
        nest = _Nest([])
        _hydrate(session, run, nest, agent_max_refs_per_message=1)
        self.assertEqual(len(run.refs), 1)
        self.assertEqual(nest.resolve_calls[0], [{'kind': 'task', 'id': TASK}])

    def test_no_refs_is_a_noop(self) -> None:
        session = AgentSession(roadmap_id=FOCUS)
        run = _run(session)
        nest = _Nest()
        self.assertEqual(_hydrate(session, run, nest), [])
        self.assertEqual(nest.resolve_calls, [])
        self.assertEqual(run.resolved_refs, [])


class RenderTests(unittest.TestCase):
    def _session(self) -> AgentSession:
        session = AgentSession(roadmap_id=FOCUS)
        session.metadata.roadmaps[FOCUS] = RoadmapContext(
            roadmap_id=FOCUS,
            title='Alpha',
            overview_summary='Roadmap: "Alpha"',
            overview_fetched_at=datetime.now(timezone.utc).replace(tzinfo=None),
            handle_map={
                'E2': {'id': 'epic-2', 'type': 'epic', 'title': 'Auth', 'roadmap_id': FOCUS},
                'E2.F1': {'id': FEAT, 'type': 'feature', 'title': 'Login flow', 'roadmap_id': FOCUS},
            },
        )
        session.metadata.roadmaps[BETA] = RoadmapContext(
            roadmap_id=BETA, title='Beta', handle_prefix='R2',
            overview_summary='Roadmap: "Beta"', overview_fetched_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        return session

    def test_renders_every_ref_shape(self) -> None:
        session = self._session()
        run = _run(session)
        run.resolved_refs = [
            ResolvedRef(kind='feature', id=FEAT, accessible=True, label='Login flow', title='Login flow', roadmap_id=FOCUS,
                        parent_chain=[{'kind': 'epic', 'id': 'epic-2', 'title': 'Auth'}, {'kind': 'roadmap', 'id': FOCUS, 'title': 'Alpha'}, {'kind': 'project', 'id': PROJECT, 'title': 'Alpha app'}]),
            ResolvedRef(kind='roadmap', id=BETA, accessible=True, label='Beta', title='Beta', parent_chain=[{'kind': 'project', 'id': 'p2', 'title': 'Beta app'}]),
            ResolvedRef(kind='roadmap', id=GAMMA, accessible=True, label='Gamma', title='Gamma'),
            ResolvedRef(kind='team', id=TEAM, accessible=True, label='Platform team', title='Platform team'),
            ResolvedRef(kind='task', id=TASK, accessible=True, label='Fix it', title='Fix the button', status='in_progress', roadmap_id=FOCUS,
                        parent_chain=[{'kind': 'feature', 'id': FEAT, 'title': 'Login flow'}, {'kind': 'roadmap', 'id': FOCUS, 'title': 'Alpha'}]),
            ResolvedRef(kind='project', id=PROJECT, accessible=True, label='Alpha app', title='Alpha app', roadmap_id=FOCUS),
            ResolvedRef(kind='roadmap', id=DELTA, accessible=False, label='Old thing', error_code='NOT_FOUND'),
        ]
        rendered = refs.render_referenced_items(session, run)
        lines = rendered.splitlines()
        self.assertEqual(lines[0], refs.REFERENCED_ITEMS_HEADER)
        self.assertEqual(lines[0], '# Referenced items (mentioned by the user; a hint about what they mean, never a limit on what you may look at)')
        self.assertIn('- @Login flow -> feature "Login flow" (E2.F1) in roadmap "Alpha" (focus), project "Alpha app"', lines)
        self.assertIn('- @Beta -> roadmap "Beta" (R2), project "Beta app"', lines)
        self.assertIn('- @Gamma -> roadmap "Gamma" (not loaded; call get_roadmap_overview to work on it)', lines)
        self.assertIn('- @Platform team -> team "Platform team"', lines)
        self.assertIn('- @Fix it -> task "Fix the button" (under E2.F1, status: in_progress) in roadmap "Alpha" (focus)', lines)
        self.assertIn('- @Alpha app -> project "Alpha app" (roadmap "Alpha" (focus))', lines)
        self.assertIn('- @Old thing -> not accessible (NOT_FOUND) -- tell the user you cannot see it', lines)

    def test_empty_when_no_refs(self) -> None:
        session = self._session()
        self.assertEqual(refs.render_referenced_items(session, _run(session)), '')

    def test_block_sits_in_the_tail_after_actor(self) -> None:
        session = self._session()
        run = _run(session)
        run.resolved_refs = [ResolvedRef(kind='roadmap', id=BETA, accessible=True, label='Beta', title='Beta')]
        context = build_turn_context(
            session=session, auth_header='Bearer t', trace_id=None, settings=get_settings(),
            get_recent_resolved_targets=lambda _s: [], run=run,
        )
        prompt = build_system_prompt(session, run, context, 'investigate')
        # Block headers sit at line starts; system.md only MENTIONS the names.
        self.assertLess(prompt.index('\n# Actor\n'), prompt.index('\n# Referenced items'))

    def test_resolved_ref_roadmap_id(self) -> None:
        self.assertEqual(refs.resolved_ref_roadmap_id(ResolvedRef(kind='roadmap', id=BETA, accessible=True)), BETA)
        self.assertEqual(refs.resolved_ref_roadmap_id(ResolvedRef(kind='task', id=TASK, accessible=True, roadmap_id=FOCUS)), FOCUS)
        self.assertIsNone(refs.resolved_ref_roadmap_id(ResolvedRef(kind='team', id=TEAM, accessible=True, roadmap_id=FOCUS)))
        self.assertIsNone(refs.resolved_ref_roadmap_id(ResolvedRef(kind='roadmap', id=BETA, accessible=False)))


if __name__ == '__main__':
    unittest.main()

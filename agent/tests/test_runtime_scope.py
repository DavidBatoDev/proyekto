"""Scope helpers: cache keys, the focus roadmap, the tool-argument default
roadmap, and the project ids derived from the loaded roadmaps."""

from __future__ import annotations

import unittest

from app.core.contracts.runs import ResolvedRef, RunState
from app.core.contracts.sessions import AgentSession, RoadmapContext, SessionScope
from app.core.runtime import scope as scope_helpers

FOCUS = '11111111-1111-1111-1111-111111111111'
BETA = '22222222-2222-2222-2222-222222222222'
GAMMA = '33333333-3333-3333-3333-333333333333'


class ScopeHelperTests(unittest.TestCase):
    def test_keys_and_focus(self) -> None:
        roadmap = SessionScope(kind='roadmap', roadmap_id=FOCUS)
        workspace = SessionScope(kind='workspace', workspace_id='ws-1')
        self.assertEqual(scope_helpers.prompt_cache_key(roadmap), f'roadmap:{FOCUS}')
        self.assertEqual(scope_helpers.prompt_cache_key(workspace), 'workspace:ws-1')
        self.assertEqual(scope_helpers.roadmap_cache_key(BETA), f'roadmap:{BETA}')
        self.assertEqual(scope_helpers.focus_roadmap_id(AgentSession(scope=roadmap)), FOCUS)
        self.assertIsNone(scope_helpers.focus_roadmap_id(AgentSession(scope=workspace)))

    def test_default_roadmap_id_in_workspace_scope_needs_exactly_one_referenced_roadmap(self) -> None:
        session = AgentSession(scope={'kind': 'workspace', 'workspace_id': 'ws-1'})
        self.assertIsNone(scope_helpers.default_roadmap_id(session))
        run = RunState(trace_id='t', scope=session.scope)
        run.resolved_refs = [
            ResolvedRef(kind='task', id='t-1', accessible=True, roadmap_id=BETA),
            ResolvedRef(kind='roadmap', id=BETA, accessible=True),
            ResolvedRef(kind='roadmap', id=GAMMA, accessible=False),
            ResolvedRef(kind='team', id='team-1', accessible=True),
        ]
        self.assertEqual(scope_helpers.default_roadmap_id(session, run), BETA)
        run.resolved_refs.append(ResolvedRef(kind='roadmap', id=GAMMA, accessible=True))
        self.assertIsNone(scope_helpers.default_roadmap_id(session, run))
        focus_session = AgentSession(roadmap_id=FOCUS)
        self.assertEqual(scope_helpers.default_roadmap_id(focus_session, run), FOCUS)

    def test_workspace_and_project_ids_from_the_context_cache(self) -> None:
        session = AgentSession(roadmap_id=FOCUS)
        self.assertIsNone(scope_helpers.workspace_id(session))
        self.assertIsNone(scope_helpers.focus_project_id(session))
        self.assertEqual(scope_helpers.loaded_project_ids(session), [])
        session.metadata.roadmaps[BETA] = RoadmapContext(roadmap_id=BETA, handle_prefix='R1', project_id='p-beta')
        session.metadata.roadmaps[FOCUS] = RoadmapContext(
            roadmap_id=FOCUS, workspace_id='ws-9',
            project_context={'project': {'id': 'p-focus', 'workspace_id': 'ws-9'}},
        )
        self.assertEqual(scope_helpers.workspace_id(session), 'ws-9')
        self.assertEqual(scope_helpers.focus_project_id(session), 'p-focus')
        # Focus first, deduplicated, regardless of load order.
        self.assertEqual(scope_helpers.loaded_project_ids(session), ['p-focus', 'p-beta'])
        workspace = AgentSession(scope={'kind': 'workspace', 'workspace_id': 'ws-1'})
        self.assertEqual(scope_helpers.workspace_id(workspace), 'ws-1')


if __name__ == '__main__':
    unittest.main()

"""Prompt assembly: STATIC_PREFIX + SCOPE_BLOCK + STATE_BLOCKS + TAIL, the
block order, the cache invariant (the prefix through `# Actor` is byte-
identical across turns whose tails differ), the workspace-scope blocks, and
the phase tails."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from app.core.config import get_settings
from app.core.contracts.runs import ResolvedRef, RunState
from app.core.contracts.sessions import (
    ActorContext,
    AgentSession,
    AppliedChange,
    ChangeGroup,
    PendingPlan,
    RecentResolvedTarget,
    RoadmapContext,
)
from app.core.runtime import prompt
from app.core.tools.registry import get_context_tools

FOCUS = '11111111-1111-1111-1111-111111111111'
BETA = '22222222-2222-2222-2222-222222222222'
NODE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _roadmap_session(*, with_beta: bool = True) -> AgentSession:
    session = AgentSession(roadmap_id=FOCUS)
    session.metadata.roadmaps[FOCUS] = RoadmapContext(
        roadmap_id=FOCUS,
        title='Alpha',
        overview_summary='Roadmap: "Alpha"\nE1. Growth — 1 feature\n   E1.F1 · Login',
        overview_fetched_at=_now(),
        handle_map={'E1': {'id': 'epic-1', 'type': 'epic', 'title': 'Growth', 'roadmap_id': FOCUS}},
        project_context={'project': {'id': 'p-1', 'title': 'Alpha app'}},
        project_context_fetched_at=_now(),
        memory_notes=[{'id': 'm-1', 'content': 'Name epics by quarter', 'source': 'user_request', 'scope': 'roadmap', 'category': 'preference'}],
    )
    if with_beta:
        session.metadata.roadmaps[BETA] = RoadmapContext(
            roadmap_id=BETA,
            title='Beta',
            handle_prefix='R1',
            overview_summary='Roadmap: "Beta"\nR1.E1. Billing',
            overview_fetched_at=_now(),
            handle_map={'R1.E1': {'id': 'epic-b', 'type': 'epic', 'title': 'Billing', 'roadmap_id': BETA}},
            memory_notes=[{'id': 'm-2', 'content': 'Invoice tasks carry a due date', 'source': 'inferred', 'scope': 'roadmap', 'category': 'fact'}],
        )
    session.metadata.conversation_summary = 'We discussed onboarding.'
    session.metadata.actor_context = ActorContext(actor_id='u-1', display_name='Ana', roadmap_role='owner')
    session.metadata.pending_plan = PendingPlan(
        summary='Add a billing epic',
        goal='billing',
        source_user_message='plan billing',
        targets=[{'roadmap_id': BETA, 'proposed_hierarchy': [{'title': 'Billing v2', 'features': [{'title': 'Invoices', 'tasks': [{'title': 'PDF export'}]}]}]}],
        proposed_hierarchy=[{'title': 'Billing v2', 'features': [{'title': 'Invoices', 'tasks': [{'title': 'PDF export'}]}]}],
    )
    session.metadata.recent_resolved_targets = [
        RecentResolvedTarget(node_id=NODE, node_type='feature', title='Login', roadmap_id=BETA)
    ]
    session.metadata.change_history = [
        ChangeGroup(change_id='chg-2', summary='Renamed epic', roadmap_id=BETA, changes=[AppliedChange(node_id='x', node_type='epic', change_type='TITLE_CHANGED', title='Billing')]),
        ChangeGroup(change_id='chg-1', summary='Created epic', roadmap_id=FOCUS, changes=[AppliedChange(node_id='y', node_type='epic', change_type='NODE_ADDED', title='Growth')]),
    ]
    return session


def _context(session: AgentSession, run=None, **updates):
    context = prompt.build_turn_context(
        session=session,
        auth_header='Bearer t',
        trace_id='trace-1',
        settings=get_settings(),
        get_recent_resolved_targets=lambda s: list(s.metadata.recent_resolved_targets),
        run=run,
    )
    context.update(updates)
    return context


def _run(session, **fields) -> RunState:
    fields.setdefault('user_message', 'add billing')
    return RunState(trace_id='t', scope=session.scope, **fields)


def _pos(system: str, header: str) -> int:
    """Position of a state-block HEADER (line start, after the static prefix —
    system.md has its own `# Project context` / `# Memory` sections and
    mentions the other block names inside quotes)."""
    return system.index('\n' + header, len(prompt.static_prefix()))


class BlockOrderTests(unittest.TestCase):
    def test_roadmap_scope_block_order(self) -> None:
        session = _roadmap_session()
        run = _run(session)
        run.resolved_refs = [ResolvedRef(kind='roadmap', id=BETA, accessible=True, label='Beta', title='Beta')]
        context = _context(session, run, memory_notes_semantic=True, relevant_memory_notes=[{'id': 'm-1', 'content': 'Name epics by quarter'}])
        system = prompt.build_system_prompt(session, run, context, 'investigate', resumed=True)
        self.assertTrue(system.startswith(prompt.static_prefix()))
        headers = [
            '# Scope',
            '# Focus roadmap',
            '# Loaded roadmaps',
            '# Project context',
            '# Earlier conversation summary',
            '# Memory notes',
            '# Pending proposal awaiting user confirmation',
            '# Recently resolved items',
            '# Recent changes',
            '# Actor',
            '# Referenced items',
            '# Relevant memories',
            '# Run',
        ]
        positions = [_pos(system, header) for header in headers]
        self.assertEqual(positions, sorted(positions), headers)
        self.assertGreater(positions[0], len(prompt.static_prefix()) - 1)
        self.assertIn('Focus roadmap: "Alpha" (bare handles)', system)
        self.assertIn('## R1 — "Beta"', system)
        self.assertIn('R1.E1. Billing', system)
        self.assertIn('# Project context\nRoadmap: "Alpha"\nProject: Alpha app', system)
        self.assertIn('Target roadmap "Beta" (R1):', system)
        self.assertIn('    - Task: PDF export', system)
        self.assertIn(f'- Login (feature) — id {NODE} — roadmap "Beta"', system)
        self.assertIn('Roadmap "Beta":', system)
        self.assertIn('Roadmap "Alpha":', system)
        self.assertIn('change_id: chg-2', system)
        self.assertIn('# Actor\nYou are assisting Ana (owner of the focus roadmap).', system)
        self.assertIn('Phase: investigate (resumed)', system)

    def test_memory_notes_group_per_roadmap_when_several_are_loaded(self) -> None:
        session = _roadmap_session()
        system = prompt.build_system_prompt(session, None, _context(session), 'investigate')
        self.assertIn('# Memory notes (durable preferences, per roadmap)', system)
        self.assertIn('Roadmap "Alpha" (focus):', system)
        self.assertIn('Roadmap "Beta" (R1):', system)
        self.assertIn('[fact] "Invoice tasks carry a due date"', system)
        single = _roadmap_session(with_beta=False)
        system = prompt.build_system_prompt(single, None, _context(single), 'investigate')
        self.assertIn('# Memory notes (durable preferences for this roadmap)', system)
        self.assertNotIn('\n# Loaded roadmaps', system)

    def test_empty_focus_and_no_actor_still_render_stable_headers(self) -> None:
        session = AgentSession(roadmap_id=FOCUS)
        system = prompt.build_system_prompt(session, None, _context(session), 'investigate')
        self.assertIn('# Focus roadmap\n(empty — no epics yet)', system)
        self.assertTrue(system.rstrip().endswith('# Actor\nYou are assisting the user.'))
        self.assertNotIn('\n# Run', system)


class CacheInvariantTests(unittest.TestCase):
    def test_prefix_bytes_identical_across_turns_with_different_refs(self) -> None:
        session = _roadmap_session()
        run_a = _run(session)
        run_a.resolved_refs = [ResolvedRef(kind='roadmap', id=BETA, accessible=True, label='Beta', title='Beta')]
        run_b = _run(session, user_message='something else')
        run_b.resolved_refs = [ResolvedRef(kind='epic', id='epic-9', accessible=False, label='Old', error_code='NOT_FOUND')]
        first = prompt.build_system_prompt(session, run_a, _context(session, run_a), 'investigate')
        second = prompt.build_system_prompt(session, run_b, _context(session, run_b, relevant_memory_notes=[{'id': 'm-1', 'content': 'x'}]), 'verify')
        self.assertNotEqual(first, second)
        self.assertEqual(prompt.prompt_prefix(first), prompt.prompt_prefix(second))
        self.assertTrue(prompt.prompt_prefix(first).endswith('(owner of the focus roadmap).'))
        self.assertNotIn('\n# Referenced items', prompt.prompt_prefix(first))
        self.assertNotIn('\n# Run', prompt.prompt_prefix(second))
        # Semantic memory mode is a per-session setting: with it on for BOTH
        # turns the stub is stable and the matched notes ride the tail.
        semantic_a = prompt.build_system_prompt(session, run_a, _context(session, run_a, memory_notes_semantic=True, relevant_memory_notes=[{'id': 'm-1', 'content': 'x'}]), 'investigate')
        semantic_b = prompt.build_system_prompt(session, run_b, _context(session, run_b, memory_notes_semantic=True, relevant_memory_notes=[{'id': 'm-1', 'content': 'y'}]), 'investigate')
        self.assertEqual(prompt.prompt_prefix(semantic_a), prompt.prompt_prefix(semantic_b))
        self.assertIn('# Memory notes\n(1 stored;', prompt.prompt_prefix(semantic_a))

    def test_build_messages_system_prefix_is_byte_identical_across_consecutive_turns(self) -> None:
        """The wire-level check: two consecutive turns of one session, each
        with different refs, produce a messages[0] whose text is byte-identical
        through the end of the `# Actor` block (the prompt-cache prefix)."""
        session = _roadmap_session()
        run_a = _run(session, user_message='rename E1 to Onboarding')
        run_a.resolved_refs = [ResolvedRef(kind='roadmap', id=BETA, accessible=True, label='Beta', title='Beta')]
        first = prompt.build_messages(session, run_a, _context(session, run_a), 'investigate')
        # The first turn lands in history before the second one is built.
        from app.core.contracts.sessions import Message

        session.messages.append(Message(role='user', content='rename E1 to Onboarding'))
        session.messages.append(Message(role='assistant', content='Renamed.'))
        run_b = _run(session, user_message='now add a billing feature')
        run_b.resolved_refs = [
            ResolvedRef(kind='feature', id=NODE, accessible=True, label='Login', title='Login', roadmap_id=FOCUS),
            ResolvedRef(kind='epic', id='epic-9', accessible=False, label='Old', error_code='NOT_FOUND'),
        ]
        second = prompt.build_messages(session, run_b, _context(session, run_b), 'investigate')
        self.assertEqual(first[0]['role'], 'system')
        self.assertEqual(second[0]['role'], 'system')
        self.assertNotEqual(first[0]['content'], second[0]['content'])
        prefix_a = prompt.prompt_prefix(first[0]['content'])
        prefix_b = prompt.prompt_prefix(second[0]['content'])
        self.assertEqual(prefix_a.encode('utf-8'), prefix_b.encode('utf-8'))
        self.assertIn('\n# Actor\n', prefix_a)
        self.assertTrue(second[0]['content'].startswith(prefix_a))
        # The block HEADER rides the tail (system.md mentions the name in quotes).
        self.assertIn('\n# Referenced items (', second[0]['content'][len(prefix_a):])
        self.assertNotIn('\n# Referenced items (', prefix_a)
        # History and the user turn follow the system message, never precede it.
        self.assertEqual([m['role'] for m in second[1:]], ['user', 'assistant', 'user'])
        self.assertEqual(second[-1]['content'], 'now add a billing feature')

    def test_nothing_per_turn_renders_above_actor(self) -> None:
        session = _roadmap_session()
        run = _run(session)
        run.resolved_refs = [ResolvedRef(kind='roadmap', id=BETA, accessible=True, label='Beta', title='Beta')]
        system = prompt.build_system_prompt(session, run, _context(session, run), 'execute')
        actor = _pos(system, '# Actor')
        for per_turn in ('# Referenced items', '# Relevant memories', '# Run'):
            index = system.find('\n' + per_turn)
            if index != -1:
                self.assertGreater(index, actor, per_turn)


class WorkspaceScopeTests(unittest.TestCase):
    def _session(self) -> AgentSession:
        session = AgentSession(scope={'kind': 'workspace', 'workspace_id': 'ws-1'})
        session.metadata.workspace_context = {
            'workspace': {'id': 'ws-1', 'name': 'Acme'},
            'projects': [
                {'id': 'p-1', 'title': 'Alpha app', 'roadmap_id': FOCUS, 'lane': 'current'},
                {'id': 'p-9', 'title': 'Elsewhere', 'lane': 'other_workspace'},
            ],
            'roadmaps': [
                {'id': FOCUS, 'name': 'Alpha', 'project_id': 'p-1', 'project_title': 'Alpha app', 'lane': 'current', 'counts': {'epics': 3, 'features': 7, 'tasks': 20, 'open_tasks': 5, 'overdue_tasks': 1}},
                {'id': BETA, 'name': 'Shared one', 'owner_id': 'u-2', 'lane': 'shared'},
            ],
            'teams': [{'id': 't-1', 'name': 'Platform', 'member_count': 4, 'lane': 'current'}],
        }
        session.metadata.actor_context = ActorContext(actor_id='u-1', display_name='Ana')
        return session

    def test_scope_focus_overview_and_actor_blocks(self) -> None:
        session = self._session()
        system = prompt.build_system_prompt(session, None, _context(session), 'investigate')
        self.assertIn('# Scope\nWorkspace: "Acme". No focus roadmap — load one with get_roadmap_overview before editing.', system)
        self.assertIn('# Focus roadmap\n(none loaded)', system)
        overview = system[_pos(system, '# Workspace overview'):_pos(system, '# Actor')]
        self.assertIn('Workspace: "Acme"', overview)
        self.assertIn('Projects (1; 1 more in other workspaces):', overview)
        self.assertIn(f'- Alpha app (id p-1, roadmap "Alpha" (id {FOCUS}))', overview)
        self.assertNotIn('Elsewhere', overview)
        self.assertIn(f'- Alpha (id {FOCUS}; project "Alpha app"; 3 epics, 7 features, 20 tasks, 5 open, 1 overdue)', overview)
        self.assertIn(f'- Shared one (id {BETA}; standalone, no project; shared with you)', overview)
        self.assertIn('Projects and roadmaps are different objects', overview)
        self.assertIn('- Platform (id t-1, 4 members)', overview)
        self.assertLessEqual(len(overview.strip().splitlines()), 40)
        self.assertIn('# Actor\nYou are assisting Ana (workspace member).', system)

    def test_standalone_roadmaps_and_empty_projects_are_never_paired(self) -> None:
        # Regression: a summary once invented a project called "Test Project" to
        # hold the user's standalone roadmaps and called them "shared" — the
        # actor owned them; `lane: shared` only meant "outside any workspace".
        session = self._session()
        session.metadata.workspace_context['projects'].append(
            {'id': 'p-2', 'title': 'Empty project', 'owner_id': 'u-1', 'roadmap_id': None, 'lane': 'current'}
        )
        session.metadata.workspace_context['roadmaps'].extend([
            {'id': 'r-solo', 'name': 'Test Project', 'owner_id': 'u-1', 'project_id': None, 'status': 'draft', 'lane': 'shared'},
            {'id': 'r-new', 'name': 'New Roadmap', 'owner_id': 'u-1', 'project_id': None, 'status': 'draft', 'lane': 'shared'},
        ])
        system = prompt.build_system_prompt(session, None, _context(session), 'investigate')
        overview = system[_pos(system, '# Workspace overview'):_pos(system, '# Actor')]
        self.assertIn('- Empty project (id p-2, no roadmap yet, yours)', overview)
        self.assertIn('- Test Project (id r-solo; standalone, no project; status: draft; yours)', overview)
        self.assertIn('- New Roadmap (id r-new; standalone, no project; status: draft; yours)', overview)
        # The owner's standalone roadmaps are never described as shared.
        for line in overview.splitlines():
            if 'r-solo' in line or 'r-new' in line:
                self.assertNotIn('shared', line)
        self.assertLessEqual(len(overview.strip().splitlines()), 40)

    def test_loaded_roadmaps_are_all_prefixed_in_workspace_scope(self) -> None:
        session = self._session()
        session.metadata.roadmaps[BETA] = RoadmapContext(
            roadmap_id=BETA, title='Beta', handle_prefix='R1',
            overview_summary='Roadmap: "Beta"\nR1.E1. Billing', overview_fetched_at=_now(),
        )
        system = prompt.build_system_prompt(session, None, _context(session), 'investigate')
        self.assertIn('\n# Loaded roadmaps\n## R1 — "Beta"\nRoadmap: "Beta"\nR1.E1. Billing', system)
        self.assertLess(_pos(system, '# Focus roadmap'), _pos(system, '# Loaded roadmaps'))
        self.assertLess(_pos(system, '# Loaded roadmaps'), _pos(system, '# Workspace overview'))

    def test_workspace_overview_caps_at_forty_lines(self) -> None:
        session = self._session()
        session.metadata.workspace_context['roadmaps'] = [
            {'id': f'r-{i}', 'name': f'Roadmap {i}', 'lane': 'current'} for i in range(60)
        ]
        system = prompt.build_system_prompt(session, None, _context(session), 'investigate')
        overview = system[_pos(system, '# Workspace overview'):_pos(system, '# Actor')]
        self.assertLessEqual(len(overview.strip().splitlines()), 40)
        self.assertIn('…and', overview)


class MessagesAndPhaseTailTests(unittest.TestCase):
    def test_build_messages_shape(self) -> None:
        session = _roadmap_session(with_beta=False)
        session.messages = []
        from app.core.contracts.sessions import Message

        session.messages.append(Message(role='user', content='earlier question'))
        session.messages.append(Message(role='assistant', content='earlier answer'))
        session.messages.append(Message(role='tool', content='dropped'))
        run = _run(session)
        transcript = [{'type': 'function_call', 'call_id': 'c1', 'name': 'search_nodes', 'arguments': '{}'}]
        messages = prompt.build_messages(session, run, _context(session, run), 'investigate', resumed=True, transcript=transcript)
        self.assertEqual([m.get('role') for m in messages[:4]], ['system', 'user', 'assistant', 'user'])
        self.assertEqual(messages[3]['content'], 'add billing')
        self.assertEqual(messages[4], transcript[0])
        self.assertIn('Phase: investigate (resumed)', messages[0]['content'])
        custom = prompt.build_messages(session, run, _context(session, run), 'execute', user_message='materialize', extra_tail='# Target\n- Epic: Billing')
        self.assertEqual(custom[-1]['content'], 'materialize')
        self.assertTrue(custom[0]['content'].rstrip().endswith('# Target\n- Epic: Billing'))

    def test_phase_tails(self) -> None:
        self.assertEqual(prompt.render_phase_tail('investigate'), '')
        self.assertIn('Phase: investigate (resumed)', prompt.render_phase_tail('investigate', resumed=True))
        execute = prompt.render_phase_tail('execute', roadmap_label='R2', roadmap_title='Beta', roadmap_id=BETA)
        self.assertIn(f'roadmap R2 "Beta" (roadmap_id {BETA})', execute)
        self.assertIn(f'`roadmap_id` = {BETA}', execute)
        self.assertNotIn('{roadmap_', execute)
        verify = prompt.render_phase_tail('verify')
        self.assertTrue(verify.startswith('# Run\nPhase: verify.'))
        self.assertIn('never re-apply anything', verify)
        self.assertEqual(prompt.render_phase_tail('propose'), '')


class MultiAssigneePromptTests(unittest.TestCase):
    """The multi-assignee rules live in the STATIC prefix (system.md), never
    in a per-turn block, so teaching the model about `assignee_ids` cannot
    move the cache boundary."""

    def test_static_prefix_teaches_the_full_assignee_set(self) -> None:
        prefix = prompt.static_prefix()
        self.assertIn('`patch.assignee_ids: [...]`', prefix)
        self.assertIn(
            '- task: title, description, status, priority, assignee_ids, assignee_id, due_date',
            prefix,
        )
        self.assertIn('Never ask which ONE person to pick', prefix)
        self.assertIn('Never stage `assignee_ids` or `assignee_id` on a non-task', prefix)
        self.assertIn('`[]` = unassign everyone', prefix)
        # Names exactly the MODEL-CALLABLE reads that return the set (each
        # has a `_function_tool` spec in registry.get_context_tools()) and
        # the one that does not.
        self.assertIn(
            '`get_node_details`, `get_tasks_by_parent`, `get_tasks_by_status`, '
            '`get_overdue_tasks` and `get_tasks_assigned_to_me` return `assignee_ids`; '
            '`search_tasks` does not include assignees',
            prefix,
        )
        catalog = {spec['function']['name'] for spec in get_context_tools()}
        for named in (
            'get_node_details', 'get_tasks_by_parent', 'get_tasks_by_status',
            'get_overdue_tasks', 'get_tasks_assigned_to_me', 'search_tasks',
        ):
            self.assertIn(named, catalog, named)
        # `get_tasks_by_epic` / `get_tasks_by_feature` / `get_children` are
        # dispatch-only handlers with no model-facing spec, so the assignee
        # rule must never send the model after them.
        assignee_rule = next(
            line for line in prefix.splitlines() if '`patch.assignee_ids: [...]`' in line
        )
        for dispatch_only in ('get_tasks_by_epic', 'get_tasks_by_feature', 'get_children'):
            self.assertNotIn(dispatch_only, catalog, dispatch_only)
            self.assertNotIn(dispatch_only, assignee_rule, dispatch_only)

    def test_execute_tail_stages_the_full_set_on_add_task(self) -> None:
        tail = prompt.render_phase_tail(
            'execute', roadmap_label='R1', roadmap_title='Beta', roadmap_id=BETA
        )
        self.assertIn('`data.assignee_ids`', tail)
        self.assertIn('never pick just one', tail)
        self.assertIn(
            'name every label you could not match in the `stage_edits` '
            '`assistant_message` so the user knows who was not assigned',
            tail,
        )

    def test_pending_plan_outline_renders_assignee_labels(self) -> None:
        session = _roadmap_session(with_beta=False)
        session.metadata.pending_plan = PendingPlan(
            summary='Add a billing epic',
            goal='billing',
            source_user_message='plan billing',
            proposed_hierarchy=[{
                'title': 'Billing v2',
                'features': [{
                    'title': 'Invoices',
                    'tasks': [
                        {'title': 'PDF export', 'assignee_labels': ['Ana', 'me', 'Ana']},
                        {'title': 'CSV export', 'assignee_label': 'Ben'},
                        {'title': 'Nobody yet'},
                    ],
                }],
            }],
        )
        run = _run(session)
        system = prompt.build_system_prompt(session, run, _context(session, run), 'investigate')
        self.assertIn('    - Task: PDF export (assignees: Ana, me)\n', system)
        self.assertIn('    - Task: CSV export (assignees: Ben)\n', system)
        self.assertIn('    - Task: Nobody yet\n', system)


class TurnContextTests(unittest.TestCase):
    def test_turn_context_carries_scope_keys_and_merged_handles(self) -> None:
        session = _roadmap_session()
        run = _run(session)
        from app.core.contracts.runs import RunBatch
        from app.core.contracts.operations import RoadmapOperation

        run.batches = [RunBatch(roadmap_id=FOCUS, operations=[RoadmapOperation(op='add_epic', data={'title': 'x'})])]
        context = _context(session, run)
        self.assertEqual(context['focus_roadmap_id'], FOCUS)
        self.assertEqual(context['roadmap_id'], FOCUS)
        self.assertEqual(context['scope'], {'kind': 'roadmap', 'roadmap_id': FOCUS})
        self.assertEqual(context['focus_project_id'], 'p-1')
        self.assertEqual(context['knowledge_project_ids'], ['p-1'])
        self.assertEqual(set(context['roadmap_handle_map']), {'E1', 'R1.E1'})
        self.assertEqual(context['staged_operations_count'], 1)
        self.assertEqual(context['roadmap_titles'], {FOCUS: 'Alpha', BETA: 'Beta'})
        self.assertEqual(context['run_id'], run.run_id)
        self.assertEqual(context['pending_plan']['targets'][0]['roadmap_id'], BETA)
        self.assertEqual(context['memory_notes_by_roadmap'][BETA][0]['id'], 'm-2')
        self.assertEqual(context['roadmap_role'], 'owner')
        self.assertNotIn('on_roadmap_loaded', context)


if __name__ == '__main__':
    unittest.main()

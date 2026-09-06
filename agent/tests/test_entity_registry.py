"""Grounding facts are typed, bounded, and kept outside durable memory."""

from __future__ import annotations

import unittest
from uuid import UUID

from app.core.contracts.runs import EntitySeen, ResolvedRef, RunBatch, RunCommit, RunState
from app.core.contracts.sessions import AgentSession, RecentResolvedTarget, RoadmapContext
from app.core.runtime.entity_registry import (
    MAX_ENTITIES_SEEN, build_lookup, harvest_tool_result, make_entity_sink,
    normalize_title, register, register_many, register_workspace_overview, titles_match,
)
from app.core.runtime.snapshot import build_agent_state_snapshot, snapshot_fingerprint


def uid(index: int) -> str:
    return str(UUID(int=index + 1))


class RegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.session = AgentSession(roadmap_id=uid(0))
        self.run = RunState(trace_id='registry', scope=self.session.scope)

    def test_cap_dedupe_later_title_wins_and_fifo(self) -> None:
        for index in range(MAX_ENTITIES_SEEN):
            register(self.run, 'task', uid(index), f'Task {index}')
        register(self.run, 'task', uid(0), 'Renamed task')
        self.assertEqual(self.run.entities_seen[0].title, 'Renamed task')
        register(self.run, 'task', uid(MAX_ENTITIES_SEEN), 'Newest task')
        self.assertEqual(len(self.run.entities_seen), MAX_ENTITIES_SEEN)
        self.assertEqual(self.run.entities_seen[0].id, uid(1))
        self.assertEqual(self.run.entities_seen[-1].title, 'Newest task')

    def test_only_uuid_ids_known_kinds_and_nonempty_titles_are_registered(self) -> None:
        for kind, entity_id, title in [('task', 'E1', 'Title'), ('profile', uid(0), 'Person'), ('task', uid(0), '  ')]:
            register(self.run, kind, entity_id, title)
        self.assertEqual(self.run.entities_seen, [])
        register(self.run, 'task', '{' + uid(0).upper() + '}', '  Canonical title  ')
        register_many(self.run, [EntitySeen(kind='task', id=uid(0), title='Latest title')])
        self.assertEqual(self.run.entities_seen, [EntitySeen(kind='task', id=uid(0), title='Latest title')])

    def test_harvest_fixture_for_each_verified_tool_shape(self) -> None:
        fixtures = [
            ('get_workspace_overview', {
                'workspace': {'id': uid(0), 'name': 'Acme', 'slug': 'acme'},
                'projects': [{'id': uid(1), 'title': 'Project'}],
                'roadmaps': [{'id': uid(2), 'name': 'Roadmap'}],
                'teams': [{'id': uid(3), 'name': 'Team'}],
            }, {'workspace': 'Acme', 'project': 'Project', 'roadmap': 'Roadmap', 'team': 'Team'}),
            ('list_roadmaps', {'items': [{'id': uid(0), 'name': 'Roadmap', 'project': {'id': uid(1), 'title': 'Project'}}]},
             {'roadmap': 'Roadmap', 'project': 'Project'}),
            ('search_everything', {'matches': [{
                'id': uid(0), 'kind': 'task', 'title': 'Task',
                'roadmap_id': uid(1), 'roadmap_name': 'Roadmap',
                'project_id': uid(2), 'project_title': 'Project',
                'epic_id': uid(3), 'epic_title': 'Epic',
                'feature_id': uid(4), 'feature_title': 'Feature',
            }]}, {'task': 'Task', 'roadmap': 'Roadmap', 'project': 'Project', 'epic': 'Epic', 'feature': 'Feature'}),
            ('list_my_tasks', {'tasks': [{'id': uid(0), 'title': 'Task', 'roadmap_id': uid(1), 'roadmap_name': 'Roadmap'}]},
             {'task': 'Task', 'roadmap': 'Roadmap'}),
            ('get_roadmap_overview', {'roadmap_id': uid(0), 'title': 'Roadmap', 'epics': [{
                'id': uid(1), 'title': 'Epic', 'features': [{'id': uid(2), 'title': 'Feature'}],
            }], 'milestones': [{'id': uid(3), 'title': 'Milestone'}]},
             {'roadmap': 'Roadmap', 'epic': 'Epic', 'feature': 'Feature', 'milestone': 'Milestone'}),
            ('resolve_node_reference', {'selected': {'id': uid(0), 'type': 'task', 'title': 'Task'},
                'node': {'id': uid(0), 'type': 'task', 'title': 'Task'},
                'parent': {'id': uid(1), 'type': 'feature', 'title': 'Feature'},
                'candidates': [{'id': uid(2), 'type': 'epic', 'title': 'Epic'}]},
             {'task': 'Task', 'feature': 'Feature', 'epic': 'Epic'}),
            ('get_children', {'children': [{'id': uid(0), 'type': 'task', 'title': 'Task'}],
                'parent': {'id': uid(1), 'type': 'feature', 'title': 'Feature'}},
             {'task': 'Task', 'feature': 'Feature'}),
            ('create_roadmap', {'created': True, 'roadmap': {'id': uid(0), 'name': 'Created roadmap'}},
             {'roadmap': 'Created roadmap'}),
            ('attach_roadmap_to_project', {'attached': True, 'roadmap': {
                'id': uid(0), 'name': 'Attached roadmap', 'project_id': uid(1),
            }}, {'roadmap': 'Attached roadmap'}),
        ]
        for tool_name, payload, expected in fixtures:
            with self.subTest(tool_name=tool_name):
                entries = harvest_tool_result(tool_name, payload)
                self.assertEqual({entry.kind: entry.title for entry in entries}, expected)
                self.assertEqual(len(entries), len(expected))

    def test_members_assignees_profiles_and_owner_are_never_harvested(self) -> None:
        entity = {'id': uid(0), 'type': 'task', 'title': 'Person pretending to be a task'}
        for tool_name in ('get_workspace_overview', 'future_tool'):
            self.assertEqual(harvest_tool_result(tool_name, {
                key: [entity] for key in ('members', 'assignees', 'profiles', 'owner')
            }), [])
        self.assertEqual(harvest_tool_result('list_my_tasks', {'error': {'code': 'NOT_FOUND'}, 'tasks': [entity]}), [])

    def test_task_title_is_never_borrowed_by_its_roadmap_side_id(self) -> None:
        entries = harvest_tool_result('list_my_tasks', {'tasks': [{
            'id': uid(0), 'title': 'Task title', 'roadmap_id': uid(1),
        }]})
        self.assertEqual(entries, [EntitySeen(kind='task', id=uid(0), title='Task title')])

    def test_generic_walk_requires_typed_uuid_and_is_bounded(self) -> None:
        payload = {'wrapper': {'results': [
            {'id': uid(0), 'type': 'task', 'name': 'Named task'},
            {'id': uid(1), 'title': 'Untyped'},
            {'id': 'E1', 'type': 'epic', 'title': 'Handle'},
            {'id': uid(2), 'kind': ['malformed'], 'title': 'Bad kind'},
        ]}}
        self.assertEqual(harvest_tool_result('future_tool', payload), [EntitySeen(kind='task', id=uid(0), title='Named task')])
        too_deep = {'nested': {'nested': {'nested': {'nested': {'nested': payload}}}}}
        self.assertEqual(harvest_tool_result('future_tool', too_deep), [])
        huge = {'items': [{'id': uid(i), 'kind': 'task', 'title': f'Task {i}'} for i in range(500)]}
        self.assertLessEqual(len(harvest_tool_result('future_tool', huge)), 200)

    def test_workspace_registration_and_tool_sink_round_trip_in_run_state(self) -> None:
        register_workspace_overview(self.run, {'workspace': {'id': uid(0), 'name': 'Acme'}})
        make_entity_sink(self.run)('list_my_tasks', {'tasks': [{'id': uid(1), 'title': 'Task'}]})
        restored = RunState.model_validate_json(self.run.model_dump_json())
        self.assertEqual(restored.entities_seen, self.run.entities_seen)
        self.assertEqual([entry.kind for entry in restored.entities_seen], ['workspace', 'task'])

    def test_cached_overview_seeds_missing_without_overwriting_newer_tool_titles(self) -> None:
        cached = {'workspace': {'id': uid(0), 'name': 'Acme'}, 'roadmaps': [
            {'id': uid(1), 'name': 'Cached roadmap'},
        ]}
        register(self.run, 'roadmap', uid(1), 'Newer tool title')
        register_workspace_overview(self.run, cached, replace_existing=False)
        entries = {(entry.kind, entry.id): entry.title for entry in self.run.entities_seen}
        self.assertEqual(entries[('workspace', uid(0))], 'Acme')
        self.assertEqual(entries[('roadmap', uid(1))], 'Newer tool title')
        # A genuinely new overview is the latest observation and wins.
        register_workspace_overview(self.run, {'roadmaps': [{'id': uid(1), 'name': 'Freshly fetched title'}]})
        self.assertEqual(self.run.entities_seen[0].title, 'Freshly fetched title')

    def test_build_lookup_merges_all_sources_and_committed_titles_win(self) -> None:
        self.session.metadata.workspace_context = {'workspace': {'id': uid(0), 'name': 'Acme'}}
        self.session.metadata.roadmaps[uid(1)] = RoadmapContext(
            roadmap_id=uid(1), title='Roadmap', handle_map={
                'E1': {'id': uid(2), 'type': 'epic', 'title': 'Old epic'},
            },
            project_context={'project': {
                'id': uid(9), 'title': 'Context project',
                'workspace': {'id': uid(10), 'name': 'Context workspace', 'slug': 'ctx'},
            }},
        )
        self.session.metadata.recent_resolved_targets = [RecentResolvedTarget(node_id=uid(3), node_type='task', title='Recent task')]
        self.run.resolved_refs = [
            ResolvedRef(kind='feature', id=uid(4), accessible=True, title='Feature', parent_chain=[
                {'kind': 'project', 'id': uid(5), 'title': 'Project'},
            ]),
            ResolvedRef(kind='team', id=uid(6), accessible=False, title='Denied team'),
        ]
        self.run.batches = [RunBatch(roadmap_id=uid(7), roadmap_title='Batch roadmap')]
        register(self.run, 'epic', uid(2), 'Fresh epic')
        register(self.run, 'milestone', uid(8), 'Milestone')
        before_session, before_run = self.session.model_dump(), self.run.model_dump()
        lookup = build_lookup(self.session, self.run)
        self.assertEqual(lookup[('epic', uid(2))].title, 'Fresh epic')
        self.assertEqual(set(lookup), {
            ('workspace', uid(0)), ('roadmap', uid(1)), ('epic', uid(2)), ('task', uid(3)),
            ('feature', uid(4)), ('project', uid(5)), ('roadmap', uid(7)), ('milestone', uid(8)),
            ('project', uid(9)), ('workspace', uid(10)),
        })
        self.assertEqual(self.session.model_dump(), before_session)
        self.assertEqual(self.run.model_dump(), before_run)
        self.run.commits = [RunCommit(batch_id='batch', roadmap_id=uid(1), status='committed', impacted_items=[
            {'node_type': 'epic', 'node_id': uid(2), 'title': 'Committed epic'},
        ])]
        self.assertEqual(build_lookup(self.session, self.run)[('epic', uid(2))].title, 'Committed epic')

    def test_snapshot_excludes_registry_and_registry_does_not_change_fingerprint(self) -> None:
        self.session.metadata.run = self.run
        snapshot_before = build_agent_state_snapshot(self.session)
        for index in range(MAX_ENTITIES_SEEN):
            register(self.run, 'task', uid(index), 'Huge title ' * 100)
        snapshot_after = build_agent_state_snapshot(self.session)
        self.assertNotIn('entities_seen', snapshot_after['run'])
        self.assertEqual(snapshot_fingerprint(snapshot_before), snapshot_fingerprint(snapshot_after))
        self.assertEqual(len(self.run.entities_seen), MAX_ENTITIES_SEEN)


class TitleMatchingTests(unittest.TestCase):
    def test_nfkc_casefold_prefix_and_punctuation(self) -> None:
        cases = [
            ('  (Month 1) Supply network baseline', 'supplynetworkbaseline'),
            ('ＡＣＭＥ — Roadmap!', 'acmeroadmap'),
            ('Straße', 'strasse'),
            ('ΟΣ', 'οσ'),
            ('(First) (Second) Name', 'secondname'),
        ]
        for text, expected in cases:
            self.assertEqual(normalize_title(text), expected)

    def test_equality_and_twelve_character_containment(self) -> None:
        for left, right, expected in [
            ('ACME!', 'Acme', True),
            ('(Month 1) Supply network baseline', 'Supply network baseline', True),
            ('Supply network baseline', 'Supply network baseline planning', True),
            ('123456789012', 'prefix123456789012', True),
            ('12345678901', 'prefix12345678901', False),
            ('Test', 'Test Project', False),
            ('', '', False),
            ('!!!', '---', False),
        ]:
            with self.subTest(left=left, right=right):
                self.assertEqual(titles_match(left, right), expected)
                self.assertEqual(titles_match(right, left), expected)


if __name__ == '__main__':
    unittest.main()

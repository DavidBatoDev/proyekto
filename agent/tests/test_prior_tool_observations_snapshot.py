import unittest
from types import SimpleNamespace

from app.core.orchestration.context.pending_edit_context_manager import (
    build_prior_tool_observations_snapshot,
)


def _planning(tool_observations: list | None) -> SimpleNamespace:
    """Minimal stub mirroring PlanningResult.tool_observations attribute.

    build_prior_tool_observations_snapshot uses getattr so any object
    with a `tool_observations` attribute works.
    """

    return SimpleNamespace(tool_observations=tool_observations)


class BuildPriorToolObservationsSnapshotTests(unittest.TestCase):
    """Regression: the snapshot must be built upstream of the card builder
    so the existing post-execution save persists it. The card builder no
    longer owns persistence for this field.
    """

    def test_trims_shape_and_drops_sensitive_args(self) -> None:
        observations = [
            {
                'tool_name': 'resolve_node_reference',
                'tool_args': {
                    'label': 'Job readiness & interview prep',
                    'node_type': 'epic',
                    'roadmap_id': 'rm-1',
                    'auth_header': 'Bearer xxx',
                },
                'result': {
                    'matches': [
                        {'id': 'epic-uuid', 'title': 'Job readiness & interview prep'},
                    ],
                },
            },
        ]
        snapshot = build_prior_tool_observations_snapshot(_planning(observations))
        self.assertEqual(len(snapshot), 1)
        entry = snapshot[0]
        self.assertEqual(entry['tool_name'], 'resolve_node_reference')
        self.assertNotIn('roadmap_id', entry['args'])
        self.assertNotIn('auth_header', entry['args'])
        self.assertEqual(entry['args']['label'], 'Job readiness & interview prep')
        self.assertIn('matches_count', entry['result_summary'])

    def test_caps_at_ten_entries(self) -> None:
        observations = [
            {
                'tool_name': 'resolve_node_reference',
                'tool_args': {'label': f'Epic {i}'},
                'result': {'matches': []},
            }
            for i in range(15)
        ]
        snapshot = build_prior_tool_observations_snapshot(_planning(observations))
        self.assertEqual(len(snapshot), 10)

    def test_empty_and_none_inputs_return_empty_list(self) -> None:
        self.assertEqual(build_prior_tool_observations_snapshot(_planning(None)), [])
        self.assertEqual(build_prior_tool_observations_snapshot(_planning([])), [])

    def test_malformed_entries_skipped(self) -> None:
        observations = [
            'not a dict',
            {'tool_name': ''},  # empty name → skipped
            {'tool_name': 'resolve_node_reference', 'tool_args': {'label': 'ok'}},
        ]
        snapshot = build_prior_tool_observations_snapshot(_planning(observations))
        self.assertEqual(len(snapshot), 1)
        self.assertEqual(snapshot[0]['tool_name'], 'resolve_node_reference')

    def test_preexisting_result_summary_preferred_over_raw_result(self) -> None:
        """When the planner already provided a compact result_summary (e.g.
        surfaced from the tool result logging helper), we keep it verbatim
        instead of re-summarizing from a potentially absent raw result.
        """

        observations = [
            {
                'tool_name': 'resolve_node_reference',
                'args': {'label': 'Foo'},
                'result_summary': {'matches_count': 2, 'result_type': 'dict'},
            },
        ]
        snapshot = build_prior_tool_observations_snapshot(_planning(observations))
        self.assertEqual(len(snapshot), 1)
        self.assertEqual(snapshot[0]['result_summary']['matches_count'], 2)

    def test_matched_nodes_extracted_from_resolver_result(self) -> None:
        """The LLM needs concrete node ids to stage operations — without
        them it re-calls `resolve_node_reference` on the next turn just to
        retrieve the id. The snapshot must carry {id, title, type} for
        each match.
        """
        observations = [
            {
                'tool_name': 'resolve_node_reference',
                'tool_args': {'label': 'Career Launch', 'node_type': 'epic'},
                'result': {
                    'matches': [
                        {
                            'id': 'epic-uuid-1',
                            'title': 'Career Launch: Interview Skills & Portfolio',
                            'type': 'epic',
                        },
                    ],
                },
            },
        ]
        snapshot = build_prior_tool_observations_snapshot(_planning(observations))
        self.assertEqual(len(snapshot), 1)
        entry = snapshot[0]
        self.assertIn('matched_nodes', entry)
        self.assertEqual(len(entry['matched_nodes']), 1)
        match = entry['matched_nodes'][0]
        self.assertEqual(match['id'], 'epic-uuid-1')
        self.assertEqual(match['type'], 'epic')
        self.assertEqual(match['title'], 'Career Launch: Interview Skills & Portfolio')

    def test_matched_nodes_caps_at_three(self) -> None:
        observations = [
            {
                'tool_name': 'resolve_node_reference',
                'tool_args': {'label': 'Ambiguous'},
                'result': {
                    'matches': [
                        {'id': f'uuid-{i}', 'title': f'Node {i}', 'type': 'epic'}
                        for i in range(10)
                    ],
                },
            },
        ]
        snapshot = build_prior_tool_observations_snapshot(_planning(observations))
        self.assertEqual(len(snapshot[0]['matched_nodes']), 3)

    def test_matched_nodes_skip_entries_without_id(self) -> None:
        observations = [
            {
                'tool_name': 'resolve_node_reference',
                'tool_args': {'label': 'X'},
                'result': {
                    'matches': [
                        {'title': 'Has no id'},
                        {'id': '   ', 'title': 'Blank id'},
                        {'id': 'uuid-valid', 'title': 'Good', 'type': 'epic'},
                    ],
                },
            },
        ]
        snapshot = build_prior_tool_observations_snapshot(_planning(observations))
        self.assertEqual(len(snapshot[0]['matched_nodes']), 1)
        self.assertEqual(snapshot[0]['matched_nodes'][0]['id'], 'uuid-valid')

    def test_no_matched_nodes_key_when_result_has_no_matches(self) -> None:
        """Non-resolver tools (or empty-match resolver calls) should omit
        the `matched_nodes` field entirely — no noise in the snapshot.
        """
        observations = [
            {
                'tool_name': 'resolve_node_reference',
                'tool_args': {'label': 'Nothing'},
                'result': {'matches': []},
            },
        ]
        snapshot = build_prior_tool_observations_snapshot(_planning(observations))
        self.assertEqual(len(snapshot), 1)
        self.assertNotIn('matched_nodes', snapshot[0])

    def test_prexisting_matched_nodes_field_is_preserved(self) -> None:
        """When a caller passes `matched_nodes` directly on the raw entry
        (e.g. test fixture, rehydrated snapshot) and there's no raw
        result to re-extract from, we preserve the explicit field.
        """
        observations = [
            {
                'tool_name': 'resolve_node_reference',
                'args': {'label': 'X'},
                'result_summary': {'matches_count': 1},
                'matched_nodes': [
                    {'id': 'uuid-direct', 'title': 'Direct', 'type': 'feature'},
                ],
            },
        ]
        snapshot = build_prior_tool_observations_snapshot(_planning(observations))
        self.assertEqual(len(snapshot[0]['matched_nodes']), 1)
        self.assertEqual(snapshot[0]['matched_nodes'][0]['id'], 'uuid-direct')


if __name__ == '__main__':
    unittest.main()

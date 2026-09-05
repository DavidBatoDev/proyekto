"""`_normalize_mutation_ops`: the "me" sentinel is an agent-side concept, so
the session actor's id is substituted before anything reaches the backend —
inside `patch.assignee_ids` elements, `patch.assignee_id`, and an
`add_task`'s `data.assignee_ids` / `data.assignee_id` — with the wrong-key
aliases folded by key (`assignee` -> `assignee_id`, `assignees` ->
`assignee_ids`, whatever the value) and duplicates dropped (order preserved,
first = primary)."""

import unittest

from app.core.runtime import tool_exec

ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
BEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
TASK_ID = '33333333-3333-4333-8333-333333333333'
FEATURE_ID = '22222222-2222-4222-8222-222222222222'


def _args(*operations):
    return {'assistant_message': 'ok', 'operations': list(operations)}


def _update(patch):
    return {'op': 'update_node', 'node_type': 'task', 'node_id': TASK_ID, 'patch': patch}


def _add_task(data):
    return {'op': 'add_task', 'node_type': 'task', 'parent_id': FEATURE_ID, 'data': data}


class NormalizeMutationOpsAssigneeTests(unittest.TestCase):
    def _patch(self, patch, actor_id=ACTOR):
        out = tool_exec._normalize_mutation_ops(_args(_update(patch)), actor_id=actor_id)
        return out['operations'][0]['patch']

    def test_me_inside_assignee_ids_becomes_the_actor(self):
        self.assertEqual(self._patch({'assignee_ids': ['me', BEN]})['assignee_ids'], [ACTOR, BEN])

    def test_every_self_alias_resolves_in_both_fields(self):
        for alias in ('me', 'Myself', 'self', 'current user', 'CURRENT_USER', ' me '):
            self.assertEqual(self._patch({'assignee_ids': [alias]})['assignee_ids'], [ACTOR], alias)
            self.assertEqual(self._patch({'assignee_id': alias})['assignee_id'], ACTOR, alias)

    def test_duplicates_after_substitution_are_dropped_in_order(self):
        patch = self._patch({'assignee_ids': ['me', ACTOR, BEN, BEN.upper(), 'me']})
        self.assertEqual(patch['assignee_ids'], [ACTOR, BEN])

    def test_assignees_alias_with_a_list_becomes_assignee_ids(self):
        patch = self._patch({'assignees': ['me', BEN]})
        self.assertNotIn('assignees', patch)
        self.assertEqual(patch['assignee_ids'], [ACTOR, BEN])

    def test_assignee_alias_with_a_scalar_becomes_assignee_id(self):
        patch = self._patch({'assignee': 'me'})
        self.assertNotIn('assignee', patch)
        self.assertEqual(patch['assignee_id'], ACTOR)
        self.assertNotIn('assignee_ids', patch)

    def test_assignees_alias_with_a_scalar_becomes_a_one_element_set(self):
        # The plural is folded by key, never by value type: a bare string
        # under it is wrapped, exactly as one under `assignee_ids` would be.
        patch = self._patch({'assignees': BEN})
        self.assertEqual(patch['assignee_ids'], [BEN])
        self.assertNotIn('assignee_id', patch)
        self.assertNotIn('assignees', patch)

    def test_assignees_none_leaves_assignment_unchanged(self):
        # `assignees: null` must never become `assignee_id: null` (which
        # would UNASSIGN): it lands on `assignee_ids` as a null set, which
        # the contract drops as "assignment unchanged".
        patch = self._patch({'title': 'Renamed', 'assignees': None})
        self.assertNotIn('assignees', patch)
        self.assertNotIn('assignee_id', patch)
        self.assertIn('assignee_ids', patch)
        self.assertIsNone(patch['assignee_ids'])

    def test_assignee_alias_with_a_list_is_promoted_to_the_set(self):
        patch = self._patch({'assignee': ['me', BEN]})
        self.assertNotIn('assignee', patch)
        self.assertNotIn('assignee_id', patch)
        self.assertEqual(patch['assignee_ids'], [ACTOR, BEN])

    def test_alias_never_overrides_a_canonical_key(self):
        patch = self._patch({'assignee_ids': [BEN], 'assignees': ['me']})
        self.assertEqual(patch['assignee_ids'], [BEN])
        self.assertNotIn('assignees', patch)

    def test_list_under_assignee_id_is_promoted(self):
        patch = self._patch({'assignee_id': ['me', BEN]})
        self.assertNotIn('assignee_id', patch)
        self.assertEqual(patch['assignee_ids'], [ACTOR, BEN])

    def test_string_under_assignee_ids_is_wrapped(self):
        self.assertEqual(self._patch({'assignee_ids': 'me'})['assignee_ids'], [ACTOR])

    def test_without_an_actor_the_sentinel_is_left_alone(self):
        self.assertEqual(
            self._patch({'assignee_ids': ['me', BEN]}, actor_id=None)['assignee_ids'], ['me', BEN]
        )
        self.assertEqual(self._patch({'assignee_id': 'me'}, actor_id=None)['assignee_id'], 'me')

    def test_null_and_empty_sets_pass_through(self):
        self.assertIsNone(self._patch({'assignee_id': None})['assignee_id'])
        self.assertEqual(self._patch({'assignee_ids': []})['assignee_ids'], [])

    def test_non_assignee_patches_are_untouched(self):
        self.assertEqual(
            self._patch({'title': 'X', 'priority': 'high'}), {'title': 'X', 'priority': 'high'}
        )

    def test_add_task_data_assignee_ids_resolve_me_and_dedupe(self):
        out = tool_exec._normalize_mutation_ops(
            _args(_add_task({'title': 'T', 'assignee_ids': ['me', BEN, 'me']})), actor_id=ACTOR
        )
        op = out['operations'][0]
        self.assertEqual(op['op'], 'add_task')
        self.assertEqual(op['data']['assignee_ids'], [ACTOR, BEN])
        self.assertEqual(op['data']['title'], 'T')

    def test_add_task_data_scalar_and_aliases_resolve_me(self):
        out = tool_exec._normalize_mutation_ops(
            _args(
                _add_task({'title': 'T', 'assignee_id': 'me'}),
                _add_task({'title': 'U', 'assignees': ['me']}),
                _add_task({'title': 'V', 'assignee': 'me'}),
            ),
            actor_id=ACTOR,
        )
        first, second, third = out['operations']
        self.assertEqual(first['data']['assignee_id'], ACTOR)
        self.assertEqual(second['data']['assignee_ids'], [ACTOR])
        self.assertNotIn('assignees', second['data'])
        self.assertEqual(third['data']['assignee_id'], ACTOR)
        self.assertNotIn('assignee', third['data'])

    def test_add_task_without_data_is_left_alone(self):
        op = {'op': 'add_task', 'parent_id': FEATURE_ID}
        out = tool_exec._normalize_mutation_ops(_args(op), actor_id=ACTOR)
        self.assertEqual(out['operations'][0], {'op': 'add_task', 'parent_id': FEATURE_ID})


class StageEditsEndToEndTests(unittest.TestCase):
    """Through `interpret_plan_tool`: the operations the backend would get."""

    def test_me_and_unassign_tokens_in_one_set(self):
        result = tool_exec.interpret_plan_tool(
            _args(_update({'assignee_ids': ['me', 'unassign', BEN, 'me']})), None, actor_id=ACTOR
        )
        self.assertIsInstance(result, tool_exec.PlanToolParsed)
        self.assertEqual(result.operations[0].patch['assignee_ids'], [ACTOR, BEN])

    def test_scalar_me_still_stages_the_actor(self):
        result = tool_exec.interpret_plan_tool(
            _args(_update({'assignee_id': 'me'})), None, actor_id=ACTOR
        )
        self.assertIsInstance(result, tool_exec.PlanToolParsed)
        self.assertEqual(result.operations[0].patch['assignee_id'], ACTOR)

    def test_add_task_with_me_stages_the_actor_id(self):
        result = tool_exec.interpret_plan_tool(
            _args(_add_task({'title': 'T', 'assignee_ids': ['me', BEN]})), None, actor_id=ACTOR
        )
        self.assertIsInstance(result, tool_exec.PlanToolParsed)
        self.assertEqual(result.operations[0].data['assignee_ids'], [ACTOR, BEN])

    def test_empty_set_is_a_valid_unassign_everyone_mutation(self):
        result = tool_exec.interpret_plan_tool(
            _args(_update({'assignee_ids': ['none']})), None, actor_id=ACTOR
        )
        self.assertIsInstance(result, tool_exec.PlanToolParsed)
        self.assertEqual(result.operations[0].patch['assignee_ids'], [])

    def test_null_assignee_ids_leaves_the_assignment_unchanged(self):
        # null is "key absent" everywhere: the staged patch / data never
        # carries assignee_ids, so the backend leaves the set alone.
        result = tool_exec.interpret_plan_tool(
            _args(_update({'title': 'Renamed', 'assignee_ids': None})), None, actor_id=ACTOR
        )
        self.assertIsInstance(result, tool_exec.PlanToolParsed)
        self.assertEqual(result.operations[0].patch, {'title': 'Renamed'})
        result = tool_exec.interpret_plan_tool(
            _args(_add_task({'title': 'T', 'assignee_ids': None})), None, actor_id=ACTOR
        )
        self.assertIsInstance(result, tool_exec.PlanToolParsed)
        self.assertNotIn('assignee_ids', result.operations[0].data)

    def test_assignees_none_leaves_the_assignment_unchanged_end_to_end(self):
        # The plural alias with null: the staged patch / data carry no
        # assignee key at all, so the backend leaves the set alone.
        result = tool_exec.interpret_plan_tool(
            _args(_update({'title': 'Renamed', 'assignees': None})), None, actor_id=ACTOR
        )
        self.assertIsInstance(result, tool_exec.PlanToolParsed)
        self.assertEqual(result.operations[0].patch, {'title': 'Renamed'})
        result = tool_exec.interpret_plan_tool(
            _args(_add_task({'title': 'T', 'assignees': None})), None, actor_id=ACTOR
        )
        self.assertIsInstance(result, tool_exec.PlanToolParsed)
        for key in ('assignees', 'assignee_ids', 'assignee_id'):
            self.assertNotIn(key, result.operations[0].data, key)


if __name__ == '__main__':
    unittest.main()

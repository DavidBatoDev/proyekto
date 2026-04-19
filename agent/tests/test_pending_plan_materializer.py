from __future__ import annotations

import unittest

from app.core.contracts.sessions import (
    ActorContext,
    PendingPlan,
    ProposedEpic,
    ProposedFeature,
    ProposedTask,
)
from app.core.orchestration.planning.pending_plan_materializer import (
    synthesize_operations_from_pending_plan,
)


def _make_plan(hierarchy: list[ProposedEpic]) -> PendingPlan:
    return PendingPlan(
        summary='test',
        goal='ship',
        source_user_message='please build',
        proposed_hierarchy=hierarchy,
    )


def _make_actor(actor_id: str = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') -> ActorContext:
    return ActorContext(actor_id=actor_id, roadmap_role='owner')


class SynthesizeOperationsFromPendingPlanTests(unittest.TestCase):
    def test_synthesizes_pure_create_hierarchy(self) -> None:
        plan = _make_plan(
            [
                ProposedEpic(
                    title=f'Epic {i}',
                    description=f'Epic {i} description',
                    features=[
                        ProposedFeature(
                            title=f'Feature {i}-{j}',
                            tasks=[
                                ProposedTask(title=f'Task {i}-{j}-{k}')
                                for k in range(3)
                            ],
                        )
                        for j in range(3)
                    ],
                )
                for i in range(4)
            ]
        )
        result = synthesize_operations_from_pending_plan(plan)
        self.assertIsNone(result.synthesis_skipped_reason)
        # 4 epics + 12 features + 36 tasks = 52 ops
        self.assertEqual(len(result.operations), 52)
        self.assertEqual(result.epics_count, 4)
        self.assertEqual(result.features_count, 12)
        self.assertEqual(result.tasks_count, 36)

    def test_temp_id_chain_links_parent_child(self) -> None:
        plan = _make_plan(
            [
                ProposedEpic(
                    title='E',
                    features=[
                        ProposedFeature(
                            title='F',
                            tasks=[ProposedTask(title='T')],
                        )
                    ],
                )
            ]
        )
        ops = synthesize_operations_from_pending_plan(plan).operations
        self.assertEqual(ops[0].temp_id, 'epic_0')
        self.assertIsNone(ops[0].parent_ref)
        self.assertEqual(ops[1].temp_id, 'feature_0_0')
        self.assertEqual(ops[1].parent_ref, 'epic_0')
        self.assertEqual(ops[2].temp_id, 'task_0_0_0')
        self.assertEqual(ops[2].parent_ref, 'feature_0_0')

    def test_assignee_me_resolves_to_actor_id(self) -> None:
        actor = _make_actor('11111111-1111-1111-1111-111111111111')
        plan = _make_plan(
            [
                ProposedEpic(
                    title='E',
                    features=[
                        ProposedFeature(
                            title='F',
                            tasks=[
                                ProposedTask(title='T1', assignee_label='me'),
                                ProposedTask(title='T2', assignee_label='myself'),
                                ProposedTask(title='T3', assignee_label='someone else'),
                            ],
                        )
                    ],
                )
            ]
        )
        result = synthesize_operations_from_pending_plan(plan, actor_context=actor)
        task_ops = [op for op in result.operations if op.op.value == 'add_task']
        self.assertEqual(task_ops[0].data.get('assignee_id'), actor.actor_id)
        self.assertEqual(task_ops[1].data.get('assignee_id'), actor.actor_id)
        self.assertNotIn('assignee_id', task_ops[2].data or {})
        self.assertEqual(result.assignees_resolved, 2)
        self.assertEqual(result.assignees_dropped, 1)

    def test_assignee_me_drops_when_no_actor(self) -> None:
        plan = _make_plan(
            [
                ProposedEpic(
                    title='E',
                    features=[
                        ProposedFeature(
                            title='F',
                            tasks=[ProposedTask(title='T', assignee_label='me')],
                        )
                    ],
                )
            ]
        )
        result = synthesize_operations_from_pending_plan(plan, actor_context=None)
        task_op = next(op for op in result.operations if op.op.value == 'add_task')
        self.assertNotIn('assignee_id', task_op.data or {})
        self.assertEqual(result.assignees_dropped, 1)
        self.assertEqual(result.assignees_resolved, 0)

    def test_status_clamp_normalizes_hyphen_and_case(self) -> None:
        plan = _make_plan(
            [
                ProposedEpic(
                    title='E',
                    features=[
                        ProposedFeature(
                            title='F',
                            tasks=[
                                ProposedTask(title='T1', status='in-progress'),
                                ProposedTask(title='T2', status='TODO'),
                                ProposedTask(title='T3', status='not-a-status'),
                            ],
                        )
                    ],
                )
            ]
        )
        result = synthesize_operations_from_pending_plan(plan)
        task_ops = [op for op in result.operations if op.op.value == 'add_task']
        self.assertEqual(task_ops[0].data.get('status'), 'in_progress')
        self.assertEqual(task_ops[1].data.get('status'), 'todo')
        self.assertNotIn('status', task_ops[2].data or {})
        self.assertEqual(result.statuses_dropped, 1)

    def test_empty_hierarchy_returns_skip_reason(self) -> None:
        plan = _make_plan([])
        result = synthesize_operations_from_pending_plan(plan)
        self.assertEqual(result.synthesis_skipped_reason, 'empty_hierarchy')
        self.assertEqual(result.operations, [])

    def test_anchor_present_returns_skip_reason(self) -> None:
        plan = _make_plan(
            [
                ProposedEpic(
                    title='E',
                    features=[
                        ProposedFeature(
                            title='F',
                            target_epic_title='Existing Epic',
                            tasks=[],
                        )
                    ],
                )
            ]
        )
        result = synthesize_operations_from_pending_plan(plan)
        self.assertEqual(result.synthesis_skipped_reason, 'anchor_resolution_needed')
        self.assertEqual(result.operations, [])

    def test_task_anchor_also_triggers_skip(self) -> None:
        plan = _make_plan(
            [
                ProposedEpic(
                    title='E',
                    features=[
                        ProposedFeature(
                            title='F',
                            tasks=[
                                ProposedTask(
                                    title='T',
                                    target_feature_title='Existing Feature',
                                )
                            ],
                        )
                    ],
                )
            ]
        )
        result = synthesize_operations_from_pending_plan(plan)
        self.assertEqual(result.synthesis_skipped_reason, 'anchor_resolution_needed')

    def test_assistant_message_matches_counts(self) -> None:
        plan = _make_plan(
            [
                ProposedEpic(
                    title='E',
                    features=[
                        ProposedFeature(
                            title='F',
                            tasks=[ProposedTask(title='T1'), ProposedTask(title='T2')],
                        )
                    ],
                )
            ]
        )
        result = synthesize_operations_from_pending_plan(plan)
        self.assertEqual(
            result.assistant_message,
            'Staged 1 epic, 1 feature, 2 tasks from the confirmed plan.',
        )

    def test_descriptions_passed_through_when_present(self) -> None:
        plan = _make_plan(
            [
                ProposedEpic(
                    title='E',
                    description='Epic desc',
                    features=[
                        ProposedFeature(
                            title='F',
                            description='Feature desc',
                            tasks=[ProposedTask(title='T', description='Task desc')],
                        )
                    ],
                )
            ]
        )
        ops = synthesize_operations_from_pending_plan(plan).operations
        self.assertEqual(ops[0].data.get('description'), 'Epic desc')
        self.assertEqual(ops[1].data.get('description'), 'Feature desc')
        self.assertEqual(ops[2].data.get('description'), 'Task desc')

    def test_missing_descriptions_omitted_from_data(self) -> None:
        plan = _make_plan([ProposedEpic(title='E', features=[])])
        ops = synthesize_operations_from_pending_plan(plan).operations
        self.assertEqual(ops[0].data, {'title': 'E'})
        self.assertNotIn('description', ops[0].data)


class SynthesizedPlanningResultGuardCompatibilityTests(unittest.TestCase):
    """Regression: the hybrid-react terminal guard rejects PlanningResult
    values that don't use `draft_action in {continue,revise,new_draft}` and
    `stop_reason == 'ready_to_stage'` when ops are present. When the edit
    guard rejects a synthesized result, the user ends up in a confirmation
    loop (guard swaps the result for an `ask_clarifier` stub, ops are
    discarded, next turn the user confirms again — infinite loop).
    """

    def _tiny_plan(self) -> PendingPlan:
        return PendingPlan(
            summary='test',
            goal='ship',
            source_user_message='please build',
            proposed_hierarchy=[
                ProposedEpic(
                    title='E',
                    features=[
                        ProposedFeature(
                            title='F',
                            tasks=[ProposedTask(title='T')],
                        )
                    ],
                )
            ],
        )

    def test_synthesized_planning_result_uses_continue_draft_action(self) -> None:
        from app.core.orchestration.planning.planning_result_dispatcher import (
            _planning_result_from_synthesis,
        )

        synth = synthesize_operations_from_pending_plan(self._tiny_plan())
        planning = _planning_result_from_synthesis(synth)
        self.assertIn(planning.draft_action, {'continue', 'revise', 'new_draft'})

    def test_synthesized_planning_result_uses_ready_to_stage_stop_reason(self) -> None:
        from app.core.orchestration.planning.planning_result_dispatcher import (
            _planning_result_from_synthesis,
        )

        synth = synthesize_operations_from_pending_plan(self._tiny_plan())
        planning = _planning_result_from_synthesis(synth)
        self.assertEqual(planning.stop_reason, 'ready_to_stage')

    def test_synthesized_planning_result_passes_hybrid_react_guard(self) -> None:
        """End-to-end check: feed the synthesized result through the hybrid
        react terminal guard and assert it does NOT get converted into a
        clarifier handoff. Previously `draft_action='stage'` tripped the
        `planner_schema_missing_draft_action` branch, causing the loop
        observed in logs.txt session d1e3ad09.
        """
        from app.core.orchestration.planning.planning_result_dispatcher import (
            _planning_result_from_synthesis,
        )
        from app.core.orchestration.react.react_guardrails import (
            enforce_hybrid_react_terminal_guard,
        )

        synth = synthesize_operations_from_pending_plan(self._tiny_plan())
        planning = _planning_result_from_synthesis(synth)

        def _fail_handoff(**_kwargs):
            self.fail(
                'enforce_hybrid_react_terminal_guard built a clarifier '
                'handoff for a synthesized result — this triggers the '
                'confirmation loop regression.'
            )

        handoff = enforce_hybrid_react_terminal_guard(
            planning=planning,
            route_lane='deterministic_plan_apply',
            user_message='yes, apply this plan',
            agent_hybrid_react_enabled=True,
            build_react_guard_handoff=_fail_handoff,
            is_rename_message=lambda _msg: False,
            has_rename_shape_operation=lambda _ops: False,
            recover_rename_shape_operations=lambda **_kwargs: None,
        )
        self.assertIsNone(handoff)


if __name__ == '__main__':
    unittest.main()

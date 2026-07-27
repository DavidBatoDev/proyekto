"""Stage-time enforcement of the per-node-type `update_node` patch allow-list.

Regression cover for a production failure: "assign all tasks and all features to
Joshua" staged `update_node patch.assignee_id` on features. Nothing on the agent
side objected, so the whole batch reached the backend, which rejected it at apply
time with `Field "assignee_id" is not allowed for update_node` — discarding the
VALID task assignments too, and surfacing an error the model never saw and so
could not correct. The guard turns that into a tool error fed back into the loop.
"""

import json
import unittest

from app.core.config import get_settings
from app.core.tools.registry import UPDATE_NODE_PATCH_FIELDS
from app.core.v2 import tools_exec
from app.core.v2.loop import run_loop
from app.core.v2.openai_client import LLMResponse, ToolCall

EPIC_ID = '11111111-1111-4111-8111-111111111111'
FEATURE_ID = '22222222-2222-4222-8222-222222222222'
TASK_ID = '33333333-3333-4333-8333-333333333333'
MILESTONE_ID = '44444444-4444-4444-8444-444444444444'
JOSHUA_ID = '99999999-9999-4999-8999-999999999999'

HANDLE_MAP = {
    'E1': {'id': EPIC_ID, 'type': 'epic', 'title': 'Discovery'},
    'E1.F1': {'id': FEATURE_ID, 'type': 'feature', 'title': 'Research'},
    'M1': {'id': MILESTONE_ID, 'type': 'milestone', 'title': 'Launch'},
}


def _update(node_id, patch, node_type=None):
    op = {'op': 'update_node', 'node_id': node_id, 'patch': patch}
    if node_type is not None:
        op['node_type'] = node_type
    return op


def _stage(operations, assistant_message='Staged.'):
    return {'operations': operations, 'assistant_message': assistant_message}


class UpdateNodePatchFieldGuardTests(unittest.TestCase):
    def test_shared_contract_matrix_loaded(self):
        """The allow-list comes from schemas/roadmap-ai-operations.json, not a
        second hardcoded copy that could drift from the backend."""
        self.assertEqual(
            set(UPDATE_NODE_PATCH_FIELDS),
            {'roadmap', 'epic', 'feature', 'task', 'milestone'},
        )
        self.assertIn('assignee_id', UPDATE_NODE_PATCH_FIELDS['task'])
        for node_type in ('epic', 'feature', 'milestone', 'roadmap'):
            self.assertNotIn('assignee_id', UPDATE_NODE_PATCH_FIELDS[node_type])
        # roadmap_features has no status column.
        self.assertNotIn('status', UPDATE_NODE_PATCH_FIELDS['feature'])

    def test_assignee_on_feature_is_rejected(self):
        result = tools_exec.interpret_plan_tool(
            _stage([_update(FEATURE_ID, {'assignee_id': JOSHUA_ID})]),
            HANDLE_MAP,
        )
        self.assertIsInstance(result, tools_exec.PlanToolError)
        self.assertIn('assignee_id', result.message)
        self.assertIn('feature', result.message)
        # Actionable: names the legal fields and what to do instead.
        self.assertIn('Only tasks can be assigned', result.message)
        self.assertIn('is_deliverable', result.message)

    def test_assignee_on_epic_is_rejected(self):
        result = tools_exec.interpret_plan_tool(
            _stage([_update(EPIC_ID, {'assignee_id': JOSHUA_ID})]),
            HANDLE_MAP,
        )
        self.assertIsInstance(result, tools_exec.PlanToolError)
        self.assertIn('epic', result.message)

    def test_status_on_feature_is_rejected(self):
        """Second drift of the same class: the backend used to allow
        feature.status even though the column does not exist."""
        result = tools_exec.interpret_plan_tool(
            _stage([_update(FEATURE_ID, {'status': 'in_progress'})]),
            HANDLE_MAP,
        )
        self.assertIsInstance(result, tools_exec.PlanToolError)
        self.assertIn('derived from its child tasks', result.message)

    def test_live_type_wins_over_declared_node_type(self):
        """The model mislabelling a feature as a task must not buy it past the
        guard — the outline is the authority on what a node is."""
        result = tools_exec.interpret_plan_tool(
            _stage([_update(FEATURE_ID, {'assignee_id': JOSHUA_ID}, node_type='task')]),
            HANDLE_MAP,
        )
        self.assertIsInstance(result, tools_exec.PlanToolError)
        self.assertIn('feature', result.message)

    def test_assignee_on_task_is_allowed(self):
        """Tasks are not in the outline, so the id is unknown; the declared
        node_type carries it and assignee_id is legal for a task."""
        result = tools_exec.interpret_plan_tool(
            _stage([_update(TASK_ID, {'assignee_id': JOSHUA_ID}, node_type='task')]),
            HANDLE_MAP,
        )
        self.assertIsInstance(result, tools_exec.PlanToolParsed)
        self.assertEqual(len(result.operations), 1)
        self.assertEqual(result.operations[0].patch['assignee_id'], JOSHUA_ID)

    def test_unknown_target_is_left_to_the_backend(self):
        """An id absent from the outline with no declared type is unverifiable
        here — pass it through rather than guessing and blocking a valid edit."""
        result = tools_exec.interpret_plan_tool(
            _stage([_update(TASK_ID, {'assignee_id': JOSHUA_ID})]),
            HANDLE_MAP,
        )
        self.assertIsInstance(result, tools_exec.PlanToolParsed)

    def test_legal_patches_still_pass(self):
        result = tools_exec.interpret_plan_tool(
            _stage(
                [
                    _update(EPIC_ID, {'title': 'Discovery v2', 'priority': 'high'}),
                    _update(FEATURE_ID, {'is_deliverable': True}),
                    _update(MILESTONE_ID, {'target_date': '2026-09-01'}),
                ]
            ),
            HANDLE_MAP,
        )
        self.assertIsInstance(result, tools_exec.PlanToolParsed)
        self.assertEqual(len(result.operations), 3)

    def test_handle_targets_are_resolved_before_the_check(self):
        """Handles (E1.F1) expand to ids during parse; the guard must still see
        the resolved feature, not an unrecognised handle string."""
        result = tools_exec.interpret_plan_tool(
            _stage([_update('E1.F1', {'assignee_id': JOSHUA_ID})]),
            HANDLE_MAP,
        )
        self.assertIsInstance(result, tools_exec.PlanToolError)
        self.assertIn('feature', result.message)


class GuardFeedsBackIntoTheLoopTests(unittest.TestCase):
    """The whole point of stage-time rejection: the model gets the error as a
    tool result and re-stages, all inside one user turn."""

    def test_model_self_corrects_within_the_turn(self):
        bad = _stage(
            [
                _update(TASK_ID, {'assignee_id': JOSHUA_ID}, node_type='task'),
                _update(FEATURE_ID, {'assignee_id': JOSHUA_ID}),
            ],
            'Assigned everything to Joshua.',
        )
        good = _stage(
            [_update(TASK_ID, {'assignee_id': JOSHUA_ID}, node_type='task')],
            'Assigned the tasks to Joshua; features cannot be assigned.',
        )
        client = _ScriptedClient(
            [_plan_resp('call_1', bad), _plan_resp('call_2', good)]
        )
        messages = [{'role': 'user', 'content': 'assign all tasks and features to Joshua'}]

        result = run_loop(
            client=client,
            messages=messages,
            tools=[],
            dispatcher=None,
            session_context={},
            handle_map=HANDLE_MAP,
            settings=get_settings(),
            trace_id=None,
        )

        self.assertEqual(result.kind, 'edit')
        self.assertEqual(len(result.operations), 1)
        self.assertIn('cannot be assigned', result.assistant_message)
        self.assertEqual(client.call_count, 2)
        # The rejection reached the model as a tool result, not a dead end.
        outputs = [m for m in messages if m.get('type') == 'function_call_output']
        self.assertEqual(len(outputs), 1)
        self.assertIn('assignee_id', outputs[0]['output'])


def _plan_resp(call_id, args):
    return LLMResponse(
        content=None,
        tool_calls=[
            ToolCall(
                id=call_id,
                name='plan_roadmap_operations',
                arguments=args,
                raw_arguments=json.dumps(args),
            )
        ],
    )


class _ScriptedClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.call_count = 0

    def complete(self, messages, tools, **kwargs):
        self.call_count += 1
        return self._responses.pop(0)


if __name__ == '__main__':
    unittest.main()

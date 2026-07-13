"""v2 single-loop behavior tests, driven by a scripted fake LLM client.

Covers: terminal selection (chat / edit / propose_plan / ask_user), parallel
reads then a terminal, plan-tool error feedback + self-correction (no repair
lane), and budget exhaustion.
"""

import json
import unittest
from unittest.mock import patch

from app.core.config import get_settings
from app.core.v2.loop import _is_announcement_without_action, run_loop
from app.core.v2.openai_client import LLMResponse, ToolCall, V2LLMClient


def _tool_resp(name, args, content=None):
    return LLMResponse(
        content=content,
        tool_calls=[
            ToolCall(id=f'call_{name}', name=name, arguments=args, raw_arguments=json.dumps(args))
        ],
    )


def _text_resp(text):
    return LLMResponse(content=text, tool_calls=[])


class _ScriptedClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.call_count = 0
        self.last_messages = None

    def complete(self, messages, tools):
        self.call_count += 1
        self.last_messages = list(messages)
        return self._responses.pop(0)


class _LoopingClient:
    """Always returns the same response (for budget tests)."""

    def __init__(self, response):
        self._response = response

    def complete(self, messages, tools):
        return self._response


class _FakeDispatcher:
    def __init__(self, results=None):
        self._results = results or {}
        self.calls = []

    def execute_many(self, calls, session_context):
        self.calls.extend(calls)
        return [self._results.get(name, {'ok': True, 'tool': name}) for name, _ in calls]

    def execute(self, name, args, session_context):
        return self._results.get(name, {'ok': True})


def _settings(**overrides):
    return get_settings().model_copy(update=overrides)


_VALID_EDIT_ARGS = {
    'assistant_message': 'Added the epic.',
    'operations': [{'op': 'add_epic', 'data': {'title': 'Growth'}}],
}


def _run(client, dispatcher=None, settings=None, handle_map=None, pending_plan_titles=None):
    return run_loop(
        client=client,
        messages=[{'role': 'system', 'content': 'sys'}, {'role': 'user', 'content': 'hi'}],
        tools=[],
        dispatcher=dispatcher or _FakeDispatcher(),
        session_context={'roadmap_id': 'rm1'},
        handle_map=handle_map or {},
        settings=settings or _settings(),
        trace_id=None,
        pending_plan_titles=pending_plan_titles,
    )


class V2LoopTests(unittest.TestCase):
    def test_plain_text_is_chat_terminal(self):
        result = _run(_ScriptedClient([_text_resp('Here is the answer.')]))
        self.assertEqual(result.kind, 'chat')
        self.assertEqual(result.assistant_message, 'Here is the answer.')

    def test_plan_tool_with_operations_is_edit_terminal(self):
        result = _run(_ScriptedClient([_tool_resp('plan_roadmap_operations', _VALID_EDIT_ARGS)]))
        self.assertEqual(result.kind, 'edit')
        self.assertEqual(len(result.operations), 1)
        self.assertEqual(result.operations[0].op.value, 'add_epic')
        self.assertEqual(result.assistant_message, 'Added the epic.')

    def test_read_then_edit(self):
        dispatcher = _FakeDispatcher({'resolve_node_reference': {'matches': [{'id': 'x', 'type': 'epic'}]}})
        client = _ScriptedClient([
            _tool_resp('resolve_node_reference', {'label': 'Signup'}),
            _tool_resp('plan_roadmap_operations', _VALID_EDIT_ARGS),
        ])
        result = _run(client, dispatcher=dispatcher)
        self.assertEqual(result.kind, 'edit')
        self.assertTrue(result.used_read_tools)
        self.assertEqual(dispatcher.calls[0][0], 'resolve_node_reference')
        self.assertEqual(client.call_count, 2)

    def test_plan_tool_error_is_fed_back_then_self_corrects(self):
        # First call: update_node with no target -> parse error -> fed back.
        # Second call: valid -> edit terminal. No repair lane involved.
        client = _ScriptedClient([
            _tool_resp('plan_roadmap_operations', {'operations': [{'op': 'update_node'}]}),
            _tool_resp('plan_roadmap_operations', _VALID_EDIT_ARGS),
        ])
        result = _run(client)
        self.assertEqual(result.kind, 'edit')
        self.assertEqual(client.call_count, 2)
        # The error was handed back as a function_call_output before the retry.
        outputs = [m for m in client.last_messages if m.get('type') == 'function_call_output']
        self.assertTrue(any('INVALID_OPERATIONS' in (m.get('output') or '') for m in outputs))

    def test_empty_plan_tool_payload_is_fed_back_then_self_corrects(self):
        for malformed_args in ({}, {'assistant_message': '', 'operations': []}):
            with self.subTest(malformed_args=malformed_args):
                client = _ScriptedClient([
                    _tool_resp('plan_roadmap_operations', malformed_args),
                    _tool_resp('plan_roadmap_operations', _VALID_EDIT_ARGS),
                ])
                with patch('app.core.v2.loop.progress.tool_rejected') as rejected:
                    result = _run(client)

                self.assertEqual(result.kind, 'edit')
                self.assertEqual(client.call_count, 2)
                self.assertNotEqual(result.assistant_message, 'Prepared roadmap operations.')
                outputs = [
                    message
                    for message in client.last_messages
                    if message.get('type') == 'function_call_output'
                ]
                self.assertTrue(
                    any('INVALID_OPERATIONS' in (message.get('output') or '') for message in outputs)
                )
                rejected.assert_called_once()
                self.assertEqual(rejected.call_args.kwargs['reason'], 'empty_action_payload')
                self.assertEqual(rejected.call_args.kwargs['operations_count'], 0)

    def test_plan_tool_operations_without_message_remain_edit(self):
        result = _run(
            _ScriptedClient([
                _tool_resp(
                    'plan_roadmap_operations',
                    {'operations': [{'op': 'add_epic', 'data': {'title': 'Growth'}}]},
                )
            ])
        )
        self.assertEqual(result.kind, 'edit')
        self.assertEqual(result.assistant_message, '')
        self.assertEqual(len(result.operations), 1)

    def test_empty_plan_tool_question_remains_clarifier(self):
        result = _run(
            _ScriptedClient([
                _tool_resp(
                    'plan_roadmap_operations',
                    {
                        'assistant_message': 'Which epic should I update?',
                        'operations': [],
                        'clarifier_options': ['Growth', 'Retention'],
                    },
                )
            ])
        )
        self.assertEqual(result.kind, 'clarifier')
        self.assertEqual(result.clarifier['options'], ['Growth', 'Retention'])

    def test_propose_plan_terminal(self):
        args = {
            'summary': 'A growth plan',
            'goal': 'Grow',
            'proposed_hierarchy': [{'title': 'Acquisition', 'features': []}],
        }
        result = _run(_ScriptedClient([_tool_resp('propose_plan', args)]))
        self.assertEqual(result.kind, 'plan_proposal')
        self.assertEqual(result.plan_payload['summary'], 'A growth plan')

    def test_ask_user_terminal(self):
        args = {'question': 'Which epic?', 'options': ['Growth', 'Retention']}
        result = _run(_ScriptedClient([_tool_resp('ask_user', args)]))
        self.assertEqual(result.kind, 'clarifier')
        self.assertEqual(result.clarifier['question'], 'Which epic?')
        self.assertEqual(result.clarifier['options'], ['Growth', 'Retention'])
        # Legacy args synthesize a single canonical question.
        questions = result.clarifier['questions']
        self.assertEqual(len(questions), 1)
        self.assertEqual(questions[0]['question'], 'Which epic?')
        self.assertFalse(questions[0]['multi_select'])
        self.assertEqual(
            [o['label'] for o in questions[0]['options']], ['Growth', 'Retention']
        )

    def test_ask_user_multi_question_terminal(self):
        args = {
            'lane': 'edit',
            'questions': [
                {
                    'header': 'Target epic',
                    'question': 'Which epic?',
                    'options': [
                        {'label': 'Growth', 'description': 'has 3 features'},
                        {'label': 'Retention'},
                    ],
                },
                {
                    'question': 'Which fields should I update?',
                    'multi_select': True,
                    'options': ['Status', 'Assignee', 'Due date'],  # bare strings coerce
                },
            ],
        }
        result = _run(_ScriptedClient([_tool_resp('ask_user', args)]))
        self.assertEqual(result.kind, 'clarifier')
        questions = result.clarifier['questions']
        self.assertEqual(len(questions), 2)
        self.assertEqual(questions[0]['header'], 'Target epic')
        self.assertEqual(questions[0]['options'][0]['description'], 'has 3 features')
        self.assertTrue(questions[1]['multi_select'])
        self.assertEqual(
            [o['label'] for o in questions[1]['options']],
            ['Status', 'Assignee', 'Due date'],
        )
        self.assertTrue(all(q['id'] for q in questions))
        # Legacy mirror = questions[0]; assistant message carries every question.
        self.assertEqual(result.clarifier['question'], 'Which epic?')
        self.assertEqual(result.clarifier['options'], ['Growth', 'Retention'])
        self.assertIn('Which fields should I update?', result.assistant_message)

    def test_ask_user_questions_wins_over_legacy_args(self):
        args = {
            'question': 'Legacy question?',
            'options': ['Old'],
            'questions': [{'question': 'New question?', 'options': [{'label': 'New'}]}],
        }
        result = _run(_ScriptedClient([_tool_resp('ask_user', args)]))
        self.assertEqual(result.clarifier['question'], 'New question?')
        self.assertEqual(result.clarifier['options'], ['New'])

    def test_ask_user_caps_and_dedupes(self):
        args = {
            'questions': [
                {
                    'question': f'Question {i}?',
                    'options': [{'label': 'A'}, {'label': 'A'}]  # duplicate label
                    + [{'label': f'opt{j}'} for j in range(8)],  # over the cap
                }
                for i in range(5)  # over the cap
            ],
        }
        result = _run(_ScriptedClient([_tool_resp('ask_user', args)]))
        questions = result.clarifier['questions']
        self.assertEqual(len(questions), 4)
        labels = [o['label'] for o in questions[0]['options']]
        self.assertEqual(len(labels), 6)
        self.assertEqual(labels.count('A'), 1)

    def test_ask_user_zero_options_forces_allow_custom(self):
        args = {
            'questions': [
                {'question': 'What deadline?', 'allow_custom': False, 'options': []}
            ],
        }
        result = _run(_ScriptedClient([_tool_resp('ask_user', args)]))
        self.assertTrue(result.clarifier['questions'][0]['allow_custom'])
        self.assertTrue(result.clarifier['allow_custom'])

    def test_ask_user_all_invalid_is_fed_back_then_self_corrects(self):
        client = _ScriptedClient([
            _tool_resp('ask_user', {'questions': [{'question': '   '}]}),
            _tool_resp('ask_user', {'question': 'Which epic?', 'options': ['Growth']}),
        ])
        result = _run(client)
        self.assertEqual(result.kind, 'clarifier')
        self.assertEqual(client.call_count, 2)
        outputs = [m for m in client.last_messages if m.get('type') == 'function_call_output']
        self.assertTrue(any('MISSING_QUESTION' in (m.get('output') or '') for m in outputs))

    def test_textual_option_question_is_nudged_to_ask_user(self):
        # A plain-text question listing choices strands the user (nothing to
        # click) — the loop must nudge once and accept the ask_user re-issue.
        textual_options = 'Which epic should I use?\n- Growth\n- Retention'
        ask_args = {'question': 'Which epic should I use?', 'options': ['Growth', 'Retention']}
        client = _ScriptedClient([
            _text_resp(textual_options),
            _tool_resp('ask_user', ask_args),
        ])
        result = _run(client)
        self.assertEqual(result.kind, 'clarifier')
        self.assertEqual(result.clarifier['options'], ['Growth', 'Retention'])
        self.assertEqual(client.call_count, 2)
        # The nudge is one-shot: if the model insists on text, accept it.
        client = _ScriptedClient([_text_resp(textual_options), _text_resp(textual_options)])
        result = _run(client)
        self.assertEqual(result.kind, 'chat')

    def test_plain_question_without_options_is_not_nudged(self):
        result = _run(_ScriptedClient([_text_resp('What deadline did you have in mind?')]))
        self.assertEqual(result.kind, 'chat')
        self.assertEqual(result.termination_reason, 'assistant_text')

    def test_budget_exhaustion_on_max_turns(self):
        client = _LoopingClient(_tool_resp('search_nodes', {'query': 'x'}))
        result = _run(client, settings=_settings(agent_v2_max_turns=2, agent_v2_max_tool_calls=99))
        self.assertEqual(result.kind, 'budget')
        self.assertIn(result.termination_reason, {'max_turns', 'max_tool_calls'})

    def test_unknown_tool_is_reported_and_loop_continues(self):
        client = _ScriptedClient([
            _tool_resp('not_a_real_tool', {'x': 1}),
            _text_resp('done'),
        ])
        result = _run(client)
        self.assertEqual(result.kind, 'chat')
        outputs = [m for m in client.last_messages if m.get('type') == 'function_call_output']
        self.assertTrue(any('UNKNOWN_TOOL' in (m.get('output') or '') for m in outputs))


class V2PlanRevisionGuardTests(unittest.TestCase):
    """Bug B regression: a live edit must not be swallowed as a plan revision.

    Repro from the live sweep: with a pending plan open, "rename epic X to Y"
    was emitted as revision_operations -> routed to plan_revision -> staged=0
    (silent no-op). The guard rejects revision ops whose target isn't in the
    pending plan and feeds the error back so the model re-stages via operations.
    """

    @staticmethod
    def _revision_resp(epic_title, new_title):
        return _tool_resp(
            'plan_roadmap_operations',
            {
                'assistant_message': f'Renamed {epic_title}.',
                'operations': [],
                'revision_operations': [
                    {'op': 'rename_epic', 'epic_title': epic_title, 'new_title': new_title}
                ],
            },
        )

    def test_revision_op_on_live_item_without_pending_plan_is_fed_back(self):
        client = _ScriptedClient([
            self._revision_resp('PW-Telemetry-A', 'PW-Telemetry-A2'),
            _tool_resp('plan_roadmap_operations', _VALID_EDIT_ARGS),
        ])
        result = _run(client, pending_plan_titles=frozenset())
        self.assertEqual(result.kind, 'edit')  # self-corrected, real change staged
        self.assertEqual(client.call_count, 2)
        outputs = [m for m in client.last_messages if m.get('type') == 'function_call_output']
        self.assertTrue(
            any('NOT_A_PLAN_REVISION' in (m.get('output') or '') for m in outputs)
        )

    def test_revision_op_on_live_item_when_unrelated_plan_pending_is_fed_back(self):
        # The exact sweep scenario: a referral-program plan is pending, but the
        # rename targets a live epic NOT in that plan -> still a misroute.
        client = _ScriptedClient([
            self._revision_resp('PW-Telemetry-A', 'PW-Telemetry-A2'),
            _tool_resp('plan_roadmap_operations', _VALID_EDIT_ARGS),
        ])
        result = _run(client, pending_plan_titles=frozenset({'referral rewards', 'sharing'}))
        self.assertEqual(result.kind, 'edit')
        outputs = [m for m in client.last_messages if m.get('type') == 'function_call_output']
        self.assertTrue(
            any('NOT_A_PLAN_REVISION' in (m.get('output') or '') for m in outputs)
        )

    def test_revision_op_targeting_pending_plan_item_routes_to_plan_revision(self):
        # Legit: the target title IS in the pending plan -> revise the plan.
        client = _ScriptedClient([self._revision_resp('Referral Rewards', 'Loyalty Rewards')])
        result = _run(client, pending_plan_titles=frozenset({'referral rewards'}))
        self.assertEqual(result.kind, 'plan_revision')
        self.assertEqual(
            result.revision_operations[0]['new_title'], 'Loyalty Rewards'
        )


class V2DuplicateEpicGuardTests(unittest.TestCase):
    """Bug A regression: don't re-create an epic already on the live roadmap."""

    _LIVE = {'E1': {'id': 'u-1', 'type': 'epic', 'title': 'Growth'}}

    def test_duplicate_add_epic_against_live_is_dropped(self):
        args = {
            'assistant_message': 'Added epics.',
            'operations': [
                {'op': 'add_epic', 'data': {'title': 'Growth'}},  # already live
                {'op': 'add_epic', 'data': {'title': 'Retention'}},  # new
            ],
        }
        result = _run(
            _ScriptedClient([_tool_resp('plan_roadmap_operations', args)]),
            handle_map=self._LIVE,
        )
        self.assertEqual(result.kind, 'edit')
        self.assertEqual(len(result.operations), 1)
        self.assertEqual(result.operations[0].data['title'], 'Retention')

    def test_all_duplicate_add_epics_becomes_noop_chat(self):
        args = {
            'assistant_message': '',
            'operations': [{'op': 'add_epic', 'data': {'title': 'growth'}}],  # case-insensitive
        }
        result = _run(
            _ScriptedClient([_tool_resp('plan_roadmap_operations', args)]),
            handle_map=self._LIVE,
        )
        self.assertEqual(result.kind, 'chat')
        self.assertEqual(result.termination_reason, 'duplicate_noop')

    def test_duplicate_epic_with_children_is_kept_to_preserve_chain(self):
        # The dup epic's temp_id is referenced by a child -> keep it, dropping
        # it would orphan the feature.
        args = {
            'assistant_message': 'Rebuilt Growth.',
            'operations': [
                {'op': 'add_epic', 'temp_id': 'temp_e1', 'data': {'title': 'Growth'}},
                {'op': 'add_feature', 'parent_ref': 'temp_e1', 'data': {'title': 'Signups'}},
            ],
        }
        result = _run(
            _ScriptedClient([_tool_resp('plan_roadmap_operations', args)]),
            handle_map=self._LIVE,
        )
        self.assertEqual(result.kind, 'edit')
        self.assertEqual(len(result.operations), 2)


class V2UpdateNodePatchFoldTests(unittest.TestCase):
    """Regression: a rename emitted as update_node + data={title} must be
    folded into patch (data is not allowed on update_node — backend 400s)."""

    def test_update_node_data_title_folded_into_patch(self):
        args = {
            'assistant_message': 'Renamed it.',
            'operations': [
                {
                    'op': 'update_node',
                    'node_type': 'epic',
                    'node_id': '11111111-1111-1111-1111-111111111111',
                    'data': {'title': 'New Name'},
                }
            ],
        }
        result = _run(_ScriptedClient([_tool_resp('plan_roadmap_operations', args)]))
        self.assertEqual(result.kind, 'edit')
        op = result.operations[0]
        self.assertEqual(op.op.value, 'update_node')
        self.assertEqual(op.patch, {'title': 'New Name'})
        self.assertIsNone(op.data)


class V2RefHandleExpansionTests(unittest.TestCase):
    """Regression: a handle in a *_ref field (e.g. a move's new_parent_ref)
    must resolve into the matching *_id field — otherwise the literal handle
    reaches the backend and 400s the commit."""

    _LIVE = {
        'E1.F2': {
            'id': '44444444-4444-4444-4444-444444444444',
            'type': 'feature',
            'title': 'Delivery',
        }
    }

    def test_handle_in_new_parent_ref_moves_to_new_parent_id(self):
        args = {
            'assistant_message': 'Moved the task.',
            'operations': [
                {
                    'op': 'update_node',
                    'node_type': 'task',
                    'node_id': '33333333-3333-3333-3333-333333333333',
                    'new_parent_ref': 'E1.F2',
                }
            ],
        }
        result = _run(
            _ScriptedClient([_tool_resp('plan_roadmap_operations', args)]),
            handle_map=self._LIVE,
        )
        self.assertEqual(result.kind, 'edit')
        op = result.operations[0]
        # A reparenting update_node is retagged to move_node, and the handle in
        # new_parent_ref is resolved into new_parent_id.
        self.assertEqual(op.op.value, 'move_node')
        self.assertEqual(op.new_parent_id, '44444444-4444-4444-4444-444444444444')
        self.assertIsNone(op.new_parent_ref)


class V2TempRefIdFieldNormalizationTests(unittest.TestCase):
    """Regression: plan-confirm batches often put temp refs in parent_id.

    The operation contract reserves *_id for UUIDs and *_ref for same-batch
    temp IDs. Normalize the common model slip before validation so confirmation
    can stage the generated roadmap instead of falling through to chat.
    """

    def test_creation_chain_temp_parent_id_is_moved_to_parent_ref(self):
        args = {
            'assistant_message': 'Staged the roadmap.',
            'operations': [
                {
                    'op': 'add_epic',
                    'temp_id': 'epic_platform',
                    'data': {'title': 'Platform foundation', 'status': 'planned'},
                },
                {
                    'op': 'add_feature',
                    'parent_id': 'epic_platform',
                    'temp_id': 'feat_auth',
                    'data': {'title': 'User authentication and profiles'},
                },
                {
                    'op': 'add_task',
                    'parent_id': 'feat_auth',
                    'data': {
                        'title': 'Sign up, sign in, and password reset',
                        'status': 'todo',
                    },
                },
            ],
        }

        result = _run(_ScriptedClient([_tool_resp('plan_roadmap_operations', args)]))

        self.assertEqual(result.kind, 'edit')
        self.assertEqual(len(result.operations), 3)
        self.assertEqual(result.operations[1].parent_ref, 'epic_platform')
        self.assertIsNone(result.operations[1].parent_id)
        self.assertEqual(result.operations[2].parent_ref, 'feat_auth')
        self.assertIsNone(result.operations[2].parent_id)


class _FakeResp:
    def __init__(self):
        self.output = [
            {'type': 'message', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': 'ok'}]}
        ]
        self.usage = None
        self.status = 'completed'


class _FakeResponses:
    def __init__(self):
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if 'reasoning' in kwargs:
            # Mirror a model that rejects the reasoning param.
            raise RuntimeError(
                'reasoning is not supported for this model. Please use a different setting.'
            )
        return _FakeResp()


class _FakeOpenAI:
    def __init__(self):
        self.responses = _FakeResponses()


class V2ClientSelfHealTests(unittest.TestCase):
    def test_drops_reasoning_when_model_rejects_it(self):
        settings = get_settings().model_copy(
            update={'openai_v2_reasoning_effort': 'low', 'openai_model_v2': 'gpt-5.4-mini'}
        )
        client = V2LLMClient(settings)
        fake = _FakeOpenAI()
        client._client = fake  # inject so _ensure_client returns it
        resp = client.complete([{'role': 'user', 'content': 'hi'}], [])
        self.assertEqual(resp.content, 'ok')
        self.assertTrue(client._drop_reasoning)
        calls = fake.responses.calls
        self.assertEqual(len(calls), 2)
        self.assertIn('reasoning', calls[0])
        self.assertNotIn('reasoning', calls[1])
        # Subsequent calls skip reasoning up front (no failed round-trip).
        client.complete([{'role': 'user', 'content': 'again'}], [])
        self.assertNotIn('reasoning', fake.responses.calls[2])


class V2AnnounceNudgeTests(unittest.TestCase):
    """A plain-text reply that announces work ("I'll draft…") without a tool
    call is nudged once to act instead of being accepted as a chat terminal."""

    _ANNOUNCE = (
        "I’ll draft a roadmap structure that starts with problem "
        'requirements and then moves into technological requirements.'
    )

    def test_announcement_is_nudged_then_plan_lands(self):
        args = {
            'summary': 'SaaS for data scientists',
            'goal': 'Draft the roadmap',
            'proposed_hierarchy': [{'title': 'Problem requirements', 'features': []}],
        }
        client = _ScriptedClient([
            _text_resp(self._ANNOUNCE),
            _tool_resp('propose_plan', args),
        ])
        result = _run(client)
        self.assertEqual(result.kind, 'plan_proposal')
        self.assertEqual(client.call_count, 2)
        # The nudge rode into the second call as a system message.
        nudges = [
            m for m in client.last_messages
            if m.get('role') == 'system' and 'announced work' in str(m.get('content'))
        ]
        self.assertEqual(len(nudges), 1)

    def test_nudge_fires_only_once(self):
        # A model that keeps announcing gets one nudge, then its second
        # announcement is accepted as the (bad) chat answer — no infinite loop.
        client = _ScriptedClient([
            _text_resp(self._ANNOUNCE),
            _text_resp(self._ANNOUNCE),
        ])
        result = _run(client)
        self.assertEqual(result.kind, 'chat')
        self.assertEqual(client.call_count, 2)

    def test_normal_chat_answer_is_not_nudged(self):
        result = _run(_ScriptedClient([_text_resp('Your roadmap has two epics.')]))
        self.assertEqual(result.kind, 'chat')

    def test_detection_matches_observed_failure(self):
        self.assertTrue(_is_announcement_without_action(self._ANNOUNCE))

    def test_detection_ignores_questions_and_long_answers(self):
        self.assertFalse(
            _is_announcement_without_action(
                "I'll draft it — should the plan include auth?"
            )
        )
        self.assertFalse(_is_announcement_without_action('x' * 300))
        self.assertFalse(
            _is_announcement_without_action('Here is a summary of your roadmap.')
        )
        self.assertFalse(_is_announcement_without_action(''))


if __name__ == '__main__':
    unittest.main()

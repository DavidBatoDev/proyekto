"""End-to-end v2 brain path: AgentService.plan_message -> run_v2_message ->
loop -> outcome, with the OpenAI client monkeypatched to a scripted fake.
Exercises the router branch, context prep, staging, and envelope assembly
together without a live model or network.
"""

import json
import unittest

import app.core.v2.brain as brain_mod
from app.core.contracts.sessions import AgentSession, Message
from app.core.orchestration.agent_service import AgentService
from app.core.v2.openai_client import LLMResponse, ToolCall


class _MemoryStore:
    def update(self, session):
        return session

    def append_message(self, session, role, content, *, tool_calls=None, tool_call_id=None):
        session.messages.append(
            Message(role=role, content=content, tool_calls=tool_calls, tool_call_id=tool_call_id)
        )
        return session


class _FakeClient:
    script = []

    def __init__(self, settings):
        self._queue = list(_FakeClient.script)

    def complete(self, messages, tools):
        return self._queue.pop(0)


def _tool_resp(name, args):
    return LLMResponse(
        tool_calls=[ToolCall(id=f'c_{name}', name=name, arguments=args, raw_arguments=json.dumps(args))]
    )


def _v2_session():
    session = AgentSession(roadmap_id='22222222-2222-2222-2222-222222222222')
    session.metadata.brain_version = 'v2'
    return session


class V2BrainEndToEndTests(unittest.TestCase):
    def setUp(self):
        self._orig_client = brain_mod.V2LLMClient
        brain_mod.V2LLMClient = _FakeClient

    def tearDown(self):
        brain_mod.V2LLMClient = self._orig_client
        _FakeClient.script = []

    def test_edit_end_to_end_via_plan_message(self):
        _FakeClient.script = [
            _tool_resp(
                'plan_roadmap_operations',
                {
                    'assistant_message': 'Created the Growth epic.',
                    'operations': [{'op': 'add_epic', 'data': {'title': 'Growth'}}],
                },
            )
        ]
        service = AgentService(_MemoryStore())
        session = _v2_session()
        outcome = service.plan_message(session, 'add an epic called Growth', False)
        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(outcome.route_lane, 'v2_edit')
        self.assertEqual(len(outcome.operations), 1)
        self.assertEqual(outcome.staged_operations_count, 1)

    def test_chat_end_to_end_via_plan_message(self):
        _FakeClient.script = [LLMResponse(content='Your roadmap has one epic.')]
        service = AgentService(_MemoryStore())
        session = _v2_session()
        outcome = service.plan_message(session, 'how many epics?', False)
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.assistant_message, 'Your roadmap has one epic.')


class V2CompactStatePendingPlanTests(unittest.TestCase):
    """The confirm turn re-stages operations from the compact-state plan block.
    Rendering only the one-line summary made the model silently drop the
    plan's features/tasks (observed live: 'apply the plan' created the feature
    but none of its tasks)."""

    def test_pending_plan_block_renders_full_hierarchy(self):
        from app.core.v2.context import compact_state

        session = _v2_session()
        session_context = {
            'roadmap_overview_summary': 'Roadmap: 1 epic',
            'pending_plan': {
                'summary': 'Add password reset under Live-Drive.',
                'proposed_hierarchy': [
                    {
                        'title': 'Live-Drive',
                        'features': [
                            {
                                'title': 'Password Reset',
                                'target_epic_title': 'Live-Drive',
                                'tasks': [
                                    {'title': 'Build reset endpoint'},
                                    {'title': 'Send reset email'},
                                ],
                            }
                        ],
                    }
                ],
            },
        }
        state = compact_state(session, session_context)
        self.assertIn('# Pending plan awaiting user confirmation', state)
        self.assertIn('- Epic: Live-Drive', state)
        self.assertIn(
            '- Feature: Password Reset (under existing epic: Live-Drive)', state
        )
        self.assertIn('- Task: Build reset endpoint', state)
        self.assertIn('- Task: Send reset email', state)
        self.assertIn('stage operations that create EVERY item', state)


if __name__ == '__main__':
    unittest.main()

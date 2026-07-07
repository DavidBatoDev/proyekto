"""v2 terminal -> MessagePlanningOutcome envelope, router branch, and schema
parity. Uses a real AgentService with an in-memory store so staging, recent-
target recording, and metadata persistence run through the real code paths.
"""

import unittest
from datetime import datetime, timezone

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, Message
from app.core.orchestration.agent_service import AgentService
from app.core.tools.registry import get_planning_tool
from app.core.v2 import tools_spec
from app.core.v2.loop import LoopResult
from app.core.v2.terminal import to_outcome


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class _MemoryStore:
    def __init__(self):
        self.update_calls = 0

    def update(self, session):
        self.update_calls += 1
        return session

    def append_message(self, session, role, content, *, tool_calls=None, tool_call_id=None):
        session.messages.append(
            Message(role=role, content=content, tool_calls=tool_calls, tool_call_id=tool_call_id)
        )
        return self.update(session)


def _service():
    return AgentService(_MemoryStore())


def _session():
    return AgentSession(roadmap_id='11111111-1111-1111-1111-111111111111')


def _outcome(loop_result, session=None, used_reads=False):
    session = session or _session()
    return to_outcome(
        service=_service(),
        session=session,
        loop_result=loop_result,
        session_context={'roadmap_id': session.roadmap_id},
        user_message='do the thing',
        trace_id=None,
        utcnow=_utcnow,
    )


class V2OutcomeTests(unittest.TestCase):
    def test_edit_stages_and_sets_edit_plan_mode(self):
        session = _session()
        op = RoadmapOperation(op='add_epic', data={'title': 'Growth'})
        result = LoopResult(kind='edit', assistant_message='Added Growth.', operations=[op])
        outcome = _outcome(result, session=session)
        self.assertEqual(outcome.response_mode, 'edit_plan')
        self.assertEqual(outcome.intent_type, 'roadmap_edit')
        self.assertEqual(len(outcome.operations), 1)
        self.assertEqual(outcome.staged_operations_count, 1)
        self.assertEqual(len(session.operations), 1)
        # auto-commit trigger condition (route_flows): edit_plan + staged ops
        self.assertTrue(outcome.response_mode == 'edit_plan' and outcome.staged_operations_count > 0)

    def test_chat_with_reads_is_context_answer(self):
        result = LoopResult(kind='chat', assistant_message='3 items are blocked.', used_read_tools=True)
        outcome = _outcome(result)
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertEqual(outcome.parse_mode, 'context_answer')
        self.assertEqual(outcome.intent_type, 'roadmap_query')
        self.assertEqual(outcome.operations, [])

    def test_plan_proposal_records_pending_plan(self):
        session = _session()
        result = LoopResult(
            kind='plan_proposal',
            plan_payload={
                'summary': 'A plan',
                'goal': 'Ship',
                'proposed_hierarchy': [{'title': 'Acquisition', 'features': []}],
            },
        )
        outcome = _outcome(result, session=session)
        self.assertEqual(outcome.response_mode, 'plan_proposal')
        self.assertIsNotNone(outcome.plan_proposal_payload)
        self.assertIsNotNone(session.metadata.pending_plan)
        self.assertEqual(session.metadata.pending_plan.proposed_hierarchy[0].title, 'Acquisition')

    def test_clarifier_builds_card(self):
        result = LoopResult(
            kind='clarifier',
            clarifier={'lane': 'edit', 'question': 'Which one?', 'options': ['A', 'B'], 'allow_custom': True},
        )
        outcome = _outcome(result)
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertIsNotNone(outcome.clarifier_card)
        self.assertEqual(outcome.clarifier_card['question'], 'Which one?')
        self.assertIn('question_id', outcome.clarifier_card)
        self.assertEqual(outcome.clarifier_card['options'], ['A', 'B'])
        # Legacy-only dict (implicit edit-tool path) synthesizes `questions`.
        questions = outcome.clarifier_card['questions']
        self.assertEqual(len(questions), 1)
        self.assertEqual(questions[0]['question'], 'Which one?')
        self.assertEqual([o['label'] for o in questions[0]['options']], ['A', 'B'])
        self._assert_card_survives_contract(outcome.clarifier_card)

    def test_clarifier_card_carries_multi_questions_with_legacy_mirror(self):
        questions = [
            {
                'id': 'q1',
                'header': 'Target epic',
                'question': 'Which epic?',
                'multi_select': False,
                'allow_custom': True,
                'options': [{'label': 'Growth', 'description': 'has 3 features'}],
            },
            {
                'id': 'q2',
                'header': None,
                'question': 'Which fields?',
                'multi_select': True,
                'allow_custom': True,
                'options': [{'label': 'Status', 'description': None}],
            },
        ]
        result = LoopResult(
            kind='clarifier',
            clarifier={'lane': 'edit', 'questions': questions,
                       'question': 'Which epic?', 'options': ['Growth'], 'allow_custom': True},
        )
        outcome = _outcome(result)
        card = outcome.clarifier_card
        self.assertEqual(len(card['questions']), 2)
        self.assertTrue(card['questions'][1]['multi_select'])
        # Legacy mirror = questions[0].
        self.assertEqual(card['question'], 'Which epic?')
        self.assertEqual(card['options'], ['Growth'])
        self._assert_card_survives_contract(card)

    def test_budget_emits_graceful_clarifier(self):
        outcome = _outcome(LoopResult(kind='budget', termination_reason='max_turns'))
        self.assertEqual(outcome.response_mode, 'chat')
        self.assertIsNotNone(outcome.clarifier_card)
        self.assertEqual(outcome.clarifier_card['reason'], 'budget_exhausted')
        # The budget card is a 0-option question — must stay answerable via
        # the free-form input, and must carry a synthesized `questions` entry.
        questions = outcome.clarifier_card['questions']
        self.assertEqual(len(questions), 1)
        self.assertTrue(questions[0]['allow_custom'])
        self.assertEqual(questions[0]['options'], [])
        self._assert_card_survives_contract(outcome.clarifier_card)

    def _assert_card_survives_contract(self, card):
        # MessageResponse.clarifier is typed ClarifierCard — pydantic silently
        # strips unknown keys, so `questions` must exist on the model or the
        # whole feature no-ops on the wire.
        from app.core.contracts.sessions import ClarifierCard

        dumped = ClarifierCard.model_validate(card).model_dump()
        self.assertEqual(
            [q['question'] for q in dumped['questions']],
            [q['question'] for q in card['questions']],
        )

    def test_outcome_persists_user_and_assistant_messages(self):
        session = _session()
        _outcome(LoopResult(kind='chat', assistant_message='hi'), session=session)
        roles = [m.role for m in session.messages]
        self.assertEqual(roles[-2:], ['user', 'assistant'])


class V2SchemaParityTests(unittest.TestCase):
    @staticmethod
    def _plan_tool(tools):
        return next(t for t in tools if t['function']['name'] == 'plan_roadmap_operations')

    def test_write_tool_schema_matches_registry_when_plan_pending(self):
        # With a pending plan the revision lane is legitimately available, so
        # the schema stays byte-for-byte identical to the shared registry tool.
        v2_plan = self._plan_tool(tools_spec.build_tools(has_pending_plan=True))
        self.assertEqual(
            v2_plan['function']['parameters'],
            get_planning_tool()['function']['parameters'],
        )

    def test_revision_operations_stripped_when_no_plan_pending(self):
        # Default (no pending plan): revision_operations is removed so the
        # model can't misroute a live edit into the revision lane.
        v2_plan = self._plan_tool(tools_spec.build_tools())
        props = v2_plan['function']['parameters']['properties']
        self.assertNotIn('revision_operations', props)
        self.assertIn('operations', props)
        self.assertNotIn('DUAL-TARGET CONTRACT', v2_plan['function']['description'])
        # operations schema itself is untouched vs the registry.
        self.assertEqual(
            props['operations'],
            get_planning_tool()['function']['parameters']['properties']['operations'],
        )


if __name__ == '__main__':
    unittest.main()

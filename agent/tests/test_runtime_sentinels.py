"""Round-trip tests for the web card sentinels folded by sentinels.py.

The clarifier answer path had no coverage before the multi-question upgrade;
these tests pin both the new `answers` payload and the legacy single-answer
payload byte-for-byte.
"""

import json
import unittest

from app.core.contracts.runs import ContextRef
from app.core.contracts.sessions import AgentSession, PendingPlan
from app.core.runtime.sentinels import (
    CONFIRM_FOLD_TEXT,
    REJECT_FOLD_TEXT,
    RunInput,
    parse_and_fold,
    parse_user_input,
)


def _session():
    return AgentSession(roadmap_id='11111111-1111-1111-1111-111111111111')


class ParseUserInputTests(unittest.TestCase):
    """`parse_user_input` classifies the message into a RunInput kind with the
    same folded text `parse_and_fold` produced before runs existed, and has no
    side effects (a reject is a run transition the orchestrator applies)."""

    def test_plain_message(self):
        refs = [ContextRef(kind='roadmap', id='r-1', label='Alpha')]
        parsed = parse_user_input(_session(), 'rename the epic', refs)
        self.assertIsInstance(parsed, RunInput)
        self.assertEqual(parsed.kind, 'message')
        self.assertEqual(parsed.text, 'rename the epic')
        self.assertEqual(parsed.raw, 'rename the epic')
        self.assertEqual(parsed.refs, refs)
        self.assertFalse(parsed.is_confirm)
        self.assertFalse(parsed.is_reject)

    def test_clarifier_answer_kind_carries_question_id(self):
        message = _clarifier_message(
            {
                'lane': 'edit',
                'question_id': 'q-77',
                'answers': [{'question': 'Which epic?', 'selected_options': ['Growth']}],
            }
        )
        parsed = parse_user_input(_session(), message)
        self.assertEqual(parsed.kind, 'clarifier_answer')
        self.assertEqual(parsed.text, 'Growth')
        self.assertEqual(parsed.question_id, 'q-77')
        self.assertEqual(parsed.text, parse_and_fold(_session(), message))

    def test_plan_answers_kind_replays_source_message(self):
        session = _session()
        session.metadata.pending_plan = PendingPlan(
            source_user_message='Plan a booking app', status='awaiting_answers'
        )
        message = '__plan_answers__\n' + json.dumps(
            {'answers': [{'question_id': 'q1', 'selected_option': 'MVP only'}]}
        )
        parsed = parse_user_input(session, message)
        self.assertEqual(parsed.kind, 'plan_answers')
        self.assertEqual(
            parsed.text,
            'My original request: Plan a booking app\n'
            'My answers: MVP only\n'
            'Please produce the plan now with these answers.',
        )

    def test_plan_decision_confirm_keeps_pending_plan_and_folds_apply_text(self):
        session = _session()
        session.metadata.pending_plan = PendingPlan(source_user_message='x', plan_id='p-1')
        message = '__plan_decision__\n' + json.dumps(
            {'decision': 'confirm', 'plan_id': 'p-1', 'note': 'skip the last task'}
        )
        parsed = parse_user_input(session, message)
        self.assertEqual(parsed.kind, 'plan_decision')
        self.assertTrue(parsed.is_confirm)
        self.assertEqual(parsed.plan_id, 'p-1')
        self.assertEqual(parsed.note, 'skip the last task')
        self.assertEqual(parsed.text, CONFIRM_FOLD_TEXT + ' Note: skip the last task')
        self.assertIsNotNone(session.metadata.pending_plan)

    def test_plan_decision_reject_has_no_side_effect(self):
        session = _session()
        session.metadata.pending_plan = PendingPlan(source_user_message='x', plan_id='p-1')
        message = '__plan_decision__\n' + json.dumps({'decision': 'reject', 'plan_id': 'p-1'})
        parsed = parse_user_input(session, message)
        self.assertTrue(parsed.is_reject)
        self.assertEqual(parsed.text, REJECT_FOLD_TEXT)
        # Clearing the plan is the orchestrator's transition, not parsing.
        self.assertIsNotNone(session.metadata.pending_plan)

    def test_malformed_plan_decision_is_a_plain_message(self):
        parsed = parse_user_input(_session(), '__plan_decision__\nnot json')
        self.assertEqual(parsed.kind, 'message')


def _clarifier_message(payload):
    return '__clarifier_answer__\n' + json.dumps(payload)


class ClarifierAnswerFoldTests(unittest.TestCase):
    def test_single_answer_folds_to_bare_value(self):
        # One question, one selection — the model sees just the answer text,
        # exactly like the legacy payload behaved.
        message = _clarifier_message(
            {
                'lane': 'edit',
                'answers': [
                    {
                        'question_id': 'q1',
                        'question': 'Which epic?',
                        'selected_options': ['Growth'],
                    }
                ],
            }
        )
        self.assertEqual(parse_and_fold(_session(), message), 'Growth')

    def test_multi_select_single_question_joins_values(self):
        message = _clarifier_message(
            {
                'lane': 'edit',
                'answers': [
                    {
                        'question_id': 'q1',
                        'question': 'Which fields?',
                        'selected_options': ['Status', 'Assignee'],
                    }
                ],
            }
        )
        self.assertEqual(parse_and_fold(_session(), message), 'Status, Assignee')

    def test_multi_question_folds_to_replay_text(self):
        message = _clarifier_message(
            {
                'lane': 'edit',
                'answers': [
                    {
                        'question_id': 'q1',
                        'question': 'Which epic?',
                        'selected_options': ['Growth'],
                    },
                    {
                        'question_id': 'q2',
                        'question': 'Which fields?',
                        'selected_options': ['Status'],
                        'custom_answer': 'also the owner',
                    },
                ],
            }
        )
        folded = parse_and_fold(_session(), message)
        self.assertIn('My answers to your questions:', folded)
        self.assertIn('- Which epic?: Growth', folded)
        self.assertIn('- Which fields?: Status, also the owner', folded)
        self.assertIn('Please continue with these answers.', folded)

    def test_entry_with_only_custom_answer(self):
        message = _clarifier_message(
            {
                'lane': 'edit',
                'answers': [
                    {'question_id': 'q1', 'question': 'What deadline?', 'custom_answer': ' March 3 '}
                ],
            }
        )
        self.assertEqual(parse_and_fold(_session(), message), 'March 3')

    def test_empty_answers_falls_back_to_legacy_keys(self):
        message = _clarifier_message(
            {'lane': 'edit', 'answers': [], 'selected_option': 'Growth'}
        )
        self.assertEqual(parse_and_fold(_session(), message), 'Growth')

    def test_legacy_selected_option_payload(self):
        message = _clarifier_message(
            {'lane': 'edit', 'question_id': 'x', 'selected_option': 'Growth'}
        )
        self.assertEqual(parse_and_fold(_session(), message), 'Growth')

    def test_legacy_custom_answer_takes_precedence(self):
        message = _clarifier_message(
            {'lane': 'edit', 'custom_answer': 'the second one', 'selected_option': 'A'}
        )
        self.assertEqual(parse_and_fold(_session(), message), 'the second one')

    def test_malformed_json_returns_message_unchanged(self):
        message = '__clarifier_answer__\nnot json {'
        self.assertEqual(parse_and_fold(_session(), message), message)

    def test_non_sentinel_message_passes_through(self):
        self.assertEqual(parse_and_fold(_session(), 'rename the epic'), 'rename the epic')


if __name__ == '__main__':
    unittest.main()

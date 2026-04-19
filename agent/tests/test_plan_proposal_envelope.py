from __future__ import annotations

import unittest

from app.core.llm.planning.planner_execution_flow import (
    _parse_plan_proposal_envelope,
)


class ParsePlanProposalEnvelopeTests(unittest.TestCase):
    def test_parses_valid_envelope_and_splits_assistant_message(self) -> None:
        raw = (
            '{"status":"plan_ready","assistant_message":"Prepared plan.",'
            '"summary":"A summary.","proposed_hierarchy":[]}'
        )
        message, payload = _parse_plan_proposal_envelope(raw)
        self.assertEqual(message, 'Prepared plan.')
        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertNotIn('assistant_message', payload)
        self.assertEqual(payload.get('status'), 'plan_ready')
        self.assertEqual(payload.get('summary'), 'A summary.')
        self.assertEqual(payload.get('proposed_hierarchy'), [])

    def test_strips_user_message_echo_from_payload(self) -> None:
        raw = (
            '{"status":"plan_ready","assistant_message":"Prepared.",'
            '"user_message":"build me something","summary":"x"}'
        )
        message, payload = _parse_plan_proposal_envelope(raw)
        self.assertEqual(message, 'Prepared.')
        assert payload is not None
        self.assertNotIn('user_message', payload)

    def test_fenced_json_block_is_unwrapped(self) -> None:
        raw = '```json\n{"status":"plan_ready","assistant_message":"Prepared."}\n```'
        message, payload = _parse_plan_proposal_envelope(raw)
        self.assertEqual(message, 'Prepared.')
        assert payload is not None
        self.assertEqual(payload.get('status'), 'plan_ready')

    def test_malformed_envelope_regex_recovers_assistant_message(self) -> None:
        # Trailing comma makes this invalid JSON; the parser must still
        # extract the assistant_message so the raw JSON never renders in
        # the chat bubble.
        raw = (
            '{"status":"plan_ready",'
            '"assistant_message":"I prepared a focused 2026 roadmap.",'
            '"proposed_hierarchy":[],}'
        )
        message, payload = _parse_plan_proposal_envelope(raw)
        self.assertEqual(message, 'I prepared a focused 2026 roadmap.')
        self.assertIsNone(payload)
        self.assertNotIn('{', message)
        self.assertNotIn('proposed_hierarchy', message)

    def test_malformed_envelope_falls_back_to_summary(self) -> None:
        raw = (
            '{"status":"plan_ready",'
            '"summary":"12-month full-stack plan.",'
            '"proposed_hierarchy":[],}'
        )
        message, payload = _parse_plan_proposal_envelope(raw)
        self.assertEqual(message, '12-month full-stack plan.')
        self.assertIsNone(payload)

    def test_envelope_with_embedded_newlines_in_string_recovers(self) -> None:
        # The LLM sometimes emits raw newlines inside string values —
        # invalid per the JSON spec but common. Regex recovery must still
        # extract the assistant_message intact.
        raw = (
            '{"status":"plan_ready","assistant_message":"line1\nline2"}'
        )
        message, payload = _parse_plan_proposal_envelope(raw)
        self.assertEqual(message, 'line1\nline2')
        self.assertIsNone(payload)

    def test_raw_json_blob_never_leaks_into_message(self) -> None:
        # Corrupted envelope: cannot parse, looks like one — assistant_message
        # must never be the raw JSON-shaped string.
        raw = (
            '{"status":"plan_ready","proposed_hierarchy":[{"title":"Broken'
        )
        message, payload = _parse_plan_proposal_envelope(raw)
        self.assertNotIn('proposed_hierarchy', message)
        self.assertNotIn('{', message)
        self.assertIsNone(payload)

    def test_plain_chat_reply_passes_through_unchanged(self) -> None:
        raw = 'Hello, I can help you plan the roadmap.'
        message, payload = _parse_plan_proposal_envelope(raw)
        self.assertEqual(message, raw)
        self.assertIsNone(payload)

    def test_empty_input_returns_empty_strings(self) -> None:
        message, payload = _parse_plan_proposal_envelope('')
        self.assertEqual(message, '')
        self.assertIsNone(payload)
        message, payload = _parse_plan_proposal_envelope('   \n\n   ')
        self.assertEqual(message, '')
        self.assertIsNone(payload)


if __name__ == '__main__':
    unittest.main()

from __future__ import annotations

import unittest

from app.core.orchestration.context.actor_context_provider import (
    is_actor_context_required_message,
    should_fetch_actor_context,
)


class ActorContextProviderTests(unittest.TestCase):
    def test_is_actor_context_required_message_detects_me_reference(self) -> None:
        self.assertTrue(
            is_actor_context_required_message(
                'Assigned all tasks to me inside the Agent Module'
            )
        )

    def test_is_actor_context_required_message_detects_user_reference(self) -> None:
        self.assertTrue(
            is_actor_context_required_message('Assign all tasks in Agent Module to user')
        )

    def test_should_fetch_actor_context_for_simple_edit_when_actor_reference_present(self) -> None:
        should_fetch, skip_reason = should_fetch_actor_context(
            preview_intent='roadmap_edit',
            user_message='Rename my Platform Foundation to Platform Foundation 1',
            auth_header='Bearer token',
            simple_edit_detected=True,
            actor_context_present=False,
        )
        self.assertTrue(should_fetch)
        self.assertIsNone(skip_reason)

    def test_should_skip_simple_edit_without_actor_reference(self) -> None:
        should_fetch, skip_reason = should_fetch_actor_context(
            preview_intent='roadmap_edit',
            user_message='Rename Platform Foundation to Platform Foundation 1',
            auth_header='Bearer token',
            simple_edit_detected=True,
            actor_context_present=False,
        )
        self.assertFalse(should_fetch)
        self.assertEqual(skip_reason, 'simple_edit_turn')


if __name__ == '__main__':
    unittest.main()


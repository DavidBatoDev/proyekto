from __future__ import annotations

import unittest
from types import SimpleNamespace
from typing import Any

from app.core.llm.planning import planner_history_utils


class _DummyUserMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class _DummyAssistantMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class PlannerHistoryUtilsTests(unittest.TestCase):
    def _planner(self) -> Any:
        return SimpleNamespace(
            _settings=SimpleNamespace(max_chat_history_messages=3),
            _history_messages_cache={},
            _history_messages_cache_max_entries=2,
        )

    def test_history_messages_cache_key_is_deterministic(self) -> None:
        history_slice = [
            {'role': 'user', 'content': 'hello'},
            {'role': 'assistant', 'content': 'hi'},
        ]
        key_a = planner_history_utils.history_messages_cache_key(
            history_slice=history_slice,
            history_limit=3,
        )
        key_b = planner_history_utils.history_messages_cache_key(
            history_slice=history_slice,
            history_limit=3,
        )
        self.assertEqual(key_a, key_b)

    def test_build_history_messages_converts_and_caches(self) -> None:
        planner = self._planner()
        session_context = {
            'recent_messages': [
                {'role': 'user', 'content': 'first'},
                {'role': 'assistant', 'content': 'second'},
                {'role': 'user', 'content': 'third'},
            ]
        }

        first = planner_history_utils.build_history_messages(
            planner,
            session_context=session_context,
            max_messages=None,
            ai_message_cls=_DummyAssistantMessage,
            human_message_cls=_DummyUserMessage,
        )
        second = planner_history_utils.build_history_messages(
            planner,
            session_context=session_context,
            max_messages=None,
            ai_message_cls=_DummyAssistantMessage,
            human_message_cls=_DummyUserMessage,
        )

        self.assertEqual(len(first), 3)
        self.assertEqual(len(second), 3)
        self.assertEqual(first[0].content, 'first')
        self.assertEqual(first[1].content, 'second')
        self.assertEqual(first[2].content, 'third')
        self.assertEqual(len(planner._history_messages_cache), 1)

    def test_build_history_messages_honors_cache_eviction_limit(self) -> None:
        planner = self._planner()

        for index in range(3):
            session_context = {
                'recent_messages': [
                    {'role': 'user', 'content': f'msg-{index}'},
                ]
            }
            planner_history_utils.build_history_messages(
                planner,
                session_context=session_context,
                max_messages=1,
                ai_message_cls=_DummyAssistantMessage,
                human_message_cls=_DummyUserMessage,
            )

        self.assertLessEqual(len(planner._history_messages_cache), 2)


if __name__ == '__main__':
    unittest.main()

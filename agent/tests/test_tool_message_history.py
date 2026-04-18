"""Tool-message history: the structural replacement for `prior_tool_observations`.

Persisted `assistant(tool_calls=...)` + `tool(tool_call_id=...)` pairs on
`session.messages` replayed through `_build_history_messages` as proper
LangChain `AIMessage(tool_calls=...)` + `ToolMessage(...)` pairs. This
module proves the contract: pairs round-trip through Redis-equivalent
serialization, reconstruct as the right LangChain types, and the cap
never orphans a tool message from its assistant precursor.
"""

from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.core.contracts.sessions import AgentSession, Message
from app.core.llm.planning.planner_history_utils import (
    _prune_respecting_tool_pairs,
    build_history_messages,
)


class _FakeAIMessage:
    def __init__(self, content: str = '', tool_calls: list[dict] | None = None) -> None:
        self.content = content
        self.tool_calls = tool_calls


class _FakeHumanMessage:
    def __init__(self, content: str = '') -> None:
        self.content = content


class _FakeToolMessage:
    def __init__(self, content: str = '', tool_call_id: str | None = None) -> None:
        self.content = content
        self.tool_call_id = tool_call_id


def _planner(max_messages: int = 50) -> SimpleNamespace:
    return SimpleNamespace(_settings=SimpleNamespace(max_chat_history_messages=max_messages))


def _ctx(messages: list[dict]) -> dict:
    return {'recent_messages': messages}


class MessageModelToolFieldsTests(unittest.TestCase):
    def test_message_accepts_and_roundtrips_tool_calls_and_id(self) -> None:
        original = Message(
            role='assistant',
            content='',
            tool_calls=[{
                'id': 'call_abc',
                'name': 'resolve_node_reference',
                'args': {},
            }],
        )
        raw = original.model_dump_json()
        reparsed = Message.model_validate_json(raw)
        self.assertEqual(reparsed.role, 'assistant')
        self.assertEqual(reparsed.tool_calls[0]['id'], 'call_abc')
        self.assertIsNone(reparsed.tool_call_id)

    def test_langchain_ai_message_accepts_our_persisted_shape(self) -> None:
        """Regression: a real LangChain AIMessage must accept the exact
        shape we write into Message.tool_calls. The wire shape
        ({id, type, function}) fails LangChain's backward-compat
        validator. Canonical shape ({id, name, args}) passes.
        """
        try:
            from langchain_core.messages import AIMessage
        except ImportError:
            self.skipTest('langchain_core not installed')
        tool_calls = [{'id': 'call_xyz', 'name': 'resolve_node_reference', 'args': {'label': 'X'}}]
        ai = AIMessage(content='', tool_calls=tool_calls)
        self.assertEqual(len(ai.tool_calls), 1)
        self.assertEqual(ai.tool_calls[0]['id'], 'call_xyz')
        self.assertEqual(ai.tool_calls[0]['name'], 'resolve_node_reference')

    def test_tool_role_message_roundtrip(self) -> None:
        original = Message(role='tool', content='{"matches": []}', tool_call_id='call_abc')
        reparsed = Message.model_validate_json(original.model_dump_json())
        self.assertEqual(reparsed.role, 'tool')
        self.assertEqual(reparsed.tool_call_id, 'call_abc')

    def test_legacy_message_without_tool_fields_still_parses(self) -> None:
        # Sessions persisted before this field existed have no tool_calls
        # or tool_call_id keys. Rehydration must default them to None.
        raw = json.dumps({'role': 'user', 'content': 'hello'})
        reparsed = Message.model_validate_json(raw)
        self.assertIsNone(reparsed.tool_calls)
        self.assertIsNone(reparsed.tool_call_id)


class BuildHistoryMessagesTests(unittest.TestCase):
    def test_emits_langchain_tool_pairs(self) -> None:
        history = [
            {'role': 'user', 'content': 'rename my last epic'},
            {
                'role': 'assistant',
                'content': '',
                'tool_calls': [
                    {
                        'id': 'call_1',
                        'name': 'resolve_node_reference',
                        'args': {'label': 'epic'},
                    }
                ],
            },
            {'role': 'tool', 'content': '{"matches":[]}', 'tool_call_id': 'call_1'},
            {'role': 'assistant', 'content': 'I found it'},
        ]
        messages = build_history_messages(
            _planner(),
            session_context=_ctx(history),
            max_messages=None,
            ai_message_cls=_FakeAIMessage,
            human_message_cls=_FakeHumanMessage,
            tool_message_cls=_FakeToolMessage,
        )
        self.assertEqual(len(messages), 4)
        self.assertIsInstance(messages[0], _FakeHumanMessage)
        self.assertIsInstance(messages[1], _FakeAIMessage)
        self.assertEqual(messages[1].tool_calls[0]['id'], 'call_1')
        self.assertIsInstance(messages[2], _FakeToolMessage)
        self.assertEqual(messages[2].tool_call_id, 'call_1')
        self.assertIsInstance(messages[3], _FakeAIMessage)
        self.assertIsNone(messages[3].tool_calls)

    def test_assistant_with_empty_content_but_tool_calls_is_kept(self) -> None:
        # Regression: the old builder dropped every message with empty
        # content, which would have silently erased the AIMessage side of
        # a tool-call pair. The tool result would then be an orphan.
        history = [
            {
                'role': 'assistant',
                'content': '',
                'tool_calls': [{'id': 'c1', 'name': 't', 'args': {}}],
            },
            {'role': 'tool', 'content': 'x', 'tool_call_id': 'c1'},
        ]
        messages = build_history_messages(
            _planner(),
            session_context=_ctx(history),
            max_messages=None,
            ai_message_cls=_FakeAIMessage,
            human_message_cls=_FakeHumanMessage,
            tool_message_cls=_FakeToolMessage,
        )
        self.assertEqual(len(messages), 2)
        self.assertIsInstance(messages[0], _FakeAIMessage)
        self.assertIsInstance(messages[1], _FakeToolMessage)

    def test_unknown_role_is_dropped(self) -> None:
        history = [
            {'role': 'user', 'content': 'hi'},
            {'role': 'system', 'content': 'debug info'},
            {'role': 'garbage', 'content': 'nope'},
        ]
        messages = build_history_messages(
            _planner(),
            session_context=_ctx(history),
            max_messages=None,
            ai_message_cls=_FakeAIMessage,
            human_message_cls=_FakeHumanMessage,
            tool_message_cls=_FakeToolMessage,
        )
        self.assertEqual(len(messages), 1)
        self.assertIsInstance(messages[0], _FakeHumanMessage)

    def test_tool_role_skipped_when_tool_message_cls_missing(self) -> None:
        # Legacy providers / tests that don't pass tool_message_cls must
        # skip tool role silently (and the orphaned assistant(tool_calls)
        # message still emits — downstream provider may or may not accept).
        history = [
            {'role': 'user', 'content': 'hi'},
            {'role': 'tool', 'content': 'x', 'tool_call_id': 'c1'},
        ]
        messages = build_history_messages(
            _planner(),
            session_context=_ctx(history),
            max_messages=None,
            ai_message_cls=_FakeAIMessage,
            human_message_cls=_FakeHumanMessage,
        )
        self.assertEqual(len(messages), 1)
        self.assertIsInstance(messages[0], _FakeHumanMessage)


class PruneRespectingToolPairsTests(unittest.TestCase):
    def _item(self, role, content='', tool_calls=None, tool_call_id=None):
        return {
            'role': role,
            'content': content,
            'tool_calls': tool_calls,
            'tool_call_id': tool_call_id,
        }

    def test_cap_does_not_orphan_tool_result_from_its_assistant(self) -> None:
        items = [
            self._item('user', 'first'),
            self._item('assistant', '', tool_calls=[{'id': 'c1', 'name': 't', 'args': {}}]),
            self._item('tool', 'x', tool_call_id='c1'),
            self._item('assistant', 'reply'),
            self._item('user', 'next'),
        ]
        # Cap at 3 would start at index 2 (tool) — orphaning it.
        # The pruner must drop the leading orphan.
        pruned = _prune_respecting_tool_pairs(items, 3)
        roles = [entry['role'] for entry in pruned]
        self.assertNotIn('tool', roles[:1])  # first entry is not an orphan tool

    def test_cap_keeps_pair_together_when_window_includes_assistant(self) -> None:
        items = [
            self._item('assistant', '', tool_calls=[{'id': 'c1', 'name': 't', 'args': {}}]),
            self._item('tool', 'x', tool_call_id='c1'),
            self._item('user', 'hi'),
        ]
        pruned = _prune_respecting_tool_pairs(items, 10)
        self.assertEqual(len(pruned), 3)

    def test_cap_zero_returns_empty(self) -> None:
        items = [self._item('user', 'hi')]
        self.assertEqual(_prune_respecting_tool_pairs(items, 0), [])


if __name__ == '__main__':
    unittest.main()

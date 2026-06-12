"""Memory tools: the loop continues after save_memory (non-terminal), the
handler maps save/forget to nest_client calls and marks the notes cache
dirty, and the dispatcher classification includes both tools."""

import json
import unittest
from types import SimpleNamespace

from app.core.config import get_settings
from app.core.llm.context.handlers.memory_tools import MemoryToolHandler
from app.core.v2 import tools_spec
from app.core.v2.loop import run_loop
from app.core.v2.openai_client import LLMResponse, ToolCall


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

    def complete(self, messages, tools):
        self.call_count += 1
        return self._responses.pop(0)


class _FakeDispatcher:
    def __init__(self, results=None):
        self._results = results or {}
        self.calls = []

    def execute_many(self, calls, session_context):
        self.calls.extend(calls)
        return [self._results.get(name, {'ok': True, 'tool': name}) for name, _ in calls]


class ClassificationTests(unittest.TestCase):
    def test_memory_tools_are_dispatcher_but_not_read_or_terminal(self) -> None:
        for name in ('save_memory', 'forget_memory'):
            self.assertTrue(tools_spec.is_dispatcher_tool(name))
            self.assertFalse(tools_spec.is_read_tool(name))
            self.assertFalse(tools_spec.is_terminal_tool(name))

    def test_build_tools_exposes_memory_tools(self) -> None:
        names = {tool['function']['name'] for tool in tools_spec.build_tools()}
        self.assertIn('save_memory', names)
        self.assertIn('forget_memory', names)


class LoopContinuationTests(unittest.TestCase):
    def test_loop_continues_after_save_memory(self) -> None:
        dispatcher = _FakeDispatcher(
            {'save_memory': {'saved': True, 'memory': {'id': 'm1'}}}
        )
        client = _ScriptedClient([
            _tool_resp('save_memory', {'content': 'Name epics by quarter'}),
            _text_resp('Saved to memory: "Name epics by quarter"'),
        ])
        result = run_loop(
            client=client,
            messages=[{'role': 'system', 'content': 'sys'}, {'role': 'user', 'content': 'remember it'}],
            tools=[],
            dispatcher=dispatcher,
            session_context={'roadmap_id': 'rm1'},
            handle_map={},
            settings=get_settings(),
            trace_id=None,
        )
        self.assertEqual(result.kind, 'chat')
        self.assertIn('Saved to memory', result.assistant_message)
        self.assertEqual(client.call_count, 2)
        self.assertEqual(dispatcher.calls[0][0], 'save_memory')


class _FakeNestClient:
    def __init__(self):
        self.created = []
        self.deleted = []

    async def ai_memories_create(self, *, roadmap_id, payload, auth_header, trace_id=None):
        self.created.append((roadmap_id, payload))
        return {'id': 'mem-1', **payload}

    async def ai_memories_delete(self, *, roadmap_id, memory_id, auth_header, trace_id=None):
        self.deleted.append((roadmap_id, memory_id))
        return {}


def _handler(nest):
    return MemoryToolHandler(
        settings=get_settings(),
        logger=__import__('logging').getLogger('memory-tools-tests'),
        nest_client=nest,
        resolve_lookup_cache={},
        max_resolve_lookup_cache_entries=8,
    )


class HandlerTests(unittest.IsolatedAsyncioTestCase):
    async def test_save_memory_creates_and_marks_dirty(self) -> None:
        nest = _FakeNestClient()
        context = {'roadmap_id': 'rm1', 'auth_header': 'Bearer t'}
        result = await _handler(nest).execute(
            'save_memory', {'content': 'Quarterly epic names'}, context
        )
        self.assertTrue(result['saved'])
        self.assertEqual(result['memory']['id'], 'mem-1')
        self.assertTrue(context.get('memory_notes_dirty'))
        self.assertEqual(nest.created[0][1]['source'], 'user_request')

    async def test_forget_memory_deletes_and_marks_dirty(self) -> None:
        nest = _FakeNestClient()
        context = {'roadmap_id': 'rm1', 'auth_header': 'Bearer t'}
        result = await _handler(nest).execute(
            'forget_memory', {'memory_id': 'mem-9'}, context
        )
        self.assertTrue(result['forgotten'])
        self.assertEqual(nest.deleted, [('rm1', 'mem-9')])
        self.assertTrue(context.get('memory_notes_dirty'))

    async def test_save_memory_rejects_short_content(self) -> None:
        nest = _FakeNestClient()
        result = await _handler(nest).execute('save_memory', {'content': 'x'}, {'roadmap_id': 'rm1'})
        self.assertEqual(result['error']['code'], 'INVALID_MEMORY_CONTENT')
        self.assertEqual(nest.created, [])


if __name__ == '__main__':
    unittest.main()

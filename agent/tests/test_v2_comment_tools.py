"""Comment tool: the loop continues after add_task_comments (non-terminal),
the handler validates/dedupes ids, posts through the roadmap the CALL names
(the dispatcher writes the resolved roadmap onto args) and passes the
backend's per-task results through verbatim, and the dispatcher
classification includes the tool."""

import json
import unittest

from app.core.config import get_settings
from app.core.tools.handlers.comment_tools import CommentToolHandler
from app.core.runtime import tools as tools_spec
from app.core.engine.loop import run_loop
from app.core.engine.llm_client import LLMResponse, ToolCall

_WORKSPACE = {'kind': 'workspace', 'workspace_id': 'ws-1'}


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
    def test_comment_tool_is_dispatcher_but_not_read_or_terminal(self) -> None:
        self.assertTrue(tools_spec.is_dispatcher_tool('add_task_comments'))
        self.assertFalse(tools_spec.is_read_tool('add_task_comments'))
        self.assertFalse(tools_spec.is_terminal_tool('add_task_comments'))

    def test_build_tools_exposes_comment_tool(self) -> None:
        names = {tool['function']['name'] for tool in tools_spec.build_tools()}
        self.assertIn('add_task_comments', names)

    def test_spec_requires_task_ids_and_content_capped_at_25(self) -> None:
        spec = tools_spec.add_task_comments_tool()
        params = spec['function']['parameters']
        self.assertEqual(sorted(params['required']), ['content', 'task_ids'])
        self.assertIn('roadmap_id', params['properties'])
        self.assertEqual(params['properties']['task_ids']['maxItems'], 25)
        self.assertEqual(params['properties']['content']['maxLength'], 2000)

    def test_roadmap_id_required_in_workspace_scope(self) -> None:
        params = tools_spec.add_task_comments_tool(_WORKSPACE)['function']['parameters']
        self.assertEqual(sorted(params['required']), ['content', 'roadmap_id', 'task_ids'])


class LoopContinuationTests(unittest.TestCase):
    def test_loop_continues_after_add_task_comments(self) -> None:
        dispatcher = _FakeDispatcher(
            {
                'add_task_comments': {
                    'posted': 2,
                    'failed': 0,
                    'results': [
                        {'task_id': 't1', 'ok': True, 'comment_id': 'c1'},
                        {'task_id': 't2', 'ok': True, 'comment_id': 'c2'},
                    ],
                }
            }
        )
        client = _ScriptedClient([
            _tool_resp(
                'add_task_comments',
                {'task_ids': ['t1', 't2'], 'content': 'Continuing in August.'},
            ),
            _text_resp('Commented on 2 tasks.'),
        ])
        result = run_loop(
            client=client,
            messages=[{'role': 'system', 'content': 'sys'}, {'role': 'user', 'content': 'comment on them'}],
            tools=[],
            dispatcher=dispatcher,
            session_context={'focus_roadmap_id': 'rm1'},
            handle_map={},
            settings=get_settings(),
            trace_id=None,
        )
        self.assertEqual(result.kind, 'chat')
        self.assertIn('Commented on 2 tasks', result.assistant_message)
        self.assertEqual(client.call_count, 2)
        self.assertEqual(dispatcher.calls[0][0], 'add_task_comments')


class _FakeNestClient:
    def __init__(self):
        self.posted = []

    async def ai_task_comments_add(self, *, roadmap_id, payload, auth_header, trace_id=None):
        self.posted.append((roadmap_id, payload))
        return {
            'posted': len(payload['task_ids']),
            'failed': 0,
            'results': [
                {'task_id': task_id, 'ok': True, 'comment_id': f'c-{task_id}'}
                for task_id in payload['task_ids']
            ],
        }


def _handler(nest):
    return CommentToolHandler(
        settings=get_settings(),
        logger=__import__('logging').getLogger('comment-tools-tests'),
        nest_client=nest,
        resolve_lookup_cache={},
        max_resolve_lookup_cache_entries=8,
    )


class HandlerTests(unittest.IsolatedAsyncioTestCase):
    async def test_posts_batch_and_passes_results_through(self) -> None:
        nest = _FakeNestClient()
        context = {'auth_header': 'Bearer t'}
        result = await _handler(nest).execute(
            'add_task_comments',
            {'task_ids': ['t1', 't2'], 'content': 'Carried to August.', 'roadmap_id': 'rm1'},
            context,
        )
        self.assertEqual(result['posted'], 2)
        self.assertEqual(result['failed'], 0)
        self.assertEqual(len(result['results']), 2)
        roadmap_id, payload = nest.posted[0]
        self.assertEqual(roadmap_id, 'rm1')
        self.assertEqual(payload, {'task_ids': ['t1', 't2'], 'content': 'Carried to August.'})

    async def test_roadmap_id_comes_from_the_call_never_the_shared_context(self) -> None:
        nest = _FakeNestClient()
        context = {'roadmap_id': 'rm-stale', 'focus_roadmap_id': 'rm1', 'auth_header': 'Bearer t'}
        await _handler(nest).execute(
            'add_task_comments',
            {'task_ids': ['t1'], 'content': 'note', 'roadmap_id': 'rm-other'},
            context,
        )
        self.assertEqual(nest.posted[0][0], 'rm-other')

    async def test_missing_roadmap_is_comment_needs_roadmap(self) -> None:
        nest = _FakeNestClient()
        result = await _handler(nest).execute(
            'add_task_comments', {'task_ids': ['t1'], 'content': 'note'}, {'auth_header': 'Bearer t'}
        )
        self.assertEqual(result['error']['code'], 'COMMENT_NEEDS_ROADMAP')
        self.assertEqual(nest.posted, [])

    async def test_dedupes_ids_and_strips_content(self) -> None:
        nest = _FakeNestClient()
        await _handler(nest).execute(
            'add_task_comments',
            {'task_ids': ['t1', 't1', ' t2 ', 't2'], 'content': '  note  ', 'roadmap_id': 'rm1'},
            {'auth_header': 'Bearer t'},
        )
        _, payload = nest.posted[0]
        self.assertEqual(payload['task_ids'], ['t1', 't2'])
        self.assertEqual(payload['content'], 'note')

    async def test_rejects_empty_task_ids(self) -> None:
        nest = _FakeNestClient()
        for bad_args in (
            {'task_ids': [], 'content': 'note'},
            {'task_ids': None, 'content': 'note'},
            {'content': 'note'},
            {'task_ids': ['', '   '], 'content': 'note'},
        ):
            result = await _handler(nest).execute(
                'add_task_comments', {**bad_args, 'roadmap_id': 'rm1'}, {}
            )
            self.assertEqual(result['error']['code'], 'INVALID_TASK_IDS')
        self.assertEqual(nest.posted, [])

    async def test_rejects_more_than_25_ids(self) -> None:
        nest = _FakeNestClient()
        result = await _handler(nest).execute(
            'add_task_comments',
            {'task_ids': [f't{i}' for i in range(26)], 'content': 'note', 'roadmap_id': 'rm1'},
            {},
        )
        self.assertEqual(result['error']['code'], 'INVALID_TASK_IDS')
        self.assertEqual(nest.posted, [])

    async def test_rejects_empty_or_oversized_content(self) -> None:
        nest = _FakeNestClient()
        for bad_content in ('', '   ', 'x' * 2001):
            result = await _handler(nest).execute(
                'add_task_comments',
                {'task_ids': ['t1'], 'content': bad_content, 'roadmap_id': 'rm1'},
                {},
            )
            self.assertEqual(result['error']['code'], 'INVALID_COMMENT_CONTENT')
        self.assertEqual(nest.posted, [])

    async def test_unknown_tool_name_errors(self) -> None:
        nest = _FakeNestClient()
        result = await _handler(nest).execute('other_tool', {}, {'roadmap_id': 'rm1'})
        self.assertEqual(result['error']['code'], 'UNKNOWN_TOOL')


if __name__ == '__main__':
    unittest.main()

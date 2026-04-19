import unittest

from app.core.llm.providers.base import ProviderAdapterError
from app.core.llm.react.react_executor import BoundedToolLoopOutcome, run_bounded_tool_loop


class _FakeAIMessage:
    def __init__(self, *, content=None, tool_calls=None, usage_metadata=None):
        self.content = content
        self.tool_calls = tool_calls or []
        self.usage_metadata = usage_metadata or {}


class ReactExecutorTests(unittest.TestCase):
    def test_returns_terminal_value_without_tool_calls(self) -> None:
        outcome = run_bounded_tool_loop(
            provider='openai',
            initial_messages=['initial'],
            invoke=lambda _messages: _FakeAIMessage(
                content='final-answer',
                tool_calls=[],
                usage_metadata={'input_tokens': 3, 'output_tokens': 2, 'total_tokens': 5},
            ),
            tool_executor=lambda _name, _args: {'ok': True},
            normalize_tool_args=lambda args: args or {},
            extract_usage=lambda message: {
                'tokens_input': int(message.usage_metadata.get('input_tokens') or 0),
                'tokens_output': int(message.usage_metadata.get('output_tokens') or 0),
                'tokens_total': int(message.usage_metadata.get('total_tokens') or 0),
            },
            build_tool_message=lambda content, tool_call_id: {
                'content': content,
                'tool_call_id': tool_call_id,
            },
            on_no_tool_calls=lambda message, usage: BoundedToolLoopOutcome(
                value=message.content,
                usage_totals=usage,
            ),
            on_tool_call=lambda _name, _args, _tool_call, _turn, _index, _usage, _prior: None,
            max_tool_turns=3,
            max_turns_error_code='max_turns',
            max_turns_error_message='Loop exhausted',
        )

        self.assertEqual(outcome.value, 'final-answer')
        self.assertEqual(outcome.usage_totals['tokens_total'], 5)

    def test_handles_terminal_planning_tool_call(self) -> None:
        tool_executor_calls = {'count': 0}

        def _tool_executor(_name, _args):
            tool_executor_calls['count'] += 1
            return {'ok': True}

        outcome = run_bounded_tool_loop(
            provider='openai',
            initial_messages=['initial'],
            invoke=lambda _messages: _FakeAIMessage(
                content=None,
                tool_calls=[
                    {
                        'id': 'tool-1',
                        'name': 'plan_roadmap_operations',
                        'args': {'assistant_message': 'done', 'operations': []},
                    }
                ],
                usage_metadata={'input_tokens': 2, 'output_tokens': 4, 'total_tokens': 6},
            ),
            tool_executor=_tool_executor,
            normalize_tool_args=lambda args: args,
            extract_usage=lambda message: {
                'tokens_input': int(message.usage_metadata.get('input_tokens') or 0),
                'tokens_output': int(message.usage_metadata.get('output_tokens') or 0),
                'tokens_total': int(message.usage_metadata.get('total_tokens') or 0),
            },
            build_tool_message=lambda content, tool_call_id: {
                'content': content,
                'tool_call_id': tool_call_id,
            },
            on_no_tool_calls=lambda _message, usage: BoundedToolLoopOutcome(
                value='missing',
                usage_totals=usage,
            ),
            on_tool_call=lambda name, args, _tool_call, _turn, _index, usage, _prior: (
                BoundedToolLoopOutcome(
                    value=(name, args),
                    usage_totals=usage,
                )
                if name == 'plan_roadmap_operations'
                else None
            ),
            max_tool_turns=3,
            max_turns_error_code='max_turns',
            max_turns_error_message='Loop exhausted',
        )

        self.assertEqual(tool_executor_calls['count'], 0)
        self.assertEqual(outcome.value[0], 'plan_roadmap_operations')
        self.assertEqual(outcome.usage_totals['tokens_total'], 6)

    def test_raises_when_max_turns_exhausted(self) -> None:
        with self.assertRaises(ProviderAdapterError) as raised:
            run_bounded_tool_loop(
                provider='openai',
                initial_messages=['initial'],
                invoke=lambda _messages: _FakeAIMessage(
                    tool_calls=[{'id': 'lookup-1', 'name': 'resolve_node_reference', 'args': {}}],
                    usage_metadata={'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2},
                ),
                tool_executor=lambda _name, _args: {'ok': True},
                normalize_tool_args=lambda args: args or {},
                extract_usage=lambda message: {
                    'tokens_input': int(message.usage_metadata.get('input_tokens') or 0),
                    'tokens_output': int(message.usage_metadata.get('output_tokens') or 0),
                    'tokens_total': int(message.usage_metadata.get('total_tokens') or 0),
                },
                build_tool_message=lambda content, tool_call_id: {
                    'content': content,
                    'tool_call_id': tool_call_id,
                },
                on_no_tool_calls=lambda message, usage: BoundedToolLoopOutcome(
                    value=message.content,
                    usage_totals=usage,
                ),
                on_tool_call=lambda _name, _args, _tool_call, _turn, _index, _usage, _prior: None,
                max_tool_turns=2,
                max_turns_error_code='max_turns_exhausted',
                max_turns_error_message='Loop exhausted',
            )

        self.assertEqual(raised.exception.code, 'max_turns_exhausted')
        self.assertEqual(raised.exception.tokens_total, 4)

    def test_usage_accumulates_across_turns(self) -> None:
        turn_state = {'turn': 0}
        tool_invocations = {'count': 0}

        def _invoke(_messages):
            turn_state['turn'] += 1
            if turn_state['turn'] == 1:
                return _FakeAIMessage(
                    tool_calls=[{'id': 'lookup-1', 'name': 'resolve_node_reference', 'args': {}}],
                    usage_metadata={'input_tokens': 1, 'output_tokens': 2, 'total_tokens': 3},
                )
            return _FakeAIMessage(
                content='resolved',
                tool_calls=[],
                usage_metadata={'input_tokens': 2, 'output_tokens': 1, 'total_tokens': 3},
            )

        def _executor(_name, _args):
            tool_invocations['count'] += 1
            return {'status': 'ok'}

        outcome = run_bounded_tool_loop(
            provider='openai',
            initial_messages=['initial'],
            invoke=_invoke,
            tool_executor=_executor,
            normalize_tool_args=lambda args: args or {},
            extract_usage=lambda message: {
                'tokens_input': int(message.usage_metadata.get('input_tokens') or 0),
                'tokens_output': int(message.usage_metadata.get('output_tokens') or 0),
                'tokens_total': int(message.usage_metadata.get('total_tokens') or 0),
            },
            build_tool_message=lambda content, tool_call_id: {
                'content': content,
                'tool_call_id': tool_call_id,
            },
            on_no_tool_calls=lambda message, usage: BoundedToolLoopOutcome(
                value=message.content,
                usage_totals=usage,
            ),
            on_tool_call=lambda _name, _args, _tool_call, _turn, _index, _usage, _prior: None,
            max_tool_turns=3,
            max_turns_error_code='max_turns',
            max_turns_error_message='Loop exhausted',
        )

        self.assertEqual(outcome.value, 'resolved')
        self.assertEqual(tool_invocations['count'], 1)
        self.assertEqual(outcome.usage_totals['tokens_input'], 3)
        self.assertEqual(outcome.usage_totals['tokens_output'], 3)
        self.assertEqual(outcome.usage_totals['tokens_total'], 6)


    def test_parallel_tool_executor_batches_adjacent_safe_calls(self) -> None:
        sync_calls: list[tuple[str, dict]] = []
        parallel_batches: list[list[tuple[str, dict]]] = []

        def _sync_executor(name, args):
            sync_calls.append((name, args))
            return {'sync': name}

        def _parallel_executor(calls):
            parallel_batches.append(list(calls))
            return [{'parallel': n, 'args': a} for n, a in calls]

        outcome = run_bounded_tool_loop(
            provider='openai',
            initial_messages=['initial'],
            invoke=lambda _messages: _FakeAIMessage(
                content='done',
                tool_calls=[
                    {'id': 'c1', 'name': 'resolve_node_reference', 'args': {'label': 'A'}},
                    {'id': 'c2', 'name': 'resolve_node_reference', 'args': {'label': 'B'}},
                    {'id': 'c3', 'name': 'plan_roadmap_operations', 'args': {'operations': []}},
                ],
                usage_metadata={'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2},
            ),
            tool_executor=_sync_executor,
            normalize_tool_args=lambda args: args or {},
            extract_usage=lambda message: {
                'tokens_input': int(message.usage_metadata.get('input_tokens') or 0),
                'tokens_output': int(message.usage_metadata.get('output_tokens') or 0),
                'tokens_total': int(message.usage_metadata.get('total_tokens') or 0),
            },
            build_tool_message=lambda content, tool_call_id: {
                'content': content,
                'tool_call_id': tool_call_id,
            },
            on_no_tool_calls=lambda message, usage: BoundedToolLoopOutcome(
                value=message.content, usage_totals=usage
            ),
            on_tool_call=lambda name, args, _tc, _turn, _index, usage, _prior: (
                BoundedToolLoopOutcome(value=('planned', args), usage_totals=usage)
                if name == 'plan_roadmap_operations'
                else None
            ),
            max_tool_turns=2,
            max_turns_error_code='max_turns',
            max_turns_error_message='Loop exhausted',
            parallel_tool_executor=_parallel_executor,
            parallel_safe_tools=frozenset({'resolve_node_reference'}),
        )

        self.assertEqual(outcome.value[0], 'planned')
        self.assertEqual(len(parallel_batches), 1)
        self.assertEqual(
            [name for name, _ in parallel_batches[0]],
            ['resolve_node_reference', 'resolve_node_reference'],
        )
        self.assertEqual(sync_calls, [])

    def test_parallel_dispatch_skipped_when_single_safe_call(self) -> None:
        sync_calls: list[str] = []
        parallel_batches: list[list] = []

        outcome = run_bounded_tool_loop(
            provider='openai',
            initial_messages=['initial'],
            invoke=lambda _messages: _FakeAIMessage(
                content='done',
                tool_calls=[
                    {'id': 'c1', 'name': 'resolve_node_reference', 'args': {'label': 'A'}},
                    {'id': 'c2', 'name': 'plan_roadmap_operations', 'args': {}},
                ],
                usage_metadata={'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2},
            ),
            tool_executor=lambda name, _args: sync_calls.append(name) or {'ok': True},
            normalize_tool_args=lambda args: args or {},
            extract_usage=lambda message: {
                'tokens_input': int(message.usage_metadata.get('input_tokens') or 0),
                'tokens_output': int(message.usage_metadata.get('output_tokens') or 0),
                'tokens_total': int(message.usage_metadata.get('total_tokens') or 0),
            },
            build_tool_message=lambda content, tool_call_id: {
                'content': content, 'tool_call_id': tool_call_id,
            },
            on_no_tool_calls=lambda message, usage: BoundedToolLoopOutcome(
                value=message.content, usage_totals=usage
            ),
            on_tool_call=lambda name, _args, _tc, _turn, _index, usage, _prior: (
                BoundedToolLoopOutcome(value='planned', usage_totals=usage)
                if name == 'plan_roadmap_operations'
                else None
            ),
            max_tool_turns=2,
            max_turns_error_code='max_turns',
            max_turns_error_message='Loop exhausted',
            parallel_tool_executor=lambda calls: parallel_batches.append(list(calls))
            or [{} for _ in calls],
            parallel_safe_tools=frozenset({'resolve_node_reference'}),
        )

        self.assertEqual(outcome.value, 'planned')
        self.assertEqual(parallel_batches, [])
        self.assertEqual(sync_calls, ['resolve_node_reference'])


if __name__ == '__main__':
    unittest.main()

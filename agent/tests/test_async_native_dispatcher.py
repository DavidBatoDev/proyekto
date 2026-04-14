from __future__ import annotations

import asyncio
import logging
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.core.config import get_settings
from app.core.llm.context.context_tools_executor import ContextToolsExecutor


class _AsyncFakeNest:
    """Async-only fake: all methods are `async def` and return fixed dicts.
    Used to verify the async handler path runs natively without the bridge.
    """

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def context_summary(self, **kwargs) -> dict:
        self.calls.append('context_summary')
        return {
            'roadmap_id': kwargs.get('roadmap_id'),
            'title': 'Async Roadmap',
            'description': 'from async mock',
            'status': 'active',
            'epic_count': 0,
            'feature_count': 0,
            'task_count': 0,
            'epics': [],
        }

    async def context_search(self, **kwargs) -> dict:
        self.calls.append('context_search')
        return {'matches': []}


def _make_executor(nest: object) -> ContextToolsExecutor:
    return ContextToolsExecutor(
        settings=get_settings(),
        logger=logging.getLogger('async-dispatcher-tests'),
        nest_client=nest,
        run_async_context_call=lambda v: v,  # legacy kwarg, now unused
    )


class AsyncDispatcherTests(unittest.TestCase):
    def test_no_loop_caller_drives_via_asyncio_run(self) -> None:
        """Plain sync caller: dispatcher uses asyncio.run, bridge not invoked."""
        nest = _AsyncFakeNest()
        executor = _make_executor(nest)
        with patch('app.core.llm.context.dispatch.run_async_call') as bridge:
            result = executor.execute(
                'get_roadmap_summary',
                {'roadmap_id': 'r1'},
                {'roadmap_id': 'r1', 'trace_id': 't1'},
            )
        self.assertEqual(result.get('title'), 'Async Roadmap')
        self.assertEqual(nest.calls, ['context_summary'])
        bridge.assert_not_called()

    def test_in_loop_caller_routes_to_bridge(self) -> None:
        """When called from inside a running event loop (unusual — sync
        executor being invoked from async code without `to_thread`), the
        dispatcher routes through `run_async_call` instead of `asyncio.run`.
        Verify the routing decision only; the bridge's own behavior is
        covered by its existing tests.
        """
        nest = _AsyncFakeNest()
        executor = _make_executor(nest)
        routed_via_bridge = {'hit': False}

        def _bridge_stub(coro, **_kw):
            routed_via_bridge['hit'] = True
            # Close the coroutine to avoid an "unawaited coroutine" warning.
            try:
                coro.close()
            except Exception:
                pass
            return {'title': 'stubbed'}

        async def _caller() -> dict:
            with patch('app.core.llm.context.dispatch.run_async_call', side_effect=_bridge_stub):
                return executor.execute(
                    'get_roadmap_summary',
                    {'roadmap_id': 'r1'},
                    {'roadmap_id': 'r1', 'trace_id': 't1'},
                )

        result = asyncio.run(_caller())
        self.assertTrue(routed_via_bridge['hit'])
        self.assertEqual(result.get('title'), 'stubbed')

    def test_sync_mock_nest_client_still_works(self) -> None:
        """Defensive path in _run_context_call: sync mocks that return dicts
        (rather than coroutines) should continue to work — existing tests rely
        on this shape for test_agent_safety PlannerContextSafetyTests.
        """
        sync_nest = SimpleNamespace(
            context_summary=lambda **kw: {
                'roadmap_id': kw.get('roadmap_id'),
                'title': 'Sync Roadmap',
                'description': 'from sync mock',
                'status': 'active',
                'epic_count': 0,
                'feature_count': 0,
                'task_count': 0,
                'epics': [],
            },
        )
        executor = _make_executor(sync_nest)
        result = executor.execute(
            'get_roadmap_summary',
            {'roadmap_id': 'r1'},
            {'roadmap_id': 'r1', 'trace_id': 't1'},
        )
        self.assertEqual(result.get('title'), 'Sync Roadmap')

    def test_tool_invoked_log_carries_async_inner(self) -> None:
        """tool.invoked event must include async_inner field for dashboards."""
        nest = _AsyncFakeNest()
        executor = _make_executor(nest)
        captured: list[dict] = []

        original_record = __import__(
            'app.core.llm.context.dispatch', fromlist=['record_tool_invocation']
        ).record_tool_invocation

        def _capture(*args, **kwargs):
            captured.append(kwargs)
            return original_record(*args, **kwargs)

        with patch('app.core.llm.context.dispatch.record_tool_invocation', side_effect=_capture):
            executor.execute(
                'get_roadmap_summary',
                {'roadmap_id': 'r1'},
                {'roadmap_id': 'r1', 'trace_id': 't1'},
            )
        self.assertEqual(len(captured), 1)
        self.assertTrue(captured[0].get('async_inner'))


if __name__ == '__main__':
    unittest.main()

"""The sync run machine's async plumbing: one persistent event loop per
worker thread (so the per-loop Nest connection pool stays warm), concurrent
prefetch, and one process-wide OpenAI client whose self-heal state outlives a
single phase."""

from __future__ import annotations

import asyncio
import contextvars
import logging
import threading
import unittest
from types import SimpleNamespace

from app.core.engine import llm_client as llm_client_module
from app.core.engine.llm_client import LLMClient
from app.core.runtime.async_bridge import run_async_call, run_concurrently, run_on_thread_loop

_SETTINGS = SimpleNamespace(nest_timeout_seconds=5)
_LOGGER = logging.getLogger('test.async_bridge')
_TRACE = contextvars.ContextVar('trace', default=None)


async def _current_loop():
    return asyncio.get_running_loop()


class ThreadLoopTests(unittest.TestCase):
    def test_calls_on_one_thread_share_a_loop(self):
        first = run_async_call(_current_loop(), settings=_SETTINGS, logger=_LOGGER)
        second = run_async_call(_current_loop(), settings=_SETTINGS, logger=_LOGGER)
        self.assertIs(first, second)
        self.assertFalse(first.is_closed())

    def test_each_thread_gets_its_own_loop(self):
        loops = []
        thread = threading.Thread(target=lambda: loops.append(run_on_thread_loop(_current_loop())))
        thread.start()
        thread.join()
        self.assertIsNot(loops[0], run_on_thread_loop(_current_loop()))

    def test_context_vars_reach_the_coroutine(self):
        async def read():
            return _TRACE.get()

        token = _TRACE.set('trace-7')
        try:
            self.assertEqual(run_on_thread_loop(read()), 'trace-7')
        finally:
            _TRACE.reset(token)

    def test_an_exception_propagates_and_the_loop_survives(self):
        async def boom():
            raise ValueError('nope')

        with self.assertRaises(ValueError):
            run_on_thread_loop(boom())
        self.assertEqual(run_on_thread_loop(asyncio.sleep(0, result=3)), 3)

    def test_tasks_left_behind_are_cancelled_like_asyncio_run(self):
        leftover = {}

        async def leaves_a_task():
            leftover['task'] = asyncio.get_running_loop().create_task(asyncio.sleep(3600))
            return 'done'

        self.assertEqual(run_on_thread_loop(leaves_a_task()), 'done')
        self.assertTrue(leftover['task'].cancelled())

    def test_a_pooled_client_is_reused_across_calls(self):
        from app.core.nest_client import NestRoadmapClient

        nest = NestRoadmapClient()
        first = run_on_thread_loop(nest._get_client())
        second = run_on_thread_loop(nest._get_client())
        self.assertIs(first, second)


class RunConcurrentlyTests(unittest.TestCase):
    def test_results_in_order_and_calls_overlap(self):
        barrier = threading.Barrier(3, timeout=5)

        def call(value):
            def run():
                barrier.wait()  # deadlocks unless all three run at once
                return value
            return run

        self.assertEqual(run_concurrently([call(1), call(2), call(3)]), [1, 2, 3])

    def test_first_error_is_raised_after_every_call_finished(self):
        finished = []

        def ok():
            finished.append('ok')
            return 'ok'

        def bad():
            raise RuntimeError('bad')

        with self.assertRaises(RuntimeError):
            run_concurrently([bad, ok])
        self.assertEqual(finished, ['ok'])

    def test_context_vars_are_copied_into_each_call(self):
        token = _TRACE.set('trace-9')
        try:
            self.assertEqual(run_concurrently([_TRACE.get, _TRACE.get]), ['trace-9', 'trace-9'])
        finally:
            _TRACE.reset(token)

    def test_single_call_runs_inline(self):
        self.assertEqual(run_concurrently([threading.current_thread]), [threading.current_thread()])


class SharedOpenAIClientTests(unittest.TestCase):
    def setUp(self):
        llm_client_module.reset_shared_state_for_tests()
        self.addCleanup(llm_client_module.reset_shared_state_for_tests)

    def _settings(self, **overrides):
        values = {
            'openai_api_key': 'sk-test',
            'openai_model_v2': 'gpt-5.6-luna',
            'openai_model_timeout_seconds': 90,
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_clients_share_one_sdk_client_and_heal_state(self):
        settings = self._settings()
        first, second = LLMClient(settings), LLMClient(settings)
        self.assertIs(first._ensure_client(), second._ensure_client())
        first._drop_reasoning_summary = True
        self.assertTrue(second._drop_reasoning_summary)

    def test_heal_state_is_per_model(self):
        settings = self._settings()
        main, other = LLMClient(settings), LLMClient(settings, model='other-model')
        main._ensure_client()
        other._ensure_client()
        main._rejected_effort = 'minimal'
        self.assertIsNone(other._rejected_effort)

    def test_streaming_fallback_stays_per_instance(self):
        # A transient stream failure must not disable live previews for
        # every later phase in the process.
        settings = self._settings()
        first, second = LLMClient(settings), LLMClient(settings)
        first._ensure_client()
        second._ensure_client()
        first._drop_streaming = True
        self.assertFalse(second._drop_streaming)

    def test_an_injected_client_heals_on_its_own(self):
        settings = self._settings()
        shared = LLMClient(settings)
        shared._ensure_client()
        injected = LLMClient(settings)
        injected._client = SimpleNamespace(responses=None)
        injected._drop_verbosity = True
        self.assertFalse(shared._drop_verbosity)

    def test_retries_are_explicit(self):
        client = LLMClient(self._settings())._ensure_client()
        self.assertEqual(client.max_retries, llm_client_module._SDK_MAX_RETRIES)


if __name__ == '__main__':
    unittest.main()

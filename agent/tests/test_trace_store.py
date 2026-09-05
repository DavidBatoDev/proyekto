"""Redis-backed trace store (app/core/trace/store.py).

Covers: append/flush batching, cross-instance reads through a shared fake
Redis, pagination math after LTRIM, TTL refresh on every flush, `done`
semantics for message_completed and run_step_completed, memory being
authoritative while a step holds the trace, missing traces, owner/session
checks, continue-on-another-instance seq reconciliation, flush failures, and
the read path never doing I/O on the event loop for an active trace.
"""

from __future__ import annotations

import asyncio
import logging
import unittest
from types import SimpleNamespace

from app.core import logging_utils
from app.core.trace import store as trace_store_module
from app.core.trace.store import (
    MAX_EVENTS_PER_TRACE,
    InMemoryRedis,
    InMemoryTraceBackend,
    RedisTraceBackend,
    TraceStore,
)


def _settings(**overrides):
    values = {
        'agent_log_json': True,
        'agent_log_color': 'off',
        'agent_log_include_content': False,
        'agent_progress_events_enabled': True,
        'agent_progress_events_allow_verbose': True,
        'agent_realtime_trace_push_enabled': False,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class _Clock:
    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _payload(trace_id: str, event: str, ts: str = '2026-09-04T10:00:00+00:00', **extra):
    payload = {'ts': ts, 'event': event, 'trace_id': trace_id}
    payload.update(extra)
    return payload


def _build(
    *,
    redis: InMemoryRedis | None = None,
    clock: _Clock | None = None,
    flush_every: int = 5,
    flush_interval: float = 0.5,
    ttl: int = 900,
) -> tuple[TraceStore, InMemoryRedis]:
    fake = redis if redis is not None else InMemoryRedis(clock=clock or _Clock())
    store = TraceStore(
        InMemoryTraceBackend(fake, ttl_seconds=ttl),
        flush_every_events=flush_every,
        flush_interval_seconds=flush_interval,
        clock=clock or _Clock(),
    )
    return store, fake


class TraceStoreBatchingTests(unittest.TestCase):
    def test_capture_buffers_until_the_event_threshold_then_pipelines_one_batch(self) -> None:
        clock = _Clock()
        store, fake = _build(clock=clock)
        trace_id = 'trace-batch'
        settings = _settings()

        for index in range(4):
            store.capture(
                _payload(trace_id, 'tool_call_requested', session_id='s1', tool_name=f't{index}'),
                settings,
            )
        self.assertEqual(fake.hgetall(store.backend.meta_key(trace_id)), {})
        self.assertEqual(fake.llen(store.backend.events_key(trace_id)), 0)

        fake.calls.clear()
        store.capture(_payload(trace_id, 'tool_call_requested', session_id='s1', tool_name='t4'), settings)
        # The cold trace hydrates once (HGETALL), then exactly one pipeline:
        # HSET meta, RPUSH events, LTRIM, EXPIRE x2.
        self.assertEqual(fake.calls, ['hgetall', 'hset', 'rpush', 'ltrim', 'expire', 'expire'])
        meta = fake.hgetall(store.backend.meta_key(trace_id))
        self.assertEqual(meta.get('head_seq'), '6')
        self.assertEqual(meta.get('session_id'), 's1')
        self.assertEqual(fake.llen(store.backend.events_key(trace_id)), 5)

        fake.calls.clear()
        for index in range(5, 10):
            store.capture(_payload(trace_id, 'tool_call_requested', session_id='s1', tool_name=f't{index}'), settings)
        # Already hydrated: the second batch is a single pipeline with no read.
        self.assertEqual(fake.calls, ['hset', 'rpush', 'ltrim', 'expire', 'expire'])
        self.assertEqual(fake.llen(store.backend.events_key(trace_id)), 10)

    def test_interval_threshold_flushes_a_short_batch(self) -> None:
        clock = _Clock()
        store, fake = _build(clock=clock, flush_interval=0.5)
        trace_id = 'trace-interval'
        settings = _settings()
        store.capture(_payload(trace_id, 'message_received', message='hi'), settings)
        self.assertEqual(fake.llen(store.backend.events_key(trace_id)), 0)
        clock.advance(0.6)
        store.capture(_payload(trace_id, 'provider_attempt', provider='openai'), settings)
        self.assertEqual(fake.llen(store.backend.events_key(trace_id)), 2)

    def test_explicit_flush_and_end_active_write_everything_pending(self) -> None:
        store, fake = _build()
        trace_id = 'trace-flush'
        settings = _settings()
        store.capture(_payload(trace_id, 'message_received', session_id='s1', message='go'), settings)
        store.capture(_payload(trace_id, 'provider_attempt', session_id='s1'), settings)
        store.flush(trace_id)
        self.assertEqual(fake.llen(store.backend.events_key(trace_id)), 2)
        self.assertTrue(store.is_active(trace_id))

        store.capture(_payload(trace_id, 'provider_success', session_id='s1'), settings)
        store.end_active(trace_id)
        self.assertFalse(store.is_active(trace_id))
        self.assertEqual(fake.llen(store.backend.events_key(trace_id)), 3)

        served = store.read(session_id='s1', trace_id=trace_id, settings=settings)
        self.assertIsNotNone(served)
        assert served is not None
        self.assertEqual([event['seq'] for event in served['events']], [1, 2, 3])
        self.assertEqual(served['next_seq'], 3)

    def test_flush_failure_keeps_serving_from_memory_and_retries_meta(self) -> None:
        class _FlakyRedis(InMemoryRedis):
            def __init__(self) -> None:
                super().__init__()
                self.fail_writes = True

            def rpush(self, key, *elements):  # type: ignore[override]
                if self.fail_writes:
                    raise RuntimeError('upstash down')
                return super().rpush(key, *elements)

        fake = _FlakyRedis()
        store = TraceStore(InMemoryTraceBackend(fake), flush_every_events=2)
        trace_id = 'trace-flaky'
        settings = _settings()
        with self.assertLogs('app.core.trace.store', level='WARNING'):
            store.capture(_payload(trace_id, 'message_received', session_id='s1', message='a'), settings)
            store.capture(_payload(trace_id, 'provider_attempt', session_id='s1'), settings)
        served = store.read(session_id='s1', trace_id=trace_id, settings=settings)
        assert served is not None
        self.assertEqual([event['seq'] for event in served['events']], [1, 2])
        self.assertEqual(fake.llen(store.backend.events_key(trace_id)), 0)

        fake.fail_writes = False
        store.capture(_payload(trace_id, 'provider_success', session_id='s1'), settings)
        store.flush(trace_id)
        # Only the events captured after the outage reach Redis; head_seq is
        # still correct so pagination math stays sound.
        self.assertEqual(fake.llen(store.backend.events_key(trace_id)), 1)
        self.assertEqual(fake.hgetall(store.backend.meta_key(trace_id)).get('head_seq'), '4')


    def test_end_active_with_unreachable_redis_drops_the_buffer_without_stalling(self) -> None:
        class _DeadRedis(InMemoryRedis):
            def hgetall(self, key):  # type: ignore[override]
                self.calls.append('hgetall')
                raise RuntimeError('upstash unreachable')

        fake = _DeadRedis()
        store = TraceStore(InMemoryTraceBackend(fake), flush_every_events=50)
        trace_id = 'trace-dead'
        settings = _settings()
        store.capture(_payload(trace_id, 'message_received', session_id='s1', message='a'), settings)
        store.capture(_payload(trace_id, 'provider_attempt', session_id='s1'), settings)
        served = store.read(session_id='s1', trace_id=trace_id, settings=settings)
        assert served is not None
        self.assertEqual(len(served['events']), 2)
        with self.assertLogs('app.core.trace.store', level='WARNING'):
            store.end_active(trace_id)
        self.assertFalse(store.is_active(trace_id))
        # One hydration attempt, not one per pass.
        self.assertEqual(fake.calls.count('hgetall'), 1)


class TraceStoreCrossInstanceTests(unittest.TestCase):
    def test_second_instance_reads_the_trace_from_redis(self) -> None:
        fake = InMemoryRedis()
        writer, _ = _build(redis=fake)
        reader, _ = _build(redis=fake)
        trace_id = 'trace-cross'
        settings = _settings()

        writer.capture(
            _payload(trace_id, 'run_started', session_id='s1', run_id='run-1', phase='investigate'),
            settings,
        )
        writer.capture(_payload(trace_id, 'tool_call_requested', session_id='s1', tool_name='x'), settings)
        writer.capture(
            _payload(trace_id, 'phase_entered', session_id='s1', phase='execute', commits_done=0, commits_total=2),
            settings,
        )
        writer.end_active(trace_id)

        self.assertFalse(reader.is_active(trace_id))
        served = reader.read(session_id='s1', trace_id=trace_id, after_seq=0, limit=50, settings=settings)
        self.assertIsNotNone(served)
        assert served is not None
        self.assertEqual([event['seq'] for event in served['events']], [1, 2, 3])
        self.assertEqual(served['run_id'], 'run-1')
        self.assertEqual(served['phase'], 'execute')
        self.assertEqual(served['session_id'], 's1')
        self.assertFalse(served['done'])
        self.assertEqual(served['events'][2]['details'].get('commits_total'), 2)
        # Cursor past the head: one pipeline (HGETALL+LLEN), no LRANGE.
        fake.calls.clear()
        nothing_new = reader.read(session_id='s1', trace_id=trace_id, after_seq=3, settings=settings)
        assert nothing_new is not None
        self.assertEqual(nothing_new['events'], [])
        self.assertEqual(nothing_new['next_seq'], 3)
        self.assertNotIn('lrange', fake.calls)

    def test_continue_on_another_instance_keeps_seq_numbering(self) -> None:
        fake = InMemoryRedis()
        first, _ = _build(redis=fake)
        second, _ = _build(redis=fake)
        trace_id = 'trace-continue'
        settings = _settings()
        for index in range(3):
            first.capture(
                _payload(trace_id, 'tool_call_requested', session_id='s1', run_id='run-1', tool_name=f't{index}'),
                settings,
            )
        first.capture(
            _payload(trace_id, 'run_step_completed', session_id='s1', run_id='run-1', run_next='continue', step=1),
            settings,
        )
        first.end_active(trace_id)

        meta = second.activate(trace_id, owner_key='user-1', phase='execute')
        self.assertEqual(meta.head_seq, 5)
        self.assertEqual(meta.session_id, 's1')
        self.assertEqual(meta.run_id, 'run-1')
        second.capture(
            _payload(trace_id, 'commit_started', roadmap_id='r1', roadmap_title='Alpha', operations_count=2),
            settings,
        )
        second.flush(trace_id)

        served = first.read(session_id='s1', trace_id=trace_id, after_seq=4, settings=settings)
        assert served is not None
        self.assertEqual([event['seq'] for event in served['events']], [5])
        self.assertEqual(served['events'][0]['event'], 'commit_started')
        self.assertEqual(served['phase'], 'execute')
        self.assertFalse(served['done'])
        # The owner recorded by the second instance is enforced everywhere.
        self.assertIsNone(
            first.read(session_id='s1', trace_id=trace_id, settings=settings, owner_key='user-2')
        )

    def test_late_capture_after_end_active_continues_the_sequence(self) -> None:
        store, fake = _build()
        trace_id = 'trace-late'
        settings = _settings()
        store.capture(_payload(trace_id, 'message_received', session_id='s1', message='x'), settings)
        store.capture(_payload(trace_id, 'run_step_completed', session_id='s1', run_next='done'), settings)
        store.end_active(trace_id)

        store.capture(_payload(trace_id, 'message_completed', session_id='s1', elapsed_ms=5), settings)
        store.flush(trace_id)
        served = store.read(session_id='s1', trace_id=trace_id, after_seq=2, settings=settings)
        assert served is not None
        self.assertEqual([event['seq'] for event in served['events']], [3])
        self.assertTrue(served['done'])
        self.assertEqual(fake.hgetall(store.backend.meta_key(trace_id)).get('head_seq'), '4')


class ColdBufferTests(unittest.TestCase):
    """Captures that land outside the step's activate/end_active window: the
    route logs message_received before step() and message_completed after
    it. Those buffers are cold (not hydrated) until the next flush and must
    never be served as if they were the whole trace."""

    def test_late_message_completed_after_a_paused_step_keeps_the_trace_open(self) -> None:
        store, fake = _build()
        trace_id = 'trace-cold-continue'
        settings = _settings()
        store.activate(trace_id, session_id='s1', owner_key='owner-1', run_id='run-1', phase='investigate')
        store.capture(_payload(trace_id, 'run_started', session_id='s1', run_id='run-1', phase='investigate'), settings)
        store.capture(_payload(trace_id, 'run_step_completed', session_id='s1', run_id='run-1', run_next='continue'), settings)
        store.end_active(trace_id)

        # The route's legacy terminal, stamped with the run's next.
        store.capture(_payload(trace_id, 'message_completed', session_id='s1', run_id='run-1', run_next='continue', elapsed_ms=5), settings)
        self.assertTrue(store.is_active(trace_id))
        # Cold buffer: Redis (owner-checked, done=False, all events) is served.
        served = store.read(session_id='s1', trace_id=trace_id, settings=settings, owner_key='owner-1')
        assert served is not None
        self.assertFalse(served['done'])
        self.assertEqual(served['run_id'], 'run-1')
        self.assertEqual([event['event'] for event in served['events']], ['run_started', 'run_step_completed'])
        self.assertIsNone(store.read(session_id='s1', trace_id=trace_id, settings=settings, owner_key='someone-else'))

        store.flush(trace_id)
        served = store.read(session_id='s1', trace_id=trace_id, settings=settings, owner_key='owner-1')
        assert served is not None
        self.assertFalse(served['done'])
        self.assertEqual([event['event'] for event in served['events']], ['run_started', 'run_step_completed', 'message_completed'])
        self.assertEqual(fake.hgetall(store.backend.meta_key(trace_id)).get('done'), '0')
        self.assertEqual(fake.hgetall(store.backend.meta_key(trace_id)).get('owner_key'), 'owner-1')

        # The terminal step closes it as before.
        store.activate(trace_id, session_id='s1', owner_key='owner-1', run_id='run-1', phase='verify')
        store.capture(_payload(trace_id, 'run_step_completed', session_id='s1', run_id='run-1', run_next='done'), settings)
        store.end_active(trace_id)
        store.capture(_payload(trace_id, 'message_completed', session_id='s1', run_id='run-1', run_next='done', elapsed_ms=5), settings)
        store.flush(trace_id)
        served = store.read(session_id='s1', trace_id=trace_id, settings=settings, owner_key='owner-1')
        assert served is not None
        self.assertTrue(served['done'])
        self.assertEqual(len(served['events']), 5)

    def test_brand_new_cold_buffer_is_served_from_memory_until_flushed(self) -> None:
        store, _fake = _build()
        trace_id = 'trace-cold-new'
        settings = _settings()
        store.capture(_payload(trace_id, 'message_received', session_id='s1', owner_key='owner-1', message='hi'), settings)
        served = store.read(session_id='s1', trace_id=trace_id, settings=settings, owner_key='owner-1')
        assert served is not None
        self.assertEqual([event['event'] for event in served['events']], ['message_received'])
        self.assertFalse(served['done'])
        # The owner stamped on the event guards even the un-flushed buffer.
        self.assertIsNone(store.read(session_id='s1', trace_id=trace_id, settings=settings, owner_key='someone-else'))


class TraceStorePaginationTests(unittest.TestCase):
    def test_pagination_math_after_ltrim(self) -> None:
        fake = InMemoryRedis()
        writer, _ = _build(redis=fake)
        reader, _ = _build(redis=fake)
        trace_id = 'trace-trim'
        settings = _settings()
        total = MAX_EVENTS_PER_TRACE + 50
        for index in range(total):
            writer.capture(
                _payload(trace_id, 'assistant_delta', session_id='s1', text=f'chunk {index}', delta_seq=index),
                settings,
            )
        writer.end_active(trace_id)

        self.assertEqual(fake.llen(writer.backend.events_key(trace_id)), MAX_EVENTS_PER_TRACE)
        self.assertEqual(fake.hgetall(writer.backend.meta_key(trace_id)).get('head_seq'), str(total + 1))

        from_start = reader.read(session_id='s1', trace_id=trace_id, after_seq=0, limit=3, settings=settings)
        assert from_start is not None
        self.assertEqual([event['seq'] for event in from_start['events']], [51, 52, 53])
        self.assertEqual(from_start['next_seq'], 53)

        window = reader.read(session_id='s1', trace_id=trace_id, after_seq=290, limit=5, settings=settings)
        assert window is not None
        self.assertEqual([event['seq'] for event in window['events']], [291, 292, 293, 294, 295])

        tail = reader.read(session_id='s1', trace_id=trace_id, after_seq=298, limit=50, settings=settings)
        assert tail is not None
        self.assertEqual([event['seq'] for event in tail['events']], [299, 300])
        self.assertEqual(tail['next_seq'], 300)

        beyond = reader.read(session_id='s1', trace_id=trace_id, after_seq=300, settings=settings)
        assert beyond is not None
        self.assertEqual(beyond['events'], [])
        self.assertEqual(beyond['next_seq'], 300)

    def test_ltrim_racing_between_the_two_reads_is_re_read_once(self) -> None:
        fake = InMemoryRedis()
        writer, _ = _build(redis=fake)
        reader, _ = _build(redis=fake)
        trace_id = 'trace-race'
        settings = _settings()
        for index in range(MAX_EVENTS_PER_TRACE):
            writer.capture(_payload(trace_id, 'assistant_delta', session_id='s1', text=str(index)), settings)
        writer.flush(trace_id)

        original_lrange = fake.lrange
        state = {'raced': False}

        def _racing_lrange(key, start, stop):
            if not state['raced']:
                state['raced'] = True
                # A writer appends + trims between HGETALL/LLEN and LRANGE.
                for index in range(10):
                    writer.capture(
                        _payload(trace_id, 'assistant_delta', session_id='s1', text=f'late {index}'), settings
                    )
                writer.flush(trace_id)
            return original_lrange(key, start, stop)

        fake.lrange = _racing_lrange  # type: ignore[assignment]
        served = reader.read(session_id='s1', trace_id=trace_id, after_seq=0, limit=5, settings=settings)
        assert served is not None
        # first_seq after the race is 11; a naive index read would have
        # skipped 11..20.
        self.assertEqual([event['seq'] for event in served['events']], [11, 12, 13, 14, 15])


class TraceStoreTtlTests(unittest.TestCase):
    def test_ttl_is_refreshed_on_every_flush(self) -> None:
        clock = _Clock()
        store, fake = _build(clock=clock, ttl=900)
        trace_id = 'trace-ttl'
        settings = _settings()
        meta_key = store.backend.meta_key(trace_id)
        events_key = store.backend.events_key(trace_id)

        store.capture(_payload(trace_id, 'message_received', session_id='s1', message='x'), settings)
        store.flush(trace_id)
        self.assertEqual(fake.ttl(meta_key), 900)
        self.assertEqual(fake.ttl(events_key), 900)

        clock.advance(400)
        store.capture(_payload(trace_id, 'provider_attempt', session_id='s1'), settings)
        store.flush(trace_id)
        self.assertEqual(fake.ttl(meta_key), 900)
        self.assertEqual(fake.ttl(events_key), 900)
        store.end_active(trace_id)

        clock.advance(800)  # t=1200: would have expired at 900 without the refresh
        self.assertIsNotNone(store.read(session_id='s1', trace_id=trace_id, settings=settings))
        clock.advance(200)  # t=1400 > 1300
        self.assertIsNone(store.read(session_id='s1', trace_id=trace_id, settings=settings))

    def test_idle_memory_entry_is_evicted_after_the_ttl(self) -> None:
        clock = _Clock()
        store, _ = _build(clock=clock, ttl=900)
        trace_id = 'trace-memory-ttl'
        settings = _settings()
        store.capture(_payload(trace_id, 'message_received', session_id='s1', message='x'), settings)
        self.assertTrue(store.is_active(trace_id))
        clock.advance(901)
        # Never flushed and idle past the TTL: gone from memory and from Redis.
        self.assertIsNone(store.read(session_id='s1', trace_id=trace_id, settings=settings))
        self.assertFalse(store.is_active(trace_id))


class TraceStoreDoneSemanticsTests(unittest.TestCase):
    def test_message_completed_marks_the_legacy_trace_done(self) -> None:
        store, _ = _build()
        trace_id = 'trace-legacy-done'
        settings = _settings()
        store.capture(_payload(trace_id, 'message_received', session_id='s1', message='x'), settings)
        before = store.read(session_id='s1', trace_id=trace_id, settings=settings)
        assert before is not None
        self.assertFalse(before['done'])
        self.assertNotIn('elapsed_ms', before)

        store.capture(
            _payload(trace_id, 'message_completed', ts='2026-09-04T10:00:02+00:00', session_id='s1', elapsed_ms=2000),
            settings,
        )
        after = store.read(session_id='s1', trace_id=trace_id, settings=settings)
        assert after is not None
        self.assertTrue(after['done'])
        self.assertEqual(after['completed_at'], '2026-09-04T10:00:02+00:00')
        self.assertEqual(after['elapsed_ms'], 2000)

    def test_run_step_completed_sets_done_from_run_next(self) -> None:
        store, fake = _build()
        trace_id = 'trace-run-done'
        settings = _settings()
        store.capture(_payload(trace_id, 'run_started', session_id='s1', run_id='run-1', phase='investigate'), settings)
        store.capture(
            _payload(trace_id, 'run_step_completed', session_id='s1', run_id='run-1', run_next='continue', step=1),
            settings,
        )
        mid = store.read(session_id='s1', trace_id=trace_id, settings=settings)
        assert mid is not None
        self.assertFalse(mid['done'])
        self.assertIsNone(mid['completed_at'])

        # A legacy message_completed logged after a continuing step must not
        # end the trace.
        store.capture(_payload(trace_id, 'message_completed', session_id='s1', elapsed_ms=1), settings)
        still_running = store.read(session_id='s1', trace_id=trace_id, settings=settings)
        assert still_running is not None
        self.assertFalse(still_running['done'])

        store.capture(
            _payload(
                trace_id,
                'run_step_completed',
                ts='2026-09-04T10:00:03+00:00',
                session_id='s1',
                run_id='run-1',
                run_next='await_user',
                step=2,
            ),
            settings,
        )
        store.end_active(trace_id)
        finished = store.read(session_id='s1', trace_id=trace_id, settings=settings)
        assert finished is not None
        self.assertTrue(finished['done'])
        self.assertEqual(finished['completed_at'], '2026-09-04T10:00:03+00:00')
        self.assertEqual(finished['elapsed_ms'], 3000)
        self.assertEqual(fake.hgetall(store.backend.meta_key(trace_id)).get('done'), '1')

    def test_phase_follows_run_events_but_not_provider_phase(self) -> None:
        store, _ = _build()
        trace_id = 'trace-phase'
        settings = _settings()
        store.capture(_payload(trace_id, 'phase_entered', session_id='s1', phase='investigate'), settings)
        store.capture(_payload(trace_id, 'provider_attempt', session_id='s1', provider='openai', phase='v2_loop'), settings)
        served = store.read(session_id='s1', trace_id=trace_id, settings=settings)
        assert served is not None
        self.assertEqual(served['phase'], 'investigate')


class TraceStoreReadPathTests(unittest.TestCase):
    def test_memory_is_authoritative_while_the_step_holds_the_trace(self) -> None:
        store, fake = _build()
        trace_id = 'trace-memory'
        settings = _settings()
        for index in range(3):
            store.capture(_payload(trace_id, 'tool_call_requested', session_id='s1', tool_name=f't{index}'), settings)
        self.assertEqual(fake.llen(store.backend.events_key(trace_id)), 0)
        fake.calls.clear()
        served = store.read(session_id='s1', trace_id=trace_id, settings=settings)
        assert served is not None
        self.assertEqual([event['seq'] for event in served['events']], [1, 2, 3])
        self.assertEqual(fake.calls, [])

        store.flush(trace_id)
        store.capture(_payload(trace_id, 'tool_call_result', session_id='s1', tool_name='t3'), settings)
        served_again = store.read(session_id='s1', trace_id=trace_id, after_seq=2, settings=settings)
        assert served_again is not None
        self.assertEqual([event['seq'] for event in served_again['events']], [3, 4])
        self.assertEqual(fake.llen(store.backend.events_key(trace_id)), 3)

    def test_missing_trace_returns_none(self) -> None:
        store, _ = _build()
        self.assertIsNone(store.read(session_id='s1', trace_id='nope', settings=_settings()))

    def test_session_mismatch_returns_none(self) -> None:
        store, _ = _build()
        settings = _settings()
        store.capture(_payload('trace-owner', 'message_received', session_id='s1', message='x'), settings)
        self.assertIsNone(store.read(session_id='s2', trace_id='trace-owner', settings=settings))
        store.end_active('trace-owner')
        self.assertIsNone(store.read(session_id='s2', trace_id='trace-owner', settings=settings))
        self.assertIsNotNone(store.read(session_id='s1', trace_id='trace-owner', settings=settings))

    def test_owner_key_check_is_enforced_only_when_requested(self) -> None:
        store, _ = _build()
        settings = _settings()
        trace_id = 'trace-owner-key'
        store.capture(_payload(trace_id, 'message_received', session_id='s1', owner_key='user-1', message='x'), settings)
        served = store.read(session_id='s1', trace_id=trace_id, settings=settings, owner_key='user-1')
        assert served is not None
        # owner_key is trace metadata, never event detail.
        self.assertNotIn('owner_key', served['events'][0].get('details') or {})
        self.assertNotIn('owner_key', served)
        self.assertIsNone(store.read(session_id='s1', trace_id=trace_id, settings=settings, owner_key='user-2'))
        self.assertIsNone(store.read(session_id='s1', trace_id=trace_id, settings=settings, owner_key=None))
        # Legacy callers that do not pass owner_key keep working.
        self.assertIsNotNone(store.read(session_id='s1', trace_id=trace_id, settings=settings))

    def test_disabled_settings_and_non_allowlisted_events_are_ignored(self) -> None:
        store, _ = _build()
        trace_id = 'trace-ignored'
        store.capture(_payload(trace_id, 'message_received', message='x'), _settings(agent_progress_events_enabled=False))
        self.assertFalse(store.is_active(trace_id))
        store.capture(_payload(trace_id, 'session_store_get_hit', elapsed_ms=1), _settings())
        self.assertFalse(store.is_active(trace_id))
        store.capture(_payload(trace_id, 'message_received', message='x'), _settings())
        self.assertTrue(store.is_active(trace_id))
        self.assertIsNone(
            store.read(session_id='any', trace_id=trace_id, settings=_settings(agent_progress_events_enabled=False))
        )

    def test_read_never_blocks_the_event_loop(self) -> None:
        loop_reads: list[str] = []

        class _LoopGuardRedis(InMemoryRedis):
            def _guard(self, name: str) -> None:
                try:
                    asyncio.get_running_loop()
                except RuntimeError:
                    return
                loop_reads.append(name)
                raise AssertionError(f'{name} executed on the event-loop thread')

            def hgetall(self, key):  # type: ignore[override]
                self._guard('hgetall')
                return super().hgetall(key)

            def llen(self, key):  # type: ignore[override]
                self._guard('llen')
                return super().llen(key)

            def lrange(self, key, start, stop):  # type: ignore[override]
                self._guard('lrange')
                return super().lrange(key, start, stop)

        fake = _LoopGuardRedis()
        store = TraceStore(InMemoryTraceBackend(fake), flush_every_events=2)
        settings = _settings()
        trace_id = 'trace-loop'

        async def _scenario() -> dict:
            # Captures from the loop thread never flush inline (the threshold
            # hands the flush to the daemon thread), and reads of an active
            # trace come straight from memory.
            for index in range(3):
                store.capture(_payload(trace_id, 'tool_call_requested', session_id='s1', tool_name=f't{index}'), settings)
            served = store.read(session_id='s1', trace_id=trace_id, settings=settings)
            assert served is not None
            # A cold trace on another instance must go to Redis: that is what
            # run_store_call is for.
            other = await asyncio.to_thread(
                store.read, session_id='s1', trace_id='trace-elsewhere', settings=settings
            )
            assert other is None
            return served

        served = asyncio.run(_scenario())
        self.assertEqual([event['seq'] for event in served['events']], [1, 2, 3])
        self.assertEqual(loop_reads, [])
        # Whatever the daemon flushed is consistent with memory once drained.
        store.flush(trace_id)
        store.end_active(trace_id)
        self.assertEqual(fake.llen(store.backend.events_key(trace_id)), 3)


class TraceStoreModuleApiTests(unittest.TestCase):
    def setUp(self) -> None:
        trace_store_module.reset_for_tests()
        self.logger = logging.getLogger(f'trace-store-module-tests-{id(self)}')
        self.logger.propagate = False

    def tearDown(self) -> None:
        trace_store_module.reset_for_tests()

    def test_log_event_routes_through_the_default_store(self) -> None:
        settings = _settings()
        trace_id = 'trace-module'
        logging_utils.log_event(
            self.logger,
            'commit_completed',
            settings=settings,
            trace_id=trace_id,
            session_id='s1',
            run_id='run-9',
            roadmap_id='r1',
            roadmap_title='Alpha',
            operations_count=3,
            impacted_summary={'created': 2, 'modified': 1, 'deleted': 0},
            impacted_items=[{'node_id': 'e1', 'node_type': 'epic', 'title': 'Auth', 'impact': 'created'}],
        )
        served = trace_store_module.read(session_id='s1', trace_id=trace_id, detail='structured', settings=settings)
        assert served is not None
        self.assertEqual(served['run_id'], 'run-9')
        event = served['events'][0]
        self.assertEqual(event['title'], 'Changes committed')
        self.assertEqual(event['status'], 'success')
        self.assertEqual(event['summary'], 'Committed 3 operations to "Alpha" (created=2, deleted=0, modified=1).')
        self.assertEqual(event['details']['roadmap_id'], 'r1')
        self.assertEqual(event['details']['roadmap_title'], 'Alpha')
        self.assertEqual(len(event['details']['impacted_items']), 1)
        self.assertTrue(trace_store_module.is_active(trace_id))
        trace_store_module.flush(trace_id)
        trace_store_module.end_active(trace_id)
        self.assertFalse(trace_store_module.is_active(trace_id))
        self.assertIsNotNone(logging_utils.get_progress_trace_events(session_id='s1', trace_id=trace_id, settings=settings))

    def test_configure_binds_a_redis_client_and_clamped_tunables(self) -> None:
        fake = InMemoryRedis()
        store = trace_store_module.get_default_store()
        trace_store_module.configure(
            fake,
            SimpleNamespace(
                redis_trace_key_prefix='custom:trace',
                agent_trace_ttl_seconds=5,  # clamped up to 60
                agent_trace_flush_every_events=1,
                agent_trace_flush_interval_seconds=0,  # clamped to 0.05
            ),
        )
        self.assertIsInstance(store.backend, RedisTraceBackend)
        self.assertIs(store.backend.redis, fake)
        self.assertEqual(store.backend.meta_key('t'), 'custom:trace:t')
        self.assertEqual(store.backend.ttl_seconds, 60)
        settings = _settings()
        trace_store_module.capture(_payload('t', 'message_received', session_id='s1', message='x'), settings)
        self.assertEqual(fake.llen('custom:trace:t:events'), 1)  # flush every 1 event
        self.assertEqual(fake.ttl('custom:trace:t'), 60)

        trace_store_module.configure(None, SimpleNamespace())
        self.assertIsInstance(store.backend, InMemoryTraceBackend)


if __name__ == '__main__':
    unittest.main()

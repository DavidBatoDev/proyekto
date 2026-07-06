"""Streamed model calls + assistant_delta progress events.

Covers: the streaming client adapter (delta callback + terminal Response
adaptation), the non-streaming self-heal fallback, the config kill switch, the
AssistantDeltaEmitter throttling, and the progress-event plumbing that carries
chunks to the web (allowlist + both detail modes).
"""

import unittest
import uuid
from time import monotonic
from types import SimpleNamespace
from unittest import mock

from app.core.config import get_settings
from app.core.logging_utils import get_progress_trace_events, log_event
from app.core.v2 import progress as progress_mod
from app.core.v2.openai_client import V2LLMClient
from app.core.v2.progress import AssistantDeltaEmitter, ThoughtEmitter


def _delta_event(text):
    return SimpleNamespace(type='response.output_text.delta', delta=text)


def _reasoning_part_event(text):
    return SimpleNamespace(
        type='response.reasoning_summary_part.done',
        part=SimpleNamespace(text=text),
    )


def _completed_event(response):
    return SimpleNamespace(type='response.completed', response=response)


def _final_response(text='Hello world.'):
    """A minimal Responses object shape adapt_response understands."""
    return SimpleNamespace(
        output=[
            {
                'type': 'message',
                'content': [{'type': 'output_text', 'text': text}],
            }
        ],
        status='completed',
        usage=SimpleNamespace(
            input_tokens=100,
            output_tokens=10,
            total_tokens=110,
            input_tokens_details=SimpleNamespace(cached_tokens=80),
        ),
    )


class _FakeResponses:
    """Scripted responses.create: records kwargs, supports stream + plain."""

    def __init__(self, stream_events=None, stream_error=None):
        self.calls = []
        self._stream_events = stream_events or []
        self._stream_error = stream_error

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs.get('stream'):
            if self._stream_error == 'open':
                raise RuntimeError('stream refused')

            def _iter():
                for i, event in enumerate(self._stream_events):
                    if self._stream_error == 'mid' and i == 1:
                        raise RuntimeError('stream died mid-flight')
                    yield event

            return _iter()
        return _final_response()


def _client(
    responses,
    streaming_enabled=True,
    reasoning_effort=None,
    reasoning_summary_enabled=False,
):
    settings = SimpleNamespace(
        openai_model_v2='gpt-5.4-mini',
        openai_api_key='sk-test',
        openai_v2_max_output_tokens=None,
        openai_v2_reasoning_effort=reasoning_effort,
        openai_v2_temperature=None,
        openai_v2_streaming_enabled=streaming_enabled,
        openai_v2_reasoning_summary_enabled=reasoning_summary_enabled,
    )
    client = V2LLMClient(settings)
    client._client = SimpleNamespace(responses=responses)
    return client


class StreamingClientTests(unittest.TestCase):
    def test_streams_deltas_and_adapts_terminal_response(self):
        fake = _FakeResponses(
            stream_events=[
                _delta_event('Hel'),
                _delta_event('lo'),
                _completed_event(_final_response('Hello')),
            ]
        )
        client = _client(fake)
        seen = []
        result = client.complete([], [], on_text_delta=seen.append)
        self.assertEqual(seen, ['Hel', 'lo'])
        self.assertEqual(result.content, 'Hello')
        self.assertEqual(result.tokens_input, 100)
        self.assertEqual(result.tokens_cached, 80)
        self.assertTrue(fake.calls[0].get('stream'))

    def test_callback_exception_does_not_kill_the_call(self):
        fake = _FakeResponses(
            stream_events=[_delta_event('x'), _completed_event(_final_response())]
        )
        client = _client(fake)

        def _boom(_):
            raise ValueError('preview crashed')

        result = client.complete([], [], on_text_delta=_boom)
        self.assertEqual(result.content, 'Hello world.')

    def test_mid_stream_failure_falls_back_and_sticks(self):
        fake = _FakeResponses(
            stream_events=[
                _delta_event('a'),
                _delta_event('b'),
                _completed_event(_final_response()),
            ],
            stream_error='mid',
        )
        client = _client(fake)
        result = client.complete([], [], on_text_delta=lambda _t: None)
        self.assertEqual(result.content, 'Hello world.')
        # 1st call streamed (and died), 2nd call plain.
        self.assertTrue(fake.calls[0].get('stream'))
        self.assertNotIn('stream', fake.calls[1])
        self.assertTrue(client._drop_streaming)
        # Subsequent calls skip streaming entirely.
        client.complete([], [], on_text_delta=lambda _t: None)
        self.assertNotIn('stream', fake.calls[2])

    def test_stream_without_terminal_event_falls_back(self):
        fake = _FakeResponses(stream_events=[_delta_event('a')])  # no completed
        client = _client(fake)
        result = client.complete([], [], on_text_delta=lambda _t: None)
        self.assertEqual(result.content, 'Hello world.')
        self.assertTrue(client._drop_streaming)

    def test_disabled_flag_never_streams(self):
        fake = _FakeResponses()
        client = _client(fake, streaming_enabled=False)
        client.complete([], [], on_text_delta=lambda _t: None)
        self.assertNotIn('stream', fake.calls[0])

    def test_no_callback_never_streams(self):
        fake = _FakeResponses()
        client = _client(fake, streaming_enabled=True)
        client.complete([], [])
        self.assertNotIn('stream', fake.calls[0])


class ReasoningSummaryClientTests(unittest.TestCase):
    def test_streamed_summary_parts_fire_callback_and_kwargs_request_summary(self):
        fake = _FakeResponses(
            stream_events=[
                _reasoning_part_event('Looking for overdue tasks first.'),
                _delta_event('Hello'),
                _completed_event(_final_response('Hello')),
            ]
        )
        client = _client(fake, reasoning_effort='low', reasoning_summary_enabled=True)
        thoughts = []
        result = client.complete(
            [], [], on_text_delta=lambda _t: None, on_reasoning_part=thoughts.append
        )
        self.assertEqual(thoughts, ['Looking for overdue tasks first.'])
        self.assertEqual(result.content, 'Hello')
        self.assertEqual(
            fake.calls[0].get('reasoning'), {'effort': 'low', 'summary': 'auto'}
        )

    def test_flag_off_omits_summary_from_kwargs(self):
        fake = _FakeResponses(
            stream_events=[_completed_event(_final_response())]
        )
        client = _client(fake, reasoning_effort='low', reasoning_summary_enabled=False)
        client.complete(
            [], [], on_text_delta=lambda _t: None, on_reasoning_part=lambda _t: None
        )
        self.assertEqual(fake.calls[0].get('reasoning'), {'effort': 'low'})

    def test_no_callback_omits_summary_even_with_flag_on(self):
        fake = _FakeResponses()
        client = _client(fake, reasoning_effort='low', reasoning_summary_enabled=True)
        client.complete([], [])
        self.assertEqual(fake.calls[0].get('reasoning'), {'effort': 'low'})

    def test_non_streaming_extraction_from_reasoning_items(self):
        response = _final_response('Done.')
        response.output.insert(
            0,
            {
                'type': 'reasoning',
                'summary': [
                    {'type': 'summary_text', 'text': 'First thought.'},
                    {'type': 'summary_text', 'text': 'Second thought.'},
                ],
            },
        )

        class _PlainResponses:
            def __init__(self):
                self.calls = []

            def create(self, **kwargs):
                self.calls.append(kwargs)
                return response

        fake = _PlainResponses()
        client = _client(fake, reasoning_effort='low', reasoning_summary_enabled=True)
        thoughts = []
        # No on_text_delta → plain (non-streaming) path.
        result = client.complete([], [], on_reasoning_part=thoughts.append)
        self.assertEqual(thoughts, ['First thought.', 'Second thought.'])
        self.assertEqual(result.content, 'Done.')
        self.assertEqual(
            fake.calls[0].get('reasoning'), {'effort': 'low', 'summary': 'auto'}
        )

    def test_summary_unsupported_selfheals_and_keeps_effort(self):
        class _VerificationGate:
            """Rejects reasoning.summary once (org-verification 400)."""

            def __init__(self):
                self.calls = []

            def create(self, **kwargs):
                self.calls.append(kwargs)
                if 'summary' in kwargs.get('reasoning', {}):
                    raise RuntimeError(
                        'Your organization must be verified to generate reasoning summaries.'
                    )
                return _final_response()

        fake = _VerificationGate()
        client = _client(fake, reasoning_effort='low', reasoning_summary_enabled=True)
        result = client.complete([], [], on_reasoning_part=lambda _t: None)
        self.assertEqual(result.content, 'Hello world.')
        self.assertEqual(
            fake.calls[0].get('reasoning'), {'effort': 'low', 'summary': 'auto'}
        )
        # Retry kept reasoning effort, dropped only the summary request.
        self.assertEqual(fake.calls[1].get('reasoning'), {'effort': 'low'})
        self.assertTrue(client._drop_reasoning_summary)
        # Sticky for the rest of the process.
        client.complete([], [], on_reasoning_part=lambda _t: None)
        self.assertEqual(fake.calls[2].get('reasoning'), {'effort': 'low'})


class ThoughtEmitterTests(unittest.TestCase):
    def _emitter(self):
        emitter = ThoughtEmitter(get_settings(), trace_id='t-thought')
        emitter.set_turn(1)
        captured = []

        def _capture(logger, event, **kwargs):
            captured.append((event, kwargs))

        return emitter, captured, _capture

    def test_each_part_emits_one_event_with_turn_and_seq(self):
        emitter, captured, capture = self._emitter()
        with mock.patch.object(progress_mod, 'log_event', capture):
            emitter.on_part('First thought.')
            emitter.on_part('Second thought.')
        self.assertEqual(len(captured), 2)
        self.assertEqual(captured[0][0], 'assistant_thought')
        self.assertEqual(captured[0][1]['text'], 'First thought.')
        self.assertEqual(captured[0][1]['turn'], 1)
        self.assertEqual(captured[0][1]['thought_seq'], 1)
        self.assertEqual(captured[1][1]['thought_seq'], 2)

    def test_new_turn_resets_thought_seq(self):
        emitter, captured, capture = self._emitter()
        with mock.patch.object(progress_mod, 'log_event', capture):
            emitter.on_part('a')
            emitter.set_turn(2)
            emitter.on_part('b')
        self.assertEqual(captured[1][1]['turn'], 2)
        self.assertEqual(captured[1][1]['thought_seq'], 1)

    def test_blank_text_is_skipped_and_long_text_truncated(self):
        emitter, captured, capture = self._emitter()
        with mock.patch.object(progress_mod, 'log_event', capture):
            emitter.on_part('   ')
            emitter.on_part('x' * 900)
        self.assertEqual(len(captured), 1)
        self.assertLessEqual(len(captured[0][1]['text']), 400)
        self.assertTrue(captured[0][1]['text'].endswith('…'))

    def test_markdown_bold_and_code_markers_are_stripped(self):
        emitter, captured, capture = self._emitter()
        with mock.patch.object(progress_mod, 'log_event', capture):
            emitter.on_part('**Gathering project details** I need `get_node_details`.')
        self.assertEqual(
            captured[0][1]['text'],
            'Gathering project details I need get_node_details.',
        )


class AssistantThoughtProgressPlumbingTests(unittest.TestCase):
    """assistant_thought rides the real progress-trace store end to end."""

    def test_captured_and_served_in_both_detail_modes(self):
        settings = get_settings()
        trace_id = str(uuid.uuid4())
        log_event(
            progress_mod.logger,
            'assistant_thought',
            settings=settings,
            trace_id=trace_id,
            brain='v2',
            text='The user wants overdue items closed — finding them first.',
            turn=1,
            thought_seq=1,
        )
        for detail in ('verbose', 'structured'):
            response = get_progress_trace_events(
                session_id='any',
                trace_id=trace_id,
                after_seq=0,
                detail=detail,
                settings=settings,
            )
            self.assertIsNotNone(response, detail)
            events = response['events']
            self.assertEqual(len(events), 1, detail)
            event = events[0]
            self.assertEqual(event['event'], 'assistant_thought')
            self.assertEqual(event['title'], 'Thinking')
            self.assertEqual(event['status'], 'success')
            self.assertEqual(
                event['summary'],
                'The user wants overdue items closed — finding them first.',
            )
            self.assertEqual(
                event['details'].get('text'),
                'The user wants overdue items closed — finding them first.',
                detail,
            )
            self.assertEqual(event['details'].get('thought_seq'), 1, detail)


class AssistantDeltaEmitterTests(unittest.TestCase):
    def _emitter(self):
        emitter = AssistantDeltaEmitter(get_settings(), trace_id='t-1')
        emitter.set_turn(1)
        captured = []

        def _capture(logger, event, **kwargs):
            captured.append((event, kwargs))

        return emitter, captured, _capture

    def test_small_deltas_buffer_until_size_threshold(self):
        emitter, captured, capture = self._emitter()
        with mock.patch.object(progress_mod, 'log_event', capture):
            emitter.on_delta('a' * 100)
            self.assertEqual(captured, [])  # below 280 chars, within 0.4s
            emitter.on_delta('b' * 200)  # crosses 280
            self.assertEqual(len(captured), 1)
        event, kwargs = captured[0]
        self.assertEqual(event, 'assistant_delta')
        self.assertEqual(kwargs['text'], 'a' * 100 + 'b' * 200)
        self.assertEqual(kwargs['turn'], 1)
        self.assertEqual(kwargs['delta_seq'], 1)

    def test_time_threshold_flushes_small_buffer(self):
        emitter, captured, capture = self._emitter()
        with mock.patch.object(progress_mod, 'log_event', capture):
            emitter._last_flush = monotonic() - 1.0  # pretend 1s elapsed
            emitter.on_delta('hi')
            self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0][1]['text'], 'hi')

    def test_finish_flushes_remainder_and_new_turn_resets(self):
        emitter, captured, capture = self._emitter()
        with mock.patch.object(progress_mod, 'log_event', capture):
            emitter.on_delta('tail')
            emitter.finish()
            self.assertEqual(len(captured), 1)
            self.assertEqual(captured[0][1]['text'], 'tail')
            emitter.set_turn(2)
            emitter.on_delta('x')
            emitter.finish()
        self.assertEqual(captured[1][1]['turn'], 2)
        self.assertEqual(captured[1][1]['delta_seq'], 2)

    def test_finish_with_empty_buffer_emits_nothing(self):
        emitter, captured, capture = self._emitter()
        with mock.patch.object(progress_mod, 'log_event', capture):
            emitter.finish()
        self.assertEqual(captured, [])


class AssistantDeltaProgressPlumbingTests(unittest.TestCase):
    """assistant_delta rides the real progress-trace store end to end."""

    def test_captured_and_served_in_both_detail_modes(self):
        settings = get_settings()
        trace_id = str(uuid.uuid4())
        log_event(
            progress_mod.logger,
            'assistant_delta',
            settings=settings,
            trace_id=trace_id,
            brain='v2',
            text='Renaming the Login feature…',
            turn=2,
            delta_seq=1,
        )
        for detail in ('verbose', 'structured'):
            response = get_progress_trace_events(
                session_id='any',
                trace_id=trace_id,
                after_seq=0,
                detail=detail,
                settings=settings,
            )
            self.assertIsNotNone(response, detail)
            events = response['events']
            self.assertEqual(len(events), 1, detail)
            event = events[0]
            self.assertEqual(event['event'], 'assistant_delta')
            self.assertEqual(
                event['details'].get('text'),
                'Renaming the Login feature…',
                detail,
            )
            self.assertEqual(event['details'].get('turn'), 2, detail)


if __name__ == '__main__':
    unittest.main()

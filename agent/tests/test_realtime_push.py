"""Realtime push of AI-trace progress events (app/core/realtime_push.py).

Covers: the dormant-unless-configured gate, the publish item shape, the
never-raise send path, and the _capture_progress_event hook that mirrors
each captured event to the user's realtime room.
"""

import unittest
import uuid
from types import SimpleNamespace
from unittest import mock

from app.core import logging_utils, realtime_push
from app.core.logging_utils import log_event
from app.core.v2 import progress as progress_mod


def _push_settings(**overrides):
    values = {
        'agent_realtime_trace_push_enabled': True,
        'realtime_worker_url': 'https://realtime.example.dev',
        'realtime_publish_token': 'secret-token',
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class PublishGateTests(unittest.TestCase):
    def _enqueued(self, settings, user_id='user-1'):
        items = []
        fake_queue = SimpleNamespace(put_nowait=items.append)
        with mock.patch.object(realtime_push, '_ensure_worker', return_value=fake_queue):
            realtime_push.publish_trace_event(settings, user_id, {'trace_id': 't-1'})
        return items

    def test_publishes_when_fully_configured(self):
        items = self._enqueued(_push_settings())
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item['url'], 'https://realtime.example.dev/publish')
        self.assertEqual(item['token'], 'secret-token')
        self.assertEqual(item['body']['room'], 'user:user-1')
        self.assertEqual(item['body']['event'], 'ai_trace_event')
        self.assertEqual(item['body']['payload'], {'trace_id': 't-1'})

    def test_dormant_when_flag_off(self):
        self.assertEqual(
            self._enqueued(_push_settings(agent_realtime_trace_push_enabled=False)),
            [],
        )

    def test_dormant_when_url_or_token_missing(self):
        self.assertEqual(self._enqueued(_push_settings(realtime_worker_url=None)), [])
        self.assertEqual(self._enqueued(_push_settings(realtime_publish_token=None)), [])

    def test_dormant_without_user_id(self):
        self.assertEqual(self._enqueued(_push_settings(), user_id=None), [])

    def test_enqueue_failure_never_raises(self):
        def _boom(_item):
            raise RuntimeError('queue exploded')

        fake_queue = SimpleNamespace(put_nowait=_boom)
        with mock.patch.object(realtime_push, '_ensure_worker', return_value=fake_queue):
            realtime_push.publish_trace_event(_push_settings(), 'user-1', {})


class SendTests(unittest.TestCase):
    def test_posts_body_with_token_header(self):
        calls = []

        def _post(url, json=None, headers=None):
            calls.append((url, json, headers))
            return SimpleNamespace(status_code=202, text='')

        client = SimpleNamespace(post=_post)
        item = realtime_push._build_item(
            'https://realtime.example.dev/', 'secret', 'user-1', {'seq': 1}
        )
        realtime_push._send(client, item)
        url, body, headers = calls[0]
        self.assertEqual(url, 'https://realtime.example.dev/publish')
        self.assertEqual(headers, {'x-realtime-token': 'secret'})
        self.assertEqual(body['room'], 'user:user-1')
        self.assertEqual(body['payload'], {'seq': 1})

    def test_transport_error_never_raises(self):
        def _post(*_args, **_kwargs):
            raise RuntimeError('connection refused')

        client = SimpleNamespace(post=_post)
        item = realtime_push._build_item('https://x.dev', 'secret', 'u', {})
        realtime_push._send(client, item)

    def test_rejection_status_never_raises(self):
        client = SimpleNamespace(
            post=lambda *_a, **_k: SimpleNamespace(status_code=401, text='bad token')
        )
        item = realtime_push._build_item('https://x.dev', 'secret', 'u', {})
        realtime_push._send(client, item)


class CaptureHookTests(unittest.TestCase):
    """_capture_progress_event mirrors each event to the user's room."""

    def _settings(self, push_enabled=True):
        return SimpleNamespace(
            agent_log_json=True,
            agent_log_color='auto',
            agent_log_include_content=False,
            agent_progress_events_enabled=True,
            agent_progress_events_allow_verbose=True,
            agent_realtime_trace_push_enabled=push_enabled,
            realtime_worker_url='https://realtime.example.dev',
            realtime_publish_token='secret-token',
        )

    def test_event_with_actor_id_publishes_structured_envelope(self):
        settings = self._settings()
        trace_id = str(uuid.uuid4())
        published = []
        with mock.patch.object(
            logging_utils.realtime_push,
            'publish_trace_event',
            lambda s, user_id, envelope: published.append((user_id, envelope)),
        ):
            log_event(
                progress_mod.logger,
                'assistant_thought',
                settings=settings,
                trace_id=trace_id,
                session_id='session-1',
                roadmap_id='roadmap-1',
                actor_id='user-42',
                brain='v2',
                text='Reviewing the epic first.',
                turn=1,
                thought_seq=1,
            )
        self.assertEqual(len(published), 1)
        user_id, envelope = published[0]
        self.assertEqual(user_id, 'user-42')
        self.assertEqual(envelope['trace_id'], trace_id)
        self.assertEqual(envelope['session_id'], 'session-1')
        self.assertEqual(envelope['roadmap_id'], 'roadmap-1')
        self.assertFalse(envelope['done'])
        events = envelope['events']
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event['event'], 'assistant_thought')
        self.assertEqual(envelope['next_seq'], event['seq'])
        # Structured details only — matches the web's detail=structured poll.
        self.assertEqual(
            sorted(event['details'].keys()), ['text', 'thought_seq', 'turn']
        )

    def test_no_publish_without_actor_id_or_with_flag_off(self):
        published = []
        with mock.patch.object(
            logging_utils.realtime_push,
            'publish_trace_event',
            lambda s, user_id, envelope: published.append(envelope),
        ):
            log_event(
                progress_mod.logger,
                'assistant_thought',
                settings=self._settings(),
                trace_id=str(uuid.uuid4()),
                brain='v2',
                text='No actor bound.',
                turn=1,
                thought_seq=1,
            )
            log_event(
                progress_mod.logger,
                'assistant_thought',
                settings=self._settings(push_enabled=False),
                trace_id=str(uuid.uuid4()),
                actor_id='user-42',
                brain='v2',
                text='Push disabled.',
                turn=1,
                thought_seq=1,
            )
        self.assertEqual(published, [])


if __name__ == '__main__':
    unittest.main()

"""Fire-and-forget publisher: AI-trace progress events → realtime worker.

Mirrors the NestJS ``RealtimePublisher`` semantics (backend/src/modules/
realtime/realtime-publisher.service.ts): dormant unless configured, never
raises, short timeout, warn-log failures and keep going. The web merges pushed
events through the same seq-deduped path as polling, so a dropped publish only
costs latency — polling remains the authoritative cursor.

Runs on a daemon thread with a bounded queue because progress events are
captured inside ``log_event`` (``app.core.trace.store.capture``) on worker
threads with no event loop.

``build_trace_envelope`` is the one place the pushed payload shape lives:
``{trace_id, session_id, roadmap_id, run_id, phase, events:[one event],
next_seq, done, started_at, completed_at}`` — a one-event slice of the
polling response, so the web merges both through the same seq-deduped path.
"""

from __future__ import annotations

import logging
import queue
import threading
from typing import Any

logger = logging.getLogger('app.core.realtime_push')

_QUEUE_MAX = 1000
_HTTP_TIMEOUT_SECONDS = 3.0

_queue: queue.Queue | None = None
_worker: threading.Thread | None = None
_lock = threading.Lock()


def publish_trace_event(
    settings: Any,
    user_id: str | None,
    envelope: dict[str, Any],
) -> None:
    """Queue one trace-event envelope for the user's realtime room.

    No-op unless push is enabled and fully configured; never raises.
    """
    try:
        enabled = bool(getattr(settings, 'agent_realtime_trace_push_enabled', False))
        url = getattr(settings, 'realtime_worker_url', None)
        token = getattr(settings, 'realtime_publish_token', None)
        if not (enabled and url and token and user_id):
            return
        _ensure_worker().put_nowait(_build_item(str(url), str(token), user_id, envelope))
    except queue.Full:
        # Pathological backlog — drop silently; polling covers the gap.
        pass
    except Exception:  # noqa: BLE001 — publishing must never break the loop
        logger.debug('realtime push enqueue failed', exc_info=True)


def build_trace_envelope(meta: Any, event_payload: dict[str, Any]) -> dict[str, Any]:
    """One-event envelope for the user's room.

    ``meta`` is the trace's metadata (``app.core.trace.store.TraceMeta`` or
    anything with the same attributes); ``event_payload`` is the already
    serialized event (structured details, as the web's ``detail=structured``
    poll would return it).
    """
    return {
        'trace_id': getattr(meta, 'trace_id', None),
        'session_id': getattr(meta, 'session_id', None),
        'roadmap_id': getattr(meta, 'roadmap_id', None),
        'run_id': getattr(meta, 'run_id', None),
        'phase': getattr(meta, 'phase', None),
        'events': [event_payload],
        'next_seq': event_payload.get('seq'),
        'done': bool(getattr(meta, 'done', False)),
        'started_at': getattr(meta, 'started_at', None),
        'completed_at': getattr(meta, 'completed_at', None),
    }


def _build_item(
    url: str,
    token: str,
    user_id: str,
    envelope: dict[str, Any],
) -> dict[str, Any]:
    return {
        'url': url.rstrip('/') + '/publish',
        'token': token,
        'body': {
            'room': f'user:{user_id}',
            'event': 'ai_trace_event',
            'payload': envelope,
        },
    }


def _ensure_worker() -> queue.Queue:
    global _queue, _worker
    with _lock:
        if _queue is None:
            _queue = queue.Queue(maxsize=_QUEUE_MAX)
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(
                target=_run_worker,
                args=(_queue,),
                name='realtime-push',
                daemon=True,
            )
            _worker.start()
    return _queue


def _run_worker(q: queue.Queue) -> None:
    client = _build_client()
    while True:
        item = q.get()
        try:
            _send(client, item)
        finally:
            q.task_done()


def _build_client() -> Any:
    import httpx

    return httpx.Client(timeout=_HTTP_TIMEOUT_SECONDS)


def _send(client: Any, item: dict[str, Any]) -> None:
    try:
        response = client.post(
            item['url'],
            json=item['body'],
            headers={'x-realtime-token': item['token']},
        )
        status_code = getattr(response, 'status_code', 0)
        if status_code >= 300:
            logger.warning(
                'realtime publish rejected: %s %s',
                status_code,
                str(getattr(response, 'text', ''))[:200],
            )
    except Exception as exc:  # noqa: BLE001 — fire-and-forget
        logger.warning(
            'realtime publish failed: %s: %s',
            type(exc).__name__,
            str(exc)[:200],
        )

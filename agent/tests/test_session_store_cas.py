from __future__ import annotations

import unittest
from typing import Any
from unittest.mock import patch

from app.core.contracts.sessions import AgentSession
from app.core.session_store import (
    SessionStore,
    SessionStoreConflictError,
    _parse_cas_result,
    with_cas_retry,
)


class _FakeRedis:
    """Minimal fake that exposes the two methods SessionStore uses: set/get/eval.

    Maintains JSON and version counter keys in memory, and emulates the Lua
    CAS contract so save_cas can be exercised end-to-end without Upstash.
    """

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.store[key] = value

    def get(self, key: str) -> str | None:
        return self.store.get(key)

    def expire(self, key: str, ttl: int) -> None:
        pass

    def eval(self, script: str, keys: list[str], args: list[str]) -> list[str]:
        json_key, version_key = keys
        payload, expected, ttl = args
        stored = self.store.get(version_key)
        if stored is None:
            if expected != '0':
                return ['conflict', '0']
        else:
            if stored != expected:
                return ['conflict', stored]
        self.store[json_key] = payload
        new_version = int(stored or '0') + 1
        self.store[version_key] = str(new_version)
        return ['ok', str(new_version)]


def _make_store(fake: _FakeRedis) -> SessionStore:
    with patch('app.core.session_store.Redis'):
        store = SessionStore.__new__(SessionStore)
        store._ttl_seconds = 60
        store._key_prefix = 'test'
        import logging
        store._logger = logging.getLogger('test-store')
        store._redis = fake  # type: ignore[assignment]
    return store


def _make_session(version: int = 0, session_id: str = 'fixed-session-id') -> AgentSession:
    session = AgentSession(session_id=session_id, roadmap_id='r-1')
    session.version = version
    return session


class ParseCasResultTests(unittest.TestCase):
    def test_ok_result(self) -> None:
        self.assertEqual(_parse_cas_result(['ok', '5']), ('ok', '5'))

    def test_conflict_result(self) -> None:
        self.assertEqual(_parse_cas_result(['conflict', '7']), ('conflict', '7'))

    def test_unknown_outcome_treated_as_conflict(self) -> None:
        outcome, _ = _parse_cas_result(['weird', '3'])
        self.assertEqual(outcome, 'conflict')

    def test_malformed_shape_treated_as_conflict(self) -> None:
        self.assertEqual(_parse_cas_result('not-a-list'), ('conflict', ''))

    def test_case_insensitive_outcome(self) -> None:
        self.assertEqual(_parse_cas_result(['OK', '1']), ('ok', '1'))

    def test_bytes_result_decoded(self) -> None:
        # Upstash SDK versions may return bytes — exact-match on 'ok' must
        # survive byte→str conversion (str(b'ok') would otherwise give "b'ok'").
        self.assertEqual(_parse_cas_result([b'ok', b'3']), ('ok', '3'))
        self.assertEqual(_parse_cas_result([b'conflict', b'7']), ('conflict', '7'))


class SaveCasHappyPathTests(unittest.TestCase):
    def test_first_save_succeeds_and_bumps_version(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        session = _make_session(version=0)

        store.save_cas(session)
        self.assertEqual(session.version, 1)
        self.assertIn(f'test:{session.session_id}', fake.store)
        self.assertEqual(fake.store[f'test:{session.session_id}:v'], '1')

    def test_sequential_saves_monotonically_increment(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        session = _make_session(version=0)

        for expected in (1, 2, 3):
            store.save_cas(session)
            self.assertEqual(session.version, expected)


class SaveCasConflictTests(unittest.TestCase):
    def test_stale_version_raises_conflict(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        sid = 'sess-1'
        session_a = _make_session(version=0, session_id=sid)
        store.save_cas(session_a)
        # session_a.version is now 1; another writer loaded version 0
        session_b = _make_session(version=0, session_id=sid)
        with self.assertRaises(SessionStoreConflictError) as ctx:
            store.save_cas(session_b)
        self.assertEqual(ctx.exception.expected_version, 0)
        self.assertEqual(ctx.exception.stored_version, 1)
        self.assertEqual(ctx.exception.session_id, sid)

    def test_conflict_does_not_mutate_session_version(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        sid = 'sess-2'
        store.save_cas(_make_session(version=0, session_id=sid))
        session_b = _make_session(version=0, session_id=sid)
        with self.assertRaises(SessionStoreConflictError):
            store.save_cas(session_b)
        self.assertEqual(session_b.version, 0)

    def test_initial_save_with_nonzero_expected_raises_conflict(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        session = _make_session(version=5)  # claims version 5 but nothing stored
        with self.assertRaises(SessionStoreConflictError):
            store.save_cas(session)


class WithCasRetryTests(unittest.TestCase):
    def test_succeeds_without_retry_when_no_conflict(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        shared = {'session': _make_session(version=0)}

        conflicts: list[int] = []

        result = with_cas_retry(
            load_fn=lambda: _make_session(version=shared['session'].version),
            mutate_fn=lambda s: s,
            save_fn=lambda s: store.save_cas(s),
            on_conflict=lambda attempt, _exc: conflicts.append(attempt),
        )
        self.assertEqual(result.version, 1)
        self.assertEqual(conflicts, [])

    def test_retries_on_conflict_then_succeeds(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        sid = 'sess-retry-success'

        # Pre-save so stored version = 1. The loader initially returns version=0
        # (stale), then version=1 (fresh).
        store.save_cas(_make_session(version=0, session_id=sid))

        loads = {'calls': 0}

        def _loader() -> AgentSession:
            loads['calls'] += 1
            return _make_session(
                version=0 if loads['calls'] == 1 else 1,
                session_id=sid,
            )

        conflicts: list[int] = []

        result = with_cas_retry(
            load_fn=_loader,
            mutate_fn=lambda s: s,
            save_fn=lambda s: store.save_cas(s),
            base_backoff_ms=0.0,
            jitter_ms=0.0,
            on_conflict=lambda attempt, _exc: conflicts.append(attempt),
        )
        self.assertEqual(result.version, 2)
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0], 0)
        self.assertEqual(loads['calls'], 2)

    def test_exhausts_retries_and_raises_last_conflict(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        sid = 'sess-exhaust'

        store.save_cas(_make_session(version=0, session_id=sid))
        conflicts: list[int] = []

        with self.assertRaises(SessionStoreConflictError):
            with_cas_retry(
                load_fn=lambda: _make_session(version=0, session_id=sid),
                mutate_fn=lambda s: s,
                save_fn=lambda s: store.save_cas(s),
                max_attempts=3,
                base_backoff_ms=0.0,
                jitter_ms=0.0,
                on_conflict=lambda attempt, _exc: conflicts.append(attempt),
            )
        self.assertEqual(conflicts, [0, 1, 2])

    def test_missing_session_raises_value_error(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        with self.assertRaises(ValueError):
            with_cas_retry(
                load_fn=lambda: None,
                mutate_fn=lambda s: s,
                save_fn=lambda s: store.save_cas(s),
            )


if __name__ == '__main__':
    unittest.main()

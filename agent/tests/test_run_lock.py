"""SessionStore run lock (SET NX EX + Lua compare-and-delete) and the generic
JSON side keys, exercised against the same fake-redis style as
test_session_store_cas.py."""

from __future__ import annotations

import logging
import unittest
from typing import Any
from unittest.mock import patch

from app.core.session_store import (
    SessionStore,
    _coerce_to_int,
    _set_nx_succeeded,
)


class _FakeRedis:
    """In-memory stand-in for the Upstash client surface the store uses:
    set (with nx/ex), get, delete, exists, expire, and eval for both Lua
    scripts (the CAS save and the compare-and-delete release)."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.ttls: dict[str, int] = {}
        self.set_calls: list[dict[str, Any]] = []

    def set(
        self,
        key: str,
        value: str,
        nx: bool | None = None,
        ex: int | None = None,
    ) -> Any:
        self.set_calls.append({'key': key, 'value': value, 'nx': nx, 'ex': ex})
        if nx and key in self.store:
            return None
        self.store[key] = value
        if ex is not None:
            self.ttls[key] = ex
        return 'OK'

    def get(self, key: str) -> str | None:
        return self.store.get(key)

    def delete(self, *keys: str) -> int:
        removed = 0
        for key in keys:
            if key in self.store:
                del self.store[key]
                self.ttls.pop(key, None)
                removed += 1
        return removed

    def exists(self, *keys: str) -> int:
        return sum(1 for key in keys if key in self.store)

    def expire(self, key: str, ttl: int) -> None:
        self.ttls[key] = ttl

    def eval(self, script: str, keys: list[str], args: list[str]) -> Any:
        if 'INCR' in script:
            json_key, version_key = keys
            payload, expected, ttl = args
            stored = self.store.get(version_key)
            if stored is None:
                if expected != '0':
                    return ['conflict', '0']
            elif stored != expected:
                return ['conflict', stored]
            self.store[json_key] = payload
            new_version = int(stored or '0') + 1
            self.store[version_key] = str(new_version)
            return ['ok', str(new_version)]
        # Compare-and-delete release script.
        (lock_key,) = keys
        (token,) = args
        if self.store.get(lock_key) == token:
            del self.store[lock_key]
            self.ttls.pop(lock_key, None)
            return 1
        return 0


def _make_store(fake: _FakeRedis) -> SessionStore:
    with patch('app.core.session_store.Redis'):
        store = SessionStore.__new__(SessionStore)
        store._ttl_seconds = 60
        store._key_prefix = 'test'
        store._logger = logging.getLogger('test-run-lock')
        store._redis = fake  # type: ignore[assignment]
    return store


class RunLockKeyTests(unittest.TestCase):
    def test_key_helpers_hang_off_the_session_key(self) -> None:
        store = _make_store(_FakeRedis())
        self.assertEqual(store.run_lock_key('s-1'), 'test:s-1:run_lock')
        self.assertEqual(store.run_key('s-1', 'run-9', 'transcript'), 'test:s-1:run:run-9:transcript')
        self.assertEqual(store.run_key('s-1', 'run-9', 'cancel'), 'test:s-1:run:run-9:cancel')
        self.assertEqual(store.side_key('s-1', 'a', 'b'), 'test:s-1:a:b')
        self.assertEqual(store.key_prefix, 'test')

    def test_redis_property_exposes_the_client(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        self.assertIs(store.redis, fake)


class AcquireReleaseTests(unittest.TestCase):
    def test_acquire_returns_a_token_and_sets_nx_with_ttl(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        token = store.acquire_run_lock('s-1', 300)
        self.assertIsInstance(token, str)
        assert token is not None
        self.assertEqual(len(token), 32)
        self.assertEqual(fake.store['test:s-1:run_lock'], token)
        self.assertEqual(fake.ttls['test:s-1:run_lock'], 300)
        call = fake.set_calls[-1]
        self.assertTrue(call['nx'])
        self.assertEqual(call['ex'], 300)

    def test_second_acquire_while_held_returns_none(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        first = store.acquire_run_lock('s-1', 300)
        self.assertIsNotNone(first)
        self.assertIsNone(store.acquire_run_lock('s-1', 300))
        # The original holder's token is untouched.
        self.assertEqual(fake.store['test:s-1:run_lock'], first)

    def test_locks_are_per_session(self) -> None:
        store = _make_store(_FakeRedis())
        self.assertIsNotNone(store.acquire_run_lock('s-1', 300))
        self.assertIsNotNone(store.acquire_run_lock('s-2', 300))

    def test_release_with_holder_token_deletes_the_lock(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        token = store.acquire_run_lock('s-1', 300)
        self.assertTrue(store.release_run_lock('s-1', token))
        self.assertNotIn('test:s-1:run_lock', fake.store)
        # Re-acquire succeeds once released.
        self.assertIsNotNone(store.acquire_run_lock('s-1', 300))

    def test_release_with_wrong_token_is_a_noop(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        token = store.acquire_run_lock('s-1', 300)
        self.assertFalse(store.release_run_lock('s-1', 'not-the-token'))
        self.assertEqual(fake.store['test:s-1:run_lock'], token)

    def test_release_after_expiry_and_reacquire_leaves_new_holder_alone(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        stale = store.acquire_run_lock('s-1', 300)
        # Simulate TTL expiry, then another request takes the lock.
        del fake.store['test:s-1:run_lock']
        fresh = store.acquire_run_lock('s-1', 300)
        self.assertNotEqual(stale, fresh)
        self.assertFalse(store.release_run_lock('s-1', stale))
        self.assertEqual(fake.store['test:s-1:run_lock'], fresh)
        self.assertTrue(store.release_run_lock('s-1', fresh))

    def test_release_with_empty_token_is_false(self) -> None:
        store = _make_store(_FakeRedis())
        self.assertFalse(store.release_run_lock('s-1', None))
        self.assertFalse(store.release_run_lock('s-1', ''))

    def test_acquire_requires_positive_ttl(self) -> None:
        store = _make_store(_FakeRedis())
        with self.assertRaises(ValueError):
            store.acquire_run_lock('s-1', 0)

    def test_set_nx_result_normalization(self) -> None:
        self.assertTrue(_set_nx_succeeded('OK'))
        self.assertTrue(_set_nx_succeeded(b'ok'))
        self.assertTrue(_set_nx_succeeded(True))
        self.assertFalse(_set_nx_succeeded(None))
        self.assertFalse(_set_nx_succeeded(False))
        self.assertFalse(_set_nx_succeeded(''))

    def test_coerce_to_int_variants(self) -> None:
        self.assertEqual(_coerce_to_int(1), 1)
        self.assertEqual(_coerce_to_int('1'), 1)
        self.assertEqual(_coerce_to_int(b'0'), 0)
        self.assertEqual(_coerce_to_int(None), 0)
        self.assertEqual(_coerce_to_int('garbage'), 0)
        self.assertEqual(_coerce_to_int(True), 1)


class SideKeyTests(unittest.TestCase):
    def test_put_get_round_trip_with_ttl(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        key = store.run_key('s-1', 'run-1', 'transcript')
        payload = {'items': [{'type': 'function_call', 'name': 'get_roadmap_overview'}], 'n': 2}
        store.put_side_key(key, payload, 900)
        self.assertEqual(store.get_side_key(key), payload)
        self.assertEqual(fake.ttls[key], 900)
        self.assertTrue(store.exists(key))

    def test_get_missing_returns_none(self) -> None:
        store = _make_store(_FakeRedis())
        self.assertIsNone(store.get_side_key('test:s-1:run:x:transcript'))
        self.assertFalse(store.exists('test:s-1:run:x:transcript'))

    def test_get_malformed_json_returns_none(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        fake.store['test:bad'] = '{not json'
        self.assertIsNone(store.get_side_key('test:bad'))

    def test_get_decodes_bytes(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        fake.store['test:bytes'] = b'{"a": 1}'  # type: ignore[assignment]
        self.assertEqual(store.get_side_key('test:bytes'), {'a': 1})

    def test_delete_removes_and_exists_reflects_it(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        key = store.run_key('s-1', 'run-1', 'cancel')
        store.put_side_key(key, 1, 900)
        self.assertTrue(store.exists(key))
        store.delete_side_key(key)
        self.assertFalse(store.exists(key))
        # Deleting again is harmless.
        store.delete_side_key(key)

    def test_put_requires_positive_ttl(self) -> None:
        store = _make_store(_FakeRedis())
        with self.assertRaises(ValueError):
            store.put_side_key('test:k', {}, 0)

    def test_side_keys_do_not_collide_with_the_session_document(self) -> None:
        fake = _FakeRedis()
        store = _make_store(fake)
        store.put_side_key(store.run_key('s-1', 'run-1', 'transcript'), [1], 10)
        self.assertNotIn('test:s-1', fake.store)
        self.assertNotIn('test:s-1:v', fake.store)


if __name__ == '__main__':
    unittest.main()

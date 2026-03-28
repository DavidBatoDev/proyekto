from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any


@dataclass
class CacheEntry:
    value: dict[str, Any] | str
    expires_at: datetime


class ContextAnswerCache:
    def __init__(self, ttl_seconds: int) -> None:
        self._ttl_seconds = max(1, int(ttl_seconds))
        self._entries: dict[str, CacheEntry] = {}
        self._lock = Lock()

    def get(self, key: str) -> dict[str, Any] | str | None:
        with self._lock:
            self._purge_expired_locked()
            entry = self._entries.get(key)
            if entry is None:
                return None
            return entry.value

    def set(self, key: str, value: dict[str, Any] | str) -> None:
        with self._lock:
            self._purge_expired_locked()
            self._entries[key] = CacheEntry(
                value=value,
                expires_at=datetime.now(timezone.utc) + timedelta(seconds=self._ttl_seconds),
            )

    def _purge_expired_locked(self) -> None:
        now = datetime.now(timezone.utc)
        expired = [key for key, entry in self._entries.items() if entry.expires_at <= now]
        for key in expired:
            del self._entries[key]

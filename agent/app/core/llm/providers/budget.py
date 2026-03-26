from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timezone, datetime
from threading import Lock


@dataclass
class BudgetState:
    provider: str
    limit: int
    used: int
    remaining: int


class DailyRequestBudget:
    def __init__(self, daily_limit: int) -> None:
        self._daily_limit = max(0, int(daily_limit))
        self._current_day = self._today_utc()
        self._used_by_provider: dict[str, int] = {}
        self._lock = Lock()

    def can_consume(self, provider: str) -> bool:
        with self._lock:
            self._rollover_if_needed()
            if self._daily_limit <= 0:
                return True
            return self._used_by_provider.get(provider, 0) < self._daily_limit

    def consume(self, provider: str) -> BudgetState:
        with self._lock:
            self._rollover_if_needed()
            if self._daily_limit > 0:
                self._used_by_provider[provider] = self._used_by_provider.get(provider, 0) + 1
            return self._state_locked(provider)

    def state(self, provider: str) -> BudgetState:
        with self._lock:
            self._rollover_if_needed()
            return self._state_locked(provider)

    def _state_locked(self, provider: str) -> BudgetState:
        used = self._used_by_provider.get(provider, 0)
        if self._daily_limit <= 0:
            remaining = 999_999
        else:
            remaining = max(0, self._daily_limit - used)
        return BudgetState(
            provider=provider,
            limit=self._daily_limit,
            used=used,
            remaining=remaining,
        )

    def _rollover_if_needed(self) -> None:
        today = self._today_utc()
        if today != self._current_day:
            self._current_day = today
            self._used_by_provider = {}

    def _today_utc(self) -> date:
        return datetime.now(timezone.utc).date()

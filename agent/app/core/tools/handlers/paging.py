"""Offset paging for the agent's list tools.

Every list tool takes an optional ``offset`` beside ``limit`` and answers with
the same page keys, so the model reads "showing N from offset O of T; continue
at next_offset" the same way everywhere:

- ``offset``            the effective zero-based start of this page
- ``returned_<key>``    rows on this page
- ``next_offset``       where the next page starts, or ``None`` when this page
                        ended the set
- ``total_<key>``       the size of the whole filtered set, only when known

Two sources exist. A backend that pages for us (``/ai/context/tasks``,
``/ai/context/roadmaps``, ``/ai/context/search``) answers with ``offset`` /
``next_offset`` / ``total`` itself and ``page_from_backend`` renames them. A
roadmap-keyed read returns the set from its start (the backend slices its
in-memory roadmap by ``limit`` only), so the handler asks for
``offset + limit + 1`` rows (``fetch_window``, bounded by the source's cap) and
``page_from_start`` slices the page; the extra row is the "is there more"
probe, and a fetch that came back short of the window proves the set is
complete, which is when ``total_<key>`` is reported.

Pure functions; no I/O.
"""

from __future__ import annotations

from typing import Any

MAX_OFFSET = 10_000
PAGING_UNSUPPORTED_CODE = 'PAGING_UNSUPPORTED'


def clamp_offset(value: Any) -> int:
    """A non-negative int (bools and junk read as 0), capped at MAX_OFFSET."""
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return max(0, min(value, MAX_OFFSET))


def fetch_window(offset: int, limit: int, cap: int) -> int:
    """Rows to request from a from-the-start source: the page, its probe row,
    never more than the source can return."""
    return max(1, min(int(cap), int(offset) + int(limit) + 1))


def _count(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def page_from_start(
    rows: list[Any],
    key: str,
    *,
    offset: int,
    limit: int,
    complete: bool,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Slice a page out of rows that begin at index 0.

    ``complete`` says the rows are the whole set (a fetch shorter than its
    window, or a list built from a full summary): the total is reported and
    ``next_offset`` follows from the slice alone. Otherwise a full page is
    assumed to have a successor even when no probe row made it through a
    later filter.
    """
    items = list(rows)
    page = items[offset:offset + limit]
    result: dict[str, Any] = dict(extra or {})
    result[key] = page
    result['offset'] = offset
    result[f'returned_{key}'] = len(page)
    if complete:
        result[f'total_{key}'] = len(items)
    has_more = len(items) > offset + len(page) or (not complete and len(page) >= limit)
    result['next_offset'] = offset + len(page) if has_more and page else None
    return result


def page_from_backend(
    payload: dict[str, Any],
    key: str,
    *,
    offset: int,
) -> dict[str, Any]:
    """Normalise a backend page (``{<key>, offset, total, next_offset}``) to
    the tool contract. A backend from before paging answers with the list
    alone: the page is then reported as complete at the given offset."""
    items_raw = payload.get(key)
    items = [item for item in items_raw if isinstance(item, dict)] if isinstance(items_raw, list) else []
    result = {k: v for k, v in payload.items() if k not in {key, 'offset', 'total', 'next_offset', 'next_cursor'}}
    result[key] = items
    result['offset'] = _count(payload.get('offset')) if _count(payload.get('offset')) is not None else offset
    result[f'returned_{key}'] = len(items)
    total = _count(payload.get('total'))
    if total is not None:
        result[f'total_{key}'] = total
    result['next_offset'] = _count(payload.get('next_offset'))
    return result


def capped_list(payload: dict[str, Any], key: str, cap: int) -> dict[str, Any]:
    """A non-paged list bounded at ``cap`` rows, with an honest count."""
    items = payload.get(key)
    if not isinstance(items, list):
        return payload
    kept = items[:cap]
    return {**payload, key: kept, f'total_{key}': len(items), f'returned_{key}': len(kept)}


def paging_unsupported_error() -> dict[str, Any]:
    return {
        'error': {
            'code': PAGING_UNSUPPORTED_CODE,
            'message': (
                'Offset paging is not available on this backend yet. Narrow the '
                'query (status, due window, roadmap_ids) instead of paging.'
            ),
        }
    }


"""Apply a compact list of `revision_operations` against a prior proposed
hierarchy, returning a merged `proposed_hierarchy` plus any ops that could
not be matched. Pure data transformation — no logging, no I/O — so the
caller owns telemetry.

Why this exists: letting the LLM re-emit the full `proposed_hierarchy` for
a single-epic rename costs thousands of output tokens and ~50s of provider
time (see turn 3 of the rename trace in agent/logs.txt). Compact ops shift
that cost back to ~30 output tokens while letting the server guarantee
byte-identical preservation of unaffected epics/features/tasks.

Addressing: titles only — `ProposedEpic/Feature/Task` carry no ids (see
contracts/sessions.py). First top-down exact-match wins. Ops apply
sequentially, so a rename op renames the node for any subsequent op in the
same batch that references the NEW title.
"""

from __future__ import annotations

from typing import Any

from app.core.contracts.sessions import (
    ProposedEpic,
    ProposedFeature,
    ProposedTask,
)


# Keep the op set tight — 11 verbs cover >95% of natural revision intent
# seen in traces. New ops are additive; absence of an op just means the
# LLM falls back to a full `proposed_hierarchy` envelope.
_SUPPORTED_OPS: frozenset[str] = frozenset({
    'rename_epic',
    'rename_feature',
    'rename_task',
    'remove_epic',
    'remove_feature',
    'remove_task',
    'add_epic',
    'add_feature',
    'add_task',
    'reorder_epics',
    'update_metadata',
})


def apply_revision_operations(
    *,
    prior_hierarchy: list[ProposedEpic],
    operations: list[dict[str, Any]],
) -> tuple[list[ProposedEpic], list[dict[str, Any]]]:
    """Return (new_hierarchy, unresolved_ops). Deep-copies `prior_hierarchy`
    so the caller's list is never mutated. Silently skips malformed ops —
    callers checking the unresolved count alongside the total op count can
    tell a "nothing matched" fallback from a partial success.

    `update_metadata` ops target the plan-level fields (summary/goal/etc.)
    rather than the hierarchy; they do not appear in `unresolved_ops` even
    though they don't alter the returned list (the caller applies them
    separately when mutating the `PendingPlan`).
    """

    new_hierarchy: list[ProposedEpic] = [
        _clone_epic(epic) for epic in prior_hierarchy
    ]
    unresolved: list[dict[str, Any]] = []

    for raw_op in operations:
        if not isinstance(raw_op, dict):
            unresolved.append({'reason': 'op_not_a_dict', 'op_raw': raw_op})
            continue
        op_name = raw_op.get('op')
        if not isinstance(op_name, str) or op_name not in _SUPPORTED_OPS:
            unresolved.append({'reason': 'unsupported_op', 'op': op_name, 'op_raw': raw_op})
            continue

        handler = _OP_HANDLERS[op_name]
        resolved = handler(new_hierarchy, raw_op)
        if not resolved:
            unresolved.append({'reason': 'target_not_found', 'op': op_name, 'op_raw': raw_op})

    return new_hierarchy, unresolved


def extract_metadata_updates(
    operations: list[dict[str, Any]],
) -> dict[str, Any]:
    """Pull plan-level metadata updates (summary/goal/rationale/risks/
    next_steps) out of an ops list into a flat dict. Later ops override
    earlier ones per-field, matching sequential semantics."""

    updates: dict[str, Any] = {}
    for raw_op in operations:
        if not isinstance(raw_op, dict) or raw_op.get('op') != 'update_metadata':
            continue
        for field in ('summary', 'goal', 'rationale', 'risks', 'next_steps'):
            if field in raw_op:
                updates[field] = raw_op[field]
    return updates


def _clone_epic(epic: ProposedEpic) -> ProposedEpic:
    # model_copy(deep=True) is the pydantic idiom and cheaper than
    # round-tripping through model_dump/validate.
    return epic.model_copy(deep=True)


def _find_epic_index(
    hierarchy: list[ProposedEpic],
    title: str | None,
) -> int | None:
    if not isinstance(title, str) or not title.strip():
        return None
    needle = title.strip()
    for idx, epic in enumerate(hierarchy):
        if epic.title == needle:
            return idx
    return None


def _find_feature_index(
    epic: ProposedEpic,
    title: str | None,
) -> int | None:
    if not isinstance(title, str) or not title.strip():
        return None
    needle = title.strip()
    for idx, feature in enumerate(epic.features):
        if feature.title == needle:
            return idx
    return None


def _find_task_index(
    feature: ProposedFeature,
    title: str | None,
) -> int | None:
    if not isinstance(title, str) or not title.strip():
        return None
    needle = title.strip()
    for idx, task in enumerate(feature.tasks):
        if task.title == needle:
            return idx
    return None


def _valid_new_title(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    stripped = raw.strip()
    return stripped or None


def _op_rename_epic(hierarchy: list[ProposedEpic], op: dict[str, Any]) -> bool:
    idx = _find_epic_index(hierarchy, op.get('epic_title'))
    new_title = _valid_new_title(op.get('new_title'))
    if idx is None or new_title is None:
        return False
    hierarchy[idx].title = new_title
    return True


def _op_rename_feature(hierarchy: list[ProposedEpic], op: dict[str, Any]) -> bool:
    epic_idx = _find_epic_index(hierarchy, op.get('epic_title'))
    new_title = _valid_new_title(op.get('new_title'))
    if epic_idx is None or new_title is None:
        return False
    feature_idx = _find_feature_index(hierarchy[epic_idx], op.get('feature_title'))
    if feature_idx is None:
        return False
    hierarchy[epic_idx].features[feature_idx].title = new_title
    return True


def _op_rename_task(hierarchy: list[ProposedEpic], op: dict[str, Any]) -> bool:
    epic_idx = _find_epic_index(hierarchy, op.get('epic_title'))
    new_title = _valid_new_title(op.get('new_title'))
    if epic_idx is None or new_title is None:
        return False
    feature_idx = _find_feature_index(hierarchy[epic_idx], op.get('feature_title'))
    if feature_idx is None:
        return False
    task_idx = _find_task_index(
        hierarchy[epic_idx].features[feature_idx],
        op.get('task_title'),
    )
    if task_idx is None:
        return False
    hierarchy[epic_idx].features[feature_idx].tasks[task_idx].title = new_title
    return True


def _op_remove_epic(hierarchy: list[ProposedEpic], op: dict[str, Any]) -> bool:
    idx = _find_epic_index(hierarchy, op.get('epic_title'))
    if idx is None:
        return False
    hierarchy.pop(idx)
    return True


def _op_remove_feature(hierarchy: list[ProposedEpic], op: dict[str, Any]) -> bool:
    epic_idx = _find_epic_index(hierarchy, op.get('epic_title'))
    if epic_idx is None:
        return False
    feature_idx = _find_feature_index(hierarchy[epic_idx], op.get('feature_title'))
    if feature_idx is None:
        return False
    hierarchy[epic_idx].features.pop(feature_idx)
    return True


def _op_remove_task(hierarchy: list[ProposedEpic], op: dict[str, Any]) -> bool:
    epic_idx = _find_epic_index(hierarchy, op.get('epic_title'))
    if epic_idx is None:
        return False
    feature_idx = _find_feature_index(hierarchy[epic_idx], op.get('feature_title'))
    if feature_idx is None:
        return False
    task_idx = _find_task_index(
        hierarchy[epic_idx].features[feature_idx],
        op.get('task_title'),
    )
    if task_idx is None:
        return False
    hierarchy[epic_idx].features[feature_idx].tasks.pop(task_idx)
    return True


def _op_add_epic(hierarchy: list[ProposedEpic], op: dict[str, Any]) -> bool:
    epic_raw = op.get('epic')
    if not isinstance(epic_raw, dict):
        return False
    try:
        new_epic = ProposedEpic.model_validate(epic_raw)
    except Exception:
        return False
    anchor = op.get('after_epic_title')
    if isinstance(anchor, str) and anchor.strip():
        anchor_idx = _find_epic_index(hierarchy, anchor)
        if anchor_idx is None:
            # Anchor missing → append (more useful than dropping the op).
            hierarchy.append(new_epic)
            return True
        hierarchy.insert(anchor_idx + 1, new_epic)
        return True
    hierarchy.append(new_epic)
    return True


def _op_add_feature(hierarchy: list[ProposedEpic], op: dict[str, Any]) -> bool:
    epic_idx = _find_epic_index(hierarchy, op.get('epic_title'))
    if epic_idx is None:
        return False
    feature_raw = op.get('feature')
    if not isinstance(feature_raw, dict):
        return False
    try:
        new_feature = ProposedFeature.model_validate(feature_raw)
    except Exception:
        return False
    epic = hierarchy[epic_idx]
    anchor = op.get('after_feature_title')
    if isinstance(anchor, str) and anchor.strip():
        anchor_idx = _find_feature_index(epic, anchor)
        if anchor_idx is None:
            epic.features.append(new_feature)
            return True
        epic.features.insert(anchor_idx + 1, new_feature)
        return True
    epic.features.append(new_feature)
    return True


def _op_add_task(hierarchy: list[ProposedEpic], op: dict[str, Any]) -> bool:
    epic_idx = _find_epic_index(hierarchy, op.get('epic_title'))
    if epic_idx is None:
        return False
    feature_idx = _find_feature_index(hierarchy[epic_idx], op.get('feature_title'))
    if feature_idx is None:
        return False
    task_raw = op.get('task')
    if not isinstance(task_raw, dict):
        return False
    try:
        new_task = ProposedTask.model_validate(task_raw)
    except Exception:
        return False
    feature = hierarchy[epic_idx].features[feature_idx]
    anchor = op.get('after_task_title')
    if isinstance(anchor, str) and anchor.strip():
        anchor_idx = _find_task_index(feature, anchor)
        if anchor_idx is None:
            feature.tasks.append(new_task)
            return True
        feature.tasks.insert(anchor_idx + 1, new_task)
        return True
    feature.tasks.append(new_task)
    return True


def _op_reorder_epics(hierarchy: list[ProposedEpic], op: dict[str, Any]) -> bool:
    ordered_raw = op.get('ordered_epic_titles')
    if not isinstance(ordered_raw, list) or not ordered_raw:
        return False
    ordered_titles = [
        t.strip() for t in ordered_raw
        if isinstance(t, str) and t.strip()
    ]
    if not ordered_titles:
        return False

    # Reorder by title, silently tolerating partial lists: epics the LLM
    # didn't mention get appended in their original relative order. This
    # keeps the op useful when the user says "put Onboarding first" without
    # forcing the LLM to enumerate every other epic.
    by_title: dict[str, ProposedEpic] = {epic.title: epic for epic in hierarchy}
    new_order: list[ProposedEpic] = []
    seen: set[str] = set()
    for title in ordered_titles:
        epic = by_title.get(title)
        if epic is None:
            continue
        new_order.append(epic)
        seen.add(title)
    for epic in hierarchy:
        if epic.title not in seen:
            new_order.append(epic)
    if not new_order:
        return False
    hierarchy[:] = new_order
    return True


def _op_update_metadata(
    hierarchy: list[ProposedEpic],
    op: dict[str, Any],
) -> bool:
    # Metadata ops target plan-level fields, not the hierarchy. The applier
    # reports them as "resolved" so they don't land in unresolved_ops; the
    # caller reads them via `extract_metadata_updates` and applies them
    # onto the PendingPlan model directly.
    del hierarchy, op  # intentional no-op at the hierarchy layer
    return True


_OP_HANDLERS: dict[str, Any] = {
    'rename_epic': _op_rename_epic,
    'rename_feature': _op_rename_feature,
    'rename_task': _op_rename_task,
    'remove_epic': _op_remove_epic,
    'remove_feature': _op_remove_feature,
    'remove_task': _op_remove_task,
    'add_epic': _op_add_epic,
    'add_feature': _op_add_feature,
    'add_task': _op_add_task,
    'reorder_epics': _op_reorder_epics,
    'update_metadata': _op_update_metadata,
}

"""Stage loop-produced operations onto the run, one batch per roadmap.

Append-with-dedup semantics per roadmap: an operation whose signature is
already staged for that roadmap is skipped so a retry (or a second
``stage_edits`` call for the same roadmap in one response) cannot double-apply
the same edit; the session's staged version bumps once per batch that
actually added something. Batches live on ``run.batches`` — there is no
session-level staged list.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.runs import RunBatch
from app.core.runtime.operation_contracts import operation_signature


@dataclass
class StageBatchResult:
    batch: RunBatch | None
    added: list[RoadmapOperation] = field(default_factory=list)
    created: bool = False

    @property
    def staged_changed(self) -> bool:
        return bool(self.added)


def _committed_batch_ids(run: Any) -> set[str]:
    return {
        commit.batch_id
        for commit in (getattr(run, 'commits', None) or [])
        if getattr(commit, 'batch_id', None)
    }


def _open_batch(run: Any, roadmap_id: str, source: str) -> RunBatch | None:
    """The batch for ``roadmap_id`` that has not entered execute yet (no
    commit record) and shares the source — the one new ops merge into."""
    committed = _committed_batch_ids(run)
    for batch in getattr(run, 'batches', None) or []:
        if (
            batch.roadmap_id == roadmap_id
            and batch.source == source
            and batch.batch_id not in committed
        ):
            return batch
    return None


def stage_batch(
    session: Any,
    run: Any,
    *,
    roadmap_id: str,
    operations: list[RoadmapOperation],
    assistant_message: str = '',
    source: str = 'stage_edits',
    roadmap_title: str | None = None,
) -> StageBatchResult:
    """Stage ``operations`` for one roadmap on the run.

    Same-roadmap calls merge in order into the open batch (dedup by
    signature across every batch already staged for that roadmap); otherwise
    a new ``RunBatch`` is appended. Returns the batch (``None`` only when
    there was nothing to stage and no batch existed) and the operations that
    were actually added.
    """
    roadmap_id = str(roadmap_id or '').strip()
    existing_signatures = {
        operation_signature(operation)
        for batch in (getattr(run, 'batches', None) or [])
        if batch.roadmap_id == roadmap_id
        for operation in batch.operations
    }
    added: list[RoadmapOperation] = []
    for operation in operations or []:
        signature = operation_signature(operation)
        if signature in existing_signatures:
            continue
        added.append(operation)
        existing_signatures.add(signature)

    batch = _open_batch(run, roadmap_id, source)
    created = False
    if batch is None:
        if not added:
            return StageBatchResult(batch=None)
        batch = RunBatch(
            roadmap_id=roadmap_id,
            roadmap_title=roadmap_title,
            operations=[],
            assistant_message=assistant_message or '',
            source=source,  # type: ignore[arg-type]
        )
        run.batches.append(batch)
        created = True
    if added:
        batch.operations.extend(added)
        batch.refresh_operations_hash()
        if roadmap_title and not batch.roadmap_title:
            batch.roadmap_title = roadmap_title
        if assistant_message:
            batch.assistant_message = (
                assistant_message
                if not batch.assistant_message or created
                else f'{batch.assistant_message} {assistant_message}'.strip()
            )
        session.staged_operations_version = int(session.staged_operations_version or 0) + 1
    return StageBatchResult(batch=batch, added=added, created=created)


def staged_operation_count(run: Any) -> int:
    return sum(len(batch.operations) for batch in (getattr(run, 'batches', None) or []))

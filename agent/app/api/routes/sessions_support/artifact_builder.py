from __future__ import annotations

from typing import Any

from app.core.contracts.sessions import AgentSession, RoadmapCommitArtifact


def build_commit_artifact(
    session: AgentSession,
    commit_result: dict[str, Any],
    *,
    change_id: str | None = None,
    status: str = 'applied',
) -> RoadmapCommitArtifact:
    effective_change_id = change_id
    if effective_change_id is None:
        change_id_raw = commit_result.get('change_id')
        if isinstance(change_id_raw, str) and change_id_raw.strip():
            effective_change_id = change_id_raw.strip()

    semantic_diff = commit_result.get('semantic_diff')
    summary_payload = semantic_diff.get('summary') if isinstance(semantic_diff, dict) else {}
    semantic_diff_summary = summary_payload if isinstance(summary_payload, dict) else {}
    total_changes = sum(
        value for value in semantic_diff_summary.values() if isinstance(value, int)
    )
    validation_issues = commit_result.get('validation_issues')
    validation_issue_count = (
        len(validation_issues) if isinstance(validation_issues, list) else 0
    )

    return RoadmapCommitArtifact(
        roadmap_id=session.roadmap_id,
        base_revision=session.base_revision,
        revision_token=session.revision_token,
        change_id=effective_change_id,
        title='Roadmap Commit Artifact',
        summary=f'Applied {total_changes} semantic change(s).',
        semantic_diff_summary=semantic_diff_summary,
        validation_issue_count=validation_issue_count,
        validation_issues=[],
        has_validation_errors=False,
        status=status if status in {'draft', 'applied', 'discarded'} else 'applied',
    )

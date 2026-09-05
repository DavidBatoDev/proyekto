"""Verify phase: deterministic checks over the run's commits, then at most
one model call that writes the user-facing report (tools = ``propose`` only,
so the model can attach a follow-up proposal but never edits anything). A
provider failure degrades to a deterministic summary.
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.contracts.runs import RunCommit, VerifyCheck, VerifyReport
from app.core.contracts.sessions import AgentSession
from app.core.engine.llm_client import LLMClient
from app.core.engine.loop import run_loop
from app.core.logging_utils import log_event
from app.core.runtime import runs, terminal
from app.core.runtime.handles import merged_handle_map
from app.core.runtime.phases import propose as propose_phase
from app.core.runtime.prompt import build_messages
from app.core.runtime.results import PhaseOutcome
from app.core.runtime.tools import verify_tools
from app.core.tools.dispatch import ToolDispatcher

logger = logging.getLogger(__name__)

_CREATE_OPS = {'add_epic', 'add_feature', 'add_task', 'add_milestone'}
_MODIFY_OPS = {'update_node', 'move_node', 'mark_status', 'shift_dates'}
NOTHING_TO_VERIFY_MESSAGE = 'Nothing was changed.'


def _op_name(operation: Any) -> str:
    return str(getattr(operation.op, 'value', operation.op))


def _expected_counts(operations: list[Any]) -> dict[str, int]:
    created = deleted = modified = 0
    for operation in operations:
        name = _op_name(operation)
        if name in _CREATE_OPS:
            created += 1
        elif name == 'delete_node':
            targets = getattr(operation, 'targets', None)
            deleted += 1 + (len(targets) if isinstance(targets, list) else 0)
        elif name in _MODIFY_OPS:
            modified += 1
    return {'created': created, 'deleted': deleted, 'modified': modified}


def _label(session: AgentSession, commit: RunCommit, batch: Any) -> str:
    title = batch.roadmap_title if batch is not None and batch.roadmap_title else None
    if not title:
        context = session.metadata.roadmaps.get(commit.roadmap_id)
        title = context.title if context is not None else None
    return f'"{title}"' if title else f'roadmap {commit.roadmap_id}'


def deterministic_report(session: AgentSession, run_state: Any) -> VerifyReport:
    if not run_state.batches:
        return VerifyReport(status='nothing_to_verify', checks=[], summary=NOTHING_TO_VERIFY_MESSAGE)
    checks: list[VerifyCheck] = []
    committed = [c for c in run_state.commits if c.status == 'committed']
    not_committed = [c for c in run_state.commits if c.status in {'failed', 'skipped', 'pending'}]

    if not_committed:
        detail = '; '.join(
            f'{_label(session, c, runs.batch_by_id(run_state, c.batch_id))} {c.status}'
            + (f' ({c.error_code})' if c.error_code else '')
            for c in not_committed
        )
        checks.append(VerifyCheck(name='all_batches_committed', status='fail', detail=detail))
    else:
        checks.append(VerifyCheck(name='all_batches_committed', status='pass', detail=f'{len(committed)} committed'))

    revision_before = getattr(run_state, 'revision_before', None) or {}
    repairs = getattr(run_state, 'repairs', None) or {}
    for commit in committed:
        batch = runs.batch_by_id(run_state, commit.batch_id)
        label = _label(session, commit, batch)
        expected = _expected_counts(batch.operations if batch is not None else [])
        actual = commit.impacted_summary or {}
        if actual:
            lower = [
                key
                for key in ('created', 'deleted')
                if expected[key] > int(actual.get(key, 0) or 0)
            ]
            if lower:
                checks.append(
                    VerifyCheck(
                        name='diff_matches_plan',
                        status='warn',
                        detail=f'{label}: fewer {", ".join(lower)} than staged (expected {expected}, got {actual})',
                    )
                )
            else:
                checks.append(VerifyCheck(name='diff_matches_plan', status='pass', detail=f'{label}: {actual}'))
        else:
            checks.append(VerifyCheck(name='diff_matches_plan', status='pass', detail=f'{label}: no diff summary'))
        before = revision_before.get(commit.batch_id) if isinstance(revision_before, dict) else None
        if commit.revision_token_after and commit.revision_token_after != before:
            checks.append(VerifyCheck(name='revision_advanced', status='pass', detail=label))
        else:
            checks.append(VerifyCheck(name='revision_advanced', status='warn', detail=f'{label}: revision token did not change'))
        if commit.history_recorded is False:
            checks.append(VerifyCheck(name='history_recorded', status='warn', detail=f'{label}: change history was not recorded'))
        else:
            checks.append(VerifyCheck(name='history_recorded', status='pass', detail=label))

    repaired = [
        c for c in run_state.commits
        if c.attempts > 1 or (isinstance(repairs, dict) and repairs.get(c.batch_id))
    ]
    if repaired:
        checks.append(
            VerifyCheck(
                name='no_repairs_needed',
                status='warn',
                detail=', '.join(_label(session, c, runs.batch_by_id(run_state, c.batch_id)) for c in repaired),
            )
        )
    else:
        checks.append(VerifyCheck(name='no_repairs_needed', status='pass'))

    if not committed:
        status = 'failed'
    elif not_committed:
        status = 'partial'
    else:
        status = 'verified'
    return VerifyReport(status=status, checks=checks, summary=deterministic_summary(session, run_state))


def deterministic_summary(session: AgentSession, run_state: Any) -> str:
    if not run_state.batches:
        return NOTHING_TO_VERIFY_MESSAGE
    parts: list[str] = []
    for commit in run_state.commits:
        batch = runs.batch_by_id(run_state, commit.batch_id)
        label = _label(session, commit, batch)
        count = len(batch.operations) if batch is not None else 0
        if commit.status == 'committed':
            parts.append(f'Committed {count} change{"s" if count != 1 else ""} to {label}')
        elif commit.status == 'failed':
            parts.append(f'{label} failed: {commit.error_message or commit.error_code or "unknown error"}')
        elif commit.status == 'skipped':
            parts.append(f'{label} was skipped')
        else:
            parts.append(f'{label} is still pending')
    return '; '.join(parts) + '.'


def _outcome_block(session: AgentSession, run_state: Any, report: VerifyReport) -> str:
    lines = [
        '# Outcome',
        'Every commit listed as committed below HAS been applied to the live roadmap. '
        'Report it as done; never say the change could not be made.',
    ]
    for commit in run_state.commits:
        batch = runs.batch_by_id(run_state, commit.batch_id)
        label = _label(session, commit, batch)
        source = str(getattr(batch, 'source', '') or '') if batch is not None else ''
        if commit.status == 'committed':
            summary = ', '.join(f'{k} {v}' for k, v in sorted(commit.impacted_summary.items()) if v)
            if source == 'revert':
                # An undo: the model must say what was restored, not re-describe
                # the user's request as something it could not do.
                lines.append(
                    f'- {label}: UNDO applied — the previous change on this roadmap was '
                    f'reverted and its prior state restored (committed; {summary or "no summary"})'
                )
            else:
                lines.append(f'- {label}: committed ({summary or "no summary"})')
            diff = ', '.join(
                f'{k} {v}' for k, v in sorted((commit.semantic_diff_summary or {}).items()) if v
            )
            if diff:
                lines.append(f'  changes: {diff}')
            for item in commit.impacted_items[:25]:
                lines.append(f'  - {item.impact} {item.node_type} "{item.title or item.node_id}"')
        else:
            lines.append(f'- {label}: {commit.status}' + (f' — {commit.error_message}' if commit.error_message else ''))
    lines.append('# Checks')
    for check in report.checks:
        lines.append(f'- {check.name}: {check.status}' + (f' — {check.detail}' if check.detail else ''))
    return '\n'.join(lines)


_IMPACT_VERB = {'created': 'removed', 'deleted': 'brought back', 'modified': 'restored'}


def is_undo_run(run_state: Any) -> bool:
    """True when every batch of the run came from ``revert_changes``."""
    batches = list(getattr(run_state, 'batches', None) or [])
    return bool(batches) and all(str(getattr(b, 'source', '') or '') == 'revert' for b in batches)


def undo_summary(session: AgentSession, run_state: Any) -> str:
    """The report for an undo run, written deterministically: an undo
    confirmation must state exactly what was restored, and a paraphrasing
    model has answered "I can't undo that" right after a verified revert
    commit. Falls back to ``deterministic_summary`` when a commit failed."""
    if any(c.status != 'committed' for c in run_state.commits) or not run_state.commits:
        return deterministic_summary(session, run_state)
    parts: list[str] = []
    for commit in run_state.commits:
        batch = runs.batch_by_id(run_state, commit.batch_id)
        label = _label(session, commit, batch)
        items = [
            f'{_IMPACT_VERB.get(str(item.impact or ""), "restored")} {item.node_type} "{item.title or item.node_id}"'
            for item in commit.impacted_items[:5]
        ]
        extra = len(commit.impacted_items) - len(items)
        if extra > 0:
            items.append(f'and {extra} more')
        detail = f' — {"; ".join(items)}' if items else ''
        parts.append(f'Undid the last change on {label}{detail}')
    return '. '.join(parts) + '.'


def run(ctx: Any, session: AgentSession, run_state: Any) -> PhaseOutcome:
    settings = ctx.settings
    report = deterministic_report(session, run_state)
    outcome = PhaseOutcome(kind='verified', assistant_message=report.summary)
    if report.status != 'nothing_to_verify' and is_undo_run(run_state):
        # Undo runs get the deterministic confirmation; no model paraphrase.
        report.summary = undo_summary(session, run_state)
        outcome = PhaseOutcome(kind='verified', assistant_message=report.summary)
        logger.info(
            'verify model report skipped for an undo run trace_id=%s run_id=%s',
            ctx.trace_id,
            run_state.run_id,
        )
    elif report.status != 'nothing_to_verify':
        past_budget = getattr(ctx, 'past_soft_budget', None)
        if callable(past_budget) and past_budget():
            # The step already spent its soft budget (a long investigate or
            # several commits): the deterministic summary is the report, so
            # the request does not grow by another model call.
            logger.info(
                'verify model report skipped past the soft budget trace_id=%s run_id=%s',
                ctx.trace_id,
                run_state.run_id,
            )
        else:
            outcome = _model_report(ctx, session, run_state, report) or outcome
    run_state.verify = report
    committed = sum(1 for c in run_state.commits if c.status == 'committed')
    log_event(
        logger,
        'verify_completed',
        settings=settings,
        trace_id=ctx.trace_id,
        session_id=session.session_id,
        run_id=run_state.run_id,
        phase='verify',
        status=report.status,
        summary_text=report.summary,
        checks=[check.model_dump(mode='json') for check in report.checks],
        follow_up_plan_id=report.follow_up_plan_id,
        commits_total=len(run_state.commits),
        commits_committed=committed,
    )
    return outcome


def _model_report(ctx: Any, session: AgentSession, run_state: Any, report: VerifyReport) -> PhaseOutcome | None:
    settings = ctx.settings
    turn_context = ctx.service.build_turn_context(session, ctx.auth_header, ctx.trace_id, run=run_state)
    messages = build_messages(
        session,
        run_state,
        turn_context,
        'verify',
        extra_tail=_outcome_block(session, run_state, report),
    )
    loop_settings = settings.model_copy(update={'agent_v2_max_turns': 2, 'agent_v2_max_tool_calls': 2})
    client = LLMClient(settings, prompt_cache_key=session.scope.key)
    dispatcher = ToolDispatcher(settings=settings, logger=ctx.logger, nest_client=ctx.nest_client)
    handler = terminal.for_verify(session, run_state, settings=settings, trace_id=ctx.trace_id, session_context=turn_context)
    try:
        result = run_loop(
            client=client,
            messages=messages,
            tools=verify_tools(session.scope),
            dispatcher=dispatcher,
            session_context=turn_context,
            handle_map=merged_handle_map(session, run_state),
            settings=loop_settings,
            trace_id=ctx.trace_id,
            terminal_handler=handler,
        )
    except Exception as exc:  # noqa: BLE001 — the deterministic summary stands in
        log_event(
            logger,
            'provider_failure',
            settings=settings,
            level=logging.WARNING,
            trace_id=ctx.trace_id,
            session_id=session.session_id,
            run_id=run_state.run_id,
            phase='verify',
            error=str(exc)[:300],
            error_type=exc.__class__.__name__,
        )
        return None
    ctx.add_loop_usage(result)
    usage = run_state.phase_usage.setdefault('verify', {'turns': 0, 'tool_calls': 0})
    usage['turns'] = int(usage.get('turns', 0) or 0) + int(result.turns or 0)
    usage['tool_calls'] = int(usage.get('tool_calls', 0) or 0) + int(result.tool_calls_used or 0)
    if result.kind == 'chat' and (result.assistant_message or '').strip():
        report.summary = result.assistant_message.strip()
        return PhaseOutcome(kind='verified', assistant_message=report.summary, loop=result)
    if result.kind == 'plan_proposal':
        recorded = propose_phase.record_plan_proposal(
            ctx, session, run_state, dict(result.plan_payload or {}), result.assistant_message
        )
        if recorded.kind == 'proposal' and session.metadata.pending_plan is not None:
            report.follow_up_plan_id = session.metadata.pending_plan.plan_id
            summary = (result.assistant_message or '').strip() or report.summary
            report.summary = summary
            return PhaseOutcome(
                kind='verified',
                assistant_message=summary,
                proposal_payload=recorded.proposal_payload,
                intent_type='roadmap_plan',
                loop=result,
            )
    return None

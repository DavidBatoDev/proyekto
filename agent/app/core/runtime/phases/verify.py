"""Verify phase: deterministic checks over the run's commits, then the reply.

The reply is written by the model that staged the edit, inside its own loop:
the commit outcome is fed back as the ``stage_edits`` / ``revert_changes``
tool output (the ordinary tool-result turn of an agent loop) and the model's
next text is the report. There is no separate report model and no fresh
prompt, so the model that just acted answers with the real outcome in front
of it and never "refuses" work that is already done.

When that continuation is unavailable (the staging transcript is gone, the
step is past its soft budget, the provider fails, or the text contradicts the
outcome) the batch's own model-written ``assistant_message`` stands. A
templated sentence is used only for failures and for batches that carry no
message at all.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.core.contracts.runs import RunBatch, RunCommit, VerifyCheck, VerifyReport
from app.core.contracts.sessions import AgentSession
from app.core.engine.llm_client import LLMClient
from app.core.engine.loop import run_loop
from app.core.engine.progress import AssistantDeltaEmitter
from app.core.logging_utils import log_event
from app.core.runtime import runs
from app.core.runtime.entity_links import entity_link
from app.core.runtime.handles import merged_handle_map
from app.core.runtime.prompt import build_messages
from app.core.runtime.results import PhaseOutcome
from app.core.tools.dispatch import ToolDispatcher

logger = logging.getLogger(__name__)

_CREATE_OPS = {'add_epic', 'add_feature', 'add_task', 'add_milestone'}
_MODIFY_OPS = {'update_node', 'move_node', 'mark_status', 'shift_dates'}
NOTHING_TO_VERIFY_MESSAGE = 'Nothing was changed.'
MAX_OUTCOME_ITEMS = 25

# Appended after the tool outputs of the continuation turn. The system prompt
# itself is byte-identical to the staging turn (prompt cache hit); only this
# transcript-level instruction changes what the model does next.
REPORT_INSTRUCTION = (
    'The tool results above are final: every batch marked committed is applied to '
    'the live roadmap and every failed batch was not. Reply to the user now, in '
    '1-3 sentences: what changed (copy the entity links from the results), anything '
    'else you did this turn (comments, memories, projects), and what failed and why. '
    'Do not restate the request, do not offer to do what is already done, and do not '
    'present an operation that produced no change as a change.'
)


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


def _label(session: AgentSession, commit: RunCommit | None, batch: Any) -> str:
    title = batch.roadmap_title if batch is not None and batch.roadmap_title else None
    if not title:
        roadmap_id = commit.roadmap_id if commit is not None else getattr(batch, 'roadmap_id', None)
        context = session.metadata.roadmaps.get(roadmap_id) if roadmap_id else None
        title = context.title if context is not None else None
    return title or 'Untitled roadmap'


def _link(label: str, roadmap_id: str) -> str:
    return entity_link(label, 'roadmap', roadmap_id)


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


def _failure_sentence(session: AgentSession, commit: RunCommit, batch: Any) -> str:
    label = _link(_label(session, commit, batch), commit.roadmap_id)
    if commit.status == 'failed':
        return f'{label} failed: {commit.error_message or commit.error_code or "unknown error"}'
    if commit.status == 'skipped':
        return f'{label} was skipped'
    return f'{label} is still pending'


def deterministic_summary(session: AgentSession, run_state: Any) -> str:
    """Status sentences only; the last resort when no model text exists."""
    if not run_state.batches:
        return NOTHING_TO_VERIFY_MESSAGE
    parts: list[str] = []
    for commit in run_state.commits:
        batch = runs.batch_by_id(run_state, commit.batch_id)
        if commit.status == 'committed':
            label = _link(_label(session, commit, batch), commit.roadmap_id)
            count = len(batch.operations) if batch is not None else 0
            parts.append(f'Committed {count} change{"s" if count != 1 else ""} to {label}')
        else:
            parts.append(_failure_sentence(session, commit, batch))
    return '; '.join(parts) + '.'


def staged_summary(session: AgentSession, run_state: Any) -> tuple[str, bool]:
    """The batches' own model-written messages as the reply.

    Returns the text and whether any of it came from the model; failures and
    message-less batches get a status sentence.
    """
    if not run_state.batches:
        return NOTHING_TO_VERIFY_MESSAGE, False
    parts: list[str] = []
    model_text = False
    for commit in run_state.commits:
        batch = runs.batch_by_id(run_state, commit.batch_id)
        message = (batch.assistant_message or '').strip() if batch is not None else ''
        if commit.status == 'committed' and message:
            model_text = True
            parts.append(message if message[-1] in '.!?' else f'{message}.')
        elif commit.status == 'committed':
            label = _link(_label(session, commit, batch), commit.roadmap_id)
            count = len(batch.operations) if batch is not None else 0
            parts.append(f'Committed {count} change{"s" if count != 1 else ""} to {label}.')
        else:
            parts.append(_failure_sentence(session, commit, batch) + '.')
    return ' '.join(parts), model_text


_IMPACT_VERB = {'created': 'removed', 'deleted': 'brought back', 'modified': 'restored'}


def is_undo_run(run_state: Any) -> bool:
    """True when every batch of the run came from ``revert_changes``."""
    batches = list(getattr(run_state, 'batches', None) or [])
    return bool(batches) and all(str(getattr(b, 'source', '') or '') == 'revert' for b in batches)


def undo_summary(session: AgentSession, run_state: Any) -> str:
    """Fallback confirmation for an undo run without a staging transcript: it
    states exactly what was restored. Falls back to ``deterministic_summary``
    when a commit failed."""
    if any(c.status != 'committed' for c in run_state.commits) or not run_state.commits:
        return deterministic_summary(session, run_state)
    parts: list[str] = []
    for commit in run_state.commits:
        batch = runs.batch_by_id(run_state, commit.batch_id)
        label = _link(_label(session, commit, batch), commit.roadmap_id)
        items = [
            f'{_IMPACT_VERB.get(str(item.impact or ""), "restored")} {item.node_type} '
            + entity_link(item.title or f'Untitled {item.node_type}', item.node_type, item.node_id)
            for item in commit.impacted_items[:5]
        ]
        extra = len(commit.impacted_items) - len(items)
        if extra > 0:
            items.append(f'and {extra} more')
        detail = f' — {"; ".join(items)}' if items else ''
        parts.append(f'Undid the last change on {label}{detail}')
    return '. '.join(parts) + '.'


_REFUSAL = r"(?:can(?:'|’)?t|cannot|can not|couldn(?:'|’)?t|could not|unable to|not able to|won(?:'|’)?t be able to|not (?:possible|allowed|permitted) to)"
_EDIT_VERB = r"(?:apply|make|edit|update|change|commit|save|move|do|perform|carry out)"
_REFUSAL_NEAR_VERB = re.compile(_REFUSAL + r"(?:\W+\w+){0,8}?\W+" + _EDIT_VERB, re.IGNORECASE)
_SESSION_EXCUSE = re.compile(r"from this session", re.IGNORECASE)
_NOTHING_CHANGED = re.compile(
    r"(?:no changes? (?:were|was|has been|have been) (?:made|applied)|nothing (?:was|has been) (?:changed|applied|updated))",
    re.IGNORECASE,
)


def report_contradicts_outcome(text: str, run_state: Any) -> str | None:
    """Why the model's reply must not stand, or ``None``.

    Pure. Applies only when at least one commit is ``committed``: a reply that
    refuses to apply/edit/change, blames "this session", or claims nothing
    changed contradicts an outcome the user can already see in the commit
    card. Failed-only runs may say all of that truthfully."""
    committed = any(getattr(c, 'status', None) == 'committed' for c in getattr(run_state, 'commits', []) or [])
    if not committed or not text:
        return None
    if _SESSION_EXCUSE.search(text):
        return 'SESSION_EXCUSE'
    if _REFUSAL_NEAR_VERB.search(text):
        return 'REFUSAL_AFTER_COMMIT'
    if _NOTHING_CHANGED.search(text):
        return 'DENIES_CHANGES'
    return None


# -- the commit outcome as the staging tool's output ---------------------------


def commit_outcome_payload(session: AgentSession, commit: RunCommit | None, batch: RunBatch) -> dict[str, Any]:
    """What the model that staged this batch reads back as its tool result.

    Carries ready-made entity links so the reply copies them, names undo
    batches as undos, and flags operations that produced no change so a
    "mark as done" on an already-done task is not reported as a change.
    """
    label = _label(session, commit, batch)
    roadmap = {'id': batch.roadmap_id, 'title': label, 'link': _link(label, batch.roadmap_id)}
    if commit is None or commit.status == 'pending':
        return {'status': 'pending', 'roadmap': roadmap, 'note': 'Not applied yet.'}
    if commit.status != 'committed':
        return {
            'status': commit.status,
            'roadmap': roadmap,
            'error_code': commit.error_code,
            'error_message': commit.error_message,
            'note': 'Nothing from this batch was applied. Tell the user what failed; do not retry now.',
        }
    items = [
        {
            'impact': item.impact,
            'node_type': item.node_type,
            'node_id': item.node_id,
            'title': item.title,
            'change_type': getattr(item, 'change_type', None),
            'link': entity_link(item.title or f'Untitled {item.node_type}', item.node_type, item.node_id),
        }
        for item in commit.impacted_items[:MAX_OUTCOME_ITEMS]
    ]
    undo = str(getattr(batch, 'source', '') or '') == 'revert'
    operations_count = len(batch.operations)
    changed = sum(int(v or 0) for v in (commit.impacted_summary or {}).values())
    note = (
        'Undo applied: the listed items were restored to their previous state.'
        if undo
        else 'Applied to the live roadmap.'
    )
    if commit.impacted_summary and changed < operations_count:
        note += (
            f' {operations_count - changed} of the {operations_count} operations produced no '
            'change (the item was already in the requested state).'
        )
    payload: dict[str, Any] = {
        'status': 'committed',
        'undo': undo,
        'roadmap': roadmap,
        'change_id': commit.change_id,
        'operations_count': operations_count,
        'impacted_summary': dict(commit.impacted_summary or {}),
        'semantic_diff_summary': dict(commit.semantic_diff_summary or {}),
        'impacted_items': items,
        'note': note,
    }
    if len(commit.impacted_items) > MAX_OUTCOME_ITEMS:
        payload['impacted_items_truncated'] = len(commit.impacted_items) - MAX_OUTCOME_ITEMS
    return payload


def _pending_call_ids(transcript: list[dict[str, Any]]) -> list[str]:
    """function_call ids in the transcript that never received an output."""
    answered = {
        str(item.get('call_id'))
        for item in transcript
        if isinstance(item, dict) and item.get('type') == 'function_call_output'
    }
    return [
        str(item.get('call_id'))
        for item in transcript
        if isinstance(item, dict) and item.get('type') == 'function_call' and str(item.get('call_id')) not in answered
    ]


def outcome_outputs(session: AgentSession, run_state: Any, transcript: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    """One ``function_call_output`` per unanswered call of the staging turn.

    Returns None when no pending call belongs to a batch of this run (a stale
    or foreign transcript). Calls that were neither staged nor run (a read
    issued beside the terminal) get an explicit not-run output, because the
    Responses API rejects an input whose function_call has no output.
    """
    pending = _pending_call_ids(transcript)
    if not pending:
        return None
    by_call: dict[str, dict[str, Any]] = {}
    for batch in run_state.batches:
        commit = next((c for c in run_state.commits if c.batch_id == batch.batch_id), None)
        for call_id in getattr(batch, 'call_ids', None) or []:
            by_call[str(call_id)] = commit_outcome_payload(session, commit, batch)
    if not any(call_id in by_call for call_id in pending):
        return None
    outputs: list[dict[str, Any]] = []
    for call_id in pending:
        payload = by_call.get(call_id) or {
            'status': 'not_run',
            'note': 'This call did not run: the turn ended when the edits were staged.',
        }
        outputs.append(
            {
                'type': 'function_call_output',
                'call_id': call_id,
                'output': json.dumps(payload, ensure_ascii=False, default=str),
            }
        )
    return outputs


def _discard_transcript(ctx: Any, run_state: Any) -> list[dict[str, Any]] | None:
    key = getattr(run_state, 'staged_transcript_key', None)
    if not key:
        return None
    transcript = ctx.get_transcript(key)
    ctx.delete_transcript(key)
    run_state.staged_transcript_key = None
    return transcript if transcript else None


def _loop_reply(ctx: Any, session: AgentSession, run_state: Any, report: VerifyReport) -> PhaseOutcome | None:
    settings = ctx.settings
    transcript = _discard_transcript(ctx, run_state)
    if transcript is None:
        return None
    outputs = outcome_outputs(session, run_state, transcript)
    if outputs is None:
        log_event(
            logger,
            'verify_transcript_unusable',
            settings=settings,
            trace_id=ctx.trace_id,
            session_id=session.session_id,
            run_id=run_state.run_id,
            phase='verify',
        )
        return None
    turn_context = ctx.service.build_turn_context(session, ctx.auth_header, ctx.trace_id, run=run_state)
    messages = build_messages(
        session,
        run_state,
        turn_context,
        'investigate',
        transcript=[*transcript, *outputs, {'role': 'system', 'content': REPORT_INSTRUCTION}],
    )
    loop_settings = settings.model_copy(update={'agent_v2_max_turns': 1, 'agent_v2_max_tool_calls': 1})
    client = LLMClient(settings, prompt_cache_key=session.scope.key)
    dispatcher = ToolDispatcher(settings=settings, logger=ctx.logger, nest_client=ctx.nest_client)
    delta_emitter = (
        AssistantDeltaEmitter(settings, ctx.trace_id)
        if ctx.trace_id and getattr(settings, 'openai_v2_streaming_enabled', False)
        else None
    )

    def refuse_tools(calls: list[Any]) -> dict[str, dict[str, Any]]:
        # No tools are offered on this turn; a hallucinated call is refused
        # and the loop ends on its one-turn budget (the staged text stands).
        return {
            tc.id: {'error': {'code': 'NOT_AVAILABLE', 'message': 'The edits are applied; reply in text.'}}
            for tc in calls
        }

    try:
        result = run_loop(
            client=client,
            messages=messages,
            tools=[],
            dispatcher=dispatcher,
            session_context=turn_context,
            handle_map=merged_handle_map(session, run_state),
            settings=loop_settings,
            trace_id=ctx.trace_id,
            delta_emitter=delta_emitter,
            terminal_handler=refuse_tools,
        )
    except Exception as exc:  # noqa: BLE001 — the staged message stands in
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
    for key, attr in (('input', 'tokens_input'), ('output', 'tokens_output'), ('total', 'tokens_total'), ('cached', 'tokens_cached')):
        run_state.tokens[key] = int(run_state.tokens.get(key, 0) or 0) + int(getattr(result, attr, 0) or 0)
    usage = run_state.phase_usage.setdefault('verify', {'turns': 0, 'tool_calls': 0})
    usage['turns'] = int(usage.get('turns', 0) or 0) + int(result.turns or 0)
    usage['tool_calls'] = int(usage.get('tool_calls', 0) or 0) + int(result.tool_calls_used or 0)
    text = (result.assistant_message or '').strip()
    if result.kind != 'chat' or not text:
        log_event(
            logger,
            'verify_reply_unusable',
            settings=settings,
            trace_id=ctx.trace_id,
            session_id=session.session_id,
            run_id=run_state.run_id,
            phase='verify',
            kind=result.kind,
            termination_reason=result.termination_reason,
        )
        return None
    reason = report_contradicts_outcome(text, run_state)
    if reason:
        report.report_mode = 'rejected'
        log_event(
            logger,
            'verify_report_rejected',
            settings=settings,
            level=logging.WARNING,
            trace_id=ctx.trace_id,
            session_id=session.session_id,
            run_id=run_state.run_id,
            phase='verify',
            reason=reason,
            model_text=text[:300],
        )
        return None
    report.summary = text
    report.report_mode = 'loop'
    return PhaseOutcome(kind='verified', assistant_message=text, loop=result)


def _fallback_reply(session: AgentSession, run_state: Any, report: VerifyReport) -> PhaseOutcome:
    if is_undo_run(run_state):
        report.summary = undo_summary(session, run_state)
        if report.report_mode != 'rejected':
            report.report_mode = 'deterministic'
    else:
        summary, model_text = staged_summary(session, run_state)
        report.summary = summary
        if report.report_mode != 'rejected':
            report.report_mode = 'staged' if model_text else 'deterministic'
    return PhaseOutcome(kind='verified', assistant_message=report.summary)


def run(ctx: Any, session: AgentSession, run_state: Any) -> PhaseOutcome:
    settings = ctx.settings
    report = deterministic_report(session, run_state)
    if report.status == 'nothing_to_verify':
        _discard_transcript(ctx, run_state)
        outcome = PhaseOutcome(kind='verified', assistant_message=report.summary)
    else:
        outcome = None
        past_budget = getattr(ctx, 'past_soft_budget', None)
        if callable(past_budget) and past_budget():
            # The step already spent its soft budget (a long investigate or
            # several commits): the staged message is the reply, so the
            # request does not grow by another model turn.
            _discard_transcript(ctx, run_state)
            logger.info(
                'verify reply continuation skipped past the soft budget trace_id=%s run_id=%s',
                ctx.trace_id,
                run_state.run_id,
            )
        else:
            outcome = _loop_reply(ctx, session, run_state, report)
        if outcome is None:
            outcome = _fallback_reply(session, run_state, report)
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
        report_mode=report.report_mode,
    )
    return outcome

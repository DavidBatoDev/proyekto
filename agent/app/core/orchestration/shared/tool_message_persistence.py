"""Append tool-invocation records to `session.messages` as LangChain-shaped
assistant + tool message pairs so the next LLM turn can see prior tool calls.

Shared between the ReAct planner (ordinary tool observations from the loop)
and the REST route flows (synthetic records for user-initiated actions like
commit discard). The invariant this helper guarantees is: every `role='tool'`
message is preceded by an `assistant` message whose `tool_calls` list
contains an entry with the same `tool_call_id`.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from app.core.contracts.sessions import AgentSession


_TOOL_MESSAGE_CONTENT_MAX_BYTES = 4000


def _truncate_tool_content(content: str) -> str:
    if len(content) <= _TOOL_MESSAGE_CONTENT_MAX_BYTES:
        return content
    overflow = len(content) - _TOOL_MESSAGE_CONTENT_MAX_BYTES
    return f'{content[: _TOOL_MESSAGE_CONTENT_MAX_BYTES]}...(+{overflow} bytes truncated)'


def persist_tool_observations_as_messages(
    *,
    store: Any,
    session: AgentSession,
    observations: list[dict[str, Any]],
) -> None:
    """Append the react-loop's tool calls + results to `session.messages`
    as structured LangChain-shaped pairs: one assistant message carrying
    `tool_calls=[{id, name, args}]` (LangChain's canonical shape, not the
    OpenAI wire shape) followed by one `role='tool'` message with the
    serialized result and matching `tool_call_id`.

    The LangChain `AIMessage.tool_calls` validator expects
    `{name, args, id}` — not `{id, type, function: {...}}`. LangChain
    converts to the OpenAI wire shape internally when the message is
    serialized for the provider. This is what replaces the
    `prior_tool_observations` band-aid — the history builder now
    reconstructs the full prior conversation rather than a user-role
    text hint.

    Synthetic uuid ids are fine: OpenAI's only constraint is that each
    `tool_call_id` in the conversation matches an id in a preceding
    assistant `tool_calls` list. We emit both sides so the invariant holds.
    """

    if not observations:
        return
    for observation in observations:
        if not isinstance(observation, dict):
            continue
        tool_name = observation.get('tool_name')
        if not isinstance(tool_name, str) or not tool_name.strip():
            continue
        raw_args = observation.get('args') or {}
        args = raw_args if isinstance(raw_args, dict) else {}
        result = observation.get('result')
        tool_call_id = f'call_{uuid.uuid4().hex[:12]}'
        store.append_message(
            session,
            'assistant',
            '',
            tool_calls=[
                {
                    'id': tool_call_id,
                    'name': tool_name,
                    'args': args,
                }
            ],
        )
        try:
            result_json = json.dumps(result, default=str)
        except (TypeError, ValueError):
            result_json = '{}'
        store.append_message(
            session,
            'tool',
            _truncate_tool_content(result_json),
            tool_call_id=tool_call_id,
        )

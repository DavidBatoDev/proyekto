import unittest
from datetime import datetime
from types import SimpleNamespace

from app.api.routes.sessions_support.route_flows import discard_session_flow
from app.core.contracts.sessions import (
    AgentSession,
    AppliedChange,
    AppliedDraftCommit,
    DiscardRequest,
)


class _FakeStore:
    """Minimal stand-in for SessionStore. Records every append_message call
    so the test can assert on the synthetic tool-observation pair."""

    def __init__(self) -> None:
        self.appended: list[dict] = []
        self.updates: int = 0

    def append_message(self, session, role, content, **kwargs) -> None:
        entry: dict = {'role': role, 'content': content}
        entry.update(kwargs)
        self.appended.append(entry)
        # Mirror SessionStore semantics so the test assertion on
        # session.messages (for any downstream consumers) stays truthful.
        session.messages.append(
            SimpleNamespace(role=role, content=content, **kwargs)
        )

    def update(self, session) -> None:
        self.updates += 1


class _FakeNestClient:
    def __init__(self, discard_result: dict) -> None:
        self._discard_result = discard_result
        self.discard_calls: list[dict] = []

    async def discard_preview(self, *, roadmap_id, payload, auth_header):
        self.discard_calls.append({
            'roadmap_id': roadmap_id,
            'payload': payload,
            'auth_header': auth_header,
        })
        return self._discard_result


async def _as_awaitable(value):
    return value


async def _run_store_call(func, *args):
    return func(*args)


def _parse_change_timeline(timeline):
    status_map: dict[str, str] = {}
    discarded_at_map: dict[str, datetime | None] = {}
    if not isinstance(timeline, list):
        return status_map, discarded_at_map
    for entry in timeline:
        change_id = entry.get('change_id')
        status = entry.get('status')
        if isinstance(change_id, str) and isinstance(status, str):
            status_map[change_id] = status
            discarded_at_map[change_id] = None
    return status_map, discarded_at_map


class DiscardSessionFlowTests(unittest.IsolatedAsyncioTestCase):
    async def test_appends_synthetic_discard_tool_observation(self) -> None:
        session = AgentSession(roadmap_id='roadmap-discard-1')
        session.metadata.applied_draft_commits.append(
            AppliedDraftCommit(
                change_id='chg-1',
                draft_id='draft-1',
                draft_version=1,
                status='applied',
            )
        )
        session.metadata.recent_applied_changes = [
            AppliedChange(
                node_id='epic-1',
                node_type='epic',
                change_type='NODE_ADDED',
                change_to={'title': 'Temporal Fairy'},
                title='Temporal Fairy',
                change_id='chg-1',
            ),
            AppliedChange(
                node_id='epic-2',
                node_type='epic',
                change_type='NODE_ADDED',
                change_to={'title': 'Older epic'},
                title='Older epic',
                change_id='chg-0',
            ),
        ]
        store = _FakeStore()
        agent_service = SimpleNamespace()
        nest_client = _FakeNestClient({
            'discarded_at': '2026-04-20T10:00:00',
            'revision_token': 'rev-999',
            'timeline': [
                {'change_id': 'chg-1', 'status': 'discarded'},
                {'change_id': 'chg-0', 'status': 'applied'},
            ],
        })
        request = SimpleNamespace(headers={'Authorization': 'Bearer test'})

        response = await discard_session_flow(
            session_id=session.session_id,
            payload=DiscardRequest(),
            request=request,
            get_agent_runtime_async=lambda: _as_awaitable((store, agent_service)),
            get_session_or_404_async=lambda _svc, _sid: _as_awaitable(session),
            resolve_draft_snapshot=lambda _session, _service: ('draft-1', 1, []),
            run_store_call=_run_store_call,
            parse_change_timeline=_parse_change_timeline,
            utcnow=lambda: datetime(2026, 4, 20, 10, 0, 0),
            nest_client=nest_client,
        )

        self.assertEqual(response.discarded_change_id, 'chg-1')

        # Discarded AppliedChange entries are dropped, the older one survives.
        remaining_ids = [
            entry.change_id for entry in session.metadata.recent_applied_changes
        ]
        self.assertEqual(remaining_ids, ['chg-0'])

        # The synthetic pair lives in appended messages: assistant with
        # tool_calls, then a tool message with matching tool_call_id.
        assistant_messages = [
            msg for msg in store.appended
            if msg['role'] == 'assistant' and msg.get('tool_calls')
        ]
        tool_messages = [msg for msg in store.appended if msg['role'] == 'tool']
        self.assertEqual(len(assistant_messages), 1)
        self.assertEqual(len(tool_messages), 1)

        tool_call = assistant_messages[0]['tool_calls'][0]
        self.assertEqual(tool_call['name'], 'discard_commit')
        self.assertEqual(tool_call['args']['change_id'], 'chg-1')
        self.assertEqual(tool_call['args']['source'], 'user_discard')
        self.assertEqual(
            tool_messages[0]['tool_call_id'], tool_call['id'],
        )
        self.assertIn('"discarded_change_id": "chg-1"', tool_messages[0]['content'])
        self.assertIn('"reverted_changes"', tool_messages[0]['content'])
        self.assertIn('Temporal Fairy', tool_messages[0]['content'])

        # One commit transitioned to discarded.
        applied = session.metadata.applied_draft_commits[0]
        self.assertEqual(applied.status, 'discarded')

        # Store.update invoked exactly once, after all mutations.
        self.assertEqual(store.updates, 1)

    async def test_infers_change_id_from_most_recent_applied_commit(self) -> None:
        session = AgentSession(roadmap_id='roadmap-discard-2')
        session.metadata.applied_draft_commits.extend([
            AppliedDraftCommit(
                change_id='chg-old',
                draft_id='draft-0',
                draft_version=0,
                status='discarded',
            ),
            AppliedDraftCommit(
                change_id='chg-newest',
                draft_id='draft-1',
                draft_version=1,
                status='applied',
            ),
        ])
        store = _FakeStore()
        nest_client = _FakeNestClient({
            'discarded_at': '2026-04-20T11:00:00',
            'timeline': [
                {'change_id': 'chg-newest', 'status': 'discarded'},
            ],
        })
        request = SimpleNamespace(headers={})

        response = await discard_session_flow(
            session_id=session.session_id,
            payload=DiscardRequest(),
            request=request,
            get_agent_runtime_async=lambda: _as_awaitable((store, SimpleNamespace())),
            get_session_or_404_async=lambda _svc, _sid: _as_awaitable(session),
            resolve_draft_snapshot=lambda _session, _service: ('draft-1', 1, []),
            run_store_call=_run_store_call,
            parse_change_timeline=_parse_change_timeline,
            utcnow=lambda: datetime(2026, 4, 20, 11, 0, 0),
            nest_client=nest_client,
        )

        self.assertEqual(response.discarded_change_id, 'chg-newest')
        self.assertEqual(
            nest_client.discard_calls[0]['payload'],
            {'change_id': 'chg-newest'},
        )


if __name__ == '__main__':  # pragma: no cover
    unittest.main()

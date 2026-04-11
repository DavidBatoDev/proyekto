import unittest

from fastapi import HTTPException

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, DraftNode, MessageResponse, SessionMetadata
from app.core.orchestration.agent_service import AgentService


class DraftGraphVersioningContractTests(unittest.TestCase):
    def test_session_metadata_defaults_include_draft_graph_fields(self) -> None:
        metadata = SessionMetadata()

        self.assertEqual(metadata.drafts, {})
        self.assertEqual(metadata.draft_head_ids, [])
        self.assertEqual(metadata.applied_draft_commits, [])
        self.assertIsNone(metadata.active_draft_id)

    def test_agent_session_legacy_payload_deserializes_with_draft_defaults(self) -> None:
        payload = {
            'session_id': 'a0d564bb-6d6f-4f38-8d08-8a86ecfd0402',
            'roadmap_id': 'roadmap-1',
            'operations': [
                {
                    'op': 'update_node',
                    'node_id': '11111111-1111-1111-1111-111111111111',
                    'patch': {'title': 'Legacy'},
                }
            ],
            'staged_operations_version': 2,
            'artifacts': [],
            'messages': [],
            'metadata': {},
        }

        session = AgentSession.model_validate(payload)

        self.assertEqual(session.staged_operations_version, 2)
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(session.metadata.drafts, {})
        self.assertIsNone(session.metadata.active_draft_id)

    def test_draft_node_roundtrip_keeps_operations(self) -> None:
        node = DraftNode(
            draft_id='draft-1',
            operations=[
                RoadmapOperation(
                    op='update_node',
                    node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                    patch={'title': 'Platform Foundation'},
                )
            ],
            draft_version=3,
        )

        dumped = node.model_dump(mode='json')
        restored = DraftNode.model_validate(dumped)

        self.assertEqual(restored.draft_id, 'draft-1')
        self.assertEqual(restored.draft_version, 3)
        self.assertEqual(len(restored.operations), 1)
        self.assertEqual(restored.operations[0].op.value, 'update_node')

    def test_message_response_defaults_for_new_draft_fields(self) -> None:
        response = MessageResponse(
            session_id='session-1',
            assistant_message='ok',
            parse_mode='openai_tool_calling',
            intent_type='roadmap_edit',
            response_mode='edit_plan',
            operations=[],
            staged_operations_version=0,
            staged_operations_count=0,
        )

        self.assertIsNone(response.active_draft_id)
        self.assertIsNone(response.active_draft_version)

    def test_pending_edit_context_roundtrip_preserves_staging_validation_fields(self) -> None:
        payload = {
            'session_id': '5f37eaee-4e03-4af0-a3c7-827775f2ba53',
            'roadmap_id': 'roadmap-1',
            'operations': [
                {
                    'op': 'update_node',
                    'node_id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                    'patch': {'title': 'Platform Foundation 1'},
                }
            ],
            'staged_operations_version': 3,
            'artifacts': [],
            'messages': [],
            'metadata': {
                'pending_edit_context': {
                    'intent_family': 'roadmap_edit_clarifier',
                    'draft_operations': [
                        {
                            'op': 'update_node',
                            'node_id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            'patch': {'title': 'Platform Foundation 1'},
                        }
                    ],
                    'required_fields': ['corrected_fields'],
                    'resolved_references': {},
                    'confirmation_mode': 'awaiting_clarification',
                    'source_user_message': 'Rename my App Foundation Platform Foundation',
                    'awaiting_field': 'rename_title',
                    'target_hint': 'App Foundation',
                    'last_clarifier_reason': 'insufficient_context',
                    'last_followup_kind': 'side_query',
                    'preview_validation_errors': [
                        {
                            'code': 'MISSING_REQUIRED_FIELD',
                            'severity': 'error',
                            'path': '/operations/0/data/title',
                            'message': 'title is required for add_epic',
                        }
                    ],
                    'awaiting_preview_fix': True,
                    'last_planner_stop_reason': 'staging_validation_failed',
                    'last_planner_needs_more_info': True,
                    'last_planner_draft_action': 'continue',
                    'last_tool_plan_summary': [
                        {
                            'tool_name': 'resolve_node_reference',
                            'arg_keys': ['label'],
                        }
                    ],
                }
            },
        }

        session = AgentSession.model_validate(payload)
        self.assertIsNotNone(session.metadata.pending_edit_context)
        assert session.metadata.pending_edit_context is not None
        self.assertTrue(session.metadata.pending_edit_context.awaiting_staging_fix)
        self.assertEqual(
            len(session.metadata.pending_edit_context.staging_validation_errors),
            1,
        )

        dumped = session.model_dump(mode='json')
        pending_context_dump = dumped.get('metadata', {}).get('pending_edit_context', {})
        self.assertIn('staging_validation_errors', pending_context_dump)
        self.assertIn('awaiting_staging_fix', pending_context_dump)
        self.assertNotIn('preview_validation_errors', pending_context_dump)
        self.assertNotIn('awaiting_preview_fix', pending_context_dump)

        restored = AgentSession.model_validate(dumped)
        assert restored.metadata.pending_edit_context is not None
        self.assertTrue(restored.metadata.pending_edit_context.awaiting_staging_fix)
        self.assertEqual(
            restored.metadata.pending_edit_context.staging_validation_errors[0].get('code'),
            'MISSING_REQUIRED_FIELD',
        )
        self.assertEqual(
            restored.metadata.pending_edit_context.last_planner_stop_reason,
            'staging_validation_failed',
        )
        self.assertEqual(
            restored.metadata.pending_edit_context.awaiting_field,
            'rename_title',
        )
        self.assertEqual(
            restored.metadata.pending_edit_context.target_hint,
            'App Foundation',
        )

    def test_draft_graph_migration_preserves_legacy_staged_state(self) -> None:
        session = AgentSession(roadmap_id='roadmap-1')
        session.operations = [
            RoadmapOperation(
                op='update_node',
                node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                patch={'title': 'Platform Foundation 1'},
            )
        ]
        session.staged_operations_version = 4

        service = object.__new__(AgentService)

        with self.assertRaises(HTTPException) as raised:
            service.ensure_draft_graph_initialized(session)

        exc = raised.exception
        self.assertEqual(exc.status_code, 409)
        self.assertIsInstance(exc.detail, dict)
        detail = exc.detail
        self.assertEqual(detail.get('code'), 'LEGACY_SESSION_UNSUPPORTED')


if __name__ == '__main__':
    unittest.main()

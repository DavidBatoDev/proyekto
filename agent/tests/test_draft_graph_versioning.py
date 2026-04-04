import unittest

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
            preview_available=False,
            preview_recommended=False,
            staged_operations_version=0,
            staged_operations_count=0,
        )

        self.assertIsNone(response.active_draft_id)
        self.assertIsNone(response.active_draft_version)

    def test_pending_edit_context_roundtrip_preserves_preview_validation_fields(self) -> None:
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
                    'preview_validation_errors': [
                        {
                            'code': 'MISSING_REQUIRED_FIELD',
                            'severity': 'error',
                            'path': '/operations/0/data/title',
                            'message': 'title is required for add_epic',
                        }
                    ],
                    'awaiting_preview_fix': True,
                    'last_planner_stop_reason': 'preview_validation_failed',
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
        self.assertTrue(session.metadata.pending_edit_context.awaiting_preview_fix)
        self.assertEqual(
            len(session.metadata.pending_edit_context.preview_validation_errors),
            1,
        )

        dumped = session.model_dump(mode='json')
        restored = AgentSession.model_validate(dumped)
        assert restored.metadata.pending_edit_context is not None
        self.assertTrue(restored.metadata.pending_edit_context.awaiting_preview_fix)
        self.assertEqual(
            restored.metadata.pending_edit_context.preview_validation_errors[0].get('code'),
            'MISSING_REQUIRED_FIELD',
        )
        self.assertEqual(
            restored.metadata.pending_edit_context.last_planner_stop_reason,
            'preview_validation_failed',
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

        migration_applied = service.ensure_draft_graph_initialized(session)
        self.assertTrue(migration_applied)
        self.assertIsNotNone(session.metadata.active_draft_id)
        self.assertEqual(len(session.metadata.drafts), 1)

        active_draft_id = session.metadata.active_draft_id
        assert active_draft_id is not None
        self.assertEqual(session.metadata.draft_head_ids, [active_draft_id])
        active_draft = session.metadata.drafts[active_draft_id]
        self.assertEqual(active_draft.draft_version, 4)
        self.assertEqual(len(active_draft.operations), 1)
        self.assertEqual(active_draft.operations[0].op.value, 'update_node')

        # Legacy mirror remains parity-compatible during migration window.
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(session.staged_operations_version, active_draft.draft_version)

        migration_applied_second = service.ensure_draft_graph_initialized(session)
        self.assertFalse(migration_applied_second)


if __name__ == '__main__':
    unittest.main()

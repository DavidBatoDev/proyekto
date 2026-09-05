from __future__ import annotations

import unittest
from app.api.routes.sessions_support.errors import (
    extract_upstream_error_code,
    extract_upstream_error_details,
)


class SessionsSupportCommonTests(unittest.TestCase):
    def test_extract_upstream_error_details_from_nested_error_payload(self) -> None:
        detail = {
            'detail': {
                'error': {
                    'code': 'INVALID_OPERATION',
                    'message': 'operations.0.patch is required',
                }
            }
        }

        parsed = extract_upstream_error_details(detail)

        self.assertEqual(parsed.get('code'), 'INVALID_OPERATION')
        self.assertEqual(parsed.get('message'), 'operations.0.patch is required')
        self.assertIsNone(parsed.get('status_code'))
        self.assertEqual(extract_upstream_error_code(detail), 'INVALID_OPERATION')

    def test_extract_upstream_error_details_surfaces_first_validation_issue(self) -> None:
        # Mirrors the real nest_client envelope: {upstream, path, detail:
        # <backend body>} where the backend body nests under 'error' and the
        # commit 400 carries per-op validation_issues.
        detail = {
            'upstream': 'nestjs',
            'path': '/roadmaps/x/ai/commit',
            'detail': {
                'error': {
                    'message': 'Commit has validation errors and cannot be applied',
                    'status': 400,
                    'validation_issues': [
                        {
                            'code': 'NODE_NOT_FOUND',
                            'severity': 'error',
                            'path': 'operations.0.node_id',
                            'message': 'Task no longer exists on this roadmap.',
                        }
                    ],
                }
            },
        }

        parsed = extract_upstream_error_details(detail)

        self.assertEqual(
            parsed.get('validation_issue_message'),
            'Task no longer exists on this roadmap.',
        )
        self.assertEqual(
            parsed.get('message'),
            'Commit has validation errors and cannot be applied',
        )

    def test_extract_upstream_error_details_falls_back_to_error_and_status(self) -> None:
        detail = {
            'statusCode': 400,
            'error': 'Bad Request',
            'message': 'Validation failed',
        }

        parsed = extract_upstream_error_details(detail)

        self.assertEqual(parsed.get('code'), 'BAD_REQUEST')
        self.assertEqual(parsed.get('status_code'), 400)
        self.assertEqual(parsed.get('error'), 'Bad Request')
        self.assertEqual(parsed.get('message'), 'Validation failed')
        self.assertEqual(extract_upstream_error_code(detail), 'BAD_REQUEST')


if __name__ == '__main__':
    unittest.main()

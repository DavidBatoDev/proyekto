import unittest
from types import SimpleNamespace

from app.api.routes.sessions_support.route_flows import resolve_forward_auth
from app.core.nest_client import _apply_auth_header


class ResolveForwardAuthTests(unittest.TestCase):
    def test_bearer_wins_over_guest_header(self) -> None:
        request = SimpleNamespace(
            headers={
                'Authorization': 'Bearer token-123',
                'X-Guest-User-Id': 'guest-session-1',
            }
        )
        self.assertEqual(resolve_forward_auth(request), 'Bearer token-123')

    def test_guest_fallback_produces_guest_sentinel(self) -> None:
        request = SimpleNamespace(headers={'X-Guest-User-Id': 'guest-session-1'})
        self.assertEqual(resolve_forward_auth(request), 'Guest guest-session-1')

    def test_neither_header_returns_none(self) -> None:
        request = SimpleNamespace(headers={})
        self.assertIsNone(resolve_forward_auth(request))

    def test_empty_authorization_falls_back_to_guest(self) -> None:
        request = SimpleNamespace(
            headers={
                'Authorization': '',
                'X-Guest-User-Id': 'guest-session-2',
            }
        )
        self.assertEqual(resolve_forward_auth(request), 'Guest guest-session-2')


class ApplyAuthHeaderTests(unittest.TestCase):
    def test_guest_sentinel_maps_to_guest_header(self) -> None:
        headers = {'Content-Type': 'application/json'}
        _apply_auth_header(headers, 'Guest guest-session-1')
        self.assertEqual(headers.get('X-Guest-User-Id'), 'guest-session-1')
        self.assertNotIn('Authorization', headers)

    def test_bearer_passes_through_as_authorization(self) -> None:
        headers = {'Content-Type': 'application/json'}
        _apply_auth_header(headers, 'Bearer token-123')
        self.assertEqual(headers.get('Authorization'), 'Bearer token-123')
        self.assertNotIn('X-Guest-User-Id', headers)

    def test_none_leaves_headers_untouched(self) -> None:
        headers = {'Content-Type': 'application/json'}
        _apply_auth_header(headers, None)
        self.assertEqual(headers, {'Content-Type': 'application/json'})

    def test_empty_string_leaves_headers_untouched(self) -> None:
        headers = {'Content-Type': 'application/json'}
        _apply_auth_header(headers, '')
        self.assertEqual(headers, {'Content-Type': 'application/json'})


if __name__ == '__main__':
    unittest.main()

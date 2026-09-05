"""Test package for the agent.

Importing ``app.main`` (the HTTP smoke test, the trace-events endpoint test)
runs ``configure_logging`` for the whole test process, and ``unittest`` imports
every module before running any test. With agent/.env's ``AGENT_LOG_LEVEL=DEBUG``
every ``log_event`` then prints a multi-line block, which pushes the full
verbose run past the 1 MB ``spawnSync`` buffer of scripts/test_agent_unit.mjs
(surfaced as "Unable to run Python tests", not as a failure).

scripts/test_agent_unit.mjs copies agent/.env into the environment before
spawning Python, so a plain ``setdefault`` never wins: the level is FORCED to
WARNING here. Set ``AGENT_TEST_LOG_LEVEL=DEBUG`` (or INFO) to see the event
blocks while debugging a test. ``assertLogs`` sets its own level, so
log-capturing tests are unaffected. Environment variables take precedence
over the .env file in pydantic-settings, and ``get_settings()`` is first
called by the test modules, after this package init.
"""

import os

os.environ['AGENT_LOG_LEVEL'] = (os.environ.get('AGENT_TEST_LOG_LEVEL') or 'WARNING').upper()

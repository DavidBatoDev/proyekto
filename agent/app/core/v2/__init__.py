"""Roadmap AI v2 — lean single-loop agent.

A hand-rolled tool-calling loop that replaces the v1 6-route orchestrator
while preserving the exact HTTP contract, operation schema, Redis session
store, and NestJS integration boundary. Selected per message by
``AgentService._v2_enabled_for`` (global ``AGENT_V2_ENABLED`` or per-session
``metadata.brain_version``). The public entrypoint is
``app.core.v2.brain.run_v2_message`` — imported lazily by the caller to keep
this package free of import-time side effects and circular imports.
"""

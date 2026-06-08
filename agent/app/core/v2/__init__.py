"""Roadmap AI — lean single-loop agent (the only brain).

A hand-rolled tool-calling loop that emits roadmap operations over the shared
HTTP contract, operation schema, Redis session store, and NestJS integration
boundary. ``AgentService.plan_message`` calls the public entrypoint
``app.core.v2.brain.run_v2_message`` — imported lazily by the caller to keep
this package free of import-time side effects and circular imports.
"""

# Agent & Roadmap AI

> **Last updated:** 2026-07-09 · **Status:** planned (stub)

The Python FastAPI AI agent that powers roadmap editing: the v2 single tool-calling
loop, its memory architecture, the shared operations contract, and how to run/deploy it.

## Planned contents

| Doc | What's in it |
| --- | --- |
| `v2-loop.md` | The single tool-calling loop in `agent/app/core/v2/` (brain, tools, staging, revert) |
| `memory.md` | Redis session snapshot, conversation summarizer, durable per-roadmap memories |
| `operations-schema.md` | The shared `schemas/roadmap-ai-operations.json` backend↔agent contract |
| `setup-and-deploy.md` | Running the agent locally and deploying to Cloud Run |

_Scaffolded during the docs revamp; content lands in a later phase. See the
[docs index](../README.md) for build order._

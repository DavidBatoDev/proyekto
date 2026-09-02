# Proyekto Documentation

> **Last updated:** 2026-09-01 · **Status:** current (all 15 sections written)

The source of truth for how **Proyekto** is built and operated — a managed
work-delivery platform with a Consultant layer between Clients and Talent,
an AI-assisted roadmap engine, meetings, chat, payments, and a mobile app.

> Proyekto spans **six deployable units** — a React web app, a NestJS API, a
> Python AI agent, a Cloudflare realtime Worker, a Supabase Postgres database,
> and Terraform infrastructure. Start with
> [02-architecture](./02-architecture/README.md) for the big picture.

## How this is organized

Docs live in **numbered section folders**. Each folder has a `README.md` index
that lists its pages. Pages are plain, GitHub-rendered markdown — there's no docs
site, so links are relative filesystem paths. Every page carries a
`Last updated` date and a `Status`. The writing conventions are in
[STYLE.md](./STYLE.md).

> Every claim here is written from the current source (code, migrations, workflows),
> not carried over from older docs — so where this contradicts a stale note
> elsewhere (e.g. an out-of-date `CLAUDE.md` or `infra/README.md` line), trust this.

## Sections

| # | Section | What's in it | Status |
| --- | --- | --- | --- |
| 00 | [Getting Started](./00-getting-started/README.md) | Setup, local development, environment variables | **current** |
| 01 | [Product & Concepts](./01-product/README.md) | Personas, project lifecycle, roadmap model, glossary | **current** |
| 02 | [Architecture](./02-architecture/README.md) | The six units, deploy topology, cross-service flows | **current** |
| 03 | [Backend](./03-backend/README.md) | NestJS API — modules, guards, patterns, API reference | **current** |
| 04 | [Web](./04-web/README.md) | React frontend — routing, state, services, roadmap canvas | **current** |
| 05 | [Agent & Roadmap AI](./05-agent-ai/README.md) | The v2 loop, memory, the shared operations contract | **current** |
| 06 | [Realtime](./06-realtime/README.md) | Cloudflare Worker + Durable Objects | **current** |
| 07 | [Data & Database](./07-data-and-db/README.md) | Schema, migrations, identity model, RLS | **current** |
| 08 | [Storage & Media](./08-storage-media/README.md) | R2 buckets, upload paths, Supabase→R2 migration | **current** |
| 09 | [Mobile](./09-mobile/README.md) | Capacitor apps, FCM push, OTA updates | **current** |
| 10 | [Infrastructure & Deployment](./10-infra-deploy/README.md) | CI/CD, Cloud Run, Terraform, Cloudflare | **current** |
| 11 | [Feature Domains](./11-domains/README.md) | Workspaces, participant positions, delivery lifecycle, collaboration, and platform-experience deep dives | **current** |
| 12 | [Runbooks & Ops](./12-runbooks/README.md) | Secret rotation, cache purge, vetting, benchmarks | **current** |
| 13 | [Proposals](./13-proposals/README.md) | Reviewed designs that are **not yet built** — client access handover, services & multi-roadmap, the delivery tree, identity & enrollment, pricing tiers | **draft** |
| 14 | [Engagements](./14-engagement/README.md) | P4b tables, the integration surface, scenarios, lifecycle rules, commercial time, and privacy boundaries | **current** |

> **⚠️ Section 13 is the exception to the current-state rule.** Everything in `00`–`12`
> describes shipped behaviour, and `13-proposals/` holds general designs that do not exist
> yet; its pages remain `Status: draft` until the corresponding runtime behavior ships.
>
> `14-engagement/` shipped its schema and activation path on 2026-08-18 and is now
> current-state, but the runtime that consumes engagements — assignments, time submission,
> approvals, and redacted projections — is still unbuilt. Its pages mark which behavior is
> live and which is intended; start from
> [Integration surface](./14-engagement/integration.md).

## Also at the repo root

- [`CLAUDE.md`](../CLAUDE.md) — repo layout, per-package commands, and architecture notes (dev/agent guide).
- [`README.md`](../README.md) — the product pitch and top-level repo structure.

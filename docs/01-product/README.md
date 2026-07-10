# Product & Concepts

> **Last updated:** 2026-07-09 · **Status:** current

How Proyekto works in plain language, before any code. **Proyekto is a managed work
delivery platform** — it combines the speed of freelance hiring with the structure
of agency execution by putting a vetted **Consultant** layer between Clients and
Freelancers, so vision, planning, collaboration, and accountability all live in one
workspace.

> If you're new to Proyekto, read these in order: [personas](./personas.md) →
> [project lifecycle](./project-lifecycle.md) → [roadmap & milestones](./roadmap-and-milestones.md).

## Documentation index

| Doc | What's in it |
| --- | --- |
| [personas.md](./personas.md) | Client, Consultant, Freelancer, Admin — one account, many roles; verification vs persona |
| [project-lifecycle.md](./project-lifecycle.md) | Idea → project → roadmap → team → delivery → billing → done |
| [roadmap-and-milestones.md](./roadmap-and-milestones.md) | The Epic → Feature → Task model, the two views, date & progress rules |
| [glossary.md](./glossary.md) | Product-wide vocabulary |

## Platform principles

- **Delivery-first** — planning and execution are first-class, not an afterthought.
- **Role clarity** — each persona has clear responsibilities and permissions.
- **Transparency** — stakeholders see the right level of detail at the right time.
- **Quality control** — consultant vetting and admin governance back reliable outcomes.

## Where the concepts become code

| Concept | Lives in |
| --- | --- |
| Personas & auth | [Backend → auth & guards](../03-backend/auth-and-guards.md) |
| The roadmap engine | [Backend → modules](../03-backend/modules.md), [Agent & Roadmap AI](../05-agent-ai/README.md) |
| Teams, chat, meetings, money | [Feature Domains](../11-domains/README.md) |
| The data model | [Data & Database](../07-data-and-db/README.md) |

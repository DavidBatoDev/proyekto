# Web (Frontend)

> **Last updated:** 2026-09-05 · **Status:** current

The React 19 + Vite single-page app — also the mobile app via Capacitor. File-based
routing (TanStack Router), server state in TanStack Query, a little client state in
Zustand, and a rich roadmap canvas — drawn by an in-house engine — with optimistic UI.

> If you only read one page, read [architecture.md](./architecture.md). For the
> mobile packaging of this same app, see [Mobile](../09-mobile/README.md).

## Documentation index

| Doc | What's in it |
| --- | --- |
| [architecture.md](./architecture.md) | Stack, bootstrap, providers, the two API clients, query defaults |
| [routing-and-access.md](./routing-and-access.md) | File-based routes, the lane-free signup wizard, authentication, and capability gating |
| [state-and-services.md](./state-and-services.md) | The seven Zustand stores, service clients, TanStack Query usage |
| [roadmap-canvas.md](./roadmap-canvas.md) | The canvas engine, view modes, and the optimistic-UI model |
| [ai-assistant.md](./ai-assistant.md) | The shared AI kit (`components/ai/`): scopes, the client-driven run loop, @-mentions, the roadmap wrapper and the dashboard assistant, frozen Playwright strings |

## Glossary

| Term | Meaning |
| --- | --- |
| **`routeTree.gen.ts`** | Router-plugin-generated route tree — never hand-edited. |
| **`beforeLoad` guard** | Synchronous route hook that redirects unauthenticated/unauthorized users. |
| **Optimistic UI** | Apply an edit locally immediately, then reconcile or roll back against the server. |
| **`temp-` id** | A client-generated node id used until the server returns the real one. |
| **`projectId === "n"`** | The guest / roadmap-only sentinel that skips the auth guard. |
| **AI scope** | What an assistant thread is bound to: one roadmap (`roadmap:{id}`) or the open workspace (`workspace:{id}`). Keys the sessions route, the query cache, and the persisted active thread. |
| **Run** | One user message as the agent processes it — investigate, propose, execute, verify — advanced by the web in legs (`send`, then `continue`) until a checkpoint or completion. |

## Code locations

- **Routes:** [`web/src/routes/`](../../web/src/routes/) (generated tree: `routeTree.gen.ts`)
- **Stores:** [`web/src/stores/`](../../web/src/stores/) · **Services:** [`web/src/services/`](../../web/src/services/) · **API:** [`web/src/api/`](../../web/src/api/)
- **Roadmap canvas:** [`web/src/components/roadmap/`](../../web/src/components/roadmap/)
- **AI kit:** [`web/src/components/ai/`](../../web/src/components/ai/) (wrapper: `components/roadmap/ai/RoadmapAiAssistantPanel.tsx`; dashboard: `components/home/DashboardAiPanel.tsx`)
- **Bootstrap:** [`web/src/main.tsx`](../../web/src/main.tsx), [`web/src/routes/__root.tsx`](../../web/src/routes/__root.tsx)

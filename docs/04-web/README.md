# Web (Frontend)

> **Last updated:** 2026-07-09 · **Status:** current

The React 19 + Vite single-page app — also the mobile app via Capacitor. File-based
routing (TanStack Router), server state in TanStack Query, a little client state in
Zustand, and a rich XYFlow roadmap canvas with optimistic UI.

> If you only read one page, read [architecture.md](./architecture.md). For the
> mobile packaging of this same app, see [Mobile](../09-mobile/README.md).

## Documentation index

| Doc | What's in it |
| --- | --- |
| [architecture.md](./architecture.md) | Stack, bootstrap, providers, the two API clients, query defaults |
| [routing-and-personas.md](./routing-and-personas.md) | File-based routes, the persona subtrees, auth/persona gating |
| [state-and-services.md](./state-and-services.md) | The four Zustand stores, service clients, TanStack Query usage |
| [roadmap-canvas.md](./roadmap-canvas.md) | The XYFlow canvas, view modes, and the optimistic-UI model |

## Glossary

| Term | Meaning |
| --- | --- |
| **`routeTree.gen.ts`** | Router-plugin-generated route tree — never hand-edited. |
| **`beforeLoad` guard** | Synchronous route hook that redirects unauthenticated/unauthorized users. |
| **Optimistic UI** | Apply an edit locally immediately, then reconcile or roll back against the server. |
| **`temp-` id** | A client-generated node id used until the server returns the real one. |
| **`projectId === "n"`** | The guest / roadmap-only sentinel that skips the auth guard. |

## Code locations

- **Routes:** [`web/src/routes/`](../../web/src/routes/) (generated tree: `routeTree.gen.ts`)
- **Stores:** [`web/src/stores/`](../../web/src/stores/) · **Services:** [`web/src/services/`](../../web/src/services/) · **API:** [`web/src/api/`](../../web/src/api/)
- **Roadmap canvas:** [`web/src/components/roadmap/`](../../web/src/components/roadmap/)
- **Bootstrap:** [`web/src/main.tsx`](../../web/src/main.tsx), [`web/src/routes/__root.tsx`](../../web/src/routes/__root.tsx)

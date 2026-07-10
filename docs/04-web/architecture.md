# Web Architecture

> **Last updated:** 2026-07-09 · **Status:** current

The web app is a **React 19 + Vite** single-page app, also packaged as the mobile app
via Capacitor. Routing is file-based (TanStack Router), server state is TanStack
Query, and a small amount of client state lives in Zustand. It talks to the backend
for CRUD and to the agent directly for roadmap AI.

> The whole stack leans on the TanStack suite (Router / Query / Table) plus Zustand
> for the few pieces of genuinely client-side state (auth, the roadmap canvas, UI
> prefs). Everything else is server state cached by React Query.

## Stack

| Concern | Choice |
| --- | --- |
| Framework / build | React 19, Vite 7, TypeScript 5.7 |
| Routing | TanStack Router (file-based, code-split) |
| Server state | TanStack Query |
| Tables | TanStack Table |
| Client state | Zustand |
| UI | MUI 7 + Tailwind v4 (`clsx`, `tailwind-merge`, `cva`) |
| Rich text / code | Lexical, Monaco (JSON editor) |
| Canvas | XYFlow (React Flow) — see [roadmap-canvas.md](./roadmap-canvas.md) |
| Drag & drop | dnd-kit |
| Native | Capacitor (Android/iOS) + Firebase messaging |
| Backends | Supabase JS, axios |

Path alias `@` → `web/src`. Dev server on port 3000. `npm run build` runs
`vite build` **then** `tsc` (typecheck gates the build).

## Bootstrap

[`web/src/main.tsx`](../../web/src/main.tsx):

1. Fires `CapacitorUpdater.notifyAppReady()` (OTA commit; no-op on web) and, on
   Android, loads the edge-to-edge plugin.
2. Builds the router from the **generated** `routeTree.gen.ts` with a QueryClient in
   context (`defaultPreload: "intent"`, scroll restoration, structural sharing).
3. Provider nesting: `StrictMode` → `TanStackQueryProvider` → `AuthInitializer` →
   `RouterProvider`.

`AuthInitializer` ([`components/auth/AuthInitializer.tsx`](../../web/src/components/auth/AuthInitializer.tsx))
calls `useAuthStore.initialize()` and shows a loading screen until the Supabase
session resolves — so every route guard can read auth synchronously.

The root route [`routes/__root.tsx`](../../web/src/routes/__root.tsx) mounts
`usePushNotifications()` (native FCM lifecycle), the toast provider, the header, the
floating active timer, and `MigrationHandler` (guest→user data migration).

## Data flow

```
component ─► useQuery/useMutation (TanStack Query)
                 │
                 ├─ apiClient (VITE_API_URL) ──► backend /api/*     (CRUD)
                 └─ agentApiClient (VITE_AGENT_API_URL) ──► agent   (roadmap AI)
        server state cached by React Query; client state in Zustand stores
```

Two axios clients: `apiClient` for the backend (30 s timeout, Bearer/guest header
injection, `{data}` unwrapped at call sites) and `agentApiClient` for the agent
(180 s timeout for long reasoning turns). See
[state-and-services.md](./state-and-services.md).

## Query client defaults

`staleTime: 30s`, `refetchOnWindowFocus: false`, `refetchOnReconnect: true`,
`refetchOnMount: false` — tuned so navigation is snappy and realtime events (not
polling) drive most invalidation. See
[Realtime](../06-realtime/README.md).

## See also

- [routing-and-personas.md](./routing-and-personas.md) — the route tree and auth gating.
- [state-and-services.md](./state-and-services.md) — Zustand stores + API service clients.
- [roadmap-canvas.md](./roadmap-canvas.md) — the XYFlow canvas + optimistic UI.

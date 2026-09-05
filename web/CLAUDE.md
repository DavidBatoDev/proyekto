# web/ - React 19 SPA + Capacitor mobile

Local context for the web unit. Cross-cutting rules live in the root CLAUDE.md.

## Commands (run from web/)

- npm run dev - Vite on port 3000
- npm test - Vitest single run (co-located src/**/*.test.ts(x)); `vitest` for watch
- npm run check / lint / format - Biome (tab indent, double quotes)
- npm run build - vite build && tsc. tsc runs AFTER Vite; type errors fail the build even if Vite succeeds. Full builds only per the root Build and Push Policy.
- NEVER run `wrangler deploy` from a session for web/ - deploys go exclusively through .github/workflows/web-deploy.yml (permissions deny it).

## Conventions

- Path alias @/* -> web/src/*.
- Routing: TanStack Router file-based routes under src/routes/, grouped by product area (admin/, auth/, consultant/, contract/, finance/, freelancer/, oauth/, profile/, project/, roadmap/, roadmap-templates/, settings/, teams/) - there is NO client/ subtree. src/routeTree.gen.ts is GENERATED - never hand-edit (a hook blocks it); it regenerates via the dev server or build.
- New page paths must be added to Header.tsx validPaths or the header breaks on them. Organizational pages live under /w/$workspaceSlug/ (dashboard, teams, workspace settings); path matchers in the chrome run stripWorkspacePrefix first and string-built links go through toWorkspacePath (both in src/lib/workspacePaths.ts) - do not add "/w" to validPaths (it would also match /welcome and /work-items).
- Styling: MUI 7 and Tailwind 4 coexist. Use theme tokens (bg-primary, text-primary, the blue-600 scale) - NEVER hardcode hex colors. Theme tokens live in src/styles.css.
- User-facing copy says "Proyekto" - never "Prodigy".
- State: server state in TanStack Query (src/queries/), client state in the 7 Zustand stores (src/stores/: authStore, roadmapStore, aiThreadsStore, aiRunStore, projectSettingsStore, appearanceStore, workspaceStore). workspaceStore holds only the CURRENT WORKSPACE SELECTION - the workspace list itself stays in TanStack Query. aiThreadsStore persists the active thread + composer drafts per AI scope (`ai.threads.v1`); aiRunStore is the non-persisted per-thread run state written by the singleton run controller. API calls go through src/services/ + src/api/ (axios.ts for backend, agent-axios.ts for the agent).
- AI assistant: src/components/ai/ is the shared AI kit; it never imports roadmapStore (importBoundary.test.ts). The roadmap page mounts it through the thin wrapper src/components/roadmap/ai/RoadmapAiAssistantPanel.tsx (the only place the assistant touches roadmapStore); the dashboard rail/fullscreen mount it in workspace scope from src/components/home/DashboardAiPanel.tsx. Runs are driven by the singleton src/components/ai/runController.ts (send -> continue while `run.next === "continue"` -> settle) over src/services/ai-agent.service.ts. Strings Playwright depends on ("AI Assistant Panel", "AI thread picker", "New thread", "Toggle AI chat panel", the commit-card labels) are frozen - keep them byte-identical.
- Roadmap canvas: an in-house DOM+SVG engine in src/lib/flow/ (no graph library; @xyflow/react and dagre were removed 2026-08-16). lib/flow/ may import ONLY react/react-dom - that boundary is enforced by importBoundary.test.ts so the engine stays liftable into its own package. Layout is the hand-written getLayoutedElements in canvas/model/layout.ts; epic/feature/task mutations use optimistic updates with rollback - follow the existing pattern in roadmapStore/services when adding operations.

## Playwright (e2e)

- Config: playwright.config.ts; tests in playwright/tests/; base URL http://localhost:3000 (dev server must be running).
- Auth: `npm run pw:auth` saves session to playwright/.auth/user.json. Requires PLAYWRIGHT_EMAIL / PLAYWRIGHT_PASSWORD in web/.env.
- Projects: `setup` then `chromium-user` (depends on setup, reuses storage state).
- Run: `npm run pw:test` (all) / `npm run pw:watch`.
- Audit harness: `npm run pw:audit:routes` (route coverage assert), `pw:audit:dark` (dark-theme captures), `pw:audit:hovers` - see the /ui-audit skill.
- Drive the app ADAPTIVELY, especially the roadmap AI assistant: observe each response before the next action, answer clarifying questions the assistant asks. Never fire blind scripted batteries.

## Mobile (Capacitor)

- android/ and ios/ are the native projects; appId tech.proyekto.app; Capgo self-hosted OTA pulls web bundles from the backend mobile-updates module.
- `npm run cap:sync` performs a full web build - treat it as push-tier work under the Build and Push Policy.
- Release APK/AAB builds happen in CI on v*.*.* tags, not locally.

# web/ - React 19 SPA + Capacitor mobile

Local context for the web unit. Cross-cutting rules live in the root CLAUDE.md.

## Commands (run from web/)

- npm run dev - Vite on port 3000
- npm test - Vitest single run (co-located src/**/*.test.ts(x)); `vitest` for watch
- npm run check / lint / format - Biome (tab indent, double quotes)
- npm run build - vite build && tsc. tsc runs AFTER Vite; type errors fail the build even if Vite succeeds. Full builds only per the root Build and Push Policy.

## Conventions

- Path alias @/* -> web/src/*.
- Routing: TanStack Router file-based routes under src/routes/, split per persona (admin/, client/, consultant/, freelancer/, profile/, project/, roadmap/, roadmap-templates/, teams/, ...). src/routeTree.gen.ts is GENERATED - never hand-edit (a hook blocks it); it regenerates via the dev server or build.
- New page paths must be added to Header.tsx validPaths or the header breaks on them.
- Styling: MUI 7 and Tailwind 4 coexist. Use theme tokens (bg-primary, text-primary, the blue-600 scale) - NEVER hardcode hex colors. Theme tokens live in src/styles.css.
- User-facing copy says "Proyekto" - never "Prodigy".
- State: server state in TanStack Query (src/queries/), client state in the 5 Zustand stores (src/stores/: authStore, roadmapStore, roadmapAiThreadsStore, projectSettingsStore, appearanceStore). API calls go through src/services/ + src/api/ (axios.ts for backend, agent-axios.ts for the agent).
- Roadmap canvas: XYFlow + dagre; epic/feature/task mutations use optimistic updates with rollback - follow the existing pattern in roadmapStore/services when adding operations.

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

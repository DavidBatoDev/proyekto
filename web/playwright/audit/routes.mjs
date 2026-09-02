/**
 * Route manifest for the mobile-responsiveness audit (see capture.mjs).
 *
 * STATIC routes need no entity id. DYNAMIC routes carry `:placeholder`s that are
 * filled at runtime from ids discovered after login. Anything we can't resolve
 * is recorded as `skipped` in the manifest rather than silently dropped.
 *
 * Placeholders: :projectId :roadmapId :chatRef :teamId :profileId :token :workspaceSlug
 *
 * Organizational pages live under /w/:workspaceSlug/…; their bare twins
 * (/dashboard, /teams/…, /workspace/…) are still generated routes — redirect
 * stubs — so both stay listed, or the coverage assert fails.
 */

export const STATIC_ROUTES = [
  // ── public / unauthenticated ────────────────────────────────────────────
  { path: "/", group: "public", auth: false },
  { path: "/home", group: "public", auth: false },
  { path: "/landing", group: "public", auth: false },
  { path: "/auth/login", group: "auth", auth: false },
  { path: "/auth/signup", group: "auth", auth: false },
  { path: "/auth/forgot-password", group: "auth", auth: false },
  { path: "/auth/verify", group: "auth", auth: false },
  { path: "/auth/callback", group: "auth", auth: false },
  { path: "/auth/admin/login", group: "auth", auth: false },
  { path: "/auth/admin/signin", group: "auth", auth: false },
  { path: "/marketplace/consultant", group: "public", auth: false },
  { path: "/marketplace/consultant/browse", group: "public", auth: false },
  { path: "/marketplace/talent", group: "public", auth: false },

  // ── global authed (list/landing pages, no id needed) ────────────────────
  { path: "/welcome", group: "global", auth: true },
  { path: "/onboarding", group: "global", auth: true },
  { path: "/dashboard", group: "global", auth: true },
  { path: "/meetings", group: "global", auth: true },
  { path: "/engagements", group: "global", auth: true },
  { path: "/notifications", group: "global", auth: true },
  { path: "/inbox", group: "global", auth: true },
  { path: "/work-items", group: "global", auth: true },
  { path: "/project/new", group: "global", auth: true },
  { path: "/marketplace", group: "public", auth: false },
  // Public, indexable category pages. Both are seeded taxonomy slugs, so they
  // resolve without a fixture; they render the empty state until consultants
  // are attached to sub-categories.
  {
    path: "/marketplace/category/ai-and-data",
    group: "public",
    auth: false,
  },
  {
    path: "/marketplace/category/ai-and-data/llm-application-development",
    group: "public",
    auth: false,
  },
  { path: "/marketplace/finance", group: "consultant", auth: true },
  { path: "/marketplace/finance/contracts", group: "consultant", auth: true },
  { path: "/marketplace/finance/invoices", group: "consultant", auth: true },
  { path: "/marketplace/finance/invoices/new", group: "consultant", auth: true },
  { path: "/roadmap/shared-with-me", group: "roadmap", auth: true },
  { path: "/settings", group: "settings", auth: true },
  { path: "/settings/appearance", group: "settings", auth: true },
  { path: "/settings/notifications", group: "settings", auth: true },
  { path: "/settings/mcp-tokens", group: "settings", auth: true },
  { path: "/project/roadmap", group: "roadmap", auth: false },

  // ── teams (list + self) ─────────────────────────────────────────────────
  { path: "/teams", group: "teams", auth: true },
  { path: "/teams/me/invites", group: "teams", auth: true },

  // ── bare workspace settings (redirect stubs to /w/:workspaceSlug/settings) ──
  { path: "/workspace", group: "workspace", auth: true },
  { path: "/workspace/settings", group: "workspace", auth: true },
  { path: "/workspace/settings/members", group: "workspace", auth: true },
  { path: "/workspace/settings/billing", group: "workspace", auth: true },

  // ── talent / consultant authed ──────────────────────────────────────
  { path: "/marketplace/talent/go-live", group: "talent", auth: true },
  { path: "/freelancer/invites", group: "talent", auth: true },
  { path: "/marketplace/consultant/apply", group: "consultant", auth: true },
  { path: "/marketplace/talent/browse", group: "consultant", auth: true },
  { path: "/marketplace/consultant/templates", group: "consultant", auth: true },

  // ── admin (likely `redirected` if the account isn't an admin) ───────────
  { path: "/admin/applications", group: "admin", auth: true },
  { path: "/admin", group: "admin", auth: true },
  { path: "/admin/match", group: "admin", auth: true },
  { path: "/admin/approve-admin", group: "admin", auth: true },
  { path: "/admin/settings", group: "admin", auth: true },
];

export const DYNAMIC_ROUTES = [
  { tpl: "/project/:projectId", needs: ["projectId"], group: "project", auth: true },
  // ── project-scoped ──────────────────────────────────────────────────────
  { tpl: "/project/:projectId/overview", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/roadmap", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/roadmap/:roadmapId", needs: ["projectId", "roadmapId"], group: "project", auth: true },
  { tpl: "/project/:projectId/roadmap/create", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/roadmap/convert/:roadmapId", needs: ["roadmapId"], group: "roadmap", auth: true },
  { tpl: "/project/:projectId/timeline", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/timeline/:roadmapId", needs: ["projectId", "roadmapId"], group: "project", auth: true },
  { tpl: "/project/:projectId/work-items", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/work-items/:roadmapId", needs: ["projectId", "roadmapId"], group: "project", auth: true },
  { tpl: "/project/:projectId/chat/:chatRef", needs: ["projectId", "chatRef"], group: "project", auth: true },
  { tpl: "/project/:projectId/team", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/team/teams", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/team/permissions", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/team/catalog", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/team/invites", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/resources", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/payments", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/logs", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/settings/general", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/settings", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/settings/permissions", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/settings/team", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/settings/teams", needs: ["projectId"], group: "project", auth: true },

  // ── team-scoped (the team-time pages are the known table offenders) ──────
  { tpl: "/teams/:teamId", needs: ["teamId"], group: "teams", auth: true },
  { tpl: "/teams/:teamId/settings", needs: ["teamId"], group: "teams", auth: true },
  { tpl: "/teams/:teamId/settings/general", needs: ["teamId"], group: "teams", auth: true },
  { tpl: "/teams/:teamId/settings/projects", needs: ["teamId"], group: "teams", auth: true },
  { tpl: "/teams/:teamId/settings/logs", needs: ["teamId"], group: "teams", auth: true },
  { tpl: "/teams/:teamId/settings/time", needs: ["teamId"], group: "teams", auth: true },
  { tpl: "/teams/:teamId/time", needs: ["teamId"], group: "teams", auth: true },
  { tpl: "/teams/:teamId/time/my-logs", needs: ["teamId"], group: "teams", auth: true },
  { tpl: "/teams/:teamId/time/team-logs", needs: ["teamId"], group: "teams", auth: true },
  { tpl: "/teams/:teamId/time/manage-rates", needs: ["teamId"], group: "teams", auth: true },
  { tpl: "/teams/:teamId/time/payouts", needs: ["teamId"], group: "teams", auth: true },
  { tpl: "/teams/:teamId/time/log/:logId", needs: ["teamId", "logId"], group: "teams", auth: true },
  { tpl: "/teams/:teamId/time/manage-rates/:userId", needs: ["teamId", "userId"], group: "teams", auth: true },

  // ── workspace-scoped twins (the real pages) ────────────────────────────
  { tpl: "/w/:workspaceSlug", needs: ["workspaceSlug"], group: "workspace", auth: true },
  { tpl: "/w/:workspaceSlug/dashboard", needs: ["workspaceSlug"], group: "global", auth: true },
  { tpl: "/w/:workspaceSlug/settings", needs: ["workspaceSlug"], group: "workspace", auth: true },
  { tpl: "/w/:workspaceSlug/settings/members", needs: ["workspaceSlug"], group: "workspace", auth: true },
  { tpl: "/w/:workspaceSlug/settings/billing", needs: ["workspaceSlug"], group: "workspace", auth: true },
  { tpl: "/w/:workspaceSlug/teams", needs: ["workspaceSlug"], group: "teams", auth: true },
  { tpl: "/w/:workspaceSlug/teams/:teamId", needs: ["workspaceSlug", "teamId"], group: "teams", auth: true },
  { tpl: "/w/:workspaceSlug/teams/:teamId/settings", needs: ["workspaceSlug", "teamId"], group: "teams", auth: true },
  { tpl: "/w/:workspaceSlug/teams/:teamId/settings/general", needs: ["workspaceSlug", "teamId"], group: "teams", auth: true },
  { tpl: "/w/:workspaceSlug/teams/:teamId/settings/projects", needs: ["workspaceSlug", "teamId"], group: "teams", auth: true },
  { tpl: "/w/:workspaceSlug/teams/:teamId/settings/logs", needs: ["workspaceSlug", "teamId"], group: "teams", auth: true },
  { tpl: "/w/:workspaceSlug/teams/:teamId/settings/time", needs: ["workspaceSlug", "teamId"], group: "teams", auth: true },
  { tpl: "/w/:workspaceSlug/teams/:teamId/time", needs: ["workspaceSlug", "teamId"], group: "teams", auth: true },
  { tpl: "/w/:workspaceSlug/teams/:teamId/time/my-logs", needs: ["workspaceSlug", "teamId"], group: "teams", auth: true },
  { tpl: "/w/:workspaceSlug/teams/:teamId/time/team-logs", needs: ["workspaceSlug", "teamId"], group: "teams", auth: true },
  { tpl: "/w/:workspaceSlug/teams/:teamId/time/manage-rates", needs: ["workspaceSlug", "teamId"], group: "teams", auth: true },
  { tpl: "/w/:workspaceSlug/teams/:teamId/time/payouts", needs: ["workspaceSlug", "teamId"], group: "teams", auth: true },
  { tpl: "/w/:workspaceSlug/teams/:teamId/time/log/:logId", needs: ["workspaceSlug", "teamId", "logId"], group: "teams", auth: true },
  { tpl: "/w/:workspaceSlug/teams/:teamId/time/manage-rates/:userId", needs: ["workspaceSlug", "teamId", "userId"], group: "teams", auth: true },

  // ── profile ─────────────────────────────────────────────────────────────
  { tpl: "/profile/:profileId", needs: ["profileId"], group: "profile", auth: true },
  { tpl: "/marketplace/consultant/:profileId", needs: ["profileId"], group: "profile", auth: false },

  // ── public shared roadmap (token-gated; no login) ───────────────────────
  { tpl: "/roadmap/shared/:token", needs: ["token"], group: "roadmap", auth: false },
];

/**
 * Routes worth an extra 320px narrow-stress pass — the known wide-table /
 * heavy-content offenders surfaced by the static audit.
 */
export const NARROW_STRESS = [
  "/dashboard",
  "/work-items",
  "/w/:workspaceSlug/dashboard",
  "/w/:workspaceSlug/teams/:teamId/time/team-logs",
  "/w/:workspaceSlug/teams/:teamId/time/my-logs",
  "/w/:workspaceSlug/teams/:teamId/settings/logs",
  "/project/:projectId/payments",
  "/project/:projectId/logs",
  // The mobile Gantt budgets a 132px frozen task column against the viewport;
  // at 320px that leaves 188px of chart, which is where it will break first.
  "/project/:projectId/timeline/:roadmapId",
];

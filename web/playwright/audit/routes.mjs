/**
 * Route manifest for the mobile-responsiveness audit (see capture.mjs).
 *
 * STATIC routes need no entity id. DYNAMIC routes carry `:placeholder`s that are
 * filled at runtime from ids discovered after login. Anything we can't resolve
 * is recorded as `skipped` in the manifest rather than silently dropped.
 *
 * Placeholders: :projectId :roadmapId :chatRef :teamId :profileId :token
 */

export const STATIC_ROUTES = [
  // ── public / unauthenticated ────────────────────────────────────────────
  { path: "/", group: "public", auth: false },
  { path: "/landing", group: "public", auth: false },
  { path: "/auth/login", group: "auth", auth: false },
  { path: "/auth/signup", group: "auth", auth: false },
  { path: "/auth/forgot-password", group: "auth", auth: false },
  { path: "/auth/verify", group: "auth", auth: false },
  { path: "/auth/callback", group: "auth", auth: false },
  { path: "/auth/admin/login", group: "auth", auth: false },
  { path: "/auth/admin/signin", group: "auth", auth: false },
  { path: "/consultant", group: "public", auth: false },
  { path: "/consultant/browse", group: "public", auth: false },

  // ── global authed (list/landing pages, no id needed) ────────────────────
  { path: "/welcome", group: "global", auth: true },
  { path: "/onboarding", group: "global", auth: true },
  { path: "/dashboard", group: "global", auth: true },
  { path: "/meetings", group: "global", auth: true },
  { path: "/notifications", group: "global", auth: true },
  { path: "/inbox", group: "global", auth: true },
  { path: "/work-items", group: "global", auth: true },
  { path: "/project-posting", group: "global", auth: true },
  { path: "/roadmap/shared-with-me", group: "roadmap", auth: true },
  { path: "/settings/appearance", group: "settings", auth: true },
  { path: "/project/roadmap", group: "roadmap", auth: false },

  // ── teams (list + self) ─────────────────────────────────────────────────
  { path: "/teams", group: "teams", auth: true },
  { path: "/teams/me/invites", group: "teams", auth: true },

  // ── freelancer / consultant authed ──────────────────────────────────────
  { path: "/freelancer/go-live", group: "freelancer", auth: true },
  { path: "/freelancer/invites", group: "freelancer", auth: true },
  { path: "/consultant/apply", group: "consultant", auth: true },
  { path: "/consultant/marketplace", group: "consultant", auth: true },
  { path: "/consultant/templates", group: "consultant", auth: true },

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
  { tpl: "/project/:projectId/work-items", needs: ["projectId"], group: "project", auth: true },
  { tpl: "/project/:projectId/work-items/:roadmapId", needs: ["projectId", "roadmapId"], group: "project", auth: true },
  { tpl: "/project/:projectId/chat/:chatRef", needs: ["projectId", "chatRef"], group: "project", auth: true },
  { tpl: "/project/:projectId/team", needs: ["projectId"], group: "project", auth: true },
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

  // ── profile ─────────────────────────────────────────────────────────────
  { tpl: "/profile/:profileId", needs: ["profileId"], group: "profile", auth: true },
  { tpl: "/consultant/:profileId", needs: ["profileId"], group: "profile", auth: false },

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
  "/teams/:teamId/time/team-logs",
  "/teams/:teamId/time/my-logs",
  "/teams/:teamId/settings/logs",
  "/project/:projectId/payments",
  "/project/:projectId/logs",
];

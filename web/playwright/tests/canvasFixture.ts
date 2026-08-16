/**
 * The roadmap the canvas specs drive.
 *
 * These were hardcoded to a production roadmap, which meant the specs could
 * only ever pass against production data — but `npm run dev` refuses to boot
 * against anything except the development Supabase project (see the guard in
 * vite.config.ts), so localhost:3000 always talks to dev. The IDs therefore
 * resolved to a roadmap the signed-in dev user cannot see, the canvas never
 * mounted, and every spec timed out waiting for `data-canvas-ready`.
 *
 * Override per environment with PW_PROJECT_ID / PW_ROADMAP_ID. The defaults
 * point at the dev project's seeded roadmap so the suite runs out of the box
 * for anyone whose dev account can see it.
 */
export const PROJECT_ID =
	process.env.PW_PROJECT_ID ?? "5cc20839-afb9-4cd4-81cf-4057c9ca7a2d";

export const ROADMAP_ID =
	process.env.PW_ROADMAP_ID ?? "0c7d5bdc-6614-4f9d-b4f0-d8501a0c041b";

export const APP_URL = `/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView`;

// Cross-platform launcher for a *watchable* Playwright run: forces headed mode
// and a slow-motion delay so you can see each action in the browser. Avoids
// the Windows-vs-POSIX inline-env-var problem in npm scripts (no cross-env dep).
//
//   npm run pw:watch                       # default: the AI chat UI walkthrough
//   npm run pw:watch -- playwright/tests/<other>.spec.ts
//   PLAYWRIGHT_SLOWMO=1200 npm run pw:watch # override the delay
import { spawnSync } from "node:child_process";

process.env.PLAYWRIGHT_HEADED = "1";
process.env.PLAYWRIGHT_SLOWMO = process.env.PLAYWRIGHT_SLOWMO || "800";

const spec =
  process.argv[2] || "playwright/tests/roadmap-ai-ui-sweep.spec.ts";

const result = spawnSync(
  "npx",
  ["playwright", "test", spec, "--project=chromium-user", "--reporter=list"],
  { stdio: "inherit", shell: true },
);

process.exit(result.status ?? 1);

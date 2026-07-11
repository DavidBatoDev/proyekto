import fs from "node:fs";
import path from "node:path";
import { DYNAMIC_ROUTES, STATIC_ROUTES } from "./routes.mjs";

const normalize = (route) =>
  route.replace(/\$([A-Za-z0-9_]+)/g, ":$1").replace(/\/$/, "") || "/";

const routeTree = fs.readFileSync(
  path.resolve(process.cwd(), "src", "routeTree.gen.ts"),
  "utf8",
);
const generated = new Set(
  [...routeTree.matchAll(/fullPath: '([^']+)'/g)].map((match) =>
    normalize(match[1]),
  ),
);
const audited = new Set([
  ...STATIC_ROUTES.map((route) => normalize(route.path)),
  ...DYNAMIC_ROUTES.map((route) => normalize(route.tpl)),
]);

const missing = [...generated].filter((route) => !audited.has(route)).sort();
if (missing.length) {
  console.error("Routes missing from the Playwright screenshot manifest:");
  for (const route of missing) console.error(`  - ${route}`);
  process.exit(1);
}

console.log(
  `[audit] route coverage complete: ${generated.size} generated paths represented`,
);


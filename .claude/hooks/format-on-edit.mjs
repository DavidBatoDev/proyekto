#!/usr/bin/env node
/**
 * PostToolUse hook (Edit|MultiEdit|Write): auto-format the edited file
 * with the unit's own formatter.
 *  - web/**     -> Biome  (web/biome.json: tabs, double quotes)
 *  - backend/** -> Prettier (backend prettier config)
 *  - everything else (agent/, realtime/, supabase/, docs/) -> untouched
 * Invokes the formatter's JS bin directly with the current Node binary
 * (Windows-safe, no shell, no npx startup cost); falls back to npx via
 * shell if node_modules is missing. Fail-open and silent: always exit 0.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const filePath = input?.tool_input?.file_path;
  if (!filePath || !existsSync(filePath)) process.exit(0);

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const rel = path.relative(root, filePath).split(path.sep).join("/");
  if (rel.startsWith("..")) process.exit(0); // outside the repo
  const lower = rel.toLowerCase();
  if (lower.endsWith("routetree.gen.ts")) process.exit(0); // generated

  const ext = path.extname(lower);

  const runFormatter = (unitDir, jsBinRel, args, npxArgs) => {
    const cwd = path.join(root, unitDir);
    const jsBin = path.join(cwd, jsBinRel);
    const opts = { cwd, stdio: "ignore", timeout: 20000 };
    if (existsSync(jsBin)) {
      spawnSync(process.execPath, [jsBin, ...args], opts);
    } else {
      const q = (s) => (/\s/.test(s) ? `"${s}"` : s);
      spawnSync(["npx", ...npxArgs.map(q)].join(" "), { ...opts, shell: true });
    }
  };

  if (
    lower.startsWith("web/") &&
    [".ts", ".tsx", ".js", ".jsx", ".json", ".css"].includes(ext)
  ) {
    runFormatter(
      "web",
      "node_modules/@biomejs/biome/bin/biome",
      ["format", "--write", filePath],
      ["biome", "format", "--write", filePath],
    );
  } else if (lower.startsWith("backend/") && [".ts", ".json"].includes(ext)) {
    runFormatter(
      "backend",
      "node_modules/prettier/bin/prettier.cjs",
      ["--write", filePath],
      ["prettier", "--write", filePath],
    );
  }
  process.exit(0);
} catch {
  process.exit(0); // fail open
}

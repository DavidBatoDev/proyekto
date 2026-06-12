#!/usr/bin/env node

// v2 canary. The roadmap-AI agent now has a single brain (the v2 single-loop
// in agent/app/core/v2) with no feature-flag matrix, so this validates the v2
// loop plus the shared contract surface it depends on. Defaults only — no env
// overrides. Exits non-zero on any failure (CI gate).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFile), "..");
const agentDir = path.join(repoRoot, "agent");
const scriptDir = path.dirname(scriptFile);

loadEnvFiles();

const canaryModules = [
  "tests.test_v2_loop",
  "tests.test_v2_outcome",
  "tests.test_v2_brain",
  "tests.test_operation_contracts",
  "tests.test_tool_registry_schema_snapshot",
  "tests.test_edit_resolver",
  "tests.test_session_store_cas",
];

function loadEnvFiles() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, ".env"),
    path.join(scriptDir, ".env"),
    path.join(repoRoot, ".env"),
    path.join(repoRoot, "agent", ".env"),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const equalIndex = line.indexOf("=");
      if (equalIndex <= 0) continue;
      const key = line.slice(0, equalIndex).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = line.slice(equalIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function canRun(executable) {
  if (!executable) return false;
  if (executable.includes(path.sep)) return existsSync(executable);
  return true;
}

function pythonArgs(pyExecutable, modules) {
  if (path.basename(pyExecutable).toLowerCase() === "py") {
    return ["-3", "-m", "unittest", ...modules, "-v"];
  }
  return ["-m", "unittest", ...modules, "-v"];
}

function pickPython() {
  const candidates = [
    process.env.AGENT_PYTHON_BIN,
    path.join(agentDir, "venv", "Scripts", "python.exe"),
    path.join(agentDir, ".venv", "Scripts", "python.exe"),
    "python",
    "py",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!canRun(candidate)) continue;
    return candidate;
  }
  return null;
}

function main() {
  const py = pickPython();
  if (!py) {
    console.error("No Python interpreter found for canary validation.");
    process.exit(1);
  }

  console.log(`Using Python: ${py}`);
  console.log("\n=== v2-canary ===");
  const result = spawnSync(py, pythonArgs(py, canaryModules), {
    cwd: agentDir,
    env: process.env,
    stdio: "pipe",
    shell: false,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if ((result.status ?? 1) === 0) {
    console.log("\nv2 canary validation passed.");
    process.exit(0);
  }
  console.error("\nv2 canary validation failed.");
  process.exit(1);
}

main();

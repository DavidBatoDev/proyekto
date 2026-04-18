#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFile), "..");
const agentDir = path.join(repoRoot, "agent");
const scriptDir = path.dirname(scriptFile);

loadEnvFiles();

// The canary set intentionally skips a handful of behaviors whose tests
// were removed during the hybrid-ReAct and draft-graph refactors (commits
// 7e87090, d980b52, 670eb10, eacf2de). If you bring the guarded behavior
// back, re-add the corresponding test path.
const strictModules = [
  "tests.test_agent_safety.AgentSafetyTests.test_plan_message_react_loop_budget_exhaustion_sets_clarify_terminal",
  "tests.test_agent_safety.AgentSafetyTests.test_plan_message_retry_blocks_on_staged_version_mismatch",
  "tests.test_agent_safety.AgentSafetyTests.test_plan_message_retry_ambiguous_returns_numbered_id_choices",
  "tests.test_agent_safety.PlannerContextSafetyTests.test_plan_operations_react_invalid_shape_retries_once",
  "tests.test_agent_safety.PlannerContextSafetyTests.test_plan_operations_react_tuple_wrong_arity_retries_then_clarifies",
  "tests.test_draft_graph_versioning.DraftGraphVersioningContractTests.test_draft_graph_migration_preserves_legacy_staged_state",
  "tests.test_logging_utils.LoggingUtilsLifecycleTests.test_lifecycle_response_includes_react_terminal_and_loop_fields",
];

const compatModules = [
  "tests.test_agent_safety.AgentSafetyTests.test_plan_message_pending_context_without_continuation_does_not_force_edit",
  "tests.test_agent_safety.AgentSafetyTests.test_plan_message_hybrid_mode_ignores_replace_flag_without_revise",
  "tests.test_agent_safety.PlannerContextSafetyTests.test_plan_operations_react_execute_returns_operations",
  "tests.test_draft_graph_versioning.DraftGraphVersioningContractTests.test_agent_session_legacy_payload_deserializes_with_draft_defaults",
  "tests.test_draft_graph_versioning.DraftGraphVersioningContractTests.test_draft_graph_migration_preserves_legacy_staged_state",
  "tests.test_logging_utils.LoggingUtilsLifecycleTests.test_lifecycle_response_includes_react_terminal_and_loop_fields",
];

const strictEnv = {
  AGENT_HYBRID_REACT_ENABLED: "true",
  AGENT_DRAFT_GRAPH_ENABLED: "true",
  AGENT_STRICT_PREVIEW_FINGERPRINT: "true",
  AGENT_REACT_MAX_ATTEMPTS: "4",
  MAX_EDIT_TOOL_TURNS: "3",
};

const compatEnv = {
  AGENT_HYBRID_REACT_ENABLED: "true",
  AGENT_DRAFT_GRAPH_ENABLED: "false",
  AGENT_STRICT_PREVIEW_FINGERPRINT: "true",
  AGENT_REACT_MAX_ATTEMPTS: "2",
  MAX_EDIT_TOOL_TURNS: "4",
};

const classifierOffEnv = {
  AGENT_HYBRID_REACT_ENABLED: "true",
  AGENT_DRAFT_GRAPH_ENABLED: "true",
  AGENT_STRICT_PREVIEW_FINGERPRINT: "true",
  AGENT_LLM_INTENT_CLASSIFIER_ENABLED: "false",
};

const classifierOffModules = [
  "tests.test_planner_intent_classifier",
  "tests.test_planner_max_tokens_profile",
];

const planProposalEnv = {
  AGENT_HYBRID_REACT_ENABLED: "true",
  AGENT_DRAFT_GRAPH_ENABLED: "true",
  AGENT_STRICT_PREVIEW_FINGERPRINT: "true",
  AGENT_PLAN_PROPOSAL_ENABLED: "true",
};

const planProposalModules = [
  "tests.test_pending_plan_manager",
  "tests.test_plan_proposal_routing",
  "tests.test_plan_confirm_bridge",
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

function runProfile(pyExecutable, name, envOverrides, modules) {
  console.log(`\n=== ${name} ===`);
  for (const [key, value] of Object.entries(envOverrides)) {
    console.log(`${key}=${value}`);
  }

  const result = spawnSync(pyExecutable, pythonArgs(pyExecutable, modules), {
    cwd: agentDir,
    env: { ...process.env, ...envOverrides },
    stdio: "pipe",
    shell: false,
    encoding: "utf8",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const ok = (result.status ?? 1) === 0;
  console.log(`Profile ${name}: ${ok ? "PASS" : "FAIL"}\n`);
  return ok;
}

function main() {
  const py = pickPython();
  if (!py) {
    console.error("No Python interpreter found for canary validation.");
    process.exit(1);
  }

  console.log(`Using Python: ${py}`);
  const strictOk = runProfile(py, "strict-canary", strictEnv, strictModules);
  const compatOk = runProfile(py, "react-compat", compatEnv, compatModules);
  const classifierOffOk = runProfile(
    py,
    "llm-classifier-off",
    classifierOffEnv,
    classifierOffModules,
  );
  const planProposalOk = runProfile(
    py,
    "plan-proposal",
    planProposalEnv,
    planProposalModules,
  );

  if (strictOk && compatOk && classifierOffOk && planProposalOk) {
    console.log(
      "Canary matrix validation passed for strict, react-compat, llm-classifier-off, and plan-proposal profiles.",
    );
    process.exit(0);
  }

  console.error("Canary matrix validation failed.");
  process.exit(1);
}

main();

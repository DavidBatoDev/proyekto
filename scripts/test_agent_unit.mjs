#!/usr/bin/env node

import { existsSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFile), '..');
const agentDir = path.join(repoRoot, 'agent');
const scriptDir = path.dirname(scriptFile);

loadEnvFiles();

const defaultTests = [
  'tests.test_v2_loop',
  'tests.test_v2_outcome',
  'tests.test_v2_brain',
  'tests.test_operation_contracts',
  'tests.test_edit_resolver',
  'tests.test_session_store_cas',
];

const pythonCandidates = [
  process.env.AGENT_PYTHON_BIN,
  path.join(agentDir, 'venv', 'Scripts', 'python.exe'),
  path.join(agentDir, '.venv', 'Scripts', 'python.exe'),
  'python',
  'py',
].filter(Boolean);

function runCommand(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    stdio: 'pipe',
    shell: false,
    env: process.env,
    encoding: 'utf8',
  });
}

function isRecoverablePythonResolutionFailure(result) {
  const stderr = String(result?.stderr || '').toLowerCase();
  const stdout = String(result?.stdout || '').toLowerCase();
  const combined = `${stdout}\n${stderr}`;
  return (
    combined.includes('no python at') ||
    combined.includes('could not find') ||
    combined.includes('is not recognized as an internal or external command')
  );
}

function canRun(executable) {
  if (!executable) return false;
  if (executable.includes(path.sep)) return existsSync(executable);
  return true;
}

function buildArgs(pyExecutable, testModules) {
  if (path.basename(pyExecutable).toLowerCase() === 'py') {
    return ['-3', '-m', 'unittest', ...testModules, '-v'];
  }
  return ['-m', 'unittest', ...testModules, '-v'];
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/test_agent_unit.mjs [unittest_module ...]');
    console.log('Defaults: tests.test_v2_loop tests.test_v2_outcome tests.test_v2_brain ...');
    process.exit(0);
  }
  const testModules = args;
  const modules = testModules.length > 0 ? testModules : defaultTests;

  for (const py of pythonCandidates) {
    if (!canRun(py)) continue;
    const args = buildArgs(py, modules);
    const result = runCommand(py, args, agentDir);
    if (result.error) {
      continue;
    }
    if ((result.status ?? 1) !== 0 && isRecoverablePythonResolutionFailure(result)) {
      continue;
    }
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  console.error('Unable to run Python tests. Tried:');
  for (const py of pythonCandidates) {
    console.error(`- ${py}`);
  }
  console.error(
    'Set AGENT_PYTHON_BIN to a valid Python executable, for example: AGENT_PYTHON_BIN=agent\\\\venv\\\\Scripts\\\\python.exe',
  );
  process.exit(1);
}

main();

function loadEnvFiles() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, '.env'),
    path.join(scriptDir, '.env'),
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'agent', '.env'),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const equalIndex = line.indexOf('=');
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

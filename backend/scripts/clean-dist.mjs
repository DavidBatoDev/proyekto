import { readdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(scriptDir, '..');
const distPath = resolve(backendDir, 'dist');
const stalePrefix = 'dist.__stale__';

function clearReadOnly(targetPath) {
  if (process.platform !== 'win32') {
    return;
  }

  const result = spawnSync('attrib', ['-R', targetPath, '/S', '/D'], {
    stdio: 'ignore',
    shell: true,
  });

  if (result.error && result.error.code !== 'ENOENT') {
    throw result.error;
  }
}

function scheduleDelete(targetPath) {
  const cleanupScript = `
    const { rmSync } = require('node:fs');
    const { spawnSync } = require('node:child_process');
    const targetPath = process.argv[1];
    if (process.platform === 'win32') {
      spawnSync('attrib', ['-R', targetPath, '/S', '/D'], { stdio: 'ignore', shell: true });
    }
    try {
      rmSync(targetPath, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch {}
  `;

  const child = spawn(process.execPath, ['-e', cleanupScript, targetPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

/**
 * Best-effort: name the node processes most likely holding `dist` open.
 *
 * Windows refuses to rename a directory while any handle beneath it is open,
 * and the usual cause is a backend dev server still running `dist/main` — often
 * one the developer forgot about, or one orphaned because a parent was killed
 * without its `nest start --watch` child. A bare EPERM stack conveys none of
 * that, which sends people looking at file permissions instead.
 */
function findDistHolders() {
  if (process.platform !== 'win32') {
    return [];
  }

  const command = [
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`,
    `Where-Object { $_.CommandLine -match 'dist.main|nest.js start' }`,
    `ForEach-Object { "$($_.ProcessId)" }`,
  ].join(' | ');

  const result = spawnSync('powershell', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
  });

  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function reportLockedDist() {
  const holders = findDistHolders();
  const lines = [
    '',
    `Could not clear ${distPath} — it is locked by a running process.`,
    '',
    'A backend dev server is almost certainly still running; two of them',
    'cannot share dist/. Stop it and run this again.',
  ];

  if (holders.length > 0) {
    const plural = holders.length > 1 ? 's' : '';
    lines.push(
      '',
      `Likely culprit${plural} (node PID${plural}): ${holders.join(', ')}`,
      `Stop with:  taskkill /PID ${holders.join(' /PID ')} /F`,
    );
  } else {
    lines.push(
      '',
      'No obvious culprit found. Check for a stray node process, or an editor',
      'or antivirus holding a file under dist/.',
    );
  }

  lines.push('');
  console.error(lines.join('\n'));
}

if (process.platform === 'win32') {
  clearReadOnly(distPath);
}

try {
  const stalePath = resolve(
    backendDir,
    `${stalePrefix}${Date.now()}-${process.pid}`,
  );

  await rename(distPath, stalePath);
  scheduleDelete(stalePath);
} catch (error) {
  if (error?.code === 'ENOENT') {
    // Nothing to clean: first run, or already removed.
  } else if (error?.code === 'EPERM' || error?.code === 'EBUSY') {
    // Deliberately still a failure. Building over a dist another process is
    // serving would produce a half-updated bundle and a confusing debug
    // session; better to stop here with an explanation.
    reportLockedDist();
    process.exit(1);
  } else {
    throw error;
  }
}

for (const entry of await readdir(backendDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith(stalePrefix)) {
    continue;
  }

  scheduleDelete(resolve(backendDir, entry.name));
}

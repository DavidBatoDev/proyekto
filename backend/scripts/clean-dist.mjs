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
  if (error?.code !== 'ENOENT') {
    throw error;
  }
}

for (const entry of await readdir(backendDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith(stalePrefix)) {
    continue;
  }

  scheduleDelete(resolve(backendDir, entry.name));
}

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const env = { ...process.env, NODE_ENV: 'development' };
const debug = process.argv.includes('--debug');
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('Run this wrapper through npm run dev or npm run start:debug.');
}

for (const script of ['clean:dist', 'build:mcp-apps']) {
  const result = spawnSync(process.execPath, [npmCli, 'run', script], {
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const nestCli = fileURLToPath(
  new URL('../node_modules/@nestjs/cli/bin/nest.js', import.meta.url),
);
const child = spawn(
  process.execPath,
  [
    nestCli,
    'start',
    ...(debug ? ['--debug'] : []),
    '--watch',
    '--builder',
    'swc',
    '--type-check',
  ],
  { env, stdio: 'inherit' },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', (error) => {
  throw error;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});

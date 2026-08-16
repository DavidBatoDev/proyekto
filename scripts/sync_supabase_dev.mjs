import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROD_REF = "byvbnkpiselvvulsvxgo";
export const DEV_REF = "vyiedlwasdwmjbztqznl";
export const MIRROR_CONFIRMATION = `--confirm-dev-ref=${DEV_REF}`;
export const MAX_MIRROR_PASSES = 3;
export const DEFAULT_POSTGRES_IMAGE =
  "public.ecr.aws/supabase/postgres:17.6.1.054";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "..");

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    resolve(
      dirname(process.execPath),
      "../lib/node_modules/npm/bin/npm-cli.js",
    ),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

const npmCli = resolveNpmCli();

export function parseArgs(argv) {
  const mode = argv.find((argument) => !argument.startsWith("--")) ?? "check";
  if (!["check", "apply", "mirror"].includes(mode)) {
    throw new Error(`Unknown mode "${mode}". Use check, apply, or mirror.`);
  }
  return {
    mode,
    confirmation: argv.find((argument) =>
      argument.startsWith("--confirm-dev-ref="),
    ),
  };
}

export function assertMutableDevRef(projectRef) {
  if (projectRef === PROD_REF) {
    throw new Error("Refusing to mutate the production Supabase project.");
  }
  if (projectRef !== DEV_REF) {
    throw new Error(`Refusing unknown Supabase project ref "${projectRef}".`);
  }
}

export function assertMirrorConfirmation(confirmation) {
  if (confirmation !== MIRROR_CONFIRMATION) {
    throw new Error(
      `Mirroring can erase development data. Re-run with ${MIRROR_CONFIRMATION}.`,
    );
  }
}

export function redactArgs(args) {
  const redacted = [...args];
  const secretFlags = new Set(["--password", "--from", "--to", "--db-url"]);
  for (let index = 0; index < redacted.length; index += 1) {
    if (secretFlags.has(redacted[index]) && index + 1 < redacted.length) {
      redacted[index + 1] = "<redacted>";
      index += 1;
    } else if (/^PGPASSWORD=/i.test(redacted[index])) {
      redacted[index] = "PGPASSWORD=<redacted>";
    }
  }
  return redacted;
}

export function runProcess(command, args, options = {}) {
  if (options.log !== false) {
    console.log(`> ${command} ${redactArgs(args).join(" ")}`);
  }

  const capture = options.capture === true;
  const hasInput = options.input !== undefined;
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: 20 * 1024 * 1024,
    stdio: capture
      ? "pipe"
      : hasInput
        ? ["pipe", "inherit", "inherit"]
        : "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed with exit code ${result.status ?? "unknown"}: ` +
        `${command} ${redactArgs(args).join(" ")}`,
    );
  }
  return capture ? result.stdout : "";
}

export function supabaseArgs(args) {
  return ["exec", "--yes", "--", "supabase", ...args];
}

function runSupabase(args, options = {}) {
  if (npmCli) {
    return runProcess(
      process.execPath,
      [npmCli, ...supabaseArgs(args)],
      options,
    );
  }
  return runProcess("npx", ["--yes", "supabase", ...args], options);
}

export function loadEnvFile(filePath, target = process.env) {
  if (!existsSync(filePath)) return target;

  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || target[match[1]] !== undefined) continue;

    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    target[match[1]] = value;
  }
  return target;
}

function requireCredential(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in the process environment or scripts/.env.`,
    );
  }
  return value;
}

function credentials() {
  loadEnvFile(join(repoRoot, "scripts", ".env"));
  return {
    accessToken: requireCredential("SUPABASE_ACCESS_TOKEN"),
    prodPassword: requireCredential("SUPABASE_PROD_DB_PASSWORD"),
    devPassword: requireCredential("SUPABASE_DEV_DB_PASSWORD"),
  };
}

export function normalizeSchemaDump(sql) {
  return sql
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^-- (Dumped from|Dumped by|Started on|Completed on)/.test(line) &&
        !/^\\(un)?restrict\b/.test(line),
    )
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hasMeaningfulSql(sql) {
  return sql
    .split(/\r?\n/)
    .some((line) => line.trim() && !line.trimStart().startsWith("--"));
}

export function assertSafeMirrorSql(sql) {
  const forbidden = [
    /^(?:DROP|CREATE|ALTER)\s+DATABASE\b/im,
    /^(?:DROP|CREATE|ALTER)\s+ROLE\b/im,
    /^DROP\s+SCHEMA\b/im,
    /^(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/im,
    /^(?:DROP|CREATE|ALTER|COMMENT|GRANT|REVOKE).*\b(?:auth|storage|supabase_migrations)\./im,
  ];
  if (forbidden.some((pattern) => pattern.test(sql))) {
    throw new Error(
      "Refusing generated SQL that mutates data, managed schemas, roles, or databases.",
    );
  }
}

export function buildConnectionUrl(pooler, password) {
  const database = pooler.db_name || "postgres";
  return `postgresql://${pooler.db_user}:${encodeURIComponent(password)}@${pooler.db_host}:5432/${database}`;
}

async function fetchPrimaryPooler(projectRef, accessToken) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/config/database/pooler`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Unable to read pooler configuration for ${projectRef}: HTTP ${response.status}.`,
    );
  }

  const payload = await response.json();
  const poolers = Array.isArray(payload) ? payload : [payload];
  const primary = poolers.find(
    (pooler) => pooler.database_type === "PRIMARY" || !pooler.database_type,
  );
  if (!primary?.db_host || !primary?.db_user) {
    throw new Error(
      `Primary pooler configuration is missing for ${projectRef}.`,
    );
  }
  return primary;
}

function dumpPublicSchema(projectRef, password, filePath) {
  runSupabase(
    [
      "db",
      "dump",
      "--project-ref",
      projectRef,
      "--password",
      password,
      "--schema",
      "public",
      "--file",
      filePath,
    ],
    { capture: true },
  );
  return normalizeSchemaDump(readFileSync(filePath, "utf8"));
}

function dumpDevData(password, filePath) {
  runSupabase(
    [
      "db",
      "dump",
      "--project-ref",
      DEV_REF,
      "--password",
      password,
      "--schema",
      "public",
      "--data-only",
      "--use-copy",
      "--file",
      filePath,
    ],
    { capture: true },
  );
}

function generateSchemaDiff(values, poolers, filePath) {
  runSupabase(
    [
      "db",
      "diff",
      "--from",
      buildConnectionUrl(poolers.dev, values.devPassword),
      "--to",
      buildConnectionUrl(poolers.prod, values.prodPassword),
      "--schema",
      "public",
      "--use-pg-delta",
      "--output",
      filePath,
    ],
    { capture: true },
  );
  return readFileSync(filePath, "utf8");
}

function applySchemaDiff(sql, values, devPooler) {
  assertMutableDevRef(DEV_REF);
  assertSafeMirrorSql(sql);
  const image =
    process.env.SUPABASE_POSTGRES_IMAGE?.trim() || DEFAULT_POSTGRES_IMAGE;
  runProcess(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "-e",
      "PGPASSWORD",
      image,
      "psql",
      "-h",
      devPooler.db_host,
      "-p",
      "5432",
      "-U",
      devPooler.db_user,
      "-d",
      devPooler.db_name || "postgres",
      "--single-transaction",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      env: { ...process.env, PGPASSWORD: values.devPassword },
      input: sql,
    },
  );
}

function removeGeneratedTemp(directory) {
  const resolvedDirectory = resolve(directory);
  const resolvedTemp = resolve(tmpdir()) + sep;
  if (!resolvedDirectory.startsWith(resolvedTemp)) {
    throw new Error(`Refusing to remove non-temporary path: ${directory}`);
  }
  rmSync(resolvedDirectory, { recursive: true, force: true });
}

async function verifyParity(values) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "proyekto-supabase-check-"),
  );
  try {
    const prodSchema = dumpPublicSchema(
      PROD_REF,
      values.prodPassword,
      join(temporaryDirectory, "prod-public.sql"),
    );
    const devSchema = dumpPublicSchema(
      DEV_REF,
      values.devPassword,
      join(temporaryDirectory, "dev-public.sql"),
    );
    if (prodSchema !== devSchema) {
      throw new Error(
        `Development public schema differs from production. Run mirror with ${MIRROR_CONFIRMATION}.`,
      );
    }
    console.log("Supabase parity verified: normalized public schemas match.");
  } finally {
    removeGeneratedTemp(temporaryDirectory);
  }
}

function applyMigrationsToDev(values) {
  assertMutableDevRef(DEV_REF);
  const args = [
    "db",
    "push",
    "--project-ref",
    DEV_REF,
    "--password",
    values.devPassword,
    "--include-all",
    "--include-seed",
  ];
  runSupabase([...args, "--dry-run"]);
  runSupabase([...args, "--yes"]);
  console.log("Repository migrations and safe seed applied to hosted dev.");
}

async function mirrorDev(values, confirmation) {
  assertMirrorConfirmation(confirmation);
  assertMutableDevRef(DEV_REF);
  runProcess("docker", ["info"], { capture: true, log: false });

  const poolers = {
    prod: await fetchPrimaryPooler(PROD_REF, values.accessToken),
    dev: await fetchPrimaryPooler(DEV_REF, values.accessToken),
  };
  const backupDirectory = mkdtempSync(
    join(tmpdir(), "proyekto-supabase-mirror-"),
  );
  const prodSchema = dumpPublicSchema(
    PROD_REF,
    values.prodPassword,
    join(backupDirectory, "prod-public.sql"),
  );
  let devSchema = dumpPublicSchema(
    DEV_REF,
    values.devPassword,
    join(backupDirectory, "dev-public-before-mirror.sql"),
  );

  if (prodSchema === devSchema) {
    removeGeneratedTemp(backupDirectory);
    console.log(
      "Supabase parity already satisfied; no development changes made.",
    );
    return;
  }

  dumpDevData(
    values.devPassword,
    join(backupDirectory, "dev-public-data-before-mirror.sql"),
  );

  for (let pass = 1; pass <= MAX_MIRROR_PASSES; pass += 1) {
    const diffPath = join(backupDirectory, `dev-to-prod-pass-${pass}.sql`);
    const sql = generateSchemaDiff(values, poolers, diffPath);
    if (!hasMeaningfulSql(sql)) {
      throw new Error(
        `Schema dumps differ but the diff engine returned no SQL. Backup: ${backupDirectory}`,
      );
    }

    console.log(`Applying guarded dev schema mirror pass ${pass}.`);
    applySchemaDiff(sql, values, poolers.dev);
    devSchema = dumpPublicSchema(
      DEV_REF,
      values.devPassword,
      join(backupDirectory, `dev-public-after-pass-${pass}.sql`),
    );
    if (prodSchema === devSchema) {
      console.log(
        `Supabase dev mirror verified after ${pass} pass(es). Backup: ${backupDirectory}`,
      );
      return;
    }
  }

  throw new Error(
    `Development still differs after ${MAX_MIRROR_PASSES} passes. Backup: ${backupDirectory}`,
  );
}

export async function main(argv = process.argv.slice(2)) {
  const { mode, confirmation } = parseArgs(argv);
  const values = credentials();
  if (mode === "check") return verifyParity(values);
  if (mode === "apply") return applyMigrationsToDev(values);
  return mirrorDev(values, confirmation);
}

const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(`Supabase dev sync failed: ${error.message}`);
    process.exitCode = 1;
  });
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEV_REF,
  MIRROR_CONFIRMATION,
  PROD_REF,
  assertMirrorConfirmation,
  assertMutableDevRef,
  assertSafeMirrorSql,
  buildConnectionUrl,
  hasMeaningfulSql,
  normalizeSchemaDump,
  parseArgs,
  redactArgs,
  runProcess,
  supabaseArgs,
} from "./sync_supabase_dev.mjs";

test("check is the default and supported modes parse", () => {
  assert.deepEqual(parseArgs([]), { mode: "check", confirmation: undefined });
  assert.equal(parseArgs(["apply"]).mode, "apply");
  assert.equal(parseArgs(["mirror"]).mode, "mirror");
  assert.equal(
    parseArgs(["mirror", MIRROR_CONFIRMATION]).confirmation,
    MIRROR_CONFIRMATION,
  );
  assert.throws(() => parseArgs(["reset"]), /Unknown mode/);
});

test("mutation guard accepts only the development project", () => {
  assert.doesNotThrow(() => assertMutableDevRef(DEV_REF));
  assert.throws(() => assertMutableDevRef(PROD_REF), /production/);
  assert.throws(() => assertMutableDevRef("unknown"), /unknown/);
});

test("mirror requires the exact development ref confirmation", () => {
  assert.doesNotThrow(() => assertMirrorConfirmation(MIRROR_CONFIRMATION));
  assert.throws(() => assertMirrorConfirmation(undefined), /erase/);
  assert.throws(
    () => assertMirrorConfirmation(`--confirm-dev-ref=${PROD_REF}`),
    /erase/,
  );
});

test("passwords and connection URLs are redacted from logs", () => {
  assert.deepEqual(
    redactArgs([
      "db",
      "diff",
      "--from",
      "postgresql://dev:secret@example.test/db",
      "--to",
      "postgresql://prod:secret@example.test/db",
      "--password",
      "secret",
    ]),
    [
      "db",
      "diff",
      "--from",
      "<redacted>",
      "--to",
      "<redacted>",
      "--password",
      "<redacted>",
    ],
  );
  assert.deepEqual(supabaseArgs(["projects", "list"]), [
    "exec",
    "--yes",
    "--",
    "supabase",
    "projects",
    "list",
  ]);
});

test("connection URL percent-encodes database passwords", () => {
  const url = buildConnectionUrl(
    { db_user: "postgres.dev", db_host: "pooler.test", db_name: "postgres" },
    "p%ss@word",
  );
  assert.equal(
    url,
    "postgresql://postgres.dev:p%25ss%40word@pooler.test:5432/postgres",
  );
});

test("schema dump normalization removes nondeterministic headers", () => {
  const first = `-- Dumped from database version 15\n\\restrict abc\nCREATE TABLE x ();\n`;
  const second = `-- Dumped by pg_dump version 17\n\\restrict xyz\nCREATE TABLE x ();\n\\unrestrict xyz\n`;
  assert.equal(normalizeSchemaDump(first), normalizeSchemaDump(second));
});

test("meaningful SQL detection ignores comments and blank lines", () => {
  assert.equal(hasMeaningfulSql("-- generated\n\n"), false);
  assert.equal(hasMeaningfulSql("-- generated\nALTER TABLE public.x;\n"), true);
});

test("mirror SQL guard blocks data and managed-schema mutations", () => {
  assert.doesNotThrow(() =>
    assertSafeMirrorSql(`
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid LANGUAGE sql AS $$ SELECT auth.uid() $$;
ALTER TABLE public.projects ADD COLUMN label text;
`),
  );
  assert.throws(
    () => assertSafeMirrorSql("DELETE FROM public.projects;"),
    /Refusing generated SQL/,
  );
  assert.throws(
    () => assertSafeMirrorSql("ALTER TABLE auth.users ADD COLUMN unsafe text;"),
    /Refusing generated SQL/,
  );
  assert.throws(
    () => assertSafeMirrorSql("DROP DATABASE postgres;"),
    /Refusing generated SQL/,
  );
});

test("nonzero child exits become failures without exposing arguments", () => {
  let failure;
  try {
    runProcess(
      process.execPath,
      ["-e", "process.exit(7)", "--", "--password", "do-not-print-me"],
      { capture: true, log: false },
    );
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /exit code 7/);
  assert.doesNotMatch(failure.message, /do-not-print-me/);
});

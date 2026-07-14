import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

loadEnvFile(resolve("backend/.env"));
loadEnvFile(resolve(".env"));

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to validate roadmap templates.");
  process.exit(1);
}

const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/validate_builtin_roadmap_templates`, {
  method: "POST",
  headers: {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  },
  body: "{}",
});

if (!response.ok) {
  console.error(`Template validation RPC failed (${response.status}): ${await response.text()}`);
  process.exit(1);
}

const result = await response.json();
if (!result?.valid) {
  console.error("Built-in roadmap template validation failed:");
  for (const issue of result?.issues ?? ["Unknown validation error"]) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Roadmap template validation passed: 20 categories and 20 built-ins with valid schedules and hierarchy.");

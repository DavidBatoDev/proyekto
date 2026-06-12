/**
 * Dev helper: delete one agent session from Upstash Redis to simulate TTL
 * expiry deterministically (used to live-verify the durable agent-state
 * snapshot restore path).
 *
 *   node scripts/flush_agent_session.mjs <session/thread uuid>
 *
 * Credentials are read from agent/.env (UPSTASH_REDIS_REST_URL/TOKEN,
 * REDIS_SESSION_KEY_PREFIX). Never prints secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("usage: node scripts/flush_agent_session.mjs <session-id>");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envText = fs.readFileSync(path.join(root, "agent", ".env"), "utf8");

function envValue(name) {
  const match = envText.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!match) return undefined;
  return match[1].trim().replace(/^"|"$/g, "");
}

const url = envValue("UPSTASH_REDIS_REST_URL");
const token = envValue("UPSTASH_REDIS_REST_TOKEN");
const prefix = envValue("REDIS_SESSION_KEY_PREFIX") || "roadmap:ai:session";
if (!url || !token) {
  console.error("Upstash credentials not found in agent/.env");
  process.exit(1);
}

const keys = [`${prefix}:${sessionId}`, `${prefix}:${sessionId}:v`];
const response = await fetch(`${url}/pipeline`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(keys.map((key) => ["DEL", key])),
});
const result = await response.json();
console.log(
  `flushed session ${sessionId}:`,
  keys.map((key, index) => `${key} -> ${JSON.stringify(result?.[index] ?? result)}`).join(", "),
);

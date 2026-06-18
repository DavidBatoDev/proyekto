import {
	type JSONWebKeySet,
	type JWTVerifyGetKey,
	createLocalJWKSet,
	decodeProtectedHeader,
	jwtVerify,
} from "jose";
import { type Env, parseRoomKey } from "./types";
import { RealtimeRoom } from "./room";

export { RealtimeRoom };

/**
 * Worker entry. Three routes:
 *   GET  /health           liveness probe
 *   GET  /ws?room=<key>&token=<jwt>   client WebSocket upgrade (auth + authz)
 *   POST /publish          backend fan-out (shared-secret auth)
 *
 * The Worker is the gatekeeper: it verifies the Supabase JWT and confirms room
 * access with the backend, then hands the socket to the per-room Durable
 * Object. The DO never sees an unauthenticated/unauthorized connection.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return new Response("ok", { status: 200 });
      }

      if (url.pathname === "/ws") {
        return await handleWebSocketUpgrade(request, env, url);
      }

      if (url.pathname === "/publish" && request.method === "POST") {
        return await handlePublish(request, env);
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error(
        `[worker] uncaught ${(err as Error).name}: ${(err as Error).message}\n${
          (err as Error).stack ?? ""
        }`,
      );
      return new Response("Internal error", { status: 500 });
    }
  },
};

async function handleWebSocketUpgrade(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected websocket", { status: 426 });
  }

  if (!isAllowedOrigin(request, env)) {
    return new Response("Origin not allowed", { status: 403 });
  }

  const roomKey = url.searchParams.get("room") ?? "";
  const parsed = parseRoomKey(roomKey);
  if (!parsed) {
    return new Response("Invalid room", { status: 400 });
  }

  const token = url.searchParams.get("token") ?? "";
  const userId = await verifyToken(token, env);
  if (!userId) {
    console.warn(`[ws] room=${roomKey} verify=fail (no/invalid token)`);
    return new Response("Unauthorized", { status: 401 });
  }

  // user:{id} rooms are self-scoped — no backend round-trip needed.
  if (parsed.type === "user") {
    if (parsed.id !== userId) {
      return new Response("Forbidden", { status: 403 });
    }
  } else {
    const allowed = await authorizeWithBackend(roomKey, token, env);
    if (!allowed) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  const id = env.ROOMS.idFromName(roomKey);
  const stub = env.ROOMS.get(id);

  // Forward the upgrade to the DO, carrying the verified identity + room type
  // so the DO can trust them without re-verifying.
  const doRequest = new Request(request.url, request);
  doRequest.headers.set("x-user-id", userId);
  doRequest.headers.set("x-room-type", parsed.type);
  return stub.fetch(doRequest);
}

async function handlePublish(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get("x-realtime-token");
  if (!token || token !== env.REALTIME_PUBLISH_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { room?: string; event?: string; payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const parsed = body.room ? parseRoomKey(body.room) : null;
  if (!parsed || !body.event) {
    return new Response("Missing room or event", { status: 400 });
  }

  const id = env.ROOMS.idFromName(body.room as string);
  const stub = env.ROOMS.get(id);
  const doRequest = new Request("https://do/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: body.event, payload: body.payload ?? {} }),
  });
  return stub.fetch(doRequest);
}

// Cache the *fetched JWKS JSON* (plain data, safe to reuse across requests) and
// build a LOCAL key set per call. A createRemoteJWKSet instance must NOT be
// cached at module scope on Workers — it captures the first request's I/O
// context and throws ("internal error") when a later request reuses it.
let jwksJson: JSONWebKeySet | null = null;
let jwksFetchedAt = 0;
const JWKS_TTL_MS = 600_000; // 10 min

async function getKeySet(env: Env): Promise<JWTVerifyGetKey | null> {
  if (!env.SUPABASE_URL) return null;
  const now = Date.now();
  if (!jwksJson || now - jwksFetchedAt > JWKS_TTL_MS) {
    const base = env.SUPABASE_URL.replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/auth/v1/.well-known/jwks.json`);
      if (res.ok) {
        jwksJson = (await res.json()) as JSONWebKeySet;
        jwksFetchedAt = now;
      }
    } catch {
      // keep any previously cached keys
    }
  }
  return jwksJson ? createLocalJWKSet(jwksJson) : null;
}

/**
 * Verify a Supabase access token and return the user id, or null.
 *
 * Modern Supabase projects sign with asymmetric keys (ES256) — verified via the
 * project's JWKS. Older projects use the symmetric HS256 secret. We pick the
 * path from the token's `alg` header so either scheme works.
 */
async function verifyToken(token: string, env: Env): Promise<string | null> {
  if (!token) return null;
  try {
    const { alg } = decodeProtectedHeader(token);

    let payload: { sub?: unknown };
    if (alg === "HS256") {
      if (!env.SUPABASE_JWT_SECRET) return null;
      ({ payload } = await jwtVerify(
        token,
        new TextEncoder().encode(env.SUPABASE_JWT_SECRET),
        { algorithms: ["HS256"] },
      ));
    } else {
      const keys = await getKeySet(env);
      if (!keys) return null;
      ({ payload } = await jwtVerify(token, keys));
    }

    const sub = payload.sub;
    return typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

/** Ask the backend whether this user may join this room (reuses NestJS authz). */
async function authorizeWithBackend(
  roomKey: string,
  token: string,
  env: Env,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const startedAt = Date.now();
  try {
    const res = await fetch(env.BACKEND_AUTHORIZE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ room: roomKey }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[authorize] room=${roomKey} status=${res.status} ms=${
          Date.now() - startedAt
        } body=${body.slice(0, 200)}`,
      );
    }
    return res.ok;
  } catch (err) {
    console.warn(
      `[authorize] room=${roomKey} ERROR ms=${Date.now() - startedAt} ${
        (err as Error).name
      }: ${(err as Error).message}`,
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function isAllowedOrigin(request: Request, env: Env): boolean {
  const allow = env.ALLOWED_ORIGINS?.trim();
  if (!allow || allow === "*") return true;
  const origin = request.headers.get("Origin");
  // Non-browser clients (no Origin header) are allowed; the JWT still gates them.
  if (!origin) return true;
  return allow
    .split(",")
    .map((o) => o.trim())
    .includes(origin);
}

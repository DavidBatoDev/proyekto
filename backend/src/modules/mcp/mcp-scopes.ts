/**
 * OAuth-style coarse scopes carried on a Proyekto Personal Access Token (PAT).
 *
 * A scope is a NECESSARY-but-not-sufficient grant: every MCP tool additionally
 * re-checks the live Proyekto project/roadmap permission on each call (see the
 * per-tool authz gates). A read-only PAT carries only `*:read` scopes; write
 * scopes are introduced in Phase 2. Least-privilege is the default — issuance
 * rejects unknown scope strings.
 */

export const MCP_READ_SCOPES = [
  'projects:read',
  'roadmaps:read',
  'knowledge:read',
  'chat:read',
] as const;

// Phase 2/3 will add: 'roadmaps:write', 'tasks:write', 'tasks:assign',
// 'memories:write', 'chat:write'. Kept out of the known set until implemented so
// a token can't be minted with a scope no tool honors.
export const MCP_ALL_SCOPES = [...MCP_READ_SCOPES] as const;

export type McpScope = (typeof MCP_ALL_SCOPES)[number];

export function isKnownScope(scope: string): scope is McpScope {
  return (MCP_ALL_SCOPES as readonly string[]).includes(scope);
}

/**
 * Normalize + validate a requested scope list at token-issuance time. Throws a
 * plain Error (mapped to 400 by the controller) on any unknown scope. De-dupes
 * and preserves a stable order.
 */
export function sanitizeScopes(requested: readonly string[]): McpScope[] {
  const seen = new Set<string>();
  const out: McpScope[] = [];
  for (const raw of requested) {
    const scope = String(raw).trim();
    if (!scope || seen.has(scope)) continue;
    if (!isKnownScope(scope)) {
      throw new Error(
        `Unknown MCP scope "${scope}". Allowed: ${MCP_ALL_SCOPES.join(', ')}`,
      );
    }
    seen.add(scope);
    out.push(scope);
  }
  return out;
}

export function hasScope(
  granted: readonly string[] | undefined,
  needed: McpScope,
): boolean {
  return !!granted && granted.includes(needed);
}

-- Personal Access Tokens (PATs) for the first-party Proyekto MCP server.
--
-- An MCP host (Claude Code, Codex, …) authenticates to the /mcp endpoint with a
-- bearer token of the form `pk_<random>`. We NEVER store the raw token — only
-- its sha256 hash (token_hash, looked up on every request) plus a short prefix
-- for display. Scopes are OAuth-style coarse grants (`roadmaps:read`, …); the
-- backend additionally re-checks the live Proyekto project/roadmap permission on
-- every tool call, so a scope alone never authorizes access.
--
-- Writes go exclusively through the service-role backend (McpTokenService):
-- issuance needs the raw token to hash it, and last_used_at / revoked_at bumps
-- are server-side. RLS therefore grants owners read + delete (revoke) only; no
-- INSERT/UPDATE path exists for the `authenticated` role.

CREATE TABLE IF NOT EXISTS public.mcp_personal_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL,
  token_prefix text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_personal_access_tokens_token_hash_key UNIQUE (token_hash)
);

-- Hot path: the auth guard resolves a presented token by its sha256 hash.
CREATE INDEX IF NOT EXISTS idx_mcp_pat_token_hash
  ON public.mcp_personal_access_tokens(token_hash);

-- Listing / owner queries.
CREATE INDEX IF NOT EXISTS idx_mcp_pat_user_id
  ON public.mcp_personal_access_tokens(user_id);

ALTER TABLE public.mcp_personal_access_tokens ENABLE ROW LEVEL SECURITY;

-- Owners can see the metadata of their own tokens (never the hash in practice —
-- the backend only ever selects non-secret columns for listing).
DROP POLICY IF EXISTS "Users can view their own MCP tokens"
ON public.mcp_personal_access_tokens;
CREATE POLICY "Users can view their own MCP tokens"
ON public.mcp_personal_access_tokens
FOR SELECT
USING (auth.uid() = user_id);

-- Owners can revoke (delete) their own tokens directly if desired. Issuance and
-- server-side bookkeeping (last_used_at) go through the service-role backend, so
-- there is deliberately no authenticated INSERT/UPDATE policy.
DROP POLICY IF EXISTS "Users can delete their own MCP tokens"
ON public.mcp_personal_access_tokens;
CREATE POLICY "Users can delete their own MCP tokens"
ON public.mcp_personal_access_tokens
FOR DELETE
USING (auth.uid() = user_id);

-- The backend service-role client bypasses RLS, but keep an explicit manage
-- policy for parity with the rest of the schema.
DROP POLICY IF EXISTS "Service role manages MCP tokens"
ON public.mcp_personal_access_tokens;
CREATE POLICY "Service role manages MCP tokens"
ON public.mcp_personal_access_tokens
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

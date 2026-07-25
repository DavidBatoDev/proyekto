-- OAuth 2.1 authorization-server storage for the first-party Proyekto MCP server
-- (Phase 3). Phases 1-2 authenticate MCP hosts with Personal Access Tokens
-- (mcp_personal_access_tokens); PATs work for hosts that read a config file but
-- the hosted Claude surfaces (claude.ai web, Desktop, mobile, Cowork) can only
-- connect over OAuth. These two tables back that flow.
--
-- Deliberately NOT stored here:
--   * authorization codes + PKCE challenges + pending authorize requests -> Redis
--     (60s / 10m TTLs; single-use, redeemed atomically with GETDEL)
--   * access tokens -> stateless HS256 JWTs, audience-bound to the MCP resource
--     and verified in-process by McpAuthGuard (no DB round-trip on the hot path)
--
-- Refresh tokens are sha256-HASHED, never encrypted: we only ever need equality
-- on presentation, exactly like the PAT table. (The AES-GCM helper used for
-- Google refresh tokens silently stores plaintext when its key is absent or
-- mis-sized -- an unacceptable failure mode for a Proyekto-issued credential
-- that can carry write scopes.)

-- ---------------------------------------------------------------------------
-- Clients registered through RFC 7591 Dynamic Client Registration.
-- ---------------------------------------------------------------------------
-- Only the DCR path needs a row. Claude prefers CIMD (Client ID Metadata
-- Document), where the client_id IS an https URL we fetch and cache in Redis --
-- no persistence at all. DCR is the fallback for hosts that only speak RFC 7591.
CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  client_name text,
  redirect_uris text[] NOT NULL DEFAULT '{}',
  grant_types text[] NOT NULL DEFAULT '{authorization_code,refresh_token}',
  response_types text[] NOT NULL DEFAULT '{code}',
  scope text,
  -- 'none' (public client + PKCE) is the norm; a confidential client stores only
  -- the sha256 of its secret, same discipline as the PAT table.
  token_endpoint_auth_method text NOT NULL DEFAULT 'none',
  client_secret_hash text,
  client_uri text,
  logo_uri text,
  software_id text,
  software_version text,
  client_id_issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_oauth_clients_client_id_key UNIQUE (client_id)
);

-- Hot path: /oauth/authorize and /oauth/token resolve a client by its client_id.
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_clients_client_id
  ON public.mcp_oauth_clients(client_id);

ALTER TABLE public.mcp_oauth_clients ENABLE ROW LEVEL SECURITY;

-- Client registrations are server-owned: they belong to no user, are written by
-- an unauthenticated DCR call, and are read only by the backend. There is
-- deliberately NO policy for the `authenticated` role, so RLS denies by default.
DROP POLICY IF EXISTS "Service role manages MCP OAuth clients"
ON public.mcp_oauth_clients;
CREATE POLICY "Service role manages MCP OAuth clients"
ON public.mcp_oauth_clients
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- One row per (user, client) connection that survives past the access token.
-- ---------------------------------------------------------------------------
-- This is what the "Connected apps" settings UI lists and revokes, and what the
-- refresh-token grant is checked against. Refresh tokens ROTATE: each successful
-- refresh writes a new hash and records the one it replaced, so re-presenting a
-- rotated-out token is detectable token theft -> revoke the whole chain.
CREATE TABLE IF NOT EXISTS public.mcp_oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  -- Denormalized so the settings UI can name the app without a client lookup
  -- (CIMD clients have no mcp_oauth_clients row at all).
  client_name text,
  scopes text[] NOT NULL DEFAULT '{}',
  -- Null once the grant is refresh-less (the host never asked for
  -- offline_access) or after a rotation invalidates it without a successor.
  refresh_token_hash text,
  rotated_from text,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_oauth_grants_refresh_token_hash_key UNIQUE (refresh_token_hash)
);

-- Hot path: the refresh_token grant resolves a presented token by its hash.
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_grants_refresh_token_hash
  ON public.mcp_oauth_grants(refresh_token_hash);

-- "Connected apps" listing.
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_grants_user_id
  ON public.mcp_oauth_grants(user_id);

-- Reuse detection: find the chain a rotated-out token belonged to.
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_grants_rotated_from
  ON public.mcp_oauth_grants(rotated_from)
  WHERE rotated_from IS NOT NULL;

ALTER TABLE public.mcp_oauth_grants ENABLE ROW LEVEL SECURITY;

-- Owners can see their own connections (the backend only ever selects
-- non-secret columns for listing -- never refresh_token_hash).
DROP POLICY IF EXISTS "Users can view their own MCP OAuth grants"
ON public.mcp_oauth_grants;
CREATE POLICY "Users can view their own MCP OAuth grants"
ON public.mcp_oauth_grants
FOR SELECT
USING (auth.uid() = user_id);

-- Owners can disconnect an app directly. Issuance and rotation bookkeeping go
-- through the service-role backend, so there is deliberately no authenticated
-- INSERT/UPDATE policy -- mirroring mcp_personal_access_tokens.
DROP POLICY IF EXISTS "Users can delete their own MCP OAuth grants"
ON public.mcp_oauth_grants;
CREATE POLICY "Users can delete their own MCP OAuth grants"
ON public.mcp_oauth_grants
FOR DELETE
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages MCP OAuth grants"
ON public.mcp_oauth_grants;
CREATE POLICY "Service role manages MCP OAuth grants"
ON public.mcp_oauth_grants
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Migration: 20260730093000_contract_signature_links.sql
-- Date: July 30, 2026
-- Description:
--   Lets a client sign a contract remotely, from a link, with no Proyekto
--   account — the DocuSign move. Today both signatures have to be stamped from
--   inside the app by someone with project access, which means the consultant
--   either screen-shares and signs on the client's behalf (not a signature) or
--   the client has to be onboarded first.
--
--   The token is a BEARER CAPABILITY: whoever holds the URL can sign as the
--   client. It is therefore 256 bits, single-use, short-lived and revocable.
--
--   hex, not base64: `roadmap_shares.share_token` (20260213000000) uses
--   encode(gen_random_bytes(16),'base64'), which emits '+' and '/' — both
--   URL-unsafe. Do not copy that pattern.
--
--   SECURITY NOTE: no policy here grants anon anything. The public read/sign
--   path runs through the service-role client in the backend, exactly as
--   RoadmapSharesService.getByToken does. These policies exist so that even if
--   the anon client ever queried this table directly it could not enumerate
--   tokens.

CREATE TABLE IF NOT EXISTS public.contract_signature_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  -- Only the client side is shareable; the provider signs from inside the app.
  party text NOT NULL DEFAULT 'client',
  recipient_email text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  used_at timestamptz,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contract_signature_links_party_check CHECK (party IN ('client'))
);

-- At most one live link per contract: issuing a new one must invalidate the
-- old one, so a link the consultant believes they revoked cannot still sign.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_signature_links_active
  ON public.contract_signature_links(contract_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contract_signature_links_token
  ON public.contract_signature_links(token)
  WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.contract_signature_links ENABLE ROW LEVEL SECURITY;

-- The contracts editor predicate WITHOUT the client/viewer arms: a client may
-- read and sign a contract, but must never mint or inspect signing links.
DROP POLICY IF EXISTS "Project owners can view signature links" ON public.contract_signature_links;
CREATE POLICY "Project owners can view signature links" ON public.contract_signature_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      JOIN public.project_access pa ON pa.project_id = c.project_id
      WHERE c.id = contract_signature_links.contract_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.contracts c
      JOIN public.projects p ON p.id = c.project_id
      WHERE c.id = contract_signature_links.contract_id
        AND p.consultant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Project owners can create signature links" ON public.contract_signature_links;
CREATE POLICY "Project owners can create signature links" ON public.contract_signature_links
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.contracts c
      JOIN public.project_access pa ON pa.project_id = c.project_id
      WHERE c.id = contract_signature_links.contract_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.contracts c
      JOIN public.projects p ON p.id = c.project_id
      WHERE c.id = contract_signature_links.contract_id
        AND p.consultant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Project owners can revoke signature links" ON public.contract_signature_links;
CREATE POLICY "Project owners can revoke signature links" ON public.contract_signature_links
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      JOIN public.project_access pa ON pa.project_id = c.project_id
      WHERE c.id = contract_signature_links.contract_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.contracts c
      JOIN public.projects p ON p.id = c.project_id
      WHERE c.id = contract_signature_links.contract_id
        AND p.consultant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Project owners can delete signature links" ON public.contract_signature_links;
CREATE POLICY "Project owners can delete signature links" ON public.contract_signature_links
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      JOIN public.project_access pa ON pa.project_id = c.project_id
      WHERE c.id = contract_signature_links.contract_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.contracts c
      JOIN public.projects p ON p.id = c.project_id
      WHERE c.id = contract_signature_links.contract_id
        AND p.consultant_id = auth.uid()
    )
  );

COMMENT ON TABLE public.contract_signature_links IS
  'Single-use, expiring, revocable links that let a client sign a contract without a Proyekto account. The token is a bearer capability — never log it.';

-- Two-way contract authoring, version history and the AI change summary.
-- docs/13-proposals/two-way-contract-authoring.md
--
-- Additive only. Nothing here changes what an existing column means.
--
--   * contract_revisions: one row per term change, written by a trigger in the
--     same statement that raises contracts.revision, so the history can never
--     disagree with the revision counter. The author is the
--     contracts.last_edited_by the service stamps on that same UPDATE.
--   * contract_positions.last_viewed_revision: the revision a seat last
--     reviewed. Drives "changed since you last viewed" (rule 4).
--   * uq_contracts_one_open_amendment: one open amendment per family (rule 6).
--   * contracts.signed_pdf_path / signed_pdf_sha256 / signed_terms: the frozen
--     copy of what was signed.
--   * contract_change_summaries: cached AI summaries, per version pair and seat.
--   * contracts.workspace_id: whose plan a contract counts against.
--   * contracts.template_key: which clause template a contract was issued from.
--   * plan keys contract_counterparty_authoring (feature) and active_contracts
--     (count).

BEGIN;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS last_edited_by uuid,
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_key text,
  ADD COLUMN IF NOT EXISTS signed_pdf_path text,
  ADD COLUMN IF NOT EXISTS signed_pdf_sha256 text,
  ADD COLUMN IF NOT EXISTS signed_terms jsonb,
  ADD COLUMN IF NOT EXISTS signed_snapshot_taken_at timestamptz,
  ADD COLUMN IF NOT EXISTS signed_snapshot_kind text;

ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_signed_snapshot_kind_check;
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_signed_snapshot_kind_check
  CHECK (signed_snapshot_kind IS NULL OR signed_snapshot_kind IN ('at_signing', 'backfill'));

ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_signed_pdf_sha256_check;
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_signed_pdf_sha256_check
  CHECK (signed_pdf_sha256 IS NULL OR signed_pdf_sha256 ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN public.contracts.signed_pdf_path IS
  'Private-bucket key of the PDF frozen when the contract reached signed. Served instead of re-rendering.';
COMMENT ON COLUMN public.contracts.signed_pdf_sha256 IS
  'sha256 (hex) of the frozen PDF; proves the stored file has not changed since signing.';
COMMENT ON COLUMN public.contracts.signed_terms IS
  'The terms that were signed, as data, for field-by-field comparison between versions.';
COMMENT ON COLUMN public.contracts.signed_snapshot_kind IS
  'at_signing: frozen when signed. backfill: frozen later from the row as it stood (labelled in the UI).';
COMMENT ON COLUMN public.contracts.last_edited_by IS
  'Who made the latest term change. Stamped by the service on the same UPDATE that raises revision; read by the revision trigger.';

-- Whose plan counts: the project's workspace, else the author's (set by the
-- service for flexible contracts).
UPDATE public.contracts c
SET workspace_id = p.workspace_id
FROM public.projects p
WHERE c.project_id = p.id
  AND c.workspace_id IS NULL
  AND p.workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_workspace_status
  ON public.contracts (workspace_id, status);

ALTER TABLE public.contract_positions
  ADD COLUMN IF NOT EXISTS last_viewed_revision integer;

-- ── Rule 6: one open amendment per family ────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_contracts_one_open_amendment
  ON public.contracts (contract_family_id)
  WHERE status IN ('draft', 'sent') AND supersedes_contract_id IS NOT NULL;

-- ── Revisions ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contract_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  author_user_id uuid,
  author_position text,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_revisions_position_check
    CHECK (author_position IS NULL OR author_position IN ('hirer', 'provider')),
  CONSTRAINT contract_revisions_unique UNIQUE (contract_id, revision)
);

COMMENT ON TABLE public.contract_revisions IS
  'One row per term change during negotiation of one contract version. changes = {field: {before, after}}.';

ALTER TABLE public.contract_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_revisions_seat_read ON public.contract_revisions;
CREATE POLICY contract_revisions_seat_read ON public.contract_revisions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contract_positions cp
      WHERE cp.contract_id = contract_revisions.contract_id
        AND cp.user_id = (SELECT auth.uid())
    )
  );

GRANT SELECT ON public.contract_revisions TO authenticated;

-- Columns that are bookkeeping, not terms. A change to only these is never a
-- revision (and the service never raises revision for them anyway).
CREATE OR REPLACE FUNCTION public.contracts_record_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_position text;
BEGIN
  FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
    CONTINUE WHEN v_key IN (
      'id', 'revision', 'updated_at', 'created_at', 'created_by', 'status',
      'engagement_id', 'last_edited_by', 'workspace_id',
      'signed_pdf_path', 'signed_pdf_sha256', 'signed_terms',
      'signed_snapshot_taken_at', 'signed_snapshot_kind'
    ) OR v_key LIKE 'signed_by_%';
    IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
      v_changes := v_changes || jsonb_build_object(
        v_key,
        jsonb_build_object('before', v_old -> v_key, 'after', v_new -> v_key)
      );
    END IF;
  END LOOP;

  SELECT position INTO v_position
  FROM public.contract_positions
  WHERE contract_id = NEW.id AND user_id = NEW.last_edited_by
  LIMIT 1;

  INSERT INTO public.contract_revisions(
    contract_id, revision, author_user_id, author_position, changes
  ) VALUES (
    NEW.id, NEW.revision, NEW.last_edited_by, v_position, v_changes
  )
  ON CONFLICT (contract_id, revision) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contracts_record_revision ON public.contracts;
CREATE TRIGGER trg_contracts_record_revision
AFTER UPDATE OF revision ON public.contracts
FOR EACH ROW
WHEN (NEW.revision > OLD.revision)
EXECUTE FUNCTION public.contracts_record_revision();

-- ── Cached AI change summaries ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contract_change_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  to_contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  seat text NOT NULL,
  from_revision integer NOT NULL,
  to_revision integer NOT NULL,
  model text NOT NULL,
  summary jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_change_summaries_seat_check
    CHECK (seat IN ('hirer', 'provider', 'viewer')),
  CONSTRAINT contract_change_summaries_unique
    UNIQUE (from_contract_id, to_contract_id, seat, from_revision, to_revision)
);

COMMENT ON TABLE public.contract_change_summaries IS
  'AI explanations of a deterministic contract diff, cached per version pair, revisions and seat. Service-role only.';

-- Deny-all: only the backend (service role) reads or writes summaries.
ALTER TABLE public.contract_change_summaries ENABLE ROW LEVEL SECURITY;

-- ── Plan keys ────────────────────────────────────────────────────────────────
-- Seeded open here; 20261001090000_plan_estimates_authoring_intake sets the
-- estimates: counterparty authoring off/on/on/on and active_contracts
-- 3/25/250/unlimited (Free/Pro/Business/Enterprise).
INSERT INTO public.plan_limit_keys (key, kind, label, description, unit, group_key, sort_order) VALUES
  ('contract_counterparty_authoring', 'feature', 'Client and talent contract authoring',
   'Clients and talent may create, edit and amend their own contracts.', NULL, 'governance', 115),
  ('active_contracts', 'count', 'Active contracts',
   'Contracts sent or signed, per workspace. Drafts are free; an amendment does not count twice.', 'contracts', 'usage', 45)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  unit = EXCLUDED.unit,
  group_key = EXCLUDED.group_key,
  sort_order = EXCLUDED.sort_order;

INSERT INTO public.plan_limits (plan, limit_key, kind, int_value, bool_value, per_seat, display_label) VALUES
  ('free',       'contract_counterparty_authoring', 'feature', NULL, true, false, NULL),
  ('pro',        'contract_counterparty_authoring', 'feature', NULL, true, false, NULL),
  ('business',   'contract_counterparty_authoring', 'feature', NULL, true, false, NULL),
  ('enterprise', 'contract_counterparty_authoring', 'feature', NULL, true, false, NULL),
  ('free',       'active_contracts', 'count', NULL, NULL, false, NULL),
  ('pro',        'active_contracts', 'count', NULL, NULL, false, NULL),
  ('business',   'active_contracts', 'count', NULL, NULL, false, NULL),
  ('enterprise', 'active_contracts', 'count', NULL, NULL, false, NULL)
ON CONFLICT DO NOTHING;

COMMIT;

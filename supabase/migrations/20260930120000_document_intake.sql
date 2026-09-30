-- Document intake (docs/13-proposals/document-intake.md).
--
-- Intake starts before any project exists, and finance_documents.project_id is
-- NOT NULL, so intake stages its own work here and copies each confirmed
-- document into finance_documents on replicate. These rows are kept as the
-- audit trail of where every replicated record came from.
--
-- Additive only. All three tables are deny-all under RLS: the backend (service
-- role) is the only reader and writer, after its own authorization.

BEGIN;

CREATE TABLE IF NOT EXISTS public.intake_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  created_by uuid NOT NULL,
  -- Which seat the importer takes on what they import (the document shows
  -- them as one side; the other side is invited to attest).
  importer_capacity text NOT NULL DEFAULT 'consultant',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_batches_status_check
    CHECK (status IN ('open', 'replicated', 'abandoned')),
  CONSTRAINT intake_batches_capacity_check
    CHECK (importer_capacity IN ('consultant', 'client'))
);

CREATE INDEX IF NOT EXISTS idx_intake_batches_creator
  ON public.intake_batches (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS public.intake_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.intake_batches(id) ON DELETE CASCADE,
  counterparty_name text,
  counterparty_email text,
  counterparty_user_id uuid,
  relationship_kind text NOT NULL DEFAULT 'client_services',
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  project_title text,
  status text NOT NULL DEFAULT 'proposed',
  -- What replicate created: {contract_id, project_id, invoice_ids[], ...}.
  replicated jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_relationships_status_check
    CHECK (status IN ('proposed', 'confirmed', 'replicated')),
  CONSTRAINT intake_relationships_kind_check
    CHECK (relationship_kind IN ('client_services', 'talent_services'))
);

CREATE INDEX IF NOT EXISTS idx_intake_relationships_batch
  ON public.intake_relationships (batch_id);

CREATE TABLE IF NOT EXISTS public.intake_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.intake_batches(id) ON DELETE CASCADE,
  -- One uploaded file can hold several documents; they share the file.
  file_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  file_sha256 text NOT NULL,
  page_count integer NOT NULL DEFAULT 1,
  page_start integer NOT NULL DEFAULT 1,
  page_end integer NOT NULL DEFAULT 1,
  doc_type text,
  language text,
  -- The model's reading, untouched: {fields, clauses, line_items, model}.
  extraction jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Per-field confidence, as read.
  confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The reviewed record: {field: {value, state, origin, ai_value, page, box}}.
  -- state is read | unsure | needs_input | corrected | not_in_document;
  -- origin is ai | snip | typed.
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Problems the review must show: totals that do not add up, a duplicate.
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  relationship_id uuid REFERENCES public.intake_relationships(id) ON DELETE SET NULL,
  duplicate_of uuid,
  status text NOT NULL DEFAULT 'uploaded',
  -- What replicate created from this document.
  replicated_record jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_documents_doc_type_check CHECK (
    doc_type IS NULL OR doc_type IN
      ('contract', 'amendment', 'invoice', 'receipt', 'proof_of_payment', 'other')
  ),
  CONSTRAINT intake_documents_status_check CHECK (
    status IN ('uploaded', 'classified', 'extracted', 'confirmed', 'replicated', 'failed', 'skipped')
  ),
  CONSTRAINT intake_documents_pages_check
    CHECK (page_start >= 1 AND page_end >= page_start AND page_end <= page_count),
  CONSTRAINT intake_documents_sha256_check CHECK (file_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_intake_documents_batch
  ON public.intake_documents (batch_id, page_start);
CREATE INDEX IF NOT EXISTS idx_intake_documents_sha256
  ON public.intake_documents (file_sha256);

ALTER TABLE public.intake_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intake_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intake_documents ENABLE ROW LEVEL SECURITY;

-- ── Plan keys ────────────────────────────────────────────────────────────────
-- Seeded open here; 20261001090000_plan_estimates_authoring_intake sets the
-- estimates: document_intake_pages_monthly 30 / 500 / 3,000 / unlimited and
-- document_intake_onboarding_pages 200 on every plan (once per workspace).
INSERT INTO public.plan_limit_keys (key, kind, label, description, unit, group_key, sort_order) VALUES
  ('document_intake_pages_monthly', 'quota', 'Document intake pages',
   'Pages read by document intake each month.', 'pages', 'ai', 55),
  ('document_intake_onboarding_pages', 'quota', 'Onboarding intake pages',
   'Pages every workspace may import once, before the monthly quota applies.', 'pages', 'ai', 56)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  unit = EXCLUDED.unit,
  group_key = EXCLUDED.group_key,
  sort_order = EXCLUDED.sort_order;

INSERT INTO public.plan_limits (plan, limit_key, kind, int_value, bool_value, per_seat, display_label) VALUES
  ('free',       'document_intake_pages_monthly', 'quota', NULL, NULL, false, NULL),
  ('pro',        'document_intake_pages_monthly', 'quota', NULL, NULL, false, NULL),
  ('business',   'document_intake_pages_monthly', 'quota', NULL, NULL, false, NULL),
  ('enterprise', 'document_intake_pages_monthly', 'quota', NULL, NULL, false, NULL),
  ('free',       'document_intake_onboarding_pages', 'quota', NULL, NULL, false, NULL),
  ('pro',        'document_intake_onboarding_pages', 'quota', NULL, NULL, false, NULL),
  ('business',   'document_intake_onboarding_pages', 'quota', NULL, NULL, false, NULL),
  ('enterprise', 'document_intake_onboarding_pages', 'quota', NULL, NULL, false, NULL)
ON CONFLICT (plan, limit_key) DO NOTHING;

COMMIT;

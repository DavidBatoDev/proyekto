-- Migration: 20260826100000_project_postings.sql
-- Date: August 26, 2026
-- Description:
--   The demand side of the marketplace. A client writes a "project brief" -- a
--   flexible, section-based description of work they want done -- publishes it,
--   and verified consultants apply to it. Until now the marketplace ran in one
--   direction only (consultant invites talent); there was no proposals, bids or
--   offers table anywhere in the schema.
--
--   WHY A SEPARATE TABLE FROM `project_briefs`:
--   `project_briefs` is the brief INSIDE a project -- it has a NOT NULL
--   project_id, its RLS is `project_access`-scoped, and it presumes a project
--   already exists. A posting exists BEFORE any project does, and is read by
--   people who must never receive project access. Same idea, different
--   lifecycle, different audience, different authorization. Sharing one table
--   would mean loosening project-scoped RLS to admit strangers, which is the
--   one thing this design must not do.
--
--   The `sections` element shape is deliberately IDENTICAL to
--   `project_briefs.custom_fields` ({key, value, position}), so accepting a
--   proposal can later seed a real project's brief verbatim with no translation
--   layer. That is the only coupling between the two.
--
--   WHY NOT COLUMNS ON `projects`: docs/07-data-and-db/schema-overview.md --
--   "projects: lean execution container; marketplace/listing metadata does not
--   live here". 20260813131000 deliberately dropped category, skills,
--   budget_range, project_state and funding_status from it. Putting them back
--   under a different name would undo a decision, not extend one.
--
--   `projects.status = 'bidding'` is deliberately left alone. It is still
--   written by client-mode project creation and rendered by three dashboard
--   surfaces; the board here reads `project_postings` and never that enum, so
--   pre-existing bidding rows cannot leak into a listings surface.
--
--   Capability is `consultant_profiles.status = 'verified'` via
--   public.is_active_consultant(), never a declared role. Nothing here
--   introduces one.

BEGIN;

-- ---------------------------------------------------------------------------
-- Postings
-- ---------------------------------------------------------------------------

CREATE TABLE public.project_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 200),
  -- Fiverr's "what best describes your needs?". Two values rather than free
  -- text because it is a filter on the board, not prose.
  engagement_type text NOT NULL DEFAULT 'one_time'
    CHECK (engagement_type IN ('ongoing', 'one_time')),
  -- Rich HTML, same as project_briefs.project_summary: the overview paragraph.
  summary text,
  -- Ordered [{key, value, position}] -- the flexible sections. Element shape
  -- matches project_briefs.custom_fields exactly; see the header.
  sections jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(sections) = 'array'),
  -- Nullable + SET NULL for the same reason as consultant_services: retiring a
  -- taxonomy row must not delete somebody's brief or block their edit.
  category_id uuid REFERENCES public.marketplace_categories(id) ON DELETE SET NULL,
  subcategory_id uuid REFERENCES public.marketplace_subcategories(id) ON DELETE SET NULL,
  budget_min numeric(12,2) CHECK (budget_min IS NULL OR budget_min >= 0),
  budget_max numeric(12,2) CHECK (budget_max IS NULL OR budget_max >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  -- Same buckets the project-create wizard already uses, so the two flows
  -- speak one vocabulary.
  duration text CHECK (duration IS NULL OR duration IN
    ('<1_month', '1-3_months', '3-6_months', '6+_months')),
  -- A reference, NOT a grant. Reading the roadmap itself still requires a
  -- roadmap_shares row.
  roadmap_id uuid REFERENCES public.roadmaps(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'closed')),
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_postings_budget_range
    CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max),
  -- A published brief must say what the work is. Drafts may be empty: that is
  -- the state you are in while still writing it. The full mandatory-section
  -- rule is enforced by the backend on publish; this is the floor that keeps a
  -- contentless row off the board even if something bypasses it.
  CONSTRAINT project_postings_published_needs_summary
    CHECK (status <> 'published' OR length(trim(coalesce(summary, ''))) > 0)
);

-- The board: published rows, newest first, optionally narrowed by discipline.
CREATE INDEX idx_project_postings_board
  ON public.project_postings(published_at DESC, category_id)
  WHERE status = 'published';

-- The author's own list.
CREATE INDEX idx_project_postings_author
  ON public.project_postings(author_id, created_at DESC);

CREATE TRIGGER project_postings_updated_at
  BEFORE UPDATE ON public.project_postings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------

-- Column set mirrors the web upload service's ChatAttachmentMeta so the
-- existing R2 upload path is reused without a translation step.
CREATE TABLE public.project_posting_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_id uuid NOT NULL REFERENCES public.project_postings(id) ON DELETE CASCADE,
  url text NOT NULL,
  name text NOT NULL,
  content_type text,
  size bigint CHECK (size IS NULL OR size >= 0),
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_posting_attachments_posting
  ON public.project_posting_attachments(posting_id, created_at);

-- ---------------------------------------------------------------------------
-- Proposals
-- ---------------------------------------------------------------------------

CREATE TABLE public.project_posting_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_id uuid NOT NULL REFERENCES public.project_postings(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pitch text NOT NULL CHECK (length(trim(pitch)) BETWEEN 20 AND 2000),
  -- Indicative, not a quote. The real figure is negotiated on a contract, in
  -- exactly the same spirit as consultant_services.starting_price.
  indicative_rate numeric(12,2) CHECK (indicative_rate IS NULL OR indicative_rate >= 0),
  rate_currency char(3) NOT NULL DEFAULT 'USD',
  rate_unit text NOT NULL DEFAULT 'project'
    CHECK (rate_unit IN ('project', 'hour', 'month')),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'withdrawn', 'shortlisted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One proposal per consultant per brief. Re-applying edits the existing row;
  -- it does not stack a second one.
  CONSTRAINT project_posting_proposals_unique_applicant
    UNIQUE (posting_id, consultant_id)
);

-- The author's applicant list.
CREATE INDEX idx_project_posting_proposals_posting
  ON public.project_posting_proposals(posting_id, created_at DESC);

-- "My proposals", for the consultant.
CREATE INDEX idx_project_posting_proposals_consultant
  ON public.project_posting_proposals(consultant_id, created_at DESC);

CREATE TRIGGER project_posting_proposals_updated_at
  BEFORE UPDATE ON public.project_posting_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.project_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_posting_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_posting_proposals ENABLE ROW LEVEL SECURITY;

-- The author owns their brief outright, in every state.
CREATE POLICY project_postings_author_all
  ON public.project_postings FOR ALL
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- The board. Verified consultants only, published rows only, and NO anon
-- policy: docs/13-proposals/identity-and-enrollment.md gates the postings board
-- in the same breath as the talent pool. A client's unposted work, and every
-- draft, stays invisible.
CREATE POLICY project_postings_consultant_read_published
  ON public.project_postings FOR SELECT
  TO authenticated
  USING (status = 'published' AND public.is_active_consultant(auth.uid()));

-- Attachments inherit the posting's visibility exactly -- one rule, expressed
-- once, so the two can never drift apart.
CREATE POLICY project_posting_attachments_read
  ON public.project_posting_attachments FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_postings AS p
    WHERE p.id = project_posting_attachments.posting_id
      AND (
        p.author_id = auth.uid()
        OR (p.status = 'published' AND public.is_active_consultant(auth.uid()))
      )
  ));

CREATE POLICY project_posting_attachments_author_write
  ON public.project_posting_attachments FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_postings AS p
    WHERE p.id = project_posting_attachments.posting_id
      AND p.author_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.project_postings AS p
    WHERE p.id = project_posting_attachments.posting_id
      AND p.author_id = auth.uid()
  ));

-- Proposing is a consultant-only act, and only against a live brief. Checking
-- both here means a suspended consultant cannot apply even if a stale client
-- still has the button on screen.
CREATE POLICY project_posting_proposals_consultant_insert
  ON public.project_posting_proposals FOR INSERT
  TO authenticated
  WITH CHECK (
    consultant_id = auth.uid()
    AND public.is_active_consultant(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.project_postings AS p
      WHERE p.id = project_posting_proposals.posting_id
        AND p.status = 'published'
    )
  );

-- Both parties read it: the consultant their own, the author every proposal on
-- their own brief. Nobody else, including other applicants.
CREATE POLICY project_posting_proposals_party_read
  ON public.project_posting_proposals FOR SELECT
  TO authenticated
  USING (
    consultant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.project_postings AS p
      WHERE p.id = project_posting_proposals.posting_id
        AND p.author_id = auth.uid()
    )
  );

-- The consultant may edit or withdraw their own pitch.
CREATE POLICY project_posting_proposals_consultant_update
  ON public.project_posting_proposals FOR UPDATE
  TO authenticated
  USING (consultant_id = auth.uid())
  WITH CHECK (
    consultant_id = auth.uid()
    AND status IN ('submitted', 'withdrawn')
  );

-- The author may triage: the WITH CHECK bounds them to the two decision states,
-- so they cannot forge a withdrawal. It cannot stop them editing the pitch in
-- the same statement -- a WITH CHECK sees only the new row, never the old one --
-- so the content is frozen by a trigger in 20260826100100 instead.
CREATE POLICY project_posting_proposals_author_update
  ON public.project_posting_proposals FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_postings AS p
    WHERE p.id = project_posting_proposals.posting_id
      AND p.author_id = auth.uid()
  ))
  WITH CHECK (
    status IN ('shortlisted', 'declined')
    AND EXISTS (
      SELECT 1 FROM public.project_postings AS p
      WHERE p.id = project_posting_proposals.posting_id
        AND p.author_id = auth.uid()
    )
  );

-- No DELETE policy on proposals, deliberately: a consultant withdraws (a state
-- the author can see), and an author declines. Neither erases the record.

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.project_postings IS
  'A client-authored project brief published to the marketplace so verified consultants can propose. Standalone by design: no project exists behind it until the client acts on a proposal. Distinct from project_briefs, which is the brief inside an existing project and is project_access-scoped.';

COMMENT ON COLUMN public.project_postings.sections IS
  'Ordered [{key, value, position}]. Element shape is identical to project_briefs.custom_fields so an accepted brief can seed a real project brief verbatim.';

COMMENT ON COLUMN public.project_postings.roadmap_id IS
  'A reference for context, NOT an access grant. Consultants browsing the brief see the roadmap name and counts; reading the roadmap itself still requires a roadmap_shares row.';

COMMENT ON COLUMN public.project_postings.status IS
  'draft (private to the author) | published (on the consultant board) | closed (retired, kept so proposals stay explicable).';

COMMENT ON TABLE public.project_posting_proposals IS
  'A verified consultant''s lightweight application to a published brief: a pitch and an indicative rate. Not an offer and not a contract -- accepting one starts a conversation, and pricing is still negotiated on a contract.';

COMMENT ON COLUMN public.project_posting_proposals.indicative_rate IS
  'A ballpark in `rate_currency` per `rate_unit`, for triage only. The figure that binds anybody lives on a contract.';

COMMIT;

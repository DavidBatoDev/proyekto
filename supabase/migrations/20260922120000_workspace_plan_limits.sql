-- Workspace plan limits: the editable limit matrix, complimentary plans, and
-- the one SQL definition of a workspace's effective plan.
--
-- web/src/lib/pricing.ts has published four plans since the pricing page
-- shipped, and nothing enforced any of it. This migration gives the backend
-- entitlement layer (backend/src/modules/shared/entitlements/) the data it
-- reads: which plan a workspace is effectively on, what each plan allows, and
-- how much of it the workspace already uses.
--
-- Decisions:
--
--   * Limits are one row per (plan, key), not a jsonb blob per plan. Values are
--     typed (int_value / bool_value), a composite FK to the key registry pins
--     each cell to its key's kind declaratively, every cell carries its own
--     updated_by / updated_at, and the audit log can diff single cells. A NULL
--     int_value means unlimited. per_seat lives on the cell because the AI
--     quota mixes units (Free is 50 a month per workspace, Pro and Business are
--     per seat). display_label holds marketing overrides ("Negotiated",
--     "Granular", "Higher limits"); enforcement never reads it.
--
--   * The key registry is split by who owns each fact. plan_limit_keys (here)
--     owns kind, label, unit, group and sort order, which gives referential
--     integrity and makes GET /api/plans self-describing. The backend's
--     ENTITLEMENT_KEYS owns whether a key is enforced, because that is a fact
--     about the code. A Jest parity spec parses this file; at runtime a code key
--     with no row fails open and is reported as drift.
--
--   * The seed below is the source the web's DEFAULT_PLAN_LIMITS
--     (web/src/lib/planLimits.ts) copies as its offline fallback; /pricing
--     renders these rows via GET /api/plans. plan_limit_keys re-applies refresh
--     presentation only and never kind; plan_limits re-applies are
--     ON CONFLICT DO NOTHING so a re-run can never overwrite an admin edit. New
--     keys and cells arrive only through migrations: admin_update_plan_limits
--     is UPDATE-only.
--
--   * Complimentary plans ("comps") live on workspaces, not on
--     workspace_subscriptions. That table is a pure projection of the payment
--     provider that webhooks and the reconcile cron rewrite; they never touch
--     workspaces, so a comp cannot be clobbered by construction. Only the
--     non-sensitive state is on the row (flag, plan, since, until), because
--     every workspace member reads workspaces.*. Who granted a comp and why go
--     to platform_admin_audit_log, which no browser can read. Cross-column
--     CHECKs are fine here, unlike the webhook columns 20260908120000 kept
--     unconstrained: an admin writes all four atomically through one RPC.
--
--   * The effective-plan rule is defined once, in workspace_plan_state.
--     comp_active = is_discounted_free AND (discounted_until IS NULL OR
--     discounted_until > now()). paid = the subscription plan while its status
--     is active, trialing or past_due, else free (no row = free). effective =
--     the higher-ranked of the two, so a comp never downgrades a paying
--     customer. plan_source is 'complimentary' only when the comp outranks
--     paid; a tie is 'subscription', because they are paying. TypeScript reads
--     the result and never re-derives it.
--
--   * On hosted dev, Supabase's default privileges had given authenticated full
--     DML on workspaces, so the workspaces_update policy was live over
--     PostgREST and any owner could have granted themselves a comp with their
--     own JWT (or deleted a workspace past assertNoLiveSubscription).
--     20260902090000 documented writes as service-role only but revoked only
--     from PUBLIC and anon. This migration revokes the writes from
--     authenticated and adds a guard trigger on the comp columns as a second
--     line; no web or agent code writes workspaces directly.
--
--   * Every function is SECURITY INVOKER and service_role only, like
--     ai_context_roadmap_counts. None is used in a policy, so none needs
--     DEFINER; add a DEFINER wrapper if a policy ever does.
--
--   * The new tables have RLS enabled with ZERO policies (the
--     billing_webhook_events pattern): deny-all for every role that does not
--     bypass RLS. The advisor's rls_enabled_no_policy INFO lint on them is
--     intended - do not "fix" it by adding a policy. /pricing reads the matrix
--     through the backend, which keeps updated_by out of anonymous reads.
--
-- Expand-only: every new column is defaulted or nullable and every existing
-- workspace satisfies the new CHECKs as-is. Nothing existing is redefined.

BEGIN;

-- ── 1. plan_rank ────────────────────────────────────────────────────────────
-- Unknown or NULL plans rank as free, the safe direction for an entitlement.

CREATE OR REPLACE FUNCTION public.plan_rank(p_plan text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_plan
           WHEN 'free' THEN 0
           WHEN 'pro' THEN 1
           WHEN 'business' THEN 2
           WHEN 'enterprise' THEN 3
           ELSE 0
         END;
$$;

COMMENT ON FUNCTION public.plan_rank(text) IS
  'Plan ordering: free 0 < pro 1 < business 2 < enterprise 3. Unknown or NULL ranks as free.';

-- ── 2. plan_limit_keys ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.plan_limit_keys (
  key text PRIMARY KEY,
  kind text NOT NULL,
  label text NOT NULL,
  description text,
  unit text,
  group_key text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_limit_keys_key_format
    CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT plan_limit_keys_kind_check
    CHECK (kind IN ('count', 'quota', 'days', 'feature')),
  CONSTRAINT plan_limit_keys_group_check
    CHECK (group_key IN ('usage', 'ai', 'governance', 'team', 'platform')),
  CONSTRAINT plan_limit_keys_label_length
    CHECK (char_length(label) BETWEEN 1 AND 80),
  CONSTRAINT plan_limit_keys_description_length
    CHECK (description IS NULL OR char_length(description) <= 500),
  -- Numeric keys always carry a unit ("projects", "days"); features never do.
  CONSTRAINT plan_limit_keys_unit_shape
    CHECK ((kind = 'feature') = (unit IS NULL)),
  -- The target of plan_limits' composite FK, which is what pins a cell's kind.
  CONSTRAINT plan_limit_keys_key_kind_unique UNIQUE (key, kind)
);

COMMENT ON TABLE public.plan_limit_keys IS
  'Registry of plan limit keys: kind and presentation. Whether a key is enforced is owned by the backend registry (ENTITLEMENT_KEYS), not stored here. Rows arrive only through migrations.';
COMMENT ON COLUMN public.plan_limit_keys.kind IS
  'count (workspace or per-roadmap ceiling), quota (monthly allowance), days (retention window) or feature (on/off). Never changed by a re-seed.';
COMMENT ON COLUMN public.plan_limit_keys.group_key IS
  'Pricing-table section: usage, ai, governance, team or platform.';

-- ── 3. plan_limits ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.plan_limits (
  plan text NOT NULL,
  limit_key text NOT NULL,
  kind text NOT NULL,
  int_value integer,
  bool_value boolean,
  per_seat boolean NOT NULL DEFAULT false,
  display_label text,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan, limit_key),
  CONSTRAINT plan_limits_plan_check
    CHECK (plan IN ('free', 'pro', 'business', 'enterprise')),
  CONSTRAINT plan_limits_key_kind_fkey
    FOREIGN KEY (limit_key, kind)
    REFERENCES public.plan_limit_keys (key, kind)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT plan_limits_value_shape CHECK (
    (kind = 'feature' AND bool_value IS NOT NULL AND int_value IS NULL)
    OR (kind <> 'feature' AND bool_value IS NULL)
  ),
  CONSTRAINT plan_limits_int_range
    CHECK (int_value IS NULL OR int_value BETWEEN 0 AND 1000000000),
  CONSTRAINT plan_limits_days_min
    CHECK (kind <> 'days' OR int_value IS NULL OR int_value >= 1),
  CONSTRAINT plan_limits_per_seat_quota_only
    CHECK (NOT per_seat OR kind = 'quota'),
  CONSTRAINT plan_limits_display_label_length
    CHECK (display_label IS NULL OR char_length(display_label) BETWEEN 1 AND 40)
);

COMMENT ON TABLE public.plan_limits IS
  'One cell per (plan, limit key). Numeric kinds use int_value (NULL = unlimited); features use bool_value. Edited only through admin_update_plan_limits; max(updated_at) is the matrix version.';
COMMENT ON COLUMN public.plan_limits.kind IS
  'Denormalized from plan_limit_keys so the composite FK can pin each cell to its key''s kind.';
COMMENT ON COLUMN public.plan_limits.per_seat IS
  'Quota cells only: the value is multiplied by the workspace''s seats.';
COMMENT ON COLUMN public.plan_limits.display_label IS
  'Marketing override shown instead of the value ("Negotiated", "Granular"). Enforcement never reads it.';

DROP TRIGGER IF EXISTS trg_plan_limits_updated_at ON public.plan_limits;
CREATE TRIGGER trg_plan_limits_updated_at
BEFORE UPDATE ON public.plan_limits
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ── 4. Seed (web/src/lib/planLimits.ts DEFAULT_PLAN_LIMITS must match) ─────

INSERT INTO public.plan_limit_keys (key, kind, label, description, unit, group_key, sort_order) VALUES
  ('members', 'count', 'Members',
   'People in the workspace. Pending invites count toward the limit.', 'members', 'usage', 10),
  ('projects', 'count', 'Projects',
   'Projects in the workspace, archived ones included. Personal projects are not counted.', 'projects', 'usage', 20),
  ('teams', 'count', 'Teams',
   'Teams in the workspace. Personal teams are not counted.', 'teams', 'usage', 30),
  ('roadmap_nodes_per_roadmap', 'count', 'Roadmap nodes per roadmap',
   'Epics, features and tasks on a single roadmap. Milestones are not counted.', 'nodes', 'usage', 40),
  ('ai_messages_monthly', 'quota', 'AI messages',
   'Messages to the roadmap assistant each month.', 'messages', 'ai', 50),
  ('deliverables', 'feature', 'Deliverables',
   'Track the deliverables a project owes.', NULL, 'governance', 60),
  ('deliverable_review', 'feature', 'Deliverable review and acceptance',
   'Submit deliverables for review and record acceptance.', NULL, 'governance', 70),
  ('change_requests', 'feature', 'Change requests',
   'Raise, decide and apply changes to agreed scope.', NULL, 'governance', 80),
  ('risks', 'feature', 'Risks and issues register',
   'Log and track project risks and issues.', NULL, 'governance', 90),
  ('decisions', 'feature', 'Decision log',
   'Record project decisions and who made them.', NULL, 'governance', 100),
  ('custom_register_fields', 'feature', 'Custom register fields',
   'Add your own fields to the delivery registers.', NULL, 'governance', 110),
  ('time_tracking', 'feature', 'Time tracking and timesheets',
   'Log time against work and review team timesheets.', NULL, 'team', 120),
  ('private_teams_guests', 'feature', 'Private teams and guests',
   'Hide teams from the rest of the workspace and invite guests.', NULL, 'team', 130),
  ('roles_permissions', 'feature', 'Roles and permissions',
   'Control what each role can see and change.', NULL, 'team', 140),
  ('activity_retention_days', 'days', 'Activity log retention',
   'How far back the activity log can be viewed.', 'days', 'team', 150),
  ('activity_export', 'feature', 'Activity export',
   'Export the activity log.', NULL, 'team', 160),
  ('mcp_server', 'feature', 'MCP server',
   'Connect Claude and other AI clients to Proyekto through the MCP server.', NULL, 'platform', 170),
  ('saml_scim', 'feature', 'SAML and SCIM',
   'Single sign-on with SAML and user provisioning with SCIM.', NULL, 'platform', 180)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  unit = EXCLUDED.unit,
  group_key = EXCLUDED.group_key,
  sort_order = EXCLUDED.sort_order;

-- 18 keys x 4 plans = 72 explicit cells. Unlimited is a NULL int_value.
INSERT INTO public.plan_limits (plan, limit_key, kind, int_value, bool_value, per_seat, display_label) VALUES
  ('free',       'members', 'count', 10,   NULL, false, NULL),
  ('pro',        'members', 'count', NULL, NULL, false, NULL),
  ('business',   'members', 'count', NULL, NULL, false, NULL),
  ('enterprise', 'members', 'count', NULL, NULL, false, NULL),

  ('free',       'projects', 'count', 2,    NULL, false, NULL),
  ('pro',        'projects', 'count', 10,   NULL, false, NULL),
  ('business',   'projects', 'count', NULL, NULL, false, NULL),
  ('enterprise', 'projects', 'count', NULL, NULL, false, NULL),

  ('free',       'teams', 'count', 2,    NULL, false, NULL),
  ('pro',        'teams', 'count', 3,    NULL, false, NULL),
  ('business',   'teams', 'count', NULL, NULL, false, NULL),
  ('enterprise', 'teams', 'count', NULL, NULL, false, NULL),

  ('free',       'roadmap_nodes_per_roadmap', 'count', 250,  NULL, false, NULL),
  ('pro',        'roadmap_nodes_per_roadmap', 'count', NULL, NULL, false, NULL),
  ('business',   'roadmap_nodes_per_roadmap', 'count', NULL, NULL, false, NULL),
  ('enterprise', 'roadmap_nodes_per_roadmap', 'count', NULL, NULL, false, NULL),

  ('free',       'ai_messages_monthly', 'quota', 50,   NULL, false, NULL),
  ('pro',        'ai_messages_monthly', 'quota', 500,  NULL, true,  NULL),
  ('business',   'ai_messages_monthly', 'quota', 2000, NULL, true,  NULL),
  ('enterprise', 'ai_messages_monthly', 'quota', NULL, NULL, false, 'Negotiated'),

  ('free',       'deliverables', 'feature', NULL, false, false, NULL),
  ('pro',        'deliverables', 'feature', NULL, true,  false, NULL),
  ('business',   'deliverables', 'feature', NULL, true,  false, NULL),
  ('enterprise', 'deliverables', 'feature', NULL, true,  false, NULL),

  ('free',       'deliverable_review', 'feature', NULL, false, false, NULL),
  ('pro',        'deliverable_review', 'feature', NULL, true,  false, NULL),
  ('business',   'deliverable_review', 'feature', NULL, true,  false, NULL),
  ('enterprise', 'deliverable_review', 'feature', NULL, true,  false, NULL),

  ('free',       'change_requests', 'feature', NULL, false, false, NULL),
  ('pro',        'change_requests', 'feature', NULL, true,  false, NULL),
  ('business',   'change_requests', 'feature', NULL, true,  false, NULL),
  ('enterprise', 'change_requests', 'feature', NULL, true,  false, NULL),

  ('free',       'risks', 'feature', NULL, false, false, NULL),
  ('pro',        'risks', 'feature', NULL, true,  false, NULL),
  ('business',   'risks', 'feature', NULL, true,  false, NULL),
  ('enterprise', 'risks', 'feature', NULL, true,  false, NULL),

  ('free',       'decisions', 'feature', NULL, false, false, NULL),
  ('pro',        'decisions', 'feature', NULL, true,  false, NULL),
  ('business',   'decisions', 'feature', NULL, true,  false, NULL),
  ('enterprise', 'decisions', 'feature', NULL, true,  false, NULL),

  ('free',       'custom_register_fields', 'feature', NULL, false, false, NULL),
  ('pro',        'custom_register_fields', 'feature', NULL, false, false, NULL),
  ('business',   'custom_register_fields', 'feature', NULL, false, false, NULL),
  ('enterprise', 'custom_register_fields', 'feature', NULL, true,  false, NULL),

  ('free',       'time_tracking', 'feature', NULL, false, false, NULL),
  ('pro',        'time_tracking', 'feature', NULL, true,  false, NULL),
  ('business',   'time_tracking', 'feature', NULL, true,  false, NULL),
  ('enterprise', 'time_tracking', 'feature', NULL, true,  false, NULL),

  ('free',       'private_teams_guests', 'feature', NULL, false, false, NULL),
  ('pro',        'private_teams_guests', 'feature', NULL, false, false, NULL),
  ('business',   'private_teams_guests', 'feature', NULL, true,  false, NULL),
  ('enterprise', 'private_teams_guests', 'feature', NULL, true,  false, NULL),

  ('free',       'roles_permissions', 'feature', NULL, false, false, NULL),
  ('pro',        'roles_permissions', 'feature', NULL, false, false, NULL),
  ('business',   'roles_permissions', 'feature', NULL, true,  false, NULL),
  ('enterprise', 'roles_permissions', 'feature', NULL, true,  false, 'Granular'),

  ('free',       'activity_retention_days', 'days', 7,    NULL, false, NULL),
  ('pro',        'activity_retention_days', 'days', 90,   NULL, false, NULL),
  ('business',   'activity_retention_days', 'days', NULL, NULL, false, NULL),
  ('enterprise', 'activity_retention_days', 'days', NULL, NULL, false, NULL),

  ('free',       'activity_export', 'feature', NULL, false, false, NULL),
  ('pro',        'activity_export', 'feature', NULL, false, false, NULL),
  ('business',   'activity_export', 'feature', NULL, false, false, NULL),
  ('enterprise', 'activity_export', 'feature', NULL, true,  false, NULL),

  ('free',       'mcp_server', 'feature', NULL, false, false, NULL),
  ('pro',        'mcp_server', 'feature', NULL, true,  false, NULL),
  ('business',   'mcp_server', 'feature', NULL, true,  false, NULL),
  ('enterprise', 'mcp_server', 'feature', NULL, true,  false, 'Higher limits'),

  ('free',       'saml_scim', 'feature', NULL, false, false, NULL),
  ('pro',        'saml_scim', 'feature', NULL, false, false, NULL),
  ('business',   'saml_scim', 'feature', NULL, false, false, NULL),
  ('enterprise', 'saml_scim', 'feature', NULL, true,  false, NULL)
ON CONFLICT (plan, limit_key) DO NOTHING;

-- ── 5. Complimentary plan columns on workspaces ─────────────────────────────

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS is_discounted_free boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discounted_plan text,
  ADD COLUMN IF NOT EXISTS discounted_at timestamptz,
  ADD COLUMN IF NOT EXISTS discounted_until timestamptz;

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_discounted_plan_check;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_discounted_plan_check
  CHECK (discounted_plan IS NULL OR discounted_plan IN ('pro', 'business', 'enterprise'));

-- The flag and the plan move together, and a cleared comp leaves no dates
-- behind (admin_clear_workspace_comp NULLs all four).
ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_discount_consistency;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_discount_consistency
  CHECK (
    is_discounted_free = (discounted_plan IS NOT NULL)
    AND (is_discounted_free OR (discounted_at IS NULL AND discounted_until IS NULL))
  );

COMMENT ON COLUMN public.workspaces.is_discounted_free IS
  'True while the workspace holds a complimentary plan granted by Proyekto staff. Written only by admin_set_workspace_comp / admin_clear_workspace_comp; who and why are in platform_admin_audit_log.';
COMMENT ON COLUMN public.workspaces.discounted_plan IS
  'The complimentary tier: pro, business or enterprise. NULL exactly when is_discounted_free is false.';
COMMENT ON COLUMN public.workspaces.discounted_at IS
  'When the current complimentary plan was first granted. Kept across edits of an active comp.';
COMMENT ON COLUMN public.workspaces.discounted_until IS
  'When the complimentary plan lapses. NULL = no expiry. A lapsed comp stays on the row but stops counting (workspace_plan_state.comp_active).';

-- ── 6. Guard on the comp columns, and the write revoke ──────────────────────
-- INVOKER on purpose: current_user is then the PostgREST role (anon,
-- authenticated or service_role), which is exactly what the guard asks about.
-- Trigger functions are not EXECUTE-checked at fire time, so the revoke below
-- does not stop it firing for authenticated.

CREATE OR REPLACE FUNCTION public.workspaces_discount_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND (
       (TG_OP = 'INSERT' AND (
          NEW.is_discounted_free
          OR NEW.discounted_plan IS NOT NULL
          OR NEW.discounted_at IS NOT NULL
          OR NEW.discounted_until IS NOT NULL))
    OR (TG_OP = 'UPDATE' AND
          (NEW.is_discounted_free, NEW.discounted_plan, NEW.discounted_at, NEW.discounted_until)
          IS DISTINCT FROM
          (OLD.is_discounted_free, OLD.discounted_plan, OLD.discounted_at, OLD.discounted_until))
  ) THEN
    RAISE EXCEPTION 'Complimentary plan fields are managed by Proyekto staff'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.workspaces_discount_guard() IS
  'Rejects any anon/authenticated write to the complimentary plan columns. Second line behind the workspaces write revoke; the admin RPCs run as service_role.';

DROP TRIGGER IF EXISTS trg_workspaces_discount_guard ON public.workspaces;
CREATE TRIGGER trg_workspaces_discount_guard
BEFORE INSERT OR UPDATE OF is_discounted_free, discounted_plan, discounted_at, discounted_until
ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.workspaces_discount_guard();

-- Restores the "writes are service-role only" intent of 20260902090000. The
-- workspaces_update / workspaces_delete policies stay as dormant documentation
-- of who may write; the API remains the only write path.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.workspaces FROM authenticated;

-- ── 7. platform_admin_audit_log ─────────────────────────────────────────────
-- Staff actions on platform-wide state. Actions today: plan_limits.updated,
-- workspace_comp.granted, workspace_comp.updated, workspace_comp.revoked.

CREATE TABLE IF NOT EXISTS public.platform_admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  -- No FK: the ledger must outlive the workspace (the billing_webhook_events
  -- precedent). NULL for matrix-wide actions such as plan_limits.updated.
  target_id uuid,
  before jsonb,
  after jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_admin_audit_log_action_format
    CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
  CONSTRAINT platform_admin_audit_log_target_type_check
    CHECK (target_type IN ('plan_limits', 'workspace')),
  CONSTRAINT platform_admin_audit_log_note_length
    CHECK (note IS NULL OR char_length(note) <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_target
  ON public.platform_admin_audit_log (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_actor
  ON public.platform_admin_audit_log (actor_id);

COMMENT ON TABLE public.platform_admin_audit_log IS
  'Append-only record of Proyekto staff actions on platform-wide state (plan limits, complimentary plans): who, what, before/after, and why. Service-role only; no browser reads it.';

-- ── 8. RLS and grants on the new tables ─────────────────────────────────────
-- ZERO policies on purpose: see the header.

ALTER TABLE public.plan_limit_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admin_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.plan_limit_keys FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.plan_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_admin_audit_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.plan_limit_keys TO service_role;
GRANT ALL ON TABLE public.plan_limits TO service_role;
GRANT ALL ON TABLE public.platform_admin_audit_log TO service_role;

-- ── 9. Read functions ───────────────────────────────────────────────────────

-- The default-workspace rule, identical to provision_default_workspace and
-- WorkspacesService.findDefaultWorkspaceId: earliest owner-role membership by
-- (joined_at, workspace_id). NULL for anyone who owns no workspace (guests).
CREATE OR REPLACE FUNCTION public.user_default_workspace_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT wm.workspace_id
  FROM public.workspace_members wm
  WHERE wm.user_id = p_user_id
    AND wm.role = 'owner'
  ORDER BY wm.joined_at, wm.workspace_id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.user_default_workspace_id(uuid) IS
  'A user''s default workspace: earliest owner membership by (joined_at, workspace_id). Same rule as provision_default_workspace and WorkspacesService.findDefaultWorkspaceId. NULL when the user owns none.';

-- The effective-plan rule, defined once (see the header). One row per id that
-- names an existing workspace; unknown ids are dropped, duplicates collapse.
CREATE OR REPLACE FUNCTION public.workspace_plan_state(p_workspace_ids uuid[])
RETURNS TABLE (
  workspace_id uuid,
  workspace_name text,
  workspace_slug text,
  subscription_plan text,
  subscription_status text,
  has_provider_subscription boolean,
  is_discounted_free boolean,
  discounted_plan text,
  discounted_at timestamptz,
  discounted_until timestamptz,
  comp_active boolean,
  effective_plan text,
  plan_source text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT
      w.id AS ws_id,
      w.name AS ws_name,
      w.slug AS ws_slug,
      COALESCE(s.plan, 'free') AS sub_plan,
      s.status AS sub_status,
      (s.provider_subscription_id IS NOT NULL) AS has_provider,
      w.is_discounted_free AS disc_flag,
      w.discounted_plan AS disc_plan,
      w.discounted_at AS disc_at,
      w.discounted_until AS disc_until,
      (w.is_discounted_free
        AND (w.discounted_until IS NULL OR w.discounted_until > now())) AS comp_on,
      CASE
        WHEN s.status IN ('active', 'trialing', 'past_due') THEN s.plan
        ELSE 'free'
      END AS paid_plan
    FROM (SELECT DISTINCT u.id FROM unnest(p_workspace_ids) AS u(id)) AS ids
    JOIN public.workspaces w ON w.id = ids.id
    LEFT JOIN public.workspace_subscriptions s ON s.workspace_id = w.id
  ),
  ranked AS (
    SELECT
      b.*,
      CASE WHEN b.comp_on THEN b.disc_plan ELSE 'free' END AS comp_plan
    FROM base b
  )
  SELECT
    r.ws_id,
    r.ws_name,
    r.ws_slug,
    r.sub_plan,
    r.sub_status,
    r.has_provider,
    r.disc_flag,
    r.disc_plan,
    r.disc_at,
    r.disc_until,
    r.comp_on,
    CASE
      WHEN public.plan_rank(r.comp_plan) > public.plan_rank(r.paid_plan) THEN r.comp_plan
      ELSE r.paid_plan
    END,
    CASE
      WHEN r.comp_on AND public.plan_rank(r.comp_plan) > public.plan_rank(r.paid_plan)
        THEN 'complimentary'
      WHEN r.paid_plan <> 'free' THEN 'subscription'
      ELSE 'default'
    END
  FROM ranked r;
$$;

COMMENT ON FUNCTION public.workspace_plan_state(uuid[]) IS
  'The single definition of a workspace''s effective plan. comp_active = flag AND (until IS NULL OR until > now()); paid = subscription plan while active/trialing/past_due, else free (no row = free); effective = higher plan_rank of the two; plan_source = complimentary only when the comp outranks paid, subscription when paid <> free, else default. subscription_plan is the raw row value (free when there is no row).';

-- Status-agnostic on purpose: archived projects and teams count, so archiving
-- cannot be used to dodge a limit.
CREATE OR REPLACE FUNCTION public.workspace_usage_counts(p_workspace_ids uuid[])
RETURNS TABLE (
  workspace_id uuid,
  members integer,
  pending_invites integer,
  projects integer,
  teams integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    w.id,
    (SELECT count(*)
       FROM public.workspace_members m
      WHERE m.workspace_id = w.id)::integer,
    (SELECT count(*)
       FROM public.workspace_invites i
      WHERE i.workspace_id = w.id
        AND i.status = 'pending')::integer,
    (SELECT count(*)
       FROM public.projects p
      WHERE p.workspace_id = w.id
        AND NOT EXISTS (
          SELECT 1 FROM public.personal_projects pp WHERE pp.project_id = p.id
        ))::integer,
    (SELECT count(*)
       FROM public.teams t
      WHERE t.workspace_id = w.id
        AND NOT t.is_personal)::integer
  FROM (SELECT DISTINCT u.id FROM unnest(p_workspace_ids) AS u(id)) AS ids
  JOIN public.workspaces w ON w.id = ids.id;
$$;

COMMENT ON FUNCTION public.workspace_usage_counts(uuid[]) IS
  'Per-workspace usage for plan limits: members, pending invites, projects (excluding personal projects) and teams (excluding personal teams). All statuses count.';

-- A workspace's roadmaps are those of its projects plus unlinked drafts whose
-- owner's default workspace is this one (the same attribution
-- entitlement_subject uses). Unlinked drafts are pre-filtered to this
-- workspace's owners before user_default_workspace_id runs.
CREATE OR REPLACE FUNCTION public.workspace_largest_roadmaps(
  p_workspace_id uuid,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  roadmap_id uuid,
  name text,
  project_id uuid,
  project_title text,
  owner_id uuid,
  nodes integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH candidates AS (
    SELECT r.id AS rid, r.name AS rname, r.project_id AS pid, p.title AS ptitle, r.owner_id AS owner_uid
    FROM public.roadmaps r
    JOIN public.projects p ON p.id = r.project_id
    WHERE p.workspace_id = p_workspace_id
    UNION ALL
    SELECT r.id, r.name, NULL::uuid, NULL::text, r.owner_id
    FROM public.roadmaps r
    WHERE r.project_id IS NULL
      AND r.owner_id IN (
        SELECT m.user_id
        FROM public.workspace_members m
        WHERE m.workspace_id = p_workspace_id
          AND m.role = 'owner'
      )
      AND public.user_default_workspace_id(r.owner_id) = p_workspace_id
  )
  SELECT
    c.rid,
    c.rname,
    c.pid,
    c.ptitle,
    c.owner_uid,
    (COALESCE(k.epics, 0) + COALESCE(k.features, 0) + COALESCE(k.tasks, 0))::integer AS node_total
  FROM candidates c
  LEFT JOIN public.ai_context_roadmap_counts(ARRAY(SELECT c2.rid FROM candidates c2)) k
    ON k.roadmap_id = c.rid
  ORDER BY node_total DESC, c.rid
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 100);
$$;

COMMENT ON FUNCTION public.workspace_largest_roadmaps(uuid, integer) IS
  'The workspace''s roadmaps (its projects'' plus unlinked drafts attributed by the owner''s default workspace) ordered by node count DESC. nodes = epics + features + tasks; milestones excluded. p_limit clamped to 1..100.';

-- Which workspace's plan governs a write, without provisioning anything
-- (unlike WorkspacesService.resolveWorkspaceForWrite). Always one row.
--   project / team: its workspace_id. NULL => unhomed (Free), exempt only when
--     the owner is a guest.
--   roadmap: linked => exactly its project's answer; unlinked =>
--     user_default_workspace_id(owner), exempt when the owner is a guest and
--     owns no workspace.
-- plpgsql only to reject an unknown kind; the OUT column "found" is never
-- assigned as a variable (it would alias plpgsql's FOUND), RETURN QUERY fills
-- the row positionally.
CREATE OR REPLACE FUNCTION public.entitlement_subject(p_kind text, p_id uuid)
RETURNS TABLE (
  found boolean,
  workspace_id uuid,
  exempt boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('project', 'team', 'roadmap') THEN
    RAISE EXCEPTION 'entitlement_subject_unknown_kind' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH hit AS (
    SELECT p.workspace_id AS ws_id, COALESCE(pr.is_guest, false) AS owner_guest
    FROM public.projects p
    LEFT JOIN public.profiles pr ON pr.id = p.owner_id
    WHERE p_kind = 'project' AND p.id = p_id
    UNION ALL
    SELECT t.workspace_id, COALESCE(pr.is_guest, false)
    FROM public.teams t
    LEFT JOIN public.profiles pr ON pr.id = t.owner_id
    WHERE p_kind = 'team' AND t.id = p_id
    UNION ALL
    SELECT
      CASE
        WHEN r.project_id IS NOT NULL THEN p.workspace_id
        ELSE public.user_default_workspace_id(r.owner_id)
      END,
      CASE
        WHEN r.project_id IS NOT NULL THEN COALESCE(ppr.is_guest, false)
        ELSE COALESCE(rpr.is_guest, false)
      END
    FROM public.roadmaps r
    LEFT JOIN public.projects p ON p.id = r.project_id
    LEFT JOIN public.profiles ppr ON ppr.id = p.owner_id
    LEFT JOIN public.profiles rpr ON rpr.id = r.owner_id
    WHERE p_kind = 'roadmap' AND r.id = p_id
  )
  SELECT
    (h.owner_guest IS NOT NULL),
    h.ws_id,
    COALESCE(h.ws_id IS NULL AND h.owner_guest, false)
  FROM (SELECT 1) AS one
  LEFT JOIN hit h ON true
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.entitlement_subject(text, uuid) IS
  'Resolves the workspace whose plan governs a project, team or roadmap. Read-only: never provisions. found=false when the row does not exist; workspace_id NULL and exempt=false means unhomed (Free); exempt=true only for guest-owned rows with no workspace.';

-- ── 10. Admin functions ─────────────────────────────────────────────────────

-- The staff workspace list. Pages first, then counts usage for the page only.
-- The caller escapes \ % _ in p_search; the default ILIKE escape is \.
-- 'comped' = holds a comp row (including a lapsed one, so staff can tidy it),
-- 'paid' = plan_source subscription, 'free' = effective plan free.
CREATE OR REPLACE FUNCTION public.admin_list_workspaces(
  p_search text,
  p_filter text,
  p_limit integer,
  p_offset integer
)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  created_at timestamptz,
  owner_id uuid,
  owner_email text,
  members integer,
  pending_invites integer,
  projects integer,
  teams integer,
  subscription_plan text,
  subscription_status text,
  has_provider_subscription boolean,
  is_discounted_free boolean,
  discounted_plan text,
  discounted_at timestamptz,
  discounted_until timestamptz,
  effective_plan text,
  plan_source text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_needle text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_filter text := COALESCE(NULLIF(btrim(p_filter), ''), 'all');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF v_filter NOT IN ('all', 'comped', 'paid', 'free') THEN
    RAISE EXCEPTION 'admin_list_workspaces_invalid_filter' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH state AS (
    SELECT st.*
    FROM public.workspace_plan_state(ARRAY(SELECT w0.id FROM public.workspaces w0)) st
  ),
  primary_owner AS (
    SELECT DISTINCT ON (m.workspace_id)
      m.workspace_id AS ws_id,
      m.user_id AS uid,
      pr.email AS mail
    FROM public.workspace_members m
    LEFT JOIN public.profiles pr ON pr.id = m.user_id
    WHERE m.role = 'owner'
    ORDER BY m.workspace_id, m.joined_at, m.user_id
  ),
  page AS (
    SELECT
      w.id AS ws_id,
      w.name AS ws_name,
      w.slug AS ws_slug,
      w.created_at AS ws_created_at,
      po.uid AS owner_uid,
      po.mail AS owner_mail,
      s.subscription_plan AS sub_plan,
      s.subscription_status AS sub_status,
      s.has_provider_subscription AS has_provider,
      s.is_discounted_free AS disc_flag,
      s.discounted_plan AS disc_plan,
      s.discounted_at AS disc_at,
      s.discounted_until AS disc_until,
      s.effective_plan AS eff_plan,
      s.plan_source AS src,
      count(*) OVER () AS total
    FROM public.workspaces w
    JOIN state s ON s.workspace_id = w.id
    LEFT JOIN primary_owner po ON po.ws_id = w.id
    WHERE (
        v_needle IS NULL
        OR w.name ILIKE '%' || v_needle || '%'
        OR w.slug ILIKE '%' || v_needle || '%'
        OR EXISTS (
          SELECT 1
          FROM public.workspace_members om
          JOIN public.profiles op ON op.id = om.user_id
          WHERE om.workspace_id = w.id
            AND om.role = 'owner'
            AND op.email ILIKE '%' || v_needle || '%'
        )
      )
      AND CASE v_filter
            WHEN 'comped' THEN s.is_discounted_free
            WHEN 'paid' THEN s.plan_source = 'subscription'
            WHEN 'free' THEN s.effective_plan = 'free'
            ELSE true
          END
    ORDER BY w.created_at DESC, w.id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT
    pg.ws_id,
    pg.ws_name,
    pg.ws_slug,
    pg.ws_created_at,
    pg.owner_uid,
    pg.owner_mail,
    COALESCE(u.members, 0),
    COALESCE(u.pending_invites, 0),
    COALESCE(u.projects, 0),
    COALESCE(u.teams, 0),
    pg.sub_plan,
    pg.sub_status,
    pg.has_provider,
    pg.disc_flag,
    pg.disc_plan,
    pg.disc_at,
    pg.disc_until,
    pg.eff_plan,
    pg.src,
    pg.total
  FROM page pg
  LEFT JOIN LATERAL public.workspace_usage_counts(ARRAY[pg.ws_id]) u ON true
  ORDER BY pg.ws_created_at DESC, pg.ws_id;
END;
$$;

COMMENT ON FUNCTION public.admin_list_workspaces(text, text, integer, integer) IS
  'Staff workspace list with owner, usage and plan state. p_filter all|comped|paid|free (comped includes lapsed comps); p_search ILIKE on name, slug or any owner''s email (caller escapes \ % _); ordered created_at DESC, id; p_limit clamped 1..100; total_count is the pre-pagination match count.';

-- Edits existing cells only. Each element of p_changes is a full cell
-- {plan, limit_key, int_value, bool_value, per_seat, display_label}; the CHECKs
-- and the composite FK reject shape errors. The version compare truncates to
-- milliseconds because the API round-trips it through a JavaScript Date.
CREATE OR REPLACE FUNCTION public.admin_update_plan_limits(
  p_changes jsonb,
  p_actor uuid,
  p_note text,
  p_base_version timestamptz
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_version timestamptz;
  v_expected integer;
  v_updated integer;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF p_changes IS NULL
     OR jsonb_typeof(p_changes) <> 'array'
     OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'plan_limits_invalid_changes' USING ERRCODE = '22023';
  END IF;
  v_expected := jsonb_array_length(p_changes);

  -- One editor at a time, so the stale check and the write are atomic.
  PERFORM pg_advisory_xact_lock(hashtextextended('plan_limits', 0));

  SELECT max(l.updated_at) INTO v_version FROM public.plan_limits l;
  IF p_base_version IS NOT NULL
     AND date_trunc('milliseconds', v_version) > date_trunc('milliseconds', p_base_version) THEN
    RAISE EXCEPTION 'plan_limits_stale';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_changes) AS c(plan text, limit_key text)
    GROUP BY c.plan, c.limit_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'plan_limits_duplicate_cell' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.plan, x.limit_key)
  INTO v_before
  FROM (
    SELECT l.plan, l.limit_key, l.kind, l.int_value, l.bool_value, l.per_seat,
           l.display_label, l.updated_by, l.updated_at
    FROM public.plan_limits l
    JOIN jsonb_to_recordset(p_changes) AS c(plan text, limit_key text)
      ON c.plan = l.plan AND c.limit_key = l.limit_key
  ) x;

  UPDATE public.plan_limits AS l
  SET int_value = c.int_value,
      bool_value = c.bool_value,
      per_seat = COALESCE(c.per_seat, false),
      display_label = NULLIF(btrim(c.display_label), ''),
      updated_by = p_actor,
      updated_at = now()
  FROM jsonb_to_recordset(p_changes) AS c(
    plan text,
    limit_key text,
    int_value integer,
    bool_value boolean,
    per_seat boolean,
    display_label text
  )
  WHERE l.plan = c.plan
    AND l.limit_key = c.limit_key;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> v_expected THEN
    RAISE EXCEPTION 'plan_limits_unknown_cell';
  END IF;

  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.plan, x.limit_key)
  INTO v_after
  FROM (
    SELECT l.plan, l.limit_key, l.kind, l.int_value, l.bool_value, l.per_seat,
           l.display_label, l.updated_by, l.updated_at
    FROM public.plan_limits l
    JOIN jsonb_to_recordset(p_changes) AS c(plan text, limit_key text)
      ON c.plan = l.plan AND c.limit_key = l.limit_key
  ) x;

  INSERT INTO public.platform_admin_audit_log
    (actor_id, action, target_type, target_id, before, after, note)
  VALUES
    (p_actor, 'plan_limits.updated', 'plan_limits', NULL, v_before, v_after,
     NULLIF(btrim(p_note), ''));

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.admin_update_plan_limits(jsonb, uuid, text, timestamptz) IS
  'Staff edit of existing plan_limits cells, under an advisory lock. Raises plan_limits_stale when max(updated_at) is newer than p_base_version (ms precision), plan_limits_unknown_cell when a change matches no cell, plan_limits_duplicate_cell on a repeated (plan, limit_key). Writes one platform_admin_audit_log row with before/after cells; returns the rows updated.';

-- Grants or edits a comp. Re-granting a LAPSED comp is a new grant (new
-- since); editing an active one keeps its original since. Returns whether
-- anything changed; an audit row is written only then.
CREATE OR REPLACE FUNCTION public.admin_set_workspace_comp(
  p_workspace_id uuid,
  p_plan text,
  p_until timestamptz,
  p_note text,
  p_actor uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ws public.workspaces%ROWTYPE;
  v_active boolean;
  v_at timestamptz;
BEGIN
  IF p_plan IS NULL OR p_plan NOT IN ('pro', 'business', 'enterprise') THEN
    RAISE EXCEPTION 'workspace_comp_invalid_plan' USING ERRCODE = '22023';
  END IF;

  SELECT w.* INTO v_ws
  FROM public.workspaces w
  WHERE w.id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  v_active := v_ws.is_discounted_free
    AND (v_ws.discounted_until IS NULL OR v_ws.discounted_until > now());

  IF v_active
     AND v_ws.discounted_plan = p_plan
     AND v_ws.discounted_until IS NOT DISTINCT FROM p_until THEN
    RETURN false;
  END IF;

  v_at := CASE WHEN v_active THEN COALESCE(v_ws.discounted_at, now()) ELSE now() END;

  UPDATE public.workspaces AS w
  SET is_discounted_free = true,
      discounted_plan = p_plan,
      discounted_at = v_at,
      discounted_until = p_until
  WHERE w.id = p_workspace_id;

  INSERT INTO public.platform_admin_audit_log
    (actor_id, action, target_type, target_id, before, after, note)
  VALUES (
    p_actor,
    CASE WHEN v_active THEN 'workspace_comp.updated' ELSE 'workspace_comp.granted' END,
    'workspace',
    p_workspace_id,
    jsonb_build_object(
      'is_discounted_free', v_ws.is_discounted_free,
      'discounted_plan', v_ws.discounted_plan,
      'discounted_at', v_ws.discounted_at,
      'discounted_until', v_ws.discounted_until
    ),
    jsonb_build_object(
      'is_discounted_free', true,
      'discounted_plan', p_plan,
      'discounted_at', v_at,
      'discounted_until', p_until
    ),
    NULLIF(btrim(p_note), '')
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.admin_set_workspace_comp(uuid, text, timestamptz, text, uuid) IS
  'Staff grant or edit of a complimentary plan (pro|business|enterprise, optional expiry). Locks the row; raises workspace_not_found. Keeps discounted_at while the comp is active; a lapsed comp is re-granted fresh. Audits workspace_comp.granted|updated only when something changed; returns changed.';

-- Idempotent: clearing a workspace with no comp returns false and writes no
-- audit row.
CREATE OR REPLACE FUNCTION public.admin_clear_workspace_comp(
  p_workspace_id uuid,
  p_note text,
  p_actor uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ws public.workspaces%ROWTYPE;
BEGIN
  SELECT w.* INTO v_ws
  FROM public.workspaces w
  WHERE w.id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  IF NOT v_ws.is_discounted_free
     AND v_ws.discounted_plan IS NULL
     AND v_ws.discounted_at IS NULL
     AND v_ws.discounted_until IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.workspaces AS w
  SET is_discounted_free = false,
      discounted_plan = NULL,
      discounted_at = NULL,
      discounted_until = NULL
  WHERE w.id = p_workspace_id;

  INSERT INTO public.platform_admin_audit_log
    (actor_id, action, target_type, target_id, before, after, note)
  VALUES (
    p_actor,
    'workspace_comp.revoked',
    'workspace',
    p_workspace_id,
    jsonb_build_object(
      'is_discounted_free', v_ws.is_discounted_free,
      'discounted_plan', v_ws.discounted_plan,
      'discounted_at', v_ws.discounted_at,
      'discounted_until', v_ws.discounted_until
    ),
    jsonb_build_object(
      'is_discounted_free', false,
      'discounted_plan', NULL,
      'discounted_at', NULL,
      'discounted_until', NULL
    ),
    NULLIF(btrim(p_note), '')
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.admin_clear_workspace_comp(uuid, text, uuid) IS
  'Staff removal of a complimentary plan: NULLs all four columns and clears the flag. Locks the row; raises workspace_not_found. Audits workspace_comp.revoked only when something changed; returns changed.';

-- ── 11. Function grants ─────────────────────────────────────────────────────
-- Supabase default privileges hand every new function to anon and
-- authenticated, so each one is revoked explicitly.

REVOKE ALL ON FUNCTION public.plan_rank(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspaces_discount_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_default_workspace_id(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_plan_state(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_usage_counts(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_largest_roadmaps(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.entitlement_subject(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_workspaces(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_plan_limits(jsonb, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_workspace_comp(uuid, text, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_clear_workspace_comp(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.plan_rank(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspaces_discount_guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.user_default_workspace_id(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan_state(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_usage_counts(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_largest_roadmaps(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.entitlement_subject(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_workspaces(text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_plan_limits(jsonb, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_workspace_comp(uuid, text, timestamptz, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_clear_workspace_comp(uuid, text, uuid) TO service_role;

COMMIT;

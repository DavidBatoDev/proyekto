-- Platform billing: payment-provider fields on the shipped subscription
-- scaffold, plus the webhook-event ledger.
--
-- 20260902090000_workspaces_core.sql created workspace_subscriptions as a plan
-- scaffold with no processor fields. This migration wires it to a payment
-- provider WITHOUT naming one in the schema: every processor column is
-- provider_*, and billing_provider says whose ids they are. Stripe is the first
-- adapter; Polar or Paddle can be added in code (plus a widening of the
-- billing_provider CHECK) with no column renames and no data migration, and
-- rows from two providers can coexist while subscribers move between them.
--
-- Expand-only: every column is nullable or defaulted, and the one CHECK that
-- changes only widens, so no existing row can fail it.
--
-- Deliberately NOT here:
--   * a seat-count column. The provider holds the authoritative *billed*
--     quantity and Postgres holds the authoritative *used* quantity
--     (COUNT(workspace_members)); the reconcile cron compares the two. A third
--     copy would be the only one nothing validates, and therefore the only one
--     that can lie.
--   * a cross-column CHECK such as "a paid plan implies a subscription id".
--     Webhook delivery is unordered and retried, so such a constraint would turn
--     a transient ordering hiccup into a 500 on the write path. Reconciliation
--     is the integrity mechanism, not the constraint system.

BEGIN;

-- 1. Provider columns on workspace_subscriptions ---------------------------

ALTER TABLE public.workspace_subscriptions
  ADD COLUMN IF NOT EXISTS billing_provider              text,
  ADD COLUMN IF NOT EXISTS provider_customer_id          text,
  ADD COLUMN IF NOT EXISTS provider_subscription_id      text,
  ADD COLUMN IF NOT EXISTS provider_subscription_item_id text,
  ADD COLUMN IF NOT EXISTS provider_price_id             text,
  ADD COLUMN IF NOT EXISTS billing_interval              text,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS canceled_at                   timestamptz,
  ADD COLUMN IF NOT EXISTS trial_end                     timestamptz,
  ADD COLUMN IF NOT EXISTS provider_updated_at           timestamptz,
  ADD COLUMN IF NOT EXISTS last_provider_event_id        text;

-- The providers this codebase has an adapter for, or is evaluating. Adding one
-- is a one-line widening, which is the point: an unknown provider id in a row
-- would route webhooks and seat syncs nowhere.
ALTER TABLE public.workspace_subscriptions
  DROP CONSTRAINT IF EXISTS workspace_subscriptions_billing_provider_check;
ALTER TABLE public.workspace_subscriptions
  ADD CONSTRAINT workspace_subscriptions_billing_provider_check
  CHECK (billing_provider IS NULL OR billing_provider IN ('stripe', 'polar', 'paddle'));

ALTER TABLE public.workspace_subscriptions
  DROP CONSTRAINT IF EXISTS workspace_subscriptions_billing_interval_check;
ALTER TABLE public.workspace_subscriptions
  ADD CONSTRAINT workspace_subscriptions_billing_interval_check
  CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year'));

COMMENT ON COLUMN public.workspace_subscriptions.billing_provider IS
  'Whose ids the provider_* columns hold. NULL until the workspace first starts a checkout; free workspaces never touch a provider.';
COMMENT ON COLUMN public.workspace_subscriptions.provider_subscription_item_id IS
  'The single licensed seat line, for providers that model one (Stripe subscription item, Paddle price line). NULL for providers whose seat quantity lives on the subscription itself (Polar). Named explicitly rather than "the first item" so a later metered line (AI usage) can share the subscription without breaking seat sync.';
COMMENT ON COLUMN public.workspace_subscriptions.provider_updated_at IS
  'Monotonic ordering key for webhook writes. No provider guarantees event order; an update whose value is older than the stored one matches no row and is discarded.';
COMMENT ON COLUMN public.workspace_subscriptions.last_provider_event_id IS
  'Forensics only - the provider event id that last wrote this row. Never read for control flow.';

-- 2. Widen the status CHECK to Proyekto's normalized vocabulary -------------
-- The scaffold allowed only active|trialing|past_due|canceled. The normalized
-- vocabulary adds incomplete, incomplete_expired, unpaid and paused. Each
-- adapter maps its provider's statuses onto this set; one column, not a
-- per-provider status, so no reader ever has to know which vocabulary to trust.
-- Free-plan rows keep status = 'active'.

ALTER TABLE public.workspace_subscriptions
  DROP CONSTRAINT IF EXISTS workspace_subscriptions_status_check;
ALTER TABLE public.workspace_subscriptions
  ADD CONSTRAINT workspace_subscriptions_status_check
  CHECK (status IN (
    'active', 'trialing', 'past_due', 'canceled',
    'incomplete', 'incomplete_expired', 'unpaid', 'paused'
  ));

-- 3. Indexes ---------------------------------------------------------------
-- The two partial UNIQUE indexes are load-bearing: they make "two workspaces
-- sharing one provider subscription" a database error rather than a support
-- ticket. Scoped by provider because ids are only unique within one.

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_subscriptions_provider_customer
  ON public.workspace_subscriptions (billing_provider, provider_customer_id)
  WHERE provider_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_subscriptions_provider_subscription
  ON public.workspace_subscriptions (billing_provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

-- The reconcile cron's scan: only rows that actually have a subscription.
CREATE INDEX IF NOT EXISTS idx_workspace_subscriptions_reconcile
  ON public.workspace_subscriptions (updated_at)
  WHERE provider_subscription_id IS NOT NULL;

-- 4. billing_webhook_events ------------------------------------------------
-- The idempotency ledger, the retry queue, and the billing audit trail in one
-- table, for every provider. It is deliberately not project_activity_log: that
-- table's project_id is NOT NULL with an FK to projects, and a workspace-scoped
-- billing event has no project and never will.

CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  provider                 text NOT NULL
    CHECK (provider IN ('stripe', 'polar', 'paddle')),
  -- The provider's own event id. (provider, event_id) IS the idempotency key:
  -- event ids are only unique within one provider.
  event_id                 text NOT NULL,
  type                     text NOT NULL,
  api_version              text,
  -- The provider's own event timestamp, not our receive time.
  event_created_at         timestamptz NOT NULL,
  -- SET NULL, not CASCADE: the ledger must outlive the workspace, which is
  -- precisely when it is needed for a post-mortem.
  workspace_id             uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  provider_customer_id     text,
  provider_subscription_id text,
  status                   text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  attempts                 integer NOT NULL DEFAULT 0,
  error                    text,
  payload                  jsonb NOT NULL,
  received_at              timestamptz NOT NULL DEFAULT now(),
  processed_at             timestamptz,
  PRIMARY KEY (provider, event_id)
);

COMMENT ON TABLE public.billing_webhook_events IS
  'Every payment-provider webhook delivery, keyed by (provider, event_id). Claiming a row is what makes handling idempotent; rows left in received/failed are what the reconcile cron retries.';

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_pending
  ON public.billing_webhook_events (received_at)
  WHERE status IN ('received', 'failed');

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_workspace
  ON public.billing_webhook_events (workspace_id, event_created_at DESC);

-- 5. RLS and grants --------------------------------------------------------
-- workspace_subscriptions policies are unchanged: workspace_subscriptions_select
-- already covers the new columns and already calls can_manage_workspace() rather
-- than inlining an EXISTS over workspace_members, per the recursion history.
--
-- billing_webhook_events gets RLS enabled with ZERO policies. That is deny-all
-- for every role that does not bypass RLS, and service_role bypasses. This is a
-- raw payment-provider payload ledger; no browser ever reads it. The absent
-- policy is deliberate - do not "fix" it by adding one.

ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.billing_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.billing_webhook_events TO service_role;

-- 6. Dunning notification type ---------------------------------------------
-- Left email-eligible (unlike workspace_invite_received, which WorkspacesService
-- mails itself): the existing notification-email worker should send this one, so
-- there is no bespoke mailer and no risk of two emails.

INSERT INTO public.notification_types (name, category, priority, email_eligible)
VALUES ('workspace_payment_failed', 'specific', 'high', true)
ON CONFLICT (name) DO UPDATE SET email_eligible = true;

-- No backfill: every existing workspace_subscriptions row is 'free' with NULL
-- provider ids, which is exactly the intended starting state.

COMMIT;

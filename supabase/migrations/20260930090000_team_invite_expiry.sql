-- Team invites expire.
--
-- team_invites had no expiry: an invite nobody answered read "Pending" forever.
-- Finance invites already expire after 14 days (finance_invites.expires_at +
-- FinanceInvitesService.expireLapsed); team invites now follow the same rule.
--
--   * expires_at defaults to 14 days after creation. Existing rows get 14 days
--     from this migration rather than from their created_at, so pending invites
--     already in flight are not expired retroactively.
--   * 'expired' joins the status vocabulary. The service persists it lazily when
--     invites are listed (and refuses to accept a lapsed one); there is no cron.
--   * The pending-uniqueness indexes are WHERE status = 'pending', so an expired
--     row never blocks a fresh invite to the same person (Resend).

BEGIN;

ALTER TABLE public.team_invites
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL
    DEFAULT (now() + interval '14 days');

ALTER TABLE public.team_invites
  DROP CONSTRAINT IF EXISTS team_invites_status_check;
ALTER TABLE public.team_invites
  ADD CONSTRAINT team_invites_status_check
    CHECK (status IN ('pending','accepted','declined','cancelled','expired'));

COMMENT ON COLUMN public.team_invites.expires_at IS
  'When a pending invite lapses. Set to now() + 14 days on create and on resend; lapsed rows are marked expired when listed.';

COMMIT;

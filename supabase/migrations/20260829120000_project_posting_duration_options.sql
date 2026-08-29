-- Project briefs: a timeline that fits the work.
--
-- The original four buckets (<1_month, 1-3_months, 3-6_months, 6+_months) were
-- borrowed from the project-create wizard, and Timeline is one of the four
-- fields publish is blocked on. An author with two weeks of design work or an
-- eleven-month platform build had to pick a bucket that misdescribed it just to
-- get the brief live — and the board then handed consultants that wrong answer.
--
-- This widens the vocabulary and adds one option that is not a bucket at all:
-- 'custom', paired with a short free-text `duration_custom` ("about ten weeks",
-- "before our May launch"). The board keeps filtering on exact equality over the
-- known values; 'custom' is never offered as a filter, because there is nothing
-- to compare it against.
--
-- The two retired values stay valid. Rows written before this migration still
-- render, they are simply no longer offered in the picker.

ALTER TABLE public.project_postings
  DROP CONSTRAINT project_postings_duration_check;

ALTER TABLE public.project_postings
  ADD COLUMN duration_custom text;

ALTER TABLE public.project_postings
  ADD CONSTRAINT project_postings_duration_check CHECK (
    duration IS NULL OR duration IN (
      '<1_week', '1-2_weeks', '2-4_weeks', '1-3_months', '3-6_months',
      '6-12_months', '12+_months', 'ongoing', 'unsure', 'custom',
      -- Retired from the picker, kept valid for rows written before this.
      '<1_month', '6+_months'
    )
  );

-- A free-text timeline only means anything beside the option that asks for it.
-- Left behind by a change of mind it would silently contradict the bucket shown
-- next to it, so the pairing is enforced here rather than trusted to the client.
ALTER TABLE public.project_postings
  ADD CONSTRAINT project_postings_duration_custom_pairing CHECK (
    duration_custom IS NULL
    OR (duration = 'custom' AND length(trim(duration_custom)) BETWEEN 1 AND 80)
  );

COMMENT ON COLUMN public.project_postings.duration_custom IS
  'Free-text timeline, valid only when duration = ''custom''. Display only: the board filter never matches on it.';

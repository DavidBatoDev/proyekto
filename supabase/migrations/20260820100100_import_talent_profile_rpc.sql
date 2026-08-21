-- import_talent_profile(user, payload)
--
-- One transaction for a whole talent-profile import (LinkedIn PDF or CV).
--
-- Why an RPC rather than the existing per-row endpoints: the profile API has
-- exactly one batch route (PUT /profile/skills). Everything else is one row per
-- HTTP request, so a typical LinkedIn import -- 6 roles, 2 degrees, 5 certs,
-- 3 languages, 15 skills -- is ~15 sequential PostgREST calls with no shared
-- transaction. A half-failed import would leave a mangled profile the user can
-- neither see nor repair. This does it once, atomically.
--
-- SECURITY INVOKER on purpose. The backend calls it with the service-role
-- client, which is also the only role permitted to INSERT into `skills`.
-- Leaving it INVOKER means a stray client-side call stays fenced by RLS rather
-- than running with the definer's rights against an attacker-supplied p_user_id.
--
-- Import is ADDITIVE and de-duplicated, never destructive. `user_experiences`
-- and `user_educations` have no unique constraint, so a naive re-import
-- duplicates every row; but delete-then-insert (the PUT /profile/skills
-- pattern) would silently destroy entries the user typed by hand on their
-- profile page. Rows are matched case-insensitively on their natural key and
-- skipped when already present.
CREATE OR REPLACE FUNCTION public.import_talent_profile(
  p_user_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_basics          jsonb := COALESCE(p_payload -> 'basics', '{}'::jsonb);
  v_spec            jsonb := COALESCE(p_payload -> 'specialization', '{}'::jsonb);
  v_spec_category   text  := NULLIF(v_spec ->> 'category', '');
  v_skills_created  int := 0;
  v_skills_linked   int := 0;
  v_languages       int := 0;
  v_experiences     int := 0;
  v_educations      int := 0;
  v_certifications  int := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  ---------------------------------------------------------------------------
  -- 1. profiles basics
  -- The payload is the draft the user just reviewed, so it wins -- but only
  -- where it actually carries a value. A blank field never blanks a stored one.
  ---------------------------------------------------------------------------
  UPDATE public.profiles SET
    display_name = COALESCE(NULLIF(v_basics ->> 'display_name', ''), display_name),
    headline     = COALESCE(NULLIF(v_basics ->> 'headline', ''),     headline),
    bio          = COALESCE(NULLIF(v_basics ->> 'bio', ''),          bio),
    country      = COALESCE(NULLIF(v_basics ->> 'country', ''),      country),
    city         = COALESCE(NULLIF(v_basics ->> 'city', ''),         city),
    updated_at   = now()
  WHERE id = p_user_id;

  ---------------------------------------------------------------------------
  -- 2. skills -- resolve or create, then link
  --
  -- These MUST be separate statements. Data-modifying CTEs all read the same
  -- snapshot, so a `resolved` CTE joining public.skills would not see rows
  -- inserted by a sibling `created` CTE in the same statement, and every
  -- newly-created skill would silently vanish from the link step.
  --
  -- The slug transform matches the original backfill in
  -- 20251231000001_add_slug_to_skills.sql so imported names collide with
  -- seeded rows instead of shadowing them.
  ---------------------------------------------------------------------------
  CREATE TEMP TABLE _import_skills ON COMMIT DROP AS
  SELECT DISTINCT ON (slug) slug, name, lvl, yrs
  FROM (
    SELECT
      trim(e ->> 'name') AS name,
      lower(replace(trim(e ->> 'name'), ' ', '-')) AS slug,
      COALESCE(NULLIF(e ->> 'proficiency_level', ''), 'intermediate')::public.proficiency_level AS lvl,
      NULLIF(e ->> 'years_experience', '')::smallint AS yrs
    FROM jsonb_array_elements(COALESCE(p_payload -> 'skills', '[]'::jsonb)) e
    WHERE COALESCE(trim(e ->> 'name'), '') <> ''
  ) s
  ORDER BY slug, name;

  WITH created AS (
    INSERT INTO public.skills (name, slug, is_user_generated)
    SELECT i.name, i.slug, true FROM _import_skills i
    ON CONFLICT (slug) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_skills_created FROM created;

  WITH linked AS (
    INSERT INTO public.user_skills (user_id, skill_id, proficiency_level, years_experience)
    SELECT p_user_id, s.id, i.lvl, i.yrs
    FROM _import_skills i
    JOIN public.skills s ON s.slug = i.slug
    ON CONFLICT (user_id, skill_id) DO UPDATE
      SET proficiency_level = EXCLUDED.proficiency_level,
          years_experience  = COALESCE(EXCLUDED.years_experience, public.user_skills.years_experience)
    RETURNING 1
  )
  SELECT count(*) INTO v_skills_linked FROM linked;

  ---------------------------------------------------------------------------
  -- 3. languages -- FK to the shared catalog, resolved by name or ISO code.
  -- Unmatched names are dropped rather than invented: `languages` is
  -- service-role-only and its UUIDs are not stable across environments.
  --
  -- The alias pass is not optional. The catalog holds ISO-639-1 English names,
  -- but people write the colloquial one on a CV -- and the mismatch is silent,
  -- because an unmatched language simply vanishes from the import. The sample
  -- LinkedIn export says "Tagalog"; the catalog calls code `tl` "Filipino", so
  -- without this the one language a Filipino user is most likely to list would
  -- be the one that never saved.
  ---------------------------------------------------------------------------
  WITH raw AS (
    SELECT
      lower(trim(e ->> 'name')) AS raw_name,
      COALESCE(NULLIF(e ->> 'fluency_level', ''), 'conversational')::public.fluency_level AS lvl
    FROM jsonb_array_elements(COALESCE(p_payload -> 'languages', '[]'::jsonb)) e
    WHERE COALESCE(trim(e ->> 'name'), '') <> ''
  ), aliased AS (
    SELECT
      CASE raw_name
        WHEN 'tagalog'          THEN 'filipino'
        WHEN 'mandarin'         THEN 'chinese'
        WHEN 'cantonese'        THEN 'chinese'
        WHEN 'farsi'            THEN 'persian'
        WHEN 'castilian'        THEN 'spanish'
        WHEN 'bahasa'           THEN 'indonesian'
        WHEN 'bahasa indonesia' THEN 'indonesian'
        WHEN 'bahasa melayu'    THEN 'malay'
        WHEN 'deutsch'          THEN 'german'
        WHEN 'espanol'          THEN 'spanish'
        WHEN 'francais'         THEN 'french'
        WHEN 'nihongo'          THEN 'japanese'
        ELSE raw_name
      END AS name,
      lvl
    FROM raw
  ), input AS (
    -- DISTINCT ON needs a matching ORDER BY, or the surviving row is arbitrary.
    SELECT DISTINCT ON (name) name, lvl FROM aliased ORDER BY name, lvl DESC
  ), ins AS (
    INSERT INTO public.user_languages (user_id, language_id, fluency_level)
    SELECT p_user_id, l.id, i.lvl
    FROM input i
    JOIN public.languages l
      ON lower(l.name) = i.name OR lower(l.code) = i.name
    ON CONFLICT (user_id, language_id) DO UPDATE
      SET fluency_level = EXCLUDED.fluency_level
    RETURNING 1
  )
  SELECT count(*) INTO v_languages FROM ins;

  ---------------------------------------------------------------------------
  -- 4. experiences -- matched on (company, title, start_date)
  ---------------------------------------------------------------------------
  WITH input AS (
    SELECT
      trim(e ->> 'company') AS company,
      trim(e ->> 'title')   AS title,
      NULLIF(e ->> 'location', '')       AS location,
      COALESCE((e ->> 'is_remote')::boolean, false) AS is_remote,
      NULLIF(e ->> 'description', '')    AS description,
      (e ->> 'start_date')::date         AS start_date,
      NULLIF(e ->> 'end_date', '')::date AS end_date,
      COALESCE((e ->> 'is_current')::boolean, false) AS is_current
    FROM jsonb_array_elements(COALESCE(p_payload -> 'experiences', '[]'::jsonb)) e
    WHERE COALESCE(trim(e ->> 'company'), '') <> ''
      AND COALESCE(trim(e ->> 'title'), '')   <> ''
      AND COALESCE(e ->> 'start_date', '')    <> ''
  ), ins AS (
    INSERT INTO public.user_experiences
      (user_id, company, title, location, is_remote, description, start_date, end_date, is_current)
    SELECT p_user_id, i.company, i.title, i.location, i.is_remote,
           i.description, i.start_date, i.end_date, i.is_current
    FROM input i
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_experiences x
      WHERE x.user_id = p_user_id
        AND lower(x.company) = lower(i.company)
        AND lower(x.title)   = lower(i.title)
        AND x.start_date     = i.start_date
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_experiences FROM ins;

  ---------------------------------------------------------------------------
  -- 5. educations -- matched on (institution, degree)
  ---------------------------------------------------------------------------
  WITH input AS (
    SELECT
      trim(e ->> 'institution') AS institution,
      NULLIF(e ->> 'degree', '')               AS degree,
      NULLIF(e ->> 'field_of_study', '')       AS field_of_study,
      NULLIF(e ->> 'start_year', '')::smallint AS start_year,
      NULLIF(e ->> 'end_year', '')::smallint   AS end_year,
      COALESCE((e ->> 'is_current')::boolean, false) AS is_current,
      NULLIF(e ->> 'description', '')          AS description
    FROM jsonb_array_elements(COALESCE(p_payload -> 'educations', '[]'::jsonb)) e
    WHERE COALESCE(trim(e ->> 'institution'), '') <> ''
  ), ins AS (
    INSERT INTO public.user_educations
      (user_id, institution, degree, field_of_study, start_year, end_year, is_current, description)
    SELECT p_user_id, i.institution, i.degree, i.field_of_study,
           i.start_year, i.end_year, i.is_current, i.description
    FROM input i
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_educations x
      WHERE x.user_id = p_user_id
        AND lower(x.institution) = lower(i.institution)
        AND lower(COALESCE(x.degree, '')) = lower(COALESCE(i.degree, ''))
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_educations FROM ins;

  ---------------------------------------------------------------------------
  -- 6. certifications -- matched on (name, issuer).
  -- issuer is nullable as of 20260820100000; LinkedIn exports omit it.
  ---------------------------------------------------------------------------
  WITH input AS (
    SELECT
      trim(e ->> 'name') AS name,
      NULLIF(e ->> 'issuer', '')            AS issuer,
      NULLIF(e ->> 'issue_date', '')::date  AS issue_date,
      NULLIF(e ->> 'expiry_date', '')::date AS expiry_date,
      NULLIF(e ->> 'credential_id', '')     AS credential_id,
      NULLIF(e ->> 'credential_url', '')    AS credential_url
    FROM jsonb_array_elements(COALESCE(p_payload -> 'certifications', '[]'::jsonb)) e
    WHERE COALESCE(trim(e ->> 'name'), '') <> ''
  ), ins AS (
    INSERT INTO public.user_certifications
      (user_id, name, issuer, issue_date, expiry_date, credential_id, credential_url)
    SELECT p_user_id, i.name, i.issuer, i.issue_date, i.expiry_date,
           i.credential_id, i.credential_url
    FROM input i
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_certifications x
      WHERE x.user_id = p_user_id
        AND lower(x.name) = lower(i.name)
        AND lower(COALESCE(x.issuer, '')) = lower(COALESCE(i.issuer, ''))
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_certifications FROM ins;

  ---------------------------------------------------------------------------
  -- 7. specialization -- one row per (user, category), guarded against a value
  -- outside the enum so a bad extraction cannot abort the entire import.
  ---------------------------------------------------------------------------
  IF v_spec_category IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM pg_enum en
       JOIN pg_type t ON t.oid = en.enumtypid
       WHERE t.typname = 'specialization_category'
         AND en.enumlabel = v_spec_category
     )
  THEN
    INSERT INTO public.user_specializations
      (user_id, category, sub_category, years_of_experience)
    VALUES (
      p_user_id,
      v_spec_category::public.specialization_category,
      NULLIF(v_spec ->> 'sub_category', ''),
      NULLIF(v_spec ->> 'years_of_experience', '')::smallint
    )
    ON CONFLICT (user_id, category) DO UPDATE
      SET sub_category        = COALESCE(EXCLUDED.sub_category, public.user_specializations.sub_category),
          years_of_experience = COALESCE(EXCLUDED.years_of_experience, public.user_specializations.years_of_experience),
          updated_at          = now();
  END IF;

  RETURN jsonb_build_object(
    'skills_created',  v_skills_created,
    'skills_linked',   v_skills_linked,
    'languages',       v_languages,
    'experiences',     v_experiences,
    'educations',      v_educations,
    'certifications',  v_certifications
  );
END;
$fn$;

COMMENT ON FUNCTION public.import_talent_profile(uuid, jsonb) IS
  'Atomically applies a reviewed profile import. Additive and de-duplicated; never deletes existing rows.';

REVOKE ALL ON FUNCTION public.import_talent_profile(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_talent_profile(uuid, jsonb) TO service_role;

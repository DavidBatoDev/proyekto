-- Repair the project_access invariants that replace projects.owner_id and
-- projects.consultant_id as chat authorization inputs, then remove those
-- fallback columns from the chat helper functions in the same transaction.

BEGIN;

INSERT INTO public.project_access (
  project_id,
  user_id,
  role,
  origin,
  has_direct_grant
)
SELECT
  p.id,
  p.consultant_id,
  'owner'::public.share_role,
  'consultant',
  true
FROM public.projects p
WHERE p.consultant_id IS NOT NULL
ON CONFLICT (project_id, user_id) DO NOTHING;

INSERT INTO public.project_access (
  project_id,
  user_id,
  role,
  origin,
  has_direct_grant
)
SELECT
  p.id,
  p.owner_id,
  'owner'::public.share_role,
  'legacy',
  true
FROM public.projects p
WHERE p.owner_id IS NOT NULL
ON CONFLICT (project_id, user_id) DO NOTHING;

UPDATE public.project_access pa
SET role = 'owner'::public.share_role,
    origin = 'consultant',
    has_direct_grant = true
FROM public.projects p
WHERE p.id = pa.project_id
  AND p.consultant_id = pa.user_id
  AND (
    pa.role IS DISTINCT FROM 'owner'::public.share_role
    OR pa.origin IS DISTINCT FROM 'consultant'
    OR pa.has_direct_grant IS DISTINCT FROM true
  );

CREATE OR REPLACE FUNCTION public.project_chat_is_member(
  target_project_id uuid,
  target_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = target_project_id
      AND pa.user_id = target_user_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.project_chat_role(
  target_project_id uuid,
  target_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  share_origin text;
BEGIN
  SELECT pa.origin
  INTO share_origin
  FROM public.project_access pa
  WHERE pa.project_id = target_project_id
    AND pa.user_id = target_user_id
  ORDER BY
    CASE WHEN pa.origin LIKE 'team:%' THEN 1 ELSE 0 END,
    pa.id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF share_origin = 'consultant' THEN
    RETURN 'consultant';
  END IF;

  IF share_origin IN ('client', 'personal_workspace', 'legacy') THEN
    RETURN 'client';
  END IF;

  RETURN 'freelancer';
END;
$function$;

CREATE OR REPLACE FUNCTION public.project_chat_users_share_any_project(
  user_a uuid,
  user_b uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_access pa
    JOIN public.project_access pb ON pb.project_id = pa.project_id
    WHERE pa.user_id = user_a
      AND pb.user_id = user_b
  );
$function$;

COMMIT;

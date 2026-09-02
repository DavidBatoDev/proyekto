-- Pin search_path on the two team-resource trigger functions.
--
-- 20260901160000 copied these bodies from the project-resource originals
-- (20260320120000), which predate the linter and leave search_path mutable —
-- Supabase's 0011_function_search_path_mutable. The two SQL predicates added in
-- that same migration (is_team_member, can_manage_team) already pin it, as do
-- get_user_project_role and is_active_consultant; these two were the gap.
--
-- Bodies below are rebuilt from 20260901160000, the newest migration defining
-- them, per the latest-function-body rule. Only the SET clause is new.

CREATE OR REPLACE FUNCTION public.validate_team_resource_link_folder_team()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_folder_team_id uuid;
BEGIN
  IF NEW.folder_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT f.team_id
  INTO v_folder_team_id
  FROM public.team_resource_folders f
  WHERE f.id = NEW.folder_id;

  IF v_folder_team_id IS NULL THEN
    RAISE EXCEPTION 'Resource folder % does not exist', NEW.folder_id
      USING ERRCODE = '23503';
  END IF;

  IF v_folder_team_id <> NEW.team_id THEN
    RAISE EXCEPTION 'Resource link folder must belong to the same team'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_team_resource_links_on_folder_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next_position integer;
BEGIN
  SELECT COALESCE(MAX(l.position) + 1, 0)
  INTO v_next_position
  FROM public.team_resource_links l
  WHERE l.team_id = OLD.team_id
    AND l.folder_id IS NULL;

  WITH links_to_move AS (
    SELECT
      l.id,
      ROW_NUMBER() OVER (ORDER BY l.position, l.created_at, l.id) - 1 AS order_idx
    FROM public.team_resource_links l
    WHERE l.team_id = OLD.team_id
      AND l.folder_id = OLD.id
  )
  UPDATE public.team_resource_links l
  SET
    folder_id = NULL,
    position = v_next_position + m.order_idx,
    updated_at = now()
  FROM links_to_move m
  WHERE l.id = m.id;

  RETURN OLD;
END;
$$;

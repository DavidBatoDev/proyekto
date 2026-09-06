-- Called only by the backend after its project roadmap.edit authorization.
-- Delete-before-link satisfies the immediate one-roadmap-per-project index;
-- both writes roll back together if anything fails.
create or replace function public.replace_project_roadmap(
  p_project_id uuid,
  p_current_roadmap_id uuid,
  p_replacement_roadmap_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current public.roadmaps%rowtype;
  v_replacement public.roadmaps%rowtype;
begin
  if p_project_id is null or p_current_roadmap_id is null
     or p_replacement_roadmap_id is null or p_user_id is null
     or p_current_roadmap_id = p_replacement_roadmap_id then
    raise exception using errcode = '22023', message = 'Choose a different replacement roadmap.';
  end if;

  -- Serialize swaps for a project and lock both roadmaps in a stable order.
  perform id from public.projects where id = p_project_id for update;
  perform id from public.roadmaps
    where id in (p_current_roadmap_id, p_replacement_roadmap_id)
    order by id for update;

  select * into v_current from public.roadmaps where id = p_current_roadmap_id;
  if not found or v_current.project_id is distinct from p_project_id then
    raise exception using errcode = '40001', message = 'The project roadmap changed. Refresh and try again.';
  end if;

  select * into v_replacement from public.roadmaps where id = p_replacement_roadmap_id;
  if not found or v_replacement.owner_id is distinct from p_user_id then
    raise exception using errcode = '22023', message = 'Replacement roadmap must be a roadmap you own.';
  end if;
  if v_replacement.project_id is not null then
    raise exception using errcode = '40001', message = 'Replacement roadmap is already linked to a project.';
  end if;

  -- The parent FOR UPDATE lock also excludes concurrent child FK inserts.
  if exists (select 1 from public.roadmap_epics where roadmap_id = p_current_roadmap_id)
     or exists (select 1 from public.roadmap_milestones where roadmap_id = p_current_roadmap_id)
     or exists (select 1 from public.roadmap_features where roadmap_id = p_current_roadmap_id) then
    raise exception using errcode = '22023', message = 'Current roadmap is not empty; only empty roadmaps can be replaced.';
  end if;

  delete from public.roadmaps where id = p_current_roadmap_id;
  update public.roadmaps
    set project_id = p_project_id, updated_at = now()
    where id = p_replacement_roadmap_id
    returning * into v_replacement;
  return to_jsonb(v_replacement);
end;
$$;

revoke all on function public.replace_project_roadmap(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.replace_project_roadmap(uuid, uuid, uuid, uuid) to service_role;

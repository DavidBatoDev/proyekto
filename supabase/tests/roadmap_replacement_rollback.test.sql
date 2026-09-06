-- Run on hosted development; all fixtures and the failure trigger roll back.
begin;

create function pg_temp.reject_roadmap_replacement() returns trigger
language plpgsql as $$
begin
  if new.name = '__replacement_rollback_fixture__' then
    raise exception 'injected replacement write failure';
  end if;
  return new;
end;
$$;

create trigger test_replacement_write_failure before update on public.roadmaps
for each row execute function pg_temp.reject_roadmap_replacement();

do $$
declare
  v_owner uuid;
  v_project uuid := gen_random_uuid();
  v_current uuid := gen_random_uuid();
  v_replacement uuid := gen_random_uuid();
begin
  select id into strict v_owner from public.profiles limit 1;
  insert into public.projects (id, owner_id, title)
    values (v_project, v_owner, '__replacement_rollback_project__');
  insert into public.roadmaps (id, owner_id, project_id, name, preview_url)
    values (v_current, v_owner, v_project, '__replacement_original__', ''),
           (v_replacement, v_owner, null, '__replacement_rollback_fixture__', '');

  begin
    perform public.replace_project_roadmap(v_project, v_current, v_replacement, v_owner);
    raise exception 'expected the replacement update to fail';
  exception when raise_exception then
    if sqlerrm <> 'injected replacement write failure' then raise; end if;
  end;

  if not exists (select 1 from public.roadmaps where id = v_current and project_id = v_project)
     or not exists (select 1 from public.roadmaps where id = v_replacement and project_id is null) then
    raise exception 'failed replacement did not restore both roadmaps';
  end if;

  update public.roadmaps set name = '__replacement_success_fixture__' where id = v_replacement;
  perform public.replace_project_roadmap(v_project, v_current, v_replacement, v_owner);
  if exists (select 1 from public.roadmaps where id = v_current)
     or not exists (select 1 from public.roadmaps where id = v_replacement and project_id = v_project)
     or (select count(*) from public.roadmaps where project_id = v_project) <> 1 then
    raise exception 'successful swap did not preserve one roadmap per project';
  end if;

  if has_function_privilege('authenticated', 'public.replace_project_roadmap(uuid,uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.replace_project_roadmap(uuid,uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'replacement function must not be callable by browser clients';
  end if;
end;
$$;

rollback;

-- ============================================================
-- 0003：ensure_my_family() RPC —— 修复多标签页/多设备同时首登
-- 重复建家的竞态问题
-- 背景：前端 ensureFamily() 是"查成员→无则建家+加成员"两步，
-- 两个并发首登（多标签页或多设备）会同时查到空、各自建家。
-- 改为 Postgres 端原子操作：advisory lock 串行化 + 双重检查。
-- 说明：阶段2每账号一个家庭；多家庭邀请流程在后续阶段扩展。
-- ============================================================

create or replace function public.ensure_my_family()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  fid uuid;
begin
  select family_id into fid
    from public.family_members
   where user_id = auth.uid()
   limit 1;
  if fid is not null then
    return fid;
  end if;

  /* 按用户串行化并发首登 */
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  select family_id into fid
    from public.family_members
   where user_id = auth.uid()
   limit 1;
  if fid is not null then
    return fid;
  end if;

  insert into public.families (owner_id, family_name)
  values (auth.uid(), '我的家庭')
  returning id into fid;

  insert into public.family_members (family_id, user_id, role)
  values (fid, auth.uid(), 'parent');

  return fid;
end;
$$;

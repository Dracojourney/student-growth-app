-- ============================================================
-- 0004：家庭邀请码 —— 阶段 3C 家庭成员加入
-- 设计原则：
--   1. 每个家庭一个 6 位邀请码（无歧义字符集，去掉 I/L/O/0/1），
--      families.invite_code 全库唯一
--   2. 加入家庭 = 排他切换：join_family_by_code 把调用者成员关系
--      切换到目标家庭；调用者原来自建的家庭若无其他成员则级联删除
--      （孤儿家庭清理，防止 ensure_my_family 自动建家残留）；
--      若原家庭还有其他成员则拒绝加入，避免误伤他人数据
--   3. 前端配合：加入成功后本机业务数据被目标家庭云端数据整体替换，
--      绝不反向推送（由 sync.js 的 adoptCloudOnce 游标保证）
--   4. 跨家庭数据隔离继续由 family_id + RLS 保证，本迁移不改变
--      任何业务表策略
--   5. family_members 增加 email 冗余列，便于成员列表展示
--      （security definer 函数可读 auth.users；普通 authenticated
--      无法跨家庭读到他人邮箱，fm_read 策略限同家庭可见）
-- ============================================================

-- ---------- 结构变更 ----------
alter table public.families add column if not exists invite_code text;
alter table public.family_members add column if not exists email text;

-- 成员邮箱回填（迁移以 postgres 角色执行，可读 auth.users）
update public.family_members m
   set email = u.email
  from auth.users u
 where m.user_id = u.id
   and m.email is null;

-- ---------- 邀请码生成（6 位无歧义码，冲突自动重试）----------
create or replace function public._gen_invite_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.families where invite_code = code);
  end loop;
  return code;
end;
$$;

-- 存量家庭回填邀请码
update public.families set invite_code = public._gen_invite_code() where invite_code is null;

alter table public.families alter column invite_code set not null;
alter table public.families alter column invite_code set default public._gen_invite_code();
alter table public.families add constraint families_invite_code_key unique (invite_code);

-- ---------- ensure_my_family 升级：写入成员邮箱 ----------
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

  insert into public.family_members (family_id, user_id, role, email)
  values (fid, auth.uid(), 'parent', (select email from auth.users where id = auth.uid()));

  return fid;
end;
$$;

-- ---------- 通过邀请码加入家庭（排他切换 + 孤儿家庭清理）----------
create or replace function public.join_family_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  cur uuid;
  cur_owner uuid;
  other_members int;
begin
  if auth.uid() is null then
    raise exception '请先登录';
  end if;

  select id into target
    from public.families
   where invite_code = upper(trim(coalesce(p_code, '')));
  if target is null then
    raise exception '邀请码无效，请核对后重试';
  end if;

  /* 已是目标家庭成员：幂等返回 */
  if exists (select 1 from public.family_members
              where family_id = target and user_id = auth.uid()) then
    return target;
  end if;

  /* 按用户串行化并发加入（与 ensure_my_family 不同的锁键，互不干扰） */
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 1));

  /* 加锁后复查 */
  if exists (select 1 from public.family_members
              where family_id = target and user_id = auth.uid()) then
    return target;
  end if;

  select family_id into cur
    from public.family_members
   where user_id = auth.uid()
   limit 1;

  if cur is not null and cur <> target then
    select owner_id into cur_owner from public.families where id = cur;
    if cur_owner = auth.uid() then
      select count(*) into other_members
        from public.family_members
       where family_id = cur and user_id <> auth.uid();
      if other_members > 0 then
        raise exception '您当前家庭已有其他成员，无法加入新家庭';
      end if;
      /* 级联删除孤儿家庭：member/children/流水/打卡/兑换/配置随之外键清理 */
      delete from public.families where id = cur;
    else
      /* 调用者只是原家庭普通成员：退出原家庭，家庭本身保留 */
      delete from public.family_members
       where family_id = cur and user_id = auth.uid();
    end if;
  end if;

  insert into public.family_members (family_id, user_id, role, email)
  values (target, auth.uid(), 'parent',
          (select email from auth.users where id = auth.uid()));

  return target;
end;
$$;

-- ---------- 重置邀请码（仅家庭创建者）----------
create or replace function public.regenerate_my_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fid uuid;
  code text;
begin
  select id into fid from public.families where owner_id = auth.uid() limit 1;
  if fid is null then
    raise exception '只有家庭创建者可以重置邀请码';
  end if;
  code := public._gen_invite_code();
  update public.families set invite_code = code where id = fid;
  return code;
end;
$$;

-- ---------- 权限 ----------
grant execute on function public._gen_invite_code() to authenticated;
grant execute on function public.join_family_by_code(text) to authenticated;
grant execute on function public.regenerate_my_invite_code() to authenticated;
revoke execute on function public.join_family_by_code(text) from anon;
revoke execute on function public.regenerate_my_invite_code() from anon;

-- ============================================================
-- 儿童家庭习惯打卡 PWA · Supabase 初始化迁移（阶段 1）
-- 设计原则：
--   1. 一个家庭 = 一个登录账号组；所有业务表带 family_id
--   2. RLS 全表启用，仅放行"本家庭成员"，anon 角色零策略=全拒绝
--   3. client_id 为本地应用生成的记录 ID（如 p_<ts>_<rand>），
--      用 (family_id, child_id, client_id) 唯一约束做幂等键，
--      防止多设备重复导入
--   4. 删除孩子 → 级联删除其流水/打卡/兑换/配置，与本地
--      deleteChild 语义一致
-- ============================================================

-- ---------- 家庭与成员 ----------
create table public.families (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  family_name text,
  created_at  timestamptz not null default now()
);

create table public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'parent' check (role in ('parent')),
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

-- ---------- 孩子（保留本地 id 语义）----------
create table public.children (
  family_id  uuid not null references public.families(id) on delete cascade,
  child_id   text not null,
  name       text not null,
  gender     text,
  grade      text,
  avatar     text,
  banner     text,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, child_id)
);

-- ---------- 积分流水（追加式；余额由流水推导）----------
create table public.points_ledger (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  child_id    text not null,
  client_id   text not null,
  type        text not null check (type in ('earn','bonus','initial','spend','revoke')),
  amount      int  not null,
  description text,
  reason      text,
  ref_id      text,
  revoked     boolean not null default false,
  occurred_at timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (family_id, child_id, client_id),
  foreign key (family_id, child_id) references public.children(family_id, child_id) on delete cascade
);

-- ---------- 每日打卡（撤销 = completed 置 false 留痕）----------
create table public.checkins (
  family_id         uuid not null references public.families(id) on delete cascade,
  child_id          text not null,
  day               date not null,
  task_id           text not null,
  completed         boolean not null default true,
  points            int not null,
  option            text,
  history_client_id text,
  client_updated_at timestamptz not null,
  primary key (family_id, child_id, day, task_id),
  foreign key (family_id, child_id) references public.children(family_id, child_id) on delete cascade
);

-- ---------- 兑换记录（含奖励名/积分快照）----------
create table public.redemptions (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  child_id    text not null,
  client_id   text not null,
  reward_id   text,
  name        text not null,
  cost        int not null,
  status      text not null default 'done',
  occurred_at timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (family_id, child_id, client_id),
  foreign key (family_id, child_id) references public.children(family_id, child_id) on delete cascade
);

-- ---------- 每孩子任务配置（overrides/custom/order/gradeGoal）----------
create table public.child_task_config (
  family_id  uuid not null references public.families(id) on delete cascade,
  child_id   text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (family_id, child_id),
  foreign key (family_id, child_id) references public.children(family_id, child_id) on delete cascade
);

-- ---------- 家庭共享奖励配置（overrides/custom/order）----------
create table public.family_reward_config (
  family_id  uuid primary key references public.families(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- 家庭设置（PIN 哈希、迁移标记）----------
create table public.family_settings (
  family_id       uuid primary key references public.families(id) on delete cascade,
  pin_hash        text,
  pin_salt        text,
  migration_state jsonb,
  updated_at      timestamptz not null default now()
);

-- ---------- 索引 ----------
create index idx_ledger_child  on public.points_ledger (family_id, child_id, created_at desc);
create index idx_checkins_day  on public.checkins      (family_id, child_id, day desc);
create index idx_redemptions_t on public.redemptions   (family_id, child_id, occurred_at desc);

-- ============================================================
-- RLS：成员判定 + 全表策略
-- ============================================================

-- SECURITY DEFINER 辅助函数：绕过 RLS 查询成员表，避免策略递归
create or replace function public.is_family_member(fid uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.family_members m
    where m.family_id = fid and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_family_owner(fid uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.families f
    where f.id = fid and f.owner_id = auth.uid()
  );
$$;

-- families：拥有者全权；成员可读
alter table public.families enable row level security;
create policy families_owner_rw on public.families for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy families_member_read on public.families for select
  using (public.is_family_member(id));

-- family_members：读自己或同家庭；加入仅限自己创建的家庭（邀请流程后续阶段实现）
alter table public.family_members enable row level security;
create policy fm_read on public.family_members for select
  using (user_id = auth.uid() or public.is_family_member(family_id));
create policy fm_join on public.family_members for insert
  with check (user_id = auth.uid() and public.is_family_owner(family_id));
create policy fm_leave on public.family_members for delete
  using (user_id = auth.uid() or public.is_family_owner(family_id));

-- 业务表：统一"本家庭成员可读写"，anon 无策略=全拒绝
alter table public.children            enable row level security;
alter table public.points_ledger       enable row level security;
alter table public.checkins            enable row level security;
alter table public.redemptions         enable row level security;
alter table public.child_task_config   enable row level security;
alter table public.family_reward_config enable row level security;
alter table public.family_settings     enable row level security;

create policy children_rw on public.children for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy ledger_rw on public.points_ledger for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy checkins_rw on public.checkins for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy redemptions_rw on public.redemptions for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy task_config_rw on public.child_task_config for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy reward_config_rw on public.family_reward_config for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy settings_rw on public.family_settings for all
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

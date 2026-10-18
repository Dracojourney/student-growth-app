-- ============================================================
-- 0002：children.points 余额列 + 流水重算触发器
-- 余额唯一来源 = points_ledger（+earn/bonus/initial，-spend/revoke），
-- 触发器在流水变化后重算，多设备推送只需合并流水即可保证余额一致。
-- ============================================================

alter table public.children add column if not exists points int not null default 0;

create or replace function public.recompute_child_points(p_family uuid, p_child text)
returns void
language sql security definer
set search_path = public as $$
  update public.children c
     set points = coalesce((
       select sum(case when l.type in ('earn','bonus','initial') then l.amount else -l.amount end)
       from public.points_ledger l
       where l.family_id = p_family and l.child_id = p_child
     ), 0)
   where c.family_id = p_family and c.child_id = p_child;
$$;

create or replace function public.trg_recompute_points()
returns trigger
language plpgsql security definer
set search_path = public as $$
begin
  perform public.recompute_child_points(
    coalesce(new.family_id, old.family_id),
    coalesce(new.child_id, old.child_id));
  return null;
end;
$$;

drop trigger if exists trg_points_ledger_recalc on public.points_ledger;
create trigger trg_points_ledger_recalc
after insert or update or delete on public.points_ledger
for each row execute function public.trg_recompute_points();

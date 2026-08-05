-- Агрегаты товарной аналитики: по блюдам и по категориям за период.
-- security invoker: доступ к данным по-прежнему регулируется RLS dish_sales_daily.

create or replace function public.dish_sales_summary(
  p_from date,
  p_to date,
  p_unit uuid default null
)
returns table (
  dish_id text,
  dish_name text,
  category text,
  quantity numeric,
  revenue numeric,
  cost numeric,
  attach_revenue numeric,
  avg_wait_seconds numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select *
    from dish_sales_daily
    where sale_date between p_from and p_to
      and (p_unit is null or business_unit_id = p_unit)
  ),
  dishes as (
    select
      d.dish_id,
      max(d.dish_name) as dish_name,
      max(d.category) as category,
      sum(d.quantity) as quantity,
      sum(d.revenue) as revenue,
      sum(d.cost) as cost,
      sum(d.avg_guest_wait_seconds * d.quantity)
        filter (where d.avg_guest_wait_seconds is not null and d.quantity > 0) as wait_weighted,
      sum(d.quantity)
        filter (where d.avg_guest_wait_seconds is not null and d.quantity > 0) as wait_quantity
    from base d
    where d.dish_type = 'DISH'
    group by d.dish_id
  ),
  mods as (
    select m.main_dish_id as dish_id, sum(m.revenue) as attach_revenue
    from base m
    where m.dish_type = 'MODIFIER' and m.main_dish_id is not null
    group by m.main_dish_id
  )
  select
    d.dish_id,
    d.dish_name,
    d.category,
    d.quantity,
    d.revenue,
    d.cost,
    coalesce(m.attach_revenue, 0) as attach_revenue,
    case when d.wait_quantity > 0 then d.wait_weighted / d.wait_quantity end as avg_wait_seconds
  from dishes d
  left join mods m on m.dish_id = d.dish_id
$$;

create or replace function public.dish_sales_category_summary(
  p_from date,
  p_to date,
  p_unit uuid default null
)
returns table (
  category text,
  dish_type text,
  quantity numeric,
  revenue numeric,
  cost numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.category,
    s.dish_type,
    sum(s.quantity) as quantity,
    sum(s.revenue) as revenue,
    sum(s.cost) as cost
  from dish_sales_daily s
  where s.sale_date between p_from and p_to
    and (p_unit is null or s.business_unit_id = p_unit)
  group by s.category, s.dish_type
$$;

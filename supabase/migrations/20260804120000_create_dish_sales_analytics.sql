-- Товарная аналитика: продажи блюд по дням из iiko OLAP + справочник продуктов.

alter table public.business_units
  add column if not exists iiko_department text;

update public.business_units set iiko_department = 'Bloody Mary Bar & Grill' where code = 'BLOODY_MARY';
update public.business_units set iiko_department = 'Brisket' where code = 'BRISKET';
update public.business_units set iiko_department = 'Pastrama Mama' where code = 'PASTRAMA';

create table public.dish_sales_daily (
  id uuid primary key default gen_random_uuid(),
  sale_date date not null,
  business_unit_id uuid not null references public.business_units(id),
  dish_id text not null,
  dish_name text not null,
  dish_type text not null check (dish_type in ('DISH','MODIFIER')),
  main_dish_id text,
  main_dish_name text,
  category text,
  group_name text,
  cooking_place text,
  quantity numeric not null default 0,
  revenue numeric not null default 0,
  cost numeric,
  avg_guest_wait_seconds numeric,
  imported_at timestamptz not null default now()
);

create index dish_sales_daily_date_unit_idx on public.dish_sales_daily (sale_date, business_unit_id);
create index dish_sales_daily_dish_idx on public.dish_sales_daily (dish_id);
create index dish_sales_daily_main_dish_idx on public.dish_sales_daily (main_dish_id) where main_dish_id is not null;

create table public.iiko_products (
  id text primary key,
  name text not null,
  main_unit text,
  product_type text,
  updated_at timestamptz not null default now()
);

alter table public.dish_sales_daily enable row level security;
alter table public.iiko_products enable row level security;

create policy "dish_sales_read" on public.dish_sales_daily
  for select using (public.is_payroll_staff());
create policy "dish_sales_insert" on public.dish_sales_daily
  for insert with check (public.is_payroll_staff());
create policy "dish_sales_delete" on public.dish_sales_daily
  for delete using (public.is_payroll_staff());

create policy "iiko_products_read" on public.iiko_products
  for select using (public.is_payroll_staff());
create policy "iiko_products_insert" on public.iiko_products
  for insert with check (public.is_payroll_staff());
create policy "iiko_products_update" on public.iiko_products
  for update using (public.is_payroll_staff()) with check (public.is_payroll_staff());

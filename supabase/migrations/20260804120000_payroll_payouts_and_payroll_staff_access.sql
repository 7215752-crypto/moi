-- Роли, ведущие расчёт ЗП: owner / accountant / manager.
create or replace function public.is_payroll_staff()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
    select coalesce(
        public.current_user_role() in ('owner', 'accountant', 'manager'),
        false
    );
$$;

-- Отметки «выплачено»: период × ресторан × сотрудник. Защита от двойной выплаты.
create table public.payroll_payouts (
    id uuid primary key default gen_random_uuid(),
    payroll_period_id uuid not null references public.payroll_periods(id),
    business_unit_id uuid not null references public.business_units(id),
    employee_id uuid not null references public.employees(id),
    amount_paid numeric not null check (amount_paid >= 0),
    paid_by uuid references auth.users(id),
    paid_by_name text,
    paid_at timestamptz not null default now(),
    unique (payroll_period_id, business_unit_id, employee_id)
);

alter table public.payroll_payouts enable row level security;

create policy staff_read on public.payroll_payouts
    for select to authenticated using ((select is_payroll_staff()));
create policy staff_insert on public.payroll_payouts
    for insert to authenticated with check ((select is_payroll_staff()));
-- Снять отметку может только владелец (защита от «случайно снял и выплатил ещё раз»).
create policy owner_delete on public.payroll_payouts
    for delete to authenticated using (current_user_role() = 'owner');

-- Менеджер видит данные расчёта (пока все рестораны; сужение до своего — отдельным шагом
-- через user_business_unit_access, когда появятся менеджерские аккаунты).
create policy manager_read on public.business_units for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.departments for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.employees for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.employee_aliases for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.employee_assignments for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.employee_rates for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.payroll_periods for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.payroll_runs for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.payroll_lines for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.payroll_misc_items for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.attendance_records for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.planned_shifts for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.leader_shifts for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.leader_kpi_results for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.iiko_motivation_records for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.manual_adjustments for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.worked_shift_records for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.inventory_events for select to authenticated using ((select is_payroll_staff()));
create policy manager_read on public.inventory_allocations for select to authenticated using ((select is_payroll_staff()));

-- Кнопка «Рассчитать зарплату» у менеджера: импорт явок пишет в эти таблицы.
create policy manager_insert on public.attendance_records for insert to authenticated with check ((select is_payroll_staff()));
create policy manager_delete on public.attendance_records for delete to authenticated using ((select is_payroll_staff()));
create policy manager_insert on public.payroll_periods for insert to authenticated with check ((select is_payroll_staff()));
create policy manager_insert on public.employees for insert to authenticated with check ((select is_payroll_staff()));
create policy manager_insert on public.employee_aliases for insert to authenticated with check ((select is_payroll_staff()));

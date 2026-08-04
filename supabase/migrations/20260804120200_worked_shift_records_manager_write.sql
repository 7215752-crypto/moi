-- Импорт явок (кнопка «Рассчитать зарплату») перезаписывает и смены за период.
create policy manager_insert on public.worked_shift_records for insert to authenticated with check ((select is_payroll_staff()));
create policy manager_delete on public.worked_shift_records for delete to authenticated using ((select is_payroll_staff()));

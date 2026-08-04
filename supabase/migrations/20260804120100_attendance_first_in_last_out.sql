-- Времена первого прихода и последнего ухода за день (из явок iiko).
-- Нужны для KPI опозданий: сравнение с planned_start графика. На оплату не влияют.
alter table public.attendance_records
    add column first_in timestamptz,
    add column last_out timestamptz;

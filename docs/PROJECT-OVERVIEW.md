# Обзор проекта — портал MOI Group (июль 2026)

Портал для менеджеров ресторанов MOI Group / Redman. Первый работающий модуль — расчёт зарплаты (read-only просмотр + импорт графика смен). Прод: https://redman-payroll-portal.vercel.app

## Стек и архитектура

- **Next.js 16.2.10** (App Router, React Server Components, React 19), TypeScript, без UI-библиотек — вся стилизация в `app/globals.css`.
- **Supabase** — Postgres + Auth (email/пароль). Проект: `qxskwitgffjtudnaxczv.supabase.co`.
- Доступ к данным только через **publishable key + RLS**: сервер рендерит страницы под сессией пользователя (`@supabase/ssr`, cookies). `service_role` нигде не используется — портал в принципе не может читать больше, чем разрешает RLS.
- `proxy.ts` (middleware Next 16) — обновление сессии и редиректы: неавторизованных на `/login`, авторизованных с `/login` на `/dashboard`.
- `lib/auth.ts` → `requireUser()` — каждая страница требует активный профиль в `user_profiles`, иначе signout.
- **Деплой: Vercel CLI** (`vercel --prod`), без git-репозитория. Аккаунт `7215752-2088s-projects` (team_qAANeoG4zPYicv4ISxn3WMJ4), проект `prj_nxds2Pdau0zZvzzoPPF4m9recfUP`, план Hobby.

## Страницы

| Маршрут | Что делает |
|---|---|
| `/login` | Вход email/паролем (server action) |
| `/dashboard` | Главная: 3 карточки разделов (Планирование — «скоро», Сотрудники — активно, Аналитика — «скоро») + последние расчётные периоды с итогами |
| `/payroll/[periodId]` | Зарплата за период: метрики (начислено, прочие расходы, итого, контроль отрицательных), таблицы по ресторанам, фильтр по ресторану |
| `/payroll/[periodId]/employee/[employeeId]` | Расчётный листок: все строки начислений/удержаний с источником |
| `/api/google-schedule` | GET — предпросмотр графика из Google-таблицы + отчёт о сопоставлении фамилий; POST — импорт в `planned_shifts` + `leader_shifts` (только owner/accountant) |
| `/api/google-rates` | GET — предпросмотр ставок из Google-таблицы (в базу пока не пишет) |

## Модель данных (реконструирована из кода)

Схема живёт только в Supabase (в репозитории SQL нет — это надо исправить).

**Справочники**
- `business_units` — рестораны (id, code, name)
- `departments` — подразделения ресторана (business_unit_id, code: HALL/…)
- `employees` — сотрудники (id, full_name)
- `employee_aliases` — альтернативные написания имён для сопоставления с внешними источниками (external_key, source_name)
- `user_profiles` — профиль пользователя портала: user_id (auth), employee_id, full_name, role (`owner` | `accountant` | `manager` | `employee`), is_active

**Расчёт зарплаты**
- `payroll_periods` — периоды (date_from, date_to, payment_due_date, status); период = половина месяца
- `payroll_runs` — версии расчёта на период × ресторан (payroll_period_id, business_unit_id, version, status)
- `payroll_lines` — строки расчёта (payroll_run_id, employee_id, component_type, amount, description, source_table)
- `payroll_misc_items` — расходы периода без привязки к сотруднику
- `payroll_employee_totals` — **view** (security_invoker=true): итог по сотруднику × ресторану × версии

**График смен**
- `planned_shifts` — плановые смены из Google-таблицы (employee_id, business_unit_id, department_id, shift_date, planned_start/end, is_overnight, is_shift_leader, source_sheet_id + source_cell — уникальный ключ upsert)
- `leader_shifts` — шифт-лидерские смены (planned_shift_id, leader_role, maximum_bonus: 1500 для HALL / 1000 иначе, status: pending → …)

**Типы компонентов зарплаты** (`humanizeComponent` в `lib/format.ts`): hourly_pay, shift_pay, monthly_pay, iiko_motivation, iiko_fixed_bonus, service_charge, purchase (покупки в зарплату), fine (депремирование), tg_bonus (премия), leader_kpi, official_inventory.

## Интеграции

- **Google Apps Script API** (`GOOGLE_SCHEDULE_API_URL` + `GOOGLE_SCHEDULE_API_TOKEN` в env Vercel): отдаёт график смен и ставки из Google-таблицы. Импорт графика работает; ставки — только предпросмотр.
- **iiko** — пока не подключён напрямую: мотивация и часы попадают в `payroll_lines` внешним процессом. Прямой API-импорт — в планах.

## Роли и доступ

- Читают портал все активные профили; RLS в Supabase определяет видимые данные.
- Импорт (google-schedule POST, google-rates) — только `owner` и `accountant`.
- Роль `manager` в интерфейсе пока никак не ограничена/не выделена (задел на будущее: менеджер видит только свой ресторан).

## Наблюдения и техдолг

1. **Нет git-репозитория** — версии хранятся в папках `backup-*` и файлах `*.backup`. Первый шаг передачи разработки: `git init` + GitHub, подключить Vercel к репозиторию (сейчас деплой руками через CLI).
2. **SQL-схемы нет в коде** — таблицы, view, RLS-политики существуют только в Supabase. Нужно выгрузить в `supabase/migrations` (или хотя бы один snapshot-файл), иначе схему нельзя ни восстановить, ни ревьюить.
3. **Мёртвый код**: `components/google-schedule-card.tsx` — карточка импорта графика выпала из UI при редизайне дашборда (осталась только в `app/dashboard/page.tsx.backup`). API работает, но из интерфейса импорт сейчас недоступен.
4. **Возможный баг версий на дашборде**: `app/dashboard/page.tsx` берёт максимальную версию расчёта на период глобально, а `payroll_runs` версионируются на период × ресторан. Если у ресторанов разные номера версий, итог периода на дашборде потеряет часть ресторанов. На странице периода — та же логика (`version` максимальная по периоду). Проверить на реальных данных.
5. Вложенная структура папок: рабочий проект — `redman-payroll-portal/redman-payroll-portal/`, во внешней папке только мусорный `package-lock.json`.
6. MCP-коннекторы этой среды (Supabase, Vercel) привязаны к аккаунтам с проектом `gamepark-ufs`, а не к аккаунтам портала — управлять базой и деплоем отсюда пока нельзя (см. HANDOVER в ROADMAP.md).

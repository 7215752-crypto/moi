# CLAUDE.md — портал MOI Group (redman-payroll-portal)

Портал для менеджеров ресторанов: расчёт зарплаты (работает), планирование выручки и товарная аналитика (в планах). Интерфейс полностью на русском. Прод: https://redman-payroll-portal.vercel.app

Контекст проекта: `docs/PROJECT-OVERVIEW.md` (состояние, модель данных), `docs/ROADMAP.md` (план работ), `docs/PAYROLL-CALC.md` (целевая логика расчёта ЗП «одной кнопкой» — утверждается владельцем, там же открытые вопросы).

## Команды

Рабочая директория — эта папка (вложенная `redman-payroll-portal/redman-payroll-portal`; во внешней папке проекта нет).

```bash
npm run dev      # локально, http://localhost:3000
npm run build    # next build --webpack
npm run lint
```

Деплой: `vercel --prod` (Vercel CLI, git не подключён). Аккаунт `7215752-2088s-projects`, проект `redman-payroll-portal`.

## Стек

Next.js 16 (App Router, RSC, middleware в `proxy.ts`), React 19, TypeScript strict, Supabase (`@supabase/ssr`). Без UI-библиотек и Tailwind — все стили в `app/globals.css` (классы вида `content-card`, `metric-grid`, `payroll-table`).

## Архитектура

- Страницы — async server components; данные читаются на сервере через `createClient()` из `lib/supabase/server.ts` под сессией пользователя (cookies).
- Каждая защищённая страница начинается с `requireUser()` (`lib/auth.ts`): нет пользователя → `/login`, нет активного профиля `user_profiles` → signout.
- `proxy.ts` (аналог middleware в Next 16) обновляет сессию и делает редиректы.
- Клиентские компоненты — только там, где нужна интерактивность (`components/*.tsx` с `"use client"`).
- Форматирование денег/дат/названий компонентов ЗП — только через `lib/format.ts`.

## База данных (Supabase, проект qxskwitgffjtudnaxczv)

Схема живёт в Supabase; новые изменения схемы — только миграциями (apply_migration + дубль файла в `supabase/migrations/`). Основные таблицы: `business_units` (рестораны), `departments`, `employees`, `employee_aliases`, `employee_assignments`, `employee_rates` (ставки hourly/shift/monthly с valid_from/to), `user_profiles` (роли: owner/accountant/manager/employee), `payroll_periods`, `payroll_runs` (версия на период × ресторан), `payroll_lines` (component_type см. `humanizeComponent`), `payroll_misc_items`, `payroll_payouts` (отметки «выплачено»: период × ресторан × сотрудник, unique — защита от двойной выплаты), `attendance_records` (явки iiko: часы + first_in/last_out), `planned_shifts`, `leader_shifts`, `manual_adjustments`, `iiko_motivation_records`, `worked_shift_records`, view `payroll_employee_totals` (security_invoker).

RLS: функции `current_user_role()`, `is_owner_or_accountant()`, `is_payroll_staff()` (owner/accountant/manager). Менеджер читает данные расчёта и запускает импорт явок; сужение видимости менеджера до своего ресторана — будущий шаг через `user_business_unit_access`.

## Правила безопасности (жёсткие)

- Только publishable key (`NEXT_PUBLIC_SUPABASE_*`). Никогда не добавлять `service_role`, secret-ключи или строку подключения Postgres — ни в код, ни в env Vercel. Доступ к данным регулируется исключительно RLS.
- Импорт из Google (`/api/google-*`) — только owner/accountant. Импорт явок iiko (`/api/iiko-attendance`) — owner/accountant/manager: это кнопка «Рассчитать зарплату» менеджера (решение владельца от 04.08.2026, см. docs/PAYROLL-CALC.md).
- Снять отметку «выплачено» может только owner (RLS + server action).
- `.env.local` не коммитить (есть в `.gitignore`).

## Особенности

- Расчёт версионируется на период × ресторан: везде брать последний `payroll_runs` по каждому ресторану (страница периода и дашборд так и делают с 04.08.2026).
- Страница периода — сводная «как Google-файл ЗП»: колонки-компоненты, галочки «выплачено» (`payroll_payouts`, server actions в `app/payroll/actions.ts`), кнопка «Рассчитать зарплату» (`components/recalc-button.tsx` → POST `/api/iiko-attendance`; пока обновляет явки из iiko, полный движок начислений — следующий этап).
- Времена явок iiko (`first_in`/`last_out`) хранятся «как есть», без часового пояса (в базе выглядят как UTC): для опозданий сравнивать чч:мм строки с `planned_start` графика, не конвертировать зоны.
- Интеграция с Google-таблицами через Apps Script API (env `GOOGLE_SCHEDULE_API_URL`, `GOOGLE_SCHEDULE_API_TOKEN` — настроены в Vercel).
- Сопоставление сотрудников с внешними источниками — по нормализованному имени + `employee_aliases` (`normalizeName`: нижний регистр, ё→е).

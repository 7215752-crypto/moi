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

Деплой: `git push` в `main` (https://github.com/7215752-crypto/moi) — Vercel собирает автоматически через GitHub App; Vercel CLI на машине нет. Перед пушем обязательно `node node_modules/typescript/bin/tsc --noEmit` (npx на этой машине нестабилен). Аккаунт `7215752-2088s-projects`, проект `redman-payroll-portal`. Рядом может работать параллельная сессия Claude: перед коммитом `git pull --rebase --autostash`, в пачку включать и её изменённые/untracked файлы (иначе деплой уронит билд или откатит прод).

## Стек

Next.js 16 (App Router, RSC, middleware в `proxy.ts`), React 19, TypeScript strict, Supabase (`@supabase/ssr`). Без UI-библиотек и Tailwind — все стили в `app/globals.css` (классы вида `content-card`, `metric-grid`, `payroll-table`).

Дизайн (с 04.08.2026): строгий рабочий стиль, «графит + зелёный для денег», контент на всю ширину. Светлая и тёмная темы: все цвета — ТОЛЬКО через CSS-переменные из `:root` (`--ink`, `--muted`, `--line`, `--surface-*`, `--brand`, `--green`, `--amber`, `--danger`…); hex-коды в компонентах и инлайн-стилях не хардкодить — сломается тёмная тема. Тёмная включается атрибутом `data-theme` на `<html>` (скрипт в `app/layout.tsx`, переключатель `components/theme-toggle.tsx`, ключ localStorage `moi-theme`) либо системной настройкой. Для форм/кнопок/плашек в клиентских компонентах есть готовые классы: `form-input`, `action-button` (+`.primary`), `notice` (+`.error/.success/.warn`), `plain-row`.

## Архитектура

- Страницы — async server components; данные читаются на сервере через `createClient()` из `lib/supabase/server.ts` под сессией пользователя (cookies).
- Каждая защищённая страница начинается с `requireUser()` (`lib/auth.ts`): нет пользователя → `/login`, нет активного профиля `user_profiles` → signout.
- `proxy.ts` (аналог middleware в Next 16) обновляет сессию и делает редиректы.
- Клиентские компоненты — только там, где нужна интерактивность (`components/*.tsx` с `"use client"`).
- Форматирование денег/дат/названий компонентов ЗП — только через `lib/format.ts`.

## База данных (Supabase, проект qxskwitgffjtudnaxczv)

Схема живёт в Supabase; новые изменения схемы — только миграциями (apply_migration + дубль файла в `supabase/migrations/`). Основные таблицы: `business_units` (рестораны; `iiko_department` — название точки в iiko для маппинга продаж), `departments`, `employees`, `employee_aliases`, `employee_assignments`, `employee_rates` (ставки hourly/shift/monthly с valid_from/to), `user_profiles` (роли: owner/accountant/manager/employee), `payroll_periods`, `payroll_runs` (версия на период × ресторан), `payroll_lines` (component_type см. `humanizeComponent`), `payroll_misc_items`, `payroll_payouts` (отметки «выплачено»: период × ресторан × сотрудник, unique — защита от двойной выплаты), `attendance_records` (явки iiko: часы + first_in/last_out), `planned_shifts`, `leader_shifts`, `manual_adjustments`, `iiko_motivation_records`, `worked_shift_records`, view `payroll_employee_totals` (security_invoker).

Товарная аналитика: `dish_sales_daily` (продажи из iiko OLAP: день × ресторан × блюдо/модификатор × цех; `main_dish_id` — связка модификатора с блюдом; повторный импорт заменяет период целиком), `iiko_products` (справочник номенклатуры для имён ингредиентов техкарт), SQL-функции `dish_sales_summary` и `dish_sales_category_summary` (security invoker, используются страницей `/analytics`).

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
- Товарная аналитика (`/analytics`): данные тянутся кнопкой «Обновить из iiko» (POST `/api/dish-sales`, роли owner/accountant/manager, диапазон ≤ 62 дней) из OLAP SALES с фильтрами `OrderDeleted=NOT_DELETED`, `DeletedWithWriteoff=NOT_DELETED`, `Storned=FALSE`. ABC-классы и дельты считаются в `lib/dish-sales.ts`; «время отдачи» — поле `Cooking.GuestWaitTime.Avg` (KDS), «чистое» время готовки в iiko не заполняется. Техкарта — отдельная страница `/analytics/dish/[dishId]/chart`, открывается из карточки блюда в новой вкладке (assemblyCharts + имена из `iiko_products`).

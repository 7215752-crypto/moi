# CLAUDE.md — портал MOI Group (redman-payroll-portal)

Портал для менеджеров ресторанов: расчёт зарплаты (работает), планирование выручки и товарная аналитика (в планах). Интерфейс полностью на русском. Прод: https://redman-payroll-portal.vercel.app

Контекст проекта: `docs/PROJECT-OVERVIEW.md` (состояние, модель данных), `docs/ROADMAP.md` (план работ).

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

Схема живёт в Supabase, в репозитории SQL пока нет. Основные таблицы: `business_units` (рестораны), `departments`, `employees`, `employee_aliases`, `user_profiles` (роли: owner/accountant/manager/employee), `payroll_periods`, `payroll_runs` (версия на период × ресторан), `payroll_lines` (component_type см. `humanizeComponent`), `payroll_misc_items`, view `payroll_employee_totals` (security_invoker), `planned_shifts`, `leader_shifts`.

## Правила безопасности (жёсткие)

- Только publishable key (`NEXT_PUBLIC_SUPABASE_*`). Никогда не добавлять `service_role`, secret-ключи или строку подключения Postgres — ни в код, ни в env Vercel. Доступ к данным регулируется исключительно RLS.
- Импорт-эндпоинты (`/api/google-*`) требуют роль owner или accountant — сохранять эту проверку в новых API.
- `.env.local` не коммитить (есть в `.gitignore`).

## Особенности

- Расчёт версионируется: всегда показывать последнюю версию `payroll_runs`; известная проблема — на дашборде и странице периода версия берётся по периоду, а не по ресторану (см. PROJECT-OVERVIEW, наблюдение 4).
- `components/google-schedule-card.tsx` — рабочий, но не подключён (выпал при редизайне дашборда); план — вернуть на страницу импорта.
- Интеграция с Google-таблицами через Apps Script API (env `GOOGLE_SCHEDULE_API_URL`, `GOOGLE_SCHEDULE_API_TOKEN` — настроены в Vercel).
- Сопоставление сотрудников с внешними источниками — по нормализованному имени + `employee_aliases` (`normalizeName`: нижний регистр, ё→е).

import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { requireUser } from "@/lib/auth";
import {
  formatDate,
  formatMoney,
  formatShortDate,
} from "@/lib/format";

type PayrollPeriod = {
  id: string;
  date_from: string;
  date_to: string;
  payment_due_date: string;
  status: string;
};

type PayrollLine = {
  amount: number | string;
};

type PayrollRun = {
  payroll_period_id: string;
  business_unit_id: string | null;
  version: number;
  payroll_lines: PayrollLine[] | null;
};

type MiscItem = {
  payroll_period_id: string;
  amount: number | string;
};

export default async function DashboardPage() {
  const { supabase, profile } =
    await requireUser();

  const [
    periodsResult,
    runsResult,
    miscResult,
  ] = await Promise.all([
    supabase
      .from("payroll_periods")
      .select(
        "id, date_from, date_to, payment_due_date, status",
      )
      .order("date_from", {
        ascending: false,
      }),

    supabase
      .from("payroll_runs")
      .select(
        "payroll_period_id, business_unit_id, version, payroll_lines(amount)",
      )
      .order("version", {
        ascending: false,
      }),

    supabase
      .from("payroll_misc_items")
      .select(
        "payroll_period_id, amount",
      ),
  ]);

  if (periodsResult.error) {
    throw new Error(
      `Не удалось загрузить периоды: ${periodsResult.error.message}`,
    );
  }

  const periods =
    (periodsResult.data ??
      []) as PayrollPeriod[];

  const runs =
    (runsResult.data ??
      []) as unknown as PayrollRun[];

  const miscItems =
    (miscResult.data ??
      []) as MiscItem[];

  // Версии считаются на период × ресторан: берём последний расчёт каждого
  // ресторана, иначе рестораны с меньшим номером версии выпадут из итога.
  const latestVersionByPeriodUnit =
    new Map<string, number>();

  const runKey = (run: PayrollRun) =>
    `${run.payroll_period_id}|${run.business_unit_id ?? "none"}`;

  for (const run of runs) {
    const currentVersion =
      latestVersionByPeriodUnit.get(
        runKey(run),
      ) ?? 0;

    if (run.version > currentVersion) {
      latestVersionByPeriodUnit.set(
        runKey(run),
        run.version,
      );
    }
  }

  const totalsByPeriod =
    new Map<string, number>();

  for (const run of runs) {
    if (
      run.version !==
      latestVersionByPeriodUnit.get(
        runKey(run),
      )
    ) {
      continue;
    }

    const runTotal = (
      run.payroll_lines ?? []
    ).reduce(
      (sum, line) =>
        sum + Number(line.amount ?? 0),
      0,
    );

    totalsByPeriod.set(
      run.payroll_period_id,
      (totalsByPeriod.get(
        run.payroll_period_id,
      ) ?? 0) + runTotal,
    );
  }

  for (const item of miscItems) {
    totalsByPeriod.set(
      item.payroll_period_id,
      (totalsByPeriod.get(
        item.payroll_period_id,
      ) ?? 0) +
        Number(item.amount ?? 0),
    );
  }

  const currentPeriod = periods[0];
  const today = new Date();

  return (
    <div className="app-shell">
      <SiteHeader profile={profile} />

      <main className="page-container">
        <section className="portal-intro">
          <div>
            <p className="eyebrow">
              MOI Group
            </p>

            <h1>Портал для менеджеров</h1>

            <p>
              Планирование выручки, расчёт
              зарплаты и быстрый анализ товаров
              в одном рабочем пространстве.
            </p>
          </div>

          <div className="portal-date">
            <span>Сегодня</span>

            <strong>
              {new Intl.DateTimeFormat(
                "ru-RU",
                {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                },
              ).format(today)}
            </strong>
          </div>
        </section>

        <section className="portal-section-grid">
          <article
            className="portal-section-card"
            id="planning"
          >
            <div className="portal-card-top">
              <span className="portal-card-number">
                01
              </span>

              <span className="portal-status">
                Скоро
              </span>
            </div>

            <div className="portal-card-body">
              <h2>Планирование</h2>

              <p>
                План и факт выручки ресторанов
                с прогнозом выполнения месяца.
              </p>

              <ul className="portal-card-points">
                <li>План выручки</li>
                <li>Факт из iiko</li>
                <li>Прогноз до конца месяца</li>
              </ul>
            </div>

            <div className="portal-card-footer">
              <button
                type="button"
                disabled
                className="portal-disabled-button has-tooltip"
                data-tooltip="Раздел подключим после завершения модуля расчёта зарплаты."
                title="Раздел будет подключён позже"
              >
                Открыть планирование
              </button>
            </div>
          </article>

          <article className="portal-section-card active">
            <div className="portal-card-top">
              <span className="portal-card-number">
                02
              </span>

              <span className="portal-status">
                Активно
              </span>
            </div>

            <div className="portal-card-body">
              <h2>Сотрудники</h2>

              <p>
                Расчёт зарплаты на основании
                ставок, посещаемости и мотивации
                из iiko, а также графика из
                Google-таблицы.
              </p>

              <ul className="portal-card-points">
                <li>Расчётные периоды</li>
                <li>Начисления и удержания</li>
                <li>Подробная расшифровка</li>
              </ul>
            </div>

            <div className="portal-card-footer">
              {currentPeriod ? (
                <Link
                  href={`/payroll/${currentPeriod.id}`}
                  className="portal-link has-tooltip"
                  data-tooltip="Откроет расчёт сотрудников за последний период."
                  title="Открыть последний расчётный период"
                >
                  Перейти к расчёту
                </Link>
              ) : (
                <a
                  href="#payroll-periods"
                  className="portal-link has-tooltip"
                  data-tooltip="Покажет список расчётных периодов."
                  title="Посмотреть расчётные периоды"
                >
                  Расчётные периоды
                </a>
              )}
            </div>
          </article>

          <article
            className="portal-section-card"
            id="analytics"
          >
            <div className="portal-card-top">
              <span className="portal-card-number">
                03
              </span>

              <span className="portal-status">
                Скоро
              </span>
            </div>

            <div className="portal-card-body">
              <h2>Аналитика</h2>

              <p>
                Быстрый просмотр продаж,
                прибыльности и эффективности
                товаров по ресторанам.
              </p>

              <ul className="portal-card-points">
                <li>Продажи товаров</li>
                <li>Выручка и валовая прибыль</li>
                <li>Лидеры и слабые позиции</li>
              </ul>
            </div>

            <div className="portal-card-footer">
              <button
                type="button"
                disabled
                className="portal-disabled-button has-tooltip"
                data-tooltip="Товарную аналитику подключим после модуля зарплаты."
                title="Раздел будет подключён позже"
              >
                Открыть аналитику
              </button>
            </div>
          </article>

          {["owner", "accountant"].includes(profile.role) && (
            <article
              className="portal-section-card"
              id="import"
            >
              <div className="portal-card-top">
                <span className="portal-card-number">
                  ⚙️
                </span>

                <span className="portal-status">
                  Админ
                </span>
              </div>

              <div className="portal-card-body">
                <h2>Импорт данных</h2>

                <p>
                  Загрузка графика смен и ставок
                  из Google-таблиц для расчёта
                  зарплаты сотрудников.
                </p>

                <ul className="portal-card-points">
                  <li>График смен из Google</li>
                  <li>Ставки сотрудников</li>
                  <li>Проверка сопоставления</li>
                </ul>
              </div>

              <div className="portal-card-footer">
                <Link
                  href="/admin/import"
                  className="portal-link has-tooltip"
                  data-tooltip="Только для владельца и бухгалтера."
                  title="Открыть импорт данных"
                >
                  Открыть импорт
                </Link>
              </div>
            </article>
          )}
        </section>

        <section
          className="content-card"
          id="payroll-periods"
        >
          <div className="compact-section-heading">
            <h2>Последние расчёты</h2>

            <p>
              Последние расчётные периоды
              сотрудников.
            </p>
          </div>

          {periods.length === 0 ? (
            <div className="empty-state">
              Расчётные периоды пока не
              созданы.
            </div>
          ) : (
            periods
              .slice(0, 4)
              .map((period) => (
                <div
                  className="portal-period-strip"
                  key={period.id}
                >
                  <div className="portal-period-main">
                    <strong>
                      {formatDate(
                        period.date_from,
                      )}{" "}
                      —{" "}
                      {formatDate(
                        period.date_to,
                      )}
                    </strong>

                    <span>
                      Выплата до{" "}
                      {formatShortDate(
                        period.payment_due_date,
                      )}
                    </span>
                  </div>

                  <div className="portal-period-total">
                    <span>К выплате</span>

                    <strong>
                      {formatMoney(
                        totalsByPeriod.get(
                          period.id,
                        ) ?? 0,
                      )}
                    </strong>
                  </div>

                  <StatusBadge
                    status={period.status}
                  />

                  <Link
                    href={`/payroll/${period.id}`}
                    className="portal-period-link has-tooltip"
                    data-tooltip="Открыть подробный расчёт за этот период."
                    title="Открыть расчётный период"
                  >
                    →
                  </Link>
                </div>
              ))
          )}
        </section>
      </main>
    </div>
  );
}

import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { GoogleScheduleCard } from "@/components/google-schedule-card";
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
  version: number;
  status: string;
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
        "payroll_period_id, version, status, payroll_lines(amount)",
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

  const latestVersionByPeriod =
    new Map<string, number>();

  for (const run of runs) {
    const current =
      latestVersionByPeriod.get(
        run.payroll_period_id,
      ) ?? 0;

    if (run.version > current) {
      latestVersionByPeriod.set(
        run.payroll_period_id,
        run.version,
      );
    }
  }

  const totalsByPeriod =
    new Map<string, number>();

  for (const run of runs) {
    if (
      run.version !==
      latestVersionByPeriod.get(
        run.payroll_period_id,
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

  const currentPayroll = currentPeriod
    ? totalsByPeriod.get(currentPeriod.id) ?? 0
    : 0;

  const totalPayroll = Array.from(
    totalsByPeriod.values(),
  ).reduce(
    (sum, value) => sum + value,
    0,
  );

  const today = new Date();

  const canImportSchedule = [
    "owner",
    "accountant",
  ].includes(profile.role);

  return (
    <div className="app-shell">
      <SiteHeader profile={profile} />

      <main className="page-container">
        <section className="moi-hero">
          <div className="moi-hero-copy">
            <p className="eyebrow">
              MOI Group · Портал для менеджеров
            </p>

            <h1>
              Управление командой без ручной
              рутины
            </h1>

            <p className="muted">
              Первый рабочий модуль — расчёт
              зарплаты. Дальше здесь появятся
              показатели сотрудников, продажи,
              KPI, чек-листы и аналитика
              ресторанов.
            </p>

            <div className="moi-hero-actions">
              {currentPeriod && (
                <Link
                  href={`/payroll/${currentPeriod.id}`}
                  className="primary-button inline-button has-tooltip"
                  data-tooltip="Откроет начисления сотрудников за последний расчётный период."
                  title="Открыть начисления сотрудников за последний расчётный период"
                >
                  Открыть текущий расчёт
                </Link>
              )}

              <a
                href="#periods"
                className="secondary-button inline-button has-tooltip"
                data-tooltip="Покажет историю текущих и закрытых расчётных периодов."
                title="Посмотреть все расчётные периоды"
              >
                Все расчётные периоды
              </a>
            </div>
          </div>

          <aside className="moi-focus-card">
            <div>
              <span>Текущий фокус</span>

              <strong>
                Автоматизация зарплаты
              </strong>

              <p>
                Сначала собираем часы, ставки,
                мотивацию и корректировки в одном
                понятном расчёте.
              </p>
            </div>

            <div className="moi-focus-meta">
              <div>
                <span>Сегодня</span>

                <b>
                  {new Intl.DateTimeFormat(
                    "ru-RU",
                    {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    },
                  ).format(today)}
                </b>
              </div>

              <div>
                <span>Этап системы</span>
                <b>1 из 4</b>
              </div>
            </div>
          </aside>
        </section>

        <section className="metric-grid">
          <article className="metric-card accent">
            <span>Последний период</span>

            <strong className="metric-date">
              {currentPeriod
                ? `${formatShortDate(
                    currentPeriod.date_from,
                  )} — ${formatShortDate(
                    currentPeriod.date_to,
                  )}`
                : "Нет данных"}
            </strong>

            <small>
              {currentPeriod
                ? `Выплата до ${formatShortDate(
                    currentPeriod.payment_due_date,
                  )}`
                : "Период ещё не создан"}
            </small>
          </article>

          <article className="metric-card">
            <span>К выплате за период</span>

            <strong className="metric-money">
              {formatMoney(currentPayroll)}
            </strong>

            <small>
              Сумма последней версии расчёта
            </small>
          </article>

          <article className="metric-card">
            <span>История расчётов</span>

            <strong>{periods.length}</strong>

            <small>
              Общая сумма загруженных расчётов:{" "}
              {formatMoney(totalPayroll)}
            </small>
          </article>
        </section>

        <section className="content-card slim">
          <div className="moi-section-intro">
            <div>
              <p className="eyebrow">
                Первый модуль
              </p>

              <h2>Расчёт зарплаты</h2>

              <p>
                Все дальнейшие функции портала
                будут строиться вокруг единой
                карточки сотрудника. Пока
                концентрируемся только на
                корректном расчёте и убираем
                ручную работу.
              </p>
            </div>
          </div>

          <div className="moi-roadmap">
            <article>
              <span>01</span>
              <strong>Собрать данные</strong>
              <p>
                Часы, смены, ставки и готовую
                мотивацию из источников.
              </p>
            </article>

            <article>
              <span>02</span>
              <strong>Проверить ошибки</strong>
              <p>
                Найти сотрудников без ставки,
                расхождения и дубли.
              </p>
            </article>

            <article>
              <span>03</span>
              <strong>Утвердить выплату</strong>
              <p>
                Зафиксировать расчёт и сохранить
                прозрачную расшифровку.
              </p>
            </article>
          </div>
        </section>

        {canImportSchedule && (
          <details className="technical-details">
            <summary title="Открыть служебный блок импорта графика">
              Служебный раздел: импорт графика
            </summary>

            <div>
              <GoogleScheduleCard
                initialYear={today.getFullYear()}
                initialMonth={
                  today.getMonth() + 1
                }
              />
            </div>
          </details>
        )}

        <section
          className="content-card"
          id="periods"
        >
          <div className="section-heading">
            <div>
              <h2>Расчётные периоды</h2>

              <p>
                Текущие и закрытые расчёты
                сотрудников.
              </p>
            </div>
          </div>

          {periods.length === 0 ? (
            <div className="empty-state">
              Расчётные периоды пока не
              созданы.
            </div>
          ) : (
            <div className="period-list">
              {periods.map((period) => (
                <Link
                  href={`/payroll/${period.id}`}
                  key={period.id}
                  className="period-row has-tooltip"
                  data-tooltip="Открыть подробный расчёт и расшифровку начислений за этот период."
                  title="Открыть подробный расчёт за период"
                >
                  <div className="period-icon">
                    <span>
                      {new Date(
                        `${period.date_from}T00:00:00`,
                      ).getDate()}
                    </span>

                    <small>
                      {new Intl.DateTimeFormat(
                        "ru-RU",
                        {
                          month: "short",
                        },
                      )
                        .format(
                          new Date(
                            `${period.date_from}T00:00:00`,
                          ),
                        )
                        .replace(".", "")}
                    </small>
                  </div>

                  <div className="period-main">
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
                      {formatDate(
                        period.payment_due_date,
                      )}
                    </span>
                  </div>

                  <div className="period-total">
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

                  <span className="row-arrow">
                    →
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

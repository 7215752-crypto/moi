import { LoginForm } from "@/components/login-form";

type Props = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

const errorMessages: Record<string, string> = {
  required: "Введите почту и пароль.",
  invalid: "Неверная почта или пароль.",
  no_access: "У вас нет доступа к порталу. Обратитесь к владельцу.",
};

export default async function LoginPage({ searchParams }: Props) {
  const query = await searchParams;
  const nextPath = query.next?.startsWith("/") ? query.next : "/dashboard";
  const errorMessage = query.error ? (errorMessages[query.error] ?? "Не удалось войти. Попробуйте ещё раз.") : null;

  return (
    <main className="login-shell">
      <section className="login-brand-panel">
        <div className="brand-mark">M</div>
        <p className="eyebrow light">MOI GROUP</p>
        <h1>Портал для менеджеров</h1>
        <p>
          Расчёт зарплаты, график смен и аналитика ресторанов — в одном рабочем
          пространстве.
        </p>
        <div className="login-feature-grid">
          <div>
            <strong>2</strong>
            <span>расчётных периода в месяц</span>
          </div>
          <div>
            <strong>100%</strong>
            <span>прозрачная расшифровка</span>
          </div>
        </div>
      </section>

      <section className="login-card-wrap">
        <div className="login-card">
          <p className="eyebrow">Личный кабинет</p>
          <h2>Вход в портал</h2>
          <p className="muted">Введите корпоративную почту и пароль.</p>

          {errorMessage ? (
            <div className="alert" role="alert">
              {errorMessage}
            </div>
          ) : null}

          <LoginForm nextPath={nextPath} />
        </div>
      </section>
    </main>
  );
}

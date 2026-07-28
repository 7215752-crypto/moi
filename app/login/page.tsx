import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="login-simple-shell">
      <section className="login-simple-brand">
        <div className="login-simple-logo">
          M
        </div>

        <p className="login-simple-name">
          MOI Group
        </p>

        <h1>Портал для менеджеров</h1>
      </section>

      <section className="login-simple-form-wrap">
        <div className="login-card">
          <p className="eyebrow">
            MOI Group
          </p>

          <h2>Вход в портал</h2>

          <p className="muted">
            Введите корпоративную почту и пароль.
          </p>

          <LoginForm nextPath="/dashboard" />
        </div>
      </section>
    </main>
  );
}

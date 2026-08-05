"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Step = "checking" | "ready" | "saving" | "done" | "invalid";

// Страница из письма-приглашения (или восстановления пароля):
// ссылка Supabase кладёт токены в #hash, браузерный клиент подхватывает их
// в сессию, дальше человек задаёт себе пароль.
export default function SetPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let settled = false;

    const settle = (hasSession: boolean) => {
      if (settled) return;
      settled = true;
      setStep(hasSession ? "ready" : "invalid");
    };

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) settle(true);
      },
    );

    // Даём клиенту время обработать токены из ссылки, затем проверяем сами.
    const timer = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      settle(Boolean(data.session));
    }, 1500);

    return () => {
      clearTimeout(timer);
      subscription.subscription.unsubscribe();
    };
  }, []);

  const save = async () => {
    if (password.length < 8) {
      setError("Пароль должен быть не короче 8 символов.");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают.");
      return;
    }

    setStep("saving");
    setError(null);

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setStep("ready");
      setError(updateError.message);
      return;
    }

    setStep("done");
    router.replace("/dashboard");
  };

  return (
    <main className="login-shell">
      <section className="login-brand-panel">
        <div className="brand-mark">M</div>
        <p className="eyebrow light">MOI GROUP</p>
        <h1>Портал для менеджеров</h1>
        <p>Осталось задать пароль — и рабочее пространство готово.</p>
      </section>

      <section className="login-card-wrap">
        <div className="login-card">
          <p className="eyebrow">Приглашение</p>
          <h2>Придумайте пароль</h2>

          {step === "checking" && (
            <p className="muted">Проверяем ссылку из письма…</p>
          )}

          {step === "invalid" && (
            <div className="alert" role="alert">
              Ссылка недействительна или устарела. Попросите владельца отправить
              приглашение ещё раз.
            </div>
          )}

          {(step === "ready" || step === "saving") && (
            <>
              <p className="muted">
                Пароль для входа в портал. Минимум 8 символов.
              </p>

              {error ? (
                <div className="alert" role="alert">
                  {error}
                </div>
              ) : null}

              <div className="login-form">
                <label>
                  <span>Новый пароль</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <label>
                  <span>Ещё раз</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="primary-button"
                  disabled={step === "saving"}
                  onClick={save}
                >
                  {step === "saving" ? "Сохраняем…" : "Сохранить и войти"}
                </button>
              </div>
            </>
          )}

          {step === "done" && <p className="muted">Готово, входим…</p>}
        </div>
      </section>
    </main>
  );
}

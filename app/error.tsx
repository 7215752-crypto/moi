"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="login-card-wrap" style={{ minHeight: "100vh" }}>
      <section className="login-card">
        <p className="eyebrow">Ошибка</p>
        <h2>Не удалось загрузить данные</h2>
        <p className="muted">Проверьте подключение к Supabase и права пользователя.</p>
        <button className="primary-button" style={{ width: "100%", marginTop: 24 }} onClick={reset}>
          Попробовать ещё раз
        </button>
      </section>
    </main>
  );
}

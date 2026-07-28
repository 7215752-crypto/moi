import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login-card-wrap" style={{ minHeight: "100vh" }}>
      <section className="login-card">
        <p className="eyebrow">404</p>
        <h2>Страница не найдена</h2>
        <p className="muted">Возможно, расчёт был удалён или у вас нет доступа.</p>
        <Link className="primary-button" style={{ display: "grid", placeItems: "center", marginTop: 24 }} href="/dashboard">
          Вернуться к периодам
        </Link>
      </section>
    </main>
  );
}

export default function Loading() {
  return (
    <main className="page-container" aria-busy="true">
      <div className="skeleton skeleton-title" />
      <div className="metric-grid">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
      <div className="skeleton skeleton-panel" />
    </main>
  );
}

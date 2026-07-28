const labels: Record<string, string> = {
  draft: "Черновик",
  review: "На проверке",
  approved: "Утверждён",
  exported: "Передан на выплату",
  paid: "Выплачен",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${status}`}>
      {labels[status] ?? status}
    </span>
  );
}

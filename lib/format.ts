/** e.g. "12 Nov, 3:30 pm" — adds the year only when it isn't this year. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

export function dueStatus(iso: string): "overdue" | "today" | "upcoming" {
  const d = new Date(iso);
  const now = new Date();
  if (d < now) return "overdue";
  return d.toDateString() === now.toDateString() ? "today" : "upcoming";
}

/** Value for <input type="datetime-local"> in the browser's time zone. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

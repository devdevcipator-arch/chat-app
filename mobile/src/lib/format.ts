// Date/time and text helpers. Formatted by hand (not Intl) so the output is
// identical on every Hermes build and device locale: "Nov 20, 2026 · 6:45 PM".

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "6:45 PM" */
export function formatClock(date: Date) {
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** "Nov 20" */
export function formatMonthDay(date: Date) {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** Date and time together, e.g. "Nov 20, 2026 · 6:45 PM" (call history, call receipts). */
export function formatDateTime(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${formatMonthDay(d)}, ${d.getFullYear()} · ${formatClock(d)}`;
}

/** Message footer: "6:45 PM" today, otherwise "Nov 12, 6:45 PM". */
export function formatMessageTime(iso: string) {
  const d = new Date(iso);
  return sameDay(d, new Date()) ? formatClock(d) : `${formatMonthDay(d)}, ${formatClock(d)}`;
}

/** Chat list: "6:45 PM" today, "Yesterday", otherwise "Nov 12". */
export function formatListTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return formatClock(d);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.getFullYear() === now.getFullYear() ? formatMonthDay(d) : `${formatMonthDay(d)}, ${d.getFullYear()}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "99+" above 99. */
export const badgeCount = (n: number) => (n > 99 ? "99+" : String(n));

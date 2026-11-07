// Date/time helpers. All date keys use the browser's local calendar date.
export const todayISO = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const currentTimeInput = (date = new Date()) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

export function parseTime(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

export function formatClock(totalMinutes, dateString) {
  if (!Number.isFinite(totalMinutes)) return "—";
  const minuteOfDay = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const date = dateString ? new Date(`${dateString}T12:00:00`) : new Date();
  date.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function formatDuration(totalSeconds, compact = false) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return compact
    ? `${hours}h ${String(minutes).padStart(2, "0")}m`
    : [hours, minutes, secs].map(n => String(n).padStart(2, "0")).join(":");
}

export function actualDurationSeconds(startValue, endValue) {
  const start = parseTime(startValue);
  const end = parseTime(endValue);
  if (start === null || end === null) return null;
  let duration = end - start;
  if (duration < 0) duration += 1440; // supports shifts crossing midnight
  return duration * 60;
}

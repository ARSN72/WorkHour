import { $, showToast } from "./dom.js";
import { repository } from "./storage.js";
import { actualDurationSeconds, formatDuration } from "./date-time.js";
import { targetMinutes, totalBreakMinutes } from "./calculator.js";

export function renderHistory(onSelect) {
  const days = repository.allDays();
  const settings = repository.settings();
  const completed = days.filter(d => d.startTime && d.endTime);
  const totalSeconds = completed.reduce((sum, day) => {
    const raw = actualDurationSeconds(day.startTime, day.endTime) || 0;
    return sum + Math.max(0, raw - (settings.includeBreaks ? 0 : totalBreakMinutes(day) * 60));
  }, 0);
  $("historySummary").textContent = completed.length
    ? `${completed.length} completed day${completed.length === 1 ? "" : "s"} · ${formatDuration(totalSeconds, true)} net work total`
    : `${days.length} saved day${days.length === 1 ? "" : "s"} · Complete an end time to include a day in totals`;

  const list = $("historyList");
  list.replaceChildren();
  if (!days.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Your saved daily records will appear here.";
    list.append(empty);
    return;
  }

  days.slice(0, 10).forEach(day => {
    const item = document.createElement("div");
    item.className = "history-item";
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", `Load record for ${day.date}`);
    const left = document.createElement("div");
    const date = document.createElement("div");
    date.className = "history-date";
    date.textContent = new Intl.DateTimeFormat(undefined, {
      weekday: "short", month: "short", day: "numeric", year: "numeric"
    }).format(new Date(`${day.date}T12:00:00`));
    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `${day.startTime || "No start"} → ${day.endTime || "In progress"} · ${totalBreakMinutes(day)}m break`;
    left.append(date, meta);

    const right = document.createElement("div");
    right.className = "history-right";
    const hours = document.createElement("div");
    hours.className = "history-hours";
    const state = document.createElement("div");
    state.className = "history-state";
    if (day.startTime && day.endTime) {
      const raw = actualDurationSeconds(day.startTime, day.endTime) || 0;
      const net = Math.max(0, raw - (settings.includeBreaks ? 0 : totalBreakMinutes(day) * 60));
      hours.textContent = formatDuration(net, true);
      state.textContent = `Overtime ${formatDuration(Math.max(0, net - targetMinutes(day) * 60), true)}`;
    } else {
      hours.textContent = "—";
      state.textContent = day.startTime ? "In progress" : "Not started";
    }
    right.append(hours, state);
    item.append(left, right);
    item.addEventListener("click", () => onSelect(day.date));
    item.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(day.date);
      }
    });
    list.append(item);
  });
}

export function exportCSV() {
  const days = repository.allDays();
  if (!days.length) {
    showToast("There are no daily records to export.", true);
    return;
  }
  const settings = repository.settings();
  const quote = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [["Date", "Start time", "End time", "Target minutes", "Half-day mode", "Break minutes", "Net work seconds", "Overtime seconds", "Status"]];
  days.forEach(day => {
    const target = targetMinutes(day);
    const breaks = totalBreakMinutes(day);
    const raw = day.startTime && day.endTime ? actualDurationSeconds(day.startTime, day.endTime) || 0 : 0;
    const net = day.startTime && day.endTime ? Math.max(0, raw - (settings.includeBreaks ? 0 : breaks * 60)) : 0;
    rows.push([day.date, day.startTime, day.endTime, target, day.halfDay, breaks, net, Math.max(0, net - target * 60), day.startTime && day.endTime ? "Completed" : day.startTime ? "In progress" : "Not started"]);
  });
  const blob = new Blob(["\ufeff" + rows.map(row => row.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "shiftmate-history.csv";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast("CSV history exported.");
}

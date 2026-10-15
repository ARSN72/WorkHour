import { $, showToast } from "./dom.js";
import { repository } from "./storage.js";
import { totalBreakMinutes } from "./calculator.js";
import { formatDuration } from "./date-time.js";

export function renderBreaks(day, onChange) {
  const list = $("breakList");
  $("breakTotal").textContent = formatDuration(totalBreakMinutes(day) * 60, true);
  list.replaceChildren();
  if (!day.breaks.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No breaks added yet.";
    list.append(empty);
    return;
  }
  day.breaks.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "break-item";
    const main = document.createElement("div");
    main.className = "break-item-main";
    const title = document.createElement("strong");
    title.textContent = item.label || `Break ${index + 1}`;
    const subtitle = document.createElement("span");
    subtitle.textContent = `Break ${index + 1}`;
    main.append(title, subtitle);
    const right = document.createElement("div");
    right.className = "break-item-right";
    const duration = document.createElement("strong");
    duration.textContent = `${item.minutes} min`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-break";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${item.label || "break"}`);
    remove.addEventListener("click", () => {
      day.breaks = day.breaks.filter(b => b.id !== item.id);
      onChange();
    });
    right.append(duration, remove);
    row.append(main, right);
    list.append(row);
  });
}

export function addBreak(day, minutes, label, onChange) {
  const value = Number(minutes);
  if (!Number.isInteger(value) || value < 1 || value > 1440) {
    showToast("Break must be between 1 and 1,440 minutes.", true);
    return false;
  }
  day.breaks.push({ id: repository.newId(), minutes: value, label: label || `${value}-minute break` });
  onChange();
  showToast(`Added ${value}-minute break.`);
  return true;
}

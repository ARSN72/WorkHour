import { $, showToast, clampInteger } from "./modules/dom.js";
import { todayISO, currentTimeInput, formatDuration, formatClock } from "./modules/date-time.js";
import { repository } from "./modules/storage.js";
import { calculate, targetMinutes, totalBreakMinutes } from "./modules/calculator.js";
import { renderClock } from "./modules/clock.js";
import { addBreak, renderBreaks } from "./modules/breaks.js";
import { renderHistory, exportCSV } from "./modules/history.js";
import { applyTheme } from "./modules/theme.js?v=7";

let activeDate = todayISO();
let activeDay = null;
let tickHandle;

function readForm() {
  activeDay.date = activeDate;
  activeDay.startTime = $("startTime").value;
  activeDay.endTime = $("endTime").value;
  activeDay.target = $("targetHours").value;
  activeDay.customHours = clampInteger($("customHours").value, 0, 24, 8);
  activeDay.customMinutes = clampInteger($("customMinutes").value, 0, 59, 0);
  activeDay.halfDay = $("halfDay").value;
}

function saveActive(showError = false) {
  if (!activeDay) return false;
  readForm();
  const success = repository.saveDay(activeDay);
  if (!success && showError) showToast("Could not save. Browser storage may be unavailable or full.", true);
  return success;
}

function loadDate(date, savePrevious = true) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    showToast("Choose a valid date.", true);
    return;
  }
  // Save the currently selected record under its own date before switching.
  if (savePrevious && activeDay) saveActive();
  activeDate = date;
  activeDay = repository.getOrCreateDay(date);
  $("workDate").value = date;
  $("startTime").value = activeDay.startTime;
  $("endTime").value = activeDay.endTime;
  $("targetHours").value = activeDay.target || repository.settings().target || "8";
  $("customHours").value = activeDay.customHours ?? 8;
  $("customMinutes").value = activeDay.customMinutes ?? 0;
  $("halfDay").value = activeDay.halfDay || "full";
  $("customTargetWrap").classList.toggle("hidden", $("targetHours").value !== "custom");
  renderBreaks(activeDay, onDayChanged);
  saveActive();
  renderAll();
}

function onDayChanged() {
  saveActive();
  renderBreaks(activeDay, onDayChanged);
  renderAll();
}

function renderAll() {
  if (!activeDay) return;
  readForm();
  const settings = repository.settings();
  const result = calculate(activeDay, settings);
  const fmt = formatDuration;

  $("elapsedValue").textContent = fmt(result.netSec);
  $("remainingValue").textContent = fmt(result.remainingSec);
  $("exitValue").textContent = result.estimatedExitMin === null ? "—" : formatClock(result.estimatedExitMin, activeDay.date);
  $("exitHint").textContent = result.completed ? "Actual end time entered" : result.hasStart ? "Estimate assumes no additional breaks" : "Enter a start time";
  $("elapsedHint").textContent = result.hasStart
    ? `${fmt(result.rawElapsedSec)} elapsed − ${fmt(result.breakMin * 60)} break`
    : "Enter your start time to begin";
  $("remainingHint").textContent = result.remainingSec === 0 ? "Work target reached" : "Until your work target is reached";
  $("overtimeHint").textContent = !result.hasStart ? "Overtime: —" : `Overtime: ${fmt(result.overtimeSec)}`;
  $("breakTakenValue").textContent = formatDuration(totalBreakMinutes(activeDay) * 60, true);
  $("breakTakenHint").textContent = totalBreakMinutes(activeDay) === 0 ? "No break time logged" : `Breaks logged: ${totalBreakMinutes(activeDay)} min`;

  const percent = Math.round(result.percent * 10) / 10;
  $("progressPercent").textContent = `${percent}%`;
  $("progressFill").style.width = `${percent}%`;
  $("progressBar").setAttribute("aria-valuenow", String(Math.round(percent)));
  $("progressStart").textContent = `Start ${result.startMin === null ? "—" : formatClock(result.startMin, activeDay.date)}`;
  $("progressEnd").textContent = `Target ${result.estimatedExitMin === null ? "—" : formatClock(result.estimatedExitMin, activeDay.date)}`;

  const status = $("sessionStatus");
  status.className = "status-pill";
  if (!result.hasStart) {
    status.classList.add("status-idle"); status.textContent = "Not started";
  } else if (result.completed) {
    status.classList.add("status-complete"); status.textContent = "Completed";
  } else {
    status.classList.add("status-active"); status.textContent = "In progress";
  }

  $("leaveNowWorked").textContent = fmt(result.netSec);
  if (!result.hasStart) {
    $("leaveNowDelta").textContent = `${fmt(result.targetSec)} short`;
    $("leaveNowMessage").textContent = "Enter your start time to calculate your result.";
  } else if (result.deltaSec < 0) {
    $("leaveNowDelta").textContent = `${fmt(Math.abs(result.deltaSec))} short`;
    $("leaveNowMessage").textContent = `If you stop now, you will be ${fmt(Math.abs(result.deltaSec))} below your required work target.`;
  } else {
    $("leaveNowDelta").textContent = `${fmt(result.deltaSec)} extra`;
    $("leaveNowMessage").textContent = result.deltaSec === 0
      ? "Your required work target is complete."
      : `You have completed your target with ${fmt(result.deltaSec)} extra work time.`;
  }

  $("customTargetWrap").classList.toggle("hidden", $("targetHours").value !== "custom");
  $("breakTotal").textContent = formatDuration(totalBreakMinutes(activeDay) * 60, true);
  repository.updateSettings({
    target: $("targetHours").value,
    includeBreaks: $("includeBreaks").checked,
    confirmReset: $("confirmReset").checked
  });
  renderHistory(loadDateFromHistory);
}

function loadDateFromHistory(date) {
  loadDate(date, true);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetCurrentDay() {
  if ($("confirmReset").checked && !window.confirm(`Reset all inputs and breaks for ${activeDate}? This cannot be undone.`)) return;
  repository.deleteDay(activeDate);
  activeDay = repository.getOrCreateDay(activeDate);
  $("startTime").value = "";
  $("endTime").value = "";
  $("targetHours").value = repository.settings().target || "8";
  $("customHours").value = "8";
  $("customMinutes").value = "0";
  $("halfDay").value = "full";
  renderBreaks(activeDay, onDayChanged);
  saveActive();
  renderAll();
  showToast("This day's inputs were reset.");
}

function bindEvents() {
  $("workDate").addEventListener("change", () => loadDate($("workDate").value, true));
  ["startTime", "endTime", "targetHours", "customHours", "customMinutes", "halfDay"].forEach(id => {
    $(id).addEventListener("change", () => {
      if (id === "targetHours") repository.updateSettings({ target: $("targetHours").value });
      saveActive();
      renderAll();
    });
    if (id === "customHours" || id === "customMinutes") {
      $(id).addEventListener("input", () => { saveActive(); renderAll(); });
    }
  });
  ["includeBreaks", "confirmReset"].forEach(id => $(id).addEventListener("change", () => {
    repository.updateSettings({ [id]: $(id).checked });
    renderAll();
  }));
  const desktopWidgetToggle = $("desktopWidgetEnabled");
  if (window.desktopWidget?.isDesktop) {
    $("desktopWidgetEnabledWrap").classList.remove("hidden");
    window.desktopWidget.getState().then(state => {
      desktopWidgetToggle.checked = state.widgetEnabled;
    }).catch(error => {
      console.error("Could not read desktop widget settings:", error);
      showToast("Could not load desktop widget settings.", true);
    });
    desktopWidgetToggle.addEventListener("change", async () => {
      try {
        const state = await window.desktopWidget.setEnabled(desktopWidgetToggle.checked);
        desktopWidgetToggle.checked = state.widgetEnabled;
      } catch (error) {
        console.error("Could not update desktop widget setting:", error);
        showToast("Could not update the desktop widget setting.", true);
        desktopWidgetToggle.checked = !desktopWidgetToggle.checked;
      }
    });
  }

  document.querySelectorAll("[data-break]").forEach(button => {
    button.addEventListener("click", () => addBreak(activeDay, Number(button.dataset.break), `${button.dataset.break}-minute break`, onDayChanged));
  });
  $("customBreakForm").addEventListener("submit", event => {
    event.preventDefault();
    const input = $("customBreakMinutes");
    if (addBreak(activeDay, input.value, `${input.value}-minute custom break`, onDayChanged)) input.value = "";
  });

  $("startNowBtn").addEventListener("click", () => {
    $("startTime").value = currentTimeInput();
    $("endTime").value = "";
    saveActive(); renderAll(); showToast("Start time set to now.");
  });
  $("endNowBtn").addEventListener("click", () => {
    if (!$("startTime").value) { showToast("Enter a start time first.", true); return; }
    $("endTime").value = currentTimeInput();
    saveActive(); renderAll(); showToast("End time set to now.");
  });
  $("clearEndBtn").addEventListener("click", () => {
    $("endTime").value = "";
    saveActive(); renderAll(); showToast("End time cleared. Live tracking resumed.");
  });
  $("saveDayBtn").addEventListener("click", () => {
    if (saveActive(true)) showToast("Daily record saved.");
    renderHistory(loadDateFromHistory);
  });
  $("newDayBtn").addEventListener("click", () => {
    const today = todayISO();
    const alreadyToday = activeDate === today;
    loadDate(today, true);
    showToast(alreadyToday ? "Today's record loaded." : "Today's record ready.");
  });
  $("resetDayBtn").addEventListener("click", resetCurrentDay);
  $("exportBtn").addEventListener("click", exportCSV);
  window.addEventListener("pagehide", () => saveActive());
}

function init() {
  const settings = repository.settings();
  $("includeBreaks").checked = settings.includeBreaks;
  $("confirmReset").checked = settings.confirmReset;
  applyTheme();
  bindEvents();
  loadDate(todayISO(), false);
  renderClock();
  tickHandle = window.setInterval(() => {
    renderClock();
    renderAll();
  }, 1000);
  window.addEventListener("pagehide", () => window.clearInterval(tickHandle));
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(error => console.warn("Offline support unavailable:", error));
  }
}

document.addEventListener("DOMContentLoaded", init);

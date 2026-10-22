import { calculate, totalBreakMinutes } from "/js/modules/calculator.js";
import { formatClock, formatDuration, todayISO } from "/js/modules/date-time.js";
import { renderClock } from "/js/modules/clock.js";

const $ = id => document.getElementById(id);
const STORAGE_KEY = "shiftmate.v1";
let spotlightTimer;
let spotlightIndex = 0;

function renderStats() {
  renderClock();
  try {
    const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const day = state?.days?.[todayISO()];
    if (!day) {
      $("clockInValue").textContent = "—";
      $("clockOutValue").textContent = "—";
      $("clockOutLabel").textContent = "Clock-out";
      $("breakValue").textContent = "0m";
      $("netWorkValue").textContent = "—";
      $("elapsedValue").textContent = "—";
      return;
    }

    const settings = state.settings || {};
    const result = calculate(day, settings);
    const breaks = totalBreakMinutes(day);
    $("clockInValue").textContent = day.startTime || "—";
    $("clockOutLabel").textContent = result.completed ? "Clocked out" : "Expected out";
    $("clockOutValue").textContent = result.completed
      ? day.endTime
      : result.estimatedExitMin === null ? "—" : formatClock(result.estimatedExitMin, day.date);
    $("breakValue").textContent = formatDuration(breaks * 60, true);
    $("netWorkValue").textContent = result.hasStart ? formatDuration(result.netSec, true) : "—";
    $("elapsedValue").textContent = result.hasStart ? formatDuration(result.rawElapsedSec, true) : "—";
  } catch (error) {
    console.error("Desktop widget could not read today's saved work record:", error);
  }
}

function getSpotlights() {
  const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  const day = state?.days?.[todayISO()];
  if (!day?.startTime) {
    return [{
      title: "Work session",
      value: "Not clocked in",
      detail: "Set a start time in the calculator to see your live shift summary."
    }];
  }

  const settings = state.settings || {};
  const result = calculate(day, settings);
  const breaks = totalBreakMinutes(day);
  const clockOut = result.completed
    ? day.endTime
    : result.estimatedExitMin === null ? "—" : formatClock(result.estimatedExitMin, day.date);
  return [
    {
      title: "Break taken",
      value: formatDuration(breaks * 60, true),
      detail: `${(day.breaks || []).length} break${(day.breaks || []).length === 1 ? "" : "s"} recorded`
    },
    {
      title: "Total time since clock-in",
      value: formatDuration(result.rawElapsedSec, true),
      detail: `Clocked in at ${day.startTime}; includes break time`
    },
    {
      title: "Net work completed",
      value: formatDuration(result.netSec, true),
      detail: result.remainingSec > 0
        ? `${formatDuration(result.remainingSec, true)} remaining to target`
        : `${formatDuration(result.overtimeSec, true)} overtime`
    },
    {
      title: result.completed ? "Clocked out" : "Estimated clock-out",
      value: clockOut,
      detail: result.completed ? "Actual end time saved" : "Based on your target and logged breaks"
    }
  ];
}

function showSpotlight() {
  try {
    const slides = getSpotlights();
    const slide = slides[spotlightIndex % slides.length];
    spotlightIndex += 1;
    $("spotlightTitle").textContent = slide.title;
    $("spotlightValue").textContent = slide.value;
    $("spotlightDetail").textContent = slide.detail;
  } catch (error) {
    console.error("Desktop widget could not prepare a summary:", error);
    $("spotlightTitle").textContent = "Work summary unavailable";
    $("spotlightValue").textContent = "Check saved data";
    $("spotlightDetail").textContent = "Open the calculator to verify today's saved record.";
  }
}

function startSpotlights() {
  clearInterval(spotlightTimer);
  $("spotlight").hidden = false;
  document.body.classList.add("spotlight-active");
  spotlightIndex = 0;
  showSpotlight();
  spotlightTimer = window.setInterval(showSpotlight, 2000);
}

function stopSpotlights() {
  clearInterval(spotlightTimer);
  $("spotlight").hidden = true;
  document.body.classList.remove("spotlight-active");
}

renderStats();
window.setInterval(renderStats, 1000);
window.addEventListener("storage", renderStats);

if (window.desktopWidget) {
  document.getElementById("hideWidget").addEventListener("click", () => window.desktopWidget.hide());
  document.getElementById("openCalculator").addEventListener("click", () => window.desktopWidget.openCalculator());
  window.desktopWidget.onSpotlight(mode => {
    if (mode === "start") startSpotlights();
    else stopSpotlights();
  });
} else {
  document.querySelector(".widget-actions").hidden = true;
}

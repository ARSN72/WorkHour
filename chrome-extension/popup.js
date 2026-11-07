import { todayISO, currentTimeInput, formatDuration, formatClock, parseTime } from "./js/modules/date-time.js";
import { repository } from "./js/modules/storage.js";
import { calculate, totalBreakMinutes } from "./js/modules/calculator.js";

const $ = id => document.getElementById(id);
let activeDate = todayISO();
let activeDay = null;
let viewDate = todayISO();
let kekaFetchResult = null;
let tickHandle;
let activeMode = "view";

function showNotice(message = "") {
  $("notice").textContent = message;
}

function saveActive() {
  if (!activeDay) return false;
  activeDay.date = activeDate;
  activeDay.startTime = $("startTime").value;
  activeDay.endTime = $("endTime").value;
  activeDay.target = $("targetHours").value;
  activeDay.customHours = clampInteger($("customHours").value, 0, 24, 8);
  activeDay.customMinutes = clampInteger($("customMinutes").value, 0, 59, 0);
  activeDay.halfDay = $("halfDay").value;
  const saved = repository.saveDay(activeDay);
  showNotice(saved ? "" : "Could not save. Extension storage may be unavailable or full.");
  return saved;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function loadDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    showNotice("Choose a valid date.");
    $("workDate").value = activeDate;
    return;
  }
  saveActive();
  activeDate = date;
  activeDay = repository.getDay(activeDate) || repository.getOrCreateDay(activeDate);
  $("workDate").value = activeDate;
  $("startTime").value = activeDay.startTime;
  $("endTime").value = activeDay.endTime;
  $("targetHours").value = activeDay.target || repository.settings().target || "8";
  $("customHours").value = activeDay.customHours ?? 8;
  $("customMinutes").value = activeDay.customMinutes ?? 0;
  $("halfDay").value = activeDay.halfDay || "full";
  $("customTargetWrap").classList.toggle("hidden", $("targetHours").value !== "custom");
  renderBreaks();
  saveActive();
  render();
}

function renderBreaks() {
  const list = $("breakList");
  list.replaceChildren();
  for (const item of activeDay.breaks) {
    const row = document.createElement("li");
    row.className = "break-item";
    const label = document.createElement("span");
    label.textContent = `${item.label} · ${item.minutes} min`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-break";
    remove.dataset.removeBreak = item.id;
    remove.setAttribute("aria-label", `Remove ${item.label}`);
    remove.textContent = "Remove";
    row.append(label, remove);
    list.append(row);
  }
}

function render() {
  if (!activeDay) return;
  const result = calculate(activeDay, repository.settings());
  const fmt = formatDuration;
  $("liveClock").textContent = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(new Date());
  if (activeMode === "custom") {
    $("elapsedValue").textContent = fmt(result.netSec);
    $("remainingValue").textContent = fmt(result.remainingSec);
    const exitMinute = result.completed ? result.endMin : result.estimatedExitMin;
    $("exitValue").textContent = exitMinute === null ? "—" : formatClock(exitMinute, activeDay.date);
    $("elapsedHint").textContent = result.hasStart
      ? `${fmt(result.rawElapsedSec)} elapsed · ${fmt(result.breakMin * 60)} break`
      : "Enter a start time";
    $("remainingHint").textContent = result.remainingSec === 0 ? "Target reached" : "Until your target";
    $("exitHint").textContent = result.completed ? "Recorded end time" : result.hasStart ? "Includes logged breaks" : "Enter a start time";
  }
  $("breakTotal").textContent = fmt(totalBreakMinutes(activeDay) * 60, true);
  renderKekaView();

  $("leaveNowTitle").textContent = result.completed ? "Recorded shift result" : "If you leave now";
  if (!result.hasStart) {
    $("leaveNowDelta").textContent = `${fmt(result.targetSec, true)} short`;
    $("leaveNowMessage").textContent = "Enter a start time to see your projection.";
  } else if (result.deltaSec < 0) {
    $("leaveNowDelta").textContent = `${fmt(Math.abs(result.deltaSec), true)} short`;
    $("leaveNowMessage").textContent = `You are ${fmt(Math.abs(result.deltaSec))} below your work target.`;
  } else {
    $("leaveNowDelta").textContent = result.deltaSec === 0 ? "Target complete" : `${fmt(result.deltaSec, true)} extra`;
    $("leaveNowMessage").textContent = result.deltaSec === 0
      ? "Your required work target is complete."
      : `You have ${fmt(result.deltaSec)} extra work time.`;
  }
}

function renderKekaView() {
  const record = kekaFetchResult?.date === viewDate && !kekaFetchResult.error
    ? kekaFetchResult
    : null;
  $("kekaClockInValue").textContent = record ? formatClock(parseTime(record.clockIn), viewDate) : "—";
  if (!record) {
    if (activeMode === "view") {
      $("elapsedValue").textContent = "--:--:--";
      $("remainingValue").textContent = "--:--:--";
      $("exitValue").textContent = "—";
      $("elapsedHint").textContent = "Waiting for Keka clock-in";
      $("remainingHint").textContent = "Until an 8-hour target";
      $("exitHint").textContent = "Based on Keka attendance";
    }
    return;
  }

  const startMinute = parseTime(record.clockIn);
  if (startMinute === null) {
    $("kekaClockInValue").textContent = "—";
    showKekaStatus("Keka returned an invalid clock-in time. Refresh and try again.");
    return;
  }
  const result = calculate({
    date: viewDate,
    startTime: record.clockIn,
    endTime: "",
    target: 8,
    halfDay: "full",
    breaks: []
  }, { includeBreaks: true });

  if (activeMode !== "view") return;
  $("elapsedValue").textContent = formatDuration(result.netSec);
  $("remainingValue").textContent = formatDuration(result.remainingSec);
  $("exitValue").textContent = result.estimatedExitMin === null ? "—" : formatClock(result.estimatedExitMin, viewDate);
  $("elapsedHint").textContent = result.rawElapsedSec > 0 ? "Since clock-in · no break deductions" : "Since clock-in";
  $("remainingHint").textContent = result.remainingSec === 0 ? "8-hour target reached" : "Until an 8-hour target";
  $("exitHint").textContent = "Excludes breaks";
}

function showKekaStatus(message) {
  $("kekaStatus").textContent = message;
}

function restoreKekaResult(result) {
  kekaFetchResult = result?.date === viewDate ? result : null;
  if (kekaFetchResult?.error) showKekaStatus(kekaFetchResult.error);
  else if (kekaFetchResult?.clockIn) showKekaStatus("Clock-in loaded from Keka.");
  renderKekaView();
}

async function restoreKekaFetch() {
  try {
    const { lastKekaClockInFetch } = await chrome.storage.local.get("lastKekaClockInFetch");
    restoreKekaResult(lastKekaClockInFetch);
    const permissionRequest = { permissions: ["scripting"], origins: ["https://walkover.keka.com/*"] };
    if (await chrome.permissions.contains(permissionRequest)) {
      await fetchKekaClockIn(false);
    } else if (!kekaFetchResult) {
      showKekaStatus("Connect to Keka to fetch attendance automatically.");
    }
  } catch (error) {
    console.error("Could not restore the Keka clock-in:", error);
    showKekaStatus("Could not load the saved Keka result.");
  }
}

async function fetchKekaClockIn(requestPermission = true) {
  const button = $("fetchKekaBtn");
  const requestedDate = viewDate;
  button.disabled = true;
  showKekaStatus("Connecting to your Keka attendance page…");
  try {
    const origin = "https://walkover.keka.com/*";
    const permissionRequest = { permissions: ["scripting"], origins: [origin] };
    const permitted = requestPermission
      ? await chrome.permissions.request(permissionRequest)
      : await chrome.permissions.contains(permissionRequest);
    if (!permitted) {
      showKekaStatus("Keka access was not allowed. Grant access to fetch here, or use Custom.");
      return;
    }
    const result = await chrome.runtime.sendMessage({
      type: "fetch-keka-clock-in",
      date: requestedDate
    });
    if (!result?.ok) {
      restoreKekaResult(result || { date: requestedDate, error: "Could not read the Keka attendance page." });
      return;
    }
    restoreKekaResult(result);
  } catch (error) {
    console.error("Could not fetch the Keka clock-in:", error);
    showKekaStatus("Could not connect to Keka. Open its attendance page and try again.");
  } finally {
    button.disabled = false;
  }
}

function setActiveTab(tab) {
  const viewSelected = tab === "view";
  activeMode = viewSelected ? "view" : "custom";
  $("viewTab").classList.toggle("active", viewSelected);
  $("viewTab").setAttribute("aria-selected", String(viewSelected));
  $("viewTab").tabIndex = viewSelected ? 0 : -1;
  $("customTab").classList.toggle("active", !viewSelected);
  $("customTab").setAttribute("aria-selected", String(!viewSelected));
  $("customTab").tabIndex = viewSelected ? -1 : 0;
  $("viewPanel").hidden = !viewSelected;
  $("customPanel").hidden = viewSelected;
  render();
}

function updateDay() {
  saveActive();
  render();
}

function addBreak(minutes, label) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    showNotice("Breaks must be between 1 and 1,440 minutes.");
    return;
  }
  activeDay.breaks.push({ id: repository.newId(), minutes, label });
  renderBreaks();
  updateDay();
}

function bindEvents() {
  $("viewTab").addEventListener("click", () => setActiveTab("view"));
  $("customTab").addEventListener("click", () => setActiveTab("custom"));
  $("viewTab").parentElement.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home"
      ? "view"
      : event.key === "End"
        ? "custom"
        : $("viewTab").getAttribute("aria-selected") === "true" ? "custom" : "view";
    setActiveTab(target);
    $(`${target}Tab`).focus();
  });
  $("workDate").addEventListener("change", () => {
    loadDate($("workDate").value);
  });
  ["startTime", "endTime", "targetHours", "halfDay", "customHours", "customMinutes"].forEach(id => {
    $(id).addEventListener("change", () => {
      let settingsSaved = true;
      if (id === "targetHours") {
        $("customTargetWrap").classList.toggle("hidden", $("targetHours").value !== "custom");
        settingsSaved = repository.updateSettings({ target: $("targetHours").value });
      }
      if (id === "customHours") $("customHours").value = String(clampInteger($("customHours").value, 0, 24, 8));
      if (id === "customMinutes") $("customMinutes").value = String(clampInteger($("customMinutes").value, 0, 59, 0));
      const daySaved = saveActive();
      if (!settingsSaved) showNotice("Could not save your default target.");
      else if (daySaved) showNotice("");
      render();
    });
  });

  $("startNowBtn").addEventListener("click", () => {
    $("startTime").value = currentTimeInput();
    $("endTime").value = "";
    updateDay();
  });
  $("endNowBtn").addEventListener("click", () => {
    if (!$("startTime").value) {
      showNotice("Enter a start time first.");
      return;
    }
    $("endTime").value = currentTimeInput();
    updateDay();
  });
  $("fetchKekaBtn").addEventListener("click", () => fetchKekaClockIn(true));

  document.querySelectorAll("[data-break]").forEach(button => {
    button.addEventListener("click", () => {
      const minutes = Number(button.dataset.break);
      addBreak(minutes, `${minutes}-minute break`);
    });
  });
  $("customBreakForm").addEventListener("submit", event => {
    event.preventDefault();
    const input = $("customBreakMinutes");
    const minutes = Number(input.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      showNotice("Enter a break between 1 and 1,440 minutes.");
      return;
    }
    addBreak(minutes, `${minutes}-minute custom break`);
    input.value = "";
  });
  $("breakList").addEventListener("click", event => {
    const button = event.target.closest("button[data-remove-break]");
    if (!button) return;
    activeDay.breaks = activeDay.breaks.filter(item => item.id !== button.dataset.removeBreak);
    renderBreaks();
    updateDay();
  });
  window.addEventListener("pagehide", saveActive);
}

function init() {
  bindEvents();
  loadDate(activeDate);
  restoreKekaFetch();
  tickHandle = window.setInterval(render, 1000);
  window.addEventListener("pagehide", () => window.clearInterval(tickHandle));
}

document.addEventListener("DOMContentLoaded", init);

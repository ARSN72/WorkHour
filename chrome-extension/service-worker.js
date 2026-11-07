const KEKA_ORIGIN = "https://walkover.keka.com";
const KEKA_ATTENDANCE_URL = `${KEKA_ORIGIN}/#/me/attendance/logs`;
const KEKA_PERMISSION = { origins: [`${KEKA_ORIGIN}/*`] };

function waitForTab(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
    const finish = (error, tab) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error);
      else resolve(tab);
    };
    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish(null, tab);
    };
    const timeout = setTimeout(() => finish(new Error("Keka is taking too long to load. Open the attendance page and try again.")), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === "complete") finish(null, tab);
    }).catch(error => finish(error));
  });
}

async function getAttendanceTab() {
  const tabs = await chrome.tabs.query({ url: `${KEKA_ORIGIN}/*` });
  let tab = tabs.find(candidate => candidate.url?.includes("/me/attendance/logs"));
  if (tab) return tab;
  const created = await chrome.tabs.create({ url: KEKA_ATTENDANCE_URL, active: true });
  return waitForTab(created.id);
}

async function readClockIn(date) {
  if (!await chrome.permissions.contains({ ...KEKA_PERMISSION, permissions: ["scripting"] })) {
    throw new Error("Allow access to walkover.keka.com to read your attendance.");
  }
  const tab = await getAttendanceTab();
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: findClockInOnAttendancePage,
    args: [date]
  });
  if (result?.result?.clockIn) return result.result.clockIn;
  throw new Error(result?.result?.error || "Couldn't find the selected date's clock-in on the Keka attendance page. Open Attendance Logs and try again.");
}

async function saveFetchResult(result) {
  await chrome.storage.local.set({ lastKekaClockInFetch: result });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "fetch-keka-clock-in" || !/^\d{4}-\d{2}-\d{2}$/.test(message.date || "")) return false;
  (async () => {
    try {
      const clockIn = await readClockIn(message.date);
      const result = { date: message.date, clockIn, fetchedAt: Date.now(), error: "" };
      await saveFetchResult(result);
      sendResponse({ ok: true, ...result });
    } catch (error) {
      const result = {
        date: message.date,
        clockIn: "",
        fetchedAt: Date.now(),
        error: error instanceof Error ? error.message : "Could not read the Keka attendance page."
      };
      await saveFetchResult(result);
      sendResponse({ ok: false, ...result });
    }
  })();
  return true;
});

async function findClockInOnAttendancePage(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  const normalizeDate = value => value.toLowerCase().replace(/[,./-]/g, " ").replace(/\s+/g, " ").trim();
  const dateTokens = [
    dateKey,
    new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "numeric", year: "numeric" }).format(date),
    new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date),
    new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date),
    new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(date),
    new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date)
  ].map(normalizeDate);
  const isTargetDate = value => {
    const text = normalizeDate(value);
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return dateTokens.some(token => token && (` ${text} `).includes(` ${token} `))
      || (dateKey === todayKey && /\btoday\b/i.test(value));
  };
  const parseClock = value => {
    const match = String(value).match(/\b([01]?\d|2[0-3]):([0-5]\d)(?:\s*([ap])\.?m\.?)?\b/i);
    if (!match) return "";
    let hours = Number(match[1]);
    if (match[3]) {
      if (hours > 12) return "";
      hours = hours % 12 + (match[3].toLowerCase() === "p" ? 12 : 0);
    }
    return `${String(hours).padStart(2, "0")}:${match[2]}`;
  };
  const visible = element => {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };
  const deadline = Date.now() + 18000;
  while (Date.now() < deadline) {
    const headings = [...document.querySelectorAll("table thead tr, [role='grid'] [role='row']")].filter(visible);
    for (const heading of headings) {
      const headerCells = [...heading.querySelectorAll("th, [role='columnheader']")];
      const dateIndex = headerCells.findIndex(cell => /\bdate\b|\bday\b/i.test(cell.innerText));
      const inIndex = headerCells.findIndex(cell => /\bin\s*time\b|\bclock[\s-]*in\b|\bpunch[\s-]*in\b|\bfirst\s*in\b/i.test(cell.innerText));
      if (dateIndex < 0 || inIndex < 0) continue;

      const table = heading.closest("table, [role='grid']");
      const rows = [...table.querySelectorAll("tbody tr, [role='row']")].filter(visible);
      for (const row of rows) {
        if (row === heading) continue;
        const cells = [...row.querySelectorAll("td, [role='gridcell']")];
        if (cells.length <= Math.max(dateIndex, inIndex) || !isTargetDate(cells[dateIndex].innerText)) continue;
        const clockIn = parseClock(cells[inIndex].innerText);
        if (clockIn) return { clockIn };
      }
    }
    if (document.querySelector("input[type='password']")) {
      return { error: "Sign in to Keka, open Attendance Logs, then fetch the clock-in again." };
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return { error: "Couldn't find a clock-in for the selected date. Open Keka Attendance Logs and confirm the page shows a Date and In Time column." };
}

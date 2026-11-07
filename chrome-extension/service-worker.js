const KEKA_ORIGIN = "https://walkover.keka.com";
const KEKA_ATTENDANCE_URL = `${KEKA_ORIGIN}/#/me/attendance/logs`;
const KEKA_PERMISSION = { origins: [`${KEKA_ORIGIN}/*`] };
const AUTO_FETCH_DELAY_MS = 1200;
const autoFetchTimers = new Map();
const extensionOpenedTabs = new Set();
const activeTabFetches = new Map();

function withTimeout(promise, timeoutMs, message) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timeout));
}

function waitForTab(tabId, timeoutMs = 20000) {
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
    const timeout = setTimeout(() => finish(
      new Error("Keka did not finish loading. Open Keka, sign in, and try again."),
      null
    ), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === "complete") finish(null, tab);
    }).catch(error => finish(error, null));
  });
}

async function getAttendanceTab() {
  const tabs = await chrome.tabs.query({ url: `${KEKA_ORIGIN}/*` });
  const attendanceTab = tabs.find(tab => /\/#\/me\/attendance\/logs/i.test(tab.url || ""));
  if (attendanceTab) return waitForTab(attendanceTab.id);

  const created = await chrome.tabs.create({ url: KEKA_ATTENDANCE_URL, active: false });
  extensionOpenedTabs.add(created.id);
  return waitForTab(created.id);
}

async function fetchAttendanceFromTab(tabId, date) {
  if (!await chrome.permissions.contains({ ...KEKA_PERMISSION, permissions: ["scripting"] })) {
    throw new Error("Allow access to walkover.keka.com to read your attendance.");
  }
  if (activeTabFetches.has(tabId)) return activeTabFetches.get(tabId);
  const fetchPromise = (async () => {
    const [result] = await withTimeout(chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: fetchKekaClockInFromPage,
      args: [date]
    }), 22000, "Keka's attendance API took too long to respond. Refresh Keka and try again.");
    if (result?.result?.clockIn) return result.result;
    throw new Error(result?.result?.error || "Keka returned no clock-in for today.");
  })().finally(() => activeTabFetches.delete(tabId));
  activeTabFetches.set(tabId, fetchPromise);
  return fetchPromise;
}

async function readAttendance(date) {
  const tab = await getAttendanceTab();
  return fetchAttendanceFromTab(tab.id, date);
}

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function scheduleAutomaticAttendanceFetch(tabId) {
  clearTimeout(autoFetchTimers.get(tabId));
  const timer = setTimeout(async () => {
    autoFetchTimers.delete(tabId);
    try {
      const attendance = await fetchAttendanceFromTab(tabId, localDateKey());
      await chrome.storage.local.set({
        lastKekaClockInFetch: { ...attendance, date: localDateKey(), fetchedAt: Date.now(), error: "" }
      });
    } catch (error) {
      const result = {
        date: localDateKey(),
        clockIn: "",
        fetchedAt: Date.now(),
        error: error instanceof Error ? error.message : "Could not read Keka attendance."
      };
      try {
        await chrome.storage.local.set({ lastKekaClockInFetch: result });
      } catch (storageError) {
        console.error("Could not save automatically fetched Keka attendance:", storageError);
      }
    }
  }, AUTO_FETCH_DELAY_MS);
  autoFetchTimers.set(tabId, timer);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = tab.url || changeInfo.url || "";
  if (!url.startsWith(`${KEKA_ORIGIN}/`)) return;
  if (extensionOpenedTabs.has(tabId)) {
    if (changeInfo.status === "complete") extensionOpenedTabs.delete(tabId);
    return;
  }
  if (changeInfo.status === "complete" || changeInfo.url) scheduleAutomaticAttendanceFetch(tabId);
});

chrome.tabs.onRemoved.addListener(tabId => {
  clearTimeout(autoFetchTimers.get(tabId));
  autoFetchTimers.delete(tabId);
  extensionOpenedTabs.delete(tabId);
  activeTabFetches.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "fetch-keka-clock-in" || !/^\d{4}-\d{2}-\d{2}$/.test(message.date || "")) return false;
  (async () => {
    let result;
    try {
      const attendance = await withTimeout(
        readAttendance(message.date),
        38000,
        "Keka did not respond in time. Keep Keka open, then try refreshing again."
      );
      result = { date: message.date, ...attendance, fetchedAt: Date.now(), error: "" };
      try {
        await chrome.storage.local.set({ lastKekaClockInFetch: result });
      } catch (error) {
        console.error("Could not save the fetched Keka clock-in:", error);
        result.warning = "Clock-in was read from Keka but could not be saved locally.";
      }
      sendResponse({ ok: true, ...result });
    } catch (error) {
      result = {
        date: message.date,
        clockIn: "",
        fetchedAt: Date.now(),
        error: error instanceof Error ? error.message : "Could not read the Keka attendance page."
      };
      try {
        await chrome.storage.local.set({ lastKekaClockInFetch: result });
      } catch (storageError) {
        console.error("Could not save the Keka fetch error:", storageError);
      }
      sendResponse({ ok: false, ...result });
    }
  })();
  return true;
});

async function fetchKekaClockInFromPage(dateKey) {
  const endpoint = `${location.origin}/k/attendance/api/mytime/attendance/attendancedayrequests`;
  const jwtPattern = /(?:^|[\s"'])(?:Bearer\s+)?([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(?:$|[\s"'])/i;
  const candidates = [];
  const addCandidate = (key, value, depth = 0) => {
    if (depth > 4 || value === null || value === undefined) return;
    if (typeof value === "string") {
      const match = value.match(jwtPattern);
      if (!match) return;
      const token = match[1];
      let expiresAt = 0;
      try {
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        expiresAt = Number(payload.exp) || 0;
      } catch {
        return;
      }
      if (expiresAt > Date.now() / 1000) {
        const priority = /access.?token/i.test(key) ? 2 : /auth.?token|^token$/i.test(key) ? 1 : 0;
        candidates.push({ key, token, priority });
      }
      return;
    }
    if (typeof value === "object") {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        addCandidate(`${key}.${nestedKey}`, nestedValue, depth + 1);
      }
    }
  };
  for (const storeName of ["localStorage", "sessionStorage"]) {
    try {
      const store = window[storeName];
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index);
        const value = store.getItem(key);
        addCandidate(key, value);
        try {
          addCandidate(key, JSON.parse(value));
        } catch {}
      }
    } catch {
      // Some browser privacy modes can block access to a web storage area.
    }
  }
  candidates.sort((a, b) => b.priority - a.priority);

  let response;
  const accessTokens = [...new Set(candidates.slice(0, 5).map(candidate => candidate.token))];
  const authOptions = accessTokens.length ? [...accessTokens, null] : [null];
  for (const token of authOptions) {
    const headers = { accept: "application/json, text/plain, */*" };
    if (token) headers.authorization = `Bearer ${token}`;
    try {
      response = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        headers,
        cache: "no-store"
      });
    } catch {
      return { error: "Could not reach Keka attendance. Check your connection and sign in to Keka again." };
    }
    if (response.status !== 401 && response.status !== 403) break;
  }
  if (response.status === 401 || response.status === 403) {
    return { error: "Keka rejected the current session. Sign in to Keka again, then refresh attendance." };
  }
  if (!response.ok) {
    return { error: `Keka attendance request failed (HTTP ${response.status}). Refresh Keka and try again.` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { error: "Keka returned an unreadable attendance response. Refresh the Keka page and try again." };
  }
  if (payload?.success === false || payload?.succeeded === false) {
    return { error: "Keka did not return attendance data. Sign in to Keka again and retry." };
  }

  const normalizeDate = value => {
    if (typeof value !== "string" && typeof value !== "number") return "";
    const text = String(value);
    const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return "";
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  };
  const toClock = value => {
    if (typeof value === "number") {
      const date = new Date(value > 100000000000 ? value : value * 1000);
      return Number.isNaN(date.getTime()) ? "" : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    }
    if (typeof value !== "string") return "";
    const text = value.trim();
    const match = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:\s*([ap])\.?m\.?)?\b/i);
    if (match) {
      let hours = Number(match[1]);
      if (match[3]) {
        if (hours > 12) return "";
        hours = hours % 12 + (match[3].toLowerCase() === "p" ? 12 : 0);
      }
      return `${String(hours).padStart(2, "0")}:${match[2]}`;
    }
    if (!/[T ]\d{2}:\d{2}/.test(text)) return "";
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? "" : `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
  };
  const dateKeys = /^(date|day|attendancedate|punchdate|logdate|workdate|createddate|entrydate|localdate)$/i;
  const timeKeys = /time|clock|punch|timestamp|createdon|checkin|checkout|entry/i;
  const directionKeys = /^(type|direction|status|punchstatus|originalpunchstatus|eventtype|attendanceevent|punchtype)$/i;
  const normalizeKey = key => String(key).replace(/[_\-\s]/g, "").toLowerCase();
  const arrayCandidates = [];
  const walk = (value, ancestors = [], key = "", depth = 0) => {
    if (depth > 10 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      if (normalizeKey(key).includes("timeentr") || normalizeKey(key).includes("punch")) {
        arrayCandidates.push({ key, items: value, ancestors });
      }
      for (const item of value) walk(item, ancestors, key, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const nextAncestors = [...ancestors, value];
    for (const [childKey, child] of Object.entries(value)) walk(child, nextAncestors, childKey, depth + 1);
  };
  walk(payload);

  const collectEntry = entry => {
    const fields = [];
    const search = (value, depth = 0) => {
      if (depth > 5 || value === null || value === undefined) return;
      if (Array.isArray(value)) {
        for (const item of value) search(item, depth + 1);
      } else if (typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          fields.push({ key: normalizeKey(key), value: child });
          search(child, depth + 1);
        }
      }
    };
    search(entry);
    const dateValues = fields.filter(field => dateKeys.test(field.key)).map(field => normalizeDate(field.value)).filter(Boolean);
    const dateMatches = dateValues.length === 0 || dateValues.includes(dateKey);
    if (!dateMatches) return null;
    const directionValues = fields.filter(field => directionKeys.test(field.key))
      .map(field => String(field.value).toLowerCase().replace(/[^a-z]/g, ""));
    const explicitlyIn = directionValues.some(value => /^(in|clockin|punchin|checkin|firstin|entryin)$/.test(value));
    const explicitlyOut = directionValues.some(value => /^(out|clockout|punchout|checkout|lastout|entryout|break)$/.test(value));
    const timeFields = fields.filter(field => timeKeys.test(field.key));
    const punches = [];
    for (const field of timeFields) {
      const clockIn = toClock(field.value);
      if (!clockIn) continue;
      const key = field.key;
      const keySaysOut = /out|exit|breakend/.test(key);
      const keySaysIn = /in|arrival|clockin/.test(key);
      punches.push({
        clockIn,
        explicitlyIn: keySaysIn || explicitlyIn && !explicitlyOut,
        explicitlyOut: keySaysOut || explicitlyOut && !explicitlyIn
      });
    }
    return punches.length ? { clockIn: punches[0].clockIn, explicitlyIn, explicitlyOut, punches } : null;
  };

  const entries = [];
  for (const candidate of arrayCandidates) {
    for (const item of candidate.items) {
      const parsed = collectEntry(item);
      if (parsed && !entries.some(entry => entry.clockIn === parsed.clockIn
        && entry.explicitlyIn === parsed.explicitlyIn
        && entry.explicitlyOut === parsed.explicitlyOut)) {
        entries.push(parsed);
      }
    }
  }
  const punches = entries.flatMap(entry => entry.punches);

  const remoteClockIn = payload?.data?.remoteclockin;
  const fallbackEntries = remoteClockIn?.timeEntries;
  if (!punches.length && Array.isArray(fallbackEntries)) {
    for (const entry of fallbackEntries) {
      const parsed = collectEntry(entry);
      if (parsed) punches.push(...parsed.punches);
    }
  }
  const uniquePunches = punches.filter((punch, index, list) =>
    list.findIndex(other => other.clockIn === punch.clockIn
      && other.explicitlyIn === punch.explicitlyIn
      && other.explicitlyOut === punch.explicitlyOut) === index
  );
  const clockInPunch = uniquePunches.find(punch => punch.explicitlyIn && !punch.explicitlyOut)
    || uniquePunches.find(punch => !punch.explicitlyOut);
  if (!clockInPunch) return { error: "Keka responded, but no clock-in was present in today's attendance data." };

  const orderedPunches = [...uniquePunches].sort((a, b) => {
    const toMinutes = value => {
      const [hours, minutes] = value.split(":").map(Number);
      return hours * 60 + minutes;
    };
    return toMinutes(a.clockIn) - toMinutes(b.clockIn);
  });
  let nextType = "in";
  let workStart = null;
  let lastOut = null;
  let workedSeconds = 0;
  let breakSeconds = 0;
  let hasExplicitPunchTypes = false;
  for (const punch of orderedPunches) {
    let type = punch.explicitlyIn ? "in" : punch.explicitlyOut ? "out" : nextType;
    if (punch.explicitlyIn || punch.explicitlyOut) hasExplicitPunchTypes = true;
    const [hours, minutes] = punch.clockIn.split(":").map(Number);
    const punchMinute = hours * 60 + minutes;
    if (type === "in") {
      if (lastOut !== null) breakSeconds += Math.max(0, punchMinute - lastOut) * 60;
      if (workStart === null) workStart = punchMinute;
      lastOut = null;
      nextType = "out";
    } else {
      if (workStart !== null) {
        workedSeconds += Math.max(0, punchMinute - workStart) * 60;
        workStart = null;
      }
      lastOut = punchMinute;
      nextType = "in";
    }
  }
  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  if (workStart !== null) workedSeconds += Math.max(0, nowMinute - workStart) * 60;
  else if (lastOut !== null) breakSeconds += Math.max(0, nowMinute - lastOut) * 60;

  return {
    clockIn: clockInPunch.clockIn,
    workedSeconds: orderedPunches.length > 1 ? workedSeconds : undefined,
    breakSeconds: orderedPunches.length > 1 ? breakSeconds : undefined,
    punchCount: orderedPunches.length,
    hasExplicitPunchTypes
  };
}

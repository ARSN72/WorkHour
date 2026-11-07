const KEKA_ORIGIN = "https://walkover.keka.com";
const KEKA_ATTENDANCE_URL = `${KEKA_ORIGIN}/#/me/attendance/logs`;
const KEKA_PERMISSION = { origins: [`${KEKA_ORIGIN}/*`] };
const AUTO_FETCH_DELAY_MS = 1200;
const BADGE_ALARM = "attendance-badge-toggle";
const activeTabFetches = new Map();
let showEstimatedExit = false;

function badgeEstimate(record, policy) {
  const [hours, minutes] = String(record.clockIn).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const targetMinutes = policy?.date === record.date && Number.isFinite(policy.targetMinutes)
    ? Math.max(0, policy.targetMinutes)
    : 480;
  const breakMinutes = Number.isFinite(record.breakSeconds) ? record.breakSeconds / 60 : 0;
  return hours * 60 + minutes + targetMinutes + breakMinutes;
}

function formatBadgeTime(totalMinutes) {
  const minute = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}${String(minute % 60).padStart(2, "0")}`;
}

function formatTitleTime(totalMinutes) {
  const minute = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const date = new Date();
  date.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

async function updateActionBadge(record, policy) {
  if (record?.date !== localDateKey() || record.error || !record.clockIn
    || typeof record.clockedIn !== "boolean") {
    await chrome.alarms.clear(BADGE_ALARM);
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "Work Hour Calculator" });
    return;
  }

  if (record.clockedIn) {
    const estimatedExit = badgeEstimate(record, policy);
    showEstimatedExit = false;
    await chrome.action.setBadgeBackgroundColor({ color: "#198754" });
    await chrome.action.setBadgeText({ text: "IN" });
    await chrome.action.setTitle({
      title: estimatedExit === null
        ? "Clocked in"
        : `Clocked in · estimated exit ${formatTitleTime(estimatedExit)}`
    });
    if (estimatedExit === null) {
      await chrome.alarms.clear(BADGE_ALARM);
    } else {
      await chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 0.5 });
    }
    return;
  }

  await chrome.alarms.clear(BADGE_ALARM);
  await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  await chrome.action.setBadgeText({ text: "OUT" });
  await chrome.action.setTitle({ title: "Clocked out" });
}

async function refreshActionBadge() {
  const { lastKekaClockInFetch, liveWorkPolicy } = await chrome.storage.local.get([
    "lastKekaClockInFetch",
    "liveWorkPolicy"
  ]);
  await updateActionBadge(lastKekaClockInFetch, liveWorkPolicy);
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== BADGE_ALARM) return;
  chrome.storage.local.get(["lastKekaClockInFetch", "liveWorkPolicy"]).then(async values => {
    const record = values.lastKekaClockInFetch;
    const estimate = record?.clockedIn ? badgeEstimate(record, values.liveWorkPolicy) : null;
    if (record?.date !== localDateKey() || record.error || estimate === null) {
      await updateActionBadge(record, values.liveWorkPolicy);
      return;
    }
    showEstimatedExit = !showEstimatedExit;
    await chrome.action.setBadgeText({
      text: showEstimatedExit ? formatBadgeTime(estimate) : "IN"
    });
  }).catch(error => console.error("Could not update the attendance toolbar badge:", error));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || (!changes.lastKekaClockInFetch && !changes.liveWorkPolicy)) return;
  refreshActionBadge().catch(error => console.error("Could not refresh the attendance toolbar badge:", error));
});

chrome.runtime.onStartup.addListener(() => {
  refreshActionBadge().catch(error => console.error("Could not restore the attendance toolbar badge:", error));
});

chrome.runtime.onInstalled.addListener(() => {
  refreshActionBadge().catch(error => console.error("Could not initialize the attendance toolbar badge:", error));
});

refreshActionBadge().catch(error => console.error("Could not initialize the attendance toolbar badge:", error));

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
  return waitForTab(created.id);
}

async function fetchAttendanceFromTab(tabId, date, startupDelayMs = 0) {
  if (!await chrome.permissions.contains({ ...KEKA_PERMISSION, permissions: ["scripting"] })) {
    throw new Error("Allow access to walkover.keka.com to read your attendance.");
  }
  if (activeTabFetches.has(tabId)) return activeTabFetches.get(tabId);
  const fetchPromise = (async () => {
    const [result] = await withTimeout(chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: fetchKekaClockInFromPage,
      args: [date, startupDelayMs]
    }), 22000, "Keka's attendance API took too long to respond. Refresh Keka and try again.");
    if (result?.result?.clockIn && typeof result.result.clockedIn === "boolean") return result.result;
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
  (async () => {
    let lastError;
    for (const delay of [AUTO_FETCH_DELAY_MS, 1500, 3000]) {
      try {
        const attendance = await fetchAttendanceFromTab(tabId, localDateKey(), delay);
        await chrome.storage.local.set({
          lastKekaClockInFetch: { ...attendance, date: localDateKey(), fetchedAt: Date.now(), error: "" }
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    const result = {
      date: localDateKey(),
      clockIn: "",
      fetchedAt: Date.now(),
      error: lastError instanceof Error ? lastError.message : "Could not read Keka attendance."
    };
    try {
      await chrome.storage.local.set({ lastKekaClockInFetch: result });
    } catch (storageError) {
      console.error("Could not save automatically fetched Keka attendance:", storageError);
    }
  })().catch(error => console.error("Could not automatically refresh Keka attendance:", error));
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = tab.url || changeInfo.url || "";
  if (!url.startsWith(`${KEKA_ORIGIN}/`)) return;
  if (changeInfo.status === "complete" || changeInfo.url && tab.status === "complete") {
    scheduleAutomaticAttendanceFetch(tabId);
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
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

async function fetchKekaClockInFromPage(dateKey, startupDelayMs = 0) {
  if (startupDelayMs > 0) await new Promise(resolve => setTimeout(resolve, startupDelayMs));
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
    const search = (value, owner = null, depth = 0) => {
      if (depth > 5 || value === null || value === undefined) return;
      if (Array.isArray(value)) {
        for (const item of value) search(item, owner, depth + 1);
      } else if (typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          const field = { key: normalizeKey(key), value: child, owner: value };
          if (child === null || typeof child !== "object") fields.push(field);
          search(child, value, depth + 1);
        }
      }
    };
    search(entry);
    const dateValues = fields.filter(field => dateKeys.test(field.key)).map(field => normalizeDate(field.value)).filter(Boolean);
    const dateMatches = dateValues.length === 0 || dateValues.includes(dateKey);
    if (!dateMatches) return null;
    const timeFields = fields.filter(field =>
      /(clockin|punchin|checkin|firstin|entryin|intime|arrival|starttime|breakstart|clockout|punchout|checkout|exit|lastout|breakend|outtime|logout)/.test(field.key)
      || /^(time|punch|timestamp|createdon|actualtime|entry)$/.test(field.key)
    );
    const punches = [];
    for (const field of timeFields) {
      const key = field.key;
      const time = toClock(field.value);
      if (!time) continue;
      const keySaysOut = /(clockout|punchout|checkout|exit|lastout|breakend|outtime|logout)/.test(key);
      const keySaysIn = /(clockin|punchin|checkin|firstin|entryin|intime|arrival|starttime)/.test(key);
      let explicitlyIn = keySaysIn;
      let explicitlyOut = keySaysOut;
      if (!explicitlyIn && !explicitlyOut && /^(time|punch|timestamp|createdon|actualtime|entry)$/.test(key)) {
        const directionValues = Object.entries(field.owner || {})
          .filter(([ownerKey]) => directionKeys.test(normalizeKey(ownerKey)))
          .map(([, value]) => String(value).toLowerCase().replace(/[^a-z]/g, ""));
        explicitlyIn = directionValues.some(value => /^(in|clockin|punchin|checkin|firstin|entryin)$/.test(value));
        explicitlyOut = directionValues.some(value => /^(out|clockout|punchout|checkout|lastout|entryout|break)$/.test(value));
      }
      punches.push({
        clockIn: time,
        explicitlyIn,
        explicitlyOut
      });
    }
    return punches.length ? { punches } : null;
  };

  const entries = [];
  for (const candidate of arrayCandidates) {
    for (const item of candidate.items) {
      const parsed = collectEntry(item);
      if (parsed) {
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
  let clockedIn = false;
  let firstClockIn = "";
  for (const punch of orderedPunches) {
    let type = punch.explicitlyIn ? "in" : punch.explicitlyOut ? "out" : nextType;
    if (punch.explicitlyIn || punch.explicitlyOut) hasExplicitPunchTypes = true;
    if (type === "in" && !firstClockIn) firstClockIn = punch.clockIn;
    const [hours, minutes] = punch.clockIn.split(":").map(Number);
    const punchMinute = hours * 60 + minutes;
    if (type === "in") {
      if (lastOut !== null) breakSeconds += Math.max(0, punchMinute - lastOut) * 60;
      if (workStart === null) workStart = punchMinute;
      lastOut = null;
      nextType = "out";
      clockedIn = true;
    } else {
      if (workStart !== null) {
        workedSeconds += Math.max(0, punchMinute - workStart) * 60;
        workStart = null;
      }
      lastOut = punchMinute;
      nextType = "in";
      clockedIn = false;
    }
  }
  if (!firstClockIn) return { error: "Keka responded, but no clock-in was present in today's attendance data." };
  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  if (workStart !== null) workedSeconds += Math.max(0, nowMinute - workStart) * 60;
  else if (lastOut !== null) breakSeconds += Math.max(0, nowMinute - lastOut) * 60;

  return {
    clockIn: firstClockIn,
    workedSeconds: orderedPunches.length > 1 ? workedSeconds : undefined,
    breakSeconds: orderedPunches.length > 1 ? breakSeconds : undefined,
    punchCount: orderedPunches.length,
    hasExplicitPunchTypes,
    clockedIn
  };
}

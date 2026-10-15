// Versioned localStorage repository. No server or external dependencies.
const STORAGE_KEY = "shiftmate.v1";
const DEFAULT_SETTINGS = {
  target: "8",
  includeBreaks: false,
  confirmReset: true,
  darkMode: false
};

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

function makeEmptyDay(date, defaultTarget) {
  return {
    date,
    startTime: "",
    endTime: "",
    target: defaultTarget || "8",
    customHours: 8,
    customMinutes: 0,
    halfDay: "full",
    breaks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeDay(date, raw, defaultTarget) {
  if (!raw || typeof raw !== "object") return makeEmptyDay(date, defaultTarget);
  return {
    ...makeEmptyDay(date, defaultTarget),
    ...raw,
    date,
    startTime: typeof raw.startTime === "string" ? raw.startTime : "",
    endTime: typeof raw.endTime === "string" ? raw.endTime : "",
    target: String(raw.target || defaultTarget || "8"),
    customHours: Number.isFinite(Number(raw.customHours)) ? Math.min(24, Math.max(0, Number(raw.customHours))) : 8,
    customMinutes: Number.isFinite(Number(raw.customMinutes)) ? Math.min(59, Math.max(0, Number(raw.customMinutes))) : 0,
    halfDay: ["full", "first", "second"].includes(raw.halfDay) ? raw.halfDay : "full",
    breaks: Array.isArray(raw.breaks)
      ? raw.breaks.filter(b => b && Number(b.minutes) > 0)
          .map(b => ({ id: String(b.id || newId()), minutes: Math.min(1440, Math.floor(Number(b.minutes))), label: String(b.label || "Break") }))
      : []
  };
}

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return { version: 1, settings: { ...DEFAULT_SETTINGS }, days: {} };
    const settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
    const days = {};
    if (saved.days && typeof saved.days === "object") {
      for (const [date, raw] of Object.entries(saved.days)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) days[date] = normalizeDay(date, raw, settings.target);
      }
    }
    return { version: 1, settings, days };
  } catch {
    return { version: 1, settings: { ...DEFAULT_SETTINGS }, days: {} };
  }
}

let state = readState();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("ShiftMate could not save data:", error);
    return false;
  }
}

export const repository = {
  settings: () => ({ ...state.settings }),
  updateSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    return persist();
  },
  getDay(date) {
    return state.days[date] ? structuredClone(state.days[date]) : null;
  },
  getOrCreateDay(date) {
    if (!state.days[date]) state.days[date] = makeEmptyDay(date, state.settings.target);
    return structuredClone(state.days[date]);
  },
  saveDay(day) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) return false;
    state.days[day.date] = normalizeDay(day.date, {
      ...day,
      updatedAt: new Date().toISOString()
    }, state.settings.target);
    return persist();
  },
  deleteDay(date) {
    delete state.days[date];
    return persist();
  },
  allDays() {
    return Object.values(state.days).map(d => structuredClone(d)).sort((a, b) => b.date.localeCompare(a.date));
  },
  newId,
  exportAll() {
    return structuredClone({ version: state.version, settings: state.settings, days: state.days });
  }
};

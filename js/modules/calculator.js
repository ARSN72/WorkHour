import { parseTime, actualDurationSeconds } from "./date-time.js";

export function targetMinutes(day) {
  let target = day.target === "custom"
    ? Number(day.customHours || 0) * 60 + Number(day.customMinutes || 0)
    : Number(day.target || 8) * 60;
  if (day.halfDay === "first" || day.halfDay === "second") target /= 2;
  return Math.max(0, Math.round(target));
}

export function totalBreakMinutes(day) {
  return (day.breaks || []).reduce((sum, item) => sum + Math.max(0, Number(item.minutes) || 0), 0);
}

export function calculate(day, settings, now = new Date()) {
  const start = parseTime(day.startTime);
  const end = day.endTime ? parseTime(day.endTime) : null;
  const targetMin = targetMinutes(day);
  const breakMin = totalBreakMinutes(day);
  const targetSec = targetMin * 60;
  const completed = Boolean(day.endTime && end !== null);
  let rawElapsedSec = 0;

  if (start !== null) {
    if (completed) {
      rawElapsedSec = actualDurationSeconds(day.startTime, day.endTime) || 0;
    } else {
      const startDate = new Date(`${day.date}T00:00:00`);
      const startAt = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), Math.floor(start / 60), start % 60).getTime();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const dayAt = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
      // A forgotten, unfinished past-day record is frozen at midnight after that date.
      const effectiveNow = today > dayAt ? startAt + 86400000 : now.getTime();
      rawElapsedSec = Math.max(0, Math.floor((effectiveNow - startAt) / 1000));
    }
  }

  const includeBreaks = Boolean(settings.includeBreaks);
  const netSec = Math.max(0, rawElapsedSec - (includeBreaks ? 0 : breakMin * 60));
  const remainingSec = Math.max(0, targetSec - netSec);
  const overtimeSec = Math.max(0, netSec - targetSec);
  const estimatedExitMin = start === null ? null : (start + targetMin + (includeBreaks ? 0 : breakMin)) % 1440;
  const percent = targetSec ? Math.min(100, netSec / targetSec * 100) : 0;

  return {
    startMin: start, endMin: end, targetMin, targetSec, breakMin,
    rawElapsedSec, netSec, remainingSec, overtimeSec, estimatedExitMin,
    percent, completed, hasStart: start !== null, deltaSec: netSec - targetSec
  };
}

// 1-clock.js — time. The 24-hour clock that pauses on weekends and holidays, the window
// each morning's report covers, and how dates are written. No network in here, so every
// rule can be tested on invented dates.
const { SETTINGS } = require("./config");

const HOUR = 3600e3, DAY = 24 * HOUR;
const OFF = SETTINGS.TZ_OFFSET_HOURS * HOUR;
const dayStart = (t) => Math.floor((t + OFF) / DAY) * DAY - OFF;   // midnight, Pakistan time
const dateKey = (t) => new Date(t + OFF).toISOString().slice(0, 10);
const weekday = (t) => new Date(t + OFF).getUTCDay();
const pad = (n) => String(n).padStart(2, "0");

function makeClock({ holidays = SETTINGS.HOLIDAYS, flat = SETTINGS.FLAT_24_HOURS, hours = SETTINGS.REPLY_HOURS } = {}) {
  const off = new Set(holidays || []);
  const isWorkingDay = (t) => flat || (!SETTINGS.WEEKEND_DAYS.includes(weekday(t)) && !off.has(dateKey(t)));
  const nextWorkingDayFrom = (d) => { let x = d; for (let i = 0; i < 60 && !isWorkingDay(x); i++) x += DAY; return x; };

  // `hours` of working time after t. Friday 3pm -> Monday 3pm.
  function deadline(t) {
    if (flat) return t + hours * HOUR;
    let cursor = isWorkingDay(t) ? t : nextWorkingDayFrom(dayStart(t) + DAY);
    let remaining = hours * HOUR;
    for (let i = 0; i < 90; i++) {
      const end = dayStart(cursor) + DAY;
      if (end - cursor >= remaining) return cursor + remaining;
      remaining -= end - cursor;
      cursor = nextWorkingDayFrom(end);
    }
    return cursor;
  }

  // working time between two moments, in ms
  function workingBetween(a, b) {
    if (!(b > a)) return 0;
    if (flat) return b - a;
    let total = 0;
    for (let d = dayStart(a), i = 0; d < b && i < 800; d += DAY, i++) {
      if (!isWorkingDay(d)) continue;
      const s = Math.max(a, d), e = Math.min(b, d + DAY);
      if (e > s) total += e - s;
    }
    return total;
  }

  const spannedDayOff = (a, b) => {
    if (flat) return false;
    for (let d = dayStart(a), i = 0; d < b && i < 60; d += DAY, i++) if (!isWorkingDay(d)) return true;
    return false;
  };

  return { deadline, workingBetween, isWorkingDay, spannedDayOff };
}

// The report covers emails whose 24 hours ended in (start, end]. `end` is today's cut-off
// (11:00 Pakistan time), or yesterday's if the run is earlier in the day than that.
// A date "YYYY-MM-DD" re-runs the report for that morning.
function reportWindow(asOf, now = Date.now()) {
  let end;
  if (asOf && /^\d{4}-\d{2}-\d{2}$/.test(String(asOf).trim())) {
    const sign = SETTINGS.TZ_OFFSET_HOURS >= 0 ? "+" : "-";
    end = Date.parse(`${String(asOf).trim()}T${pad(SETTINGS.REPORT_HOUR)}:00:00${sign}${pad(Math.abs(SETTINGS.TZ_OFFSET_HOURS))}:00`);
  } else {
    const today = dayStart(now) + SETTINGS.REPORT_HOUR * HOUR;
    end = now >= today ? today : today - DAY;
  }
  return { start: end - DAY, end };
}

// ---- wording ----
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtWhen = (t) => {
  if (!t) return "";
  const d = new Date(t + OFF);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const fmtDay = (t) => { const d = new Date(t + OFF); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const hrs = (ms) => Math.max(0, Math.round(ms / HOUR));
const span = (ms) => {
  const h = hrs(ms);
  if (h < 48) return `${h} hr${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24), r = h % 24;
  return `${d} day${d === 1 ? "" : "s"}${r ? ` ${r} hr${r === 1 ? "" : "s"}` : ""}`;
};

module.exports = { makeClock, reportWindow, fmtWhen, fmtDay, hrs, span, dayStart, dateKey, HOUR, DAY };

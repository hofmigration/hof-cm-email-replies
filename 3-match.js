// 3-match.js — client emails into waits, and how each wait was answered. No network in
// here, so every rule is tested on invented emails before it is used on real people.
const { SETTINGS } = require("./config");
const { HOUR, fmtWhen, span, hrs } = require("./1-clock");

// "a@x.com; B <b@y.com>" -> ["a@x.com", "b@y.com"]
const addresses = (s) => (String(s || "").toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []);
const ms = (v) => (typeof v === "number" ? v : Date.parse(v) || 0);

// a sent email only counts if it actually went out
const sentOk = (status) => !/bounce|fail|schedul|cancel|error/i.test(String(status || ""));

// A wait opens with the first client email that needs a reply after HOF last wrote to them,
// takes in any further emails, and closes at the next email HOF sends to them. Three
// emails in a row are one wait, timed from the first — not three delays.
function buildWaits(emails, replies) {
  const ev = [...emails.map((e) => ({ t: e.at, k: 0, e })), ...replies.map((r) => ({ t: r.at, k: 1, r }))]
    .sort((a, b) => a.t - b.t || a.k - b.k);
  const waits = []; let open = null;
  for (const x of ev) {
    if (x.k === 0) { if (!open) { open = { emails: [x.e], reply: null }; waits.push(open); } else open.emails.push(x.e); }
    else if (open) { open.reply = x.r; open = null; }
  }
  return waits;
}

// Connected: the "Connected" outcome, or a call of 60 seconds or more whose outcome does not
// say otherwise. A call that rang out, was busy or went to voicemail does not count.
function connected(call) {
  const p = call.properties || call;
  const disp = String(p.hs_call_disposition || "");
  if (disp === SETTINGS.CONNECTED_DISPOSITION) return true;
  if (SETTINGS.NOT_CONNECTED_DISPOSITIONS.includes(disp)) return false;
  if (/busy|no.?answer|failed|cancel|missed|queued|ringing/i.test(String(p.hs_call_status || ""))) return false;
  return Number(p.hs_call_duration || 0) >= SETTINGS.CONNECTED_MIN_SECONDS * 1000;
}

// verdicts: on-time | call | whatsapp | late | none | waiting
// whatsapp: what HOF sent the client on WhatsApp ([{ at, by, kind, preview, line }]), or null
// when WhatsApp could not be checked for them
function judge(wait, { clock, now, calls = [], whatsapp = null }) {
  const start = wait.emails[0].at;
  const due = clock.deadline(start);
  const replyAt = wait.reply ? wait.reply.at : null;
  const conn = calls.filter(connected)
    .map((c) => { const p = c.properties || c; return { at: ms(p.hs_timestamp), ownerId: String(p.hubspot_owner_id || ""), title: p.hs_call_title || "", id: String(c.id || "") }; })
    .filter((c) => c.at >= start && c.at <= now).sort((a, b) => a.at - b.at);
  const callIn = conn.find((c) => c.at <= due) || null;
  const callAfter = conn.find((c) => c.at > due) || null;
  // a WhatsApp from HOF after the client wrote: a text, a voice note or a file
  const wa = (whatsapp || []).filter((m) => m.at >= start && m.at <= now).sort((a, b) => a.at - b.at);
  const waIn = wa.find((m) => m.at <= due) || null;
  const waAfter = wa.find((m) => m.at > due) || null;

  let verdict;
  if (replyAt !== null && replyAt <= due) verdict = "on-time";
  else if (callIn) verdict = "call";
  else if (waIn) verdict = "whatsapp";
  else if (replyAt !== null) verdict = "late";
  else if (now > due) verdict = "none";
  else verdict = "waiting";

  const end = replyAt !== null ? replyAt : now;
  const chaseMs = 2 * HOUR;
  const chased = wait.emails.slice(1).filter((e) => (replyAt === null || e.at < replyAt) && clock.workingBetween(start, e.at) >= chaseMs).length;
  return {
    start, due, replyAt, callIn, callAfter, waIn, waAfter, waChecked: whatsapp !== null, verdict, chased,
    workMs: clock.workingBetween(start, end),
    overMs: verdict === "late" || verdict === "none" ? clock.workingBetween(due, end) : 0,
    leftMs: verdict === "waiting" ? Math.max(0, due - now) : 0,
    dayOff: clock.spannedDayOff(start, Math.max(end, due)),
  };
}

// Each client email is flagged once, on the day its 24 hours end. A wait that fell due before
// this report (and so was reported then) comes back only when the client wrote again: from
// their first email whose own 24 hours end after the last cut-off, as a wait of its own —
// they are chasing. -> { w, again } to judge and show, or null when there is nothing new.
function partToShow(w, clock, window) {
  if (clock.deadline(w.emails[0].at) > window.start) return { w, again: null };
  const k = w.emails.findIndex((e, i) => i > 0 && clock.deadline(e.at) > window.start);
  if (k < 0) return null;
  return { w: { emails: w.emails.slice(k), reply: w.reply }, again: { firstAt: w.emails[0].at, earlier: k } };
}

// High: a complaint or refund, a chaser (in words, or the client wrote again before an answer),
// a problem or mistake pointed out, or urgent or tied to a date. Anything else needing a reply
// is Medium. Low emails never reach a wait.
const HIGH_FLAGS = ["complaint", "chaser", "problem", "urgent"];
const priorityOf = (flags, chased, again) => (again || chased > 0 || (flags || []).some((f) => HIGH_FLAGS.includes(f)) ? "high" : "medium");

// Which section of today's report each wait belongs to. High priority always comes first.
//   due      — its 24 hours ended between yesterday's cut-off and today's
//   next     — not due yet, nobody has answered
function sortOut(rows, window) {
  const inWin = (r) => r.due > window.start && r.due <= window.end;
  const due = rows.filter(inWin);
  const high = (a, b) => (b.priority === "high") - (a.priority === "high");
  const complaintFirst = (a, b) => (b.flags || []).includes("complaint") - (a.flags || []).includes("complaint");
  const byCm = (a, b) => high(a, b) || String(a.cm).localeCompare(String(b.cm)) || a.start - b.start;
  return {
    due,
    onTime: due.filter((r) => r.verdict === "on-time").sort(byCm),
    call: due.filter((r) => r.verdict === "call").sort(byCm),
    whatsapp: due.filter((r) => r.verdict === "whatsapp").sort(byCm),
    late: due.filter((r) => r.verdict === "late").sort((a, b) => high(a, b) || complaintFirst(a, b) || b.overMs - a.overMs),
    none: due.filter((r) => r.verdict === "none").sort((a, b) => high(a, b) || complaintFirst(a, b) || b.overMs - a.overMs),
    next: rows.filter((r) => r.due > window.end && r.verdict === "waiting").sort((a, b) => high(a, b) || a.due - b.due),
  };
}

// one line per case manager — every one of them, so a quiet day shows as a zero
function perCaseManager(s) {
  const names = Object.values(SETTINGS.CASE_MANAGERS);
  const count = (list, n) => list.filter((r) => r.cm === n).length;
  const flagged = [...s.none, ...s.late];
  const lines = names.map((n) => {
    const onTime = count(s.onTime, n), call = count(s.call, n), whatsapp = count(s.whatsapp || [], n), late = count(s.late, n), none = count(s.none, n);
    const judged = onTime + late + none;
    return { cm: n, due: count(s.due, n), onTime, call, whatsapp, late, none, high: flagged.filter((r) => r.cm === n && r.priority === "high").length,
      next: count(s.next, n), pct: judged ? Math.round((onTime / judged) * 100) : null };
  }).sort((a, b) => b.high - a.high || (b.none + b.late) - (a.none + a.late) || a.cm.localeCompare(b.cm));
  const sum = (k) => lines.reduce((t, l) => t + l[k], 0);
  const judged = sum("onTime") + sum("late") + sum("none");
  const total = { cm: "All case managers", due: sum("due"), onTime: sum("onTime"), call: sum("call"), whatsapp: sum("whatsapp"), late: sum("late"), none: sum("none"),
    high: sum("high"), next: sum("next"), pct: judged ? Math.round((sum("onTime") / judged) * 100) : null };
  return { lines, total };
}

// the plain sentence a reader sees next to each row
function statusText(r, now) {
  const by = (who) => (who ? ` by ${who}` : "");
  switch (r.verdict) {
    case "on-time": return `Replied ${fmtWhen(r.replyAt)}${by(r.replyBy)} — ${span(r.workMs)}`;
    case "late": return `Replied ${fmtWhen(r.replyAt)}${by(r.replyBy)} — ${hrs(r.workMs)} working hrs, ${span(r.overMs)} over`;
    case "none": return `No reply yet — waiting ${span(r.workMs)}, ${span(r.overMs)} over` +
      (r.callAfter ? `. A connected call came later, ${fmtWhen(r.callAfter.at)}${by(r.callAfter.by)}` : "") +
      (r.waAfter ? `. A WhatsApp ${r.waAfter.kind} came later, ${fmtWhen(r.waAfter.at)}${by(r.waAfter.by)}` : "");
    case "call": return `Connected call ${fmtWhen(r.callIn.at)}${by(r.callIn.by)}` +
      (r.replyAt ? ` · email reply came later, ${fmtWhen(r.replyAt)}` : " · no email reply yet");
    case "whatsapp": return `WhatsApp ${r.waIn.kind} ${fmtWhen(r.waIn.at)}${by(r.waIn.by)}` +
      (r.replyAt ? ` · email reply came later, ${fmtWhen(r.replyAt)}` : " · no email reply yet");
    case "waiting": return r.due < now ? "Past the 24 hours since the cut-off" : `${span(r.leftMs)} left`;
    default: return "";
  }
}

module.exports = { addresses, sentOk, buildWaits, connected, judge, partToShow, priorityOf, sortOut, perCaseManager, statusText, ms, HIGH_FLAGS };

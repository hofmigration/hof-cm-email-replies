// 4-workbook.js — the attached sheet. Every row the email shows, and every row it had no
// room for, plus every email received in the last 24 hours with the decision made on it —
// so the rules can be checked, not just trusted.
const ExcelJS = require("exceljs");
const { SETTINGS } = require("./config");
const { fmtWhen, fmtDay, hrs } = require("./1-clock");

const NAVY = "FF16205E", ROYAL = "FF1F2F8F", LINE = "FFE6E9F1", PANEL = "FFF7F9FC";
const RED = "FFFDECEA", REDTX = "FFB42318", AMBER = "FFFFF5E8", AMBERTX = "FF9A5B0C", GREEN = "FFE9F6EE", GREENTX = "FF1E7A4D", BLUE = "FFEAF1FB", BLUETX = "FF1D4F91";
const thin = { style: "thin", color: { argb: LINE } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };
const TONE = { none: [RED, REDTX], late: [AMBER, AMBERTX], call: [BLUE, BLUETX], whatsapp: [BLUE, BLUETX], "on-time": [GREEN, GREENTX], waiting: [PANEL, "FF3F4A5A"] };
const VERDICT = { none: "No reply", late: "Replied late", call: "Call, no email in 24h", whatsapp: "WhatsApp, no email in 24h", "on-time": "On time", waiting: "Not due yet" };
const FLAG = { complaint: "Complaint", chaser: "Chasing", problem: "Problem raised", urgent: "Urgent or dated", call: "Asked for a call" };
const PRIORITY = { high: ["High", RED, REDTX], medium: ["Medium", AMBER, AMBERTX], low: ["Low", PANEL, "FF868E9B"] };

function title(ws, text, sub, width = 10) {
  const last = String.fromCharCode(64 + Math.min(width, 26));
  ws.mergeCells(`A1:${last}1`);
  const t = ws.getCell("A1");
  t.value = text;
  t.font = { name: "Arial", bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  t.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 30;
  if (sub) {
    ws.mergeCells(`A2:${last}2`);
    const s = ws.getCell("A2");
    s.value = sub;
    s.font = { name: "Arial", size: 10, color: { argb: "FF4A5262" } };
    s.alignment = { vertical: "middle", indent: 1, wrapText: true };
    ws.getRow(2).height = 32;
  }
}
function header(ws, rowNo, labels) {
  const r = ws.getRow(rowNo);
  labels.forEach((l, i) => {
    const c = r.getCell(i + 1);
    c.value = l;
    c.font = { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "middle", wrapText: true };
    c.border = BOX;
  });
  r.height = 30;
}
const link = (url, text) => (url ? { text, hyperlink: url } : "");

const COLS = [
  ["Case manager", 20], ["Client", 24], ["Client email", 28], ["Subject", 34], ["Client wrote", 17], ["Due by", 17],
  ["Status", 20], ["Priority", 10], ["Reply sent", 17], ["Replied by", 18], ["Working hrs to reply", 11], ["Over by (working hrs)", 11],
  ["Connected call", 17], ["Called by", 18], ["WhatsApp from HOF", 17], ["WhatsApp sent by", 18], ["WhatsApp message", 40],
  ["Why it needs a reply", 30], ["Flags", 20], ["What the client wrote", 70],
  ["Action the client asked for", 40], ["Emails in this wait", 10], ["Notes", 30], ["Deal", 12], ["Contact", 12],
];
const COL = (name) => COLS.findIndex(([h]) => h === name) + 1;
const LAST_COL = String.fromCharCode(64 + COLS.length);
// the HOF WhatsApp number, when it is not simply the sender's own number ("HOF Migration")
const otherLine = (wa) => { const a = String(wa.line || "").toLowerCase().trim(), b = String(wa.by || "").toLowerCase().trim(); return a && !b.includes(a) && !a.includes(b); };
const aKind = (k) => `${/^[aeiou]/i.test(k) ? "An" : "A"} ${k}`;       // "A voice note", "An image"
// the WhatsApp number(s) that were read, e.g. "HOF Migration (+971 4 …)"
const linesOf = (m) => ((m && m.lines) || []).map((l) => (l.phone ? `${l.name} (${l.phone})` : l.name)).join(", ");

function notes(r) {
  const n = [];
  if (r.again) n.push(`Client wrote again: their first email (${fmtWhen(r.again.firstAt)}) was flagged on an earlier day, and this one has had no answer in 24 hours either`);
  if (r.ccOnly) n.push("Case manager was in CC only");
  if (r.onLeave && r.onLeave.length) n.push(`On leave: ${r.onLeave.join(", ")}`);
  if (r.otherCms && r.otherCms.length) n.push(`Also emailed: ${r.otherCms.join(", ")}`);
  if (r.chased) n.push(`Client wrote again ${r.chased} time${r.chased > 1 ? "s" : ""} before an answer`);
  if (r.dayOff && !SETTINGS.FLAT_24_HOURS) n.push("A weekend or holiday fell in between and was not counted");
  if ((r.verdict === "call" || r.verdict === "whatsapp") && r.replyAt) n.push(`Email reply came later: ${fmtWhen(r.replyAt)}`);
  if (r.verdict === "none" && r.callAfter) n.push(`Connected call after the 24 hours: ${fmtWhen(r.callAfter.at)}`);
  if (r.verdict === "none" && r.waAfter) n.push(`WhatsApp from HOF after the 24 hours: ${fmtWhen(r.waAfter.at)}`);
  if ((r.waIn || r.waAfter) && r.waFound === "name") n.push("Found on WhatsApp by name, not by phone number: check it is the same person");
  if (r.verdict === "none" && r.ask) n.push("Action needed, no reply or connected call: even if it has been done, confirm it to the client");
  if (r.verdict === "none" || r.verdict === "late") {
    if (r.waFound === "none") n.push("No WhatsApp chat with this client on the number Mesh checks (searched by every number and the name)");
    else if (r.waFound === "clash") n.push("WhatsApp not checked: no number matched, and more than one WhatsApp contact has this client's name");
    else if (r.waFound === "" ) n.push("WhatsApp not checked");
  }
  return n.join(". ");
}

function waitSheet(wb, name, heading, sub, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 3, xSplit: 2, showGridLines: false }] });
  ws.columns = COLS.map(([, w]) => ({ width: w }));
  title(ws, heading, sub, 12);
  header(ws, 3, COLS.map(([h]) => h));
  rows.forEach((r, i) => {
    const call = r.callIn || (r.verdict === "none" ? r.callAfter : null);
    const wa = r.waIn || (r.verdict === "none" ? r.waAfter : null);
    const x = ws.getRow(4 + i);
    x.values = [
      r.cm, r.client, r.clientEmail, r.subject, fmtWhen(r.start), fmtWhen(r.due), VERDICT[r.verdict] || r.verdict,
      (PRIORITY[r.priority] || ["", ""])[0],
      r.replyAt ? fmtWhen(r.replyAt) : "", r.replyBy || "",
      r.replyAt ? hrs(r.workMs) : "", r.overMs ? hrs(r.overMs) : "",
      call ? fmtWhen(call.at) : "", call ? call.by || "" : "",
      wa ? fmtWhen(wa.at) : "", wa ? [wa.by, otherLine(wa) ? `(on ${wa.line})` : ""].filter(Boolean).join(" ") : "",
      wa ? (wa.kind === "message" ? wa.preview : aKind(wa.kind)) : "",
      r.reason || "", (r.flags || []).map((f) => FLAG[f]).filter(Boolean).join(", "), r.words || "", r.ask || "",
      r.count, notes(r), link(r.dealLink, "Deal"), link(r.contactLink, "Contact"),
    ];
    x.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BOX;
      cell.alignment = { vertical: "top", wrapText: true };
      cell.font = col >= COL("Deal") ? { name: "Arial", size: 10, color: { argb: ROYAL }, underline: true } : { name: "Arial", size: 10 };
    });
    const [bg, tx] = TONE[r.verdict] || [PANEL, "FF1F2937"];
    x.getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    x.getCell(7).font = { name: "Arial", size: 10, bold: true, color: { argb: tx } };
    const pr = PRIORITY[r.priority];
    if (pr) {
      x.getCell(COL("Priority")).fill = { type: "pattern", pattern: "solid", fgColor: { argb: pr[1] } };
      x.getCell(COL("Priority")).font = { name: "Arial", size: 10, bold: true, color: { argb: pr[2] } };
    }
    if ((r.flags || []).includes("complaint")) x.getCell(COL("Flags")).font = { name: "Arial", size: 10, bold: true, color: { argb: REDTX } };
    const ask = COL("Action the client asked for");
    if (r.verdict === "none" && r.ask) { x.getCell(ask).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } }; x.getCell(ask).font = { name: "Arial", size: 10, bold: true, color: { argb: REDTX } }; }
  });
  if (rows.length) ws.autoFilter = { from: "A3", to: `${LAST_COL}${3 + rows.length}` };
  else ws.getCell("A4").value = "None.";
  return ws;
}

// what happened with the WhatsApp check on this run
function meshLines(m) {
  if (!m || !m.used) return [];
  if (!m.on) return [`WARNING: WhatsApp was NOT checked on this run: ${m.why}. Emails answered only on WhatsApp may be flagged.`];
  const n = (v, w) => `${v} ${w}${v === 1 ? "" : "s"}`;
  return [
    `This run read WhatsApp on ${linesOf(m) || "Mesh"}: ${n(m.chats, "chat")} and ${n(m.messages, "message")} since ${fmtWhen(m.since)}, ${m.hofMessages} of them sent by HOF.`,
    `${n(m.clients, "client")} looked up — ${m.byNumber} found by phone number, ${m.byName} by name, ${m.notFound} with no chat on this number${m.nameClash ? ` (${m.nameClash} of them because several WhatsApp contacts share the name)` : ""}. ${n(m.replies, "WhatsApp message")} from HOF came after their emails.`,
    ...(m.problems || []).map((p) => `WARNING: ${p}.`),
  ];
}

async function buildWorkbook(r) {
  const s = r.sections;
  const wb = new ExcelJS.Workbook();
  wb.creator = "HOF Compliance";
  const windowText = `Client emails whose 24 hours ended between ${fmtWhen(r.window.start)} and ${fmtWhen(r.window.end)} (Pakistan time).`;

  // ---------- Summary ----------
  const sm = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  sm.columns = [{ width: 26 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 11 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 10 }, { width: 11 }];
  title(sm, `Case manager email replies — ${fmtDay(r.window.end)}`, windowText, 10);
  const hi = (list) => list.filter((x) => x.priority === "high").length;
  const kpi = [
    ["Fell due in this report", s.due.length, null],
    ["Answered by email within 24 hours", s.onTime.length, GREEN],
    ["High priority — no reply", hi(s.none), hi(s.none) ? RED : null],
    ["Medium priority — no reply", s.none.length - hi(s.none), s.none.length - hi(s.none) ? RED : null],
    ["Replied late (high and medium)", s.late.length, s.late.length ? AMBER : null],
    ["No email in 24 hours, but a connected call", s.call.length, s.call.length ? BLUE : null],
    ["No email in 24 hours, but answered on WhatsApp", (s.whatsapp || []).length, (s.whatsapp || []).length ? BLUE : null],
    ["Due before the next report", s.next.length, null],
    ["Low priority — received in the last 24 hours, nothing to answer, not counted", r.notCountedToday, null],
  ];
  let row = 4;
  for (const [k, v, fill] of kpi) {
    sm.mergeCells(`A${row}:F${row}`);
    const a = sm.getCell(`A${row}`), b = sm.getCell(`G${row}`);
    a.value = k; b.value = v;
    a.font = { name: "Arial", size: 11, color: { argb: "FF3F4A5A" } };
    b.font = { name: "Arial", size: 11, bold: true, color: { argb: NAVY } };
    a.border = BOX; b.border = BOX;
    if (fill) b.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    row++;
  }
  row += 1;
  header(sm, row, ["Case manager", "Due", "On time", "By call", "By WhatsApp", "Late", "No reply", "High flagged", "Due next", "On time %"]);
  row++;
  for (const l of [...r.byCm.lines, r.byCm.total]) {
    const x = sm.getRow(row);
    x.values = [l.cm, l.due, l.onTime, l.call, l.whatsapp || 0, l.late, l.none, l.high || 0, l.next, l.pct == null ? "—" : l.pct / 100];
    x.eachCell({ includeEmpty: true }, (cell) => { cell.border = BOX; cell.font = { name: "Arial", size: 10, bold: l === r.byCm.total }; });
    if (l.pct != null) {
      x.getCell(10).numFmt = "0%";
      x.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: l.pct >= 90 ? GREEN : l.pct >= 70 ? AMBER : RED } };
    }
    if (l.none) x.getCell(7).font = { name: "Arial", size: 10, bold: true, color: { argb: REDTX } };
    if (l.high) x.getCell(8).font = { name: "Arial", size: 10, bold: true, color: { argb: REDTX } };
    row++;
  }
  sm.getCell(`A${row + 1}`).value = "On time % is of the emails that were not handled by phone or WhatsApp: on time ÷ (on time + late + no reply). High flagged: high-priority emails with no reply or a late one.";
  sm.getCell(`A${row + 1}`).font = { name: "Arial", size: 9.5, italic: true, color: { argb: "FF868E9B" } };

  // ---------- the rows ----------
  waitSheet(wb, "Flagged", "Flagged — not answered within 24 hours", `${windowText} No reply at all first, then late replies; High priority first in each, then the longest waits.`, [...s.none, ...s.late]);
  waitSheet(wb, "Call, no email", "No email reply in 24 hours, but a connected call", "The client was reached by phone within the 24 hours — a connected call on their contact or deal.", s.call);
  waitSheet(wb, "WhatsApp, no email", "No email reply in 24 hours, but answered on WhatsApp", "HOF sent the client a WhatsApp within the 24 hours (a text, a voice note or a file), seen in Mesh. The message is shown so you can see whether it was about the email.", s.whatsapp || []);
  waitSheet(wb, "Due next", "Due before the next report", "Not late yet, and nobody has replied. High priority first.", s.next);
  waitSheet(wb, "On time", "Answered by email within 24 hours", windowText, s.onTime);

  // ---------- every email received, with the decision ----------
  const ig = wb.addWorksheet("All emails received", { views: [{ state: "frozen", ySplit: 3, showGridLines: false }] });
  ig.columns = [{ width: 17 }, { width: 20 }, { width: 30 }, { width: 36 }, { width: 13 }, { width: 40 }, { width: 80 }];
  title(ig, "Every client email received in the last 24 hours, and the decision", "Use this to check the rules: anything marked Low that clearly needed an answer should be reported, and the rule changed in config.js or 2-classify.js. High and Medium need a reply within 24 hours; Low has nothing to answer and is not counted.", 7);
  header(ig, 3, ["Received", "Case manager", "From", "Subject", "Priority", "Why", "What they wrote"]);
  r.intake.forEach((e, i) => {
    const x = ig.getRow(4 + i);
    const pr = PRIORITY[e.priority || (e.counted ? "medium" : "low")];
    const why = [e.reason || "", ...((e.flags || []).includes("urgent") && e.counted ? ["urgent or dated"] : [])].filter(Boolean).join(" · ");
    x.values = [fmtWhen(e.at), e.cm, e.from, e.subject, pr[0], why, e.words || ""];
    x.eachCell({ includeEmpty: true }, (cell) => { cell.border = BOX; cell.alignment = { vertical: "top", wrapText: true }; cell.font = { name: "Arial", size: 10 }; });
    x.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: pr[1] } };
    x.getCell(5).font = { name: "Arial", size: 10, bold: true, color: { argb: pr[2] } };
  });
  if (r.intake.length) ig.autoFilter = { from: "A3", to: `G${3 + r.intake.length}` };

  // ---------- how it was checked ----------
  const h = wb.addWorksheet("How it was checked", { views: [{ showGridLines: false }] });
  h.columns = [{ width: 120 }];
  title(h, "How this was checked", null, 1);
  const lines = [
    `Case managers: ${Object.values(SETTINGS.CASE_MANAGERS).join(", ")}.`,
    "Every email that reached their HubSpot-connected inboxes is read. Emails that never reached HubSpot cannot be seen.",
    "",
    "THE RULE",
    SETTINGS.FLAT_24_HOURS
      ? `A client email that needs a reply gets one within ${SETTINGS.REPLY_HOURS} hours, counted straight through.`
      : `A client email that needs a reply gets one within ${SETTINGS.REPLY_HOURS} hours. Saturday, Sunday and UAE public holidays are not counted, so Friday afternoon is due Monday afternoon and Monday afternoon is due Tuesday afternoon.`,
    `Each report covers the emails whose 24 hours ended between the previous ${String(SETTINGS.REPORT_HOUR).padStart(2, "0")}:00 cut-off and this one, so every email is judged exactly once. Times are Pakistan time.`,
    "An email is flagged once, on the day its 24 hours end. If the client writes again and that email also goes unanswered for 24 hours, it is flagged again, as High priority, marked \"Wrote again\".",
    ...(r.missingYears && r.missingYears.length ? [`WARNING: no UAE holidays are listed for ${r.missingYears.join(", ")}, so holidays in that year were counted as working days.`] : []),
    "",
    "WHICH EMAILS NEED A REPLY, AND THEIR PRIORITY",
    "Only the client's new words are read — the quoted thread underneath, signatures and phone footers are removed first.",
    "HIGH (needs a reply, listed first): a complaint or refund (\"not happy\", \"refund\", \"cancel my case\"), a chaser (\"any update?\", \"it's been 9 days\", or the client wrote again before an answer), a problem or mistake pointed out, or something urgent or tied to a date — \"urgent\", \"asap\", a deadline, an appointment, biometrics, an interview, a visa or passport expiring, \"by Monday\". \"Not urgent\", \"no rush\" and the client's own promises (\"I will send it asap\") do not count as urgent.",
    "MEDIUM (needs a reply): any other question, request (please advise / confirm / send / check) or request for a call or meeting.",
    `LOW (nothing to answer — not counted, and not shown in the email): emails from HOF staff, automatic messages (auto-replies, reactions, delivery notices, no-reply senders), thank-yous and acknowledgements, emails that only send documents or information with nothing asked, and long messages with no question or request${SETTINGS.COUNT_DOCUMENTS_ONLY ? ". (Documents are currently COUNTED, as Medium, because COUNT_DOCUMENTS_ONLY is on.)" : ""}${SETTINGS.COUNT_LONG_MESSAGES ? ". (Long messages are currently COUNTED, as Medium, because COUNT_LONG_MESSAGES is on.)" : ""}.`,
    "High and Medium both have the same 24 hours; High is listed first everywhere.",
    "A thank-you is read without what it thanks for: \"Thank you for the clarification\", \"Kindly noted\" and \"Thanks, keep me posted\" are acknowledgements. \"Thanks for the update, please send the draft\" still asks for the draft.",
    "",
    "ACTIONS ASKED FOR",
    "When the client asked for something to be done (send, share, check, correct, book a call, process a refund…), that sentence is shown in the \"Action the client asked for\" column. If there was no reply and no connected call, the row is marked: the action was needed, and even if it has been done, the client must be told.",
    "Every email received in the last 24 hours is in the \"All emails received\" tab with the decision and the reason.",
    "",
    "WHAT COUNTS AS AN ANSWER",
    "A reply is any email from anyone at HOF sent to the client's address after they wrote. Several client emails in a row are one wait, timed from the first.",
    "If no email went back within 24 hours, the client's contact and deals are checked for a connected call in those 24 hours. Case managers log most calls on the deal, so both are checked.",
    `Connected means the "Connected" call outcome, or a call of ${SETTINGS.CONNECTED_MIN_SECONDS} seconds or more whose outcome is not no-answer, busy, wrong number or voicemail.`,
    "Those emails are listed in their own section instead of being flagged.",
    "",
    "WHATSAPP, FROM MESH",
    "If no email went back within 24 hours and there was no connected call, WhatsApp is checked too, through Mesh's read-only Compliance Read API: a WhatsApp from anyone at HOF to the client in those 24 hours puts the email in its own section, \"answered on WhatsApp\", instead of flagging it.",
    "A text, a voice note or a file all count, and so does a message typed on the team phone (WhatsApp Business app). Voice notes are not listened to: one sent in that time means the conversation happened. Internal notes, campaigns, bots, automations, Mesh's own messages, and messages that failed or never left do not count.",
    "The client is found by every phone number on their HubSpot contact (phone, mobile, mobile number and WhatsApp number). Only if no number matches is their name tried, exactly as in HubSpot, and only when exactly one WhatsApp contact on the number has that name.",
    "Only the WhatsApp numbers the Mesh key covers are read (named below). A WhatsApp sent from any other number, such as a case manager's own, is not seen.",
    "The WhatsApp message is shown next to the email, so you can see whether it was about what the client asked.",
    ...meshLines(r.mesh),
    "",
    "LIMITS WORTH KNOWING",
    "A reply from a personal email is not seen, a call not logged in HubSpot is not seen, and a WhatsApp from a number the Mesh key does not cover (such as a case manager's own number) is not seen.",
    "A reply to the client on any thread counts, even if it does not answer the particular question.",
    "The rules read words, not meaning. Check the client's email in HubSpot before acting on any single row.",
    "Approved leave does not pause the clock — the client is still waiting — but rows are marked so cover can be arranged.",
  ];
  lines.forEach((l, i) => {
    const cell = h.getCell(`A${3 + i}`);
    cell.value = l;
    const head = /^[A-Z][A-Z ,]+$/.test(l);
    cell.font = { name: "Arial", size: head ? 10 : 10.5, bold: head || /^WARNING/.test(l), color: { argb: head ? NAVY : /^WARNING/.test(l) ? REDTX : "FF3F4A5A" } };
    cell.alignment = { wrapText: true, vertical: "top" };
  });
  return wb;
}

module.exports = { buildWorkbook };

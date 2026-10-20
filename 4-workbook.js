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
const TONE = { none: [RED, REDTX], late: [AMBER, AMBERTX], call: [BLUE, BLUETX], "on-time": [GREEN, GREENTX], waiting: [PANEL, "FF3F4A5A"] };
const VERDICT = { none: "No reply", late: "Replied late", call: "Call, no email in 24h", "on-time": "On time", waiting: "Not due yet" };
const FLAG = { complaint: "Complaint", chaser: "Chasing", problem: "Problem raised", call: "Asked for a call" };

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
  ["Status", 20], ["Reply sent", 17], ["Replied by", 18], ["Working hrs to reply", 11], ["Over by (working hrs)", 11],
  ["Connected call", 17], ["Called by", 18], ["Why it needs a reply", 30], ["Flags", 20], ["What the client wrote", 70],
  ["Emails in this wait", 10], ["Notes", 30], ["Deal", 12], ["Contact", 12],
];

function notes(r) {
  const n = [];
  if (r.ccOnly) n.push("Case manager was in CC only");
  if (r.onLeave && r.onLeave.length) n.push(`On leave: ${r.onLeave.join(", ")}`);
  if (r.otherCms && r.otherCms.length) n.push(`Also emailed: ${r.otherCms.join(", ")}`);
  if (r.chased) n.push(`Client wrote again ${r.chased} time${r.chased > 1 ? "s" : ""} before an answer`);
  if (r.dayOff && !SETTINGS.FLAT_24_HOURS) n.push("A weekend or holiday fell in between and was not counted");
  if (r.verdict === "call" && r.replyAt) n.push(`Email reply came later: ${fmtWhen(r.replyAt)}`);
  if (r.verdict === "none" && r.callAfter) n.push(`Connected call after the 24 hours: ${fmtWhen(r.callAfter.at)}`);
  return n.join(". ");
}

function waitSheet(wb, name, heading, sub, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 3, xSplit: 2, showGridLines: false }] });
  ws.columns = COLS.map(([, w]) => ({ width: w }));
  title(ws, heading, sub, 12);
  header(ws, 3, COLS.map(([h]) => h));
  rows.forEach((r, i) => {
    const call = r.callIn || (r.verdict === "none" ? r.callAfter : null);
    const x = ws.getRow(4 + i);
    x.values = [
      r.cm, r.client, r.clientEmail, r.subject, fmtWhen(r.start), fmtWhen(r.due), VERDICT[r.verdict] || r.verdict,
      r.replyAt ? fmtWhen(r.replyAt) : "", r.replyBy || "",
      r.replyAt ? hrs(r.workMs) : "", r.overMs ? hrs(r.overMs) : "",
      call ? fmtWhen(call.at) : "", call ? call.by || "" : "",
      r.reason || "", (r.flags || []).map((f) => FLAG[f]).filter(Boolean).join(", "), r.words || "",
      r.count, notes(r), link(r.dealLink, "Deal"), link(r.contactLink, "Contact"),
    ];
    x.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BOX;
      cell.alignment = { vertical: "top", wrapText: true };
      cell.font = col >= 19 ? { name: "Arial", size: 10, color: { argb: ROYAL }, underline: true } : { name: "Arial", size: 10 };
    });
    const [bg, tx] = TONE[r.verdict] || [PANEL, "FF1F2937"];
    x.getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    x.getCell(7).font = { name: "Arial", size: 10, bold: true, color: { argb: tx } };
    if ((r.flags || []).includes("complaint")) x.getCell(15).font = { name: "Arial", size: 10, bold: true, color: { argb: REDTX } };
  });
  if (rows.length) ws.autoFilter = { from: "A3", to: `T${3 + rows.length}` };
  else ws.getCell("A4").value = "None.";
  return ws;
}

async function buildWorkbook(r) {
  const s = r.sections;
  const wb = new ExcelJS.Workbook();
  wb.creator = "HOF Compliance";
  const windowText = `Client emails whose 24 hours ended between ${fmtWhen(r.window.start)} and ${fmtWhen(r.window.end)} (Pakistan time).`;

  // ---------- Summary ----------
  const sm = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  sm.columns = [{ width: 26 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 10 }, { width: 11 }];
  title(sm, `Case manager email replies — ${fmtDay(r.window.end)}`, windowText, 9);
  const kpi = [
    ["Fell due in this report", s.due.length, null],
    ["Answered by email within 24 hours", s.onTime.length, GREEN],
    ["Flagged — no reply", s.none.length, s.none.length ? RED : null],
    ["Flagged — replied late", s.late.length, s.late.length ? AMBER : null],
    ["No email in 24 hours, but a connected call", s.call.length, s.call.length ? BLUE : null],
    ["Still unanswered from earlier days", s.still.length, s.still.length ? RED : null],
    ["Due before the next report", s.next.length, null],
    ["Emails received in the last 24 hours that needed no reply", r.notCountedToday, null],
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
  header(sm, row, ["Case manager", "Due", "On time", "By call", "Late", "No reply", "Older, open", "Due next", "On time %"]);
  row++;
  for (const l of [...r.byCm.lines, r.byCm.total]) {
    const x = sm.getRow(row);
    x.values = [l.cm, l.due, l.onTime, l.call, l.late, l.none, l.still, l.next, l.pct == null ? "—" : l.pct / 100];
    x.eachCell({ includeEmpty: true }, (cell) => { cell.border = BOX; cell.font = { name: "Arial", size: 10, bold: l === r.byCm.total }; });
    if (l.pct != null) {
      x.getCell(9).numFmt = "0%";
      x.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: l.pct >= 90 ? GREEN : l.pct >= 70 ? AMBER : RED } };
    }
    if (l.none) x.getCell(6).font = { name: "Arial", size: 10, bold: true, color: { argb: REDTX } };
    if (l.still) x.getCell(7).font = { name: "Arial", size: 10, bold: true, color: { argb: REDTX } };
    row++;
  }
  sm.getCell(`A${row + 1}`).value = "On time % is of the emails that were not handled by phone: on time ÷ (on time + late + no reply).";
  sm.getCell(`A${row + 1}`).font = { name: "Arial", size: 9.5, italic: true, color: { argb: "FF868E9B" } };

  // ---------- the rows ----------
  waitSheet(wb, "Flagged", "Flagged — not answered within 24 hours", `${windowText} No reply at all first, then late replies; the longest waits at the top.`, [...s.none, ...s.late]);
  waitSheet(wb, "Call, no email", "No email reply in 24 hours, but a connected call", "The client was reached by phone within the 24 hours — a connected call on their contact or deal.", s.call);
  waitSheet(wb, "Still unanswered", "Still unanswered from earlier days", `Due before this report, and still without any email reply or connected call. Kept for ${SETTINGS.STILL_OPEN_DAYS} days.`, s.still);
  waitSheet(wb, "Due next", "Due before the next report", "Not late yet, and nobody has replied.", s.next);
  waitSheet(wb, "On time", "Answered by email within 24 hours", windowText, s.onTime);

  // ---------- every email received, with the decision ----------
  const ig = wb.addWorksheet("All emails received", { views: [{ state: "frozen", ySplit: 3, showGridLines: false }] });
  ig.columns = [{ width: 17 }, { width: 20 }, { width: 30 }, { width: 36 }, { width: 13 }, { width: 40 }, { width: 80 }];
  title(ig, "Every client email received in the last 24 hours, and the decision", "Use this to check the rules: anything marked No that clearly needed an answer should be reported, and the rule changed in config.js or 2-classify.js.", 7);
  header(ig, 3, ["Received", "Case manager", "From", "Subject", "Needs a reply?", "Why", "What they wrote"]);
  r.intake.forEach((e, i) => {
    const x = ig.getRow(4 + i);
    x.values = [fmtWhen(e.at), e.cm, e.from, e.subject, e.counted ? "Yes" : "No", e.reason || "", e.words || ""];
    x.eachCell({ includeEmpty: true }, (cell) => { cell.border = BOX; cell.alignment = { vertical: "top", wrapText: true }; cell.font = { name: "Arial", size: 10 }; });
    x.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: e.counted ? AMBER : PANEL } };
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
    ...(r.missingYears && r.missingYears.length ? [`WARNING: no UAE holidays are listed for ${r.missingYears.join(", ")}, so holidays in that year were counted as working days.`] : []),
    "",
    "WHICH EMAILS NEED A REPLY",
    "Only the client's new words are read — the quoted thread underneath, signatures and phone footers are removed first.",
    "Counted: complaints, chasers (\"any update?\", \"it's been 9 days\"), a problem or mistake pointed out, a request for a call or meeting, a question, a request (please advise / confirm / send / check), and long messages with no clear question (counted to be safe).",
    `Not counted: emails from HOF staff, automatic messages (auto-replies, reactions, delivery notices, no-reply senders), thank-yous and acknowledgements, and emails that only send documents or news with nothing asked — those need an acknowledgement, not a reply${SETTINGS.COUNT_DOCUMENTS_ONLY ? " (documents are currently COUNTED because COUNT_DOCUMENTS_ONLY is on)" : ""}.`,
    "Every email received in the last 24 hours is in the \"All emails received\" tab with the decision and the reason.",
    "",
    "WHAT COUNTS AS AN ANSWER",
    "A reply is any email from anyone at HOF sent to the client's address after they wrote. Several client emails in a row are one wait, timed from the first.",
    "If no email went back within 24 hours, the client's contact and deals are checked for a connected call in those 24 hours. Case managers log most calls on the deal, so both are checked.",
    `Connected means the "Connected" call outcome, or a call of ${SETTINGS.CONNECTED_MIN_SECONDS} seconds or more whose outcome is not no-answer, busy, wrong number or voicemail.`,
    "Those emails are listed in their own section instead of being flagged.",
    "",
    "LIMITS WORTH KNOWING",
    "A reply sent from outside HubSpot (personal email, WhatsApp) is not seen, and a call not logged in HubSpot is not seen.",
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

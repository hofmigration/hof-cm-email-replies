// 5-email.js — the report in the email body; every row is in the attached sheet.
//
// Gmail cuts off ("clips") an email over about 102 KB, so the body is built to stay under
// 95 KB: if a busy day would go over, fewer rows are shown per section and the email says
// how many more are in the sheet. Nothing is ever only in the email.
const { SETTINGS } = require("./config");
const { fmtWhen, fmtDay, span } = require("./1-clock");

const C = { navy: "#16205e", royal: "#1f2f8f", ink: "#1f2937", body: "#3f4a5a", soft: "#868e9b", line: "#e6e9f1",
  panel: "#f7f9fc", bad: "#b42318", badbg: "#fdecea", warn: "#9a5b0c", warnbg: "#fff5e8", good: "#1e7a4d", goodbg: "#e9f6ee",
  blue: "#1d4f91", bluebg: "#eaf1fb" };
const F = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cut = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
const MAX_BYTES = 95000;

const TH = `padding:7px 9px;font:700 10.5px/1.3 ${F};letter-spacing:.04em;text-transform:uppercase;color:${C.navy};background:${C.panel};border-bottom:1px solid ${C.line}`;
const TD = `padding:9px 9px;border-top:1px solid ${C.line};font:400 12.5px/1.45 ${F};color:${C.ink};vertical-align:top`;
const chip = (t, fg, bg) => `<span style="display:inline-block;margin:3px 3px 0 0;padding:1px 6px;border-radius:3px;background:${bg};color:${fg};font:600 10.5px/1.5 ${F}">${esc(t)}</span>`;

function chips(r) {
  const out = [];
  const flags = r.flags || [];
  if (r.priority === "high") out.push(chip("High priority", "#ffffff", C.bad));
  else if (r.priority === "medium") out.push(chip("Medium", C.warn, C.warnbg));
  if (r.again) out.push(chip("Wrote again", C.bad, C.badbg));
  if (flags.includes("complaint")) out.push(chip("Complaint", C.bad, C.badbg));
  if (flags.includes("urgent")) out.push(chip("Urgent / dated", C.bad, C.badbg));
  if (!r.again && (flags.includes("chaser") || r.chased)) out.push(chip(r.chased ? `Chased ×${r.chased}` : "Chasing", C.warn, C.warnbg));
  if (flags.includes("problem")) out.push(chip("Problem raised", C.warn, C.warnbg));
  if (flags.includes("call")) out.push(chip("Asked for a call", C.blue, C.bluebg));
  if (r.ccOnly) out.push(chip("Was in CC only", C.soft, C.panel));
  if (r.onLeave && r.onLeave.length) out.push(chip("On leave", C.soft, C.panel));
  if (r.otherCms && r.otherCms.length) out.push(chip(`Also to ${r.otherCms.join(", ")}`, C.soft, C.panel));
  return out.length ? `<div>${out.join("")}</div>` : "";
}

const TONE = { none: C.bad, late: C.warn, call: C.blue, whatsapp: C.blue, waiting: C.body, "on-time": C.good };

// The client asked for something to be done, and there was no reply and no connected call.
// Doing it is not enough: the client has to be told.
function actionNote(r, words) {
  if (r.verdict !== "none" || !r.ask) return "";
  const same = (a, b) => String(a || "").replace(/\W+/g, " ").trim().toLowerCase() === String(b || "").replace(/\W+/g, " ").trim().toLowerCase();
  // the sentence is quoted unless it is the whole email, which the row already shows
  const quote = words && !same(r.ask, r.words) ? `<br><i>“${esc(cut(r.ask, Math.min(words, 160)))}”</i>` : "";
  return `<div style="margin-top:6px;padding:7px 10px;background:${C.badbg};border-left:3px solid ${C.bad};font:400 12px/1.5 ${F};color:${C.ink}">` +
    `<b style="color:${C.bad}">Action needed: the client asked for this to be done.</b>${quote}<br>Even if it has already been done, kindly confirm it to the client.</div>`;
}

// what was sent on WhatsApp, so the reader can see whether it was about the email
const aKind = (k) => `${/^[aeiou]/i.test(k) ? "An" : "A"} ${k}`;       // "A voice note", "An image"
// the WhatsApp number(s) read today, e.g. "the HOF Migration WhatsApp number"
const linesText = (m) => { const n = ((m && m.lines) || []).map((l) => l.name).filter(Boolean); return n.length ? `the ${n.join(" and ")} WhatsApp number${n.length > 1 ? "s" : ""}` : "WhatsApp, read through Mesh"; };

function waQuote(r, words) {
  if (r.verdict !== "whatsapp" || !r.waIn) return "";
  const k = r.waIn.kind;
  const said = k === "message" ? (words ? (r.waIn.preview ? `“${esc(cut(r.waIn.preview, Math.min(words, 140)))}”` : "A WhatsApp message") : "") : `${esc(aKind(k))}${k === "voice note" ? " (not listened to)" : ""}`;
  const a = String(r.waIn.line || "").toLowerCase().trim(), b = String(r.waIn.by || "").toLowerCase().trim();
  const line = a && !b.includes(a) && !a.includes(b) ? ` <span style="color:${C.soft}">on ${esc(r.waIn.line)}</span>` : "";
  const byName = r.waFound === "name" ? `<br><span style="color:${C.warn}">Found on WhatsApp by name, not number: check it is the same person.</span>` : "";
  return said ? `<div style="margin-top:5px;padding:6px 9px;background:${C.bluebg};font:400 11.5px/1.45 ${F};color:${C.ink}">${said}${line}${byName}</div>` : "";
}

function row(r, words) {
  const link = r.dealLink || r.contactLink;
  const client = link ? `<a href="${esc(link)}" style="color:${C.royal};text-decoration:none;font-weight:700">${esc(r.client)}</a>` : `<b>${esc(r.client)}</b>`;
  const addr = r.clientEmail && r.clientEmail !== r.client ? ` <span style="color:${C.soft};font-size:11.5px">${esc(r.clientEmail)}</span>` : "";
  const said = words && r.words ? `<div style="font:italic 400 12px/1.45 ${F};color:${C.body};margin-top:4px">“${esc(cut(r.words, words))}”${r.count > 1 ? ` <span style="font-style:normal;color:${C.soft}">+${r.count - 1} more email${r.count > 2 ? "s" : ""}</span>` : ""}</div>` : "";
  return `<tr>
<td width="21%" style="${TD}"><b>${esc(r.cm)}</b>${chips(r)}</td>
<td style="${TD}">${client}${addr}<div style="color:${C.body}">${esc(cut(r.subject, 90))}</div>${said}${actionNote(r, words)}</td>
<td width="29%" style="${TD}">${r.again ? `<span style="color:${C.soft}">First wrote</span> ${esc(fmtWhen(r.again.firstAt))}<br><span style="color:${C.soft}">Wrote again</span>` : `<span style="color:${C.soft}">Wrote</span>`} ${esc(fmtWhen(r.start))}<br><span style="color:${C.soft}">Due</span> ${esc(fmtWhen(r.due))}<div style="font-weight:600;color:${TONE[r.verdict] || C.ink};margin-top:3px">${esc(r.status)}</div>${waQuote(r, words)}</td>
</tr>`;
}

function section(title, sub, rows, cap, words, emptyText) {
  const head = `<div style="font:700 15px/1.3 ${F};color:${C.navy};margin:26px 0 3px">${esc(title)} <span style="color:${C.soft};font-weight:400">· ${rows.length}</span></div>` +
    (sub ? `<div style="font:400 12px/1.5 ${F};color:${C.soft};margin:0 0 9px">${sub}</div>` : "");
  if (!rows.length) return emptyText ? head + `<div style="font:400 13px/1.5 ${F};color:${C.good};margin:4px 0 0">${esc(emptyText)}</div>` : "";
  const shown = rows.slice(0, cap);
  const more = rows.length - shown.length;
  if (!shown.length) return head + `<div style="font:400 12.5px/1.5 ${F};color:${C.body};margin:4px 0 0">${rows.length} email${rows.length > 1 ? "s" : ""} — listed in the attached sheet.</div>`;
  return head + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-collapse:collapse">
<tr><td style="${TH}">Case manager</td><td style="${TH}">Client and what they wrote</td><td style="${TH}">Timing</td></tr>${shown.map((r) => row(r, words)).join("")}</table>` +
    (more ? `<div style="font:400 12px/1.5 ${F};color:${C.soft};margin-top:6px">…and ${more} more in the attached sheet.</div>` : "");
}

function cmTable(byCm) {
  const n = (v, c) => (v ? `<span style="font-weight:700;color:${c || C.ink}">${v}</span>` : `<span style="color:${C.soft}">0</span>`);
  const line = (l, bold) => `<tr${bold ? ` style="background:${C.panel}"` : ""}>
<td style="${TD}${bold ? ";font-weight:700" : ""}">${esc(l.cm)}</td>
<td align="right" style="${TD}">${n(l.due)}</td><td align="right" style="${TD}">${n(l.onTime, C.good)}</td><td align="right" style="${TD}">${n(l.call, C.blue)}</td><td align="right" style="${TD}">${n(l.whatsapp, C.blue)}</td>
<td align="right" style="${TD}">${n(l.late, C.warn)}</td><td align="right" style="${TD}">${n(l.none, C.bad)}</td><td align="right" style="${TD}">${n(l.high, C.bad)}</td>
<td align="right" style="${TD}">${n(l.next)}</td>
<td align="right" style="${TD};font-weight:700;color:${l.pct == null ? C.soft : l.pct >= 90 ? C.good : l.pct >= 70 ? C.warn : C.bad}">${l.pct == null ? "—" : l.pct + "%"}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-collapse:collapse">
<tr><td style="${TH}">Case manager</td><td align="right" style="${TH}">Due</td><td align="right" style="${TH}">On time</td><td align="right" style="${TH}">By call</td><td align="right" style="${TH}">By WhatsApp</td><td align="right" style="${TH}">Late</td><td align="right" style="${TH}">No reply</td><td align="right" style="${TH}">High flagged</td><td align="right" style="${TH}">Due next</td><td align="right" style="${TH}">On time %</td></tr>
${byCm.lines.map((l) => line(l)).join("")}${line(byCm.total, true)}</table>`;
}

function buildEmail(r, caps = {}, words = 170) {
  const cap = (k) => Math.min(caps[k] == null ? SETTINGS.ROWS_PER_SECTION : caps[k], SETTINGS.ROWS_PER_SECTION);
  const s = { whatsapp: [], ...r.sections };
  const flagged = s.late.length + s.none.length;
  const isHigh = (x) => x.priority === "high";
  const highFlagged = [...s.none, ...s.late].filter(isHigh).length;
  const noneHigh = s.none.filter(isHigh), noneMedium = s.none.filter((x) => !isHigh(x));
  const other = [s.call.length && `${s.call.length} by a connected call`, s.whatsapp.length && `${s.whatsapp.length} on WhatsApp`].filter(Boolean).join(" and ");
  const tile = (v, l, fg, bg) => `<td width="20%" align="center" style="background:${bg};border-radius:6px;padding:13px 6px"><div style="font:700 24px/1 ${F};color:${fg}">${esc(v)}</div><div style="font:600 9.5px/1.3 ${F};letter-spacing:.06em;text-transform:uppercase;color:${fg};margin-top:6px">${esc(l)}</div></td>`;

  let headline;
  const parts = [s.none.length && `${s.none.length} with no reply yet`, s.late.length && `${s.late.length} answered late`].filter(Boolean).join(", ");
  const split = `<b style="color:${C.bad}">${highFlagged} high priority</b> and <b>${flagged - highFlagged}</b> medium`;
  const asked = s.none.filter((x) => x.ask).length;
  const askedLine = asked ? ` <b>${asked}</b> of those with no reply asked for something to be done.` : "";
  if (flagged) headline = { fg: C.bad, bg: C.badbg, t: `<b>${flagged} of ${s.due.length}</b> client emails that fell due were not answered within 24 hours: ${split} (${parts}).${askedLine}${other ? ` ${s.call.length + s.whatsapp.length} more had no email reply, but the client was reached — ${other}.` : ""}` };
  else if (s.due.length) headline = { fg: C.good, bg: C.goodbg, t: `<b>Every client email that fell due was answered within 24 hours</b>${other ? ` — ${other} rather than by email` : ""}.` };
  else headline = { fg: C.body, bg: C.panel, t: "No client emails fell due in this period." };
  const unread = r.unreadPct > 25
    ? `<table role="presentation" width="100%" style="margin:0 0 14px"><tr><td style="background:${C.badbg};border-left:4px solid ${C.bad};padding:10px 14px;font:400 12.5px/1.55 ${F};color:${C.bad}"><b>${r.unreadPct}% of emails came back from HubSpot with no text</b>, so they could not be judged and are not counted. Check the HubSpot token has the <i>sales-email-read</i> scope before relying on this report.</td></tr></table>` : "";
  const m = r.mesh;
  const problems = (m && m.problems) || [];
  const meshWarn = m && m.used && (!m.on || problems.length || m.errors)
    ? `<table role="presentation" width="100%" style="margin:0 0 14px"><tr><td style="background:${C.warnbg};border-left:4px solid ${C.warn};padding:10px 14px;font:400 12.5px/1.55 ${F};color:${C.warn}">${!m.on
      ? `<b>WhatsApp was not checked today:</b> ${esc(m.why)}. Emails answered only on WhatsApp may be flagged below.`
      : `<b>Part of WhatsApp could not be read:</b> ${esc(problems.join(". ") || `${m.errors} clients could not be checked`)}. Emails answered there may be flagged below.`}</td></tr></table>` : "";
  const warn = r.missingYears && r.missingYears.length
    ? `<table role="presentation" width="100%" style="margin:0 0 14px"><tr><td style="background:${C.warnbg};border-left:4px solid ${C.warn};padding:10px 14px;font:400 12.5px/1.55 ${F};color:${C.warn}"><b>No UAE public holidays are listed for ${esc(r.missingYears.join(", "))}.</b> Holidays that year are being counted as working days — add the announced dates to config.js.</td></tr></table>` : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f6;padding:24px 10px"><tr><td align="center">
<table role="presentation" width="720" cellpadding="0" cellspacing="0" border="0" style="width:720px;max-width:720px;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background-color:${C.navy};background-image:linear-gradient(120deg,${C.navy},${C.royal});padding:22px 26px">
  <div style="font:700 20px/1.3 ${F};color:#fff">Case manager email replies — ${esc(fmtDay(r.window.end))}</div>
  <div style="font:400 12.5px/1.5 ${F};color:#aab0d4;margin-top:5px">Client emails whose 24 hours ended between ${esc(fmtWhen(r.window.start))} and ${esc(fmtWhen(r.window.end))}, Pakistan time</div>
</td></tr>
<tr><td style="padding:22px 26px">
  ${unread}${warn}${meshWarn}
  <table role="presentation" width="100%" style="margin:0 0 16px"><tr><td style="background:${headline.bg};border-left:4px solid ${headline.fg};padding:13px 16px;font:400 14px/1.6 ${F};color:${C.ink}">${headline.t}</td></tr></table>
  <table role="presentation" width="100%" cellspacing="8" style="margin:0 -8px 4px"><tr>
    ${tile(s.due.length, "fell due", C.navy, C.panel)}${tile(s.onTime.length, "answered on time", C.good, C.goodbg)}${tile(highFlagged, "high, flagged", "#ffffff", C.bad)}${tile(flagged - highFlagged, "medium, flagged", C.bad, C.badbg)}${tile(s.call.length + s.whatsapp.length, "call or WhatsApp", C.blue, C.bluebg)}
  </tr></table>

  <div style="font:700 15px/1.3 ${F};color:${C.navy};margin:24px 0 3px">By case manager</div>
  <div style="font:400 12px/1.5 ${F};color:${C.soft};margin:0 0 9px"><i>On time %</i> is of the emails that were not handled by phone or WhatsApp. <i>High flagged</i> are high-priority emails not answered within 24 hours, with no reply or a late one.</div>
  ${cmTable(r.byCm)}

  ${section("High priority — no reply", "Complaints and refunds, chasers, mistakes or problems pointed out, and urgent or dated requests (a deadline, an appointment, biometrics, an interview, a visa expiring). Past 24 hours with no email, no connected call and no WhatsApp from HOF. Where the client asked for something to be done, the red note says so: even if it has been done, the client must be told.", noneHigh, cap("flagged"), words, "None today.")}
  ${section("Medium priority — no reply", "Questions and requests. Past 24 hours with no email, no connected call and no WhatsApp from HOF.", noneMedium, cap("medium"), words, "None today.")}
  ${section("Replied late", "Answered by email, but after the 24 hours. High priority first.", s.late, cap("flagged"), words, "None today.")}
  ${section("No email reply in 24 hours, but a connected call", "No email went back within 24 hours, but the client was reached by phone in that time (a connected call on their contact or deal).", s.call, cap("call"), words, "None today.")}
  ${m && m.used && m.on ? section("No email reply in 24 hours, but answered on WhatsApp", `No email went back within 24 hours, but HOF sent the client a WhatsApp in that time (a text, a voice note or a file, on ${esc(linesText(m))}). The message is shown so you can see whether it was about the email.`, s.whatsapp, cap("call"), words, "None today.") : ""}
  ${section("Due before tomorrow's report", "Not late yet, and nobody has replied. High priority first, then the soonest.", s.next, cap("next"), 0, "")}

  <div style="font:400 11.5px/1.7 ${F};color:${C.soft};margin-top:24px;padding-top:14px;border-top:1px solid ${C.line}">
    <b style="color:${C.body}">How this is checked.</b> A client email that needs a reply gets one within ${SETTINGS.REPLY_HOURS} hours${SETTINGS.FLAT_24_HOURS ? "" : " — Saturday, Sunday and UAE public holidays are not counted, so Friday afternoon is due Monday afternoon"}.
    Each one gets a priority. <b style="color:${C.body}">High</b>: a complaint or refund, a chaser, a mistake or problem pointed out, or something urgent or tied to a date (a deadline, an appointment, biometrics, an interview, a visa expiring). <b style="color:${C.body}">Medium</b>: any other question or request. Both have the same ${SETTINGS.REPLY_HOURS} hours; High is listed first.
    <b style="color:${C.body}">Low</b> — nothing to answer: thank-yous, emails that only send documents or information with nothing asked, automatic messages and emails from HOF staff — is not counted and not shown: ${r.notCountedToday} today, each listed in the sheet with the reason.
    A reply is any email from anyone at HOF to the client's address. Several client emails in a row are one wait, timed from the first. Each email is flagged once, on the day its 24 hours end; if the client writes again and that email also goes unanswered, it is flagged again, as High.
    With no email reply in the 24 hours, a connected call or a WhatsApp from HOF to the client in that time (a text, a voice note or a file, read through Mesh) puts the email in its own section instead of flagging it.${m && m.used && m.on ? ` WhatsApp is read on ${esc(linesText(m))} only; a WhatsApp from any other number, such as a case manager's own, is not seen.` : ""}
    When the client asked for something to be done (send, check, correct, book a call…) and got neither a reply nor a connected call, the row says the action was needed — even if it was done, the client has to be told.
    Every row is in the attached sheet, with links to HubSpot.
  </div>
</td></tr>
<tr><td style="background:${C.panel};border-top:1px solid ${C.line};padding:15px 26px;font:400 11.5px/1.6 ${F};color:${C.soft}"><strong style="color:${C.body}">Ali Raza</strong> · Compliance · HOF Migration<br>Read-only. Nothing in HubSpot or Mesh was changed.</td></tr>
</table></td></tr></table>`;
}

// the fullest version that Gmail will show without clipping
// High priority and late rows are the last to give way; "due next" shrinks first, then the
// call and WhatsApp lists, then Medium.
function fitEmail(r) {
  const steps = [
    [{}, 170],
    [{ next: 15 }, 150],
    [{ next: 8, call: 25, medium: 30 }, 130],
    [{ next: 5, call: 15, medium: 20, flagged: 30 }, 110],
    [{ next: 3, call: 10, medium: 12, flagged: 20 }, 80],
    [{ next: 0, call: 6, medium: 8, flagged: 15 }, 0],
    [{ next: 0, call: 3, medium: 4, flagged: 8 }, 0],
    [{ next: 0, call: 0, medium: 3, flagged: 8 }, 0],
    [{ next: 0, call: 0, medium: 2, flagged: 6 }, 0],
  ];
  let html = "";
  for (const [caps, words] of steps) {
    html = buildEmail(r, caps, words);
    if (Buffer.byteLength(html, "utf8") <= MAX_BYTES) return html;
  }
  return html;
}

async function sendEmail(subject, html, attachment) {
  if (!process.env.RESEND_KEY) { console.log("No RESEND_KEY secret — not emailed."); return false; }
  const body = { from: SETTINGS.FROM_EMAIL, to: [SETTINGS.REPORT_TO], subject, html };
  if (SETTINGS.CC.length) body.cc = SETTINGS.CC;
  if (attachment) body.attachments = [attachment];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.log(`Email failed: ${res.status} ${(await res.text()).slice(0, 250)}`);
    if (res.status === 403) console.log("  The built-in sender (onboarding@resend.dev) only reaches the address the Resend account was registered with — CC needs a verified domain.");
    return false;
  }
  return true;
}

module.exports = { buildEmail, fitEmail, sendEmail, MAX_BYTES };

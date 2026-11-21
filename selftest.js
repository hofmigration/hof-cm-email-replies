// selftest.js — every rule, against invented emails where the right answer is known.
// It runs before each report; if a rule stops behaving, the report does not go out.
// The example wording is adapted from real client emails, with names changed.
const fs = require("fs");
const path = require("path");
const { SETTINGS } = require("./config");
const T = require("./1-clock");
const { classify, htmlToText } = require("./2-classify");
const M = require("./3-match");
const { buildEmail, fitEmail, MAX_BYTES } = require("./5-email");

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `\n        ${detail}`}`);
  ok ? pass++ : fail++;
};
const PKT = (s) => Date.parse(s + "+05:00");
const clock = T.makeClock({ flat: false });
const due = (s) => T.fmtWhen(clock.deadline(PKT(s)));

console.log("CASE MANAGER EMAIL REPLIES — SELF-TEST\n");

// ---------------------------------------------------------------- the clock
check("Monday 3pm is due Tuesday 3pm", due("2026-10-19T15:00") === "Tue 20 Oct, 15:00", due("2026-10-19T15:00"));
check("Thursday 3pm is due Friday 3pm", due("2026-10-22T15:00") === "Fri 23 Oct, 15:00");
check("Friday 3pm is due Monday 3pm — the weekend is not counted", due("2026-10-23T15:00") === "Mon 26 Oct, 15:00");
check("a Saturday email is due at the end of Monday", due("2026-10-24T10:00") === "Tue 27 Oct, 00:00");
check("UAE National Day pauses the clock (Tue 3pm -> Fri 3pm)", due("2026-12-01T15:00") === "Fri 4 Dec, 15:00", due("2026-12-01T15:00"));
check("Pakistan-only holidays do not pause it — the office follows Dubai", !SETTINGS.HOLIDAYS.includes("2026-08-14") && !SETTINGS.HOLIDAYS.includes("2026-03-23"));
check("working hours skip the weekend", T.hrs(clock.workingBetween(PKT("2026-10-23T15:00"), PKT("2026-10-26T15:00"))) === 24);
check("a flat 24 hours is available as a switch", T.fmtWhen(T.makeClock({ flat: true }).deadline(PKT("2026-10-23T15:00"))) === "Sat 24 Oct, 15:00");

// ---------------------------------------------------------------- the report window
{
  const w = T.reportWindow("", PKT("2026-10-20T11:20"));
  check("a run at 11:20 covers yesterday 11:00 to today 11:00", T.fmtWhen(w.start) === "Mon 19 Oct, 11:00" && T.fmtWhen(w.end) === "Tue 20 Oct, 11:00");
  const early = T.reportWindow("", PKT("2026-10-20T09:00"));
  check("a run before 11:00 covers the previous full day", T.fmtWhen(early.end) === "Mon 19 Oct, 11:00");
  const asOf = T.reportWindow("2026-10-15", PKT("2026-10-20T15:00"));
  check("a date re-runs that morning's report", T.fmtWhen(asOf.end) === "Thu 15 Oct, 11:00");
}

// ---------------------------------------------------------------- which emails need a reply
const cls = (text, extra = {}) => classify({ from: "client@gmail.com", subject: "Re: Petition preparation", text, ...extra });
const needs = (label, text, key, extra) => { const c = cls(text, extra); check(`needs a reply: ${label}`, c.needs && (!key || c.key === key), `${c.key} — ${c.words}`); };
const skip = (label, text, key, extra) => { const c = cls(text, extra); check(`no reply needed: ${label}`, !c.needs && (!key || c.key === key), `${c.key} — ${c.words}`); };

needs("a chaser", "Dear Brenda,\n\nAny update please?\n\nRegards,\nUsman", "chaser");
needs("\"it's been 20 days\"", "Dear Thushara\n\nIt’s been 20 days , I have not received the final versions , may I know by what date is it expected.", "chaser");
needs("a question", "Hi Yamina,\n\nCould you please help me with a sample of those letters that I should request?\n\nThank you so much,", "question");
needs("a question with no question mark", "Do you have any program for immigration to Luxembourg.", "question");
needs("a request", "Ms. Rahima, I updated all the education and passport details. Please advise.", "request");
needs("documents sent for review", "Please find the remaining 4 draft letters of recommendation for review.", "request", { attachments: true });
needs("a call request", "Can we have a call.\n\nRegards\nAbdul", "call");
needs("a call at a time", "Kindly call me tomorrow after Friday prayer at 3 pm.", "call");
needs("times offered for a meeting", "Thank you for confirmation. I am available tomorrow either 12:30 to 13:30 Or 17:30 to 20:00 UAE time.", "call");
needs("a complaint", "I have a lot of mistakes in the LOR and I am not happy why I am paying to HOF.", "complaint");
needs("a mistake pointed out", "The petition attached to your last email appears to be a previous version. I cannot review the entire petition again.", "problem");
needs("a portal problem", "Couldn't see any link to access the portal.", "problem");
skip("a long message with no question is information only (Low)", "I have reviewed the petition. " + "The section on my research impact understates the patents, the conference talks and the industry adoption of my work. ".repeat(5), "long");
needs("an Arabic question mark", "متى سيتم تقديم الطلب؟", "question");

skip("a thank-you", "Thank you for the update.", "ack");
skip("\"Alright, Thank you\" with a signature", "Alright, Thank you.\n\nRegards,\n\nHina Nasir\n+971564771738", "ack");
skip("thanks with a polite offer", "Thanks Maryam. Looking forward to chatting more. Let me know what you need from me.", "ack");
skip("documents with nothing asked", "Dear Muhammad,\n\nI hope you are doing well. Please find the attached letters.\n\nThank you!", "", { attachments: true });
skip("documents with a conditional offer", "I am sharing the updated documents. If any additional sections are required, please let me know.", "documents");
skip("news with nothing asked", "I am currently arranging the attestation of my degree certificate in Egypt. As advised by the university, it is expected to be ready by 14 November.", "update");
skip("an approval", "Please proceed with the shipment for the petition. Everything is in order.", "update");
skip("a confirmation of a call time", "Yes, 4:00 PM UAE time works for me. Thank you, and I look forward to speaking with you.", "ack");
skip("a Gmail reaction", "Tahir reacted via Gmail <https://www.google.com/gmail/about/?utm_source=gmail>", "automated");
skip("an auto-reply subject", "I am away until Monday.", "automated", { subject: "Automatic reply: Phase II documents" });
skip("a no-reply sender", "Your evaluation is ready. Any questions?", "automated", { from: "no-reply@wes.org" });
skip("HOF staff", "Hi Adnan, Noted. Any update on the leave?", "internal", { from: "sidra@hof-global.com" });
skip("thanks for a confirmation", "Thank you and appreciated for your confirmation and informed approach. Feel free to reach me out for any further queries.", "ack");
skip("a sign-off in capitals and stars", "Noted with thanks\n*REGARDS*\n*WASEEM ALI*\n*00971-527664467*", "ack");
needs("documents attached for confirmation", "Please find the attached forms for your confirmation.", "request", { attachments: true });
skip("an empty email", "", "empty");
skip("only an attachment", "", "documents", { attachments: true });

// the quoted thread underneath must never be read as the client asking
skip("a question in the quoted Gmail thread", "Noted.\r\n\r\nOn Tue, Oct 20, 2026 at 12:11 PM Brenda Murowanidzwa <brenda@hofmigration.com>\r\nwrote:\r\n\r\n> Did you send the documents?\r\n", "ack");
skip("a question in a one-line Apple Mail thread", "Dear Brenda, Please see attached. LOR for Omar Thanks, Ramil On Oct 16, 2026, at 3:44 PM, Ramil Rinoza <ramil.rinoza@icloud.com> wrote: Dear Brenda, can you check the letters?", "", { attachments: true });
skip("a question in an Outlook thread", "Thanks\r\n\r\n________________________________\r\nFrom: Warda Badar <warda@hofmigration.com>\r\nSent: Monday, October 19, 2026 10:10 am\r\nTo: Client\r\nSubject: Documents\r\n\r\nWhen can you send them?", "ack");
skip("a question mark inside a link", "Uploaded here https://drive.google.com/open?id=abc123 for your records. Thanks", "ack");
needs("a question above the quoted thread", "When will my petition be filed?\n\nOn Mon, 19 Oct 2026 at 14:54, Maryam Chand <maryamchand@hofmigration.com> wrote:\n> Thank you", "question");
needs("an HTML-only email, quote removed", "", "question", { html: '<div dir="ltr">Is the CV format recommended by USCIS?</div><div class="gmail_quote">On Wed wrote: <blockquote>Please review</blockquote></div>' });
check("HTML is turned into plain words", htmlToText("<p>Dear Warda,</p><p>Please confirm&nbsp;the date.</p>").includes("Please confirm the date."));
needs("a new email with only a subject", "", "subject", { subject: "When will my file be submitted?" });

// thank-yous that read like requests (from the 4–18 Nov 2026 re-check, names changed)
skip("thanks for a clarification", "Thank you for the clarification.", "ack");
skip("thanks for an email and clarification, signed off", "Dear Tamjeed,\n\nThank you for your email and clarification.\n\nBest Regards\nKhalid", "ack");
skip("\"Kindly noted\"", "Dear Rahima,\n\nKindly noted.\n\nRegards,", "ack");
skip("an emoji that arrived as question marks", "Thank you Yamina ??", "ack");
skip("thanks for a reminder is not chasing", "Thank you for the reminder. I am also currently on annual leave and haven't had a chance to review the petition yet. I will review it and get back to you as soon as possible.", "ack");
skip("thanks, keep me posted", "Attached is my residence card for your reference. Thank you for the update and please keep me posted.", "", { attachments: true });
skip("thanks, let me know once there is news", "Thanks for your prompt response. No worries. Let me know once you have the update.", "ack");
skip("the client's own call with someone else", "Thank you for your reminder, and apologies for the delay. I will have a call with my referee this week and hope we will get it done.", "ack");
skip("\"please expect some delay\"", "Thanks for reaching out. I am busy with personal commitments and have not started yet. Please expect some delay on this, apologies.", "ack");
skip("\"Plz find attached\"", "Plz find the attached letter signed by HR.", "", { attachments: true });
skip("a one-line phone email with the thread on the same line", "Dear Rahima, Kindly noted. Regards, Sent from Outlook for iOS ________________________________ From: Rahima Nabili Sent: Thursday, 12 November 2026 14:47 To: Heba Subject: Re: WES Dear Heba, could you send the transcript?", "ack");
needs("thanks, then a request", "Thanks for the update, please send the final draft.", "request");
needs("thanks for a clarification, but a question", "Thank you for the clarification, but could you confirm whether the fee covers premium processing?", "question");
needs("thanks with a name, then a question", "Thank you Brenda for the update. When will the petition be filed?", "question");
needs("a question asked with \"??\"", "Bank statements here in France ??", "question");
needs("\"let me know once\" with no thank-you still counts", "Please let me know once I am able to access the LOR option.", "request");
needs("a call with HOF is still a call request", "I will be free tomorrow, can we have a call at 3 pm?", "call");
needs("\"sent from my phone\" in a sentence is not a phone footer", "I sent from my phone the scanned copy yesterday, please check it and confirm.", "request");

// the action the client asked for, shown when nobody answers
const askOf = (text) => cls(text).ask;
check("the action asked for is picked out", askOf("Hi Brenda,\n\nI uploaded the documents yesterday. Kindly review them and confirm.\n\nRegards") === "Kindly review them and confirm.", askOf("Hi Brenda,\n\nI uploaded the documents yesterday. Kindly review them and confirm.\n\nRegards"));
check("a call request is an action", askOf("Please call me tomorrow at 3 pm.") === "Please call me tomorrow at 3 pm.");
check("thanks, then an action: the action is what is shown", askOf("Thanks for the update. Please send the final draft.") === "Please send the final draft.");
check("a question on its own is not an action", askOf("When will my petition be filed?") === "");
check("a thank-you asks for nothing", cls("Thank you for the clarification.").ask === "");

// ---------------------------------------------------------------- priority: High, Medium, Low
const prio = (label, text, want, extra) => { const c = cls(text, extra); check(`priority ${want}: ${label}`, c.priority === want, `${c.priority} (${c.key}; ${c.flags.join(",")}) — ${c.words}`); };
prio("a complaint", "I have a lot of mistakes in the LOR and I am not happy why I am paying to HOF.", "high");
prio("a refund request", "Please process my refund, I do not want to continue.", "high");
prio("a chaser", "Dear Brenda,\n\nAny update please?\n\nRegards,\nUsman", "high");
prio("\"still waiting for the …\"", "Hello, I am still waiting for the checklist.", "high");
prio("waiting on someone else is news, not a chaser", "I am still waiting for my employer to sign the letter.", "low");
prio("a mistake pointed out", "The petition attached to your last email appears to be a previous version. I cannot review the entire petition again.", "high");
prio("\"urgently\"", "Please share the signed contract urgently.", "high");
prio("\"asap\"", "Can you send me the invoice asap?", "high");
prio("biometrics", "When is my biometrics appointment?", "high");
prio("an interview", "Could you help me prepare for the visa interview next week?", "high");
prio("a visa expiring", "My visa expires on 30 November, what should I do?", "high");
prio("a deadline", "What is the deadline for submitting the documents?", "high");
prio("\"by Monday\"", "Please send the final letters by Monday.", "high");
prio("the client's own subject line says urgent", "Please advise on the next steps.", "high", { subject: "URGENT: next steps" });
prio("a question", "When will my petition be filed?", "medium");
prio("a request", "Ms. Rahima, I updated all the education and passport details. Please advise.", "medium");
prio("a call request", "Can we have a call.\n\nRegards\nAbdul", "medium");
prio("\"not urgent\"", "It is not urgent, but could you check the CV format when you have time?", "medium");
prio("\"no rush\"", "No rush, could you send me the updated draft?", "medium");
prio("the client's own promise to send something asap", "I will send the remaining documents asap. Could you confirm the address?", "medium");
prio("a meeting with HOF is not an outside appointment", "Can we book an appointment with you to discuss the petition?", "medium");
prio("\"looking forward to hearing from you\"", "Could you confirm the fee? Looking forward to hearing from you.", "medium");
prio("a \"Re:\" subject is the thread's, not the client's", "Please advise on the next steps.", "medium", { subject: "Re: Urgent documents" });
prio("thanks for urgent help is not urgency", "Thank you for your urgent help. Could you share the receipt?", "medium");
prio("a thank-you", "Thank you for the update.", "low");
prio("documents with nothing asked", "Please find the attached letters.", "low", { attachments: true });
prio("dated words with nothing to answer stay Low", "Attached is my passport copy. My visa expires next month.", "low", { attachments: true });
prio("a long message with no question", "I have reviewed the petition. " + "The section on my research impact understates the patents, the conference talks and the industry adoption of my work. ".repeat(5), "low");

// ---------------------------------------------------------------- waits and answers
const em = (at, extra = {}) => ({ at: PKT(at), ownerId: "89930419", ...extra });
const rp = (at, extra = {}) => ({ at: PKT(at), ownerId: "89930419", ...extra });
{
  const w = M.buildWaits([em("2026-10-19T10:00"), em("2026-10-19T10:30"), em("2026-10-19T12:00")], [rp("2026-10-19T11:00")]);
  check("two emails before a reply are one wait; the next one opens another", w.length === 2 && w[0].emails.length === 2 && w[0].reply && !w[1].reply);
  const before = M.buildWaits([em("2026-10-19T10:00")], [rp("2026-10-19T09:00")]);
  check("an email sent before the client wrote is not a reply", before.length === 1 && !before[0].reply);
}
const NOW = PKT("2026-10-21T11:05");
const one = (emails, replies, calls = []) => M.judge(M.buildWaits(emails, replies)[0], { clock, now: NOW, calls });
const call = (at, disp = SETTINGS.CONNECTED_DISPOSITION, extra = {}) => ({ id: "c" + at, properties: { hs_timestamp: new Date(PKT(at)).toISOString(), hs_call_disposition: disp, hubspot_owner_id: "362254136", ...extra } });

check("a reply inside 24 hours is on time", one([em("2026-10-19T15:00")], [rp("2026-10-20T14:00")]).verdict === "on-time");
check("a reply after 24 hours is late", one([em("2026-10-19T15:00")], [rp("2026-10-20T16:00")]).verdict === "late");
check("no reply past 24 hours is flagged", one([em("2026-10-19T15:00")], []).verdict === "none");
check("not past 24 hours yet is waiting", one([em("2026-10-20T15:00")], []).verdict === "waiting");
check("Friday to Monday morning is on time", M.judge(M.buildWaits([em("2026-10-16T15:00")], [rp("2026-10-19T10:00")])[0], { clock, now: NOW }).verdict === "on-time");
check("no reply, but a connected call inside 24 hours -> its own section", one([em("2026-10-19T15:00")], [], [call("2026-10-19T17:00")]).verdict === "call");
check("a late reply, but a connected call inside 24 hours -> its own section", one([em("2026-10-19T15:00")], [rp("2026-10-21T09:00")], [call("2026-10-20T10:00")]).verdict === "call");
check("a call that did not connect does not count", one([em("2026-10-19T15:00")], [], [call("2026-10-19T17:00", "73a0d17f-1163-4015-bdd5-ec830791da20")]).verdict === "none");
check("a connected call after the 24 hours does not count", (() => { const j = one([em("2026-10-19T15:00")], [], [call("2026-10-20T18:00")]); return j.verdict === "none" && j.callAfter; })());
check("a call before the client wrote does not count", one([em("2026-10-19T15:00")], [], [call("2026-10-19T09:00")]).verdict === "none");
check("a 3-minute call with no outcome counts as connected", M.connected(call("2026-10-19T17:00", "", { hs_call_duration: "180000" })));
check("a long call marked No answer does not", !M.connected(call("2026-10-19T17:00", "73a0d17f-1163-4015-bdd5-ec830791da20", { hs_call_duration: "180000" })));
check("a busy call does not", !M.connected(call("2026-10-19T17:00", "", { hs_call_status: "BUSY", hs_call_duration: "90000" })));
{
  const wa = (at, extra = {}) => ({ at: PKT(at), by: "Warda Badar", kind: "message", preview: "Hi, I have shared the update on email.", line: "Warda", ...extra });
  const j = (emails, replies, calls, whatsapp) => M.judge(M.buildWaits(emails, replies)[0], { clock, now: NOW, calls, whatsapp });
  check("no email reply, but a WhatsApp from HOF inside 24 hours -> its own section", j([em("2026-10-19T15:00")], [], [], [wa("2026-10-19T18:00")]).verdict === "whatsapp");
  check("a voice note inside 24 hours counts the same", j([em("2026-10-19T15:00")], [], [], [wa("2026-10-20T09:00", { kind: "voice note", preview: "" })]).verdict === "whatsapp");
  check("a late email, but a WhatsApp inside 24 hours -> answered on WhatsApp", j([em("2026-10-19T15:00")], [rp("2026-10-21T09:00")], [], [wa("2026-10-20T10:00")]).verdict === "whatsapp");
  check("an email on time stays on time, WhatsApp or not", j([em("2026-10-19T15:00")], [rp("2026-10-20T10:00")], [], [wa("2026-10-19T16:00")]).verdict === "on-time");
  check("a connected call comes before WhatsApp", j([em("2026-10-19T15:00")], [], [call("2026-10-19T17:00")], [wa("2026-10-19T16:00")]).verdict === "call");
  const after = j([em("2026-10-19T15:00")], [], [], [wa("2026-10-20T18:00")]);
  check("a WhatsApp after the 24 hours does not count, but is noted", after.verdict === "none" && after.waAfter && /A WhatsApp message came later/.test(M.statusText({ ...after, waAfter: { ...after.waAfter } }, NOW)));
  check("a WhatsApp before the client wrote does not count", j([em("2026-10-19T15:00")], [], [], [wa("2026-10-19T14:00")]).verdict === "none");
  check("when WhatsApp could not be checked, the row says so", j([em("2026-10-19T15:00")], [], [], null).waChecked === false && j([em("2026-10-19T15:00")], [], [], []).waChecked === true);
  const st = M.statusText({ ...j([em("2026-10-19T15:00")], [], [], [wa("2026-10-19T18:00")]), waIn: wa("2026-10-19T18:00") }, NOW);
  check("the status names the WhatsApp, its time and who sent it", st === "WhatsApp message Mon 19 Oct, 18:00 by Warda Badar · no email reply yet", st);
}
check("writing again 2+ working hours later counts as chasing",
  one([em("2026-10-19T10:00"), em("2026-10-19T14:00"), em("2026-10-19T14:05")], [rp("2026-10-20T09:00")]).chased === 2);
check("a bounced email is not a reply", !M.sentOk("BOUNCED") && !M.sentOk("SCHEDULED") && M.sentOk("SENT") && M.sentOk(undefined));
check("addresses are read from a To line", M.addresses("Ali <ALI@x.com>; b@y.co.uk").join(",") === "ali@x.com,b@y.co.uk");

// ---------------------------------------------------------------- sections
{
  const window = T.reportWindow("", NOW);   // Tue 20 Oct 11:00 -> Wed 21 Oct 11:00
  const mk = (verdict, dueAt, extra = {}) => ({ verdict, due: PKT(dueAt), start: PKT(dueAt) - 24 * 3600e3, replyAt: null, callIn: null, callAfter: null, cm: "Warda Badar", flags: [], overMs: 0, ...extra });
  const rows = [
    mk("on-time", "2026-10-21T09:00", { replyAt: 1 }), mk("none", "2026-10-21T10:59"), mk("late", "2026-10-20T15:00", { replyAt: 1 }),
    mk("call", "2026-10-21T11:00", { callIn: { at: 1 } }), mk("none", "2026-10-20T11:00"),            // exactly yesterday's cut-off: yesterday's report
    mk("none", "2026-10-15T15:00"), mk("none", "2026-10-15T15:00", { callAfter: { at: 1 } }),         // older
    mk("waiting", "2026-10-21T16:00"),
    mk("whatsapp", "2026-10-21T08:00", { waIn: { at: 1 } }), mk("none", "2026-10-15T15:00", { waAfter: { at: 1 } }),
  ];
  const s = M.sortOut(rows, window);
  check("an email due exactly at the cut-off is in that morning's report", s.call.length === 1);
  check("one due at yesterday's cut-off is not repeated today", s.due.filter((r) => r.verdict !== "whatsapp").length === 4);
  check("the sections are counted right", s.onTime.length === 1 && s.none.length === 1 && s.late.length === 1);
  check("older emails are not repeated: each is flagged once, on its own day", !Object.entries(s).some(([k, l]) => k !== "due" && l.some((r) => r.due <= window.start)));
  check("emails answered on WhatsApp get their own section", s.whatsapp.length === 1 && s.due.length === 5);
  check("not-yet-due emails go under 'due next'", s.next.length === 1);
  const p = M.sortOut([mk("none", "2026-10-21T10:00", { priority: "medium", overMs: 9e6 }), mk("none", "2026-10-21T10:30", { priority: "high", overMs: 1 })], window);
  check("High priority comes first, even with a shorter wait", p.none[0].priority === "high");
  check("chasing, writing again, a complaint or an urgent request make a wait High; a call request alone is Medium",
    M.priorityOf(["chaser"], 0, null) === "high" && M.priorityOf([], 1, null) === "high" && M.priorityOf(["urgent"], 0, null) === "high" &&
    M.priorityOf(["complaint"], 0, null) === "high" && M.priorityOf([], 0, { firstAt: 1 }) === "high" && M.priorityOf(["call"], 0, null) === "medium");
  const ww = M.buildWaits([em("2026-10-12T10:00"), em("2026-10-20T10:30")], [])[0];
  const part = M.partToShow(ww, clock, window);
  const jj = part && M.judge(part.w, { clock, now: NOW });
  check("a client who writes again after being flagged is judged again, from the new email",
    part && part.again && part.again.earlier === 1 && part.w.emails.length === 1 && T.fmtWhen(jj.due) === "Wed 21 Oct, 10:30" && jj.verdict === "none", jj && T.fmtWhen(jj.due));
  check("an old wait with nothing new is not shown again", M.partToShow(M.buildWaits([em("2026-10-12T10:00")], [])[0], clock, window) === null);
  check("a wait due today is shown as it is", M.partToShow(M.buildWaits([em("2026-10-20T10:30")], [])[0], clock, window).again === null);
  const t = M.perCaseManager(s);
  check("every case manager gets a line, even with nothing due", t.lines.length === Object.keys(SETTINGS.CASE_MANAGERS).length);
  check("on time % leaves out the emails handled by phone or WhatsApp", t.lines.find((l) => l.cm === "Warda Badar").pct === 33 && t.lines.find((l) => l.cm === "Warda Badar").whatsapp === 1);
}

// ---------------------------------------------------------------- the email
{
  const window = T.reportWindow("", NOW);
  const row = (i, verdict) => ({ verdict, cm: Object.values(SETTINGS.CASE_MANAGERS)[i % 14], client: `Client <b>${i}</b>`, clientEmail: `c${i}@gmail.com`,
    subject: "Re: Petition preparation", words: "Any update please? ".repeat(20), start: PKT("2026-10-19T10:00"), due: PKT("2026-10-20T10:00"),
    flags: i % 5 ? [] : ["complaint"], chased: i % 3, priority: i % 2 ? "high" : "medium", count: 1 + (i % 3), status: "No reply yet — waiting 25 hrs, 1 hr over", onLeave: [], otherCms: [],
    dealLink: "https://app.hubspot.com/contacts/23735726/record/0-3/1", contactLink: "", ccOnly: false,
    ask: i % 2 ? "Kindly review the letters and confirm the dates for the session." : "" });
  const many = Array.from({ length: 160 }, (_, i) => row(i, "none"));
  const s = { due: many, onTime: [], call: many.slice(0, 40).map((r) => ({ ...r, verdict: "call" })), late: many.slice(0, 60), none: many, next: many };
  const r = { window, sections: s, byCm: M.perCaseManager(s), notCountedToday: 12, missingYears: ["2027"] };
  const html = fitEmail(r);
  check(`a busy day still fits under Gmail's clipping limit (${Math.round(Buffer.byteLength(html) / 1024)} KB)`, Buffer.byteLength(html) <= MAX_BYTES);
  check("rows that did not fit are pointed to the sheet", /in the attached sheet/.test(html));
  const flaggedShown = (html.split("High priority — no reply")[1] || "").split("Medium priority — no reply")[0].split("<tr>").length - 2;
  check(`flagged rows are kept before the 'due next' list (${flaggedShown} shown)`, flaggedShown >= 8);
  check("client words are escaped, never run as HTML", !html.includes("Client <b>1</b>") && html.includes("Client &lt;b&gt;1&lt;/b&gt;"));
  check("a missing holiday year is warned about", /No UAE public holidays are listed for 2027/.test(html));
  check("emails HubSpot sent back without text are warned about", /came back from HubSpot with no text/.test(buildEmail({ ...r, unreadPct: 60 })));
  const quiet = buildEmail({ window, sections: { due: [], onTime: [], call: [], late: [], none: [], next: [] }, byCm: M.perCaseManager({ due: [], onTime: [], call: [], late: [], none: [], next: [] }), notCountedToday: 0 });
  check("a day with nothing due says so", /No client emails fell due/.test(quiet));

  const sec = (none, late) => ({ due: [...none, ...late], onTime: [], call: [], late, none, next: [] });
  const asked = { ...row(1, "none"), ask: "Kindly review the letters and confirm." };
  const h1 = buildEmail({ window, sections: sec([asked], []), byCm: M.perCaseManager(sec([asked], [])), notCountedToday: 0 });
  check("no reply to an action: the email says it was needed and the client must be told",
    /Action needed: the client asked for this to be done/.test(h1) && /kindly confirm it to the client/.test(h1) && /Kindly review the letters and confirm/.test(h1));
  check("…and the headline counts it", /<b>1<\/b> of those with no reply asked for something to be done/.test(h1));
  const lateRow = { ...asked, verdict: "late", status: "Replied Tue 20 Oct, 16:00 — 25 working hrs, 1 hr over" };
  const h2 = buildEmail({ window, sections: sec([], [lateRow]), byCm: M.perCaseManager(sec([], [lateRow])), notCountedToday: 0 });
  check("an action that did get a reply is not marked", !/Action needed: the client asked/.test(h2));
  const waRow = { ...row(3, "whatsapp"), verdict: "whatsapp", status: "WhatsApp voice note Mon 19 Oct, 18:00 by Warda Badar · no email reply yet",
    waIn: { at: PKT("2026-10-19T18:00"), by: "Warda Badar", kind: "voice note", preview: "", line: "HOF Migration" } };
  const secWa = { due: [waRow], onTime: [], call: [], whatsapp: [waRow], late: [], none: [], next: [] };
  const meshOn = { used: true, on: true, lines: [{ name: "HOF Migration", phone: "+971 4 000 0000" }], since: PKT("2026-10-06T11:00"), chats: 40, messages: 900, hofMessages: 300,
    clients: 1, byNumber: 1, byName: 0, notFound: 0, nameClash: 0, errors: 0, replies: 1, problems: [] };
  const hw = buildEmail({ window, sections: secWa, byCm: M.perCaseManager(secWa), notCountedToday: 0, mesh: meshOn });
  check("the email has a section for emails answered on WhatsApp", /but answered on WhatsApp/.test(hw) && /A voice note \(not listened to\)/.test(hw) && /call or WhatsApp/.test(hw) && /on HOF Migration/.test(hw));
  check("the email says which WhatsApp number was read, and that case managers' own numbers are not",
    /on the HOF Migration WhatsApp number\)/.test(hw) && /read on the HOF Migration WhatsApp number only; a WhatsApp from any other number, such as a case manager's own, is not seen/.test(hw));
  const hOff = buildEmail({ window, sections: secWa, byCm: M.perCaseManager(secWa), notCountedToday: 0, mesh: { ...meshOn, on: false, why: "the MESH_API_KEY secret is not set" } });
  check("when Mesh could not be read, the email says WhatsApp was not checked", /WhatsApp was not checked today:<\/b> the MESH_API_KEY secret is not set/.test(hOff));
  const hPart = buildEmail({ window, sections: secWa, byCm: M.perCaseManager(secWa), notCountedToday: 0, mesh: { ...meshOn, problems: ["Key 2 of 2: Mesh refused the MESH_API_KEY"] } });
  check("when one of several numbers could not be read, the email says so", /Part of WhatsApp could not be read:<\/b> Key 2 of 2/.test(hPart));
  const img = buildEmail({ window, sections: { ...secWa, whatsapp: [{ ...waRow, waIn: { ...waRow.waIn, kind: "image" } }] }, byCm: M.perCaseManager(secWa), notCountedToday: 0, mesh: meshOn });
  check("an image is 'An image', not 'A image'", /An image/.test(img) && !/A image/.test(img));
  const hiRow = { ...row(1, "none"), priority: "high", flags: ["urgent"] }, medRow = { ...row(2, "none"), priority: "medium", flags: [], chased: 0 };
  const hp = buildEmail({ window, sections: sec([hiRow, medRow], []), byCm: M.perCaseManager(sec([hiRow, medRow], [])), notCountedToday: 3 });
  check("High and Medium have their own sections, High first",
    hp.indexOf("High priority — no reply") < hp.indexOf("Medium priority — no reply") && /High priority — no reply <span[^>]*>· 1</.test(hp) && /Medium priority — no reply <span[^>]*>· 1</.test(hp));
  check("the headline and the case manager table split flagged emails by priority", /1 high priority<\/b> and <b>1<\/b> medium/.test(hp) && /High flagged/.test(hp) && /Urgent \/ dated/.test(hp));
  check("there is no 'still unanswered' list any more", !/Still unanswered|Older, open/.test(hp));
  check("the email says Low emails are not counted", /Low<\/b> — nothing to answer/.test(hp) && /3 today/.test(hp));
  const again = { ...hiRow, again: { firstAt: PKT("2026-10-12T10:00"), earlier: 1 } };
  const ha = buildEmail({ window, sections: sec([again], []), byCm: M.perCaseManager(sec([again], [])), notCountedToday: 0 });
  check("a client who wrote again is marked, with when they first wrote", /Wrote again/.test(ha) && /First wrote<\/span> Mon 12 Oct, 10:00/.test(ha));
  const whole = { ...row(2, "none"), words: "Please call me tomorrow.", ask: "Please call me tomorrow." };
  const h3 = buildEmail({ window, sections: sec([whole], []), byCm: M.perCaseManager(sec([whole], [])), notCountedToday: 0 });
  check("an action that is the whole email is not quoted twice", (h3.match(/Please call me tomorrow/g) || []).length === 1 && /Action needed/.test(h3));
}

// ---------------------------------------------------------------- the sheet
(async () => {
  try {
    const { buildWorkbook } = require("./4-workbook");
    const window = T.reportWindow("", NOW);
    const s = { due: [], onTime: [], call: [], late: [], none: [], next: [] };
    const wb = await buildWorkbook({ window, sections: s, byCm: M.perCaseManager(s), intake: [{ at: NOW, cm: "Warda Badar", from: "a@b.com", subject: "x", counted: false, priority: "low", reason: "Thank-you or acknowledgement", words: "Thanks" },
      { at: NOW, cm: "Warda Badar", from: "c@d.com", subject: "y", counted: true, priority: "high", flags: ["urgent"], reason: "Asks a question", words: "When is my biometrics appointment?" }], notCountedToday: 1, missingYears: [] });
    const ig = wb.getWorksheet("All emails received");
    check("every email received shows its priority", ig.getRow(3).getCell(5).value === "Priority" && ig.getRow(4).getCell(5).value === "Low" && ig.getRow(5).getCell(5).value === "High" && /urgent or dated/.test(ig.getRow(5).getCell(6).value));
    const buf = await wb.xlsx.writeBuffer();
    check("the sheet builds, with every tab", buf.length > 5000 && ["Summary", "Flagged", "Call, no email", "WhatsApp, no email", "Due next", "On time", "All emails received", "How it was checked"].every((n) => wb.getWorksheet(n)) && !wb.getWorksheet("Still unanswered"));
    const r1 = { verdict: "none", cm: "Warda Badar", client: "Client", clientEmail: "c@gmail.com", subject: "Letters", words: "Kindly review the letters.", ask: "Kindly review the letters.",
      start: PKT("2026-10-19T10:00"), due: PKT("2026-10-20T10:00"), flags: [], count: 1, onLeave: [], otherCms: [], dealLink: "", contactLink: "", workMs: 0, overMs: 3600e3, priority: "high",
      again: { firstAt: PKT("2026-10-12T10:00"), earlier: 1 } };
    const s1 = { due: [r1], onTime: [], call: [], late: [], none: [r1], next: [] };
    const wb1 = await buildWorkbook({ window, sections: s1, byCm: M.perCaseManager(s1), intake: [], notCountedToday: 0, missingYears: [] });
    const fl = wb1.getWorksheet("Flagged");
    const colOf = (ws, name) => ws.getRow(3).values.indexOf(name);
    check("the sheet shows the action the client asked for, and says to confirm it",
      colOf(fl, "Action the client asked for") > 0 && fl.getRow(4).getCell(colOf(fl, "Action the client asked for")).value === "Kindly review the letters." &&
      /confirm it to the client/.test(String(fl.getRow(4).getCell(colOf(fl, "Notes")).value)));
    check("the sheet shows each row's priority, and a client who wrote again", fl.getRow(4).getCell(colOf(fl, "Priority")).value === "High" &&
      /Client wrote again: their first email \(Mon 12 Oct, 10:00\)/.test(String(fl.getRow(4).getCell(colOf(fl, "Notes")).value)));
    const rw = { ...r1, verdict: "whatsapp", waIn: { at: PKT("2026-10-19T18:00"), by: "Warda Badar", kind: "voice note", preview: "", line: "HOF Migration" }, waChecked: true, waFound: "number" };
    const s2 = { due: [rw], onTime: [], call: [], whatsapp: [rw], late: [], none: [], next: [] };
    const wb2 = await buildWorkbook({ window, sections: s2, byCm: M.perCaseManager(s2), intake: [], notCountedToday: 0, missingYears: [],
      mesh: { used: true, on: true, lines: [{ name: "HOF Migration", phone: "+971 4 000 0000" }], since: PKT("2026-10-06T11:00"), chats: 40, messages: 900, hofMessages: 300,
        clients: 3, byNumber: 2, byName: 0, notFound: 1, nameClash: 0, errors: 0, replies: 1, problems: [] } });
    const wt = wb2.getWorksheet("WhatsApp, no email");
    check("the sheet lists emails answered on WhatsApp, with what was sent and on which number",
      wt.getRow(4).getCell(colOf(wt, "WhatsApp sent by")).value === "Warda Badar (on HOF Migration)" && wt.getRow(4).getCell(colOf(wt, "WhatsApp message")).value === "A voice note" &&
      wt.getRow(4).getCell(7).value === "WhatsApp, no email in 24h", `${wt.getRow(4).getCell(colOf(wt, "WhatsApp sent by")).value}`);
    const how = wb2.getWorksheet("How it was checked").getColumn(1).values.join(" ");
    check("the sheet says which number was read, and how many clients were found", /read WhatsApp on HOF Migration \(\+971 4 000 0000\): 40 chats and 900 messages/.test(how) &&
      /3 clients looked up — 2 found by phone number/.test(how) && /such as a case manager's own, is not seen/.test(how));
    const rn = { ...r1, waFound: "none" };
    const s3 = { due: [rn], onTime: [], call: [], late: [], none: [rn], next: [] };
    const wb3 = await buildWorkbook({ window, sections: s3, byCm: M.perCaseManager(s3), intake: [], notCountedToday: 0, missingYears: [] });
    const f3 = wb3.getWorksheet("Flagged");
    check("a flagged client with no WhatsApp chat says so", /No WhatsApp chat with this client on the number Mesh checks/.test(String(f3.getRow(4).getCell(colOf(f3, "Notes")).value)));
  } catch (e) { check("the sheet builds", false, e.message); }

  // ---------------------------------------------------------------- WhatsApp, against a pretend Mesh
  // A pretend Compliance Read API, built from Mesh's own documentation: /channel,
  // /conversations?updatedSince, /messages?since, pages with nextCursor, 401 / 422 / 429 / 503.
  {
    const Mesh = require("./6-mesh");
    const realFetch = global.fetch, realKey = process.env.MESH_API_KEY, realRps = SETTINGS.MESH_RPS;
    SETTINGS.MESH_RPS = 1000;
    Object.assign(Mesh.timing, { tooMany: 1, busy: 1, network: 1 });
    const API = "/api/compliance-feed/v1";
    const iso = (at) => new Date(typeof at === "number" ? at : PKT(at)).toISOString();
    const json = (status, obj) => ({ ok: status < 300, status, text: async () => JSON.stringify(obj) });
    const conv = (id, contactId, phone, name, updated = "2026-10-20T12:00") => ({ id, number: 1, status: "open", contact: { id: contactId, name, phone },
      messageCount: 3, createdAt: iso("2026-09-01T10:00"), updatedAt: iso(updated), lastMessageAt: iso(updated), lastInboundAt: null, hiddenInInboxAt: null, clearedInInboxAt: null });
    const msg = (id, conversationId, at, extra = {}) => ({ id, conversationId, direction: "outbound", kind: "message", status: "read", sentAt: iso(at),
      sender: { type: "user", name: "Warda Badar", email: "warda@hofmigration.com" }, text: "Hi, the letters are ready.", parts: [{ type: "text", text: "Hi, the letters are ready." }],
      campaign: null, replyToId: null, attachments: [], error: null, deleted: null, ...extra });
    const voice = { text: null, parts: [{ type: "audio" }], attachments: [{ fileName: "voice.ogg", mimeType: "audio/ogg; codecs=opus", sizeBytes: 9000, durationMs: 12000, url: "https://example.invalid/v", urlExpiresAt: iso("2026-10-19T18:10"), transcript: null }] };
    const lines = {
      KEY: {
        channel: { id: "ch1", name: "HOF Migration", phoneNumber: "+971 4 000 0000", brand: "HOF Migration" },
        convs: [conv("cv1", "p1", "+971501234567", "Sara Khan"), conv("cv2", "p2", "+97150123456789", "Someone Else"), conv("cv4", "p3", "+966551752664", "Omar Ali"),
          conv("cv5", "p4", "+971559999999", "Fatima Noor"), conv("cv6", "p5", "+971558888888", "Fatima Noor"), conv("cv7", "p6", "+971557777777", "Imran Shah"),
          conv("cv8", "p7", "+971556666666", "Old Chat", "2026-09-01T10:00")],
        msgs: [
          msg("m1", "cv1", "2026-10-19T09:00"),                                                  // before the email
          msg("m2", "cv1", "2026-10-19T16:00", { direction: "inbound", sender: { type: "contact", name: "Sara Khan" } }),
          msg("m3", "cv1", "2026-10-19T17:00", { kind: "note" }),
          msg("m4", "cv1", "2026-10-19T18:00", voice),                                           // counts: a voice note
          msg("m5", "cv1", "2026-10-19T19:00", { sender: { type: "system", name: "Bot" } }),
          msg("m6", "cv1", "2026-10-19T19:30", { campaign: "Visa update" }),
          msg("m7", "cv1", "2026-10-20T08:00", { status: "failed", error: "Message undeliverable" }),
          msg("m8", "cv1", "2026-10-20T08:30", { status: "pending" }),
          msg("m9", "cv1", "2026-10-20T09:00", { kind: "activity", text: "Assigned to Sara" }),
          msg("m10", "cv1", "2026-10-20T09:30", { sender: { type: "system", name: "WhatsApp Business app (phone)" }, text: "Sure, I will check.", parts: [] }),   // counts: typed on the team phone
          msg("m11", "cv1", "2026-10-20T09:40", { sender: { type: "system", name: "Automation" } }),
          msg("m12", "cv1", "2026-10-20T09:50", { deleted: iso("2026-10-20T09:51") }),
          msg("m13", "cv2", "2026-10-20T10:00"),
          msg("m14", "cv4", "2026-10-20T10:00"),
          msg("m15", "cv8", "2026-10-20T10:30", { sender: { type: "user", name: "Maryam Chand", email: "maryam@hofmigration.com" } }),   // a chat not listed as changed
          ...Array.from({ length: 22 }, (_, i) => msg(`n${i}`, "cv7", PKT("2026-10-19T16:00") + i * 3600e3)),
        ],
      },
      KEY2: {
        channel: { id: "ch2", name: "Warda", phoneNumber: "+971 50 000 0002", brand: "HOF Migration" },
        convs: [conv("w1", "q1", "+923001234567", "Bilal Ahmed")],
        msgs: [msg("w1m1", "w1", "2026-10-20T11:00")],
      },
    };
    const world = { accepts: "bearer", requests: [], status: 0, dropAfter: undefined, tooManyOnce: false, pageSize: 3 };
    global.fetch = async (url, opts = {}) => {
      const u = new URL(url), h = opts.headers || {};
      world.requests.push(`${u.pathname}?${u.searchParams.toString()}`);
      if (!u.pathname.startsWith(API)) return json(404, { message: `Cannot GET ${u.pathname}` });
      if (world.status) return json(world.status, { message: "The API is switched off" });
      if (world.tooManyOnce) { world.tooManyOnce = false; return json(429, { message: "Too many requests" }); }
      if (world.dropAfter !== undefined && world.requests.length > world.dropAfter) return json(401, { message: "Invalid API key" });
      const bearer = /^Bearer /.test(String(h.Authorization || "")) ? h.Authorization.slice(7) : null;
      const line = lines[world.accepts === "bearer" ? bearer : world.accepts === "x-api-key" ? h["X-Api-Key"] : null];
      if (!line) return json(401, { message: "Invalid API key" });
      const p = u.pathname.slice(API.length);
      if (p === "/channel") return json(200, line.channel);
      const allowed = { "/conversations": ["updatedSince", "limit", "cursor"], "/messages": ["since", "limit", "cursor"] }[p];
      if (!allowed) return json(404, { message: "That chat isn't on this number" });
      const bad = [...u.searchParams.keys()].find((k) => !allowed.includes(k));
      if (bad) return json(422, { message: `Unknown parameter: ${bad}` });
      const lim = Number(u.searchParams.get("limit") || 50);
      if (!(lim >= 1 && lim <= 200)) return json(422, { message: "limit must be 1-200" });
      const since = Date.parse(u.searchParams.get(p === "/messages" ? "since" : "updatedSince") || "") || 0;
      const list = p === "/messages"
        ? line.msgs.filter((m) => Date.parse(m.sentAt) >= since).sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt))
        : line.convs.filter((c) => Date.parse(c.updatedAt) >= since).sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
      const from = Number(u.searchParams.get("cursor") || 0), n = world.pageSize;
      return json(200, { data: list.slice(from, from + n), nextCursor: from + n < list.length ? String(from + n) : null });
    };
    try {
      process.env.MESH_API_KEY = "KEY";
      check("Mesh: the key is sent as a Bearer token, and the number it covers is named", (await Mesh.start()) && Mesh.state.header === "Bearer token" && Mesh.state.lines.map((l) => l.name).join() === "HOF Migration");
      world.accepts = "x-api-key";
      check("Mesh: …and as X-Api-Key if the Bearer token is refused", (await Mesh.start()) && Mesh.state.header === "X-Api-Key");
      world.accepts = "nothing";
      check("Mesh: a refused key switches WhatsApp off for the run, and says why",
        !(await Mesh.start()) && /refused the MESH_API_KEY \(401/.test(Mesh.state.why) && (await Mesh.repliesTo({ numbers: [], name: "x" }, 0, 1)) === null, Mesh.state.why);
      world.accepts = "bearer"; world.status = 503;
      check("Mesh: an API that is switched off says so", !(await Mesh.start()) && /switched off or being set up/.test(Mesh.state.why), Mesh.state.why);
      world.status = 0;
      delete process.env.MESH_API_KEY;
      check("Mesh: no key, no WhatsApp check (and the report still goes out)", !(await Mesh.start()) && /not set/.test(Mesh.state.why));
      process.env.MESH_API_KEY = ' "Bearer KEY" \n';
      check("Mesh: a key pasted with \"Bearer\" or quotes around it still works", await Mesh.start());
      check("Mesh: several keys in the secret are read one per line", Mesh.readKeys("KEY\nKEY2\n").join() === "KEY,KEY2" && Mesh.readKeys("Authorization: Bearer abc").join() === "abc");

      process.env.MESH_API_KEY = "KEY"; await Mesh.start();
      const from = PKT("2026-10-19T15:00"), to = PKT("2026-10-21T11:00");
      world.tooManyOnce = true;
      const r0 = world.requests.length;
      const loaded = await Mesh.load(from);
      const pagesRead = world.requests.slice(r0).filter((x) => x.startsWith(`${API}/messages`)).length;
      check("Mesh: chats and messages are read once, page by page, and 'too many requests' is waited out",
        loaded && pagesRead > 5 && Mesh.state.messages === 36 && Mesh.state.chats === 7, `${Mesh.state.chats} chats, ${Mesh.state.messages} messages, ${pagesRead} pages, ${Mesh.state.why}`);
      const sara = await Mesh.repliesTo({ numbers: Mesh.numbersOf({ phone: "050 123 4567" }), name: "Sara Khan" }, from, to);
      check("Mesh: the client is found by their HubSpot number", sara.found && sara.how === "number");
      check("Mesh: only HOF's real WhatsApps after the email count — a voice note, and a message typed on the team phone",
        sara.replies.map((x) => `${x.kind}/${x.by}/${x.line}`).join(", ") === "voice note/Warda Badar/HOF Migration, message/WhatsApp Business app (phone)/HOF Migration",
        sara.replies.map((x) => `${x.kind}/${x.by}/${x.line}`).join(", "));
      const exact = await Mesh.repliesTo({ numbers: Mesh.numbersOf({ phone: "+971 50 123 4567" }), name: "" }, from, to);
      check("Mesh: a number that only starts the same is not the client", exact.replies.length === 2);
      const omar = await Mesh.repliesTo({ numbers: Mesh.numbersOf({ mobilephone: "0551752664" }), name: "Omar Ali" }, from, to);
      check("Mesh: a number saved without its country code still finds the client", omar.found && omar.how === "number" && omar.replies.length === 1);
      const byName = await Mesh.repliesTo({ numbers: Mesh.numbersOf({ phone: "+971500000001" }), name: "Omar  ALI" }, from, to);
      check("Mesh: no number match -> the HubSpot name, when exactly one WhatsApp contact has it", byName.found && byName.how === "name" && byName.replies.length === 1);
      const clash = await Mesh.repliesTo({ numbers: [], name: "Fatima Noor" }, from, to);
      check("Mesh: two WhatsApp contacts with the same name -> not guessed", !clash.found && clash.clash);
      const single = await Mesh.repliesTo({ numbers: [], name: "Imran" }, from, to);
      check("Mesh: a first name alone is never matched", !single.found && !single.clash);
      const imran = await Mesh.repliesTo({ numbers: Mesh.numbersOf({ hs_whatsapp_phone_number: "+971 55 777 7777" }), name: "Imran Shah" }, from, to);
      check("Mesh: every HOF message is kept, across all the pages", imran.replies.length === 22, `${imran.replies.length}`);
      const narrow = await Mesh.repliesTo({ numbers: Mesh.numbersOf({ phone: "+971557777777" }), name: "" }, PKT("2026-10-20T08:00"), PKT("2026-10-20T10:00"));
      check("Mesh: only messages inside the client's own window are returned", narrow.replies.length === 3, `${narrow.replies.length}`);
      const old = await Mesh.repliesTo({ numbers: Mesh.numbersOf({ phone: "+971556666666" }), name: "" }, from, to);
      check("Mesh: a HOF message in a chat not listed as changed is still matched to its client", old.found && old.replies.length === 1 && old.replies[0].by === "Maryam Chand");
      const n0 = world.requests.length;
      await Mesh.repliesTo({ numbers: Mesh.numbersOf({ phone: "0501234567" }), name: "" }, from, to);
      check("Mesh: looking up a client asks Mesh nothing more", world.requests.length === n0);

      process.env.MESH_API_KEY = "KEY\nKEY2"; await Mesh.start(); await Mesh.load(from);
      const bilal = await Mesh.repliesTo({ numbers: Mesh.numbersOf({ phone: "+92 300 1234567" }), name: "Bilal Ahmed" }, from, to);
      check("Mesh: with a key for each number, every number is read", Mesh.state.lines.length === 2 && bilal.found && bilal.replies[0].line === "Warda");
      process.env.MESH_API_KEY = "KEY\nWRONG";
      check("Mesh: a key refused while another works is reported, and the other number is still read",
        (await Mesh.start()) && Mesh.state.problems.length === 1 && /^Key 2 of 2: Mesh refused/.test(Mesh.state.problems[0]), Mesh.state.problems.join(" | "));

      process.env.MESH_API_KEY = "KEY"; await Mesh.start();
      world.dropAfter = world.requests.length + 2;
      check("Mesh: a key that stops working part-way turns WhatsApp off, never the report",
        !(await Mesh.load(from)) && !Mesh.state.on && /stopped accepting/.test(Mesh.state.why) && (await Mesh.repliesTo({ numbers: Mesh.numbersOf({ phone: "0501234567" }), name: "" }, from, to)) === null, Mesh.state.why);
      world.dropAfter = undefined;

      const R = (extra) => Mesh.replyOf(msg("x", "c", "2026-10-19T18:00", extra));
      check("Mesh: a reply is a real WhatsApp message from a person", R({}) && !R({ direction: "inbound" }) && !R({ kind: "note" }) && !R({ kind: "activity" }) &&
        !R({ sender: { type: "system", name: "Campaign" } }) && !R({ sender: { type: "system", name: "Mesh" } }) && !R({ campaign: "x" }) && !R({ status: "failed" }) && !R({ status: "pending" }));
      check("Mesh: images, videos and files are told apart", R({ text: "", parts: [{ type: "image" }], attachments: [{ mimeType: "image/jpeg" }] }).kind === "image" &&
        R({ text: null, parts: [], attachments: [{ mimeType: "video/mp4" }] }).kind === "video" && R({ text: null, parts: [{ type: "document" }], attachments: [{ mimeType: "application/pdf" }] }).kind === "file");
      check("Mesh: a template's words are shown", R({ text: null, parts: [{ type: "template", text: "Your appointment is confirmed." }] }).preview === "Your appointment is confirmed.");
      const keep = SETTINGS.MESH_PEOPLE_SENDERS;
      const counted = !!R({ sender: { type: "system", name: "Team (outside Mesh)" } });
      SETTINGS.MESH_PEOPLE_SENDERS = ["WhatsApp Business app (phone)"];
      const dropped = R({ sender: { type: "system", name: "Team (outside Mesh)" } }) === null;
      SETTINGS.MESH_PEOPLE_SENDERS = keep;
      check("Mesh: 'Team (outside Mesh)' counts, and can be taken out in config.js", counted && dropped);
    } catch (e) { check("Mesh checks ran", false, e.stack); }
    finally {
      global.fetch = realFetch; SETTINGS.MESH_RPS = realRps;
      if (realKey === undefined) delete process.env.MESH_API_KEY; else process.env.MESH_API_KEY = realKey;
    }
  }

  // ---------------------------------------------------------------- settings
  const ids = Object.keys(SETTINGS.CASE_MANAGERS);
  check("all 14 case managers are listed, by HubSpot id", ids.length === 14 && ids.every((id) => /^\d+$/.test(id)));
  check("the allowance is 24 hours", SETTINGS.REPLY_HOURS === 24);
  check("the weekend is Saturday and Sunday", SETTINGS.WEEKEND_DAYS.length === 2 && SETTINGS.WEEKEND_DAYS.includes(6) && SETTINGS.WEEKEND_DAYS.includes(0));
  check("holidays and leave are written as dates", [...SETTINGS.HOLIDAYS, ...Object.values(SETTINGS.LEAVE || {}).flat()].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
  try {
    const yml = fs.readFileSync(path.join(__dirname, ".github/workflows/cm-email-replies.yml"), "utf8");
    check("the schedule is 11:00 Pakistan time (06:00 UTC)", /cron:\s*"0 6 \* \* \*"/.test(yml));
  } catch { /* the workflow lives in .github/workflows in the repo, not beside this file when tested elsewhere */ }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nA rule is not behaving. The report is not sent until it is fixed."); process.exit(1); }
})();

// report.js — the daily run, at 11am Pakistan time.
//
//  1. Read every email that reached the case managers' inboxes over the last few weeks.
//  2. Decide which ones need a reply (2-classify.js) — thank-yous, documents with nothing
//     asked, automatic messages and staff emails do not.
//  3. Group each client's emails into waits, and find the first email HOF sent back.
//  4. Anything not answered by email within 24 working hours is checked again: a reply from
//     anyone else at HOF, a connected call on the client's contact or deal, and a WhatsApp
//     from HOF to the client in Mesh (6-mesh.js).
//  5. Email the report, with every row in an attached sheet.
//
// Read-only. Nothing in HubSpot or Mesh is changed.
const fs = require("fs");
const path = require("path");
const { SETTINGS } = require("./config");
const H = require("./0-hubspot");
const T = require("./1-clock");
const { classify, snippet, cleanSubject } = require("./2-classify");
const M = require("./3-match");
const { buildWorkbook } = require("./4-workbook");
const { fitEmail, sendEmail } = require("./5-email");
const Mesh = require("./6-mesh");

const RANK = ["complaint", "chaser", "problem", "call", "question", "request", "long", "subject", "documentsCounted"];

async function main() {
  if (!process.env.HUBSPOT_TOKEN) throw new Error("No HUBSPOT_TOKEN secret.");
  const now = Date.now();
  const clock = T.makeClock();
  const window = T.reportWindow(process.env.AS_OF, now);
  const readFrom = window.end - (SETTINGS.STILL_OPEN_DAYS + 3) * T.DAY;
  const cmIds = Object.keys(SETTINGS.CASE_MANAGERS);
  console.log(`=== Case manager email replies — ${T.fmtDay(window.end)} ===`);
  console.log(`Due in this report: ${T.fmtWhen(window.start)} to ${T.fmtWhen(window.end)} (Pakistan time). Reading from ${T.fmtWhen(readFrom)}.`);

  // ---- names ----
  const owners = await H.owners();
  const nameOf = (id) => SETTINGS.CASE_MANAGERS[id] || (owners[id] && owners[id].name) || (id ? `Owner ${id}` : "");
  const missing = cmIds.filter((id) => !owners[id]);
  if (missing.length) console.log(`!! Not found among HubSpot users: ${missing.map((id) => `${SETTINGS.CASE_MANAGERS[id]} (${id})`).join(", ")}`);

  // ---- 1. client emails into the case managers' inboxes ----
  const raw = await H.incoming(cmIds, readFrom, now);
  // an email whose body came back empty is read again, with its HTML as a fallback
  const blank = raw.filter((e) => !String(e.properties.hs_email_text || "").trim()).map((e) => e.id);
  const again = blank.length ? await H.batchRead("emails", blank, ["hs_email_text", "hs_email_html"]) : new Map();
  const emails = raw.map((e) => {
    const p = e.properties || {};
    const b = again.get(String(e.id)) || {};
    const cls = classify({ from: p.hs_email_from_email, subject: p.hs_email_subject, text: p.hs_email_text || b.hs_email_text,
      html: b.hs_email_html, attachments: !!p.hs_attachment_ids });
    return { id: String(e.id), at: M.ms(p.hs_timestamp), from: String(p.hs_email_from_email || "").toLowerCase().trim(),
      fromName: `${p.hs_email_from_firstname || ""} ${p.hs_email_from_lastname || ""}`.trim(),
      to: M.addresses(p.hs_email_to_email), cc: M.addresses(p.hs_email_cc_email),
      subject: p.hs_email_subject || "", ownerId: String(p.hubspot_owner_id || ""), cls };
  }).filter((e) => e.from && e.at);
  const needing = emails.filter((e) => e.cls.needs);
  console.log(`Client emails read: ${emails.length} — ${needing.length} need a reply, ${emails.length - needing.length} do not.`);
  if (!emails.length) console.log("!! No emails found at all. Check the token can read emails (the sales-email-read scope).");
  // if HubSpot is not handing over email bodies, say so loudly rather than report "nothing due"
  const unread = emails.filter((e) => e.cls.key === "empty").length;
  const unreadPct = emails.length ? Math.round((unread / emails.length) * 100) : 0;
  if (unreadPct > 25) console.log(`!! ${unreadPct}% of emails came back with no text. Check the HubSpot token has the sales-email-read scope.`);

  // ---- 2. who each email is from: their contact and deals ----
  const e2c = await H.links("emails", "contacts", needing.map((e) => e.id));
  const e2d = await H.links("emails", "deals", needing.map((e) => e.id));
  const contactIds = [...new Set([...e2c.values()].flat())];
  const contacts = await H.batchRead("contacts", contactIds, ["firstname", "lastname", "email", "hs_additional_emails",
    "phone", "mobilephone", "mobile_number", "hs_whatsapp_phone_number"]);
  const c2d = await H.links("contacts", "deals", contactIds);
  const dealIds = [...new Set([...[...e2d.values()].flat(), ...[...c2d.values()].flat()])];
  const deals = await H.batchRead("deals", dealIds, ["dealname", "pipeline", "hubspot_owner_id"]);

  const clients = new Map();       // sender address -> who they are
  for (const e of needing) {
    let c = clients.get(e.from);
    if (!c) { c = { key: e.from, contactId: null, name: e.fromName || "", person: "", numbers: [], addrs: new Set([e.from]), dealIds: new Set(), extra: [], calls: [], wa: null }; clients.set(e.from, c); }
    const cids = e2c.get(e.id) || [];
    if (!c.contactId && cids.length) {
      const own = cids.find((id) => { const p = contacts.get(id) || {}; return [p.email, ...String(p.hs_additional_emails || "").split(/[;,\s]+/)].map((x) => String(x || "").toLowerCase()).includes(e.from); });
      c.contactId = own || cids[0];
      const p = contacts.get(c.contactId) || {};
      const nm = `${p.firstname || ""} ${p.lastname || ""}`.replace(/\s+/g, " ").trim();
      if (nm) { c.name = nm; c.person = nm; }
      c.numbers = Mesh.numbersOf(p);       // to find them on WhatsApp
      M.addresses(`${p.email || ""};${p.hs_additional_emails || ""}`).forEach((a) => c.addrs.add(a));
      (c2d.get(c.contactId) || []).forEach((d) => c.dealIds.add(d));
    }
    (e2d.get(e.id) || []).forEach((d) => c.dealIds.add(d));
  }
  for (const c of clients.values()) {
    const ds = [...c.dealIds].map((id) => ({ id, ...(deals.get(id) || {}) }));
    // the deal to link: one a case manager owns, else the first
    c.deal = ds.find((d) => cmIds.includes(String(d.hubspot_owner_id || ""))) || ds[0] || null;
    c.dealIds = [...c.dealIds];
    if (!c.name) c.name = (c.deal && String(c.deal.dealname || "").trim()) || c.key;
  }

  // ---- 3. replies: everything the case managers sent, matched to the client's address ----
  const toReply = (o) => { const p = o.properties || {}; return { id: String(o.id), at: M.ms(p.hs_timestamp), ownerId: String(p.hubspot_owner_id || ""),
    subject: p.hs_email_subject || "", status: p.hs_email_status, to: M.addresses(`${p.hs_email_to_email || ""};${p.hs_email_cc_email || ""};${p.hs_email_bcc_email || ""}`) }; };
  const sent = (await H.outgoing(cmIds, readFrom, now)).map(toReply).filter((r) => M.sentOk(r.status) && r.at);
  const byAddr = new Map();
  for (const r of sent) for (const a of r.to) { if (!byAddr.has(a)) byAddr.set(a, []); byAddr.get(a).push(r); }
  console.log(`Emails the case managers sent in the same period: ${sent.length}.`);

  const repliesFor = (c) => {
    const seen = new Map();
    for (const a of c.addrs) for (const r of byAddr.get(a) || []) seen.set(r.id, r);
    for (const r of c.extra) seen.set(r.id, r);
    return [...seen.values()];
  };
  const waitsFor = (c) => M.buildWaits(needing.filter((e) => e.from === c.key).sort((a, b) => a.at - b.at), repliesFor(c));

  // ---- 4. a second look at anything not answered on time by the case manager ----
  const deep = [];
  for (const c of clients.values()) {
    // only waits today's report can show: due today, not yet due, or still without a reply
    const open = waitsFor(c).map((w) => ({ w, j: M.judge(w, { clock, now }) }))
      .filter((x) => x.j.verdict !== "on-time" && (x.j.due > window.start || x.j.replyAt === null));
    if (open.length && (c.contactId || c.dealIds.length)) deep.push({ c, since: Math.min(...open.map((x) => x.j.start)) });
  }
  const meshOn = deep.length ? await Mesh.start() : false;
  console.log(`Second look (other senders, connected calls${meshOn ? ", WhatsApp in Mesh" : ""}) for ${deep.length} client(s)…`);
  if (deep.length && !meshOn) console.log(`!! WhatsApp not checked: ${Mesh.state.why}.`);
  else if (meshOn) console.log(`   Mesh key accepted as ${Mesh.state.header}.`);
  let done = 0;
  for (const { c, since } of deep) {
    try {
      c.extra = (await H.clientEmails(c.contactId, c.dealIds, since)).map(toReply)
        .filter((r) => M.sentOk(r.status) && r.at && r.at <= now && r.to.some((a) => c.addrs.has(a)));
      c.calls = await H.clientCalls(c.contactId, c.dealIds, since);
    } catch (e) { console.log(`  could not check ${c.key}: ${e.message}`); }
    // WhatsApp: only for a client HubSpot knows (their numbers and name come from the contact)
    if (meshOn && Mesh.state.on && (c.numbers.length || c.person)) c.wa = await Mesh.repliesTo({ numbers: c.numbers, name: c.person }, since, now);
    if (++done % 25 === 0) console.log(`  ${done}/${deep.length}`);
  }

  // ---- 5. every wait, judged ----
  const leave = SETTINGS.LEAVE || {};
  const rows = [];
  for (const c of clients.values()) {
    for (const w of waitsFor(c)) {
      const j = M.judge(w, { clock, now, calls: c.calls, whatsapp: c.wa ? c.wa.replies : null });
      const first = w.emails[0];
      const cmId = first.ownerId;
      const cm = nameOf(cmId);
      const keys = w.emails.map((e) => e.cls.key);
      const key = RANK.find((k) => keys.includes(k)) || keys[0];
      const cmAddr = owners[cmId] && owners[cmId].email;
      const asked = w.emails.find((e) => e.cls.ask);      // the first thing the client asked to be done
      const leaveDays = (leave[cm] || []).filter((d) => { const t = Date.parse(`${d}T12:00:00+05:00`); return t >= T.dayStart(j.start) && t <= j.due; });
      const row = {
        ...j, cmId, cm,
        otherCms: [...new Set(w.emails.map((e) => e.ownerId).filter((id) => id !== cmId).map(nameOf))],
        client: c.name, clientEmail: c.key, subject: cleanSubject(first.subject) || "(no subject)",
        reason: (w.emails.find((e) => e.cls.key === key) || first).cls.reason,
        flags: [...new Set(w.emails.flatMap((e) => e.cls.flags))],
        words: snippet(first.cls.words, 400), count: w.emails.length,
        ask: asked ? asked.cls.ask : "",
        replyBy: w.reply ? nameOf(w.reply.ownerId) : "",
        ccOnly: !!(cmAddr && !first.to.includes(cmAddr) && first.cc.includes(cmAddr)),
        onLeave: leaveDays,
        dealName: c.deal ? String(c.deal.dealname || "").trim() : "",
        dealLink: c.deal ? H.dealLink(c.deal.id) : "",
        contactLink: c.contactId ? H.contactLink(c.contactId) : "",
        // what the WhatsApp check found: "number" / "name" (found that way), "none" (not in
        // Mesh), "clash" (two Mesh contacts with that name), "" (not checked)
        waFound: c.wa ? (c.wa.found ? c.wa.how : c.wa.clash ? "clash" : "none") : "",
      };
      if (row.callIn) row.callIn.by = nameOf(row.callIn.ownerId);
      if (row.callAfter) row.callAfter.by = nameOf(row.callAfter.ownerId);
      row.status = M.statusText(row, now);
      rows.push(row);
    }
  }
  const s = M.sortOut(rows, window, now);
  const byCm = M.perCaseManager(s);

  // every email received in the last 24 hours, and what was decided about it
  const intake = emails.filter((e) => e.at > window.start && e.at <= window.end).sort((a, b) => a.at - b.at).map((e) => ({
    at: e.at, cm: nameOf(e.ownerId), from: e.from, subject: e.subject, counted: e.cls.needs, reason: e.cls.reason, words: snippet(e.cls.words, 300),
  }));

  const years = [...new Set([new Date(readFrom).getUTCFullYear(), new Date(now).getUTCFullYear()])];
  const missingYears = years.filter((y) => !SETTINGS.HOLIDAYS.some((d) => d.startsWith(String(y))));
  if (missingYears.length) console.log(`!! No UAE holidays are listed for ${missingYears.join(", ")} — add them to config.js.`);

  const mst = Mesh.state;
  const mesh = { used: deep.length > 0, on: meshOn, why: mst.why, header: mst.header, clients: mst.clients, byNumber: mst.byNumber, byName: mst.byName,
    notFound: mst.notFound, nameClash: mst.nameClash, errors: mst.errors, replies: mst.replies, requests: mst.requests };
  const r = { now, window, sections: s, byCm, intake, missingYears, notCountedToday: intake.filter((x) => !x.counted).length, unreadPct,
    readFrom, hubspotCalls: H.stats.calls, mesh };

  // ---- the log ----
  console.log(`\nFell due: ${s.due.length} — on time ${s.onTime.length}, by call ${s.call.length}, by WhatsApp ${s.whatsapp.length}, late ${s.late.length}, no reply ${s.none.length}`);
  if (mesh.on) console.log(`WhatsApp (Mesh): ${mesh.clients} clients looked up — ${mesh.byNumber} found by number, ${mesh.byName} by name, ${mesh.notFound} not in Mesh` +
    `${mesh.nameClash ? ` (${mesh.nameClash} names shared by several Mesh contacts)` : ""}; ${mesh.replies} HOF messages in the windows; ${mesh.errors} could not be checked; ${mesh.requests} requests.`);
  console.log(`Still unanswered from earlier: ${s.still.length}. Due before the next report: ${s.next.length}.`);
  console.log(`Asked for something to be done, and no reply or connected call: ${s.none.filter((x) => x.ask).length} today, ${s.still.filter((x) => x.ask).length} from earlier days.`);
  for (const l of byCm.lines) console.log(`  ${l.cm.padEnd(22)} due ${String(l.due).padStart(3)}  on time ${String(l.onTime).padStart(3)}  call ${String(l.call).padStart(2)}  WhatsApp ${String(l.whatsapp).padStart(2)}  late ${String(l.late).padStart(2)}  none ${String(l.none).padStart(2)}  still ${String(l.still).padStart(2)}`);
  console.log(`HubSpot requests: ${H.stats.calls} (${H.stats.retries} retried).`);

  // ---- the files ----
  fs.mkdirSync(SETTINGS.OUT_DIR, { recursive: true });
  const stamp = T.dateKey(window.end);
  const xlsx = path.join(SETTINGS.OUT_DIR, `CM-email-replies-${stamp}.xlsx`);
  await (await buildWorkbook(r)).xlsx.writeFile(xlsx);
  const html2 = fitEmail(r);
  fs.writeFileSync(path.join(SETTINGS.OUT_DIR, "email.html"), html2);
  console.log(`\nWrote ${xlsx} (${Math.round(fs.statSync(xlsx).size / 1024)} KB) and email.html (${Math.round(Buffer.byteLength(html2) / 1024)} KB).`);

  const quiet = !clock.isWorkingDay(window.end) && !s.due.length;
  if (!SETTINGS.SEND_EMAIL) { console.log("Not emailed (send_email is off)."); return; }
  if (quiet && !SETTINGS.EMAIL_ON_QUIET_DAYS) { console.log("A weekend or holiday with nothing due — no email sent."); return; }
  const flagged = s.late.length + s.none.length;
  const subject = `CM email replies · ${T.fmtDay(window.end).replace(/ \d{4}$/, "")} · ${flagged} flagged, ${s.call.length} by call, ${s.whatsapp.length} by WhatsApp, ${s.onTime.length} on time` +
    (s.still.length ? ` · ${s.still.length} still unanswered` : "");
  const ok = await sendEmail(subject, html2, { filename: path.basename(xlsx), content: fs.readFileSync(xlsx).toString("base64") });
  if (ok) console.log(`Emailed to ${SETTINGS.REPORT_TO}${SETTINGS.CC.length ? ` (cc ${SETTINGS.CC.join(", ")})` : ""}.`);
  else { console.log("!! The email was not sent. The sheet and email.html are in this run's Artifacts."); process.exitCode = 1; }
}

if (require.main === module) {
  main().catch((e) => { console.error(`\nFAILED: ${e.message}`); process.exit(1); });
}

module.exports = { main };

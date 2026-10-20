// 0-hubspot.js — reading HubSpot. Nothing is ever written.
//
// Search is used throughout because it filters by date and owner. HubSpot allows five
// searches a second for the whole account (other agents share that), so searches are
// paced and a busy moment is simply waited out.
const { SETTINGS } = require("./config");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function throttle(rps) {
  let next = 0;
  return async () => { const now = Date.now(); const at = Math.max(now, next); next = at + 1000 / rps; if (at > now) await sleep(at - now); };
}
const gate = { search: throttle(SETTINGS.SEARCH_RPS), api: throttle(SETTINGS.API_RPS) };
const stats = { calls: 0, retries: 0 };

async function hs(method, path, body, kind = "api", attempt = 0) {
  await gate[kind]();
  stats.calls++;
  let res;
  try {
    res = await fetch(`https://api.hubapi.com${path}`, {
      method, headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (attempt < 6) { stats.retries++; await sleep(2000 * (attempt + 1)); return hs(method, path, body, kind, attempt + 1); }
    throw new Error(`Could not reach HubSpot: ${e.message}`);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 8) {
    stats.retries++;
    await sleep(Math.min(30000, 1500 * 2 ** attempt));
    return hs(method, path, body, kind, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) { const e = new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 220)}`); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : null;
}

// Every record matching `filters` with hs_timestamp in [from, to), oldest first. HubSpot
// will not page past 10,000 results in one search, so a window holding more is halved
// until each part fits — nothing is ever silently cut short.
async function searchAll(obj, filters, properties, from, to, depth = 0) {
  const group = (f, t) => [{ filters: [...filters,
    { propertyName: "hs_timestamp", operator: "GTE", value: String(f) },
    { propertyName: "hs_timestamp", operator: "LT", value: String(t) }] }];
  const probe = await hs("POST", `/crm/v3/objects/${obj}/search`, { filterGroups: group(from, to), properties: ["hs_timestamp"], limit: 1 }, "search");
  const total = (probe && probe.total) || 0;
  if (!total) return [];
  if (total > 9800 && depth < 16 && to - from > 60e3) {
    const mid = Math.floor((from + to) / 2);
    return [...(await searchAll(obj, filters, properties, from, mid, depth + 1)), ...(await searchAll(obj, filters, properties, mid, to, depth + 1))];
  }
  const out = []; let after;
  for (let i = 0; i < 120; i++) {
    const r = await hs("POST", `/crm/v3/objects/${obj}/search`, {
      filterGroups: group(from, to), sorts: [{ propertyName: "hs_timestamp", direction: "ASCENDING" }],
      properties, limit: 100, after,
    }, "search");
    out.push(...((r && r.results) || []));
    after = r && r.paging && r.paging.next && r.paging.next.after;
    if (!after) break;
  }
  if (out.length < total) console.log(`  !! HubSpot said ${total} ${obj} in a window but ${out.length} were read`);
  return out;
}

const IN_PROPS = ["hs_timestamp", "hs_email_subject", "hs_email_from_email", "hs_email_from_firstname", "hs_email_from_lastname",
  "hs_email_to_email", "hs_email_cc_email", "hubspot_owner_id", "hs_email_text", "hs_attachment_ids"];
const OUT_PROPS = ["hs_timestamp", "hs_email_subject", "hs_email_from_email", "hs_email_to_email", "hs_email_cc_email", "hs_email_bcc_email",
  "hubspot_owner_id", "hs_email_status", "hs_email_direction"];
const CALL_PROPS = ["hs_timestamp", "hs_call_disposition", "hs_call_duration", "hs_call_direction", "hs_call_status", "hubspot_owner_id", "hs_call_title"];

// client emails that arrived in the case managers' inboxes
const incoming = (ownerIds, from, to) => searchAll("emails", [
  { propertyName: "hs_email_direction", operator: "EQ", value: "INCOMING_EMAIL" },
  { propertyName: "hubspot_owner_id", operator: "IN", values: ownerIds },
], IN_PROPS, from, to);

// everything the case managers sent
const outgoing = (ownerIds, from, to) => searchAll("emails", [
  { propertyName: "hs_email_direction", operator: "EQ", value: "EMAIL" },
  { propertyName: "hubspot_owner_id", operator: "IN", values: ownerIds },
], OUT_PROPS, from, to);

// associations, many at once. HubSpot's batch size for this has changed over time, so it
// starts big and halves on refusal rather than assuming.
let assocBatch = 1000;
async function links(fromObj, toObj, ids) {
  const map = new Map();
  const list = [...new Set(ids.map(String))];
  for (let i = 0; i < list.length;) {
    const chunk = list.slice(i, i + assocBatch);
    try {
      const r = await hs("POST", `/crm/v4/associations/${fromObj}/${toObj}/batch/read`, { inputs: chunk.map((id) => ({ id })) });
      for (const row of (r && r.results) || []) map.set(String(row.from && row.from.id), [...new Set((row.to || []).map((t) => String(t.toObjectId)))]);
      i += chunk.length;
    } catch (e) {
      if (e.status === 400 && assocBatch > 100) { assocBatch = Math.max(100, Math.floor(assocBatch / 2)); continue; }
      throw e;
    }
  }
  return map;
}

async function batchRead(obj, ids, properties) {
  const map = new Map();
  const list = [...new Set(ids.map(String))];
  for (let i = 0; i < list.length; i += 100) {
    const r = await hs("POST", `/crm/v3/objects/${obj}/batch/read`, { properties, inputs: list.slice(i, i + 100).map((id) => ({ id })) });
    for (const o of (r && r.results) || []) map.set(String(o.id), o.properties || {});
  }
  return map;
}

// One search per client: everything on their contact or any of their deals since `since`.
// Case managers log most calls on the deal, so the deal has to be searched too.
async function onClient(obj, contactId, dealIds, extra, properties, since) {
  const anchors = [...(contactId ? [["contact", contactId]] : []), ...dealIds.map((d) => ["deal", d])];
  const out = new Map();
  for (let i = 0; i < anchors.length; i += 5) {           // HubSpot allows 5 groups a search
    const filterGroups = anchors.slice(i, i + 5).map(([type, id]) => ({ filters: [
      { propertyName: `associations.${type}`, operator: "EQ", value: String(id) },
      { propertyName: "hs_timestamp", operator: "GTE", value: String(since) },
      ...extra] }));
    let after;
    for (let p = 0; p < 10; p++) {
      const r = await hs("POST", `/crm/v3/objects/${obj}/search`, {
        filterGroups, properties, sorts: [{ propertyName: "hs_timestamp", direction: "ASCENDING" }], limit: 100, after }, "search");
      for (const x of (r && r.results) || []) out.set(String(x.id), x);
      after = r && r.paging && r.paging.next && r.paging.next.after;
      if (!after) break;
    }
  }
  return [...out.values()];
}
const clientEmails = (contactId, dealIds, since) =>
  onClient("emails", contactId, dealIds, [{ propertyName: "hs_email_direction", operator: "EQ", value: "EMAIL" }], OUT_PROPS, since);
const clientCalls = (contactId, dealIds, since) => onClient("calls", contactId, dealIds, [], CALL_PROPS, since);

async function owners() {
  const map = {}; let after;
  for (let i = 0; i < 20; i++) {
    const r = await hs("GET", `/crm/v3/owners?limit=500${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    for (const o of (r && r.results) || []) map[String(o.id)] = { name: `${o.firstName || ""} ${o.lastName || ""}`.trim() || o.email || String(o.id), email: String(o.email || "").toLowerCase() };
    after = r && r.paging && r.paging.next && r.paging.next.after;
    if (!after) break;
  }
  return map;
}

// call outcome names ("Connected", "No answer", …) — a nicety for the sheet
async function dispositions() {
  try {
    const r = await hs("GET", "/calling/v1/dispositions");
    return Object.fromEntries((Array.isArray(r) ? r : []).map((d) => [String(d.id), d.label]));
  } catch { return {}; }
}

const contactLink = (id) => `https://app.hubspot.com/contacts/${SETTINGS.PORTAL_ID}/record/0-1/${id}`;
const dealLink = (id) => `https://app.hubspot.com/contacts/${SETTINGS.PORTAL_ID}/record/0-3/${id}`;

module.exports = { hs, searchAll, incoming, outgoing, links, batchRead, clientEmails, clientCalls, owners, dispositions, contactLink, dealLink, stats };

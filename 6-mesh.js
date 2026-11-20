// 6-mesh.js — WhatsApp, read from Mesh. Nothing in Mesh is ever sent, marked read or changed.
//
// Mesh (mesh.hof-global.com) is HOF's own tool with the WhatsApp Business API behind it.
// Every case manager's WhatsApp number and the shared HOF lines feed into it. Before a
// client email is called unanswered, Mesh is checked for a WhatsApp message from HOF to that
// client after they wrote: a text, a voice note or a file. Voice notes are not listened to;
// one sent in that time means the conversation happened.
//
// The client is found by every phone number on their HubSpot contact. Only when no number
// finds them is their HubSpot name tried, and only if exactly one Mesh contact has exactly
// that name. A WhatsApp check can only ever clear an email: nothing found in Mesh is ever
// held against anyone.
const { parsePhoneNumberFromString } = require("libphonenumber-js/max");
const { SETTINGS } = require("./config");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = { on: false, why: "", header: "", headers: {}, requests: 0, errors: 0, clients: 0, byNumber: 0, byName: 0, notFound: 0, nameClash: 0, replies: 0 };
let next = 0;
async function gate() {
  const now = Date.now(); const at = Math.max(now, next);
  next = at + 1000 / (SETTINGS.MESH_RPS || 4);
  if (at > now) await sleep(at - now);
}

// ---------------------------------------------------------------- phone numbers
// "+971 50 123 4567", "00971501234567", "971501234567", "0501234567" -> the same number.
const EXT = /\s*(?:ext\.?|extension|x)\s*\d+\s*$/i;
const SPLIT = /\s*(?:\/|,|;|\||\n|\bor\b|\band\b)\s*/i;
function tryParse(text, country) { try { return parsePhoneNumberFromString(text, country) || null; } catch { return null; } }
function pack(p, digits, forced) {
  const cc = p.countryCallingCode, nsn = p.nationalNumber;
  return { e164: p.number, nsn, local: !(forced || digits === cc + nsn || digits === cc + "0" + nsn) };
}
// local = saved with no country code, so the same digits could be any country's number
function readNumber(raw) {
  const s = String(raw ?? "").trim().replace(EXT, "");
  let d = s.replace(/\D/g, "");
  if (d.length < 6) return null;
  if (/^\+/.test(s) || d.startsWith("00")) {
    if (!/^\+/.test(s)) d = d.slice(2);
    const p = tryParse("+" + d);
    return p && p.isPossible() ? pack(p, d, true) : null;
  }
  const loc = tryParse(d, SETTINGS.DEFAULT_COUNTRY || "AE");
  const intl = d.length >= 10 ? tryParse("+" + d) : null;
  const ok = (p) => p && p.isPossible() && p;
  const pick = (d.startsWith("0") && ok(loc)) || (loc && loc.isValid() && loc) || (intl && intl.isValid() && intl) ||
    (d.length >= 11 && !d.startsWith("0") ? ok(intl) || ok(loc) : ok(loc) || ok(intl)) || null;
  return pick ? pack(pick, d, false) : { e164: null, nsn: d.replace(/^0+/, ""), local: true };
}
// every number on a HubSpot contact ("+971… / +92…" is two numbers)
function numbersOf(props = {}) {
  const out = new Map();
  for (const f of ["phone", "mobilephone", "mobile_number", "hs_whatsapp_phone_number"]) {
    for (const part of String(props[f] || "").split(SPLIT)) {
      const r = readNumber(part);
      if (r) out.set(r.e164 || `local:${r.nsn}`, r);
    }
  }
  return [...out.values()];
}
// is the Mesh contact's number (always +international) one of the client's numbers?
function sameNumber(meshE164, n) {
  const m = readNumber(meshE164);
  if (!m || !m.e164) return false;
  return m.e164 === n.e164 || (n.local && m.nsn === n.nsn);
}
const normName = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- talking to Mesh
async function get(path, params = {}, attempt = 0) {
  await gate();
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
  state.requests++;
  let res;
  try {
    res = await fetch(`${String(SETTINGS.MESH_URL).replace(/\/+$/, "")}${path}${qs ? `?${qs}` : ""}`, { headers: { Accept: "application/json", ...state.headers } });
  } catch (e) {
    if (attempt < 4) { await sleep(1500 * (attempt + 1)); return get(path, params, attempt + 1); }
    throw new Error(`could not reach Mesh: ${e.message}`);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(Math.min(20000, 1500 * 2 ** attempt)); return get(path, params, attempt + 1); }
  const text = await res.text();
  if (!res.ok) { const e = new Error(`Mesh ${path} -> ${res.status}`); e.status = res.status; throw e; }
  if (text.trim().startsWith("<")) throw new Error("Mesh answered with a web page instead of data - check MESH_URL");
  return text ? JSON.parse(text) : {};
}

// Is the key accepted, and in which header? Asked once per run. The dev team's other API
// (Petition Studio) takes "x-api-key", so that is tried first, then a Bearer token.
const STYLES = [["x-api-key", (k) => ({ "x-api-key": k })], ["Bearer token", (k) => ({ Authorization: `Bearer ${k}` })]];
async function start() {
  state.on = false;
  if (!SETTINGS.USE_MESH) { state.why = "switched off in config.js (USE_MESH)"; return false; }
  const key = String(process.env.MESH_API_KEY || "").trim();
  if (!key) { state.why = "the MESH_API_KEY secret is not set"; return false; }
  for (const [name, make] of STYLES) {
    state.headers = make(key);
    try {
      await get("/api/conversations", { brandId: SETTINGS.MESH_BRAND_ID, platforms: "whatsapp", status: "all", assignee: "all", limit: 1 });
      state.on = true; state.header = name; state.why = "";
      return true;
    } catch (e) {
      if (e.status === 401 || e.status === 403) continue;
      state.why = `Mesh could not be reached (${e.message})`;
      return false;
    }
  }
  state.headers = {};
  state.why = "Mesh refused the MESH_API_KEY (sent as x-api-key and as a Bearer token). Ask the dev team which header the key goes in, or whether it can read WhatsApp";
  return false;
}

// ---------------------------------------------------------------- finding the client
async function conversations(params, pages = 4) {
  const out = []; let cursor;
  for (let i = 0; i < pages; i++) {
    const r = await get("/api/conversations", { brandId: SETTINGS.MESH_BRAND_ID, platforms: "whatsapp", status: "all", assignee: "all", limit: 25, ...params, cursor });
    out.push(...((r && r.items) || []));
    cursor = r && r.nextCursor;
    if (!cursor) break;
  }
  return out;
}

// client: { numbers: [readNumber…], name } -> { convs, how: "number" | "name" | "" , clash }
async function findClient(client) {
  const convs = new Map(), people = new Set();
  for (const n of client.numbers || []) {
    // a number saved with no country code is searched by its local digits, so it is found
    // under whichever country code Mesh has it
    const q = n.local || !n.e164 ? n.nsn : n.e164.replace(/\D/g, "");
    if (!q || q.length < 7) continue;
    for (const c of await conversations({ q })) {
      if (c && c.id && c.contact && sameNumber(c.contact.phoneE164, n)) { convs.set(c.id, c); people.add(c.contact.id); }
    }
  }
  let how = convs.size ? "number" : "", clash = false;
  const name = normName(client.name);
  if (!convs.size && name.split(" ").length >= 2) {
    const hits = (await conversations({ q: String(client.name).replace(/\s+/g, " ").trim() })).filter((c) => c && c.contact && normName(c.contact.displayName) === name);
    const ids = new Set(hits.map((c) => c.contact.id));
    if (ids.size === 1) { hits.forEach((c) => convs.set(c.id, c)); people.add([...ids][0]); how = "name"; }
    else if (ids.size > 1) clash = true;
  }
  // every conversation those people have, on any HOF line
  for (const id of people) for (const c of await conversations({ contactId: id, q: undefined }, 2)) if (c && c.id) convs.set(c.id, c);
  return { convs: [...convs.values()], how, clash };
}

// ---------------------------------------------------------------- what HOF sent
const cut = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
// A message from HOF that counts as an answer: sent out to the client by a person, as a real
// WhatsApp message (not a private note, not a bot or a workflow, not one that failed).
function replyOf(m) {
  if (!m || m.direction !== "outbound") return null;
  if (m.kind && m.kind !== "message") return null;
  if (m.isPrivate || m.deleted || m.status === "failed" || m.error) return null;
  const who = m.sender || {};
  if (/bot|system|workflow|automation|campaign|broadcast|\bai\b/i.test(String(who.type || ""))) return null;
  const at = Date.parse(m.sentAt || m.createdAt || "");
  if (!at) return null;
  const types = [...(m.parts || []).map((p) => p && p.type), ...(m.attachments || []).map((a) => a && a.kind)].map((t) => String(t || "").toLowerCase());
  const kind = types.some((t) => /audio|voice|ptt/.test(t)) ? "voice note"
    : String(m.text || "").trim() ? "message"
      : types.some((t) => /image|sticker/.test(t)) ? "image"
        : types.some((t) => /video/.test(t)) ? "video"
          : types.some((t) => t && t !== "text") ? "file" : "message";
  const user = who.user || {};
  return { at, by: String(user.name || who.name || who.senderName || "").trim(), email: String(user.email || "").toLowerCase(), kind,
    preview: kind === "message" ? cut(m.text, 200) : "" };
}

// every message HOF sent in one conversation between `from` and `to`, newest pages first
async function sentIn(conv, from, to) {
  if (conv.lastMessageAt && Date.parse(conv.lastMessageAt) < from) return [];
  const out = []; let before;
  for (let i = 0; i < 15; i++) {
    const r = await get(`/api/conversations/${encodeURIComponent(conv.id)}/messages`, { limit: 40, before });
    const items = (r && r.items) || [];
    for (const m of items) {
      const x = replyOf(m);
      if (x && x.at >= from && x.at <= to) out.push({ ...x, line: String((conv.channel && conv.channel.name) || "").trim() });
    }
    if (!r || !r.hasMore || !items.length) break;
    const oldest = items.reduce((a, m) => (Date.parse(m.sentAt || "") < Date.parse(a.sentAt || "") ? m : a), items[0]);
    if (Date.parse(oldest.sentAt || "") < from) break;
    before = oldest.id;
  }
  return out;
}

// What HOF sent this client on WhatsApp between `from` and `to`, oldest first.
// -> { found, how, clash, replies } ; null when Mesh could not be checked for them
async function repliesTo(client, from, to) {
  if (!state.on) return null;
  state.clients++;
  try {
    const { convs, how, clash } = await findClient(client);
    if (how === "number") state.byNumber++;
    else if (how === "name") state.byName++;
    else state.notFound++;
    if (clash) state.nameClash++;
    const replies = [];
    for (const c of convs) replies.push(...(await sentIn(c, from, to)));
    replies.sort((a, b) => a.at - b.at);
    state.replies += replies.length;
    return { found: convs.length > 0, how, clash, replies };
  } catch (e) {
    state.errors++;
    if (e.status === 401 || e.status === 403) { state.on = false; state.why = "Mesh stopped accepting the key part-way through the run"; }
    return null;
  }
}

module.exports = { start, repliesTo, numbersOf, readNumber, sameNumber, replyOf, findClient, state };

// 6-mesh.js — WhatsApp, read through Mesh's Compliance Read API. Read-only: the API cannot
// send, change or delete anything, and nothing here tries to.
//
// Mesh (mesh.hof-global.com) is HOF's own tool with the WhatsApp Business API behind it. Its
// Compliance Read API gives read-only access to every chat on one WhatsApp number; the key
// decides which number (today, the HOF Migration team number). Before a client email is
// called unanswered, those chats are checked for a WhatsApp from HOF to the client after they
// wrote: a text, a voice note or a file. Voice notes are not listened to; one sent in that
// time means the conversation happened.
//
// Once a run, for each key:
//   GET /channel                       is the key accepted, and which number is it
//   GET /conversations?updatedSince=   every chat that changed since the oldest email being
//                                      checked: who each chat is with
//   GET /messages?since=               every message on the number since then; only HOF's
//                                      own messages are kept
// Each client is then matched here, with no more requests: by every phone number on their
// HubSpot contact, and only when no number matches, by their HubSpot name — if exactly one
// WhatsApp contact on that number has exactly that name. A WhatsApp check can only ever clear
// an email: nothing found (or not found) in Mesh is ever held against anyone.
const { parsePhoneNumberFromString } = require("libphonenumber-js/max");
const { SETTINGS } = require("./config");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// how long to wait before asking again (the self-test shortens these)
const timing = { tooMany: 61000, busy: 5000, network: 2000 };

const fresh = () => ({
  on: false, why: "", header: "", lines: [], problems: [], since: 0,
  chats: 0, messages: 0, hofMessages: 0, requests: 0, errors: 0,
  clients: 0, byNumber: 0, byName: 0, notFound: 0, nameClash: 0, replies: 0,
});
const state = fresh();
let keys = [];      // [{ headers, line }] for every key Mesh accepted — never logged or shown
let idx = null;     // what was read: one entry per WhatsApp number

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
// is the WhatsApp contact's number (always +international) one of the client's numbers?
function sameNumber(meshE164, n) {
  const m = readNumber(meshE164);
  if (!m || !m.e164) return false;
  return m.e164 === n.e164 || (n.local && m.nsn === n.nsn);
}
const normName = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- talking to Mesh
let next = 0;
async function gate() {
  const now = Date.now(); const at = Math.max(now, next);
  next = at + 1000 / (SETTINGS.MESH_RPS || 1.5);
  if (at > now) await sleep(at - now);
}
const base = () => String(SETTINGS.MESH_API || "https://mesh.hof-global.com/api/compliance-feed/v1").replace(/\/+$/, "");
const problem = (status, why) => { const e = new Error(why); e.status = status; return e; };

// what each answer means, in words the report can show
function explain(status, said, path) {
  const m = said ? ` — Mesh said "${String(said).replace(/\s+/g, " ").slice(0, 120)}"` : "";
  switch (status) {
    case 401: return `Mesh refused the MESH_API_KEY (401: the key is missing or wrong${m})`;
    case 404: return path === "/channel" ? `Mesh's Compliance Read API was not found at ${base()} (404). Check MESH_API in config.js` : `Mesh could not find ${path} (404${m})`;
    case 422: return `Mesh did not accept a request for ${path} (422${m})`;
    case 429: return "Mesh kept answering that too many requests were made (429)";
    case 503: return "Mesh's Compliance Read API is switched off or being set up (503). Contact the Mesh team";
    default: return `Mesh answered ${status} to ${path}${m}`;
  }
}

async function get(headers, path, params = {}, attempt = 0) {
  await gate();
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
  state.requests++;
  let res;
  try {
    res = await fetch(`${base()}${path}${qs ? `?${qs}` : ""}`, { headers: { Accept: "application/json", ...headers } });
  } catch (e) {
    if (attempt < 4) { await sleep(timing.network * (attempt + 1)); return get(headers, path, params, attempt + 1); }
    throw problem(0, `Mesh could not be reached (${e.message})`);
  }
  // more than 120 requests in a minute: wait a minute, then carry on
  if (res.status === 429 && attempt < 4) { await sleep(timing.tooMany); return get(headers, path, params, attempt + 1); }
  // a restart or a hiccup: a few more tries before giving up
  if (res.status >= 500 && attempt < 3) { await sleep(timing.busy * (attempt + 1)); return get(headers, path, params, attempt + 1); }
  const text = await res.text();
  if (!res.ok) {
    let said = "";
    try { said = String(JSON.parse(text).message || ""); } catch { /* not JSON */ }
    throw problem(res.status, explain(res.status, said, path));
  }
  if (text.trim().startsWith("<")) throw problem(0, "Mesh answered with a web page instead of data. Check MESH_API in config.js");
  return text ? JSON.parse(text) : {};
}

// every item of a list, page by page ({ data, nextCursor }). `fn` returning false stops early.
// A list too long to finish is an error, never quietly cut short.
async function each(headers, path, params, fn) {
  const max = SETTINGS.MESH_MAX_PAGES || 1500;
  let cursor;
  for (let i = 0; i < max; i++) {
    const r = await get(headers, path, { ...params, cursor });
    for (const x of (r && Array.isArray(r.data) ? r.data : [])) if (fn(x) === false) return;
    cursor = r && r.nextCursor;
    if (!cursor) return;
  }
  throw problem(0, `Mesh had more than ${max} pages of ${path.slice(1)}, too many to read in one run`);
}

// The secret holds one key, or several (one per WhatsApp number), one per line. A "Bearer"
// or quotes pasted along with a key are ignored.
function readKeys(raw) {
  return [...new Set(String(raw || "").split(/[\s,;]+/)
    .map((k) => k.trim().replace(/^["'`]+|["'`]+$/g, ""))
    .filter((k) => k && !/^(bearer|authorization:?|x-api-key:?)$/i.test(k)))];
}

// Is each key accepted, and which number is it for? Asked once per run. The API takes the key
// as a Bearer token or as X-Api-Key; the Bearer token is tried first.
const STYLES = [["Bearer token", (k) => ({ Authorization: `Bearer ${k}` })], ["X-Api-Key", (k) => ({ "X-Api-Key": k })]];
async function start() {
  Object.assign(state, fresh());
  keys = []; idx = null;
  if (!SETTINGS.USE_MESH) { state.why = "switched off in config.js (USE_MESH)"; return false; }
  const list = readKeys(process.env.MESH_API_KEY);
  if (!list.length) { state.why = "the MESH_API_KEY secret is not set"; return false; }
  const refused = [];
  for (const [i, key] of list.entries()) {
    let why = "", status = 0;
    for (const [name, make] of STYLES) {
      try {
        const got = (await get(make(key), "/channel")) || {};
        const ch = got.data && !Array.isArray(got.data) ? got.data : got;   // as documented, or wrapped in { data }
        const line = { id: String(ch.id || `key${i + 1}`), name: String(ch.name || "").trim() || "WhatsApp", phone: String(ch.phoneNumber || "").trim(), brand: String(ch.brand || "").trim() };
        if (!keys.some((k) => k.line.id === line.id)) keys.push({ headers: make(key), line });   // the same number twice is read once
        if (!state.header) state.header = name;
        why = ""; break;
      } catch (e) {
        why = e.message; status = e.status;
        if (e.status !== 401) break;          // only a refusal is worth the other header
      }
    }
    if (why && status === 401) why = "Mesh refused the MESH_API_KEY (401: the key is missing or wrong; it was sent as a Bearer token and as X-Api-Key). Check the GitHub secret holds the key for the Compliance Read API, with nothing else in it";
    if (why) refused.push(list.length > 1 ? `Key ${i + 1} of ${list.length}: ${why}` : why);
  }
  state.lines = keys.map((k) => k.line);
  if (!keys.length) { state.why = refused.join(". ") || "no key was accepted"; return false; }
  state.problems = refused;               // some keys worked and some did not
  state.on = true;
  return true;
}

// ---------------------------------------------------------------- reading the number(s)
const add = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };

// Read every chat and every HOF message since `since`, on every number. Once a run.
async function load(since) {
  if (!state.on) return false;
  if (idx && state.since <= since) return true;
  const iso = new Date(since).toISOString();
  const read = [], failed = [];
  let chats = 0, messages = 0, hof = 0;
  for (const k of keys) {
    const li = { line: k.line, convs: new Map(), byE164: new Map(), byNsn: new Map(), byName: new Map(), ofPerson: new Map(), replies: new Map() };
    const chat = (c) => {
      if (!c || !c.id || li.convs.has(String(c.id))) return;
      const id = String(c.id), contact = c.contact || {};
      const person = String(contact.id || `chat:${id}`);
      li.convs.set(id, person);
      add(li.ofPerson, person, id);
      const n = readNumber(contact.phone);
      if (n && n.e164) add(li.byE164, n.e164, id);
      if (n && n.nsn) add(li.byNsn, n.nsn, id);
      const nm = normName(contact.name);
      if (nm) { if (!li.byName.has(nm)) li.byName.set(nm, new Set()); li.byName.get(nm).add(person); }
    };
    try {
      let n2 = 0, n3 = 0;
      await each(k.headers, "/conversations", { updatedSince: iso, limit: 200 }, chat);
      const orphans = new Set();
      await each(k.headers, "/messages", { since: iso, limit: 200 }, (m) => {
        n2++;
        const r = replyOf(m);
        if (!r || !m.conversationId) return;
        n3++;
        const id = String(m.conversationId);
        add(li.replies, id, { ...r, line: k.line.name });
        if (!li.convs.has(id)) orphans.add(id);
      });
      // a HOF message in a chat that was not listed as changed: find that chat in the full list
      if (orphans.size) await each(k.headers, "/conversations", { limit: 200 }, (c) => { if (c && orphans.delete(String(c.id))) chat(c); return orphans.size > 0; });
      read.push(li);
      chats += li.convs.size; messages += n2; hof += n3;
    } catch (e) {
      const why = e.status === 401 ? "Mesh stopped accepting the key part-way through the run (401)" : e.message;
      failed.push(keys.length > 1 ? `${k.line.name}: ${why}` : why);
    }
  }
  state.problems = [...state.problems, ...failed];
  if (!read.length) {
    state.on = false; idx = null;
    state.why = failed.join(". ") || "nothing could be read";
    return false;
  }
  idx = read;
  state.lines = read.map((li) => li.line);
  Object.assign(state, { since, chats, messages, hofMessages: hof });
  return true;
}

// client: { numbers: [readNumber…], name } -> { hits: [[number, chatId]…], how: "number" | "name" | "", clash }
function findClient(client) {
  const hits = [], seen = new Set();
  const take = (i, ids) => { for (const id of ids || []) { const k = `${i}|${id}`; if (!seen.has(k)) { seen.add(k); hits.push([i, id]); } } };
  idx.forEach((li, i) => {
    for (const n of client.numbers || []) {
      if (n.e164) take(i, li.byE164.get(n.e164));
      // a number saved with no country code is found under whichever country code the chat has
      if (n.local && n.nsn) take(i, li.byNsn.get(n.nsn));
    }
  });
  if (hits.length) return { hits, how: "number", clash: false };
  const name = normName(client.name);
  let clash = false;
  if (name.split(" ").length >= 2) {
    idx.forEach((li, i) => {
      const people = li.byName.get(name);
      if (!people) return;
      if (people.size === 1) take(i, li.ofPerson.get([...people][0]));
      else clash = true;
    });
  }
  return { hits, how: hits.length ? "name" : "", clash: !hits.length && clash };
}

// ---------------------------------------------------------------- what HOF sent
const cut = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const people = () => (SETTINGS.MESH_PEOPLE_SENDERS || []).map((s) => String(s).trim().toLowerCase());

// A message from HOF that counts as an answer: a real WhatsApp message to the client, sent by a
// person, that reached WhatsApp. Not an internal note or an activity line, not a campaign, a
// bot, an automation or Mesh itself, and not one that failed, never left or was deleted.
// Typed on the team phone (WhatsApp Business app) counts: Mesh shows those as "system", so
// the senders that are people are listed in config.js (MESH_PEOPLE_SENDERS).
function replyOf(m) {
  if (!m || m.direction !== "outbound") return null;
  if (String(m.kind || "message") !== "message") return null;
  if (m.campaign) return null;
  if (m.deleted || m.error || /^(failed|pending)$/i.test(String(m.status || ""))) return null;
  const who = m.sender || {};
  const type = String(who.type || "").toLowerCase();
  const name = String(who.name || (who.user && who.user.name) || "").trim();
  let by;
  if (type === "user") by = name || String(who.email || "").trim() || "A HOF team member";
  else if (type === "system" && people().includes(name.toLowerCase())) by = name;
  else return null;
  const at = Date.parse(m.sentAt || m.createdAt || "");
  if (!at) return null;
  const parts = Array.isArray(m.parts) ? m.parts : [], files = Array.isArray(m.attachments) ? m.attachments : [];
  const ptypes = parts.map((p) => String((p && p.type) || "").toLowerCase());
  const all = [...ptypes, ...files.map((a) => String((a && (a.mimeType || a.kind)) || "").toLowerCase())];
  const text = String(m.text || "").trim() || parts.map((p) => (p && typeof p.text === "string" ? p.text : "")).join(" ").trim();
  const kind = all.some((t) => /audio|voice|ptt/.test(t)) ? "voice note"
    : text ? "message"
      : all.some((t) => /image|sticker/.test(t)) ? "image"
        : all.some((t) => /video/.test(t)) ? "video"
          : files.length || all.some((t) => /document|file|pdf/.test(t)) ? "file" : "message";
  const said = text || (ptypes.includes("template") ? "(a WhatsApp template)" : ptypes.includes("location") ? "(a location)" : "");
  return { at, by, email: String(who.email || (who.user && who.user.email) || "").toLowerCase(), kind, preview: kind === "message" ? cut(said, 200) : "" };
}

// What HOF sent this client on WhatsApp between `from` and `to`, oldest first.
// -> { found, how, clash, replies } ; null when WhatsApp could not be checked
async function repliesTo(client, from, to) {
  if (!state.on) return null;
  if ((!idx || from < state.since) && !(await load(from))) return null;
  state.clients++;
  const { hits, how, clash } = findClient(client);
  if (how === "number") state.byNumber++;
  else if (how === "name") state.byName++;
  else state.notFound++;
  if (clash) state.nameClash++;
  const replies = [];
  for (const [i, id] of hits) for (const r of idx[i].replies.get(id) || []) if (r.at >= from && r.at <= to) replies.push(r);
  replies.sort((a, b) => a.at - b.at);
  state.replies += replies.length;
  return { found: hits.length > 0, how, clash, replies };
}

module.exports = { start, load, repliesTo, numbersOf, readNumber, sameNumber, replyOf, readKeys, state, timing };

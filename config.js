// config.js — Case manager email replies, every day at 11am. SAFE TO EDIT.
//
// The rules are written out here in plain words, and repeated at the bottom of every
// report. If a rule is wrong, change it here — never quietly in the code.

const SETTINGS = {
  // ---- who ----
  // HubSpot owner id -> name. Ids are used, not names, so a renamed user cannot drop out.
  // "Anwar" is Anwar Saeed, the case manager. HubSpot also has Danish Anwar (98718071) and
  // Hassan Anwar (99565264) — swap the id below if you meant one of them.
  CASE_MANAGERS: {
    "362254136": "Brenda Murowanidzwa",
    "82943802": "Yamina Sadi",
    "86814673": "Ali Tariq",
    "87160491": "Anwar Saeed",
    "88038567": "Tamjeed Zahid",
    "475397717": "Thushara M S",
    "1844235827": "Rahima Nabili",
    "89930419": "Warda Badar",
    "93944662": "Umer Masaud",
    "93819566": "Hashim Tahir",
    "96187067": "Muhammad Zaryab",
    "97008108": "Maryam Chand",
    "100443134": "Muhammad Asad Mir",
    "100464860": "Fatou Toure",
  },

  // ---- THE RULE ----
  // A client email that needs a reply gets one within 24 hours. The clock does not run on
  // Saturday, Sunday or UAE public holidays — the same rule as the WhatsApp review:
  //   Monday 3pm    -> due Tuesday 3pm
  //   Thursday 3pm  -> due Friday 3pm
  //   Friday 3pm    -> due Monday 3pm
  //   Saturday      -> due end of Monday
  // Set FLAT_24_HOURS to true for a plain 24 hours, weekends and holidays included.
  REPLY_HOURS: 24,
  FLAT_24_HOURS: false,
  TZ_OFFSET_HOURS: 5,          // Pakistan time; no daylight saving
  WEEKEND_DAYS: [6, 0],        // Saturday and Sunday

  // UAE public holidays (the main office is in Dubai, so these are the only ones). These
  // are the PRIVATE-SECTOR dates as announced for 2026. Islamic holidays follow the moon
  // and can be moved, so only ever enter an ANNOUNCED date, never a predicted one.
  // ADD 2027 once announced — the report warns when a year has none listed.
  HOLIDAYS: [
    "2026-01-01",                              // New Year's Day
    "2026-03-19", "2026-03-20", "2026-03-21",  // Eid Al Fitr
    "2026-05-26",                              // Arafat Day
    "2026-05-27", "2026-05-28", "2026-05-29",  // Eid Al Adha
    "2026-06-15",                              // Hijri New Year (moved to the Monday)
    "2026-08-28",                              // Prophet's Birthday (moved to the Friday)
    "2026-12-02", "2026-12-03",                // UAE National Day
  ],

  // Approved leave. The clock KEEPS running — the client is still waiting — but rows for a
  // case manager on leave are marked, so you can see where cover was needed.
  LEAVE: {
    // "Warda Badar": ["2026-10-21", "2026-10-22"],
  },

  // ---- the report ----
  // Each morning's report covers the emails whose 24 hours ended between yesterday's cut-off
  // and today's, so every email is judged exactly once. Anything still unanswered keeps
  // reappearing under "Still unanswered" for STILL_OPEN_DAYS.
  REPORT_HOUR: 11,             // the cut-off, Pakistan time
  STILL_OPEN_DAYS: 14,
  ROWS_PER_SECTION: 40,        // rows shown per section in the email; every row is in the sheet
  REPORT_TO: "razaali@hofmigration.com",
  CC: [],                      // e.g. ["adnan@hofmigration.com"] — only after hofmigration.com is verified in Resend
  FROM_EMAIL: "onboarding@resend.dev",   // once verified, e.g. "compliance@hofmigration.com"
  SEND_EMAIL: String(process.env.SEND_EMAIL || "true").toLowerCase() !== "false",
  EMAIL_ON_QUIET_DAYS: false,  // weekends and holidays with nothing due send no email

  // ---- what counts as an answer ----
  // A reply is any email from anyone at HOF sent TO the client's address after they wrote.
  // If there was no reply within the 24 hours, a CONNECTED call on the client's contact or
  // deal inside those 24 hours puts the email in its own section instead of flagging it.
  // Case managers mostly log calls on the deal, so both are checked.
  CONNECTED_DISPOSITION: "f240bbac-87c9-4f6e-bf70-924b57d47db7",   // HubSpot's "Connected"
  CONNECTED_MIN_SECONDS: 60,   // a call this long counts as connected, unless its outcome says otherwise
  NOT_CONNECTED_DISPOSITIONS: [
    "73a0d17f-1163-4015-bdd5-ec830791da20",  // No answer
    "9d9162e7-6cf3-4944-bf63-4dff82258764",  // Busy
    "17b47fee-58de-441e-a44c-c6300d46f273",  // Wrong number
    "b2cf5968-551e-4856-9783-52b3da59a7d0",  // Left voicemail
    "a4c4c377-d246-4b32-a13b-75a56a4cd0ff",  // Left live message
  ],

  // ---- which emails need a reply ----
  // Not counted: anything from HOF staff, automatic messages, thank-yous, and emails that
  // only send documents or news with nothing asked (those need an acknowledgement, not a
  // reply). Counted: questions, requests, chasers, complaints, call requests, and long
  // messages with no clear question (counted to be safe). Every email that was NOT counted
  // is listed in the sheet with the reason, so the rules can be checked.
  INTERNAL_DOMAINS: ["hofmigration.com", "hof-global.com"],
  AUTOMATED_SENDERS: /(^|[._-])(no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer-daemon|postmaster|bounces?|alerts?|newsletters?|calendar-notification|drive-shares|auto-?confirm|system)([._-]|@)/i,
  AUTOMATED_DOMAINS: ["docusign.net", "docusign.com", "zoom.us", "calendly.com", "hubspot.com", "hs-email.com",
    "linkedin.com", "facebookmail.com", "carnegieevaluations.com", "uscis.dhs.gov", "fireflies.ai"],
  AUTOMATED_SUBJECTS: /^\s*(automatic reply|auto-?reply|autoreply|out of (the )?office|ooo\b|undeliverable|undelivered|delivery status notification|mail delivery (failed|subsystem)|returned mail|read:|accepted:|declined:|tentative:|tentatively accepted|invitation:|updated invitation|canceled event|cancelled event|new event:)/i,
  COUNT_DOCUMENTS_ONLY: false, // true = documents sent with nothing asked also need a reply in 24 hours
  LONG_MESSAGE_CHARS: 500,     // a message this long with no clear question is counted, to be safe
  ACK_MAX_CHARS: 200,          // a thank-you longer than this is read as a real message

  // ---- HubSpot ----
  PORTAL_ID: "23735726",
  SEARCH_RPS: 4,               // HubSpot allows 5 searches a second for the whole account
  API_RPS: 8,
  OUT_DIR: "out",
};

module.exports = { SETTINGS };

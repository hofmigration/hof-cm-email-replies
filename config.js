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
  // and today's, so every email is flagged once, on the day its 24 hours end. If the client
  // writes again and that email also goes unanswered for 24 hours, it is flagged again, as
  // High (they are chasing).
  REPORT_HOUR: 11,             // the cut-off, Pakistan time
  LOOK_BACK_DAYS: 17,          // how far back emails are read, so a client's earlier emails and HOF's replies are known
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
  // Case managers mostly log calls on the deal, so both are checked. A WhatsApp reply in
  // those 24 hours does the same (see "WhatsApp, read from Mesh" below).
  CONNECTED_DISPOSITION: "f240bbac-87c9-4f6e-bf70-924b57d47db7",   // HubSpot's "Connected"
  CONNECTED_MIN_SECONDS: 60,   // a call this long counts as connected, unless its outcome says otherwise
  NOT_CONNECTED_DISPOSITIONS: [
    "73a0d17f-1163-4015-bdd5-ec830791da20",  // No answer
    "9d9162e7-6cf3-4944-bf63-4dff82258764",  // Busy
    "17b47fee-58de-441e-a44c-c6300d46f273",  // Wrong number
    "b2cf5968-551e-4856-9783-52b3da59a7d0",  // Left voicemail
    "a4c4c377-d246-4b32-a13b-75a56a4cd0ff",  // Left live message
  ],

  // ---- WhatsApp, read from Mesh ----
  // Mesh (mesh.hof-global.com) is HOF's own tool with the WhatsApp Business API behind it.
  // Its Compliance Read API gives read-only access to every chat on one WhatsApp number - the
  // key decides which number (today: the HOF Migration team number). It cannot send, change
  // or delete anything.
  // When no email went back within the 24 hours and there was no connected call, WhatsApp is
  // checked too: a message from anyone at HOF to that client inside the same 24 hours - a
  // text, a voice note or a file - puts the email in its own section instead of flagging it,
  // the same way a connected call does. Voice notes are not listened to: one sent in that time
  // means the conversation happened. Internal notes, campaigns, bots, automations, Mesh's own
  // messages, and messages that failed or never left do not count.
  // The client is found by every phone number on their HubSpot contact. Only if no number
  // matches is their name tried - exactly as it is in HubSpot - and only when exactly one
  // WhatsApp contact on that number has that name.
  // The key goes in the GitHub secret MESH_API_KEY. If the Mesh team gives a key for another
  // number too (a case manager's own number, say), put both keys in that secret, one per line.
  USE_MESH: true,
  MESH_API: "https://mesh.hof-global.com/api/compliance-feed/v1",
  MESH_RPS: 1.5,               // requests a second; Mesh allows 120 a minute
  // Mesh marks these senders as "system", but a person typed the message, so they count.
  // Take "Team (outside Mesh)" out if those turn out to be automatic messages.
  MESH_PEOPLE_SENDERS: ["WhatsApp Business app (phone)", "Team (outside Mesh)"],
  DEFAULT_COUNTRY: "AE",       // a number saved with no country code is read as a UAE number

  // ---- which emails need a reply, and their priority ----
  // High: needs a reply, and is a complaint or refund, a chaser (the client wrote again
  //   because nobody replied), a problem or mistake pointed out, or urgent or tied to a date
  //   (a deadline, an appointment, biometrics, an interview, a visa or passport expiring).
  // Medium: any other question, request or call request.
  // Both must be answered within REPLY_HOURS; High is listed first, in red.
  // Low: nothing to answer - anything from HOF staff, automatic messages, thank-yous, emails
  //   that only send documents or information with nothing asked (long ones too). Low emails
  //   are not counted and not shown in the email; each is listed in the sheet's
  //   "All emails received" tab with the reason, so the rules can be checked.
  INTERNAL_DOMAINS: ["hofmigration.com", "hof-global.com"],
  AUTOMATED_SENDERS: /(^|[._-])(no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer-daemon|postmaster|bounces?|alerts?|newsletters?|calendar-notification|drive-shares|auto-?confirm|system)([._-]|@)/i,
  AUTOMATED_DOMAINS: ["docusign.net", "docusign.com", "zoom.us", "calendly.com", "hubspot.com", "hs-email.com",
    "linkedin.com", "facebookmail.com", "carnegieevaluations.com", "uscis.dhs.gov", "fireflies.ai"],
  AUTOMATED_SUBJECTS: /^\s*(automatic reply|auto-?reply|autoreply|out of (the )?office|ooo\b|undeliverable|undelivered|delivery status notification|mail delivery (failed|subsystem)|returned mail|read:|accepted:|declined:|tentative:|tentatively accepted|invitation:|updated invitation|canceled event|cancelled event|new event:)/i,
  COUNT_DOCUMENTS_ONLY: false, // true = documents sent with nothing asked also need a reply in 24 hours
  COUNT_LONG_MESSAGES: false,  // true = a long message with no question or request is Medium instead of Low
  LONG_MESSAGE_CHARS: 500,     // how long "a long message" is
  ACK_MAX_CHARS: 200,          // a thank-you longer than this is read as a real message

  // ---- HubSpot ----
  PORTAL_ID: "23735726",
  SEARCH_RPS: 4,               // HubSpot allows 5 searches a second for the whole account
  API_RPS: 8,
  OUT_DIR: "out",
};

module.exports = { SETTINGS };

# Case manager email replies

Every morning at **11:00 Pakistan time** you get one email: every client email to the
14 case managers whose **24 hours ran out since yesterday at 11:00**, and what happened to it.

Each client email that needs a reply has a **priority** — High or Medium. Low ones (nothing
to answer) are left out of the email.

- **High priority — no reply** · complaints and refunds, chasers, mistakes pointed out, urgent or dated requests: past 24 hours with no email, no connected call and no WhatsApp from HOF
- **Medium priority — no reply** · any other question or request, same rule
- **Replied late** · answered, but after the 24 hours (High first)
- **No email reply in 24 hours, but a connected call** · its own section, as asked
- **No email reply in 24 hours, but answered on WhatsApp** · its own section, with what was sent (read from Mesh)
- **Due before tomorrow's report** · not late yet, nobody has replied — a heads-up (High first)
- **By case manager** · one line each, with how many High were flagged and an on-time %

Each email is flagged **once**, on the day its 24 hours end. If the client writes again and that
email also goes unanswered for 24 hours, it is flagged again — as High, marked *Wrote again*.

Every row is in the attached Excel sheet, with links to the client's deal and contact.
Read-only — nothing in HubSpot or Mesh is changed.

---

## Setting it up

1. New **private** repo, e.g. `hof-cm-email-replies`.
2. Upload to the root: `config.js`, `0-hubspot.js`, `1-clock.js`, `2-classify.js`,
   `3-match.js`, `4-workbook.js`, `5-email.js`, `6-mesh.js`, `report.js`, `selftest.js`, `package.json`.
3. **Add file → Create new file**, name it `.github/workflows/cm-email-replies.yml`
   (typing the slashes makes the folders), and paste in `cm-email-replies.yml`.
4. **Settings → Secrets and variables → Actions** — the same two secrets your other agents use, plus the Mesh key:

| Secret | |
|---|---|
| `HUBSPOT_TOKEN` | the HOF private app token (it needs to read emails — the one the email-scan and claims agents use already does) |
| `RESEND_KEY` | the key your other reports send with |
| `MESH_API_KEY` | the key for Mesh's **Compliance Read API**, from the Mesh team. Paste it straight into the secret, never into a chat, a file or an email. Without it the report still goes out, but WhatsApp is not checked and the email says so. If the Mesh team gives keys for more WhatsApp numbers, put them all in this one secret, one per line. |

## First run

**Actions → CM email replies → Run workflow → Run.** It takes 3–5 minutes. After that it
runs by itself every day at 11:00. To re-create an earlier morning's report, type that date
(`2026-10-15`) in **as_of**.

On Saturdays, Sundays and UAE holidays nothing falls due (the clock is paused), so no email
comes unless something did.

---

## The rules

**24 hours, not counting Saturday, Sunday or UAE public holidays** — the same rule as the
WhatsApp review. Friday 3pm is due Monday 3pm; Monday 3pm is due Tuesday 3pm. Want a plain
24 hours with weekends? Set `FLAT_24_HOURS: true` in `config.js`.

**Which emails need a reply, and their priority.** Only the client's own new words are read —
the quoted thread underneath, signatures and "Sent from my iPhone" are cut off first.

| High — needs a reply, listed first | Medium — needs a reply | Low — nothing to answer, not counted |
|---|---|---|
| a complaint or refund — "not happy", "refund", "cancel my case" | a question (with or without a "?") | anything from HOF staff |
| a chaser — "any update?", "it's been 20 days", "still waiting for the draft", or writing again before an answer | a request — please advise / confirm / check / send | automatic messages — auto-replies, Gmail reactions, no-reply senders |
| a problem or mistake pointed out | a request for a call or meeting | thank-yous and acknowledgements — "noted", "kindly noted", "thank you for the clarification", "thanks, keep me posted" |
| urgent or tied to a date — "urgent", "asap", a deadline, an appointment, biometrics, an interview, a visa or passport expiring, "by Monday" | | documents or information sent with nothing asked, long messages included |

High and Medium have the same 24 hours; High is simply listed first, in red. Urgent or dated
words only raise an email that already needs a reply — they don't make one need a reply on
their own. "Not urgent", "no rush" and the client's own promises ("I will send it asap") are not
urgent. Only the client's own subject line counts towards urgency, not a "Re:" one.

A thank-you is read without what it thanks for, so "Thank you for the clarification" asks for
nothing, while "Thanks for the update, please send the draft" still asks for the draft.

Every email received in the last 24 hours is in the sheet's **All emails received** tab, with
its priority and the reason — so you can check the rules rather than trust them. If you think
documents-only emails should count too, set `COUNT_DOCUMENTS_ONLY: true`; for long messages with
no question, `COUNT_LONG_MESSAGES: true` (both then count as Medium).

**What counts as an answer.** Any email from anyone at HOF to the client's address. Three
client emails in a row are one wait, timed from the first.

**Actions asked for.** When the client asked for something to be *done* (send, share, check,
correct, book a call, process a refund) and there was no reply and no connected call, the row
carries a red note: the action was needed, and even if it has been done, kindly confirm it to
the client. The sheet has the same sentence in its **Action the client asked for** column.

**The call check.** When no email went back in 24 hours, the client's **contact and deals**
are checked for a connected call in those 24 hours (outcome *Connected*, or 60 seconds or more).
The deal matters: case managers log most calls from the deal record ("Call with unknown
contact"), so a contact-only check would miss them.

**The WhatsApp check (Mesh).** When no email went back in 24 hours and there was no
connected call, WhatsApp is checked too. Mesh is HOF's own tool, with the WhatsApp Business
API behind it. Its **Compliance Read API** gives read-only access to every chat on one
WhatsApp number; the key decides which (today, the **HOF Migration team number**). It can't
send, change or delete anything.

- **What counts:** a WhatsApp from anyone at HOF to that client inside the same 24 hours.
  A text, a voice note or a file all count, and so does a message typed on the team phone
  (WhatsApp Business app).
- **Voice notes:** they are not listened to. One sent in that time means the conversation
  happened.
- **What doesn't count:** internal notes, campaigns, bots, automations, Mesh's own messages,
  and messages that failed or never left.
- **Finding the client:** every phone number on their HubSpot contact (phone, mobile, mobile
  number and WhatsApp number), in any format.
  - Only if no number matches is their name tried, exactly as in HubSpot.
  - The name is used only when exactly one WhatsApp contact on the number has it.
  - A row found by name says so, so you can check it is the same person.
- **How it's read:** once a run — every chat that changed, and every message sent on the
  number, since the oldest email being checked. Mesh allows 120 requests a minute; the agent
  stays under that.
- **In the report:** these emails go in their own section, "answered on WhatsApp", with the
  message shown next to the email. You can see whether it was about what the client asked.
- **WhatsApp sent after the 24 hours:** the email stays flagged, with a note.
- **If Mesh can't be read** (no key, the key is refused, or the API is switched off), the
  email says so at the top. The rest of the report goes out as usual.

---

## Built against real data

The rules were tuned on 348 real client emails to these case managers (14–20 October 2026),
and the full report was replayed on that week before handing over. About 55% of client emails
need a reply; the rest are thank-yous, documents and updates.

Re-checked on 1,043 client emails from 4–18 November 2026: 16 thank-yous and acknowledgements
that had been counted (for example "Thank you for the clarification.", "Kindly noted.") no
longer are, and nothing new started being counted.

## Worth knowing

- **14 case managers, not 12** — all 14 names you listed are in. To drop someone, delete their
  line in `config.js`.
- **"Anwar" is Anwar Saeed.** HubSpot also has Danish Anwar and Hassan Anwar; swap the id in
  `config.js` if you meant one of them.
- A reply from a personal email, a call not logged in HubSpot, or a WhatsApp from a number the
  Mesh key doesn't cover can't be seen. **Today that includes the case managers' own WhatsApp
  numbers**: a client answered from one of them can still be flagged. Ask the Mesh team for a
  key for those numbers and add it to the `MESH_API_KEY` secret, one key per line.
- **The Mesh key.** It's sent as a Bearer token, then as `X-Api-Key`. The sheet's "How it was
  checked" tab says which number was read, how many chats and messages, and how many clients
  were found. If the email says *Mesh refused the MESH_API_KEY*, check the secret holds the
  Compliance Read API key and nothing else; if it says *switched off or being set up*, contact
  the Mesh team.
- A reply on any thread counts, even if it doesn't answer that particular question.
- **Leave** doesn't pause the clock — the client is still waiting — but rows are marked so
  cover can be arranged. Add dates under `LEAVE` in `config.js`.
- **Add the 2027 UAE holidays** to `config.js` once they're announced. The report warns if a
  year has none.
- The built-in Resend sender only reaches your own address. To CC your managers, verify
  `hofmigration.com` in Resend first, then set `FROM_EMAIL` and `CC` in `config.js`.

## Changing a rule

Everything is in `config.js`. Every rule has a test in `selftest.js`, which runs before each
report — `200 passed, 0 failed` — and if a rule breaks, the report doesn't go out.

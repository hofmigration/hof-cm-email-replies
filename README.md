# Case manager email replies

Every morning at **11:00 Pakistan time** you get one email: every client email to the
14 case managers whose **24 hours ran out since yesterday at 11:00**, and what happened to it.

- **Flagged — no reply** · past 24 hours, no email back and no connected call
- **Flagged — replied late** · answered, but after the 24 hours
- **No email reply in 24 hours, but a connected call** · its own section, as asked
- **Still unanswered from earlier days** · keeps reappearing until someone answers (up to 14 days)
- **Due before tomorrow's report** · not late yet, nobody has replied — a heads-up
- **By case manager** · one line each, with an on-time %

Every row is in the attached Excel sheet, with links to the client's deal and contact.
Read-only — nothing in HubSpot is changed.

---

## Setting it up

1. New **private** repo, e.g. `hof-cm-email-replies`.
2. Upload to the root: `config.js`, `0-hubspot.js`, `1-clock.js`, `2-classify.js`,
   `3-match.js`, `4-workbook.js`, `5-email.js`, `report.js`, `selftest.js`, `package.json`.
3. **Add file → Create new file**, name it `.github/workflows/cm-email-replies.yml`
   (typing the slashes makes the folders), and paste in `cm-email-replies.yml`.
4. **Settings → Secrets and variables → Actions** — the same two secrets your other agents use:

| Secret | |
|---|---|
| `HUBSPOT_TOKEN` | the HOF private app token (it needs to read emails — the one the email-scan and claims agents use already does) |
| `RESEND_KEY` | the key your other reports send with |

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

**Which emails need a reply.** Only the client's own new words are read — the quoted thread
underneath, signatures and "Sent from my iPhone" are cut off first.

| Counted | Not counted |
|---|---|
| a complaint | anything from HOF staff |
| a chaser — "any update?", "it's been 20 days" | automatic messages — auto-replies, Gmail reactions, no-reply senders |
| a problem or mistake pointed out | thank-yous and acknowledgements — "noted", "thank you for the update" |
| a request for a call or meeting | documents or news sent with nothing asked — these need an acknowledgement, not a reply |
| a question (with or without a "?") | |
| a request — please advise / confirm / check / send | |
| a long message with no clear question (counted to be safe) | |

Every email received in the last 24 hours is in the sheet's **All emails received** tab, with
the decision and the reason — so you can check the rules rather than trust them. If you think
documents-only emails should count too, set `COUNT_DOCUMENTS_ONLY: true`.

**What counts as an answer.** Any email from anyone at HOF to the client's address. Three
client emails in a row are one wait, timed from the first.

**The call check.** When no email went back in 24 hours, the client's **contact and deals**
are checked for a connected call in those 24 hours (outcome *Connected*, or 60 seconds or more).
The deal matters: case managers log most calls from the deal record ("Call with unknown
contact"), so a contact-only check would miss them.

---

## Built against real data

The rules were tuned on 348 real client emails to these case managers (14–20 October 2026),
and the full report was replayed on that week before handing over. About 55% of client emails
need a reply; the rest are thank-yous, documents and updates.

## Worth knowing

- **14 case managers, not 12** — all 14 names you listed are in. To drop someone, delete their
  line in `config.js`.
- **"Anwar" is Anwar Saeed.** HubSpot also has Danish Anwar and Hassan Anwar; swap the id in
  `config.js` if you meant one of them.
- A reply sent outside HubSpot (personal email, WhatsApp) or a call not logged in HubSpot can't be seen.
- A reply on any thread counts, even if it doesn't answer that particular question.
- **Leave** doesn't pause the clock — the client is still waiting — but rows are marked so
  cover can be arranged. Add dates under `LEAVE` in `config.js`.
- **Add the 2027 UAE holidays** to `config.js` once they're announced. The report warns if a
  year has none.
- The built-in Resend sender only reaches your own address. To CC your managers, verify
  `hofmigration.com` in Resend first, then set `FROM_EMAIL` and `CC` in `config.js`.

## Changing a rule

Everything is in `config.js`. Every rule has a test in `selftest.js`, which runs before each
report — `89 passed, 0 failed` — and if a rule breaks, the report doesn't go out.

// 2-classify.js — does a client's email need a reply?
//
// Only the client's own new words are read: the quoted thread underneath, signatures,
// "Sent from my iPhone" and legal footers are cut off first. Then, in this order:
//   not counted — from HOF staff, or an automatic message
//   counted     — a complaint, a chaser, a problem or mistake pointed out, a call or
//                 meeting request, a question, a request
//   not counted — a thank-you or acknowledgement
//   counted     — a long message with no clear question (counted to be safe)
//   not counted — documents or news sent with nothing asked (an acknowledgement is enough)
// Every decision carries a plain reason, which the sheet shows next to the email.
//
// Before anything is read, a thank-you and what it thanks for are taken out ("Thank you for
// the clarification" asks for nothing), as are polite offers, "keep me posted" in an email
// that is otherwise a thank-you, the client's own plans ("I will have a call with my
// referee") and question marks that are really a lost emoji ("Thank you Yamina ??").
// When the client asks for something to be DONE, that sentence is kept as the "ask", so the
// report can say the action was needed when nobody replied.
//
// These rules were tuned on 348 real client emails to the case managers (14–20 Oct 2026),
// and re-checked on 1,043 (4–18 Nov 2026), where 16 thank-yous stopped being counted.
const { SETTINGS } = require("./config");

// ---------------------------------------------------------------- the client's new words
const WROTE = "(wrote|a écrit|schrieb|escribió|ha scritto|schreef|escreveu|yazdı|كتب)";
const QUOTE_HEAD = new RegExp(`^\\s*(on|le|am|el|op|il|em|في)\\b.{0,320}?${WROTE}\\s*:`, "i");
// Apple Mail and some phones put the whole email on one line, so the quote header can sit
// mid-line: "…Thanks, Ramil On Oct 7, 2026, at 2:17 PM, Brenda <brenda@…> wrote: Dear Ramil…"
const QUOTE_INLINE = new RegExp(`\\b(on|le|am|el)\\s[^<>\\n]{3,140}?<?\\s*[\\w.+'-]+@[\\w-]+(\\.[\\w-]+)+\\s*(\\(mailto:[^)]*\\))?\\s*>?,?\\s*${WROTE}\\s*:`, "i");
const OUTLOOK_INLINE = /\bfrom:\s[^\n]{0,160}?\b(sent|date):\s/i;
const LINE_CUTS = [
  /^\s*>/,                                                        // a quoted line
  /^\s*-{2,}\s*(original message|forwarded message|reply message)\s*-{2,}/i,
  /^\s*_{8,}\s*$/,                                                // Outlook's separator
  /^\s*--\s*$/,                                                   // the standard signature line
  /^\s*begin forwarded message\s*:?/i,
  /^\s*sent from (my |yahoo|outlook|mail for|samsung|the )/i,
  /^\s*get outlook for\b/i,
  /^\s*(this (e-?mail|message)\b.{0,60}\b(confidential|intended (only|solely)|privileged))/i,
  /^\s*(disclaimer|confidentiality notice)\s*:?/i,
];
// The same endings in the middle of a line: some phones send the whole email as one line,
// so "…Kindly noted. Regards, Sent from Outlook for iOS ______ From: Rahima…" still has to
// stop at the phone footer or the separator.
// Capital letters on purpose: the footer says "Sent from my iPhone"; a client writing "I sent
// from my phone yesterday" must not lose the rest of the email.
const INLINE_CUTS = [
  /\bSent from (my )?(iPhone|iPad|Samsung|Galaxy|Huawei|Android|[Mm]obile|[Ss]martphone|[Pp]hone|BlackBerry)\b/,
  /\bSent from (Outlook|Yahoo Mail|Mail for Windows|the Outlook app)\b/,
  /\bGet Outlook for (iOS|Android)\b/,
  /_{20,}/,
  /-{3,}\s*(original message|forwarded message|reply message)\s*-{3,}/i,
  /\bbegin forwarded message\s*:/i,
];
const HEADER_FIELD = /^\s*(from|de|von|من)\s*:\s*\S/i;
const HEADER_NEXT = /^\s*(sent|date|to|subject|cc|envoyé|gesendet|التاريخ|إلى)\s*:/i;
// a second "Dear Mr. Waseem," further down is the start of a quoted email with no header
const SECOND_GREETING = /^\s*(dear|hi|hello)\s+((mr|ms|mrs|miss|dr|sir|madam)\.?\s+)?[A-Z][a-z]+/;

function newWords(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").replace(/\u202f|\u00a0/g, " ").replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"').split("\n");
  let cut = lines.length, seenContent = false;
  for (let i = 0; i < lines.length && i < cut; i++) {
    const ln = lines[i];
    if (LINE_CUTS.some((re) => re.test(ln))) { cut = i; break; }
    // "On Tue, 20 Oct 2026 at 12:11, Brenda <brenda@…> wrote:" — sometimes wrapped over 2–3 lines
    if (/^\s*(on|le|am|el|op|il|em|في)\b/i.test(ln)) {
      const joined = lines.slice(i, i + 3).join(" ");
      if (QUOTE_HEAD.test(joined) && (/\d/.test(joined) || /@/.test(joined))) { cut = i; break; }
    }
    // an Outlook header block: "From: …" followed by "Sent:" / "Date:" / "To:"
    if (HEADER_FIELD.test(ln) && lines.slice(i + 1, i + 5).some((l) => HEADER_NEXT.test(l))) { cut = i; break; }
    if (seenContent && SECOND_GREETING.test(ln)) { cut = i; break; }
    if (ln.trim() && !/^\s*(dear|hi|hello|hey|good (morning|afternoon|evening))\b/i.test(ln)) seenContent = true;
  }
  let out = lines.slice(0, cut).join("\n");
  for (const re of [QUOTE_INLINE, OUTLOOK_INLINE, ...INLINE_CUTS]) {
    const m = re.exec(out);
    if (m && m.index > 0) out = out.slice(0, m.index);
  }
  return out;
}

// Some emails reach HubSpot with only an HTML body. The quote starts at Gmail's, Outlook's
// or Yahoo's quote block, so the HTML is cut there before the tags are removed.
function htmlToText(html) {
  let h = String(html || "");
  const q = h.search(/<div[^>]+class="?[^">]*\bgmail_quote|<blockquote|<div[^>]+id="?(divRplyFwdMsg|appendonsend)|<div[^>]+class="?[^">]*\b(yahoo_quoted|moz-cite-prefix)|<hr[^>]*id="?stopSpelling/i);
  if (q > 0) h = h.slice(0, q);
  return h.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

const URLS = /<?\b(https?:\/\/|www\.)[^\s<>]+>?|<mailto:[^>]+>|\(mailto:[^)]+\)|\[(image|cid|inline)[^\]]*\]/gi;
const GREETING = /^\s*(dear|hi|hello|hey|hii+|good (morning|afternoon|evening|day)|greetings( of the day)?|respected|assalam[ou]* ?[ao]?\s*[ae]?la[iy]kum|asslamoalikum|aoa|salam|salaams?|as-?salamu? alaikum)\b[^\n.!?,]{0,45}[,.!:\n]?/i;
const SIGN_OFF = /\n\s*[*_]*\s*((best|kind|warm|warmest|many|with)\s+(regards|wishes|thanks)|regards|sincerely|yours (truly|sincerely|faithfully)|thanks (and|&) (best |kind )?regards|thanks & kind regards|cheers|br|thank you( very much)?|thanks( a lot)?|many thanks|best)\s*[*_]*\s*[,.!]*\s*[*_]*\s*(\n|$)[\s\S]*$/i;

// the words that count, ready to test: no links, no greeting, no sign-off
function core(text) {
  const fresh = newWords(text).replace(URLS, " ");
  const tidy = (x) => x.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  let t = tidy(("\n" + fresh).replace(SIGN_OFF, "\n"));  // sign-off and the name/phone after it
  if (!t) t = tidy(fresh);                                 // "Thanks" on its own IS the message
  for (let i = 0; i < 2; i++) { const g = t.replace(GREETING, "").trim(); if (g) t = g; }
  return t;
}

// ---------------------------------------------------------------- what the words say
// Polite offers are removed before looking for requests, so "let me know if you need
// anything else" is not read as the client asking for something.
const OFFERS = [
  /\b(please\s+)?(do\s+)?let (me|us) know if (you|there|any|anything|further|more|other|additional|i need|i have to|i should|i have missed|i missed|something|it is needed|its needed|required)\b[^.?!\n]*/gi,
  /\bif (you|there)\b[^.?!\n]{0,90}\b(need|needs|require|required|want|missing|more|further|additional|anything|else)\b[^.?!\n]{0,90}\b(let (me|us) know|feel free|contact|reach out|inform|tell|write)\b[^.?!\n]*/gi,
  /\bif any(thing)?\b[^.?!\n]{0,140}\b(required|needed|missing|else|more)\b[^.?!\n]{0,80}\b(let (me|us) know|inform|tell|contact|reach out)\b[^.?!\n]*/gi,
  /\b(feel free|do not hesitate|don'?t hesitate)\b[^.?!\n]*/gi,
  /\blet (me|us) know what (else )?(you |is |are )?(need|needs|needed|require|required)\b[^.?!\n]*/gi,
  /\b(i am|i'm|i will be|i'd be|i would be) (happy|glad|available|ready) to\b[^.?!\n]*/gi,
  /\b(in case|should you|whenever you)\b[^.?!\n]{0,120}\b(need|require|let (me|us) know|contact|reach)\b[^.?!\n]*/gi,
  /\b(hope|hoping) (you|this|that|all|everything)\b[^.?!\n]*\?/gi,   // "hope you are well?" is not a question
  /\b(talk|speak) (to|with) you (then|soon|later|tomorrow|on \w+)\b/gi,
  // the client's own plans: "I will have a call with my referee this week" asks nothing of HOF
  /(?<!\b(can|could|shall|may|should|would|will|do|let)\s+)\b(i|we|he|she|they)\s+((will|'ll|shall|am going to|are going to|plan to|am planning to|already|also|have to)\s+)?(have|had|arrange|schedule|book|set up|setup|fix|attend|join)\s+(a |an |one |the )?(quick |short |joint |zoom |teams |google meet |video |phone )?(call|meeting|session|zoom|appointment|slot)\b(?![^.?!\n]{0,60}\bwith (you|u|hof|your team)\b)[^.?!\n]*/gi,
];

const SIGNALS = {
  complaint: /\b(not happy|unhappy|disappoint\w*|frustrat\w*|unacceptable|unprofessional|(i|we) (want to |would like to |wish to |am going to |will )?(complain|raise a complaint|file a complaint|lodge a complaint)|my complaint|formal complaint|refund\w*|payment return|money back|return (my|the) (payment|money|fees?)|(will|would|have to|going to|shall|must) escalate|escalate (this|the matter|it) to|worst|shock(ed|ing)|waste of (my )?(time|money)|cancel (my|the|this) (case|contract|file|service|agreement|application)|legal action|very upset|poor (service|response|communication)|no(body| one) (is )?(respond|repl|answer|pick)\w*|purpose of hiring|not satisfied|dissatisfied|negligen\w*|careless|lost (my |all )?(hope|trust|faith|confidence)|serious concern|concerned about the delay)\b/i,
  chaser: /\b(any (update|news|progress|feedback|response|reply|information)|(still|yet) (waiting|awaiting) (for |on )?(your|you|a reply|a response|an update|any update|feedback|the (reply|response|update|feedback))|(have not|haven'?t|did not|didn'?t|not yet|never) (heard back|heard from you|got (a|any) (reply|response))|(have not|haven'?t|did not|didn'?t|not yet) (received|got|get) (your|any|a) (reply|response|update|feedback|email|call|confirmation)|no (reply|response|update|feedback|answer)( yet| so far| from you)|it'?s been (\d+|a|two|three|four|five|several|many) (days?|weeks?|months?)|(\d+|two|three|four|five|several) (days?|weeks?) (have )?(passed|now|already)|(gentle |kind |friendly |second |final |another )?reminder|(i am|i'm|i’m|just|again|once again|writing to|this is to)\s+(formally\s+)?follow(ing)?[ -]?up|follow(ing)?[ -]?up (on|regarding|about) (my|our) (case|application|petition|file|previous|earlier|request|query|email)|(second|2nd|third|3rd|another) (email|time|follow)|awaiting your)\b/i,
  problem: /\b(errors?|incorrect|inaccura\w*|discrepanc\w*|inconsisten\w*|wrong (file|document|name|date|details|information|info|version|dates|designation|names|address|spelling)|previous version|same files?|not (been )?(reviewed|reflected|included|updated|corrected|incorporated|addressed)|(may|might|did) not have (been )?(reviewed|included|considered|added|updated|reflected|shared)|(needs?|require[sd]?|requiring) (correction|corrections|changes|amendment|amendments|refinement|revision)|you (didn'?t|did not|have not|haven'?t|forgot|missed)|(couldn'?t|could not|can'?t|cannot|unable to|not able to|haven'?t been able to|was not able to) (see|find|access|open|log ?in|login|upload|download|view|reach|sign|submit|pay|make|complete|get)|(is|are|was|were) (locked|not working|broken|not opening|not loading|expired)|(i am|i'm) (worried|concerned|confused|struggling)|(i hope|hopefully) (it|this|that) (will not|won'?t|does not|doesn'?t|would not|wouldn'?t) (affect|effect|impact|make any|cause|delay|harm))\b/i,
  call: /\b(call me|give me a (call|ring)|call (me )?back|callback|please call|(have|arrange|schedule|book|set up|setup|fix) (a |an )?(quick |short |joint |zoom |teams |google meet |video |phone )?(call|meeting|session|zoom|appointment|slot)|(joint|zoom|teams|online|video) (meeting|call)|meeting (today|tomorrow|on \w+)|(can|could|may|shall) (i|we) (talk|speak|connect|meet|discuss)|(want|like|need|would like|wish) to (talk|speak|discuss|connect|meet)|let'?s (talk|speak|connect|meet|discuss|have a call)|(i|we) can meet|(let'?s|let us|can we|could we|shall we) connect|connect(ing)? with you (on|at|tomorrow|today|this|next)|(meet|meeting|zoom|invite) link|(send|share) (me |us )?the (link|invite)|(available|free) (for|to) (a )?(call|talk|speak)|whats ?app call)\b|\b(available|free)\b[^.!?\n]{0,60}\b(either\b|between\b|\d{1,2}([:.]\d{2})?\s*(am|pm)?\s*(-|to|–)\s*\d{1,2})/i,
};
const QUESTION = /[?؟]/;
const AUX_QUESTION = /(^|[.!\n:;]\s*|\b(and|but|also|so|now)\s+)(do|does|did|is|are|was|were|have|has|can|could|will|would|shall|should|may) (you|we|i|it|there|my|the|this|they|these|those|your|he|she)\b/i;
// "Thank you for the update, please keep me posted" / "Noted, let me know once it is
// submitted": in an email that is otherwise a thank-you, asking to be told LATER is not
// something to answer now. Without a thank-you, the same words still count.
const LATER = [
  /\b(please\s+)?(do\s+)?(let (me|us) know|update (me|us)|inform (me|us)|notify (me|us)|tell (me|us))\s+(once|as soon as|whenever|after)\b[^.?!\n]*/gi,
  /\b(please\s+)?(do\s+)?keep (me|us) (updated|posted|informed|in the loop)\b[^.?!\n]*/gi,
];
const THANKED = /\b(thanks?|thank you|thankyou|thx|noted|well noted|well received|received|appreciated?|grateful|ok|okay|alright|sure|great)\b/i;

// "Thank you for the clarification" thanks someone for something; it does not ask for it.
// The thank-you and what it is for are removed before looking for requests, up to the end
// of that clause, so "Thanks for the update, please send the draft" still asks for the draft.
const GRATITUDE_STOP = "but|however|although|though|yet|please|pls|plz|kindly|can|could|would|will|shall|may|when|what|how|why|where|which|whether|i|we|also|meanwhile|now|so|is|are|do|does|did";
const GRATITUDE = new RegExp(
  "\\b(thanks?|thank you|thankyou|thx|many thanks|much appreciated|appreciated?|grateful)\\b" +
  "(\\s+(so|very)\\s+much|\\s+a lot|\\s+again|\\s+once again|\\s+as always|\\s+(dear\\s+)?((mr|ms|mrs|miss|dr)\\.?\\s+)?[a-z]+)?" +
  "\\s*,?\\s*(for|regarding|about)\\b" +
  `(?:(?!\\b(${GRATITUDE_STOP})\\b)[^.,;:?!؟\\n]){0,90}`, "gi");
// "Thank you Yamina ??": some phones turn an emoji into question marks. A lone "?" or "??"
// after a thank-you, with no question word before it, is not a question.
const QUESTION_WORDS = /\b(what|when|where|why|how|which|who|whom|whose|is|are|was|were|do|does|did|can|could|will|would|shall|should|may|have|has|any)\b/i;

const REQUEST = [
  /\b(please|pls|plz|pl|kindly)\s+(also\s+)?(?!find\b|fond\b|fine\b|finf\b|see\b|note\b|noted\b|acknowledged\b|received\b|regards\b|thanks?\b|thank\b|expect\b|bear\b|refer\b|be\b|ignore\b|accept\b|disregard\b|excuse\b|forgive\b|remember\b|go ahea\w*|proceed\b|continue\b|carry on\b|allow (me|us) (some |more |a few |one more )?(time|days?|weeks?|sometime)\b|let me know if\b)[a-z]{2,}/i,
  /\b(pls|plz)\b(?!\s+(find|fond|fine|see|note|noted|refer|ignore|accept|disregard|excuse|forgive|expect|bear)\b)/i,   // "Plz find attached" sends; it does not ask
  /\b(could|can|would|will|may) you\b/i,
  /\b(can|could|may|shall|should) (i|we|myself)\b/i,
  /\b(i|we) (would like|'d like|want|wanted|wish|need|needed|request|am requesting|would request|would appreciate|will appreciate|'d appreciate|require|am looking for|am waiting)\b|\b(i'd|we'd) (like|appreciate)\b/i,
  /\b(let (me|us) know|update me|keep (me|us) (updated|posted|informed)|inform me|tell me|get back to (me|us)|revert (back )?to (me|us)|(respond|reply) (to me|back to me|to my (email|query|question|request))|advise|guide (me|us)|(help|assist|support) (me|us)|clarify|(need|want|require|request|seek|seeking|some|further|more|any|for|a) clarifications?|clarifications? (is |are )?(on|about|regarding|required|needed)|suggest|(your|any|some) suggestions?)\b/i,
  /\b(awaiting|await|waiting for|need|needs|require|request|seek|seeking|would appreciate|will appreciate|looking for) (your|you)\b/i,
  // "attached for your review" asks; "thank you for your confirmation" does not
  /(?<!\b(thanks?|thank you|appreciated?|appreciate|grateful)\b[^.?!\n]{0,40})\bfor your (kind )?(review|revision|approval|confirmation|feedback|consideration|comments?|input|check|checking|verification|action|necessary action|response|guidance|advice)\b/i,
  /\b(if|whether) (it|this|that|these|they) (is|are) (ok|okay|fine|acceptable|correct|enough|sufficient|right)\b/i,
  /\b(is|are) (this|these|it|they) (required|needed|necessary|mandatory|ok|okay|fine|enough|sufficient|acceptable|correct)\b/i,
  /(^|[.!\n:;]\s*)(please\s+)?(send|share|forward|provide|give|tell|show|explain|confirm|check|review|update|book|schedule|arrange|correct|change|amend|revise|resend|re-send|activate|verify|validate|include|fix|add|remove) (me|us|it|the|my|this|that|a|an|all|them|our)\b/i,
  /\b(you|u) (need|have|must|should|will need) to\b/i,
  /\b(you can|you may) (place|use|add|put|insert|copy|change|update|edit|remove)\b/i,
  /\bdo (share|let|send|inform|update|tell|check|confirm|advise)\b/i,
  /\b(is it possible|is there (any|a) way|what (is|are|should|will|would|about)|when (will|is|can|should|would|do)|how (long|much|can|do|should|will|to)|where (is|can|do|should)|which (one|document|option))\b/i,
  /\b(kab|kia|kya|kyun|kaise|kese|batay?e?n|bata (dein|do|den)|zara|kar dein)\b/i,
  /\bto know (the|about|whether|if|when|what|how)\b|\b(know|check) the (status|progress)\b/i,
  /\bfor (review|approval|confirmation|feedback|comments|your perusal)\b/i,
];
const ACK = /\b(thanks?|thank you|thankyou|thx|tq|ty|noted|received|well received|ok|okay|okk|alright|all right|great|perfect|sure|will do|done|appreciated?|much appreciated|grateful|jazak ?allah\w*|shukri?y?a|got it|sounds good|fine|wonderful|excellent|awesome|understood|acknowledged|welcome|amazing|lovely|brilliant|confirmed)\b/i;
const DOCS = /\b(attached|attachment|attaching|enclosed|please find|kindly find|pfa|upload(ed|ing)?|i have (sent|shared|submitted|signed|completed|filled|updated|answered|provided)|i('ve| have) (just )?(sent|shared|submitted|signed|completed|filled|updated|answered|provided)|sharing|here (is|are)|as requested|signed (copy|copies|documents?|letters?|forms?)|scanned|copy of|see below|below (is|are)|my (responses?|answers?) (below|are|is))\b/i;
// Asking for something to be DONE (send, check, correct, book, call…), as opposed to asking
// a question. When one of these goes unanswered, the report says the action was needed and
// that the client must be told, even if it has already been done.
const ACTION_VERBS = "send|share|forward|provide|resend|re-send|upload|submit|file|prepare|draft|review|check|verify|validate|correct|fix|change|amend|revise|edit|update (the|my|it|this|that|our|these|those|them)|add|remove|delete|include|book|schedule|reschedule|arrange|set up|setup|call|ring|cancel|refund|return|process|activate|reactivate|reset|sign|approve|issue|apply|pay|transfer|initiate|start|proceed with|look into|look at|follow up with|contact|reach out to|email|courier|deliver|confirm (the|my|our|if|whether|receipt|that)|reply to|respond to|expedite|speed up|finali[sz]e|complete|lodge|view|go through|look through|consider|incorporate|reinstate|restore|hold|keep (the|my|it|this|that|these)|ask (the|your)|reach (me|us|out)|use|create|generate|enable|grant|attach|translate|notari[sz]e|print|collect";
const ACTION = [
  new RegExp(`\\b(please|pls|plz|pl|kindly|could you|can you|would you|will you|(i|we) (need|want|would like|request) you to|request you to|you (need|have|must|should) to|do)\\s+(also\\s+)?(${ACTION_VERBS})\\b`, "i"),
  new RegExp(`(^|[.!\\n:;]\\s*)(${ACTION_VERBS}) (me|us|it|the|my|this|that|a|an|all|them|our|these|those)\\b`, "i"),
  /\b(i|we) (need|want|require|request|would like|'d like) (the|a|an|my|our|your|a copy of|copies of|an update on|to (have|get|receive|see|book|schedule|cancel))\b/i,
  /(?<!\b(thanks?|thank you|appreciated?|appreciate|grateful)\b[^.?!\n]{0,40})\bfor your (kind )?(review|revision|approval|signature|action|necessary action|verification)\b/i,
  /\bfor (review|approval|signature)\b/i,
  /\b(refund|money back|cancel (my|the|this) (case|contract|file|service|agreement|application))\b/i,
  /\byou (may|can) (now )?(proceed|go ahead|submit|file|book|use|send|share)\b/i,
];
const AUTO_BODY = /^\s*\S[^\n]{0,80}\breacted via (gmail|outlook)\b|^\s*(this is an automatic|this is an automated|automatic reply|auto-?reply|i am (currently )?out of (the )?office|i'm (currently )?out of (the )?office)/i;
const REPLY_SUBJECT = /^\s*((re|fw|fwd|aw|tr|rv|sv|antw)(\[\d+\])?\s*:\s*)+/i;

const domainOf = (addr) => String(addr || "").toLowerCase().split("@")[1] || "";
const isInternal = (addr) => SETTINGS.INTERNAL_DOMAINS.some((d) => domainOf(addr) === d || domainOf(addr).endsWith("." + d));
const cleanSubject = (s) => String(s || "").replace(REPLY_SUBJECT, "").trim();

function dropEmojiMarks(s) {
  return s.replace(/(^|[.!\n]\s*)([^.!?؟\n]*?)\s\?+(?=\s|$)/g, (m, lead, before) => (ACK.test(before) && !QUESTION_WORDS.test(before) ? `${lead}${before} ` : m));
}

// the words with polite offers and thank-yous taken out; what is left is what the client asks
function strip(t) {
  let s = dropEmojiMarks(t);
  for (const re of OFFERS) s = s.replace(re, " ");
  if (THANKED.test(s)) for (const re of LATER) s = s.replace(re, " ");
  const polite = s;                         // complaints are read before thank-yous are removed
  s = s.replace(GRATITUDE, " ");
  return { polite, s };
}

function read(t) {
  const { polite, s } = strip(t);
  const flags = Object.keys(SIGNALS).filter((k) => SIGNALS[k].test(k === "complaint" ? polite : s));
  const question = QUESTION.test(s) || AUX_QUESTION.test(s);
  const request = REQUEST.some((re) => re.test(s));
  const rest = s.replace(/[\s.,;:!?-]+/g, " ").trim();
  return { flags, question, request, rest };
}

// The sentence in which the client asks for something to be done — shown in the report when
// nobody answered. Questions alone are not actions; they need a reply, which the row says.
function askOf(words) {
  const sentences = String(words || "").split(/(?<=[.!?؟])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  for (const sen of sentences) {
    const { s } = strip(sen);
    if (SIGNALS.call.test(s) || ACTION.some((re) => re.test(s))) return sen.length > 220 ? sen.slice(0, 219).trimEnd() + "…" : sen;
  }
  return "";
}

const REASONS = {
  internal: "From HOF staff",
  automated: "Automatic message",
  ack: "Thank-you or acknowledgement",
  documents: "Documents or information sent, nothing asked — acknowledgement only",
  update: "Update from the client, nothing asked",
  empty: "No message text",
  complaint: "Complaint",
  chaser: "Chasing — asked again",
  problem: "Points out a problem, mistake or concern",
  call: "Asks for a call or meeting",
  question: "Asks a question",
  request: "Asks for something",
  long: "Long message with no clear question — counted to be safe",
  documentsCounted: "Documents sent — counted (COUNT_DOCUMENTS_ONLY is on)",
  subject: "The subject line asks something",
};
const PRIORITY = ["complaint", "chaser", "problem", "call"];

// email: { from, subject, text, html, attachments (bool) }
// -> { needs, key, reason, flags[], words (the client's new words, for the report) }
function classify(email) {
  const from = String(email.from || "").toLowerCase();
  const subject = String(email.subject || "");
  const out = (needs, key, flags = [], words = "") => ({ needs, key, reason: REASONS[key], flags, words, ask: needs ? askOf(words) : "" });

  if (isInternal(from)) return out(false, "internal");
  if (SETTINGS.AUTOMATED_SENDERS.test(from) || SETTINGS.AUTOMATED_DOMAINS.some((d) => domainOf(from) === d || domainOf(from).endsWith("." + d)))
    return out(false, "automated");
  if (SETTINGS.AUTOMATED_SUBJECTS.test(subject)) return out(false, "automated");

  const text = String(email.text || "").trim() ? email.text : htmlToText(email.html);
  if (AUTO_BODY.test(newWords(text).replace(URLS, " "))) return out(false, "automated");
  const words = core(text).replace(/\s+/g, " ").trim();

  if (!words) {
    if (email.attachments) return out(SETTINGS.COUNT_DOCUMENTS_ONLY, SETTINGS.COUNT_DOCUMENTS_ONLY ? "documentsCounted" : "documents");
    const subj = cleanSubject(subject);
    if (!REPLY_SUBJECT.test(subject) && subj) {
      const a = read(subj);
      if (a.question || a.request || a.flags.length) return out(true, "subject", a.flags, subj);
    }
    return out(false, "empty");
  }

  const a = read(words);
  const top = PRIORITY.find((k) => a.flags.includes(k));
  if (top) return out(true, top, a.flags, words);
  if (a.question) return out(true, "question", a.flags, words);
  if (a.request) return out(true, "request", a.flags, words);

  // a thank-you, even a long one, as long as what is left once the thanks are taken out is short
  const shortOnceThanked = a.rest.length <= SETTINGS.ACK_MAX_CHARS && words.length < SETTINGS.LONG_MESSAGE_CHARS;
  if ((words.length <= SETTINGS.ACK_MAX_CHARS || shortOnceThanked) && ACK.test(words)) return out(false, "ack", [], words);
  if (words.length >= SETTINGS.LONG_MESSAGE_CHARS) return out(true, "long", [], words);
  if (DOCS.test(words) || email.attachments)
    return out(SETTINGS.COUNT_DOCUMENTS_ONLY, SETTINGS.COUNT_DOCUMENTS_ONLY ? "documentsCounted" : "documents", [], words);
  return out(false, "update", [], words);
}

const snippet = (s, n = 180) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

module.exports = { classify, newWords, core, htmlToText, isInternal, cleanSubject, snippet, askOf, REASONS };

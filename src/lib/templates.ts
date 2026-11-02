/**
 * Reminder drafts. A draft is always built from an approved template; the officer can
 * edit it, but every version is checked against a list of threatening or shaming words
 * before it can be sent. Nothing is sent without the officer's tap.
 */

export type TemplatePurpose = "promise_tomorrow" | "promise_today" | "promise_broken" | "overdue_reminder";

export function choosePurpose(ctx: { promisedDate: string | null; promiseBroken: boolean; today: string; tomorrow: string }): TemplatePurpose {
  if (ctx.promiseBroken) return "promise_broken";
  if (ctx.promisedDate === ctx.today) return "promise_today";
  if (ctx.promisedDate === ctx.tomorrow) return "promise_tomorrow";
  return "overdue_reminder";
}

const PLACEHOLDER = /\{(\w+)\}/g;

export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(PLACEHOLDER, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Template needs a value for {${key}}`);
    return vars[key];
  });
}

/**
 * Words and phrases that have no place in a recovery message under RBI's fair-practice code:
 * threats, intimidation, shaming and contacting family or neighbours.
 * Matching ignores case and extra spaces.
 */
export const BLOCKED_PHRASES = [
  // English
  "police", "jail", "arrest", "fir", "court case", "seize", "seizure", "confiscate", "goons",
  "consequences", "warning", "last chance", "shame", "your family", "neighbours", "neighbors",
  "relatives", "boss", "employer", "blacklist", "ruin", "punish", "threat",
  // Hindi (Devanagari)
  "पुलिस", "जेल", "गिरफ्तार", "गिरफ़्तार", "एफआईआर", "ज़ब्त", "जब्त", "अंजाम", "परिणाम भुगत", "आखिरी मौका",
  "बदनाम", "बेइज्जत", "बेइज़्ज़त", "परिवार को", "पड़ोसी", "रिश्तेदार", "धमकी", "देख लेंगे", "सबक",
  // Hinglish
  "dekh lenge", "badnaam", "beizzat", "uthwa", "anjaam", "sabak",
];

export function findBlockedPhrases(text: string): string[] {
  const normalised = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  return BLOCKED_PHRASES.filter((phrase) => {
    const p = phrase.toLowerCase();
    // Latin words must match as whole words ("fir" must not match "firm").
    if (/^[a-z ]+$/.test(p)) return new RegExp(`(^|[^a-z])${p.replace(/ /g, "\\s+")}($|[^a-z])`).test(normalised);
    return normalised.includes(p);
  });
}

export const MAX_MESSAGE_LENGTH = 480;

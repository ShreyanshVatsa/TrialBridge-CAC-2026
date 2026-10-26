/**
 * Remove likely personal information from free text before it leaves the browser and again on
 * the server: emails, phone numbers, SSNs, dates (e.g. dates of birth), stated names, street addresses,
 * stated ages, ZIP codes, long digit strings and alphanumeric IDs. Conservative by design: it may remove harmless numbers too.
 */
const PATTERNS: RegExp[] = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, // email
  /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g, // SSN (dashes or spaces)
  /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, // U.S. phone
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, // 01/02/1960
  /\b\d{4}-\d{2}-\d{2}\b/g, // 1960-01-02
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi, // March 3, 1960
  /\b(?:born|dob|date of birth|birthday|birth date|bday|nac[ií]|nasci|fèt)\b[^.,;!?]{0,30}/gi, // "born on March 3 1960", "my birthday is the 5th of May"
  /\b(?:my name is|my name'?s|i am called|i'?m called|me llamo|mi nombre es|meu nome [ée]|me chamo|non mwen se|mwen rele)\b[^.,;!?]{0,40}/gi, // stated name
  /\b\d{1,5}\s+(?:[A-Za-z0-9.'-]+\s+){1,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|calle|rua|avenida)\b\.?/gi, // street address
  /\b(?:i live (?:at|in|on)|i reside (?:at|in)|my address is|vivo en|moro (?:em|na|no)|mwen rete)\b[^.;!?]{0,50}/gi, // "I live at ..."
  /\b(?:i am|i'?m|im|aged?|soy de|tengo|tenho|estou com|mwen gen)\s+(?:a\s+|an\s+)?\d{1,3}(?:\s*-?\s*(?:years?|yrs?|yo|y\/o|a[ñn]os|anos|ans))?(?:\s*-?\s*(?:years?\s+)?old)?\b/gi, // stated age
  /\b\d{1,3}\s*-?\s*(?:years?|yrs?|a[ñn]os|anos|ans)\s*-?\s*(?:old|de edad|de idade|d'age)\b|\b\d{1,3}\s*(?:y\/o|yo)\b/gi, // "67 year old", "67 yo"
  /\b[a-z0-9._%+-]+\s*(?:\(|\[|\{)?\s*at\s*(?:\)|\]|\})?\s*[a-z0-9-]+\s*(?:\(|\[|\{)?\s*(?:dot|\.)\s*(?:\)|\]|\})?\s*(?:com|org|net|edu|gov|io|co|us|mil)\b/gi, // "jo at mail dot com"
  /\b\d{5}(?:-\d{4})?\b/g, // ZIP / ZIP+4
  /\b\d{6,}\b/g, // long digit strings (MRNs, IDs)
  /(?<![\d.])\d(?:[\s._-]{1,2}\d){6,}(?![\d])/g, // digits spelled out with separators: "5 5 5 1 2 3 4"
];

/** Alphanumeric IDs (e.g. MRN AB123456): >= 6 chars with letters and >= 3 digits. NCT trial IDs are public and kept. */
const ALNUM_ID = /\b(?=[A-Z0-9-]*[A-Z])(?=(?:[A-Z-]*\d){3})[A-Z0-9-]{6,}\b/gi;

export function scrubPersonalInfo(text: string): { text: string; removed: number } {
  let removed = 0;
  // Fold look-alike forms (full-width digits, zero-width/format characters) so they cannot dodge the patterns.
  let out = text.normalize("NFKC").replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, "");
  for (const re of PATTERNS) {
    out = out.replace(re, () => {
      removed++;
      return "[removed]";
    });
  }
  out = out.replace(ALNUM_ID, (m) => {
    if (/^NCT\d{8}$/i.test(m)) return m;
    removed++;
    return "[removed]";
  });
  return { text: out.replace(/\s+/g, " ").trim(), removed };
}

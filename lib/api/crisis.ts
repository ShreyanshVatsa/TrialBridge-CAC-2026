/**
 * Client-side crisis detector for Trial Q&A (serious distress => supportive reply with
 * crisis resources: U.S. call or text 988, emergencies 911, and "tell your care team").
 *
 * Runs in the browser from static patterns, with no network call, so crisis resources still appear
 * when the API is offline, rate limited, or failing. It checks every language lexicon regardless of the
 * UI language, on accent-folded lowercase text ("suicídio" and "suicidio" both match). It is
 * deliberately conservative: a false positive only shows a supportive box with phone numbers.
 */
import { matchesCrisis, normalizeForCrisis } from "@/lib/safety/crisis";
import type { AskResponse } from "@/lib/types/ask";

export { normalizeForCrisis };

/** Runs every locale's lexicon (lib/safety/lexicons), whatever the UI language. */
export function detectCrisisLocal(text: string): boolean {
  return matchesCrisis(text);
}

/** Response shown for a locally detected crisis message (no request is made). */
export function localCrisisResponse(): AskResponse {
  return { status: "ok", kind: "crisis", answer: "", citations: [], crisis: true, piiRemoved: false, experimental: false, cached: false, provider: null };
}

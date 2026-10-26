import type { CrisisLexicon } from "../types";

export const lexicon: CrisisLexicon = {
  tag: "en",
  reviewed: false,
  patterns: [
    /suicid/,
    /\bswisid/,
    /\bkill(?:ing)?\s+(?:my\s*self|myself|me)\b/,
    /\b(?:end|ending|ended|take|taking)\s+(?:my|his|her)\s+(?:own\s+)?life\b/,
    /\b(?:end|ending)\s+(?:it\s+all|everything)\b/,
    /\b(?:want|wanna|wish|wished|hope|ready|going|plan(?:ning)?|thinking\s+of|thinking\s+about)\s+(?:to\s+)?(?:die|dying|be\s+dead)\b/,
    /\bwish\s+(?:i|that\s+i)\s+(?:were|was|am|could\s+be)\s+(?:dead|gone|never\s+born)\b|\bwish\s+i\s+(?:could\s+)?(?:disappear|die)\b|\bwish\s+i\s+was\s+never\s+born\b/,
    /\b(?:better|best)\s+off\s+(?:dead|without\s+me)\b/,
    /\b(?:do\s*n'?t|do\s+not|no\s+longer)\s+want\s+to\s+(?:live|be\s+alive|be\s+here|go\s+on|exist|wake\s+up)(?:\s+any\s*more)?\b/,
    /\bwhat'?s\s+the\s+point\s+(?:of|in)\s+(?:living|life|going\s+on|anything)\b|\bno\s+point\s+(?:in\s+)?(?:living|going\s+on|life)\b/,
    /\b(?:no|any)\s+reason\s+to\s+(?:live|go\s+on|be\s+alive|be\s+here)\b/,
    /\bpoint\s+(?:of|in)\s+(?:living|going\s+on|life|being\s+alive)\b/,
    /\bover\s*dos(?:e|ing)\b.{0,25}\b(?:on\s+purpose|myself|pills|to\s+die)\b|\b(?:i\s+might|i\s+will|i'?m\s+going\s+to|i\s+want\s+to|thinking\s+of|going\s+to|might)\s+over\s*dose\b/,
    /\b(?:hurt|hurting|harm|harming|cut|cutting)\s+(?:my\s*self|myself)\b/,
    /\bself[\s-]*harm/,
    /\bcan'?t\s+go\s+on\b|\bgive\s+up\s+on\s+life\b|\bnot\s+worth\s+living\b|\blife\s+(?:is|isn'?t)\s+worth\b.{0,10}\b(?:living|it)\b/,
    /\b(?:everyone|everybody|they|family)\s+(?:would\s+be|is|are)\s+better\s+off\s+without\s+me\b/,
  ],
};

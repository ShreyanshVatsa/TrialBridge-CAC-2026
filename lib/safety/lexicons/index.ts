import type { CrisisLexicon } from "../types";
import { lexicon as ar } from "./ar";
import { lexicon as en } from "./en";
import { lexicon as es } from "./es";
import { lexicon as fr } from "./fr";
import { lexicon as hi } from "./hi";
import { lexicon as ht } from "./ht";
import { lexicon as ko } from "./ko";
import { lexicon as pt } from "./pt";
import { lexicon as ru } from "./ru";
import { lexicon as tl } from "./tl";
import { lexicon as vi } from "./vi";
import { lexicon as zhHans } from "./zh-Hans";
import { lexicon as zhHant } from "./zh-Hant";

/** All lexicons, keyed by locale tag. Adding one = a file here plus an entry below. */
export const LEXICONS: Readonly<Record<string, CrisisLexicon>> = { en, es, pt, ht, "zh-Hans": zhHans, "zh-Hant": zhHant, vi, ko, tl, ar, ru, fr, hi };

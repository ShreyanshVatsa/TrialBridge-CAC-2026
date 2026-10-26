# Security audit (2026-10-07)

Scope: whole repository (backend `functions/`, `lib/privacy`, `prompts/`, `public/_headers`, client, service worker, secrets, dependencies). Review type: internal. Every fix has a regression test in `tests/unit/security-audit.test.ts` (and `tests/unit/backend-hardening.test.ts` where noted).

## Result summary

No critical or high issues found. No secrets in tracked files or git history (searched for gsk_/csk-/sk-/AKIA/Turnstile secret patterns; only the scan patterns themselves matched). `npm audit`: 0 vulnerabilities. SQL is parameterized everywhere (`?` binds; the only interpolation is a generated `?,?,?` placeholder list for at most 15 regex-validated NCT IDs). No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `window.open`, or `postMessage` to other origins in app code. External links use `rel="noopener noreferrer"`; `tel:`/`mailto:` hrefs have fixed schemes. `/trial?id=` is trimmed, upper-cased and must match `^NCT\d{8}$` before any fetch (also re-checked in `loadTrial`). localStorage holds only theme and language. The service worker caches only the app shell (never `/api`, `/data`, `/models`, `/ort`), same-origin GETs only.

## Findings

| # | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| 1 | Medium | Fail-open environment default: `wrangler.jsonc` ships `ENVIRONMENT=development`. A deploy that forgot to override it would accept Cloudflare's always-pass Turnstile test secret (if the secret was unset), dev origins, and the fixed dev salt. | `functions/index.ts`, `functions/lib/env.ts` | Fixed: dev behavior is honored only on loopback hosts (`isLoopbackHost`); any other host is forced to production. Test: "fail closed outside loopback". |
| 2 | Medium | IPv6 rate-limit bypass: the whole IP string was hashed, so a client with a /64 could rotate addresses to evade 10/30 per hour limits and drain provider budgets. | `functions/lib/ratelimit.ts` | Fixed: IPv6 bucketed by /64 before salting/hashing (raw IP still never stored). Test: "IP hashing". |
| 3 | Medium | PII scrubber gaps: full-width digits, zero-width characters splitting numbers, digits separated by spaces/dots, and "name at host dot com" emails passed through to providers. | `lib/privacy/scrub.ts` | Fixed: NFKC normalization, zero-width stripping, spaced-digit and obfuscated-email patterns. Test: "PII scrubber gaps" (also checks clinical text is not over-scrubbed). |
| 4 | Medium | Prompt-injection hardening: delimiter filter missed `< / trial_data>`, unterminated `<trial_data`, and the question was not delimiter-filtered; `""""` sequences could survive. | `prompts/analyze-v1.ts`, `prompts/ask-v1.ts` | Fixed: tolerant delimiter regex, question passes through the same filter, quotes in the question neutralized. Test: "prompt injection hardening". |
| 5 | Low | Model-written text could carry links (phishing/exfil via injected trial text or question). | `functions/lib/safety.ts` | Fixed: any model text with a URL/`www.`/`javascript:` is replaced by the neutral note (analysis and Q&A). |
| 6 | Low | Content-Type not enforced: a `text/plain` cross-site "simple" request with a JSON body was parsed (Origin check already blocked it; defense in depth). | `functions/lib/http.ts` | Fixed: only `application/json` accepted. |
| 7 | Low | Same-origin check trusted a matching Origin even if `Sec-Fetch-Site` said cross-site/same-site. | `functions/lib/http.ts` | Fixed: in production any `Sec-Fetch-Site` other than `same-origin` is refused. `Origin: null`, look-alike hosts, and http-vs-https verified. |
| 8 | Low | Turnstile response `hostname` was not checked; a token minted for another site's widget would pass. Replay is already prevented by Cloudflare's single-use tokens. | `functions/lib/turnstile.ts` | Fixed: production requires hostname to equal the request host. |
| 9 | Low | Analysis cache fragmented by NCT ID order (not a poisoning risk: keys are hashes of validated input and only verified output is stored). | `functions/lib/analyze.ts` | Fixed: IDs sorted. |
| 10 | Low | One corrupt D1 trial row made the whole request 500. | `functions/lib/trials.ts` | Fixed: row skipped. |
| 11 | Low | Headers: no CORP, no explicit no-cache for `/sw.js`, narrow Permissions-Policy. | `public/_headers` | Fixed: added `Cross-Origin-Resource-Policy`, `X-Permitted-Cross-Domain-Policies`, `X-DNS-Prefetch-Control`, `/sw.js` no-cache, more disabled features. CSP/HSTS/frame-ancestors/nosniff verified by test. |
| 12 | Low | Build secret scan covered only 7 patterns. | `scripts/postbuild.ts` | Fixed: added Bearer, AWS, GitHub, Slack, Hugging Face tokens and env-style secret assignments. Build passes (scan clean). |

Verified, no change needed: strict zod schemas reject unexpected fields (ZIP smuggling test), 16 KB limit enforced by Content-Length and a streaming reader, safe error envelopes (no stack/internal text), logs carry only request ID/route/status/latency/provider, no open redirects or SSRF (the Worker makes outbound calls only to the fixed Turnstile URL and registry provider URLs), CORS headers only in non-production for allow-listed origins, quote/citation verification (case-sensitive substring of the trial's own text, min 8 chars, unrequested trials dropped), `lockfile` with integrity hashes (registry-only resolved URLs except the two vendored packages), install scripts allow-listed.

## Design notes

- `style-src 'unsafe-inline'` and `'wasm-unsafe-eval'` in the CSP (React style attributes; ONNX Runtime). Script injection is still blocked.
- Name detection in free text covers "my name is ..." forms; the UI asks users not to include personal details and no profile fields (ZIP, exact age) are ever sent.
- Quote verification proves a quote exists in the trial, not that the model's assessment of it is right; output wording guards are regex-based.
- `vendor/fast-glob` is a 7-line shim over pinned `tinyglobby` (dev tooling only, used by `@next/eslint-plugin-next`; no brace expansion). Small supply-chain surface, reviewed; it replaces a package with an unpatched advisory.
- Production must set `RATE_LIMIT_SALT`, `TURNSTILE_SECRET_KEY`, a real `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; a missing salt falls back to a per-isolate random salt . Turnstile site key defaults to the test key (production verification would then fail closed).
- Rate limits are per IP (/64) and shared on NATs; D1 counters are not strictly atomic across regions.

## Verification run

lint clean, typecheck clean, `npm test` 246 passed with coverage thresholds met, `npm run build` (incl. secret scan) clean, `npm audit` 0 vulnerabilities, Playwright `match.spec.ts` + `qa.spec.ts` (including the data-minimization network test and cross-origin blocking) 13 passed.

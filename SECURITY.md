# Security Policy

TrialBridge is a pre-release project (version 0.1.0). It helps people explore publicly listed ClinicalTrials.gov cancer trials. It is not a medical device and does not give medical advice. No security audit, penetration test, or certification has been performed.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x (current `main`) | Yes, best effort |
| Anything older | No |

## Reporting a vulnerability

Please report suspected vulnerabilities privately by email to **vatsashrey@gmail.com**. This is the current reporting contact and can be changed (update this file when it is).

Include: what you found, steps to reproduce, affected URL or file, and the impact you expect. Please do not open a public issue, and do not include real patient data in a report.

This is a small project with no dedicated security team and no guaranteed response time or bounty. Reports will be handled on a best-effort basis.

## In scope

- The web app (static export under `out/`) and its Cloudflare Worker API (`/api/match`, `/api/analyze`, `/api/ask`).
- `public/_headers`, input validation, same-origin checks, Turnstile verification, rate limiting, and provider failover code in `functions/`.
- Leaks of secrets, profile data, or questions (client bundle, build output, logs, or requests to the backend).
- Dependencies we ship, where the issue is exploitable in this app.

## Out of scope

- Findings in third-party services themselves (Cloudflare, Turnstile, AI providers, ClinicalTrials.gov).
- Accuracy of trial data or matching results (report those as ordinary bugs).
- Denial of service through volumetric traffic, social engineering, and physical attacks.
- Vulnerabilities that only affect development tooling and are not reachable in the deployed app.

## Protections in place

- **Headers**: `public/_headers` sets a strict Content-Security-Policy (default-src 'self'; no 'unsafe-inline' for scripts, since the build externalizes inline scripts; Turnstile origins only; `object-src 'none'`; `frame-ancestors 'none'`), HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, Referrer-Policy `strict-origin-when-cross-origin`, a Permissions-Policy disabling unused features, and COOP `same-origin`. `'wasm-unsafe-eval'` is allowed because ONNX Runtime WebAssembly needs it, and `style-src` allows `'unsafe-inline'` for React style attributes.
- **Self-hosted assets**: fonts, the embedding model, and ONNX Runtime are served from the same origin. No analytics, trackers, or third-party scripts other than Cloudflare Turnstile.
- **Input validation**: shared zod schemas validate requests on the server (and client), unexpected fields are rejected, and request bodies over 16 KB are refused.
- **Same-origin only**: AI endpoints accept only same-origin requests (Origin must match; in production a cross-site/same-site `Sec-Fetch-Site` is also refused) and only `application/json` bodies. Development-mode relaxations apply only on loopback hosts, so a public deploy that forgot `ENVIRONMENT=production` still fails closed.
- **Turnstile**: bot check on AI endpoints; in production it fails closed if `TURNSTILE_SECRET_KEY` is missing.
- **Rate limits and budgets**: per-IP hourly limits (match 10/h, analyze 10/h, ask 30/h) stored in D1, keyed by `sha256(salt | UTC day | IP)` (IPv6 bucketed by /64), so the IP is never stored and the key rotates daily. Per-provider global daily budgets, a circuit breaker, and graceful degradation when providers fail.
- **No profile or question logging**: logs contain only request IDs, provider name, status, and latency.
- **Data minimization**: the browser sends only a minimized profile (cancer type, age bracket, spread, treatments, biomarkers, pregnancy, concurrent trial, language, plus coarse closed-list categories when answered: subtype, stage category, disease status, prior lines and drug classes, activity band, brain metastases, group status, sex listed in records, measurable disease, other cancer, HIV, hepatitis, transplant, autoimmune and organ-problem status). Exact age, ZIP code, and travel distance stay in the browser (the first three ZIP digits only select a static regional lookup file from the site itself); a Playwright network test checks this. Questions have personal details scrubbed before any AI call.
- **Safe rendering**: AI and trial text is rendered as plain text or React elements; `dangerouslySetInnerHTML` is not used. AI quotes are verified verbatim against trial text before display.
- **Secret handling**: secrets live only in `.dev.vars` (local, gitignored) and Cloudflare secrets (production). The build runs a scan of the output for key patterns.
- **Provider gating**: an AI provider is used only if its key is set and `dataTermsVerified` is true in `config/ai-providers.ts`; it is true for Groq and the local llama.cpp model and false for Cerebras and OpenRouter. With no key set, only the mock provider runs.
- **Dependencies**: lockfile committed and `sharp`/`fast-glob` overridden to avoid known advisories.

## Operational notes

- See docs/dev/SECURITY_AUDIT.md for the latest review, fixes, and remaining items.
- CI runs when started by hand (`.github/workflows/ci.yml`); run `npm audit` to check dependency advisories. Remaining advisories are in dev-only local and deploy tooling (`undici` via `miniflare` and `wrangler`), not in the shipped app.
- Set `RATE_LIMIT_SALT` in production; without it the salt is a fixed dev value (dev) or a random per-isolate value (production).
- Rate limits are per IP hash, so shared networks share a limit.

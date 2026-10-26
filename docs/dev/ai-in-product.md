# AI in the Product

How TrialBridge uses AI providers, what data is sent to them, and how the evaluation figures are produced.

## 1. How AI is used in the product

- Providers: configured in `config/ai-providers.ts` as Groq, Cerebras, and OpenRouter (OpenAI-compatible APIs, free tiers, failover in that order). Each is used only if its key is set and `dataTermsVerified` is true. Only Groq is marked verified; Cerebras and OpenRouter stay off. With no key set the mock provider runs.
- Mock provider: used when no provider is enabled; produces deterministic placeholder output so the app works with no keys. Its output is not real AI analysis.
- What AI does: explains possible fit and barriers for a trial given a minimized profile (`/api/analyze`), and answers questions grounded in a trial's text (`/api/ask`).
- Quote verification: AI-cited quotes must appear verbatim in the trial text; failures get one repair retry, and unverifiable answers become "not in text".
- Deterministic safety rules (crisis, eligibility, diagnosis, and treatment-advice questions) run before any AI call.
- Limits: rate limits per IP hash, per-provider daily budgets, a circuit breaker, 10 questions per trial per session in the client, and a server cap per trial per IP per day. If providers fail, the app degrades to retrieval plus rules.
- Offline/local: an optional local llama.cpp (Qwen3-14B) layer extracts eligibility facts at ingestion; only a 4-trial sample has been run. Retrieval embeddings use Xenova/all-MiniLM-L6-v2 in the browser.
- AI does not decide eligibility; results are informational. Users see "possible match" wording and an AI notice on explanations and answers.

## 2. Data sent to AI providers

- Intended payload (by design, `lib/privacy/minimize.ts`): cancer type, age bracket (decade), spread, treatments, biomarkers, pregnancy status, concurrent-trial status, language, plus public trial text. Exact age, ZIP code, and travel distance are not sent.
- Trial questions: typed by users, personal details scrubbed, sent with trial text. Users are told not to include personal information.
- Not logged by TrialBridge: profiles, questions, answers. Responses may be cached (30 days for analysis) keyed by profile/trial hashes
- Provider data terms (training use, retention, human review) should be read before any provider is marked verified. Google Gemini's free tier was deliberately excluded.

## 3. Evaluation notes

- Eval labels are synthetic and rule-generated from trial titles and conditions.
- The regression eval uses synthetic profiles; its figures measure the pipeline against those labels (`eval/REGRESSION.md`).
- Rule-fact precision is measured on sampled labels (`docs/dev/FACTS.md`).
- The mock AI metrics do not reflect real provider quality; for the Groq judge on TREC topics and a live free-tier check see `eval/RESULTS.md`.
- Translations are machine-generated.

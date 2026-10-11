# Pocket Gemini proxy

Public Gemini transport with no login, password, or CAPTCHA, as requested by the
owner. This is separate from the concept runtime; model output is not automatically
installed as facts, realizations, or language rules.

The Worker binds `GEMINI_API_KEY` to Cloudflare Secrets Store's `gemini-api-key`
with Workers scope. The key stays server-side. No proxy token is required.

Open https://pocket-gemini.kealjones.workers.dev/ to test on a phone. Test prompts
are transmitted to Google. `GET /health` checks key binding presence without
reading the key. `POST /v1/generate` accepts Gemini text `contents`, optional
`systemInstruction`, and limited `generationConfig`, including JSON output.

`GEMINI_MODEL`, `GEMINI_THINKING_LEVEL`, `UPSTREAM_TIMEOUT_MS` and `ALLOWED_ORIGINS` are server settings. Gemini 3 uses low thinking by default; clients cannot raise its thinking level. The timeout can be configured from 1 to 120 seconds. CORS restricts browsers,
not scripts outside browsers; the endpoint is intentionally public. Anyone can
use it within the limits. Configure provider quotas to control spending.

Limits: 64 KiB requests, 1 MiB responses, 60-second upstream timeout, one candidate,
4096 maximum output tokens, 10 calls per minute per Cloudflare location. The rate
limiter is approximate, not a global spending cap. No tools, arbitrary destinations,
streaming, or client-selected models. Request bodies and keys are not logged by
this code; automatic invocation logs are disabled.

Never put the Gemini key in GitHub, `.ncon`, browser builds, prompts, or URLs.
Local `.dev.vars` and `.env` files are ignored. The proxy fails closed without a
key binding or rate limiter. Mock tests: `node --test test/gemini-proxy.test.mjs`.

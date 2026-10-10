# Pocket Gemini proxy

An optional authenticated text-generation transport, separate from the concept runtime.
It does not install model output as facts, realizations, or language rules.

## Secrets

In Cloudflare: Workers & Pages → pocket-gemini → Settings → Variables and Secrets → Add.
Choose **Secret** for both values, then deploy/save the changes:

* `GEMINI_API_KEY`: your Google AI Studio Gemini API key.
* `PROXY_AUTH_TOKEN`: a unique random password of at least 32 characters (use your password manager).

Never put either secret in GitHub, `.ncon`, frontend builds, prompts, URLs, or logs.
The Gemini key remains server-side. A personal client supplies the proxy token in
an Authorization header; do not embed a shared token in a public frontend bundle.
Local secret files `.dev.vars` and `.env` are ignored by git.

## Test and use

Open the deployed Worker root URL for a mobile-friendly connection test. Enter
the proxy token, not the Gemini key. The page holds it in memory and does not
save it to browser storage. Test prompts are transmitted to Google.

`GET /health` reports whether the secrets are present (it does not validate the key).
`POST /v1/generate` accepts Gemini `contents` with text-only parts, optional
`systemInstruction`, and limited `generationConfig` fields. Authenticate with
`Authorization: Bearer <PROXY_AUTH_TOKEN>`. It returns the Gemini JSON response.
JSON output can use `responseMimeType: "application/json"` and `responseJsonSchema`.

Model: `GEMINI_MODEL`, configured server-side. Origins: comma-separated
`ALLOWED_ORIGINS`. CORS does not replace bearer authentication. There are no
client-selected upstream URLs, tools, files, streaming, or arbitrary model routing.

Limits: 64 KiB request, 1 MiB response, 30-second upstream timeout, one candidate,
at most 4096 output tokens, 10 authenticated calls per minute per Cloudflare location.
Cloudflare's rate limiter is approximate and is not a global spending cap; configure
provider quotas separately. Prompt bodies and credentials are not logged by this code;
automatic invocation logs are disabled. Cloudflare/Google may still process service
metadata according to their policies.

The proxy is fail-closed until both secrets and the rate limiter are available.
`node --test test/gemini-proxy.test.mjs` runs mock transport/security checks.
After entering real secrets, use the test page to validate an actual Gemini call.

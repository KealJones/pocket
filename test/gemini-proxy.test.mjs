import test from 'node:test';
import assert from 'node:assert/strict';
import { createProxy } from '../cloudflare/gemini-proxy/worker.mjs';
const env = { GEMINI_API_KEY: 'test-only-provider-key', GEMINI_MODEL: 'gemini-3.8-flash', ALLOWED_ORIGINS: 'https://kealjones.github.io', REQUEST_LIMITER: { limit: async () => ({ success: true }) } };
const body = { contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] };
const request = (data = body, extra = {}) => new Request('https://proxy.example/v1/generate', { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(data) });
test('Gemini proxy fails closed when key or rate limiter is missing', async () => {
  let calls = 0; const proxy = createProxy(async () => { calls++; });
  assert.equal((await proxy.fetch(request(), {})).status, 503);
  assert.equal((await proxy.fetch(request(), { ...env, REQUEST_LIMITER: undefined })).status, 503);
  assert.equal(calls, 0);
});
test('Gemini proxy restricts origins, tools, models and rate-limited calls', async () => {
  let calls = 0; const proxy = createProxy(async () => { calls++; });
  assert.equal((await proxy.fetch(request(body, { origin: 'https://other.example' }), env)).status, 403);
  assert.equal((await proxy.fetch(request({ ...body, tools: [{ codeExecution: {} }] }), env)).status, 400);
  assert.equal((await proxy.fetch(request({ ...body, model: 'arbitrary' }), env)).status, 400);
  assert.equal((await proxy.fetch(request(), { ...env, REQUEST_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
  assert.equal(calls, 0);
});
test('Gemini proxy caps actual request bytes and validates config', async () => {
  const proxy = createProxy(async () => { throw Error('Unexpected call'); });
  assert.equal((await proxy.fetch(request({ contents: [{ parts: [{ text: 'x'.repeat(70000) }] }] }), env)).status, 413);
  assert.equal((await proxy.fetch(request({ ...body, generationConfig: { maxOutputTokens: 9000 } }), env)).status, 400);
});
test('Gemini proxy sends provider key only upstream and returns structured output with CORS', async () => {
  const response = { candidates: [{ content: { parts: [{ text: '{"lesson":"example"}' }] } }] };
  const proxy = createProxy(async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    assert.equal(options.headers['x-goog-api-key'], env.GEMINI_API_KEY);
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.redirect, 'error');
    const parsed = JSON.parse(options.body);
    assert.equal(parsed.generationConfig.candidateCount, 1);
    assert.equal(parsed.generationConfig.temperature, 0);
    assert.deepEqual(parsed.generationConfig.responseJsonSchema, { type: 'object' });
    return Response.json(response);
  });
  const result = await proxy.fetch(request({ ...body, generationConfig: { responseMimeType: 'application/json', responseJsonSchema: { type: 'object' } } }, { origin: 'https://kealjones.github.io' }), env);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('access-control-allow-origin'), 'https://kealjones.github.io');
  assert.deepEqual(await result.json(), response);
});
test('Gemini proxy redacts upstream errors and bounds response bytes', async () => {
  const proxy = createProxy(async () => Response.json({ error: env.GEMINI_API_KEY }, { status: 403 }));
  const result = await proxy.fetch(request(), env);
  assert.equal(result.status, 502);
  assert.ok(!(await result.text()).includes(env.GEMINI_API_KEY));
  const huge = createProxy(async () => new Response('x'.repeat(1048577)));
  assert.equal((await huge.fetch(request(), env)).status, 413);
});
test('Gemini proxy serves a phone test page without provider secrets', async () => {
  const proxy = createProxy();
  const result = await proxy.fetch(new Request('https://proxy.example/'), env);
  assert.ok(result.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  const html = await result.text();
  assert.ok(html.includes('width=device-width'));
  assert.ok(!html.includes(env.GEMINI_API_KEY));
  assert.ok(!html.includes('type="password"'));
  assert.equal((await (await proxy.fetch(new Request('https://proxy.example/health'), {})).json()).configured, false);
});
test('Secrets Store values resolve only after validation and failures are redacted', async () => {
  let reads = 0;
  const bound = { ...env, GEMINI_API_KEY: { get: async () => { reads++; return 'test-only-store-value'; } } };
  const proxy = createProxy(async (url, options) => { assert.equal(options.headers['x-goog-api-key'], 'test-only-store-value'); return Response.json({ candidates: [] }); });
  const health = await (await proxy.fetch(new Request('https://proxy.example/health'), bound)).json();
  assert.equal(health.keyBound, true);
  assert.equal(reads, 0);
  assert.equal((await proxy.fetch(request({ ...body, tools: [] }), bound)).status, 400);
  assert.equal(reads, 0);
  assert.equal((await proxy.fetch(request(), bound)).status, 200);
  assert.equal(reads, 1);
  const failed = await proxy.fetch(request(), { ...env, GEMINI_API_KEY: { get: async () => { throw Error('sensitive test value'); } } });
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes('sensitive test value'));
});

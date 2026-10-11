const MAX_REQUEST = 65536, MAX_RESPONSE = 1048576;
class HTTPError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function boundedText(body, limit) {
  if (!body) return '';
  const reader = body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new HTTPError(413, 'Payload exceeds byte limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });
function textContent(value) {
  if (!value || !Array.isArray(value.parts) || !value.parts.length || value.parts.length > 32) throw new HTTPError(400, 'Expected text parts');
  return { parts: value.parts.map(p => {
    if (!p || typeof p.text !== 'string' || !p.text.trim() || Object.keys(p).some(k => k !== 'text')) throw new HTTPError(400, 'Only text parts are supported');
    return { text: p.text };
  }) };
}
function payload(body) {
  if (!body || !Array.isArray(body.contents) || !body.contents.length || body.contents.length > 32) throw new HTTPError(400, 'Expected contents array');
  if (Object.keys(body).some(k => !['contents', 'systemInstruction', 'generationConfig'].includes(k))) throw new HTTPError(400, 'Unsupported request field');
  const result = { contents: body.contents.map(c => {
    if (!c || !['user', 'model'].includes(c.role ?? 'user') || Object.keys(c).some(k => !['role', 'parts'].includes(k))) throw new HTTPError(400, 'Invalid content role or field');
    return { ...textContent(c), role: c.role ?? 'user' };
  }) };
  if (result.contents.at(-1).role !== 'user') throw new HTTPError(400, 'Last content must have user role');
  if (body.systemInstruction) result.systemInstruction = textContent(body.systemInstruction);
  const config = body.generationConfig ?? {};
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(k => !['temperature', 'maxOutputTokens', 'responseMimeType', 'responseJsonSchema'].includes(k))) throw new HTTPError(400, 'Unsupported generation configuration');
  const tokens = config.maxOutputTokens ?? 1024, temperature = config.temperature ?? 0;
  if (!Number.isInteger(tokens) || tokens < 1 || tokens > 4096 || typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new HTTPError(400, 'Invalid generation limits');
  result.generationConfig = { candidateCount: 1, maxOutputTokens: tokens, temperature };
  if (config.responseMimeType) {
    if (!['text/plain', 'application/json'].includes(config.responseMimeType)) throw new HTTPError(400, 'Unsupported response MIME type');
    result.generationConfig.responseMimeType = config.responseMimeType;
  }
  if (config.responseJsonSchema) {
    if (config.responseMimeType !== 'application/json' || typeof config.responseJsonSchema !== 'object' || Array.isArray(config.responseJsonSchema)) throw new HTTPError(400, 'JSON schema needs JSON response MIME type');
    result.generationConfig.responseJsonSchema = config.responseJsonSchema;
  }
  return result;
}
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocket Gemini proxy</title><style>body{font:16px system-ui;background:#f6f5ef;color:#243a36;margin:0;padding:24px}main{max-width:620px;margin:auto}input,textarea,button{font:inherit;box-sizing:border-box;width:100%;padding:14px;margin:8px 0 20px;border:1px solid #cad2c6;border-radius:10px}textarea{min-height:140px}button{background:#365e4c;color:white;min-height:48px}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{line-height:1.5}button:disabled{opacity:.5}</style><main><h1>Pocket · Gemini proxy</h1><p id="health">Checking configuration…</p><p>This tests the model connection. Pocket's learning engine is separate.</p><form id="form"><label for="prompt">Test prompt</label><textarea id="prompt" required placeholder="Write a short greeting."></textarea><button id="send">Test Gemini</button></form><small>Your prompt is sent to Google when you press Test Gemini. No login or password is required.</small><pre id="result" aria-live="polite"></pre></main><script src="/client.js"></script></html>`;
const client = `const form=document.getElementById('form'),result=document.getElementById('result'),send=document.getElementById('send');fetch('/health').then(r=>r.json()).then(s=>document.getElementById('health').textContent=s.configured?'Ready to test.':'Add the Cloudflare secrets first.').catch(()=>document.getElementById('health').textContent='Unable to check configuration.');form.addEventListener('submit',async e=>{e.preventDefault();send.disabled=true;result.textContent='Calling Gemini…';try{const r=await fetch('/v1/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:document.getElementById('prompt').value}]}]})});const data=await r.json();if(!r.ok)throw Error(data.error);result.textContent=(data.candidates??[]).flatMap(c=>c.content?.parts??[]).filter(p=>!p.thought).map(p=>p.text??'').join('')||JSON.stringify(data,null,2);}catch(e){result.textContent=e.message;}finally{send.disabled=false;}});`;
export function createProxy(fetcher = fetch) {
  return { async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get('origin');
    const allowed = new Set((env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean));
    allowed.add(url.origin);
    if (origin && !allowed.has(origin)) return json({ error: 'Origin is not allowed' }, 403);
    const cors = origin ? { 'access-control-allow-origin': origin, 'vary': 'Origin' } : {};
    if (request.method === 'OPTIONS' && url.pathname === '/v1/generate') return new Response(null, { status: 204, headers: { ...headers, ...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' } });
    const keyBound = typeof env.GEMINI_API_KEY === 'string' ? !!env.GEMINI_API_KEY.trim() : typeof env.GEMINI_API_KEY?.get === 'function';
    const configured = keyBound;
    if (request.method === 'GET' && url.pathname === '/health') return json({ service: 'pocket-gemini', configured, keyBound, access: 'public', model: env.GEMINI_MODEL ?? 'gemini-3.8-flash' });
    if (request.method === 'GET' && url.pathname === '/') return new Response(page, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" } });
    if (request.method === 'GET' && url.pathname === '/client.js') return new Response(client, { headers: { ...headers, 'content-type': 'text/javascript; charset=utf-8' } });
    if (url.pathname !== '/v1/generate') return json({ error: 'Not found' }, 404, cors);
    if (request.method !== 'POST') return json({ error: 'Use POST' }, 405, { ...cors, allow: 'POST' });
    if (!configured) return json({ error: 'Bind GEMINI_API_KEY in Cloudflare' }, 503, cors);
    if (!env.REQUEST_LIMITER) return json({ error: 'Rate limiter is unavailable' }, 503, cors);
    if (!(await env.REQUEST_LIMITER.limit({ key: 'pocket-gemini-public' })).success) return json({ error: 'Too many requests; try again in a minute' }, 429, { ...cors, 'retry-after': '60' });
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json({ error: 'Use application/json' }, 415, cors);
    const upstreamTimeout=Number(env.UPSTREAM_TIMEOUT_MS??60000);
    if(!Number.isInteger(upstreamTimeout)||upstreamTimeout<1000||upstreamTimeout>120000)return json({error:'Invalid server timeout setting'},503,cors);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), upstreamTimeout);
    try {
      let raw; try { raw = JSON.parse(await boundedText(request.body, MAX_REQUEST)); } catch (error) { if (error instanceof HTTPError) throw error; throw new HTTPError(400, 'Invalid JSON'); }
      const body = payload(raw), model = env.GEMINI_MODEL ?? 'gemini-3.8-flash';
      if (!/^gemini-[a-z0-9.-]+$/.test(model)) throw new HTTPError(503, 'Invalid server model setting');
      if(model.startsWith('gemini-3')){
        const thinkingLevel=env.GEMINI_THINKING_LEVEL??'low';
        if(!['low','medium','high'].includes(thinkingLevel))throw new HTTPError(503,'Invalid server thinking level');
        body.generationConfig.thinkingConfig={thinkingLevel};
      }
      // Resolve Secrets Store only inside the Worker after request validation.
      let apiKey; try { apiKey = typeof env.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY : await env.GEMINI_API_KEY.get(); } catch { throw new HTTPError(503, 'Gemini secret is unavailable'); }
      if (typeof apiKey !== 'string' || !apiKey.trim()) throw new HTTPError(503, 'Gemini secret is unavailable');
      const response = await fetcher('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', { method: 'POST', redirect: 'manual', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey.trim() }, body: JSON.stringify(body) });
      if (!response.ok) {
        await response.body?.cancel();
        // Never reflect upstream errors: they can include credentials or input.
        return json({ error: 'Gemini request failed', upstreamStatus: response.status }, response.status === 429 ? 429 : 502, cors);
      }
      const text = await boundedText(response.body, MAX_RESPONSE); let data;
      try { data = JSON.parse(text); } catch { throw new HTTPError(502, 'Gemini returned an invalid response'); }
      return json(data, 200, cors);
    } catch (error) { return json({ error: error instanceof HTTPError ? error.message : controller.signal.aborted ? 'Gemini request timed out' : 'Gemini connection failed', ...(error instanceof HTTPError ? {} : {code: /illegal invocation/i.test(error.message ?? '') ? 'IllegalInvocation' : /header/i.test(error.message ?? '') ? 'InvalidHeader' : ['TypeError','AbortError','TimeoutError'].includes(error.name) ? error.name : 'TransportError'}) }, error instanceof HTTPError ? error.status : controller.signal.aborted ? 504 : 502, cors); }
    finally { clearTimeout(timer); }
  } };
}
export default createProxy();

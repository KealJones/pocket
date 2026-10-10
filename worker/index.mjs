// Transport only. Concept interpretation and learned procedures stay in ProjectCore.
export function publicAddress(raw) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw new Error('Expected a public HTTP(S) address without credentials');
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|test)$/.test(host) || host.includes(':') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Local addresses are unavailable');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a,b] = host.split('.').map(Number);
    if ([0,10,127].includes(a) || a >= 224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127)) throw new Error('Local addresses are unavailable');
  }
  url.hash = ''; return url;
}
export async function retrieve(raw, fetcher = fetch) {
  let url = publicAddress(raw);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    for (let redirects=0; redirects<=4; redirects++) {
      const response = await fetcher(url.href, { redirect:'manual', signal:controller.signal, headers:{Accept:'application/json,text/plain,text/html', 'User-Agent':'NapkinNext/0.3 learning-research'} });
      if ([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location'); if (!location) throw new Error('Redirect has no destination');
        url = publicAddress(new URL(location,url).href); continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error('Source HTTP '+response.status); }
      if (!response.body) throw new Error('Empty source response');
      const reader = response.body.getReader(), chunks = []; let length=0;
      for (;;) {
        const {value,done}=await reader.read(); if(done) break;
        length+=value.byteLength;
        if(length>1000000) { await reader.cancel(); throw new Error('Source exceeds byte budget'); }
        chunks.push(value);
      }
      const body=new Uint8Array(length); let offset=0; for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
      return new Response(body,{headers:{'content-type':response.headers.get('content-type')||'text/plain','x-napkin-source-url':url.href,'cache-control':'no-store'}});
    }
    throw new Error('Source exceeds redirect budget');
  } finally { clearTimeout(timer); }
}
export function createWorker(assets, fetcher = fetch) {
  return { async fetch(request) {
    const url=new URL(request.url);
    if(url.pathname==='/api/fetch') {
      if(request.method!=='POST') return new Response('Use POST',{status:405});
      // Dispatch enforces the existing owner-private Site audience.
      // Never forward visitor cookies, identity headers, or service credentials.
      if(Number(request.headers.get('content-length')||0)>8192) return new Response('Request too large',{status:413});
      try { const text=await request.text(); if(text.length>8192) throw new Error('Request too large'); const input=JSON.parse(text); return await retrieve(input.url,fetcher); }
      catch(error){return Response.json({error:error.message},{status:502});}
    }
    if(!['GET','HEAD'].includes(request.method)) return new Response('Method unavailable',{status:405});
    const asset=assets[url.pathname==='/'?'/index.html':url.pathname];
    if(!asset) return new Response('Not found',{status:404});
    const bytes=Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0));
    return new Response(request.method==='HEAD'?null:bytes,{headers:{'content-type':asset.type,'cache-control':'no-cache','x-content-type-options':'nosniff'}});
  }};
}

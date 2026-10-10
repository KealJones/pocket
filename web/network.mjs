// Same-origin server retrieval supports arbitrary public sites without browser CORS.
export async function researchFetch(url, options = {}) {
  const address = new URL(url, location.origin);
  if(address.origin === location.origin) return fetch(address.href,options);
  const response = await fetch('/api/fetch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:address.href}),signal:options.signal});
  if(!response.ok) {
    const data=await response.json().catch(()=>({})); throw new Error(data.error || 'Source retrieval HTTP '+response.status);
  }
  return response;
}

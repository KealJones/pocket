const normalize=text=>text.normalize('NFC').toLowerCase().replace(/\s+/gu,' ').trim();

// Optimal-string-alignment distance supplies alternatives only. Neighboring
// concepts, typed slots and contextual requirements still choose the reading.
export function repairDistance(left,right,maximum=2){
 const a=[...normalize(left)],b=[...normalize(right)];if(Math.abs(a.length-b.length)>maximum)return maximum+1;
 let older=null,previous=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const current=[i];let least=i;
  for(let j=1;j<=b.length;j++){
   current[j]=Math.min(previous[j]+1,current[j-1]+1,previous[j-1]+Number(a[i-1]!==b[j-1]));
   if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])current[j]=Math.min(current[j],older[j-2]+1);
   least=Math.min(least,current[j]);
  }
  if(least>maximum)return maximum+1;older=previous;previous=current;
 }
 return previous[b.length];
}

export function repairSearch(store,profile,policy){
 let scans=0,proposals=0,exhausted=false;const cache=new Map(),hypotheses=new Map();
 const supports=store.parts('SurfaceRepairPolicy').map(p=>p.support),surfaces=store.db.prepare("SELECT s.* FROM surfaces s JOIN records r ON r.id=s.record WHERE r.active=1 AND (s.profile='' OR s.profile=?) ORDER BY s.key,s.target,s.record").all(profile);
 const distance=(raw,expected)=>{
  const key=normalize(raw)+'\n'+normalize(expected);if(cache.has(key))return cache.get(key);
  if(raw.length>policy.maximumCharacters||expected.length>policy.maximumCharacters||Math.min(raw.length,expected.length)<policy.minimumCharacters||!/[\p{L}]/u.test(raw)||!/[\p{L}]/u.test(expected))return null;
  if(++scans>policy.maximumScans){exhausted=true;return null;}
  const d=repairDistance(raw,expected,policy.maximumDistance),accepted=d>0&&d<=policy.maximumDistance&&d/Math.max(raw.length,expected.length)<=policy.maximumRatio?d:null;
  cache.set(key,accepted);return accepted;
 };
 const hypothesis=(raw,expected,d)=>{
  const key=normalize(raw)+'\n'+normalize(expected);if(hypotheses.has(key))return hypotheses.get(key);
  if(++proposals>policy.maximumProposals){exhausted=true;return null;}
  const result={raw,expected,distance:d,penalty:d*policy.penalty,supports};hypotheses.set(key,result);return result;
 };
 return {surfaces,supports,policy,distance,hypothesis,get exhausted(){return exhausted;}};
}

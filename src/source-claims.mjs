import {call,term} from './ncon.mjs';import{digest}from'./digest.mjs';
export const sourceIdentity=(source,id)=>term('C_'+digest(source+'|'+id));
const external=id=>typeof id==='string'&&/^[QP]\d+$/.test(id);
// Source-schema decoding, shared by lexical acquisition and relationship research.
// All statements remain attributed, including deprecated/qualified claims. Users
// of a claim must check its applicability; decoding does not make it current truth.
export function decodeClaims(source,entity){
 const records=[];
 for(const[property,claims]of Object.entries(entity.claims??{}))for(const claim of claims){
  const snak=claim.mainsnak;if(!external(property)||!snak)continue;
  const data=snak.datavalue,value=data?.value,target=value?.id&&external(value.id)?sourceIdentity(source,value.id):call('SourceValue',[JSON.stringify(value??null)],{datatype:snak.datatype??null,type:data?.type??null,snaktype:snak.snaktype??null});
  records.push(call('SourceClaim',[sourceIdentity(source,entity.id),sourceIdentity(source,property),target],{statement:claim.id??null,rank:claim.rank??null,qualifiers:JSON.stringify(claim.qualifiers??{}),references:JSON.stringify(claim.references??[]),revision:entity.lastrevid??null}));
 }
 return records;
}

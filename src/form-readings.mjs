import {values,field} from './ncon.mjs';
export const formKey=text=>text.normalize('NFC').toLowerCase().replace(/\s+/gu,' ').trim();

// Form relationships propose readings of an occurrence; they do not alter text,
// merge concepts, select a sense or authorize an executable action.
export function formReadings(store,profile){
 const forms=new Map();
 for(const [identity]of store.definitions())for(const part of store.parts(identity,'ReadSpelling')){
  const [raw,expected]=values(part.expression),scope=field(part.expression,'profile','');
  if(scope&&scope!==profile||typeof raw!=='string'||typeof expected!=='string'||!raw.trim()||!expected.trim())continue;
  const key=formKey(raw),held=forms.get(key)??[];held.push({expected,support:part.support});forms.set(key,held);
 }
 return forms;
}

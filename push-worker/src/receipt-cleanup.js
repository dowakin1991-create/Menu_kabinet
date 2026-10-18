import {serviceToken} from './firebase.js';

const monthPattern=/^20\d\d-(0[1-9]|1[0-2])$/;
const receiptPattern=/^[a-f0-9-]{36}$/;
function kyivDay(now) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  return Date.UTC(parts.year,parts.month-1,parts.day)/86400000;
}
export async function cleanupExpiredReceipts(env,{now=new Date(),fetcher=fetch,maxEvents=40}={}) {
  if(!env.FIREBASE_SERVICE_ACCOUNT||!env.FIREBASE_PROJECT) throw Error('Missing Firebase configuration');
  const token=await serviceToken(env);
  const root=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT)}/databases/(default)/documents`;
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const request=async(url,options={})=>{
    const response=await fetcher(url,{...options,headers,signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error(`Firestore cleanup request failed: ${response.status}`);
    return response.json();
  };
  const currentDay=kyivDay(now);
  let pageToken='',processed=0,deleted=0,visited=0;
  do {
    const url=new URL(root+'/schedules');
    url.searchParams.set('pageSize','100');
    if(pageToken)url.searchParams.set('pageToken',pageToken);
    const page=await request(url.href);
    for(const schedule of page.documents||[]){
      const month=schedule.name.split('/').pop();
      if(!monthPattern.test(month))continue;
      visited++;
      const [year,m]=month.split('-').map(Number);
      const entries=schedule.fields?.banquets?.mapValue?.fields||{};
      for(const [day,event] of Object.entries(entries)){
        if(processed>=maxEvents)return{processed,deleted,visited,hasMore:true};
        const d=Number(day);
        if(!Number.isInteger(d)||d<1||d>new Date(Date.UTC(year,m,0)).getUTCDate())continue;
        if(currentDay-Date.UTC(year,m-1,d)/86400000<14)continue;
        const fields=event?.mapValue?.fields;
        if(!fields||fields.type?.stringValue==='cleaning')continue;
        const ids=(fields.receiptIds?.arrayValue?.values||[]).map(v=>v.stringValue).filter(id=>receiptPattern.test(id));
        if(!ids.length)continue;
        // Atomic commit keeps the schedule reference and receipt documents in sync.
        const newEntries=structuredClone(entries);
        newEntries[day].mapValue.fields.receiptIds={arrayValue:{values:[]}};
        const writes=[{update:{name:schedule.name,fields:{banquets:{mapValue:{fields:newEntries}}}},updateMask:{fieldPaths:['banquets']},currentDocument:{updateTime:schedule.updateTime}}];
        for(const id of ids)writes.push({delete:`${schedule.name}/receipts/${id}`});
        await request(root+':commit',{method:'POST',body:JSON.stringify({writes})});
        schedule.fields.banquets.mapValue.fields=newEntries;
        // The write changes the schedule version; avoid a stale precondition on another event.
        processed++;deleted+=ids.length;
        break;
      }
    }
    pageToken=page.nextPageToken||'';
  }while(pageToken);
  return{processed,deleted,visited,hasMore:false};
}

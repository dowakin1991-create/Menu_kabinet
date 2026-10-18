import {buildPushPayload} from '@block65/webcrypto-web-push';
import {ApiError, authenticate, access, document} from './firebase.js';
import {validateSubscription, deviceId} from './policy.js';
import {sendPush} from './transport.js';
import {cleanupExpiredReceipts} from './receipt-cleanup.js';
const routes = new Set(['pushConfig','pushSubscribe','pushUnsubscribe','pushSchedule','pushDeliver','accountAlert']);
async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks=[]; let size=0;
  while (true) {
    const {value, done}=await reader.read(); if(done)break;
    size+=value.length;
    if(size>8192){await reader.cancel();throw new ApiError('invalid-argument','Запит завеликий.',413);}
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ApiError('invalid-argument','Некоректний запит.');}
}
export function createHandler(deps={authenticate,access,document,buildPushPayload,send:sendPush}) {
  return async function handle(request,env) {
    const origin=request.headers.get('Origin');
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
    if(origin!==env.ALLOWED_ORIGIN)return new Response('Forbidden',{status:403,headers});
    Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
    try {
      const route=new URL(request.url).pathname.slice(1);
      if(request.method!=='POST'||!routes.has(route))throw new ApiError('not-found','Сторінку не знайдено.',404);
      if(!env.VAPID_JSON||!env.FIREBASE_SERVICE_ACCOUNT)throw new ApiError('not-configured','Сервіс сповіщень ще не підключено.',503);
      const uid=await deps.authenticate(request,env,route==='pushSchedule'||route==='pushDeliver', ['pushConfig','pushSubscribe','pushUnsubscribe','accountAlert'].includes(route));
      const data=await readBody(request),db=env.DB;
      const vapid=JSON.parse(env.VAPID_JSON);
      if(route==='pushConfig')return reply({publicKey:vapid.publicKey});
      if(route==='pushSubscribe') {
        let sub;
        try{sub=validateSubscription(data.subscription);}catch{throw new ApiError('invalid-argument','Некоректна підписка.');}
        try {
          await db.prepare('INSERT INTO devices(id,uid,subscription) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET uid=excluded.uid,subscription=excluded.subscription')
            .bind(await deviceId(sub.endpoint),uid,JSON.stringify(sub)).run();
        } catch(e) {if(String(e).includes('DEVICE_LIMIT'))throw new ApiError('resource-exhausted','Ліміт — 10 пристроїв.',429);throw e;}
        return reply({ok:true});
      }
      if(route==='pushUnsubscribe') {
        if(typeof data.endpoint!=='string'||data.endpoint.length>2048)throw new ApiError('invalid-argument','Некоректний пристрій.');
        await db.prepare('DELETE FROM devices WHERE id=? AND uid=?').bind(await deviceId(data.endpoint),uid).run();
        return reply({ok:true});
      }
      if(route==='accountAlert') {
        if(!['registered','approved'].includes(data.event))throw new ApiError('invalid-argument','Неправильна подія.');
        if(typeof data.uid!=='string'||data.uid.length>128||data.uid.includes('/'))throw new ApiError('invalid-argument','Неправильний акаунт.');
        const owner='yBHHkxuh4OSboz1gGOtZFqmfVHE3';
        if(data.event==='registered'&&data.uid!==uid)throw new ApiError('permission-denied','Доступ заборонено.',403);
        if(data.event==='approved'&&uid!==owner)throw new ApiError('permission-denied','Тільки власник може підтвердити акаунт.',403);
        const profile=await deps.document(env,'userDirectory/'+data.uid);
        if(!profile||profile.status!==(data.event==='registered'?'pending':'approved'))throw new ApiError('failed-precondition','Статус акаунта не збігається.');
        if(data.event==='registered'){
          const now=Date.now();
          const permitted=await db.prepare("INSERT INTO rate(id,at) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET at=excluded.at WHERE rate.at < ? RETURNING at").bind('signup-'+uid,now,now-86400000).first();
          if(!permitted)return reply({accepted:0,failed:0,duplicate:true});
        }
        const target=data.event==='registered'?owner:data.uid;
        const devices=await db.prepare('SELECT subscription FROM devices WHERE uid=? LIMIT 10').bind(target).all();
        let accepted=0,failed=0;
        for(const device of devices.results||[]){
          try{
            const subscription=validateSubscription(JSON.parse(device.subscription));
            const details={accountEvent:data.event,name:String(profile.name||'Користувач').slice(0,80)};
            const payload=await deps.buildPushPayload({data:JSON.stringify(details),options:{ttl:3600}},subscription,vapid);
            const response=await deps.send(subscription.endpoint,payload);
            if(response.ok)accepted++;else failed++;
          }catch{failed++;}
        }
        return reply({accepted,failed});
      }
      if(route==='pushSchedule') {
        if(typeof data.month!=='string'||!/^20\d\d-(0[1-9]|1[0-2])$/.test(data.month))throw new ApiError('invalid-argument','Некоректний місяць.');
        if(!Array.isArray(data.notices)||data.notices.length<1||data.notices.length>31)throw new ApiError('invalid-argument','Додайте від 1 до 31 опису змін.');
        const daysInMonth=new Date(Number(data.month.slice(0,4)),Number(data.month.slice(5,7)),0).getDate();
        const notices=data.notices.map(item=>{
          if(!item||!['schedule','schedule-added','banquet','cleaning','cancel-banquet','cancel-cleaning'].includes(item.kind)||!Number.isInteger(item.day)||item.day<1||item.day>daysInMonth)throw new ApiError('invalid-argument','Некоректна зміна графіка.');
          if(item.endDay !== undefined && (item.kind!=='schedule-added'||!Number.isInteger(item.endDay)||item.endDay<item.day||item.endDay>daysInMonth))throw new ApiError('invalid-argument','Некоректний діапазон дат.');
           return {kind:item.kind,day:item.day,...(item.kind==='schedule-added'?{endDay:item.endDay}: {})};
        });
        if(!await deps.document(env,`schedules/${data.month}`))throw new ApiError('failed-precondition','Спочатку збережіть графік.');
        const now=Date.now();
        const rate=await db.prepare("INSERT INTO rate(id,at) VALUES('team',?) ON CONFLICT(id) DO UPDATE SET at=excluded.at WHERE rate.at < ? RETURNING at").bind(now,now-60000).first();
        if(!rate)throw new ApiError('resource-exhausted','Зачекайте хвилину перед наступною розсилкою.',429);
        const count=await db.prepare('SELECT COUNT(*) AS n FROM devices').first();
        if(count.n>500)throw new ApiError('resource-exhausted','Перевищено ліміт пристроїв команди.',429);
        const jobId=crypto.randomUUID();
        await db.batch([
          db.prepare('DELETE FROM deliveries WHERE job IN (SELECT id FROM jobs WHERE expires < ?)').bind(now),
          db.prepare('DELETE FROM job_payload WHERE job IN (SELECT id FROM jobs WHERE expires < ?)').bind(now),
          db.prepare('DELETE FROM jobs WHERE expires < ?').bind(now),
          db.prepare('INSERT INTO jobs(id,owner,expires) VALUES(?,?,?)').bind(jobId,uid,now+600000),
          db.prepare('INSERT INTO job_payload(job,month,notices) VALUES(?,?,?)').bind(jobId,data.month,JSON.stringify(notices)),
          db.prepare('INSERT INTO deliveries(job,idx,device) SELECT ?,ROW_NUMBER() OVER (ORDER BY id)-1,id FROM devices').bind(jobId)
        ]);
        const total=await db.prepare('SELECT COUNT(*) AS n FROM deliveries WHERE job=?').bind(jobId).first();
        return reply({jobId,total:total.n});
      }
      // One push per request keeps encryption and subrequests within Free plan limits.
      if(typeof data.jobId!=='string'||!Number.isInteger(data.index)||data.index<0||data.index>=500)throw new ApiError('invalid-argument','Некоректне надсилання.');
      const job=await db.prepare('SELECT * FROM jobs WHERE id=? AND owner=? AND expires>?').bind(data.jobId,uid,Date.now()).first();
      if(!job)throw new ApiError('permission-denied','Розсилку завершено або доступ відкликано.',403);
      const claimed=await db.prepare("UPDATE deliveries SET status='sending' WHERE job=? AND idx=? AND status='pending' RETURNING device").bind(data.jobId,data.index).first();
      if(!claimed)return reply({accepted:0,failed:0,removed:0,skipped:1});
      let result={accepted:0,failed:0,removed:0};
      let stage='recipient';
      try {
        const device=await db.prepare('SELECT * FROM devices WHERE id=?').bind(claimed.device).first();
        if(!device||!await deps.access(env,device.uid)) {
          if(device)await db.prepare('DELETE FROM devices WHERE id=? AND uid=?').bind(device.id,device.uid).run();
          result.removed=1;
        } else {
          stage='subscription';
          const subscription=validateSubscription(JSON.parse(device.subscription));
          stage='encryption';
          const details=await db.prepare('SELECT month, notices FROM job_payload WHERE job=?').bind(data.jobId).first();
          const payloadData=details?{title:'KABINET',month:details.month,notices:JSON.parse(details.notices)}:{title:'KABINET',body:'Графік оновлено. Відкрийте кабінет, щоб переглянути зміни.'};
          const payload=await deps.buildPushPayload({data:JSON.stringify(payloadData),options:{ttl:3600}},subscription,vapid);
          stage='provider';
          const response=await deps.send(subscription.endpoint,payload);
          if(response.ok)result.accepted=1;
          else if(response.status===404||response.status===410){await db.prepare('DELETE FROM devices WHERE id=? AND uid=?').bind(device.id,device.uid).run();result.removed=1;}
          else {
            result.failed=1;
            result.diagnostic='provider-http-'+response.status;
            // Only known machine codes, never raw responses, endpoints or credentials.
            try {
              const reason=(await response.json()).reason;
              if(['BadJwtToken','BadVapidPublicKey','VapidPkHashMismatch','BadTtl','BadUrgency','BadWebPushRequest','PayloadTooLarge','TooManyRequests'].includes(reason))result.diagnostic+='-'+reason;
            } catch {}
          }
        }
      } catch(error) {
        result.failed=1;
        const kind=['TypeError','DataError','InvalidAccessError','OperationError','TimeoutError','AbortError'].includes(error.name)?error.name:'Error';
        result.diagnostic=stage+'-'+kind;
      }
      await db.prepare('UPDATE deliveries SET status=? WHERE job=? AND idx=?').bind(result.accepted?'accepted':result.removed?'removed':'failed',data.jobId,data.index).run();
      return reply(result);
    } catch(error) {
      return reply({error:{code:error.code||'unavailable',message:error instanceof ApiError?error.message:'Сервіс тимчасово недоступний. Спробуйте пізніше.'}},error.status||503);
    }
  };
}
export default {fetch:createHandler(),async scheduled(event,env,ctx){ctx.waitUntil(cleanupExpiredReceipts(env));}};

import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import {SQLite} from '../scripts/sqlite';import sourceWorker from '../worker/index';import type {Env} from '../worker/types';
import {addDays,dateKey,timeKey} from '../src/lib/date';
const worker=process.env.TEST_BUNDLE?(await import('../build/worker.js' as string)).default:sourceWorker;
async function fixture(){
 const db=new SQLite();for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.raw.exec(readFileSync('migrations/'+file,'utf8'));
 const env:Env={MTLS_MODE:'local',DB:db,APP_ORIGIN:'http://127.0.0.1:3000',AUTH_PEPPER:'test-secret-pepper-32-bytes-long-value',SETUP_TOKEN:'test-setup-token-32-bytes-long-value',SETUP_EXPIRES:String(Date.now()+86400000)};
 let rev=0,cookie='',csrf='';
 async function call(path:string,method='GET',body?:any){const res=await worker.fetch(new Request(env.APP_ORIGIN+'/api/'+path,{method,headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(body!==undefined?{body:JSON.stringify({revision:rev,...body})}:{})}),env);const data:any=await res.json();if(res.ok&&data.revision)rev=data.revision;return {status:res.status,data};}
 await call('setup','POST',{token:env.SETUP_TOKEN,login:'admin',name:'テスト管理者',password:'test-password-long-enough'});
 const login=await worker.fetch(new Request(env.APP_ORIGIN+'/api/auth/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({login:'admin',password:'test-password-long-enough'})}),env);
 cookie=login.headers.get('set-cookie')!.split(';')[0];const me:any=await login.json();csrf=me.csrf;rev=(await call('changes')).data.revision;
 const nurse=(await call('staff','POST',{login:'nurse',name:'看護師',profession:'看護師',color:'#d6336c',role:'STAFF',active:true})).data.id;
 const patient=(await call('patients','POST',{number:'P1',name:'架空 太郎',kana:'かくう たろう',address:'',movacalUrl:'',handover:'',facilityId:null,active:true})).data.id;
 const day=addDays(dateKey(new Date().toISOString()),7);
 const add=(date:string,title:string,start:string,patientId:string|null=null,extra:any={})=>call('appointments','POST',{patientId,title,date,startTime:start,endTime:start.slice(0,3)+'30',staffIds:[me.staff.id],memo:'メモ '+title,recurrence:null,...extra});
 const onDay=async(d:string)=>((await call(`appointments?from=${d}&to=${addDays(d,1)}`)).data.data as any[]);
 return {call,add,onDay,day,me:me.staff.id as string,nurse,patient};
}
const ref=(items:any[])=>items.map(a=>({id:a.id,version:a.version}));

test('bulk copy duplicates a day at the same times, keeps the source and skips what is already there',async()=>{
 const f=await fixture();const to=addDays(f.day,7);
 await f.add(f.day,'午前の訪問','09:00',f.patient,{mark:'初'});await f.add(f.day,'午後の会議','14:00');
 const src=await f.onDay(f.day);
 const r=await f.call('appointments/bulk-copy','POST',{items:ref(src),date:to});assert.equal(r.status,200,JSON.stringify(r.data));
 assert.deepEqual([r.data.copied,r.data.skipped],[2,0]);
 const copied=await f.onDay(to);
 assert.deepEqual(copied.map(a=>[timeKey(a.startsAt),timeKey(a.endsAt),a.title,a.patientId,a.memo,a.mark,a.seriesId]),[['09:00','09:30','午前の訪問',f.patient,'メモ 午前の訪問','',null],['14:00','14:30','午後の会議',null,'メモ 午後の会議','',null]]);
 assert.ok(copied.every(a=>!src.some(s=>s.id===a.id)));
 assert.equal((await f.onDay(f.day)).length,2);
 // もう一度押すと、患者の予定は同じ時刻にあるので除外、一般予定はそのまま増える。
 const again=await f.call('appointments/bulk-copy','POST',{items:ref(await f.onDay(f.day)),date:to,copyMemo:false});
 assert.deepEqual([again.data.copied,again.data.skipped],[1,1]);
 assert.deepEqual((await f.onDay(to)).map(a=>a.memo),['メモ 午前の訪問','メモ 午後の会議','']);
 const audit=(await f.call('audit')).data.filter((a:any)=>a.action==='POST_appointments_bulk-copy');assert.deepEqual(audit.map((x:any)=>x.entity_id).sort(),[`${to}:1`,`${to}:2`]);
});

test('bulk copy can reassign staff, copies one day of a series as a one-off, and validates input',async()=>{
 const f=await fixture();const to=addDays(f.day,1);
 await f.add(f.day,'毎週','10:00',f.patient,{recurrence:{kind:'weekly',interval:1,weekdays:[new Date(f.day+'T00:00:00Z').getUTCDay()],ordinals:[]},endDate:addDays(f.day,14)});
 const src=await f.onDay(f.day);assert.ok(src[0].seriesId);
 const r=await f.call('appointments/bulk-copy','POST',{items:ref(src),date:to,staffIds:[f.nurse,f.me]});assert.equal(r.status,200,JSON.stringify(r.data));
 const [c]=await f.onDay(to);assert.deepEqual([c.staffIds,c.seriesId,c.occurrenceDate,c.memo],[[f.nurse,f.me],null,null,'メモ 毎週']);
 assert.equal((await f.call('appointments/bulk-copy','POST',{items:ref(src),date:f.day})).status,400);
 assert.equal((await f.call('appointments/bulk-copy','POST',{items:ref(src),date:'2026-02-30'})).status,400);
 assert.equal((await f.call('appointments/bulk-copy','POST',{items:[],date:to})).status,400);
 assert.equal((await f.call('appointments/bulk-copy','POST',{items:ref(src),date:addDays(to,1),staffIds:['nobody']})).status,400);
 assert.equal((await f.call('appointments/bulk-copy','POST',{items:ref(src),date:to})).status,409);
 assert.equal((await f.call('appointments/bulk-copy','POST',{items:src.map(a=>({id:a.id,version:a.version+1})),date:addDays(to,2)})).status,409);
 assert.equal((await f.onDay(addDays(to,2))).length,0);
});

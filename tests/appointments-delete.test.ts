import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import {SQLite} from '../scripts/sqlite';import sourceWorker from '../worker/index';import type {Env} from '../worker/types';
import {addDays,dateKey} from '../src/lib/date';
const worker=process.env.TEST_BUNDLE?(await import('../build/worker.js' as string)).default:sourceWorker;
async function fixture(){
 const db=new SQLite();for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.raw.exec(readFileSync('migrations/'+file,'utf8'));
 const env:Env={MTLS_MODE:'local',DB:db,APP_ORIGIN:'http://127.0.0.1:3000',AUTH_PEPPER:'test-secret-pepper-32-bytes-long-value',SETUP_TOKEN:'test-setup-token-32-bytes-long-value',SETUP_EXPIRES:String(Date.now()+86400000)};
 let rev=0,cookie='',csrf='';
 async function call(path:string,method='GET',body?:any){const res=await worker.fetch(new Request(env.APP_ORIGIN+'/api/'+path,{method,headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(body!==undefined?{body:JSON.stringify({revision:rev,...body})}:{})}),env);const data:any=await res.json();if(res.ok&&data.revision)rev=data.revision;return {status:res.status,data};}
 await call('setup','POST',{token:env.SETUP_TOKEN,login:'admin',name:'テスト管理者',password:'test-password-long-enough'});
 const login=await worker.fetch(new Request(env.APP_ORIGIN+'/api/auth/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({login:'admin',password:'test-password-long-enough'})}),env);
 cookie=login.headers.get('set-cookie')!.split(';')[0];const me:any=await login.json();csrf=me.csrf;rev=(await call('changes')).data.revision;
 const day=addDays(dateKey(new Date().toISOString()),7);
 const add=(date:string,title:string,recurrence:any=null)=>call('appointments','POST',{patientId:null,title,date,startTime:'09:00',endTime:'09:30',staffIds:[me.staff.id],memo:'メモ',recurrence,...(recurrence?{endDate:addDays(date,14)}:{})});
 const onDay=async(d:string)=>(await call(`appointments?from=${d}&to=${addDays(d,1)}`)).data.data as any[];
 return {db,call,add,onDay,day};
}

test('bulk delete removes only the listed appointments, and only that day of a series',async()=>{
 const f=await fixture();
 await f.add(f.day,'午前');await f.add(f.day,'午後');await f.add(addDays(f.day,1),'翌日');await f.add(f.day,'毎週',{kind:'weekly',interval:1,weekdays:[new Date(f.day+'T00:00:00Z').getUTCDay()],ordinals:[]});
 const items=await f.onDay(f.day);assert.equal(items.length,3);
 const r=await f.call('appointments/bulk-delete','POST',{items:items.map(a=>({id:a.id,version:a.version}))});assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal((await f.onDay(f.day)).length,0);
 assert.deepEqual((await f.onDay(addDays(f.day,1))).map(a=>a.title),['翌日']);
 assert.deepEqual((await f.onDay(addDays(f.day,7))).map(a=>a.title),['毎週']);
 const audit=(await f.call('audit')).data.filter((a:any)=>a.action==='POST_appointments_bulk-delete');assert.equal(audit.length,1);assert.equal(audit[0].entity_id,`${f.day}:3`);
});

test('bulk delete is all-or-nothing and validates the list',async()=>{
 const f=await fixture();
 await f.add(f.day,'午前');await f.add(f.day,'午後');
 const items=await f.onDay(f.day);
 assert.equal((await f.call('appointments/'+items[1].id+'/memo','PATCH',{memo:'更新',version:items[1].version})).status,200);
 const stale=await f.call('appointments/bulk-delete','POST',{items:items.map(a=>({id:a.id,version:a.version}))});assert.equal(stale.status,409);
 assert.equal((await f.onDay(f.day)).length,2);
 assert.equal((await f.call('appointments/bulk-delete','POST',{items:[]})).status,400);
 assert.equal((await f.call('appointments/bulk-delete','POST',{items:Array.from({length:301},(_,i)=>({id:'x'+i,version:1}))})).status,400);
 assert.equal((await f.call('appointments/bulk-delete','POST',{items:[{id:items[0].id,version:items[0].version},{id:items[0].id,version:items[0].version}]})).status,400);
 assert.equal((await f.call('appointments/bulk-delete','GET')).status,404);
 const fresh=await f.onDay(f.day);
 assert.equal((await f.call('appointments/bulk-delete','POST',{items:fresh.map(a=>({id:a.id,version:a.version}))})).status,200);
 assert.equal((await f.call('appointments/bulk-delete','POST',{items:fresh.map(a=>({id:a.id,version:a.version+1}))})).status,409);
});

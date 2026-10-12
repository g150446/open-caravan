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
 const day=addDays(dateKey(new Date().toISOString()),7);
 const add=(title:string,startTime:string,recurrence:any=null)=>call('appointments','POST',{patientId:null,title,date:day,startTime,endTime:startTime.replace(/:00$/,':30'),staffIds:[me.staff.id],memo:'',recurrence,...(recurrence?{endDate:addDays(day,14)}:{})});
 const onDay=async(d=day)=>(await call(`appointments?from=${d}&to=${addDays(d,1)}`)).data.data as any[];
 return {call,add,onDay,day};
}
const times=(list:any[])=>list.map(a=>`${a.title} ${timeKey(a.startsAt)}-${timeKey(a.endsAt)}`);

test('batch update moves times and deletes together, only for that day of a series',async()=>{
 const f=await fixture();
 await f.add('一',`09:00`);await f.add('二','10:00');await f.add('毎週','11:00',{kind:'weekly',interval:1,weekdays:[new Date(f.day+'T00:00:00Z').getUTCDay()],ordinals:[]});
 const [one,two,weekly]=await f.onDay();
 const r=await f.call('appointments/batch-update','POST',{updates:[{id:weekly.id,version:weekly.version,startTime:'08:30',endTime:'09:00'},{id:one.id,version:one.version,startTime:'09:15',endTime:'09:45'}],deletes:[{id:two.id,version:two.version}]});
 assert.equal(r.status,200,JSON.stringify(r.data));
 assert.deepEqual(times(await f.onDay()),['毎週 08:30-09:00','一 09:15-09:45']);
 assert.equal((await f.onDay()).find(a=>a.title==='毎週').exception,true);
 assert.deepEqual(times(await f.onDay(addDays(f.day,7))),['毎週 11:00-11:30']);
 const audit=(await f.call('audit')).data.filter((a:any)=>a.action==='POST_appointments_batch-update');assert.equal(audit.length,1);assert.equal(audit[0].entity_id,`${f.day}:3`);
});

test('batch update is all-or-nothing and validates its input',async()=>{
 const f=await fixture();
 await f.add('一','09:00');await f.add('二','10:00');const [one,two]=await f.onDay();
 assert.equal((await f.call('appointments/'+two.id+'/memo','PATCH',{memo:'更新',version:two.version})).status,200);
 assert.equal((await f.call('appointments/batch-update','POST',{updates:[{id:one.id,version:one.version,startTime:'08:00',endTime:'08:30'},{id:two.id,version:two.version,startTime:'08:30',endTime:'09:00'}]})).status,409);
 assert.deepEqual(times(await f.onDay()),['一 09:00-09:30','二 10:00-10:30']);
 assert.equal((await f.call('appointments/batch-update','POST',{updates:[{id:one.id,version:one.version,startTime:'09:30',endTime:'09:00'}]})).status,400);
 assert.equal((await f.call('appointments/batch-update','POST',{updates:[{id:one.id,version:one.version,startTime:'25:00',endTime:'26:00'}]})).status,400);
 assert.equal((await f.call('appointments/batch-update','POST',{})).status,400);
 assert.equal((await f.call('appointments/batch-update','POST',{updates:[{id:one.id,version:one.version,startTime:'08:00',endTime:'08:30'}],deletes:[{id:one.id,version:one.version}]})).status,400);
 assert.equal((await f.call('appointments/batch-update','POST',{deletes:Array.from({length:301},(_,i)=>({id:'x'+i,version:1}))})).status,400);
 assert.deepEqual(times(await f.onDay()),['一 09:00-09:30','二 10:00-10:30']);
});

import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import {SQLite} from '../scripts/sqlite';import sourceWorker from '../worker/index';import type {Env} from '../worker/types';
import {addDays,dateKey} from '../src/lib/date';
const worker=process.env.TEST_BUNDLE?(await import('../build/worker.js' as string)).default:sourceWorker;
function fixture(){
 const db=new SQLite();for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.raw.exec(readFileSync('migrations/'+file,'utf8'));
 const env:Env={MTLS_MODE:'local',DB:db,APP_ORIGIN:'http://127.0.0.1:3000',AUTH_PEPPER:'test-secret-pepper-32-bytes-long-value',SETUP_TOKEN:'test-setup-token-32-bytes-long-value',SETUP_EXPIRES:String(Date.now()+86400000)};
 let rev=1;type Session={cookie:string;csrf:string;id?:string};const none:Session={cookie:'',csrf:''};
 async function call(s:Session,path:string,method='GET',body?:any){const res=await worker.fetch(new Request(env.APP_ORIGIN+'/api/'+path,{method,headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json',Cookie:s.cookie,'X-CSRF-Token':s.csrf},...(body!==undefined?{body:JSON.stringify(method==='GET'?body:{revision:rev,...body})}:{})}),env);const data:any=await res.json();if(res.ok&&data.revision)rev=data.revision;return {status:res.status,data};}
 async function login(id:string,password:string):Promise<Session|null>{const res=await worker.fetch(new Request(env.APP_ORIGIN+'/api/auth/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({login:id,password})}),env);if(!res.ok)return null;const data:any=await res.json();return {cookie:res.headers.get('set-cookie')!.split(';')[0],csrf:data.csrf,id:data.staff.id};}
 return {call,login,none,setup:async()=>{await call(none,'setup','POST',{token:env.SETUP_TOKEN,login:'admin',name:'テスト管理者',password:'test-password-long-enough'});return (await login('admin','test-password-long-enough'))!;}};
}
const nurse={login:'nurse',name:'テスト看護師',kana:'てすと かんごし',profession:'看護師',color:'#336699',role:'STAFF',active:true};
const staffOf=async(f:ReturnType<typeof fixture>,admin:any,id:string)=>(await f.call(admin,'bootstrap')).data.data.staff.find((s:any)=>s.id===id);

test('admins stop and resume staff; stopped staff cannot log in',async()=>{
 const f=fixture(),admin=await f.setup();
 const id=(await f.call(admin,'staff','POST',{...nurse,password:'nurse-password-long'})).data.id;
 assert.equal((await f.call(admin,'staff/'+id,'PATCH',{...await staffOf(f,admin,id),active:false})).status,200);
 assert.equal(await f.login('nurse','nurse-password-long'),null);
 assert.equal((await f.call(admin,'staff/'+id,'PATCH',{...await staffOf(f,admin,id),active:true})).status,200);
 const session=await f.login('nurse','nurse-password-long');assert(session);
 assert.equal((await f.call(session,'staff/'+admin.id,'DELETE',{version:1})).status,403);
 assert.equal((await f.call(admin,'staff/'+admin.id,'DELETE',{version:1})).status,400);
});

test('deleting staff keeps their name for past visits, frees the login and is blocked by future visits',async()=>{
 const f=fixture(),admin=await f.setup();
 const id=(await f.call(admin,'staff','POST',{...nurse,password:'nurse-password-long'})).data.id;
 const today=dateKey(new Date().toISOString());
 assert.equal((await f.call(admin,'appointments','POST',{patientId:null,title:'過去の訪問',date:addDays(today,-3),startTime:'09:00',endTime:'09:30',staffIds:[admin.id,id],memo:'',recurrence:null})).status,200);
 assert.equal((await f.call(admin,'appointments','POST',{patientId:null,title:'今後の訪問',date:addDays(today,3),startTime:'09:00',endTime:'09:30',staffIds:[admin.id,id],memo:'',recurrence:null})).status,200);
 const nurseSession=await f.login('nurse','nurse-password-long');assert(nurseSession);
 let staff=await staffOf(f,admin,id);
 const blocked=await f.call(admin,'staff/'+id,'DELETE',{version:staff.version});assert.equal(blocked.status,409);assert.match(blocked.data.error,/今後の予定が1件/);
 const upcoming=(await f.call(admin,`appointments?from=${addDays(today,3)}&to=${addDays(today,4)}`)).data.data[0];
 assert.equal((await f.call(admin,'appointments/'+upcoming.id,'DELETE',{version:upcoming.version,scope:'one'})).status,200);
 assert.equal((await f.call(admin,'staff/'+id,'DELETE',{version:staff.version-1})).status,409);
 assert.equal((await f.call(admin,'staff/'+id,'DELETE',{version:staff.version})).status,200);
 staff=await staffOf(f,admin,id);assert.equal(staff.deleted,true);assert.equal(staff.active,false);assert.equal(staff.name,'テスト看護師');assert(!('passwordHash' in staff));
 assert.equal((await f.call(nurseSession,'bootstrap')).status,401);
 assert.equal(await f.login('nurse','nurse-password-long'),null);
 assert.equal((await f.call(admin,'staff/'+id,'PATCH',{...staff,active:true})).status,404);
 assert.equal((await f.call(admin,'staff/'+id,'DELETE',{version:staff.version})).status,404);
 assert.equal((await f.call(admin,'staff','POST',{...nurse,password:'another-password-long'})).status,200);
 assert(await f.login('nurse','another-password-long'));
 const past=(await f.call(admin,`appointments?from=${addDays(today,-3)}&to=${addDays(today,-2)}`)).data.data[0];assert.deepEqual(past.staffIds,[admin.id,id]);
});

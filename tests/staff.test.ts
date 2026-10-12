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
 return {db,call,login,none,setup:async()=>{await call(none,'setup','POST',{token:env.SETUP_TOKEN,login:'admin',name:'テスト管理者',password:'test-password-long-enough'});return (await login('admin','test-password-long-enough'))!;}};
}
const nurse={login:'nurse',name:'テスト看護師',kana:'てすと かんごし',profession:'看護師',color:'#336699',role:'STAFF',active:true};
// 仮パスワードで初回ログインし、本人のパスワードを設定するまでを行う。
async function enroll(f:ReturnType<typeof fixture>,admin:any,body:any,password:string){
 const r=await f.call(admin,'staff','POST',body);assert.equal(r.status,200,JSON.stringify(r.data));assert.match(r.data.temporaryPassword,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
 const first=await f.login(body.login,r.data.temporaryPassword);assert(first);
 assert.equal((await f.call(first,'auth/password','POST',{current:r.data.temporaryPassword,next:password})).status,200);
 return r.data.id as string;
}
const staffOf=async(f:ReturnType<typeof fixture>,admin:any,id:string)=>(await f.call(admin,'bootstrap')).data.data.staff.find((s:any)=>s.id===id);

test('admins stop and resume staff; stopped staff cannot log in',async()=>{
 const f=fixture(),admin=await f.setup();
 const id=await enroll(f,admin,nurse,'nurse-password-long');
 assert.equal((await f.call(admin,'staff/'+id,'PATCH',{...await staffOf(f,admin,id),active:false})).status,200);
 assert.equal(await f.login('nurse','nurse-password-long'),null);
 assert.equal((await f.call(admin,'staff/'+id,'PATCH',{...await staffOf(f,admin,id),active:true})).status,200);
 const session=await f.login('nurse','nurse-password-long');assert(session);
 assert.equal((await f.call(session,'staff/'+admin.id,'DELETE',{version:1})).status,403);
 assert.equal((await f.call(admin,'staff/'+admin.id,'DELETE',{version:1})).status,400);
});

test('deleting staff keeps their name for past visits, frees the login and is blocked by future visits',async()=>{
 const f=fixture(),admin=await f.setup();
 const id=await enroll(f,admin,nurse,'nurse-password-long');
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
 await enroll(f,admin,nurse,'another-password-long');
 assert(await f.login('nurse','another-password-long'));
 const past=(await f.call(admin,`appointments?from=${addDays(today,-3)}&to=${addDays(today,-2)}`)).data.data[0];assert.deepEqual(past.staffIds,[admin.id,id]);
});

test('new staff get a temporary password and must set their own before using the app',async()=>{
 const f=fixture(),admin=await f.setup();
 const r=await f.call(admin,'staff','POST',{...nurse,password:'admin-chosen-password'});assert.equal(r.status,200);
 assert.equal(await f.login('nurse','admin-chosen-password'),null);
 const temporary=r.data.temporaryPassword as string;assert(Date.parse(r.data.temporaryExpires)>Date.now()+6*86400000);
 const session=(await f.login('nurse',temporary))!;assert(session);
 const me=await f.call(session,'auth/me');assert.equal(me.status,200);assert.equal(me.data.staff.mustChangePassword,true);assert(!('passwordHash' in me.data.staff));
 assert.equal((await f.call(session,'bootstrap')).status,403);
 assert.equal((await f.call(session,'appointments','POST',{patientId:null,title:'x',date:'2030-01-01',startTime:'09:00',endTime:'09:30',staffIds:[session.id],memo:'',recurrence:null})).status,403);
 assert.equal((await f.call(session,'auth/password','POST',{current:'wrong-password',next:'nurse-password-long'})).status,400);
 assert.equal((await f.call(session,'auth/password','POST',{current:temporary,next:'short'})).status,400);
 assert.equal((await f.call(session,'auth/password','POST',{current:temporary,next:temporary})).status,400);
 assert.equal((await f.call(session,'auth/password','POST',{current:temporary,next:'nurse-password-long'})).status,200);
 assert.equal((await f.call(session,'bootstrap')).status,200);
 assert.equal((await f.call(session,'auth/me')).data.staff.mustChangePassword,undefined);
 assert.equal(await f.login('nurse',temporary),null);
 assert(await f.login('nurse','nurse-password-long'));
 // 自分のパスワード変更はほかのセッションを切り、今のセッションは残す。
 const other=(await f.login('nurse','nurse-password-long'))!;
 assert.equal((await f.call(session,'auth/password','POST',{current:'nurse-password-long',next:'nurse-password-newer'})).status,200);
 assert.equal((await f.call(other,'bootstrap')).status,401);assert.equal((await f.call(session,'bootstrap')).status,200);
 const audit=(await f.call(admin,'audit')).data;assert(audit.some((a:any)=>a.action==='POST_auth_password'&&a.actor_id===session.id));
});

test('temporary passwords expire and admins can reissue them',async()=>{
 const f=fixture(),admin=await f.setup();
 const r=await f.call(admin,'staff','POST',nurse);const id=r.data.id;
 (f as any).db.raw.prepare("UPDATE records SET data=json_set(data,'$.temporaryExpires','2000-01-01T00:00:00.000Z') WHERE id=?").run(id);
 assert.equal(await f.login('nurse',r.data.temporaryPassword),null);
 const staff=(await f.call(admin,'bootstrap')).data.data.staff.find((s:any)=>s.id===id);
 const session=await enroll(f,admin,{...nurse,login:'nurse2'},'nurse2-password-long');
 const nurse2=(await f.login('nurse2','nurse2-password-long'))!;
 assert.equal((await f.call(nurse2,`staff/${id}/temporary-password`,'POST',{version:staff.version})).status,403);
 assert.equal((await f.call(admin,`staff/${admin.id}/temporary-password`,'POST',{version:1})).status,400);
 const again=await f.call(admin,`staff/${id}/temporary-password`,'POST',{version:staff.version});assert.equal(again.status,200);
 assert.notEqual(again.data.temporaryPassword,r.data.temporaryPassword);
 assert(await f.login('nurse',again.data.temporaryPassword));
 // パスワードを忘れたスタッフ: 再発行で今のパスワードとセッションが無効になる。
 const n2=(await f.call(admin,'bootstrap')).data.data.staff.find((s:any)=>s.id===session);
 assert.equal((await f.call(admin,`staff/${session}/temporary-password`,'POST',{version:n2.version})).status,200);
 assert.equal((await f.call(nurse2,'bootstrap')).status,401);assert.equal(await f.login('nurse2','nurse2-password-long'),null);
 // 編集しても仮パスワードの状態は残る。
 const edited=(await f.call(admin,'bootstrap')).data.data.staff.find((s:any)=>s.id===id);
 assert.equal((await f.call(admin,'staff/'+id,'PATCH',{...edited,name:'改名した看護師'})).status,200);
 assert.equal((await f.call(admin,'bootstrap')).data.data.staff.find((s:any)=>s.id===id).mustChangePassword,true);
});

test('logins, failed logins and logouts are recorded; only admins may import CSV or bulk-delete',async()=>{
 const f=fixture(),admin=await f.setup();
 const id=await enroll(f,admin,nurse,'nurse-password-long');
 assert.equal(await f.login('nurse','wrong-password-long'),null);
 assert.equal(await f.login('nobody','whatever-password'),null);
 const session=(await f.login('nurse','nurse-password-long'))!;
 assert.equal((await f.call(session,'imports/patients')).status,403);
 assert.equal((await f.call(session,'imports/patients/start','POST',{})).status,403);
 assert.equal((await f.call(session,'appointments/bulk-delete','POST',{items:[{id:'x',version:1}]})).status,403);
 assert.equal((await f.call(session,'auth/logout','POST',{})).status,200);
 const audit=(await f.call(admin,'audit')).data as any[],has=(action:string,actor:string)=>audit.some(a=>a.action===action&&a.actor_id===actor);
 assert(has('LOGIN',id)&&has('LOGIN_FAILED',id)&&has('LOGIN_FAILED','-')&&has('LOGOUT',id)&&has('LOGIN',admin.id!));
 // 存在しないIDでの失敗には、入力された文字を残さない。
 assert(!JSON.stringify(audit).includes('nobody'));
 const res=await worker.fetch(new Request('http://127.0.0.1:3000/'),{MTLS_MODE:'local',APP_ORIGIN:'http://127.0.0.1:3000'} as Env);
 assert.equal(res.headers.get('strict-transport-security'),'max-age=31536000');
});

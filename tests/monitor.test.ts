import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';import {readFileSync,readdirSync} from 'node:fs';
import {SQLite} from '../scripts/sqlite';import sourceWorker from '../worker/index';import type {Env} from '../worker/types';
const worker=process.env.TEST_BUNDLE?(await import('../build/worker.js' as string)).default:sourceWorker;
const secret='monitor-ticket-secret-32-bytes-long-value';
function fixture(extra:Partial<Env>={MONITOR_TICKET_SECRET:secret,MONITOR_WS_URL:'wss://monitor.example.com/ws'}){
 const db=new SQLite();for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.raw.exec(readFileSync('migrations/'+file,'utf8'));
 const env:Env={MTLS_MODE:'local',DB:db,APP_ORIGIN:'http://127.0.0.1:3000',AUTH_PEPPER:'test-secret-pepper-32-bytes-long-value',SETUP_TOKEN:'test-setup-token-32-bytes-long-value',SETUP_EXPIRES:String(Date.now()+86400000),...extra};
 let rev=1;type Session={cookie:string;csrf:string;id?:string};const none:Session={cookie:'',csrf:''};
 async function call(s:Session,path:string,method='GET',body?:any){const res=await worker.fetch(new Request(env.APP_ORIGIN+'/api/'+path,{method,headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json',Cookie:s.cookie,'X-CSRF-Token':s.csrf},...(body!==undefined?{body:JSON.stringify(method==='GET'?body:{revision:rev,...body})}:{})}),env);const data:any=await res.json();if(res.ok&&data.revision)rev=data.revision;return {status:res.status,data,headers:res.headers};}
 async function login(id:string,password:string):Promise<Session>{const res=await worker.fetch(new Request(env.APP_ORIGIN+'/api/auth/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({login:id,password})}),env);assert(res.ok);const data:any=await res.json();return {cookie:res.headers.get('set-cookie')!.split(';')[0],csrf:data.csrf,id:data.staff.id};}
 return {db,call,login,setup:async()=>{await call(none,'setup','POST',{token:env.SETUP_TOKEN,login:'admin',name:'テスト管理者',password:'test-password-long-enough'});return login('admin','test-password-long-enough');}};
}
type F=ReturnType<typeof fixture>;type S=Awaited<ReturnType<F['login']>>;
const nurse={login:'nurse',name:'テスト看護師',kana:'',profession:'看護師',color:'#336699',role:'STAFF',active:true};
async function enroll(f:F,admin:S,body=nurse){const r=await f.call(admin,'staff','POST',body);assert.equal(r.status,200,JSON.stringify(r.data));const first=await f.login(body.login,r.data.temporaryPassword);assert.equal((await f.call(first,'auth/password','POST',{current:r.data.temporaryPassword,next:'nurse-password-long'})).status,200);return {id:r.data.id as string,session:await f.login(body.login,'nurse-password-long')};}
const staffOf=async(f:F,admin:S,id:string)=>(await f.call(admin,'bootstrap')).data.data.staff.find((s:any)=>s.id===id);
const grant=async(f:F,admin:S,id:string,canMonitor:boolean)=>assert.equal((await f.call(admin,'staff/'+id,'PATCH',{...await staffOf(f,admin,id),canMonitor})).status,200);

test('monitoring is off by default and a ticket needs the permission',async()=>{
 const f=fixture(),admin=await f.setup(),{id,session}=await enroll(f,admin);
 assert.equal((await staffOf(f,admin,id)).canMonitor,false);
 assert.equal((await f.call(session,'monitor/ticket','POST',{})).status,403);
 assert.equal((await f.call(admin,'monitor/ticket','POST',{})).status,403);
 await grant(f,admin,id,true);
 assert.equal((await f.call(session,'monitor/ticket','POST',{})).status,200);
 await grant(f,admin,id,false);
 assert.equal((await f.call(session,'monitor/ticket','POST',{})).status,403);
});
test('staff cannot grant the permission to themselves',async()=>{
 const f=fixture(),admin=await f.setup(),{id,session}=await enroll(f,admin);
 assert.equal((await f.call(session,'staff/'+id,'PATCH',{...await staffOf(f,admin,id),canMonitor:true})).status,403);
 assert.equal((await staffOf(f,admin,id)).canMonitor,false);
});
test('the ticket is signed, short-lived and audited only when a connection starts',async()=>{
 const f=fixture(),admin=await f.setup(),{id,session}=await enroll(f,admin);await grant(f,admin,id,true);
 const r=await f.call(session,'monitor/ticket','POST',{});assert.equal(r.data.url,'wss://monitor.example.com/ws');
 const [payload,signature]=r.data.ticket.split('.');assert.equal(signature,createHmac('sha256',secret).update(payload).digest('base64url'));
 const claims=JSON.parse(Buffer.from(payload,'base64url').toString());assert.equal(claims.aud,'call-monitor');assert.equal(claims.sub,id);assert.equal(claims.name,nurse.name);assert(claims.exp<=Date.now()/1000+60);assert(claims.jti);
 const count=()=>f.db.raw.prepare("SELECT count(*) AS n FROM audit WHERE action='MONITOR_TICKET'").get() as {n:number};
 assert.equal(count().n,1);assert.equal((await f.call(session,'monitor/ticket','POST',{renew:true})).status,200);assert.equal(count().n,1);
});
test('the ticket requires login, CSRF and complete configuration',async()=>{
 const f=fixture(),admin=await f.setup(),{id,session}=await enroll(f,admin);await grant(f,admin,id,true);
 assert.equal((await f.call({cookie:'',csrf:''},'monitor/ticket','POST',{})).status,401);
 assert.equal((await f.call({...session,csrf:'wrong'},'monitor/ticket','POST',{})).status,403);
 for(const missing of [{MONITOR_TICKET_SECRET:'short',MONITOR_WS_URL:'wss://monitor.example.com/ws'},{MONITOR_TICKET_SECRET:secret}]){
  const g=fixture(missing),a=await g.setup(),e=await enroll(g,a);await grant(g,a,e.id,true);assert.equal((await g.call(e.session,'monitor/ticket','POST',{})).status,503);
 }
});
test('the content security policy allows only the configured monitor socket',async()=>{
 const f=fixture(),r=await f.call({cookie:'',csrf:''},'health');assert.match(r.headers.get('content-security-policy')!,/connect-src 'self' wss:\/\/monitor\.example\.com https:\/\/monitor\.example\.com;/);
 const g=fixture({}),s=await g.call({cookie:'',csrf:''},'health');assert.match(s.headers.get('content-security-policy')!,/connect-src 'self';/);
});

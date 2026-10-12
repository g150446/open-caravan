import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import {SQLite} from '../scripts/sqlite';import sourceWorker from '../worker/index';import type {Env} from '../worker/types';
import {addDays,dateKey} from '../src/lib/date';
const worker=process.env.TEST_BUNDLE?(await import('../build/worker.js' as string)).default:sourceWorker;

async function fixture(env:Partial<Env>={}){
 const db=new SQLite();for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.raw.exec(readFileSync('migrations/'+file,'utf8'));
 const e:Env={MTLS_MODE:'local',DB:db,APP_ORIGIN:'http://127.0.0.1:3000',AUTH_PEPPER:'test-secret-pepper-32-bytes-long-value',SETUP_TOKEN:'test-setup-token-32-bytes-long-value',SETUP_EXPIRES:String(Date.now()+86400000),...env};
 let rev=0,cookie='',csrf='';
 async function call(path:string,method='GET',body?:any){const res=await worker.fetch(new Request(e.APP_ORIGIN+'/api/'+path,{method,headers:{Origin:e.APP_ORIGIN,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(body!==undefined?{body:JSON.stringify({revision:rev,...body})}:{})}),e);const data:any=await res.json();if(res.ok&&data.revision)rev=data.revision;return {status:res.status,data};}
 await call('setup','POST',{token:e.SETUP_TOKEN,login:'admin',name:'テスト管理者',password:'test-password-long-enough'});
 const login=await worker.fetch(new Request(e.APP_ORIGIN+'/api/auth/login',{method:'POST',headers:{Origin:e.APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({login:'admin',password:'test-password-long-enough'})}),e);
 cookie=login.headers.get('set-cookie')!.split(';')[0];const me:any=await login.json();csrf=me.csrf;rev=(await call('changes')).data.revision;
 const day=addDays(dateKey(new Date().toISOString()),7);
 const facility=(await call('facilities','POST',{name:'テスト施設',address:'北海道テスト町3-3'})).data.id;
 const patient=async(number:string,name:string,address:string,facilityId:string|null=null)=>(await call('patients','POST',{number,name,kana:'',address,movacalUrl:'',facilityId,handover:'',visitFrequency:''})).data.id as string;
 const add=async(patientId:string|null,startTime:string,endTime:string,extra:any={})=>{await call('appointments','POST',{patientId,title:patientId?'':'会議',date:day,startTime,endTime,staffIds:[me.staff.id],memo:'',recurrence:null,...extra});};
 const onDay=async()=>((await call(`appointments?from=${day}&to=${addDays(day,1)}`)).data.data as any[]);
 return {db,env:e,call,patient,add,onDay,day,facility};
}
function googleMock(){
 const calls:{url:string;body?:any;headers:Record<string,string>}[]=[];const original=globalThis.fetch;
 globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=String(input);calls.push({url,body:init?.body?JSON.parse(String(init.body)):undefined,headers:Object.fromEntries(new Headers(init?.headers).entries())});
  if(url.startsWith('https://routes.googleapis.com/')){const n=JSON.parse(String(init!.body)).intermediates.length+1;const at=(i:number)=>({latLng:{latitude:43+i/100,longitude:141.7+i/100}});return Response.json({routes:[{distanceMeters:1000*n,duration:`${600*n}s`,polyline:{encodedPolyline:'abc'},legs:Array.from({length:n},(_,i)=>({distanceMeters:1000+i,duration:`${(10+i)*60}s`,startLocation:at(i),endLocation:at(i+1)}))}]});}
  if(url.startsWith('https://maps.googleapis.com/maps/api/staticmap'))return new Response(new Uint8Array([255,216,255,217]),{headers:{'content-type':'image/jpeg'}});
  return new Response('not found',{status:404});
 }) as typeof fetch;
 return {calls,restore(){globalThis.fetch=original;}};
}

test('routes are computed from D1 addresses only, grouped by facility, without patient names',async()=>{
 const f=await fixture({GOOGLE_MAPS_API_KEY:'test-key'}),g=googleMock();try{
  const a=await f.patient('R1','架空 一郎','北海道テスト町1-1'),b=await f.patient('R2','架空 二郎','',f.facility),c=await f.patient('R3','架空 三郎','',f.facility),d=await f.patient('R4','住所 なし','');
  await f.add(a,'09:00','09:30');await f.add(b,'10:00','10:30');await f.add(c,'10:30','11:00');await f.add(d,'11:00','11:30');
  const ids=(await f.onDay()).map(x=>x.id);
  assert.equal((await f.call('routes','POST',{appointmentIds:ids,avoidHighways:true})).status,400,'office address is required first');
  const bootstrap=(await f.call('bootstrap')).data.data;assert.deepEqual({...bootstrap.settings},{officeName:'',officeAddress:'',marginMinutes:10,version:0});
  assert.equal((await f.call('settings','PATCH',{officeName:'テスト診療所',officeAddress:'北海道テスト町9-9',marginMinutes:5,version:0})).status,200);
  assert.equal((await f.call('settings','PATCH',{officeName:'x',officeAddress:'y',marginMinutes:5,version:0})).status,409);
  const r=await f.call('routes','POST',{appointmentIds:ids,avoidHighways:true});assert.equal(r.status,200,JSON.stringify(r.data));
  assert.deepEqual(r.data.stops.map((s:any)=>s.ids.length),[1,2]);assert.deepEqual(r.data.skipped,[ids[3]]);
  assert.deepEqual(r.data.legs.map((l:any)=>l.minutes),[10,11,12]);assert.match(r.data.map,/^data:image\/jpeg;base64,/);
  const routes=g.calls.find(c=>c.url.includes('routes.googleapis.com'))!;
  assert.equal(routes.headers['x-goog-api-key'],'test-key');assert.equal(routes.body.routeModifiers.avoidHighways,true);
  assert.deepEqual([routes.body.origin.address,...routes.body.intermediates.map((i:any)=>i.address),routes.body.destination.address],['北海道テスト町9-9','北海道テスト町1-1','北海道テスト町3-3','北海道テスト町9-9']);
  const sent=JSON.stringify(g.calls);for(const name of ['架空','住所 なし','テスト診療所','テスト施設'])assert(!sent.includes(name),name);
  assert(f.db.raw.prepare("SELECT 1 FROM audit WHERE action='PATCH_settings'").get());
 }finally{g.restore();}
});

test('routes need the key, a real appointment, and stay within the rate limit',async()=>{
 const g=googleMock();try{
  const none=await fixture();await none.call('settings','PATCH',{officeName:'',officeAddress:'北海道テスト町9-9',marginMinutes:10,version:0});
  assert.equal((await none.call('routes','POST',{appointmentIds:['x'],avoidHighways:false})).status,503);
  const f=await fixture({GOOGLE_MAPS_API_KEY:'test-key'});await f.call('settings','PATCH',{officeName:'',officeAddress:'北海道テスト町9-9',marginMinutes:10,version:0});
  const p=await f.patient('R1','架空 一郎','北海道テスト町1-1');await f.add(p,'09:00','09:30');await f.add(null,'12:00','13:00');const [visit,meeting]=await f.onDay();
  assert.equal((await f.call('routes','POST',{appointmentIds:['missing'],avoidHighways:false})).status,404);
  assert.equal((await f.call('routes','POST',{appointmentIds:[meeting.id],avoidHighways:false})).status,400);
  assert.equal((await f.call('routes','POST',{appointmentIds:[visit.id,visit.id],avoidHighways:false})).status,400);
  assert.equal(g.calls.length,0);
  f.db.raw.prepare("INSERT INTO attempts(id,count,reset_at) SELECT 'route:'||id,120,? FROM records WHERE kind='staff'").run(Date.now()+60000);
  assert.equal((await f.call('routes','POST',{appointmentIds:[visit.id],avoidHighways:false})).status,429);
  assert.equal((await f.call('routes','GET')).status,405);
 }finally{g.restore();}
});

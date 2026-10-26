import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import {SQLite} from '../scripts/sqlite';import sourceWorker from '../worker/index';import type {Env} from '../worker/types';
import {parsePunch,tsDate} from '../src/lib/slack';
const worker=process.env.TEST_BUNDLE?(await import('../build/worker.js' as string)).default:sourceWorker;

test('Slack posts are read as punches only when the meaning is clear',()=>{
 assert.deepEqual(parsePunch('出勤します'),{kind:'IN'});
 assert.deepEqual(parsePunch('<@U123> 退勤しました、お疲れさまでした :wave:'),{kind:'OUT'});
 assert.deepEqual(parsePunch('休憩入ります'),{kind:'BREAK_START'});
 assert.deepEqual(parsePunch('休憩終わりました'),{kind:'BREAK_END'});
 assert.deepEqual(parsePunch('休憩から戻りました'),{kind:'BREAK_END'});
 assert('ignored' in parsePunch('明日は遅れて出勤します')!);
 assert('ignored' in parsePunch('体調不良のため出勤できません')!);
 assert('ignored' in parsePunch('出勤・退勤')!);
 assert.equal(parsePunch('おはようございます'),null);
 // #出勤退勤 でよくある書き方。
 assert.deepEqual(parsePunch('退勤します'),{kind:'OUT'});
 assert.deepEqual(parsePunch('退勤しました\n\n前のアカウントは別のスタッフの出退勤です'),{kind:'OUT'});
 assert.match((parsePunch('山田さんも7:30出勤してます') as {ignored:string}).ignored,/ほかの人/);
 assert.match((parsePunch('昨日17:30 退勤してます\n本日出勤しました') as {ignored:string}).ignored,/時刻や日付/);
 assert.equal(parsePunch('間違えて出勤退勤のチャネルに書いてしまいました。山田さん宛です。'),null);
 assert.equal(tsDate('1793000000.123456').toISOString(),new Date(1793000000123).toISOString());
});

// Slack API のモック。conversations.history は messages を返し、書き込み（リアクション・返信）は calls に残す。
function slackMock(){
 const state={messages:[] as any[],calls:[] as {method:string;body:any}[],fail:false};
 const original=globalThis.fetch;
 globalThis.fetch=(async(input:any,init?:any)=>{
  const url=new URL(String(input));const method=url.pathname.slice('/api/'.length);
  if(url.hostname!=='slack.com')return original(input,init);
  assert.equal(init?.headers?.Authorization,'Bearer xoxb-test');
  if(method==='conversations.history'){if(state.fail)return new Response('',{status:429});const oldest=Number(url.searchParams.get('oldest'));return Response.json({ok:true,messages:state.messages.filter(m=>Number(m.ts)>oldest).reverse(),has_more:false});}
  state.calls.push({method,body:JSON.parse(init.body)});return Response.json({ok:true});
 }) as typeof fetch;
 return {state,restore:()=>{globalThis.fetch=original;}};
}
function fixture(){
 const db=new SQLite();for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.raw.exec(readFileSync('migrations/'+file,'utf8'));
 const env:Env={MTLS_MODE:'local',DB:db,APP_ORIGIN:'http://127.0.0.1:3000',AUTH_PEPPER:'test-secret-pepper-32-bytes-long-value',SETUP_TOKEN:'test-setup-token-32-bytes-long-value',SETUP_EXPIRES:String(Date.now()+86400000),SLACK_BOT_TOKEN:'xoxb-test',SLACK_CHANNEL_ID:'C0TEST'};
 let rev=1;type Session={cookie:string;csrf:string;id?:string};const none:Session={cookie:'',csrf:''};
 async function call(s:Session,path:string,method='GET',body?:any){const res=await worker.fetch(new Request(env.APP_ORIGIN+'/api/'+path,{method,headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json',Cookie:s.cookie,'X-CSRF-Token':s.csrf},...(body!==undefined?{body:JSON.stringify(method==='GET'?body:{revision:rev,...body})}:{})}),env);const data:any=await res.json();if(res.ok&&data.revision)rev=data.revision;return {status:res.status,data};}
 async function login(id:string,password:string):Promise<Session|null>{const res=await worker.fetch(new Request(env.APP_ORIGIN+'/api/auth/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({login:id,password})}),env);if(!res.ok)return null;const data:any=await res.json();return {cookie:res.headers.get('set-cookie')!.split(';')[0],csrf:data.csrf,id:data.staff.id};}
 async function tick(){const waits:Promise<unknown>[]=[];await worker.scheduled({},env,{waitUntil:(p:Promise<unknown>)=>waits.push(p)});await Promise.all(waits);}
 return {db,env,call,login,tick,setup:async()=>{await call(none,'setup','POST',{token:env.SETUP_TOKEN,login:'admin',name:'テスト管理者',password:'test-password-long-enough'});return (await login('admin','test-password-long-enough'))!;}};
}
async function nurse(f:ReturnType<typeof fixture>,admin:any,slackUserId='U0NURSE01'){
 const r=await f.call(admin,'staff','POST',{login:'nurse',name:'テスト看護師',kana:'',profession:'看護師',color:'#336699',role:'STAFF',active:true,slackUserId});assert.equal(r.status,200,JSON.stringify(r.data));
 const first=await f.login('nurse',r.data.temporaryPassword);assert.equal((await f.call(first!,'auth/password','POST',{current:r.data.temporaryPassword,next:'nurse-password-long'})).status,200);
 return (await f.login('nurse','nurse-password-long'))!;
}
const ts=(minutesAgo:number)=>((Date.now()-minutesAgo*60000)/1000).toFixed(6);
const month=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,7);

test('Slack posts become punches at the posted time, once, with a reaction',async()=>{
 const f=fixture(),slack=slackMock();
 try{
  const admin=await f.setup(),n=await nurse(f,admin);
  // 最初の起動では過去の投稿を取り込まない。
  slack.state.messages=[{type:'message',user:'U0NURSE01',text:'出勤します',ts:ts(30)}];await f.tick();
  assert.equal((await f.call(n,`attendance?month=${month()}`)).data.punches.length,0);
  await new Promise(r=>setTimeout(r,20));const base=Date.now()/1000,posted=base.toFixed(6);slack.state.messages.push({type:'message',user:'U0NURSE01',text:'出勤しました！',ts:posted},{type:'message',user:'U0NURSE01',text:'今日もよろしく',ts:(base+0.001).toFixed(6)},{type:'message',subtype:'channel_join',user:'U0NURSE01',text:'出勤',ts:(base+0.002).toFixed(6)});
  await f.tick();await f.tick();
  const punches=(await f.call(n,`attendance?month=${month()}`)).data.punches;
  assert.equal(punches.length,1);assert.equal(punches[0].kind,'IN');assert.equal(punches[0].at,tsDate(posted).toISOString());assert.equal(punches[0].device,'Slack');assert.equal(punches[0].source,'punch');
  assert.deepEqual(slack.state.calls,[{method:'reactions.add',body:{channel:'C0TEST',timestamp:posted,name:'white_check_mark'}}]);
  assert((await f.call(admin,'audit')).data.some((a:any)=>a.action==='PUNCH_IN'&&a.actor_id===n.id));
  // アプリの打刻とも状態を共有する：Slack で出勤した後、アプリでは退勤だけが押せる。
  await new Promise(r=>setTimeout(r,20));
  assert.equal((await f.call(n,'attendance/punch','POST',{kind:'IN'})).status,409);
  assert.equal((await f.call(n,'attendance/punch','POST',{kind:'OUT'})).status,200);
  assert((await f.call(admin,'bootstrap')).data.data.settings.slack.configured);
 }finally{slack.restore();}
});
test('posts that cannot be punched get a thread reply and are listed for admins',async()=>{
 const f=fixture(),slack=slackMock();
 try{
  const admin=await f.setup(),n=await nurse(f,admin);await f.tick();
  // アプリで出勤した後の Slack の「出勤」、紐付いていない人、予定の連絡、出勤前の退勤。
  assert.equal((await f.call(n,'attendance/punch','POST',{kind:'IN'})).status,200);
  slack.state.messages=[{type:'message',user:'U0NURSE01',text:'出勤',ts:ts(-0.01)},{type:'message',user:'U0OTHER99',text:'出勤します',ts:ts(-0.02)},{type:'message',user:'U0NURSE01',text:'明日は遅れて出勤します',ts:ts(-0.03)}];
  await f.tick();
  const replies=slack.state.calls.filter(c=>c.method==='chat.postMessage');assert.equal(replies.length,3);
  assert(replies.every(r=>r.body.thread_ts&&r.body.channel==='C0TEST'));
  assert.match(replies[0].body.text,/すでに出勤しています/);assert.match(replies[1].body.text,/紐付いていない/);assert.match(replies[2].body.text,/予定の連絡/);
  assert.equal((await f.call(n,`attendance?month=${month()}`)).data.punches.length,1);
  const rejected=(await f.call(admin,`attendance?month=${month()}`)).data.slackRejected;assert.equal(rejected.length,3);assert.equal(rejected.find((r:any)=>r.slackUser==='U0OTHER99').staffId,null);
  assert.deepEqual((await f.call(n,`attendance?month=${month()}`)).data.slackRejected,[]);
  // 失敗した投稿も二度は返信しない。
  await f.tick();assert.equal(slack.state.calls.length,3);
 }finally{slack.restore();}
});
test('Slack errors leave the position unchanged so the next minute retries',async()=>{
 const f=fixture(),slack=slackMock();
 try{
  const admin=await f.setup(),n=await nurse(f,admin);await f.tick();
  slack.state.messages=[{type:'message',user:'U0NURSE01',text:'出勤します',ts:ts(-0.01)}];slack.state.fail=true;await f.tick();
  assert.equal((await f.call(n,`attendance?month=${month()}`)).data.punches.length,0);
  slack.state.fail=false;await f.tick();assert.equal((await f.call(n,`attendance?month=${month()}`)).data.punches.length,1);
 }finally{slack.restore();}
});
test('a Slack member ID belongs to one staff member and nothing runs without the settings',async()=>{
 const f=fixture(),slack=slackMock();
 try{
  const admin=await f.setup();await nurse(f,admin);
  const dup=await f.call(admin,'staff','POST',{login:'nurse2',name:'二人目',kana:'',profession:'看護師',color:'#336699',role:'STAFF',active:true,slackUserId:'u0nurse01'});assert.equal(dup.status,409);
  assert.equal((await f.call(admin,'staff','POST',{login:'nurse3',name:'三人目',kana:'',profession:'看護師',color:'#336699',role:'STAFF',active:true,slackUserId:'not-an-id'})).status,400);
  delete f.env.SLACK_BOT_TOKEN;await f.tick();assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM slack_state').get().n,0);
  assert.equal((await f.call(admin,'bootstrap')).data.data.settings.slack.configured,false);
 }finally{slack.restore();}
});

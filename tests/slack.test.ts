import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import {SQLite} from '../scripts/sqlite';import sourceWorker from '../worker/index';import type {Env} from '../worker/types';
import {parsePunch,tsDate} from '../src/lib/slack';import {oncallTimes} from '../worker/slack';import {timeKey} from '../src/lib/date';
import {addDays,dateKey,jstDate} from '../src/lib/date';
const worker=process.env.TEST_BUNDLE?(await import('../build/worker.js' as string)).default:sourceWorker;

test('Slack posts are read as punches only when the meaning is clear',()=>{
 assert.deepEqual(parsePunch('出勤します'),{kind:'IN'});
 assert.deepEqual(parsePunch('<@U123> 退勤しました、お疲れさまでした :wave:'),{kind:'OUT'});
 // 休憩は Slack では打刻しない。
 assert.equal(parsePunch('休憩入ります'),null);
 assert.equal(parsePunch('休憩終わりました'),null);
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
  if(method==='conversations.history'){if(state.fail)return new Response('',{status:429});const oldest=Number(url.searchParams.get('oldest')),latest=Number(url.searchParams.get('latest')||Infinity);return Response.json({ok:true,messages:state.messages.filter(m=>Number(m.ts)>oldest&&Number(m.ts)<latest).reverse(),has_more:false});}
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
  // 打刻できた投稿には ✅ と結果の返信、キーワードのない投稿には登録しなかった旨の返信。参加通知には返さない。
  assert.deepEqual(slack.state.calls.map(c=>[c.method,c.body.timestamp??c.body.thread_ts]),[['reactions.add',posted],['chat.postMessage',posted],['chat.postMessage',(base+0.001).toFixed(6)]]);
  assert.match(slack.state.calls[1].body.text,new RegExp(`^出勤として打刻しました（\\d+/\\d+ ${timeKey(tsDate(posted))}）`));
  assert.match(slack.state.calls[2].body.text,/キーワードがなかったため/);assert.match(slack.state.calls[2].body.text,/書き方：/);
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
  assert(replies.every(r=>!r.body.text.includes('休憩')));
  assert.match(replies[0].body.text,/すでに出勤しています/);assert(replies.every(r=>r.body.text.includes('書き方：')));assert.match(replies[1].body.text,/紐付いていない/);assert.match(replies[2].body.text,/予定の連絡/);
  assert.equal((await f.call(n,`attendance?month=${month()}`)).data.punches.length,1);
  const rejected=(await f.call(admin,`attendance?month=${month()}`)).data.slackRejected;assert.equal(rejected.length,3);assert.equal(rejected.find((r:any)=>r.slackUser==='U0OTHER99').staffId,null);
  assert.deepEqual((await f.call(n,`attendance?month=${month()}`)).data.slackRejected,[]);
  // 失敗した投稿も、キーワードのない投稿も二度は返信しない。スレッドの返信と bot の投稿には返信しない。
  slack.state.messages.push({type:'message',user:'U0NURSE01',text:'よろしくお願いします',ts:ts(-0.04)},{type:'message',user:'U0NURSE01',text:'了解です',ts:ts(-0.05),thread_ts:ts(-0.04)},{type:'message',bot_id:'B0BOT',user:'U0BOT',text:'記録しました',ts:ts(-0.06)});
  await f.tick();await f.tick();assert.equal(slack.state.calls.length,4);assert.match(slack.state.calls[3].body.text,/キーワードがなかった/);
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
test('past posts are imported in chunks from a date, without writing to Slack',async()=>{
 const f=fixture(),slack=slackMock();
 try{
  const admin=await f.setup(),n=await nurse(f,admin,'U0NURSE01, U0OLDACC1');
  const today=dateKey(new Date()),post=(daysAgo:number,time:string,text:string,user='U0NURSE01')=>({type:'message',user,text,ts:(jstDate(addDays(today,-daysAgo),time).getTime()/1000).toFixed(6)});
  // 10日分の出勤・退勤（20件）。1日目は前のアカウント、2日目は退勤を忘れて翌朝に出勤、ほかの人の報告も1件。
  slack.state.messages=[post(12,'08:00','出勤しました','U0OLDACC1'),post(12,'17:30','退勤しました','U0OLDACC1'),post(11,'08:00','出勤しました'),post(10,'07:30','出勤しました'),post(10,'17:00','退勤します'),post(10,'17:05','山田さんも退勤しました')];
  for(let d=9;d>=3;d--)slack.state.messages.push(post(d,'08:00','出勤しました'),post(d,'17:00','退勤しました'));
  assert.equal((await f.call(admin,'slack/backfill','POST',{from:addDays(today,-12)})).status,409);
  await f.tick();
  assert.equal((await f.call(n,'slack/backfill','POST',{from:addDays(today,-12)})).status,403);
  let r=await f.call(admin,'slack/backfill','POST',{from:addDays(today,-11)});assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.done,false);assert.equal(r.data.punched+r.data.rejected,15);
  let total=r.data.punched;const rejected=[r.data.rejected];
  while(!r.data.done){r=await f.call(admin,'slack/backfill','POST',{from:addDays(today,-11),after:r.data.after});total+=r.data.punched;rejected.push(r.data.rejected);}
  // 12日前（from より前）は取り込まない。11日前の出勤、10日前の出勤・退勤、9〜3日前の14件。
  assert.equal(total,17);assert.equal(rejected.reduce((a,b)=>a+b),1);
  assert.equal(slack.state.calls.length,0);
  r=await f.call(admin,'slack/backfill','POST',{from:addDays(today,-12)});assert.equal(r.data.punched,2);
  r=await f.call(admin,'slack/backfill','POST',{from:addDays(today,-12)});while(!r.data.done)r=await f.call(admin,'slack/backfill','POST',{from:addDays(today,-12),after:r.data.after});assert.equal(r.data.punched,0);
  const all=f.db.raw.prepare("SELECT work_date,kind FROM punches WHERE staff_id=? ORDER BY at").all(n.id);
  assert.equal(all.length,19);
  // 退勤を忘れた翌朝の出勤は、新しい勤務日になる。
  assert.deepEqual(all.filter((p:any)=>p.work_date===addDays(today,-11)).map((p:any)=>p.kind),['IN']);
  assert.deepEqual(all.filter((p:any)=>p.work_date===addDays(today,-10)).map((p:any)=>p.kind),['IN','OUT']);
  assert((await f.call(admin,'audit')).data.some((a:any)=>a.action==='SLACK_IMPORTED'));
  assert.equal((await f.call(admin,`attendance?month=${month()}`)).data.slackRejected.length,1);
 }finally{slack.restore();}
});
test('after a forgotten clock-out, the app still lets staff clock in today',async()=>{
 const f=fixture(),slack=slackMock();
 try{
  const admin=await f.setup(),n=await nurse(f,admin);
  const yesterday=jstDate(addDays(dateKey(new Date()),-1),'20:00').toISOString();
  f.db.raw.prepare("INSERT INTO punches(id,staff_id,work_date,kind,at,source,device,created_by,created_at) VALUES('old',?,?,'IN',?,'punch','local',?,?)").run(n.id,dateKey(yesterday),yesterday,n.id,yesterday);
  const status=(await f.call(n,'attendance/status')).data;assert(status.next.includes('IN'));
  const r=await f.call(n,'attendance/punch','POST',{kind:'IN'});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.workDate,dateKey(new Date()));
 }finally{slack.restore();}
});
test('on-call posts report the response time as a range, dated back from the post',()=>{
 assert.deepEqual(parsePunch('オンコール 電話対応 22:30〜22:45 発熱の相談'),{oncall:{kind:'CALL',start:'22:30',end:'22:45',note:'発熱の相談'}});
 assert.deepEqual(parsePunch('オンコール出動 23:50-0:40'),{oncall:{kind:'DISPATCH',start:'23:50',end:'00:40',note:''}});
 assert.match((parsePunch('オンコール出動します') as {ignored:string}).ignored,/時刻の範囲/);
 assert.match((parsePunch('明日オンコールです') as {ignored:string}).ignored,/予定/);
 // 「18時から18時5分」のような書き方、全角、電話対応と出動のそれぞれの言葉。
 assert.deepEqual(parsePunch('オンコール 電話対応 18時から18時5分まで'),{oncall:{kind:'CALL',start:'18:00',end:'18:05',note:''}});
 assert.deepEqual(parsePunch('オンコール 18:00-18:05 電話対応'),{oncall:{kind:'CALL',start:'18:00',end:'18:05',note:'電話対応'}});
 assert.deepEqual(parsePunch('オンコール出動 18時半〜19時'),{oncall:{kind:'DISPATCH',start:'18:30',end:'19:00',note:''}});
 assert.deepEqual(parsePunch('オンコール 往診 1:10-2:30'),{oncall:{kind:'DISPATCH',start:'01:10',end:'02:30',note:''}});
 assert.deepEqual(parsePunch('オンコール TEL 22:30-22:40'),{oncall:{kind:'CALL',start:'22:30',end:'22:40',note:''}});
 assert.deepEqual(parsePunch('オンコール 出動 １８：００～１８：４０'),{oncall:{kind:'DISPATCH',start:'18:00',end:'18:40',note:''}});
 assert.deepEqual(parsePunch('オンコール 出動 23:00-23:40 家族から電話あり'),{oncall:{kind:'DISPATCH',start:'23:00',end:'23:40',note:'家族から電話あり'}});
 assert.equal((parsePunch('オンコール 電話対応 22:00-22:10 訪問看護から相談') as any).oncall.kind,'CALL');
 assert.match((parsePunch('オンコール 18:00-18:05') as {ignored:string}).ignored,/電話対応か出動か/);
 assert.match((parsePunch('オンコール 電話のあと出動 18:00-19:00') as {ignored:string}).ignored,/電話対応か出動か/);
 const at=(o:string,posted:string)=>{const t=oncallTimes(parsePunch(o)&&(parsePunch(o) as any).oncall,jstDate(posted.slice(0,10),posted.slice(11)));return [t.start.toISOString(),t.end.toISOString()];};
 assert.deepEqual(at('オンコール 電話 22:30〜22:45','2026-11-02 23:00'),[jstDate('2026-11-02','22:30').toISOString(),jstDate('2026-11-02','22:45').toISOString()]);
 assert.deepEqual(at('オンコール 電話 23:30〜0:05','2026-11-03 00:10'),[jstDate('2026-11-02','23:30').toISOString(),jstDate('2026-11-03','00:05').toISOString()]);
 assert.deepEqual(at('オンコール 出動 23:00〜23:40','2026-11-03 08:00'),[jstDate('2026-11-02','23:00').toISOString(),jstDate('2026-11-02','23:40').toISOString()]);
});
test('on-call posts in Slack become on-call responses with a reaction',async()=>{
 const f=fixture(),slack=slackMock();
 try{
  const admin=await f.setup(),n=await nurse(f,admin);await f.tick();
  await new Promise(r=>setTimeout(r,20));const base=Date.now()/1000,from=timeKey(new Date(Date.now()-40*60000)),to=timeKey(new Date(Date.now()-20*60000));
  slack.state.messages.push({type:'message',user:'U0NURSE01',text:`オンコール 電話対応 ${from}〜${to}`,ts:base.toFixed(6)},{type:'message',user:'U0NURSE01',text:'オンコール出動しました',ts:(base+0.001).toFixed(6)});
  await f.tick();
  const start=new Date(Date.now()-40*60000),m=dateKey(start).slice(0,7),entries=(await f.call(n,`attendance?month=${m}`)).data.oncall;
  assert.equal(entries.length,1);assert.equal(entries[0].kind,'CALL');assert.equal(entries[0].source,'slack');assert.equal(timeKey(entries[0].start),from);assert.equal(timeKey(entries[0].end),to);
  assert.deepEqual(slack.state.calls.map(c=>c.method),['reactions.add','chat.postMessage','chat.postMessage']);
  assert.match(slack.state.calls[1].body.text,new RegExp(`^オンコール（電話対応）を記録しました（\\d+/\\d+ ${from}〜${to}・20分）`));
  assert.match(slack.state.calls[2].body.text,/時刻の範囲/);assert.match(slack.state.calls[2].body.text,/書き方：/);
 }finally{slack.restore();}
});

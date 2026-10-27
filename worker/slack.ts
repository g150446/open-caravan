// Slack の #出勤退勤 を Cron で1分ごとに読み、「出勤」「退勤」「休憩」の投稿を本人の打刻にする。
// 本番は全リクエストにクライアント証明書を求めるので、Slack から送ってもらう（Events API）のではなく、こちらから読みに行く。
// 打刻の時刻は読んだ時刻ではなく、Slack が記録した投稿時刻（ts）。結果は ✅ のリアクションか、スレッドへの返信で知らせる。
// 連携を始める前の投稿は、管理者が基本設定から取り込む（backfillSlack）。そのときは Slack に何も返さない。
import {z} from 'zod';
import type {Actor,Env,Statement} from './types';
import {assert,ApiError} from '../src/lib/errors';
import {keySchema} from '../src/lib/validation';
import {jstDate} from '../src/lib/date';
import {parsePunch,slackIds,tsDate} from '../src/lib/slack';
import {punchLabels} from '../src/lib/attendance';
import {list} from './store';
import {audit} from './auth';
import {selfPunch} from './attendance';

interface Message {type?:string;subtype?:string;bot_id?:string;user?:string;text?:string;ts:string;thread_ts?:string;}
type Staff=Awaited<ReturnType<typeof list>>;
class SlackRetry extends Error {}
async function slack(env:Env,method:string,params:Record<string,string>,post=false){
 const r=await fetch('https://slack.com/api/'+method+(post?'':'?'+new URLSearchParams(params)),{method:post?'POST':'GET',headers:{Authorization:'Bearer '+env.SLACK_BOT_TOKEN,...(post?{'Content-Type':'application/json; charset=utf-8'}:{})},...(post?{body:JSON.stringify(params)}:{})});
 if(r.status===429||r.status>=500)throw new SlackRetry(method+' '+r.status);
 const d=await r.json() as {ok:boolean;error?:string;messages?:Message[];has_more?:boolean;response_metadata?:{next_cursor?:string}};
 if(!d.ok)throw new Error(`slack ${method}: ${d.error}`);return d;
}
// 知らせるのに失敗しても、打刻と記録は変えない。
async function notify(env:Env,method:string,params:Record<string,string>){try{await slack(env,method,params,true);}catch(e){if(!String(e).includes('already_reacted'))console.error('slack_notify_failed',method);}}
// oldest より後（latest まで）の投稿を古い順に。
async function history(env:Env,channel:string,oldest:string,latest?:string){
 const messages:Message[]=[];let cursor='';
 for(let page=0;page<10;page++){const d=await slack(env,'conversations.history',{channel,oldest,...(latest?{latest}:{}),limit:'200',...(cursor?{cursor}:{})});messages.push(...d.messages??[]);cursor=d.response_metadata?.next_cursor??'';if(!d.has_more||!cursor)break;}
 return messages.sort((a,b)=>Number(a.ts)-Number(b.ts));
}
const appHint='必要なら、Open Caravan の勤怠の「詳細・申請」から修正を申請してください。';
const activeStaff=async(env:Env)=>(await list(env.DB,'staff')).filter(s=>s.active&&!s.deleted&&s.slackUserId);
// スレッドの返信、bot、参加通知などは対象にしない。
const parsedOf=(m:Message)=>m.type==='message'&&!m.subtype&&!m.bot_id&&m.user&&(!m.thread_ts||m.thread_ts===m.ts)?parsePunch(m.text??''):null;
// 1件の投稿を打刻にする。結果を slack_events に残し、after（読み取り位置の更新など）を同じ batch で書く。
async function handle(env:Env,channel:string,m:Message,staff:Staff,now:string,live:boolean,after:Statement[]):Promise<'PUNCHED'|'REJECTED'|'SKIPPED'>{
 const parsed=parsedOf(m),id=`${channel}:${m.ts}`;
 if(!parsed||await env.DB.prepare('SELECT 1 AS ok FROM slack_events WHERE id=?').bind(id).first()){if(after.length)await env.DB.batch(after);return 'SKIPPED';}
 const postedAt=tsDate(m.ts).toISOString(),text=(m.text??'').slice(0,200),person=staff.find(s=>slackIds(String(s.slackUserId)).includes(m.user!)),kind='kind' in parsed?parsed.kind:null;
 let reason='ignored' in parsed?parsed.ignored:!person?'この Slack アカウントは Open Caravan のスタッフに紐付いていないため、打刻にしませんでした。管理者にスタッフ情報の「Slack メンバーID」の登録を頼んでください。':'';
 if(!reason&&person&&kind){
  try{await selfPunch(env,person.id,kind,tsDate(m.ts),'Slack',punchId=>[env.DB.prepare("INSERT INTO slack_events(id,slack_user,staff_id,punch_id,text,kind,status,posted_at,created_at) VALUES(?,?,?,?,?,?,'PUNCHED',?,?)").bind(id,m.user,person.id,punchId,text,kind,postedAt,now),...after]);
   if(live)await notify(env,'reactions.add',{channel,timestamp:m.ts,name:'white_check_mark'});return 'PUNCHED';}
  catch(e){if(!(e instanceof ApiError))throw e;reason=`${punchLabels[kind]}の打刻にしませんでした：${e.message}`;}
 }
 await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO slack_events(id,slack_user,staff_id,text,kind,status,message,posted_at,created_at) VALUES(?,?,?,?,?,'REJECTED',?,?,?)").bind(id,m.user,person?.id??null,text,kind,reason,postedAt,now),...after]);
 if(live)await notify(env,'chat.postMessage',{channel,thread_ts:m.ts,text:`${reason}\n${appHint}`});
 return 'REJECTED';
}
export async function slackStatus(env:Env){
 const row=env.SLACK_CHANNEL_ID?await env.DB.prepare('SELECT polled_at FROM slack_state WHERE channel=?').bind(env.SLACK_CHANNEL_ID).first<{polled_at:string}>():null;
 return {configured:!!(env.SLACK_BOT_TOKEN&&env.SLACK_CHANNEL_ID),polledAt:row?.polled_at??null};
}
export async function pollSlack(env:Env){
 const channel=env.SLACK_CHANNEL_ID;if(!env.SLACK_BOT_TOKEN||!channel)return;
 const now=new Date().toISOString(),state=await env.DB.prepare('SELECT last_ts FROM slack_state WHERE channel=?').bind(channel).first<{last_ts:string}>();
 // 最初に動いたときは今を起点にし、過去の投稿は取り込まない（過去の分は backfillSlack で）。
 if(!state){await env.DB.prepare('INSERT OR IGNORE INTO slack_state(channel,last_ts,polled_at) VALUES(?,?,?)').bind(channel,(Date.now()/1000).toFixed(6),now).run();return;}
 let messages:Message[];
 try{messages=await history(env,channel,state.last_ts);}catch(e){console.error('slack_history_failed',e instanceof SlackRetry?'retry':String(e).slice(0,80));return;}
 const advance=(ts:string)=>env.DB.prepare('UPDATE slack_state SET last_ts=?,polled_at=? WHERE channel=? AND CAST(last_ts AS REAL)<CAST(? AS REAL)').bind(ts,now,channel,ts);
 const staff=await activeStaff(env);
 for(const m of messages)await handle(env,channel,m,staff,now,true,[advance(m.ts)]);
 await env.DB.prepare('UPDATE slack_state SET polled_at=? WHERE channel=?').bind(now,channel).run();
}
// 連携を始める前の投稿を取り込む（管理者）。from の日から、Cron が読み始めた位置までを古い順に。
// Worker の1回の処理を小さく保つため、打刻の対象になる投稿を15件ずつ処理し、続きの位置（after）を返す。画面が done になるまで呼び直す。
const BATCH=15;
export async function backfillSlack(env:Env,actor:Actor,body:Record<string,unknown>){
 assert(actor.role==='ADMIN',403,'管理者のみ操作できます。');
 const channel=env.SLACK_CHANNEL_ID;assert(env.SLACK_BOT_TOKEN&&channel,400,'Slack 連携が設定されていません。');
 const from=keySchema.parse(body.from),after=z.string().regex(/^\d+\.\d+$/).optional().parse(body.after);
 const state=await env.DB.prepare('SELECT last_ts FROM slack_state WHERE channel=?').bind(channel).first<{last_ts:string}>();
 assert(state,409,'Slack の読み取りがまだ始まっていません。1分ほど待ってから取り込んでください。');
 let messages:Message[];
 try{messages=await history(env,channel,after??(jstDate(from).getTime()/1000).toFixed(6),state.last_ts);}
 catch(e){throw new ApiError(503,e instanceof SlackRetry?'Slack が混み合っています。少し待ってから続けてください。':'Slack から投稿を読めませんでした。');}
 const now=new Date().toISOString(),staff=await activeStaff(env),counts={PUNCHED:0,REJECTED:0,SKIPPED:0};let last=after??'',handled=0;
 for(const m of messages){
  if(handled>=BATCH&&parsedOf(m))break;
  const r=await handle(env,channel,m,staff,now,false,[]);counts[r]++;if(r!=='SKIPPED')handled++;last=m.ts;
 }
 const done=!messages.length||last===messages.at(-1)!.ts;
 if(counts.PUNCHED||counts.REJECTED)await audit(env,actor.id,'SLACK_IMPORTED',`${from}:${counts.PUNCHED}/${counts.PUNCHED+counts.REJECTED}`).run();
 return {done,after:last||null,punched:counts.PUNCHED,rejected:counts.REJECTED};
}

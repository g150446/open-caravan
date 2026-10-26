// Slack の #出勤退勤 を Cron で1分ごとに読み、「出勤」「退勤」「休憩」の投稿を本人の打刻にする。
// 本番は全リクエストにクライアント証明書を求めるので、Slack から送ってもらう（Events API）のではなく、こちらから読みに行く。
// 打刻の時刻は読んだ時刻ではなく、Slack が記録した投稿時刻（ts）。結果は ✅ のリアクションか、スレッドへの返信で知らせる。
import type {Env} from './types';
import {ApiError} from '../src/lib/errors';
import {parsePunch,tsDate} from '../src/lib/slack';
import {punchLabels} from '../src/lib/attendance';
import {list} from './store';
import {selfPunch} from './attendance';

interface Message {type?:string;subtype?:string;bot_id?:string;user?:string;text?:string;ts:string;thread_ts?:string;}
class SlackRetry extends Error {}
async function slack(env:Env,method:string,params:Record<string,string>,post=false){
 const r=await fetch('https://slack.com/api/'+method+(post?'':'?'+new URLSearchParams(params)),{method:post?'POST':'GET',headers:{Authorization:'Bearer '+env.SLACK_BOT_TOKEN,...(post?{'Content-Type':'application/json; charset=utf-8'}:{})},...(post?{body:JSON.stringify(params)}:{})});
 if(r.status===429||r.status>=500)throw new SlackRetry(method+' '+r.status);
 const d=await r.json() as {ok:boolean;error?:string;messages?:Message[];has_more?:boolean;response_metadata?:{next_cursor?:string}};
 if(!d.ok)throw new Error(`slack ${method}: ${d.error}`);return d;
}
// 知らせるのに失敗しても、打刻と記録は変えない。
async function notify(env:Env,method:string,params:Record<string,string>){try{await slack(env,method,params,true);}catch(e){if(!String(e).includes('already_reacted'))console.error('slack_notify_failed',method);}}
const appHint='必要なら、Open Caravan の勤怠の「詳細・申請」から修正を申請してください。';
export async function slackStatus(env:Env){
 const row=env.SLACK_CHANNEL_ID?await env.DB.prepare('SELECT polled_at FROM slack_state WHERE channel=?').bind(env.SLACK_CHANNEL_ID).first<{polled_at:string}>():null;
 return {configured:!!(env.SLACK_BOT_TOKEN&&env.SLACK_CHANNEL_ID),polledAt:row?.polled_at??null};
}
export async function pollSlack(env:Env){
 const channel=env.SLACK_CHANNEL_ID;if(!env.SLACK_BOT_TOKEN||!channel)return;
 const now=new Date().toISOString(),state=await env.DB.prepare('SELECT last_ts FROM slack_state WHERE channel=?').bind(channel).first<{last_ts:string}>();
 // 最初に動いたときは今を起点にし、過去の投稿は取り込まない。
 if(!state){await env.DB.prepare('INSERT OR IGNORE INTO slack_state(channel,last_ts,polled_at) VALUES(?,?,?)').bind(channel,(Date.now()/1000).toFixed(6),now).run();return;}
 const messages:Message[]=[];
 try{let cursor='';for(let page=0;page<5;page++){const d=await slack(env,'conversations.history',{channel,oldest:state.last_ts,limit:'200',...(cursor?{cursor}:{})});messages.push(...d.messages??[]);cursor=d.response_metadata?.next_cursor??'';if(!d.has_more||!cursor)break;}}
 catch(e){console.error('slack_history_failed',e instanceof SlackRetry?'retry':String(e).slice(0,80));return;}
 const advance=(ts:string)=>env.DB.prepare('UPDATE slack_state SET last_ts=?,polled_at=? WHERE channel=? AND CAST(last_ts AS REAL)<CAST(? AS REAL)').bind(ts,now,channel,ts);
 const staff=(await list(env.DB,'staff')).filter(s=>s.active&&!s.deleted&&s.slackUserId);
 for(const m of messages.sort((a,b)=>Number(a.ts)-Number(b.ts))){
  // スレッドの返信、bot、参加通知などは対象にしない。
  const parsed=m.type==='message'&&!m.subtype&&!m.bot_id&&m.user&&(!m.thread_ts||m.thread_ts===m.ts)?parsePunch(m.text??''):null;
  if(!parsed){await advance(m.ts).run();continue;}
  const id=`${channel}:${m.ts}`,postedAt=tsDate(m.ts).toISOString(),text=(m.text??'').slice(0,200),person=staff.find(s=>s.slackUserId===m.user);
  if(await env.DB.prepare('SELECT 1 AS ok FROM slack_events WHERE id=?').bind(id).first()){await advance(m.ts).run();continue;}
  const kind='kind' in parsed?parsed.kind:null;
  let reason='ignored' in parsed?parsed.ignored:!person?'この Slack アカウントは Open Caravan のスタッフに紐付いていないため、打刻にしませんでした。管理者にスタッフ情報の「Slack メンバーID」の登録を頼んでください。':'';
  if(!reason&&person&&kind){
   try{await selfPunch(env,person.id,kind,tsDate(m.ts),'Slack',punchId=>[env.DB.prepare("INSERT INTO slack_events(id,slack_user,staff_id,punch_id,text,kind,status,posted_at,created_at) VALUES(?,?,?,?,?,?,'PUNCHED',?,?)").bind(id,m.user,person.id,punchId,text,kind,postedAt,now),advance(m.ts)]);
    await notify(env,'reactions.add',{channel,timestamp:m.ts,name:'white_check_mark'});continue;}
   catch(e){if(!(e instanceof ApiError))throw e;reason=`${punchLabels[kind]}の打刻にしませんでした：${e.message}`;}
  }
  await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO slack_events(id,slack_user,staff_id,text,kind,status,message,posted_at,created_at) VALUES(?,?,?,?,?,'REJECTED',?,?,?)").bind(id,m.user,person?.id??null,text,kind,reason,postedAt,now),advance(m.ts)]);
  await notify(env,'chat.postMessage',{channel,thread_ts:m.ts,text:`${reason}\n${appHint}`});
 }
 await env.DB.prepare('UPDATE slack_state SET polled_at=? WHERE channel=?').bind(now,channel).run();
}

// 勤怠（打刻・修正の申請・管理者の修正）と勤務予定表。予定のカレンダーとは別の表で持ち、共有リビジョンは進めない（打刻のたびに全員の画面を再読込させないため）。
// 打刻は消さない。修正は元の打刻を取り消し済みにして新しい行を足し、理由と操作したスタッフを残す。
import {z} from 'zod';
import type {Actor,Env,Statement} from './types';
import type {CertificateRequest} from './client-cert';
import {assert,ApiError} from '../src/lib/errors';
import {keySchema,monthSchema,punchKindSchema,reasonSchema,shiftSchema,timeSchema} from '../src/lib/validation';
import {addDays,dateKey,jstDate} from '../src/lib/date';
import {allowedNext,monthEnd,weekStartOf,type Punch,type PunchRequest,type Shift} from '../src/lib/attendance';
import {audit} from './auth';
import {get} from './store';
import {getSettings} from './routes';

type PunchRow={id:string;staff_id:string;work_date:string;kind:Punch['kind'];at:string;source:Punch['source'];device:string|null;reason:string|null;created_by:string;created_at:string;voided_at:string|null;voided_by:string|null;void_reason:string|null};
type RequestRow={id:string;staff_id:string;work_date:string;kind:Punch['kind'];at:string;reason:string;status:PunchRequest['status'];created_at:string;decided_by:string|null;decided_at:string|null;decision_note:string|null};
type ShiftRow={staff_id:string;day:string;kind:Shift['kind'];pattern:string|null;start:string|null;end:string|null;break_minutes:number;note:string;version:number};
const punchOf=(r:PunchRow):Punch=>({id:r.id,staffId:r.staff_id,workDate:r.work_date,kind:r.kind,at:r.at,source:r.source,device:r.device,reason:r.reason,createdBy:r.created_by,createdAt:r.created_at,voidedAt:r.voided_at,voidedBy:r.voided_by,voidReason:r.void_reason});
const requestOf=(r:RequestRow):PunchRequest=>({id:r.id,staffId:r.staff_id,workDate:r.work_date,kind:r.kind,at:r.at,reason:r.reason,status:r.status,createdAt:r.created_at,decidedBy:r.decided_by,decidedAt:r.decided_at,decisionNote:r.decision_note});
const shiftOf=(r:ShiftRow):Shift=>({staffId:r.staff_id,day:r.day,kind:r.kind,pattern:r.pattern,start:r.start,end:r.end,breakMinutes:r.break_minutes,note:r.note,version:r.version});
const insertPunch=(env:Env,p:Omit<Punch,'voidedAt'|'voidedBy'|'voidReason'>)=>env.DB.prepare('INSERT INTO punches(id,staff_id,work_date,kind,at,source,device,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(p.id,p.staffId,p.workDate,p.kind,p.at,p.source,p.device,p.reason,p.createdBy,p.createdAt);
// 直前の文が1行も変えなければ、CHECK 制約で batch 全体を取り消す（store.ts の commit と同じ仕組み）。
async function guarded(env:Env,steps:(Statement|{changed:Statement})[],message:string){
 const ids:string[]=[],statements:Statement[]=[];
 for(const s of steps){if('changed' in s){const id=crypto.randomUUID();ids.push(id);statements.push(s.changed,env.DB.prepare('INSERT INTO guards(id,ok) VALUES(?,changes())').bind(id));}else statements.push(s);}
 if(ids.length)statements.push(env.DB.prepare(`DELETE FROM guards WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids));
 try{await env.DB.batch(statements);}catch(e){if(String(e).includes('CHECK constraint'))throw new ApiError(409,message);if(String(e).includes('UNIQUE constraint'))throw new ApiError(409,message);throw e;}
}
// 打刻した端末。発行した端末証明書なら端末名、それ以外はフィンガープリントの先頭を残す。
async function deviceOf(req:CertificateRequest,env:Env){
 if(env.MTLS_MODE==='local')return 'local';
 const fp=(req.cf?.tlsClientAuth?.certFingerprintSHA256??'').replaceAll(':','').toLowerCase();if(!fp)return null;
 const row=await env.DB.prepare('SELECT name FROM device_certificates WHERE fingerprint=?').bind(fp).first<{name:string}>();
 return row?.name??fp.slice(0,16);
}
const validPunches=async(env:Env,staffId:string,workDate:string)=>(await env.DB.prepare('SELECT * FROM punches WHERE staff_id=? AND work_date=? AND voided_at IS NULL ORDER BY at').bind(staffId,workDate).all<PunchRow>()).results.map(punchOf);
// 今の勤務日。退勤していない勤務が24時間以内にあればその日（夜勤の退勤は出勤した日に付ける）、なければ今日。
async function currentWorkDate(env:Env,staffId:string,now:Date){
 const last=await env.DB.prepare('SELECT * FROM punches WHERE staff_id=? AND voided_at IS NULL ORDER BY at DESC LIMIT 1').bind(staffId).first<PunchRow>();
 return last&&last.kind!=='OUT'&&now.getTime()-Date.parse(last.at)<86400000?last.work_date:dateKey(now);
}
async function status(env:Env,staffId:string){
 const now=new Date(),workDate=await currentWorkDate(env,staffId,now),punches=await validPunches(env,staffId,workDate);
 const shift=await env.DB.prepare('SELECT * FROM shifts WHERE staff_id=? AND day=?').bind(staffId,workDate).first<ShiftRow>();
 return {workDate,punches,next:allowedNext(punches),shift:shift?shiftOf(shift):null,serverTime:now.toISOString()};
}
const at=(date:string,time:string)=>jstDate(date,time).toISOString();
const entrySchema=z.object({kind:punchKindSchema,date:keySchema,time:timeSchema});
// 打刻の日時は勤務日かその翌日（夜勤の退勤）に限る。
const checkEntry=(workDate:string,e:{date:string})=>assert(e.date===workDate||e.date===addDays(workDate,1),400,'打刻の日付は勤務日か翌日にしてください。');

export async function attendance(req:Request,env:Env,actor:Actor,method:string,id:string|undefined,operation:string|undefined,params:URLSearchParams,body:Record<string,unknown>|null){
 const admin=actor.role==='ADMIN',now=new Date().toISOString();
 if(method==='GET'&&id==='status')return status(env,actor.id);
 if(method==='GET'&&!id){
  // 一般スタッフは自分の勤怠だけを見られる。通常の労働時間制の週は月をまたぐので、月初の週の前月分も返す。
  const staffId=params.get('staffId')||actor.id,month=monthSchema.parse(params.get('month'));assert(admin||staffId===actor.id,403,'自分の勤怠だけを閲覧できます。');
  assert(await get(env.DB,staffId,'staff'),404,'スタッフが見つかりません。');
  const settings=await getSettings(env.DB),from=weekStartOf(month+'-01',settings.weekStartWeekday),to=monthEnd(month);
  const [punches,requests,shifts,confirmed,pending]=await Promise.all([
   env.DB.prepare('SELECT * FROM punches WHERE staff_id=? AND work_date>=? AND work_date<=? ORDER BY at').bind(staffId,from,to).all<PunchRow>(),
   env.DB.prepare('SELECT * FROM punch_requests WHERE staff_id=? AND work_date>=? AND work_date<=? ORDER BY created_at').bind(staffId,from,to).all<RequestRow>(),
   env.DB.prepare('SELECT * FROM shifts WHERE staff_id=? AND day>=? AND day<=?').bind(staffId,from,to).all<ShiftRow>(),
   env.DB.prepare('SELECT * FROM shift_months WHERE month=?').bind(month).first<{confirmed_at:string;confirmed_by:string}>(),
   admin?env.DB.prepare("SELECT * FROM punch_requests WHERE status='PENDING' ORDER BY created_at").all<RequestRow>():Promise.resolve({results:[] as RequestRow[]})]);
  return {punches:punches.results.map(punchOf),requests:requests.results.map(requestOf),shifts:shifts.results.map(shiftOf),confirmed:confirmed?{at:confirmed.confirmed_at,by:confirmed.confirmed_by}:null,pending:pending.results.map(requestOf)};
 }
 assert(method==='POST'||method==='PATCH',405,'操作できません。');assert(body,400,'送信データが不正です。');
 if(id==='punch'&&!operation&&method==='POST'){
  // 時刻はサーバーの時計で決める。画面から時刻は受け取らない。同時に押しても二重にならないよう、打刻の件数が変わっていないことを確かめて足す。
  const kind=punchKindSchema.parse(body.kind),workDate=await currentWorkDate(env,actor.id,new Date(now)),punches=await validPunches(env,actor.id,workDate);
  assert(allowedNext(punches).includes(kind),409,{IN:'すでに出勤しています。',OUT:'出勤していないか、休憩中です。',BREAK_START:'勤務中ではありません。',BREAK_END:'休憩中ではありません。'}[kind]);
  const punch={id:crypto.randomUUID(),staffId:actor.id,workDate,kind,at:now,source:'punch' as const,device:await deviceOf(req as CertificateRequest,env),reason:null,createdBy:actor.id,createdAt:now};
  await guarded(env,[{changed:env.DB.prepare('INSERT INTO punches(id,staff_id,work_date,kind,at,source,device,reason,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM punches WHERE staff_id=? AND work_date=? AND voided_at IS NULL)=?').bind(punch.id,punch.staffId,punch.workDate,punch.kind,punch.at,punch.source,punch.device,punch.reason,punch.createdBy,punch.createdAt,actor.id,workDate,punches.length)},audit(env,actor.id,'PUNCH_'+kind,punch.id)],'別の画面で打刻されました。画面を更新してください。');
  return {ok:true,...await status(env,actor.id)};
 }
 if(id==='requests'&&!operation&&method==='POST'){
  // 打ち忘れなどの申請は本人だけが出す。承認されるまで勤怠には入らない。
  const workDate=keySchema.parse(body.workDate),entry=entrySchema.parse(body),reason=reasonSchema.parse(body.reason);checkEntry(workDate,entry);
  const time=at(entry.date,entry.time);assert(time<=now,400,'これからの時刻は申請できません。');
  const r={id:crypto.randomUUID()};
  await env.DB.batch([env.DB.prepare("INSERT INTO punch_requests(id,staff_id,work_date,kind,at,reason,status,created_at) VALUES(?,?,?,?,?,?,'PENDING',?)").bind(r.id,actor.id,workDate,entry.kind,time,reason,now),audit(env,actor.id,'PUNCH_REQUESTED',r.id)]);
  return {ok:true,id:r.id};
 }
 if(id==='requests'&&operation&&method==='PATCH'){
  assert(admin,403,'管理者のみ操作できます。');
  const r=await env.DB.prepare('SELECT * FROM punch_requests WHERE id=?').bind(operation).first<RequestRow>();assert(r,404,'申請が見つかりません。');assert(r.status==='PENDING',409,'すでに処理された申請です。');
  const approve=z.boolean().parse(body.approve),note=z.string().trim().max(500).default('').parse(body.note);assert(approve||note,400,'却下の理由を入力してください。');
  const steps:(Statement|{changed:Statement})[]=[{changed:env.DB.prepare("UPDATE punch_requests SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=? AND status='PENDING'").bind(approve?'APPROVED':'REJECTED',actor.id,now,note,r.id)}];
  if(approve)steps.push(insertPunch(env,{id:crypto.randomUUID(),staffId:r.staff_id,workDate:r.work_date,kind:r.kind,at:r.at,source:'request',device:null,reason:r.reason+(note?`（承認: ${note}）`:''),createdBy:actor.id,createdAt:now}));
  steps.push(audit(env,actor.id,approve?'PUNCH_REQUEST_APPROVED':'PUNCH_REQUEST_REJECTED',r.id));
  await guarded(env,steps,'すでに処理された申請です。');return {ok:true};
 }
 if(id==='corrections'&&!operation&&method==='POST'){
  // 管理者の修正。理由は必須。取り消す打刻は残し、全部反映されるか1件も反映されないかのどちらか。
  assert(admin,403,'管理者のみ操作できます。');
  const staffId=z.string().max(100).parse(body.staffId),workDate=keySchema.parse(body.workDate),reason=reasonSchema.parse(body.reason);
  const add=z.array(entrySchema).max(20).parse(body.add??[]),remove=z.array(z.string().max(100)).max(20).parse(body.void??[]);
  assert(add.length||remove.length,400,'修正する打刻がありません。');assert(new Set(remove).size===remove.length,400,'同じ打刻が含まれています。');
  assert(await get(env.DB,staffId,'staff'),404,'スタッフが見つかりません。');for(const e of add){checkEntry(workDate,e);assert(at(e.date,e.time)<=now,400,'これからの時刻は登録できません。');}
  const steps:(Statement|{changed:Statement})[]=remove.map(p=>({changed:env.DB.prepare('UPDATE punches SET voided_at=?,voided_by=?,void_reason=? WHERE id=? AND staff_id=? AND work_date=? AND voided_at IS NULL').bind(now,actor.id,reason,p,staffId,workDate)}));
  for(const e of add)steps.push(insertPunch(env,{id:crypto.randomUUID(),staffId,workDate,kind:e.kind,at:at(e.date,e.time),source:'correction',device:null,reason,createdBy:actor.id,createdAt:now}));
  steps.push(audit(env,actor.id,'ATTENDANCE_CORRECTED',staffId+':'+workDate));
  await guarded(env,steps,'打刻が変更されました。再読込してください。');return {ok:true};
 }
 throw new ApiError(404,'APIがありません。');
}

export async function shifts(env:Env,actor:Actor,method:string,id:string|undefined,params:URLSearchParams,body:Record<string,unknown>|null){
 if(method==='GET'&&!id){
  // 勤務予定表は全員が見られる。
  const month=monthSchema.parse(params.get('month'));
  const [rows,confirmed]=await Promise.all([env.DB.prepare('SELECT * FROM shifts WHERE day>=? AND day<=?').bind(month+'-01',monthEnd(month)).all<ShiftRow>(),env.DB.prepare('SELECT * FROM shift_months WHERE month=?').bind(month).first<{confirmed_at:string;confirmed_by:string}>()]);
  return {shifts:rows.results.map(shiftOf),confirmed:confirmed?{at:confirmed.confirmed_at,by:confirmed.confirmed_by}:null};
 }
 assert(method==='POST',405,'操作できません。');assert(actor.role==='ADMIN',403,'管理者のみ操作できます。');assert(body,400,'送信データが不正です。');
 const month=monthSchema.parse(body.month),now=new Date().toISOString(),confirmed=await env.DB.prepare('SELECT 1 AS ok FROM shift_months WHERE month=?').bind(month).first();
 if(id==='confirm'){
  assert(!confirmed,409,'この月はすでに確定しています。');
  await guarded(env,[{changed:env.DB.prepare('INSERT OR IGNORE INTO shift_months(month,confirmed_at,confirmed_by) VALUES(?,?,?)').bind(month,now,actor.id)},audit(env,actor.id,'SHIFTS_CONFIRMED',month)],'この月はすでに確定しています。');
  return {ok:true};
 }
 assert(!id,404,'APIがありません。');
 // version 0 は新しいセル。保存は version で競合を確かめ、全部反映されるか1件も反映されないかのどちらか。
 const items=z.array(shiftSchema).max(500).parse(body.items??[]),removes=z.array(z.object({staffId:z.string().max(100),day:keySchema,version:z.number().int().positive()})).max(500).parse(body.remove??[]);
 const keys=[...items,...removes].map(i=>i.staffId+'|'+i.day);assert(keys.length,400,'変更する予定がありません。');assert(new Set(keys).size===keys.length,400,'同じ日の予定が重複しています。');
 for(const i of [...items,...removes]){assert(i.day.slice(0,7)===month,400,'対象の月の日付を指定してください。');}
 for(const staffId of new Set([...items,...removes].map(i=>i.staffId))){const s=await get(env.DB,staffId,'staff');assert(s&&!s.deleted,400,'スタッフが見つかりません。');}
 const steps:(Statement|{changed:Statement})[]=items.map(i=>{const v=[i.kind,i.kind==='WORK'?i.pattern:null,i.kind==='WORK'?i.start:null,i.kind==='WORK'?i.end:null,i.kind==='WORK'?i.breakMinutes:0,i.note,i.version+1,actor.id,now];
  return {changed:i.version?env.DB.prepare('UPDATE shifts SET kind=?,pattern=?,start=?,end=?,break_minutes=?,note=?,version=?,updated_by=?,updated_at=? WHERE staff_id=? AND day=? AND version=?').bind(...v,i.staffId,i.day,i.version):env.DB.prepare('INSERT INTO shifts(kind,pattern,start,end,break_minutes,note,version,updated_by,updated_at,staff_id,day) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(...v,i.staffId,i.day)};});
 for(const r of removes)steps.push({changed:env.DB.prepare('DELETE FROM shifts WHERE staff_id=? AND day=? AND version=?').bind(r.staffId,r.day,r.version)});
 // 確定した後の変更も受け付けるが、変更履歴で分かるようにする。
 steps.push(audit(env,actor.id,confirmed?'SHIFTS_CHANGED_AFTER_CONFIRM':'SHIFTS_SAVED',month+':'+keys.length));
 await guarded(env,steps,'別のスタッフが勤務予定を更新しました。再読込してください。');
 return {ok:true};
}

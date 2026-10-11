import type {Actor,Doc,Env} from './types';
import {assert} from '../src/lib/errors';
import {csvHeaders} from '../src/lib/csv';
import {jstDate,addDays} from '../src/lib/date';
import {patientSchema,appointmentSchema} from '../src/lib/validation';
import {list,get,revision,bulkPut,commit} from './store';
import {makeAppointment,type Entry} from './domain';
type ImportRow={line:number;label:string;action:string;errors:string[];entry?:Entry};
type Job={id:string;actor_id:string;kind:'patients'|'appointments';revision:number;data:string;next_chunk:number;expires:number};
export async function imports(env:Env,actor:Actor,kind:string,operation:string,body:Record<string,unknown>){
 assert(kind==='patients'||kind==='appointments',404,'取込種類が不正です。');
 if(operation==='start'){
 const meta=await revision(env.DB);assert(body.revision===meta.revision,409,'データが変更されました。再読込してください。');const id=crypto.randomUUID();
 await env.DB.batch([env.DB.prepare('DELETE FROM imports WHERE expires<?').bind(Date.now()),env.DB.prepare('INSERT INTO imports(id,actor_id,kind,revision,data,expires) VALUES(?,?,?,?,?,?)').bind(id,actor.id,kind,meta.revision,'[]',Date.now()+1800000)]);return {id};}
 assert(typeof body.id==='string',400,'取込IDが必要です。');const job=await env.DB.prepare('SELECT * FROM imports WHERE id=? AND actor_id=? AND expires>?').bind(body.id,actor.id,Date.now()).first<Job>();
 assert(job&&job.kind===kind,404,'取込の有効期限が切れました。');assert((await revision(env.DB)).revision===job.revision,409,'データが変更されました。プレビューをやり直してください。');
 const accumulated=JSON.parse(job.data) as ImportRow[];
 if(operation==='preview'){
 assert(Number.isInteger(body.chunk)&&body.chunk===job.next_chunk,409,'取込順序を確認してください。');assert(Array.isArray(body.rows)&&body.rows.length>0&&body.rows.length<=50,400,'50行以内で送信してください。');
 assert(accumulated.length+body.rows.length<=1000,400,'CSVは1000件以内にしてください。');
 const [patients,facilities,staff]=await Promise.all([list(env.DB,'patients'),list(env.DB,'facilities'),list(env.DB,'staff')]);
 const days=(body.rows as string[][]).map(r=>r[2]).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(new Date(d+'T00:00:00Z').getTime())).sort();
 const appointments=kind==='appointments'&&days.length?await list(env.DB,'appointments','AND cancelled=0 AND starts_at>=? AND starts_at<?',[jstDate(days[0],'00:00').toISOString(),jstDate(addDays(days.at(-1)!,1),'00:00').toISOString()]):[];
 const seen=new Set(accumulated.map(r=>kind==='patients'?String(r.entry?.doc.number??r.label):JSON.stringify([r.entry?.doc.patientId,r.entry?.doc.title,r.entry?.doc.startsAt,r.entry?.doc.endsAt])));
 const rows:ImportRow[]=[];
 for(const raw of body.rows){assert(Array.isArray(raw)&&raw.every(x=>typeof x==='string'),400,'CSVの行が不正です。');const r=raw as string[];const item:ImportRow={line:accumulated.length+rows.length+2,label:r[0]||r[1],action:'追加',errors:[]};if(r.length!==csvHeaders[kind].length)item.errors.push('列数が一致しません');
 if(kind==='patients'){
 const existing=patients.find(p=>p.number===r[0]),facility=facilities.find(f=>f.name===r[4]);if(r[4]&&!facility)item.errors.push('施設を先に登録してください');if(seen.has(r[0]))item.errors.push('患者番号がCSV内で重複しています');seen.add(r[0]);
 const result=patientSchema.safeParse({number:r[0],name:r[1],kana:r[2],address:r[3],facilityId:facility?.id??null,movacalUrl:r[5],handover:r[6],visitFrequency:existing?.visitFrequency??'',active:existing?.active??true});
 if(!result.success)item.errors.push(...result.error.issues.map(x=>x.message));else{item.entry={kind,doc:{...result.data,id:existing?.id??crypto.randomUUID(),version:existing?existing.version+1:1}};item.action=existing?'更新':'追加';}
 }else{
 const patient=patients.find(p=>p.number===r[0]&&p.active);if(r[0]&&!patient)item.errors.push('患者番号がありません');const logins=(r[5]??'').split('|').filter(Boolean),staffIds=logins.map(l=>staff.find(s=>s.login===l&&s.active)?.id);if(staffIds.some(x=>!x))item.errors.push('有効な担当者IDがありません');if(new Set(logins).size!==logins.length)item.errors.push('担当者が重複しています');
 const result=appointmentSchema.safeParse({patientId:patient?.id??null,title:r[1],date:r[2],startTime:r[3],endTime:r[4],staffIds:staffIds.filter(Boolean),memo:r[6]});
 if(!result.success)item.errors.push(...result.error.issues.map(x=>x.message));else{const doc=makeAppointment(result.data);const key=JSON.stringify([doc.patientId,doc.title,doc.startsAt,doc.endsAt]);if(seen.has(key)||appointments.some(a=>a.patientId===doc.patientId&&a.title===doc.title&&a.startsAt===doc.startsAt&&a.endsAt===doc.endsAt))item.errors.push('同じ予定が重複しています');seen.add(key);item.entry={kind,doc};}
 }
 rows.push(item);}
 const next=[...accumulated,...rows];assert(new TextEncoder().encode(JSON.stringify(next)).length<1800000,400,'取込データが大きすぎます。分割してください。');
 const update=await env.DB.prepare('UPDATE imports SET data=?,next_chunk=next_chunk+1 WHERE id=? AND next_chunk=?').bind(JSON.stringify(next),job.id,job.next_chunk).run();assert(update.meta.changes===1,409,'取込が競合しました。やり直してください。');
 return {rows:rows.map(({entry,...r})=>r),valid:next.every(r=>!r.errors.length)};
 }
 assert(operation==='commit',404,'取込操作が不正です。');assert(accumulated.length>0&&accumulated.every(r=>!r.errors.length&&r.entry),400,'CSVのエラーを修正してください。');
 await commit(env.DB,job.revision,[bulkPut(env.DB,accumulated.map(r=>r.entry!)),env.DB.prepare('DELETE FROM imports WHERE id=?').bind(job.id)],actor.id,'IMPORT_'+kind,job.id);return {ok:true,count:accumulated.length};
}

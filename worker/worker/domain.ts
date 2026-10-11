import type {Database,Doc} from './types';
import {assert} from '../src/lib/errors';
import {appointmentSchema} from '../src/lib/validation';
import {jstDate,occurrences,dateKey,addDays,type Recurrence} from '../src/lib/date';
import {get,list} from './store';
export type Entry={kind:string;doc:Doc};
export async function references(db:Database,input:{patientId:string|null;staffIds:string[]}){
 if(input.patientId){const p=await get(db,input.patientId,'patients');assert(p?.active,400,'有効な患者を選んでください。');}
 const staff=await list(db,'staff');assert(new Set(input.staffIds).size===input.staffIds.length&&input.staffIds.every(id=>staff.some(s=>s.id===id&&s.active)),400,'有効な担当者を選んでください。');
}
export function makeAppointment(input:ReturnType<typeof appointmentSchema.parse>,day=input.date,seriesId:string|null=null):Doc{
 return {id:crypto.randomUUID(),version:1,patientId:input.patientId,title:input.title,staffIds:input.staffIds,memo:day===input.date?input.memo:'',startsAt:jstDate(day,input.startTime).toISOString(),endsAt:jstDate(day,input.endTime).toISOString(),seriesId,occurrenceDate:seriesId?day:null,exception:false,cancelled:false};
}
export async function create(db:Database,body:unknown):Promise<Entry[]>{
 const input=appointmentSchema.parse(body);await references(db,input);if(!input.recurrence)return [{kind:'appointments',doc:makeAppointment(input)}];
 const dates=occurrences(input.date,input.endDate!,input.recurrence);assert(dates.length,400,'期間内に該当する曜日がありません。');
 const series:Doc={id:crypto.randomUUID(),version:1,startDate:input.date,endDate:input.endDate,rule:input.recurrence};
 return [{kind:'series',doc:series},...dates.map((day,i)=>({kind:'appointments',doc:{...makeAppointment(input,day,series.id),memo:i===0?input.memo:''}}))];
}
export async function edit(db:Database,current:Doc,body:unknown):Promise<Entry[]>{
 const input=appointmentSchema.parse(body);assert(input.version===current.version,409,'予定が変更されました。再読込してください。');await references(db,input);
 if(input.scope!=='future'||!current.seriesId)return [{kind:'appointments',doc:{...current,...makeAppointment(input),id:current.id,version:current.version+1,seriesId:current.seriesId,occurrenceDate:current.occurrenceDate,exception:!!current.seriesId}}];
 const cutoff=String(current.occurrenceDate);assert(cutoff>=dateKey(new Date())&&input.date>=dateKey(new Date()),400,'過去の予定はこの回のみを編集してください。');
 const series=await get(db,String(current.seriesId),'series');assert(series,404,'繰り返し設定がありません。');
 const rule=(input.recurrence??series.rule) as Recurrence,end=input.endDate??String(series.endDate);
 const dates=occurrences(input.date,end,rule);assert(dates.length,400,'期間内に予定がありません。');
 const old=await list(db,'appointments','AND series_id=? AND occurrence_date>=?',[current.seriesId,cutoff]);
 const newSeries:Doc={id:crypto.randomUUID(),version:1,startDate:input.date,endDate:end,rule};
 const entries:Entry[]=[{kind:'series',doc:{...series,endDate:addDays(cutoff,-1),version:series.version+1}},{kind:'series',doc:newSeries}];
 for(const day of dates){const previous=old.find(a=>a.occurrenceDate===day);if(previous?.exception)continue;
 const a=makeAppointment(input,day,newSeries.id);if(previous){a.id=previous.id;a.version=previous.version+1;a.memo=previous.id===current.id?input.memo:previous.memo;}
 entries.push({kind:'appointments',doc:a});}
 for(const a of old){if(a.exception){entries.push({kind:'appointments',doc:{...a,version:a.version+1,seriesId:null,occurrenceDate:null}});continue;}if(dates.includes(String(a.occurrenceDate)))continue;
 entries.push({kind:'appointments',doc:{...a,version:a.version+1,...(a.memo&&a.id!==current.id?{seriesId:null,occurrenceDate:null,exception:true}:{cancelled:true})}});}
 return entries;
}
export async function remove(db:Database,current:Doc,scope:string):Promise<Entry[]>{
 if(scope!=='future'||!current.seriesId)return [{kind:'appointments',doc:{...current,version:current.version+1,cancelled:true,exception:!!current.seriesId}}];
 const cutoff=String(current.occurrenceDate);assert(cutoff>=dateKey(new Date()),400,'過去の予定はこの回のみ削除してください。');
 const series=await get(db,String(current.seriesId),'series');assert(series,404,'繰り返し設定がありません。');
 const old=await list(db,'appointments','AND series_id=? AND occurrence_date>=?',[current.seriesId,cutoff]);
 return [{kind:'series',doc:{...series,version:series.version+1,endDate:addDays(cutoff,-1)}},...old.map(a=>({kind:'appointments',doc:{...a,version:a.version+1,cancelled:true}}))];
}

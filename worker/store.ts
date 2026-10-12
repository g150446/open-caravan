import type {Database,Doc,Row,Statement} from './types';
import {assert,ApiError} from '../src/lib/errors';
export function decode(row:Row):Doc {return {...JSON.parse(row.data),id:row.id,version:row.version};}
export async function get(db:Database,id:string,kind?:string){const r=await db.prepare('SELECT id,version,data FROM records WHERE id=?'+(kind?' AND kind=?':'')).bind(...(kind?[id,kind]:[id])).first<Row>();return r?decode(r):null;}
export async function list(db:Database,kind:string,where='',args:unknown[]=[]){const r=await db.prepare('SELECT id,version,data FROM records WHERE kind=? '+where).bind(kind,...args).all<Row>();return r.results.map(decode);}
export async function revision(db:Database){const m=await db.prepare('SELECT revision,initialized FROM meta WHERE id=1').first<{revision:number;initialized:number}>();assert(m,503,'データベースを準備してください。');return m;}
export function put(db:Database,kind:string,doc:Doc){
  const lookup=kind==='staff'?(doc.deleted?null:doc.login):kind==='patients'?doc.number:kind==='facilities'?doc.name:null;
  return db.prepare(`INSERT INTO records(id,kind,lookup,data,version,starts_at,patient_id,series_id,occurrence_date,cancelled) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET lookup=excluded.lookup,data=excluded.data,version=excluded.version,starts_at=excluded.starts_at,patient_id=excluded.patient_id,series_id=excluded.series_id,occurrence_date=excluded.occurrence_date,cancelled=excluded.cancelled`).bind(doc.id,kind,lookup,JSON.stringify(doc),doc.version,doc.startsAt??null,doc.patientId??null,doc.seriesId??null,doc.occurrenceDate??null,doc.cancelled?1:0);
}
export function bulkPut(db:Database,entries:{kind:string;doc:Doc}[]){
 const data=entries.map(({kind,doc})=>({kind,id:doc.id,lookup:kind==='patients'?doc.number:kind==='staff'?(doc.deleted?null:doc.login):kind==='facilities'?doc.name:null,data:JSON.stringify(doc),version:doc.version,starts_at:doc.startsAt??null,patient_id:doc.patientId??null,series_id:doc.seriesId??null,occurrence_date:doc.occurrenceDate??null,cancelled:doc.cancelled?1:0}));
 return db.prepare(`INSERT INTO records(id,kind,lookup,data,version,starts_at,patient_id,series_id,occurrence_date,cancelled) SELECT json_extract(value,'$.id'),json_extract(value,'$.kind'),json_extract(value,'$.lookup'),json_extract(value,'$.data'),json_extract(value,'$.version'),json_extract(value,'$.starts_at'),json_extract(value,'$.patient_id'),json_extract(value,'$.series_id'),json_extract(value,'$.occurrence_date'),json_extract(value,'$.cancelled') FROM json_each(?) WHERE 1 ON CONFLICT(id) DO UPDATE SET lookup=excluded.lookup,data=excluded.data,version=excluded.version,starts_at=excluded.starts_at,patient_id=excluded.patient_id,series_id=excluded.series_id,occurrence_date=excluded.occurrence_date,cancelled=excluded.cancelled`).bind(JSON.stringify(data));
}
export async function commit(db:Database,expected:number,statements:Statement[],actor:string,action:string,entity:string){
 assert(Number.isInteger(expected)&&expected>=0,400,'更新番号が必要です。');const guard=crypto.randomUUID();
 try{await db.batch([
 db.prepare('UPDATE meta SET revision=revision+1 WHERE id=1 AND revision=?').bind(expected),
 db.prepare('INSERT INTO guards(id,ok) VALUES(?,changes())').bind(guard),...statements,
 db.prepare('INSERT INTO audit(id,actor_id,action,entity_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),actor,action,entity,new Date().toISOString()),
 db.prepare('DELETE FROM guards WHERE id=?').bind(guard)
 ]);}catch(e){const msg=String(e);if(msg.includes('CHECK constraint'))throw new ApiError(409,'別のスタッフが更新しました。再読込して再試行してください。');if(msg.includes('UNIQUE constraint'))throw new ApiError(409,'同じ患者番号・ログインID・施設名が登録されています。');throw e;}
}
export function safeStaff(d:Doc){const {passwordHash,...safe}=d;return safe;}
export async function snapshot<T>(db:Database,fn:()=>Promise<T>){for(let i=0;i<3;i++){const before=await revision(db);const data=await fn();const after=await revision(db);if(before.revision===after.revision)return {data,revision:after.revision};}throw new ApiError(409,'更新中です。再読込してください。');}

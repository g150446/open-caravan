import {serveStatic} from './static';
import {z} from 'zod';
import type {Env,Actor,Doc} from './types';
import {assert,ApiError} from '../src/lib/errors';
import {appointmentSchema,facilitySchema,keySchema,patientSchema,staffSchema} from '../src/lib/validation';
import {addDays,jstDate} from '../src/lib/date';
import {authenticate,origin,login,setup,setupCheck,passwordHash,cookieName} from './auth';
import {get,list,revision,commit,put,bulkPut,safeStaff,snapshot} from './store';
import {create,edit,remove} from './domain';
import {csvHeaders,encodeCsv} from '../src/lib/csv';
import {imports} from './imports';
const json=(body:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const security:Record<string,string>={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
async function bodyOf(req:Request){assert(Number(req.headers.get('content-length')??0)<=2000000,413,'データが大きすぎます。');const text=await req.text();assert(new TextEncoder().encode(text).length<=2000000,413,'データが大きすぎます。');let b:Record<string,unknown>;try{b=JSON.parse(text);}catch{throw new ApiError(400,'JSONが不正です。');}assert(b&&typeof b==='object'&&!Array.isArray(b),400,'送信データが不正です。');return b;}
function version(doc:Doc,b:Record<string,unknown>){assert(b.version===doc.version,409,'別のスタッフが更新しました。再読込してください。');}
async function api(req:Request,env:Env,url:URL):Promise<Response>{
 const [resource,id,operation,...rest]=url.pathname.slice(5).split('/');assert(!rest.length,404,'APIがありません。');const method=req.method;
 if(resource==='health'){assert(method==='GET',405,'操作できません。');await revision(env.DB);return json({status:'ok'});}
 if(resource==='auth'&&id==='login'&&method==='POST'){const r=await login(req,env,await bodyOf(req));return json(r.body,200,{'Set-Cookie':r.cookie});}
 if(resource==='setup'&&!operation&&method==='POST'){if(id==='check')return json(await setupCheck(req,env,await bodyOf(req)));if(!id)return json(await setup(req,env,await bodyOf(req)));}
 const {staff:actor,session}=await authenticate(req,env,method!=='GET');
 if(resource==='auth'&&id==='me'&&method==='GET')return json({staff:safeStaff(actor),csrf:session.csrf});
 if(resource==='auth'&&id==='logout'&&method==='POST'){await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(session.id).run();return json({ok:true},200,{'Set-Cookie':`${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`});}
 if(resource==='changes'&&method==='GET')return json(await revision(env.DB));
 if(resource==='bootstrap'&&method==='GET')return json(await snapshot(env.DB,async()=>{const [staff,patients,facilities]=await Promise.all([list(env.DB,'staff'),list(env.DB,'patients'),list(env.DB,'facilities')]);return {staff:staff.map(safeStaff),patients,facilities};}));
 if(resource==='appointments'&&method==='GET'){
 if(id)return json(await snapshot(env.DB,async()=>{const a=await get(env.DB,id,'appointments');assert(a&&!a.cancelled,404,'予定が見つかりません。');let previous:Doc[]=[],next:Doc[]=[];if(a.patientId){previous=(await list(env.DB,'appointments','AND patient_id=? AND cancelled=0 AND starts_at<? ORDER BY starts_at DESC LIMIT 3',[a.patientId,a.startsAt]));next=await list(env.DB,'appointments','AND patient_id=? AND cancelled=0 AND starts_at>? ORDER BY starts_at LIMIT 3',[a.patientId,a.startsAt]);}return {appointment:a,previous,next,series:a.seriesId?await get(env.DB,String(a.seriesId),'series'):null};}));
 const from=keySchema.parse(url.searchParams.get('from')),to=keySchema.parse(url.searchParams.get('to'));assert(to>from&&to<=addDays(from,370),400,'取得期間は1〜370日で指定してください。');
 return json(await snapshot(env.DB,()=>list(env.DB,'appointments','AND cancelled=0 AND starts_at>=? AND starts_at<? ORDER BY starts_at',[jstDate(from).toISOString(),jstDate(to).toISOString()])));
 }
 if(resource==='audit'&&method==='GET'){assert(actor.role==='ADMIN',403,'管理者のみ閲覧できます。');return json((await env.DB.prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 100').all()).results);}
 if(resource==='imports'&&method==='GET'){assert(id==='patients'||id==='appointments',404,'テンプレートがありません。');return new Response(encodeCsv([csvHeaders[id]]),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${id}.csv"`,'Cache-Control':'no-store'}});}
 assert(['POST','PATCH','DELETE'].includes(method),405,'操作できません。');const b=await bodyOf(req);
 if(resource==='imports')return json(await imports(env,actor,id,operation,b));
 const expected=z.number().int().nonnegative().parse(b.revision);const meta=await revision(env.DB);assert(meta.revision===expected,409,'別のスタッフが更新しました。再読込してください。');
 let entries:{kind:string;doc:Doc}[]=[],extra:ReturnType<typeof env.DB.prepare>[]=[],entity=id??resource;
 if(resource==='appointments'){
 if(method==='POST'&&!id)entries=await create(env.DB,b);
 else{assert(id,400,'予定IDが必要です。');const a=await get(env.DB,id,'appointments');assert(a&&!a.cancelled,404,'予定が見つかりません。');
 if(operation==='memo'&&method==='PATCH'){version(a,b);const memo=z.string().max(30000).parse(b.memo);entries=[{kind:resource,doc:{...a,memo,version:a.version+1}}];}
 else if(operation==='copy-memo'&&method==='POST'){
 const target=await get(env.DB,z.string().parse(b.targetId),'appointments');assert(target&&!target.cancelled&&a.patientId&&a.patientId===target.patientId&&a.id!==target.id,400,'同じ患者の別の予定を選んでください。');assert(b.sourceVersion===a.version&&b.targetVersion===target.version,409,'メモが変更されました。');assert(!target.memo||b.overwrite===true,409,'コピー先のメモの置き換えを確認してください。');entries=[{kind:resource,doc:{...target,memo:a.memo,version:target.version+1}}];entity=target.id;
 }else if(method==='PATCH'&&!operation)entries=await edit(env.DB,a,b);
 else if(method==='DELETE'&&!operation){version(a,b);const scope=z.enum(['one','future']).parse(b.scope);entries=await remove(env.DB,a,scope);}
 else throw new ApiError(405,'操作できません。');
 }
 }else if(['patients','facilities','staff'].includes(resource)){
 assert(method==='POST'&&!id||method==='PATCH'&&id,405,'操作できません。');let current:Doc|null=null;if(id){current=await get(env.DB,id,resource);assert(current,404,'データがありません。');version(current,b);}const nextId=id??crypto.randomUUID();
 let data:Record<string,unknown>;
 if(resource==='patients'){
 if(operation==='handover'&&current)data={...current,handover:z.string().max(30000).parse(b.handover)};
 else{assert(!operation,405,'操作できません。');data=patientSchema.parse({...b,visitFrequency:b.visitFrequency===undefined?(current?.visitFrequency??''):b.visitFrequency});if(data.facilityId)assert(await get(env.DB,String(data.facilityId),'facilities'),400,'施設がありません。');}
 }else if(resource==='facilities'){assert(!operation,405,'操作できません。');data=facilitySchema.parse(b);}
 else{
 assert(actor.role==='ADMIN',403,'管理者のみ操作できます。');assert(!operation,405,'操作できません。');const parsed=staffSchema.parse(b);const {password,...fields}=parsed;data=fields;
 assert(id&&!password||password&&password.length>=12,400,'パスワードは12〜128文字にしてください。');if(id===actor.id)assert(data.active&&data.role==='ADMIN',400,'自分の管理者アカウントを無効にできません。');
 data.passwordHash=password?await passwordHash(password,env.AUTH_PEPPER):current?.passwordHash;assert(data.passwordHash,400,'パスワードが必要です。');if(id&&(password||!data.active))extra.push(env.DB.prepare('DELETE FROM sessions WHERE staff_id=?').bind(id));
 }
 entries=[{kind:resource,doc:{...data,id:nextId,version:current?current.version+1:1}}];entity=nextId;
 }else throw new ApiError(404,'APIがありません。');
 await commit(env.DB,expected,[bulkPut(env.DB,entries),...extra],actor.id,method+'_'+resource+(operation?'_'+operation:''),entity);return json({ok:true,revision:expected+1});
}
export default {async fetch(req:Request,env:Env){
 let response:Response;try{const url=new URL(req.url);if(url.pathname.startsWith('/api/')){assert(env.DB,503,'データベースの設定が必要です。');response=await api(req,env,url);}else{response=env.ASSETS?await env.ASSETS.fetch(req):serveStatic(req);}}
 catch(e){if(e instanceof ApiError)response=json({error:e.message},e.status);else if(e instanceof z.ZodError)response=json({error:e.issues.map(i=>i.message).join(' / ')},400);else{console.error('request_failed',e instanceof Error?e.name:'unknown');response=json({error:'処理に失敗しました。入力を保持したまま再試行してください。'},500);}}
 const result=new Response(response.body,response);for(const [k,v]of Object.entries(security))result.headers.set(k,v);return result;
}};

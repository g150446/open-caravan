import {serveStatic} from './static';
import {z} from 'zod';
import type {Env,Actor,Doc} from './types';
import {assert,ApiError} from '../src/lib/errors';
import {appointmentSchema,facilitySchema,keySchema,patientSchema,settingsSchema,staffSchema,timeSchema} from '../src/lib/validation';
import {addDays,dateKey,jstDate} from '../src/lib/date';
import {authenticate,origin,login,setup,setupCheck,cookieName,changePassword,temporaryFields,audit} from './auth';
import {get,list,revision,commit,put,bulkPut,safeStaff,snapshot} from './store';
import {create,edit,remove} from './domain';
import {csvHeaders,encodeCsv} from '../src/lib/csv';
import {imports} from './imports';
import {requireClientCertificate} from './client-cert';
import {certificates,activeCertificateIds,revokeAllStatement,revokeAtCloudflare} from './certificates';
import {routes,getSettings,saveSettings,geoDictionary,geocodes} from './routes';
import {attendance,shifts} from './attendance';
const json=(body:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const security:Record<string,string>={'Strict-Transport-Security':'max-age=31536000','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
async function bodyOf(req:Request){assert(Number(req.headers.get('content-length')??0)<=2000000,413,'データが大きすぎます。');const text=await req.text();assert(new TextEncoder().encode(text).length<=2000000,413,'データが大きすぎます。');let b:Record<string,unknown>;try{b=JSON.parse(text);}catch{throw new ApiError(400,'JSONが不正です。');}assert(b&&typeof b==='object'&&!Array.isArray(b),400,'送信データが不正です。');return b;}
function version(doc:Doc,b:Record<string,unknown>){assert(b.version===doc.version,409,'別のスタッフが更新しました。再読込してください。');}
async function api(req:Request,env:Env,url:URL):Promise<Response>{
 const [resource,id,operation,...rest]=url.pathname.slice(5).split('/');const certificateRoute=resource==='staff'&&!!id&&operation==='certificates'&&rest.length<=1,geoRoute=resource==='geo';assert(!rest.length||certificateRoute||geoRoute,404,'APIがありません。');const method=req.method;
 if(resource==='health'){assert(method==='GET',405,'操作できません。');await revision(env.DB);return json({status:'ok'});}
 if(resource==='auth'&&id==='login'&&method==='POST'){const r=await login(req,env,await bodyOf(req));return json(r.body,200,{'Set-Cookie':r.cookie});}
 if(resource==='setup'&&!operation&&method==='POST'){if(id==='check')return json(await setupCheck(req,env,await bodyOf(req)));if(!id)return json(await setup(req,env,await bodyOf(req)));}
 const {staff:actor,session}=await authenticate(req,env,method!=='GET');
 if(resource==='auth'&&id==='me'&&method==='GET')return json({staff:safeStaff(actor),csrf:session.csrf});
 if(resource==='auth'&&id==='logout'&&method==='POST'){await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(session.id),audit(env,actor.id,'LOGOUT',actor.id)]);return json({ok:true},200,{'Set-Cookie':`${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`});}
 if(resource==='auth'&&id==='password'&&method==='POST')return json(await changePassword(env,actor,session.id,await bodyOf(req)));
 // 仮パスワードのままでは、自分のパスワードを設定するまで他のAPIを使えない。
 assert(!actor.mustChangePassword,403,'パスワードを設定してください。');
 if(geoRoute){assert(method==='GET',405,'操作できません。');return geoDictionary(url.pathname.slice('/api/geo/'.length),url.searchParams);}
 if(resource==='geocodes'&&!id)return json(await geocodes(env,actor,method,method==='POST'?await bodyOf(req):null));
 if(certificateRoute)return json(await certificates(req,env,actor,id,rest[0],method==='POST'?await bodyOf(req):null));
 // 勤怠と勤務予定表は共有リビジョンを使わず、行ごとに競合を確かめる。
 if(resource==='attendance')return json(await attendance(req,env,actor,method,id,operation,url.searchParams,method==='GET'?null:await bodyOf(req)));
 if(resource==='shifts')return json(await shifts(env,actor,method,id,url.searchParams,method==='GET'?null:await bodyOf(req)));
 if(resource==='changes'&&method==='GET')return json(await revision(env.DB));
 if(resource==='bootstrap'&&method==='GET')return json(await snapshot(env.DB,async()=>{const [staff,patients,facilities,settings]=await Promise.all([list(env.DB,'staff'),list(env.DB,'patients'),list(env.DB,'facilities'),getSettings(env.DB)]);return {staff:staff.map(safeStaff),patients,facilities,settings:{...settings,routeMode:env.GOOGLE_MAPS_API_KEY?'google':'estimate'}};}));
 if(resource==='appointments'&&method==='GET'){
 if(id)return json(await snapshot(env.DB,async()=>{const a=await get(env.DB,id,'appointments');assert(a&&!a.cancelled,404,'予定が見つかりません。');let previous:Doc[]=[],next:Doc[]=[];if(a.patientId){previous=(await list(env.DB,'appointments','AND patient_id=? AND cancelled=0 AND starts_at<? ORDER BY starts_at DESC LIMIT 3',[a.patientId,a.startsAt]));next=await list(env.DB,'appointments','AND patient_id=? AND cancelled=0 AND starts_at>? ORDER BY starts_at LIMIT 3',[a.patientId,a.startsAt]);}return {appointment:a,previous,next,series:a.seriesId?await get(env.DB,String(a.seriesId),'series'):null};}));
 const from=keySchema.parse(url.searchParams.get('from')),to=keySchema.parse(url.searchParams.get('to'));assert(to>from&&to<=addDays(from,370),400,'取得期間は1〜370日で指定してください。');
 return json(await snapshot(env.DB,()=>list(env.DB,'appointments','AND cancelled=0 AND starts_at>=? AND starts_at<? ORDER BY starts_at',[jstDate(from).toISOString(),jstDate(to).toISOString()])));
 }
 if(resource==='audit'&&method==='GET'){assert(actor.role==='ADMIN',403,'管理者のみ閲覧できます。');return json((await env.DB.prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 300').all()).results);}
 if(resource==='imports'&&method==='GET'){assert(actor.role==='ADMIN',403,'管理者のみ操作できます。');assert(id==='patients'||id==='appointments',404,'テンプレートがありません。');return new Response(encodeCsv([csvHeaders[id]]),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${id}.csv"`,'Cache-Control':'no-store'}});}
 // ルートの計算は読み取りだけなので、更新番号の確認より前で扱う。
 if(resource==='routes'&&!id&&method==='POST')return json(await routes(env,actor,await bodyOf(req)));
 assert(['POST','PATCH','DELETE'].includes(method),405,'操作できません。');const b=await bodyOf(req);
 if(resource==='imports'){assert(actor.role==='ADMIN',403,'管理者のみ操作できます。');return json(await imports(env,actor,id,operation,b));}
 const expected=z.number().int().nonnegative().parse(b.revision);const meta=await revision(env.DB);assert(meta.revision===expected,409,'別のスタッフが更新しました。再読込してください。');
 let entries:{kind:string;doc:Doc}[]=[],extra:ReturnType<typeof env.DB.prepare>[]=[],entity=id??resource,revokeLater:(string|null)[]=[],temporary:{password:string;expires:string}|null=null;
 if(resource==='appointments'&&id==='bulk-delete'){
 // 日付見出しの「この日の予定を一括削除」。表示中の予定をまとめて取り消す。繰り返し予定はその回だけ。1件でも古ければ何も消さない。
 assert(method==='POST'&&!operation,405,'操作できません。');assert(actor.role==='ADMIN',403,'管理者のみ操作できます。');
 const items=z.array(z.object({id:z.string().max(100),version:z.number().int().positive()})).min(1,'削除する予定がありません。').max(300,'一度に削除できるのは300件までです。').parse(b.items);
 assert(new Set(items.map(i=>i.id)).size===items.length,400,'同じ予定が含まれています。');
 const days=new Set<string>();
 for(const item of items){const a=await get(env.DB,item.id,'appointments');assert(a&&!a.cancelled,409,'すでに削除された予定があります。再読込してください。');version(a,item);days.add(dateKey(String(a.startsAt)));entries.push(...await remove(env.DB,a,'one'));}
 entity=[...days].sort().join(',')+':'+items.length;
 }else if(resource==='appointments'&&id==='batch-update'){
 // ルート一括変更の保存。時刻の変更（同じ日の中だけ）と削除をまとめて反映する。繰り返し予定はその回だけ。1件でも古ければ何も変えない。
 assert(method==='POST'&&!operation,405,'操作できません。');
 const item=z.object({id:z.string().max(100),version:z.number().int().positive()});
 const updates=z.array(item.extend({startTime:timeSchema,endTime:timeSchema})).max(300).parse(b.updates??[]),deletes=z.array(item).max(300).parse(b.deletes??[]);
 const ids=[...updates,...deletes].map(i=>i.id);assert(ids.length&&ids.length<=300,400,'変更する予定は1〜300件にしてください。');assert(new Set(ids).size===ids.length,400,'同じ予定が含まれています。');
 const days=new Set<string>();
 for(const u of updates){const a=await get(env.DB,u.id,'appointments');assert(a&&!a.cancelled,409,'すでに削除された予定があります。再読込してください。');version(a,u);assert(u.endTime>u.startTime,400,'終了時刻は開始時刻より後にしてください。');
 const day=dateKey(String(a.startsAt));days.add(day);entries.push({kind:resource,doc:{...a,startsAt:jstDate(day,u.startTime).toISOString(),endsAt:jstDate(day,u.endTime).toISOString(),version:a.version+1,exception:!!a.seriesId}});}
 for(const d of deletes){const a=await get(env.DB,d.id,'appointments');assert(a&&!a.cancelled,409,'すでに削除された予定があります。再読込してください。');version(a,d);days.add(dateKey(String(a.startsAt)));entries.push(...await remove(env.DB,a,'one'));}
 entity=[...days].sort().join(',')+':'+ids.length;
 }else if(resource==='settings'&&!id&&method==='PATCH'){
 // 事業所の設定（ルートの出発・到着地）。管理者だけが変えられる。
 assert(actor.role==='ADMIN',403,'管理者のみ操作できます。');
 // 送られなかった項目（勤務パターンなど）は今の値を引き継ぐ。
 const current=await getSettings(env.DB);const {version:v,...fields}=settingsSchema.parse({...current,...b});assert(v===current.version,409,'別のスタッフが更新しました。再読込してください。');
 extra.push(saveSettings(env.DB,fields,v+1));entity='office';
 }else if(resource==='appointments'){
 if(method==='POST'&&!id)entries=await create(env.DB,b);
 else{assert(id,400,'予定IDが必要です。');const a=await get(env.DB,id,'appointments');assert(a&&!a.cancelled,404,'予定が見つかりません。');
 if(operation==='memo'&&method==='PATCH'){version(a,b);const memo=z.string().max(30000).parse(b.memo);entries=[{kind:resource,doc:{...a,memo,version:a.version+1}}];}
 else if(operation==='copy-memo'&&method==='POST'){
 const target=await get(env.DB,z.string().parse(b.targetId),'appointments');assert(target&&!target.cancelled&&a.patientId&&a.patientId===target.patientId&&a.id!==target.id,400,'同じ患者の別の予定を選んでください。');assert(b.sourceVersion===a.version&&b.targetVersion===target.version,409,'メモが変更されました。');assert(!target.memo||b.overwrite===true,409,'コピー先のメモの置き換えを確認してください。');entries=[{kind:resource,doc:{...target,memo:a.memo,version:target.version+1}}];entity=target.id;
 }else if(method==='PATCH'&&!operation)entries=await edit(env.DB,a,b);
 else if(method==='DELETE'&&!operation){version(a,b);const scope=z.enum(['one','future']).parse(b.scope);entries=await remove(env.DB,a,scope);}
 else throw new ApiError(405,'操作できません。');
 }
 }else if(resource==='staff'&&id&&operation==='temporary-password'&&method==='POST'){
 // パスワードを忘れたときなどに、管理者が仮パスワードを発行し直す。本人のログイン中のセッションは切る。
 assert(actor.role==='ADMIN',403,'管理者のみ操作できます。');assert(id!==actor.id,400,'自分のパスワードは「パスワード変更」から変更してください。');
 const current=await get(env.DB,id,'staff');assert(current&&!current.deleted,404,'スタッフが見つかりません。');version(current,b);
 const t=await temporaryFields(env);temporary={password:t.password,expires:t.fields.temporaryExpires};
 entries=[{kind:resource,doc:{...current,...t.fields,version:current.version+1}}];extra.push(env.DB.prepare('DELETE FROM sessions WHERE staff_id=?').bind(id));
 }else if(resource==='staff'&&id&&!operation&&method==='DELETE'){
 // 削除済みにして一覧と選択肢から外す。過去の予定や履歴に名前を残すため、データ自体は消さずログインIDだけ空ける。
 assert(actor.role==='ADMIN',403,'管理者のみ操作できます。');assert(id!==actor.id,400,'自分のアカウントは削除できません。');
 const current=await get(env.DB,id,'staff');assert(current&&!current.deleted,404,'スタッフが見つかりません。');version(current,b);
 const future=await env.DB.prepare("SELECT count(*) AS n FROM records WHERE kind='appointments' AND cancelled=0 AND starts_at>=? AND EXISTS(SELECT 1 FROM json_each(json_extract(data,'$.staffIds')) WHERE value=?)").bind(new Date().toISOString(),id).first<{n:number}>();
 assert(!future?.n,409,`今後の予定が${future?.n}件あります。担当・同行を変更してから削除するか、停止してください。`);
 const {passwordHash,...rest}=current;entries=[{kind:resource,doc:{...rest,active:false,deleted:true,version:current.version+1}}];
 revokeLater=await activeCertificateIds(env,id);extra.push(env.DB.prepare('DELETE FROM sessions WHERE staff_id=?').bind(id),revokeAllStatement(env,id));
 }else if(['patients','facilities','staff'].includes(resource)){
 assert(method==='POST'&&!id||method==='PATCH'&&id,405,'操作できません。');let current:Doc|null=null;if(id){current=await get(env.DB,id,resource);assert(current&&!current.deleted,404,'データがありません。');version(current,b);}const nextId=id??crypto.randomUUID();
 let data:Record<string,unknown>;
 if(resource==='patients'){
 if(operation==='handover'&&current)data={...current,handover:z.string().max(30000).parse(b.handover)};
 else{assert(!operation,405,'操作できません。');data=patientSchema.parse({...b,visitFrequency:b.visitFrequency===undefined?(current?.visitFrequency??''):b.visitFrequency});if(data.facilityId)assert(await get(env.DB,String(data.facilityId),'facilities'),400,'施設がありません。');}
 }else if(resource==='facilities'){assert(!operation,405,'操作できません。');data=facilitySchema.parse(b);}
 else{
 assert(actor.role==='ADMIN',403,'管理者のみ操作できます。');assert(!operation,405,'操作できません。');const {password:_ignored,...fields}=staffSchema.parse(b);data=fields;if(id===actor.id)assert(data.active&&data.role==='ADMIN',400,'自分の管理者アカウントを無効にできません。');
 // パスワードは管理者が決めない。新規は仮パスワードを発行し、編集では今のパスワードと仮パスワードの状態を引き継ぐ。
 if(current)data={...data,passwordHash:current.passwordHash,...(current.mustChangePassword?{mustChangePassword:true,temporaryExpires:current.temporaryExpires}:{})};
 else{const t=await temporaryFields(env);temporary={password:t.password,expires:t.fields.temporaryExpires};data={...data,...t.fields};}
 if(id&&!data.active)extra.push(env.DB.prepare('DELETE FROM sessions WHERE staff_id=?').bind(id));
 if(id&&!data.active){revokeLater=await activeCertificateIds(env,id);extra.push(revokeAllStatement(env,id));}
 }
 entries=[{kind:resource,doc:{...data,id:nextId,version:current?current.version+1:1}}];entity=nextId;
 }else throw new ApiError(404,'APIがありません。');
 await commit(env.DB,expected,[bulkPut(env.DB,entries),...extra],actor.id,method+'_'+resource+(resource==='appointments'&&(id==='bulk-delete'||id==='batch-update')?'_'+id:operation?'_'+operation:''),entity);
 // 無効にしたスタッフの証明書は D1 で失効済み。Cloudflare 側の失効は失敗しても保存結果は変えない。
 if(revokeLater.length)await revokeAtCloudflare(env,revokeLater);
 return json({ok:true,revision:expected+1,id:entity,...(temporary?{temporaryPassword:temporary.password,temporaryExpires:temporary.expires}:{})});
}
export default {async fetch(req:Request,env:Env){
 let response:Response;try{await requireClientCertificate(req,env);const url=new URL(req.url);if(url.pathname.startsWith('/api/')){assert(env.DB,503,'データベースの設定が必要です。');response=await api(req,env,url);}else{response=env.ASSETS?await env.ASSETS.fetch(req):serveStatic(req);}}
 catch(e){if(e instanceof ApiError)response=json({error:e.message},e.status);else if(e instanceof z.ZodError)response=json({error:e.issues.map(i=>i.message).join(' / ')},400);else{console.error('request_failed',e instanceof Error?e.name:'unknown');response=json({error:'処理に失敗しました。入力を保持したまま再試行してください。'},500);}}
 const result=new Response(response.body,response);for(const [k,v]of Object.entries(security))result.headers.set(k,v);return result;
}};

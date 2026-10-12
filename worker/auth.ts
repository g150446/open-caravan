import type {Actor,Env} from './types';
import {get,safeStaff,commit,put,revision} from './store';
import {assert,ApiError} from '../src/lib/errors';
const enc=new TextEncoder();
export const cookieName='__Host-caravan_session';
const hex=(a:ArrayBuffer)=>Array.from(new Uint8Array(a),x=>x.toString(16).padStart(2,'0')).join('');
export async function digest(s:string){return hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));}
export function random(){return hex(crypto.getRandomValues(new Uint8Array(32)).buffer);}
export async function passwordHash(password:string,pepper:string,salt=random()){
 const hmac=await crypto.subtle.importKey('raw',enc.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const pre=await crypto.subtle.sign('HMAC',hmac,enc.encode(password));
 const key=await crypto.subtle.importKey('raw',pre,'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},key,256);
 return `pbkdf2-sha256:100000:${salt}:${hex(bits)}`;
}
// 管理者に1回だけ表示する仮パスワード。紛らわしい O/0/I/1 を除く32文字から12文字（60ビット）。
export function temporaryPassword(){
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',chars=Array.from(crypto.getRandomValues(new Uint8Array(12)),v=>alphabet[v%32]).join('');
 return chars.match(/.{4}/g)!.join('-');
}
export const TEMPORARY_DAYS=7;
export async function temporaryFields(env:Env){
 const password=temporaryPassword(),expires=new Date(Date.now()+TEMPORARY_DAYS*86400000).toISOString();
 return {password,fields:{passwordHash:await passwordHash(password,env.AUTH_PEPPER),mustChangePassword:true,temporaryExpires:expires}};
}
async function matches(password:string,hash:string,env:Env){return equal(await passwordHash(password,env.AUTH_PEPPER,hash.split(':')[2]),hash);}
// ログイン中の本人がパスワードを変える。仮パスワードからの初回設定にも使う。今のセッションだけ残す。
export async function changePassword(env:Env,actor:Actor,sessionId:string,body:Record<string,unknown>){
 await takeAttempt(env,'password:'+actor.id);
 assert(typeof body.current==='string'&&typeof body.next==='string'&&body.current.length<=128,400,'入力を確認してください。');
 assert(await matches(body.current,String(actor.passwordHash),env),400,'現在のパスワードが違います。');
 assert(body.next.length>=12&&body.next.length<=128,400,'新しいパスワードは12〜128文字にしてください。');
 assert(body.next!==body.current,400,'現在と違うパスワードにしてください。');
 const {mustChangePassword,temporaryExpires,...rest}=actor;const doc={...rest,passwordHash:await passwordHash(body.next,env.AUTH_PEPPER),version:actor.version+1};
 for(let attempt=0;;attempt++){
  const meta=await revision(env.DB);
  try{await commit(env.DB,meta.revision,[put(env.DB,'staff',doc),env.DB.prepare('DELETE FROM sessions WHERE staff_id=? AND id<>?').bind(actor.id,sessionId)],actor.id,'POST_auth_password',actor.id);return {ok:true,revision:meta.revision+1};}
  catch(e){if(attempt>0||!(e instanceof ApiError&&e.status===409))throw e;}
 }
}
export function equal(a:string,b:string){if(a.length!==b.length)return false;let different=0;for(let i=0;i<a.length;i++)different|=a.charCodeAt(i)^b.charCodeAt(i);return different===0;}
export function origin(req:Request,env:Env){assert(env.APP_ORIGIN && req.headers.get('origin')===env.APP_ORIGIN,403,'アクセス元が一致しません。');assert(req.headers.get('content-type')?.startsWith('application/json'),415,'JSONで送信してください。');}
export async function authenticate(req:Request,env:Env,mutate=false){
 const token=(req.headers.get('cookie')??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 assert(token,401,'ログインしてください。');const session=await env.DB.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').bind(await digest(token),Date.now()).first<{id:string;staff_id:string;csrf:string;expires:number}>();
 assert(session,401,'セッションが切れました。再ログインしてください。');const staff=await get(env.DB,session.staff_id,'staff') as Actor|null;
 assert(staff?.active,401,'アカウントが無効です。');if(mutate){origin(req,env);assert(equal(req.headers.get('x-csrf-token')??'',session.csrf),403,'セッションを再読み込みしてください。');}
 return {staff,session};
}
export async function takeAttempt(env:Env,key:string,limit=10){
 const now=Date.now();await env.DB.prepare(`INSERT INTO attempts(id,count,reset_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END`).bind(key,now+900000,now,now,now+900000).run();
 const a=await env.DB.prepare('SELECT count FROM attempts WHERE id=?').bind(key).first<{count:number}>();assert(a&&a.count<=limit,429,'試行回数が多すぎます。15分後に再試行してください。');
}
export async function login(req:Request,env:Env,body:Record<string,unknown>){
 origin(req,env);assert(env.AUTH_PEPPER,503,'認証設定が準備されていません。');const initialized=(await revision(env.DB)).initialized;assert(initialized,503,'管理者の初期設定が必要です。');
 assert(typeof body.login==='string'&&body.login.length<=80&&typeof body.password==='string'&&body.password.length<=128,400,'ログイン情報が不正です。');
 await takeAttempt(env,'login:'+await digest(body.login.toLowerCase().trim()));
 const row=await env.DB.prepare("SELECT id,version,data FROM records WHERE kind='staff' AND lookup=?").bind(body.login.trim()).first<{id:string;version:number;data:string}>();
 const staff=row?{...JSON.parse(row.data),id:row.id,version:row.version} as Actor:null;
 const hash=String(staff?.passwordHash??`pbkdf2-sha256:100000:${'0'.repeat(64)}:${'0'.repeat(64)}`);
 const salt=hash.split(':')[2];const candidate=await passwordHash(body.password,env.AUTH_PEPPER,salt);
 assert(staff?.active&&equal(candidate,hash),401,'IDまたはパスワードが違います。');
 assert(!staff.mustChangePassword||Date.parse(String(staff.temporaryExpires))>Date.now(),401,'仮パスワードの期限が切れています。管理者に再発行を依頼してください。');
 const token=random(),csrf=random();await env.DB.batch([
 env.DB.prepare('DELETE FROM sessions WHERE expires<=?').bind(Date.now()),
 env.DB.prepare('DELETE FROM attempts WHERE reset_at<=?').bind(Date.now()),
 env.DB.prepare('INSERT INTO sessions(id,staff_id,csrf,expires) VALUES(?,?,?,?)').bind(await digest(token),staff.id,csrf,Date.now()+28800000)
 ]);
 return {body:{staff:safeStaff(staff),csrf},cookie:`${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`};
}
export async function setup(req:Request,env:Env,body:Record<string,unknown>){
 origin(req,env);await takeAttempt(env,'setup:'+await digest(req.headers.get('cf-connecting-ip')??'local'),5);
 assert(env.SETUP_TOKEN&&env.AUTH_PEPPER&&Number(env.SETUP_EXPIRES)>Date.now(),403,'初期設定リンクの期限が切れています。');
 assert(typeof body.token==='string'&&equal(body.token,env.SETUP_TOKEN),403,'初期設定リンクが不正です。');
 const meta=await revision(env.DB);assert(!meta.initialized,409,'管理者は登録済みです。');
 assert(typeof body.login==='string'&&/^[A-Za-z0-9_.-]{3,80}$/.test(body.login)&&typeof body.name==='string'&&body.name.trim().length>0&&body.name.length<=100,400,'管理者IDと氏名を確認してください。');
 assert(typeof body.password==='string'&&body.password.length>=12&&body.password.length<=128,400,'パスワードは12〜128文字にしてください。');
 const staff={id:crypto.randomUUID(),version:1,login:body.login,name:body.name.trim(),profession:'医師',color:'#15877f',role:'ADMIN',active:true,passwordHash:await passwordHash(body.password,env.AUTH_PEPPER)};
 await commit(env.DB,meta.revision,[env.DB.prepare('UPDATE meta SET initialized=1 WHERE id=1 AND initialized=0'),put(env.DB,'staff',staff)],staff.id,'SETUP',staff.id);
 return {ok:true};
}

// Check the deployed database and Web Crypto before registering the first user.
// Uses the same setup secret and never creates an account or clinical record.
export async function setupCheck(req:Request,env:Env,body:Record<string,unknown>){
 origin(req,env);await takeAttempt(env,'setup-check:'+await digest(req.headers.get('cf-connecting-ip')??'local'));
 assert(env.SETUP_TOKEN&&env.AUTH_PEPPER&&Number(env.SETUP_EXPIRES)>Date.now(),403,'初期設定リンクの期限が切れています。');
 assert(typeof body.token==='string'&&equal(body.token,env.SETUP_TOKEN),403,'初期設定リンクが不正です。');
 assert(!(await revision(env.DB)).initialized,409,'管理者は登録済みです。');
 const hash=await passwordHash('runtime-readiness-check',env.AUTH_PEPPER);
 assert(hash.startsWith('pbkdf2-sha256:100000:'),503,'認証の準備に失敗しました。');
 return {ok:true};
}

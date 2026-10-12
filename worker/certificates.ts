// スタッフ画面からの端末証明書の発行・失効。秘密鍵はブラウザで作り、ここにはCSRだけが届く。
// 署名は Cloudflare API（ゾーンの「SSL and Certificates: 編集」権限のトークン）に任せ、fingerprint を D1 の許可リストに入れる。
import {z} from 'zod';
import type {Actor,Env} from './types';
import {get} from './store';
import {takeAttempt} from './auth';
import {assert,ApiError} from '../src/lib/errors';

export interface DeviceCertificate {id:string;staff_id:string;name:string;fingerprint:string;cf_id:string|null;expires:string;issued_at:string;revoked_at:string|null;}
const issueSchema=z.object({name:z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/,'端末名は英小文字・数字・ハイフンで入力してください。'),csr:z.string().max(10000).regex(/^-----BEGIN CERTIFICATE REQUEST-----[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE REQUEST-----\s*$/,'CSRが不正です。')});
const hex=(a:ArrayBuffer)=>Array.from(new Uint8Array(a),x=>x.toString(16).padStart(2,'0')).join('');

async function cloudflare(env:Env,path:string,init:RequestInit={}){
 const r=await fetch('https://api.cloudflare.com/client/v4/'+path,{...init,headers:{Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'}});
 const data=await r.json().catch(()=>null) as {success?:boolean;result?:any}|null;
 if(!data?.success){console.error('cloudflare_api_failed',r.status);throw new ApiError(502,'Cloudflareでの証明書の処理に失敗しました。');}
 return data.result;
}
let cachedZone:string|undefined;
async function zone(env:Env){
 if(env.CLOUDFLARE_ZONE_ID)return env.CLOUDFLARE_ZONE_ID;if(cachedZone)return cachedZone;
 const labels=String(env.MTLS_HOST).split('.');
 for(let i=0;i<labels.length-1;i++){const [z]=await cloudflare(env,'zones?name='+labels.slice(i).join('.'));if(z)return cachedZone=z.id as string;}
 throw new ApiError(503,'証明書発行の設定が必要です。');
}
export async function pemFingerprint(pem:string){
 const body=pem.match(/-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----/)?.[1].replace(/\s/g,'');assert(body,502,'Cloudflareから証明書を受け取れませんでした。');
 return hex(await crypto.subtle.digest('SHA-256',Uint8Array.from(atob(body),c=>c.charCodeAt(0))));
}
const audit=(env:Env,actor:Actor,action:string,entity:string)=>env.DB.prepare('INSERT INTO audit(id,actor_id,action,entity_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),actor.id,action,entity,new Date().toISOString());
const publicView=({fingerprint,cf_id,...c}:DeviceCertificate)=>({...c,fingerprint:fingerprint.slice(0,16)});

export async function certificates(req:Request,env:Env,actor:Actor,staffId:string,certId:string|undefined,body:Record<string,unknown>|null){
 assert(actor.role==='ADMIN',403,'管理者のみ操作できます。');
 const staff=await get(env.DB,staffId,'staff');assert(staff,404,'スタッフが見つかりません。');
 if(req.method==='GET'&&!certId)return {certificates:(await env.DB.prepare('SELECT * FROM device_certificates WHERE staff_id=? ORDER BY issued_at DESC').bind(staffId).all<DeviceCertificate>()).results.map(publicView)};
 if(req.method==='POST'&&!certId){
  assert(staff.active,400,'無効なスタッフには発行できません。');assert(env.CLOUDFLARE_API_TOKEN&&env.MTLS_HOST,503,'証明書発行の設定が必要です。');
  const {name,csr}=issueSchema.parse(body);await takeAttempt(env,'certificate:'+actor.id,20);
  assert(!await env.DB.prepare('SELECT 1 AS ok FROM device_certificates WHERE staff_id=? AND name=? AND revoked_at IS NULL').bind(staffId,name).first(),409,'同じ端末名の有効な証明書があります。先に失効してください。');
  const days=Number(env.CERT_VALIDITY_DAYS??365);
  const result=await cloudflare(env,`zones/${await zone(env)}/client_certificates`,{method:'POST',body:JSON.stringify({csr,validity_days:Number.isInteger(days)&&days>0?days:365})});
  const pem=String(result.certificate??''),row:DeviceCertificate={id:crypto.randomUUID(),staff_id:staffId,name,fingerprint:await pemFingerprint(pem),cf_id:result.id??null,expires:String(result.expires_on??''),issued_at:new Date().toISOString(),revoked_at:null};
  await env.DB.batch([env.DB.prepare('INSERT INTO device_certificates(id,staff_id,name,fingerprint,cf_id,expires,issued_at,revoked_at) VALUES(?,?,?,?,?,?,?,NULL)').bind(row.id,row.staff_id,row.name,row.fingerprint,row.cf_id,row.expires,row.issued_at),audit(env,actor,'POST_certificates',row.id)]);
  return {certificate:publicView(row),pem};
 }
 if(req.method==='DELETE'&&certId){
  const row=await env.DB.prepare('SELECT * FROM device_certificates WHERE id=? AND staff_id=? AND revoked_at IS NULL').bind(certId,staffId).first<DeviceCertificate>();assert(row,404,'有効な証明書が見つかりません。');
  // D1 側を先に失効させてアクセスを止め、Cloudflare 側の失効は失敗しても結果だけ返す。
  await env.DB.batch([env.DB.prepare('UPDATE device_certificates SET revoked_at=? WHERE id=?').bind(new Date().toISOString(),row.id),audit(env,actor,'DELETE_certificates',row.id)]);
  return {ok:true,cloudflareRevoked:await revokeAtCloudflare(env,[row.cf_id])};
 }
 throw new ApiError(405,'操作できません。');
}

export async function activeCertificateIds(env:Env,staffId:string){
 return (await env.DB.prepare('SELECT cf_id FROM device_certificates WHERE staff_id=? AND revoked_at IS NULL').bind(staffId).all<{cf_id:string|null}>()).results.map(r=>r.cf_id);
}
export const revokeAllStatement=(env:Env,staffId:string)=>env.DB.prepare('UPDATE device_certificates SET revoked_at=? WHERE staff_id=? AND revoked_at IS NULL').bind(new Date().toISOString(),staffId);
export async function revokeAtCloudflare(env:Env,ids:(string|null)[]){
 let ok=true;
 for(const id of ids){if(!id||!env.CLOUDFLARE_API_TOKEN){ok=false;continue;}try{await cloudflare(env,`zones/${await zone(env)}/client_certificates/${encodeURIComponent(id)}`,{method:'DELETE'});}catch{ok=false;}}
 return ok;
}

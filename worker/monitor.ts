// 会話モニタリング: 通話音声の配信サーバーへ接続するための短命のチケットを発行する。
// 音声は Worker を通さない（無料枠の CPU 時間を使わないため）。チケットには端末証明書の指紋を入れ、別の端末では使えないようにする。
import {assert} from '../src/lib/errors';
import {audit} from './auth';
import type {CertificateRequest} from './client-cert';
import type {Actor,Env} from './types';

const TICKET_SECONDS=60,MIN_SECRET_LENGTH=32;
const enc=new TextEncoder();
const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');

export async function monitorTicket(req:Request,env:Env,actor:Actor,body:Record<string,unknown>){
 assert(actor.canMonitor===true,403,'会話モニタリングの権限がありません。');
 assert((env.MONITOR_TICKET_SECRET?.length??0)>=MIN_SECRET_LENGTH&&env.MONITOR_WS_URL,503,'会話モニタリングの設定が必要です。');
 const cert=((req as CertificateRequest).cf?.tlsClientAuth?.certFingerprintSHA256??'').replaceAll(':','').toLowerCase();
 const payload=base64url(enc.encode(JSON.stringify({aud:'call-monitor',sub:actor.id,name:actor.name,cert,jti:crypto.randomUUID(),exp:Math.floor(Date.now()/1000)+TICKET_SECONDS})));
 const key=await crypto.subtle.importKey('raw',enc.encode(env.MONITOR_TICKET_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(payload)));
 // 接続中の定期的な再認証は変更履歴に残さない（聴取の記録は配信サーバーのログに残る）。
 if(body.renew!==true)await audit(env,actor.id,'MONITOR_TICKET',actor.id).run();
 return {ticket:`${payload}.${base64url(signature)}`,url:env.MONITOR_WS_URL};
}

// 配信サーバーへの WebSocket と、端末証明書を選択させるための HTTPS リクエストだけを CSP で追加で許可する。
export function monitorConnectSource(env:Env){
 try{const url=new URL(env.MONITOR_WS_URL??'');return url.protocol==='wss:'?` ${url.origin} https://${url.host}`:'';}catch{return '';}
}

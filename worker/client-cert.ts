import {assert} from '../src/lib/errors';
import type {Env} from './types';

export interface ClientCertificate {certPresented?:string;certVerified?:string;certRevoked?:string;certFingerprintSHA256?:string;}
export type CertificateRequest=Request & {cf?:{tlsClientAuth?:ClientCertificate}};
const fingerprint=(value:string)=>value.replaceAll(':','').toLowerCase();

export function requireClientCertificate(req:CertificateRequest,env:Env){
 const url=new URL(req.url);
 // This exception only works in the loopback HTTP development server, never at Cloudflare.
 if(env.MTLS_MODE==='local'){
  assert(!req.cf&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&env.APP_ORIGIN===url.origin,403,'クライアント証明書が必要です。');
  return;
 }
 assert(env.MTLS_MODE===undefined||env.MTLS_MODE==='required',503,'証明書認証の設定が必要です。');
 const allowed=(env.MTLS_ALLOWED_SHA256??'').split(',').map(v=>fingerprint(v.trim()));
 assert(env.MTLS_HOST&&/^[a-z0-9.-]+$/.test(env.MTLS_HOST)&&env.APP_ORIGIN===`https://${env.MTLS_HOST}`&&allowed.length>0&&allowed.every(v=>/^[a-f0-9]{64}$/.test(v)),503,'証明書認証の設定が必要です。');
 assert(url.protocol==='https:'&&url.host===env.MTLS_HOST,403,'クライアント証明書が必要です。');
 const cert=req.cf?.tlsClientAuth;
 assert(cert?.certPresented==='1'&&cert.certVerified==='SUCCESS'&&cert.certRevoked==='0'&&typeof cert.certFingerprintSHA256==='string'&&allowed.includes(fingerprint(cert.certFingerprintSHA256)),403,'クライアント証明書が必要です。');
}

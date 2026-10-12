import test from 'node:test';import assert from 'node:assert/strict';
import sourceWorker from '../worker/index';import {requireClientCertificate,type ClientCertificate,type CertificateRequest} from '../worker/client-cert';import type {Env} from '../worker/types';
const worker=process.env.TEST_BUNDLE?(await import('../build/worker.js' as string)).default:sourceWorker;
const sha='a'.repeat(64),host='caravan.example.com';
const valid:ClientCertificate={certPresented:'1',certVerified:'SUCCESS',certRevoked:'0',certFingerprintSHA256:sha};
function fixture(){let touched=0,lookups=0;const env:Env={DB:{prepare(sql:string){if(sql.includes('FROM device_certificates')){lookups++;const statement={bind(){return statement;},async first(){return null;}};return statement as any;}touched++;throw Error('DB must not be accessed');},async batch(){touched++;throw Error('DB must not be accessed');}},APP_ORIGIN:`https://${host}`,AUTH_PEPPER:'',SETUP_TOKEN:'',SETUP_EXPIRES:'',MTLS_HOST:host,MTLS_ALLOWED_SHA256:sha,ASSETS:{async fetch(){return new Response('protected asset');}}};return {env,get touched(){return touched;},get lookups(){return lookups;}};}
function request(path='/',cert?:ClientCertificate,url=`https://${host}`,headers:Record<string,string>={}){const req:CertificateRequest=new Request(url+path,{headers});if(cert)Object.defineProperty(req,'cf',{value:{tlsClientAuth:cert}});return req;}
test('all routes reject absent, invalid, expired, revoked and unlisted certificates before accessing data',async()=>{
 const f=fixture();const denied=[undefined,{...valid,certPresented:'0'},{...valid,certVerified:'FAILED:self signed certificate'},{...valid,certVerified:'FAILED:certificate has expired'},{...valid,certRevoked:'1'},{...valid,certRevoked:undefined},{...valid,certFingerprintSHA256:'b'.repeat(64)}];
 for(const path of ['/','/assets/app.js','/api/auth/login','/api/setup','/api/health','/api/bootstrap','/api/appointments'])for(const cert of denied){const res=await worker.fetch(request(path,cert,undefined,{Cookie:'oc_session=existing','X-Client-Cert':sha,'Cf-Tls-Client-Auth-Cert-Verified':'true'}),f.env);assert.equal(res.status,403,path);assert.equal(res.headers.get('cache-control'),'no-store');}
 assert.equal(f.touched,0);
 // 検証に失敗した証明書は許可リストを引かない。引くのは検証済みで設定にない証明書（最後の1件）だけ。
 assert.equal(f.lookups,7);
});
test('valid allowlisted certificate can reach assets, normalization and multiple certificates work',async()=>{
 const f=fixture();f.env.MTLS_ALLOWED_SHA256=`${'b'.repeat(64)},${sha.match(/../g)!.join(':').toUpperCase()}`;
 const res=await worker.fetch(request('/',valid),f.env);assert.equal(res.status,200);assert.equal(await res.text(),'protected asset');assert.equal(res.headers.get('x-frame-options'),'DENY');
});
test('misconfiguration fails closed and alternate hosts cannot bypass protection',async()=>{
 for(const change of [{MTLS_ALLOWED_SHA256:''},{MTLS_ALLOWED_SHA256:sha+',bad'},{MTLS_HOST:undefined},{APP_ORIGIN:'https://wrong.example'},{MTLS_MODE:'disabled'}]){const f=fixture();Object.assign(f.env,change);assert.equal((await worker.fetch(request('/',valid),f.env)).status,503);assert.equal(f.touched,0);}
 const f=fixture();for(const url of ['https://open-caravan.example.workers.dev','https://version.example.workers.dev',`http://${host}`])assert.equal((await worker.fetch(request('/',valid,url),f.env)).status,403);
});
test('local exception is restricted to loopback HTTP without Cloudflare metadata',async()=>{
 const f=fixture();f.env.MTLS_MODE='local';f.env.APP_ORIGIN='http://127.0.0.1:3000';
 await assert.doesNotReject(requireClientCertificate(request('/',undefined,f.env.APP_ORIGIN),f.env));
 await assert.rejects(requireClientCertificate(request('/',valid,f.env.APP_ORIGIN),f.env));
 for(const url of ['https://127.0.0.1:3000','http://evil.example',`https://${host}`])await assert.rejects(requireClientCertificate(request('/',undefined,url),f.env));
});

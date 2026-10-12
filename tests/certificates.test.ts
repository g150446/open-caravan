import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import forge from 'node-forge';
import {SQLite} from '../scripts/sqlite';import sourceWorker from '../worker/index';import type {Env} from '../worker/types';
import {createDeviceKey,createP12,createPassword} from '../src/lib/device-cert';
const worker=process.env.TEST_BUNDLE?(await import('../build/worker.js' as string)).default:sourceWorker;

// Cloudflare の代わりに CSR に署名するテスト用CA。発行・失効の呼び出しを記録する。
const caKeys=forge.pki.rsa.generateKeyPair(1024);
function cloudflareMock(){
 const calls:{method:string;path:string}[]=[];let serial=1;
 const original=globalThis.fetch;
 globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=new URL(String(input)),method=init?.method??'GET';calls.push({method,path:url.pathname});
  if(method==='POST'){const csr=forge.pki.certificationRequestFromPem(JSON.parse(String(init!.body)).csr);const cert=forge.pki.createCertificate();cert.publicKey=csr.publicKey!;cert.serialNumber=String(serial++).padStart(2,'0');cert.validity.notBefore=new Date();cert.validity.notAfter=new Date(Date.now()+365*86400000);cert.setSubject(csr.subject.attributes);cert.setIssuer([{name:'commonName',value:'Test CA'}]);cert.sign(caKeys.privateKey,forge.md.sha256.create());
   return Response.json({success:true,result:{id:'cf-'+serial,certificate:forge.pki.certificateToPem(cert),expires_on:cert.validity.notAfter.toISOString()}});}
  return Response.json({success:true,result:{id:url.pathname.split('/').pop()}});
 }) as typeof fetch;
 return {calls,restore(){globalThis.fetch=original;}};
}
function fixture(){
 const db=new SQLite();for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.raw.exec(readFileSync('migrations/'+file,'utf8'));
 const env:Env={MTLS_MODE:'local',DB:db,APP_ORIGIN:'http://127.0.0.1:3000',AUTH_PEPPER:'test-secret-pepper-32-bytes-long-value',SETUP_TOKEN:'test-setup-token-32-bytes-long-value',SETUP_EXPIRES:String(Date.now()+86400000),MTLS_HOST:'caravan.example.com',CLOUDFLARE_API_TOKEN:'test-token',CLOUDFLARE_ZONE_ID:'zone1'};
 let rev=1;
 async function call(session:{cookie:string;csrf:string},path:string,method='GET',body?:unknown){const res=await worker.fetch(new Request(env.APP_ORIGIN+'/api/'+path,{method,headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json',Cookie:session.cookie,'X-CSRF-Token':session.csrf},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);const data:any=await res.json();if(res.ok&&data.revision)rev=data.revision;return {res,data};}
 async function login(id:string,password:string){const r=await call({cookie:'',csrf:''},'auth/login','POST',{login:id,password});assert.equal(r.res.status,200,JSON.stringify(r.data));return {cookie:r.res.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrf as string,id:r.data.staff.id as string};}
 async function initialize(){await call({cookie:'',csrf:''},'setup','POST',{token:env.SETUP_TOKEN,login:'admin',name:'テスト管理者',password:'test-password-long-enough'});return login('admin','test-password-long-enough');}
 return {db,env,call,login,initialize,get revision(){return rev;}};
}
const staffBody={login:'nurse',name:'テスト看護師',profession:'看護師',color:'#336699',role:'STAFF',active:true};

test('admins issue a certificate from a browser-made CSR, and the .p12 opens with the shown password',async()=>{
 const f=fixture(),cf=cloudflareMock();try{
  const admin=await f.initialize();
  const created=await f.call(admin,'staff','POST',{...staffBody,password:'nurse-password-long',revision:f.revision});assert.equal(created.res.status,200);const staffId=created.data.id as string;
  const key=await createDeviceKey('nurse-iphone');
  const issued=await f.call(admin,`staff/${staffId}/certificates`,'POST',{name:'nurse-iphone',csr:key.csr});assert.equal(issued.res.status,200,JSON.stringify(issued.data));
  assert.equal(issued.data.certificate.name,'nurse-iphone');assert(!('cf_id' in issued.data.certificate));
  assert.equal((await f.call(admin,`staff/${staffId}/certificates`,'POST',{name:'nurse-iphone',csr:key.csr})).res.status,409);
  assert.equal((await f.call(admin,`staff/${staffId}/certificates`,'POST',{name:'Bad Name',csr:key.csr})).res.status,400);
  const password=createPassword();assert.match(password,/^[A-Z2-9]{16}$/);
  const p12=forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.binary.raw.encode(new Uint8Array(await createP12(key,issued.data.pem,password,'nurse-iphone').arrayBuffer()))),password);
  const bag=p12.getBags({bagType:forge.pki.oids.pkcs8ShroudedKeyBag})[forge.pki.oids.pkcs8ShroudedKeyBag]![0];
  assert.equal((bag.key as forge.pki.rsa.PrivateKey).n.compareTo(key.privateKey.n),0);
  const der=forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(issued.data.pem))).getBytes();
  const row=f.db.raw.prepare('SELECT * FROM device_certificates').get();assert.equal(row.fingerprint,forge.md.sha256.create().update(der).digest().toHex());assert.equal(row.staff_id,staffId);
  assert(f.db.raw.prepare("SELECT 1 FROM audit WHERE action='POST_certificates' AND entity_id=?").get(row.id));
  const list=await f.call(admin,`staff/${staffId}/certificates`);assert.equal(list.data.certificates.length,1);assert.equal(list.data.certificates[0].fingerprint.length,16);
  const first=await f.login('nurse',created.data.temporaryPassword);assert.equal((await f.call(first,'auth/password','POST',{current:created.data.temporaryPassword,next:'nurse-password-long'})).res.status,200);
  const nurse=await f.login('nurse','nurse-password-long');
  assert.equal((await f.call(nurse,`staff/${staffId}/certificates`)).res.status,403);
  assert.equal((await f.call(nurse,`staff/${staffId}/certificates`,'POST',{name:'other',csr:key.csr})).res.status,403);
 }finally{cf.restore();}
});

test('revoking one certificate or deactivating the staff member closes access in D1 and at Cloudflare',async()=>{
 const f=fixture(),cf=cloudflareMock();try{
  const admin=await f.initialize();
  const staffId=(await f.call(admin,'staff','POST',{...staffBody,password:'nurse-password-long',revision:f.revision})).data.id as string;
  const ids:string[]=[];for(const name of ['nurse-iphone','nurse-pc','nurse-tablet'])ids.push((await f.call(admin,`staff/${staffId}/certificates`,'POST',{name,csr:(await createDeviceKey(name)).csr})).data.certificate.id);
  const one=await f.call(admin,`staff/${staffId}/certificates/${ids[0]}`,'DELETE');assert.equal(one.res.status,200);assert.equal(one.data.cloudflareRevoked,true);
  assert.equal((await f.call(admin,`staff/${staffId}/certificates/${ids[0]}`,'DELETE')).res.status,404);
  assert.equal(cf.calls.filter(c=>c.method==='DELETE').length,1);
  const staff=(await f.call(admin,'bootstrap')).data.data.staff.find((s:any)=>s.id===staffId);
  assert.equal((await f.call(admin,`staff/${staffId}`,'PATCH',{...staffBody,active:false,version:staff.version,revision:f.revision})).res.status,200);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM device_certificates WHERE revoked_at IS NULL').get().n,0);
  assert.equal(cf.calls.filter(c=>c.method==='DELETE').length,3);
  assert.equal((await f.call(admin,`staff/${staffId}/certificates`,'POST',{name:'again',csr:(await createDeviceKey('again')).csr})).res.status,400);
 }finally{cf.restore();}
});

test('certificates in D1 open the site only while unrevoked and the staff member is active',async()=>{
 const f=fixture();const host='caravan.example.com',sha='c'.repeat(64);
 const admin=await f.initialize();
 Object.assign(f.env,{MTLS_MODE:'required',APP_ORIGIN:`https://${host}`,MTLS_ALLOWED_SHA256:'a'.repeat(64),ASSETS:{async fetch(){return new Response('protected asset');}}});
 f.db.raw.prepare("INSERT INTO device_certificates(id,staff_id,name,fingerprint,cf_id,expires,issued_at) VALUES('c1',?,'admin-pc',?,NULL,'2027-01-01','2026-01-01')").run(admin.id,sha);
 const open=async()=>{const req=new Request(`https://${host}/`);Object.defineProperty(req,'cf',{value:{tlsClientAuth:{certPresented:'1',certVerified:'SUCCESS',certRevoked:'0',certFingerprintSHA256:sha}}});return (await worker.fetch(req,f.env)).status;};
 assert.equal(await open(),200);
 f.db.raw.prepare("UPDATE records SET data=json_set(data,'$.active',json('false')) WHERE id=?").run(admin.id);assert.equal(await open(),403);
 f.db.raw.prepare("UPDATE records SET data=json_set(data,'$.active',json('true')) WHERE id=?").run(admin.id);assert.equal(await open(),200);
 f.db.raw.prepare("UPDATE device_certificates SET revoked_at='2026-02-01'").run();assert.equal(await open(),403);
});

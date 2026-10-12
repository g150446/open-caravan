// 端末ごとのクライアント証明書を発行・失効し、wrangler.local.jsonc の MTLS_ALLOWED_SHA256 を更新する。
// 使い方:
//   node scripts/device-cert.mjs issue tanaka-iphone tanaka-pc ...
//   node scripts/device-cert.mjs revoke tanaka-iphone
//   node scripts/device-cert.mjs list
//   node scripts/device-cert.mjs worker-secret   （このトークンを Worker のシークレットに登録し、スタッフ画面から発行できるようにする）
// CLOUDFLARE_API_TOKEN（ゾーンの「SSL and Certificates: 編集」権限）があればAPIで発行・失効する。
// 未設定の場合はCSRを表示し、ダッシュボードで発行した証明書PEMの貼り付けを待つ。
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {createInterface} from 'node:readline/promises';

const CONFIG=process.env.WRANGLER_CONFIG??'wrangler.local.jsonc';
const ROOT='certificates/devices',REGISTRY='certificates/devices.json';
const VALIDITY_DAYS=Number(process.env.CERT_VALIDITY_DAYS??365);
const token=process.env.CLOUDFLARE_API_TOKEN;

const openssl=(...args)=>execFileSync('openssl',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
const registry=()=>existsSync(REGISTRY)?JSON.parse(readFileSync(REGISTRY,'utf8')):[];
const saveRegistry=list=>writeFileSync(REGISTRY,JSON.stringify(list,null,2)+'\n',{mode:0o600});
const config=()=>readFileSync(CONFIG,'utf8');
const allowedPattern=/("MTLS_ALLOWED_SHA256"\s*:\s*")([^"]*)(")/;
const mtlsHost=()=>config().match(/"MTLS_HOST"\s*:\s*"([^"]+)"/)?.[1]??fail(`${CONFIG} に MTLS_HOST がありません。`);

function fail(message){console.error(message);process.exit(1);}

function updateAllowed(update){
 const text=config(),match=text.match(allowedPattern)??fail(`${CONFIG} に MTLS_ALLOWED_SHA256 がありません。`);
 const next=[...new Set(update(match[2].split(',').map(v=>v.trim()).filter(Boolean)))];
 writeFileSync(CONFIG,text.replace(allowedPattern,`$1${next.join(',')}$3`));
 return next.length;
}

async function api(path,init={}){
 const r=await fetch('https://api.cloudflare.com/client/v4/'+path,{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
 const data=await r.json();
 if(!data.success)fail(`Cloudflare API エラー (${path}): ${JSON.stringify(data.errors)}`);
 return data.result;
}

let zoneId;
async function zone(){
 if(zoneId)return zoneId;
 const labels=mtlsHost().split('.');
 for(let i=0;i<labels.length-1;i++){const [z]=await api('zones?name='+labels.slice(i).join('.'));if(z)return zoneId=z.id;}
 fail(`${mtlsHost()} のゾーンが見つかりません。`);
}

async function pastePem(csr,name){
 console.log(`\n[${name}] CloudflareのSSL/TLS → クライアント証明書 → 証明書を作成 →「自分のプライベート キーと CSR を使用する」に次のCSRを貼り付け、有効期間を選んで発行してください。\n\n${csr}`);
 console.log('発行された証明書（-----BEGIN CERTIFICATE----- から -----END CERTIFICATE----- まで）を貼り付けてください:');
 const rl=createInterface({input:process.stdin});let pem='';
 for await(const line of rl){pem+=line.trim()+'\n';if(line.includes('END CERTIFICATE'))break;}
 rl.close();
 return pem;
}

async function issue(names){
 if(!names.length)fail('端末名を指定してください。例: issue tanaka-iphone tanaka-pc');
 const list=registry();
 for(const name of names){
  if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name))fail(`端末名は英小文字・数字・ハイフンで指定してください: ${name}`);
  if(list.some(d=>d.name===name&&!d.revoked))fail(`${name} は発行済みです。再発行する場合は先に revoke してください。`);
 }
 mkdirSync(ROOT,{recursive:true,mode:0o700});
 for(const name of names){
  const dir=join(ROOT,name);mkdirSync(dir,{recursive:true,mode:0o700});
  const key=join(dir,`${name}.key`),csrPath=join(dir,`${name}.csr`),pemPath=join(dir,`${name}.pem`),p12=join(dir,`${name}.p12`),pass=join(dir,'password.txt');
  openssl('req','-new','-newkey','rsa:2048','-nodes','-keyout',key,'-out',csrPath,'-subj',`/CN=Open Caravan ${name}`);
  const csr=readFileSync(csrPath,'utf8');
  let pem,id=null;
  if(token){
   const result=await api(`zones/${await zone()}/client_certificates`,{method:'POST',body:JSON.stringify({csr,validity_days:VALIDITY_DAYS})});
   pem=result.certificate;id=result.id;
  }else pem=await pastePem(csr,name);
  writeFileSync(pemPath,pem,{mode:0o600});
  if(openssl('x509','-in',pemPath,'-noout','-pubkey')!==openssl('pkey','-in',key,'-pubout'))fail(`${name}: 証明書と秘密鍵が一致しません。`);
  const fingerprint=openssl('x509','-in',pemPath,'-noout','-fingerprint','-sha256').split('=')[1].replaceAll(':','').trim().toLowerCase();
  const expires=openssl('x509','-in',pemPath,'-noout','-enddate').split('=')[1].trim();
  writeFileSync(pass,randomBytes(12).toString('base64url')+'\n',{mode:0o600});
  // AndroidでもmacOS/iOS/Windowsでも読み込める暗号方式で作成する。
  openssl('pkcs12','-export','-inkey',key,'-in',pemPath,'-name',`Open Caravan ${name}`,'-certpbe','PBE-SHA1-3DES','-keypbe','PBE-SHA1-3DES','-macalg','sha1','-out',p12,'-passout',`file:${pass}`);
  updateAllowed(v=>[...v,fingerprint]);
  list.push({name,fingerprint,certificateId:id,expires,issuedAt:new Date().toISOString(),revoked:false});
  saveRegistry(list);
  console.log(`発行: ${name}  期限 ${expires}  ${p12}`);
 }
 console.log(`\n${CONFIG} の MTLS_ALLOWED_SHA256 を更新しました。反映するにはデプロイしてください:\n  NODE_OPTIONS=--dns-result-order=ipv4first npx --yes wrangler@4 deploy --config ${CONFIG}`);
 console.log('各端末には .p12 と password.txt を別々の経路で渡してください。インストール後は端末から両方を削除します。');
}

async function revoke(names){
 if(!names.length)fail('失効する端末名を指定してください。');
 const list=registry();
 for(const name of names){
  const device=list.find(d=>d.name===name&&!d.revoked)??fail(`${name} は登録されていないか、失効済みです。`);
  if(device.certificateId&&token)await api(`zones/${await zone()}/client_certificates/${device.certificateId}`,{method:'DELETE'});
  else console.log(`${name}: Cloudflareダッシュボードのクライアント証明書一覧で CN=Open Caravan ${name} を失効してください。`);
  updateAllowed(v=>v.filter(f=>f!==device.fingerprint));
  Object.assign(device,{revoked:true,revokedAt:new Date().toISOString()});
  saveRegistry(list);
  console.log(`失効: ${name}`);
 }
 console.log(`\n許可リストから削除しました。反映するにはデプロイしてください:\n  NODE_OPTIONS=--dns-result-order=ipv4first npx --yes wrangler@4 deploy --config ${CONFIG}`);
}

// .env.device-cert のトークンを、そのまま Worker の CLOUDFLARE_API_TOKEN に登録する。先にゾーンを引けるか確かめる。
// wrangler にはこのトークンを渡さない（証明書の権限しかないので、wrangler login の認証で登録させる）。
async function workerSecret(){
 if(!token)fail('.env.device-cert に CLOUDFLARE_API_TOKEN=... を書いてから実行してください。');
 await zone();
 execFileSync('npx',['--yes','wrangler@4','secret','put','CLOUDFLARE_API_TOKEN','--config',CONFIG],{input:token,stdio:['pipe','inherit','inherit'],env:{...process.env,CLOUDFLARE_API_TOKEN:undefined,NODE_OPTIONS:'--dns-result-order=ipv4first'}});
 console.log('\n登録しました。デプロイなしで、スタッフ画面から証明書を発行できます。');
}

function show(){
 const allowed=config().match(allowedPattern)?.[2].split(',')??[];
 for(const d of registry())console.log(`${d.revoked?'失効':allowed.includes(d.fingerprint)?'有効':'未反映'}\t${d.name}\t${d.expires}\t${d.fingerprint.slice(0,16)}…`);
}

const [command,...args]=process.argv.slice(2);
if(command==='issue')await issue(args);
else if(command==='revoke')await revoke(args);
else if(command==='list')show();
else if(command==='worker-secret')await workerSecret();
else fail('使い方: node scripts/device-cert.mjs issue <端末名...> | revoke <端末名...> | list | worker-secret');

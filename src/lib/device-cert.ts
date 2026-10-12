// 端末証明書の秘密鍵・CSR・.p12 をブラウザの中で作る。秘密鍵とパスワードはサーバーへ送らない。
import forge from 'node-forge';

export interface DeviceKey {privateKey:forge.pki.rsa.PrivateKey;csr:string;}

export async function createDeviceKey(name:string):Promise<DeviceKey>{
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const pkcs8=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
 const privateKey=forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(forge.util.binary.raw.encode(pkcs8))) as forge.pki.rsa.PrivateKey;
 const request=forge.pki.createCertificationRequest();
 request.publicKey=forge.pki.setRsaPublicKey(privateKey.n,privateKey.e);
 request.setSubject([{name:'commonName',value:`Open Caravan ${name}`}]);
 request.sign(privateKey,forge.md.sha256.create());
 return {privateKey,csr:forge.pki.certificationRequestToPem(request)};
}

// AndroidでもmacOS/iOS/Windowsでも読み込めるよう、鍵は3DES、MACはSHA-1で作る（scripts/device-cert.mjs と同じ）。
export function createP12(key:DeviceKey,pem:string,password:string,name:string){
 const certificate=forge.pki.certificateFromPem(pem);
 const publicKey=certificate.publicKey as forge.pki.rsa.PublicKey;
 if(publicKey.n.compareTo(key.privateKey.n)!==0)throw new Error('証明書と秘密鍵が一致しません。');
 const p12=forge.pkcs12.toPkcs12Asn1(key.privateKey,[certificate],password,{algorithm:'3des',friendlyName:`Open Caravan ${name}`,generateLocalKeyId:true});
 return new Blob([new Uint8Array(forge.util.binary.raw.decode(forge.asn1.toDer(p12).getBytes()))],{type:'application/x-pkcs12'});
}

export function createPassword(){
 // 32文字（256の約数）にして偏りなく選ぶ。16文字で80ビット。
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
 return Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>alphabet[v%alphabet.length]).join('');
}

// 訪問ルートの計算。Google の鍵はここだけが持ち、住所は D1 から引く（ブラウザからは予定IDだけを受け取る）。
// Google へ送るのは住所と座標だけで、患者名は送らない。地図は静止画を data URI で返すので、CSP を広げずに済む。
import {z} from 'zod';
import type {Actor,Database,Env} from './types';
import {get} from './store';
import {takeAttempt} from './auth';
import {assert,ApiError} from '../src/lib/errors';
import {groupStops,stopLabel,type Visit} from '../src/lib/route';

export interface Settings {officeName:string;officeAddress:string;marginMinutes:number;version:number;}
export async function getSettings(db:Database):Promise<Settings>{
 const row=await db.prepare("SELECT data,version FROM settings WHERE id='office'").first<{data:string;version:number}>();
 return {officeName:'',officeAddress:'',marginMinutes:10,...(row?JSON.parse(row.data):{}),version:row?.version??0};
}
export const saveSettings=(db:Database,s:Omit<Settings,'version'>,version:number)=>db.prepare("INSERT INTO settings(id,data,version) VALUES('office',?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version").bind(JSON.stringify(s),version);

const schema=z.object({appointmentIds:z.array(z.string().max(100)).min(1,'予定がありません。').max(60,'一度に計算できるのは60件までです。'),avoidHighways:z.boolean()});
type LatLng={latitude:number;longitude:number};
interface RoutesResponse {routes?:{distanceMeters?:number;duration?:string;polyline?:{encodedPolyline?:string};legs?:{distanceMeters?:number;duration?:string;startLocation?:{latLng?:LatLng};endLocation?:{latLng?:LatLng}}[]}[];}
const point=(p?:LatLng)=>p?`${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`:'';

async function staticMap(key:string,polyline:string,office?:LatLng,stops:(LatLng|undefined)[]=[]){
 const q=new URLSearchParams({size:'640x400',scale:'2',format:'jpg',language:'ja',region:'jp',key});
 if(polyline)q.append('path',`color:0x1f6feb:cc|weight:5|enc:${polyline}`);
 if(office)q.append('markers',`color:0x15877f|label:S|${point(office)}`);
 stops.forEach((p,i)=>{if(p)q.append('markers',`color:red|label:${stopLabel(i)}|${point(p)}`);});
 try{
  const r=await fetch('https://maps.googleapis.com/maps/api/staticmap?'+q);
  if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))return null;
  const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>3000000)return null;
  let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return `data:${r.headers.get('content-type')};base64,${btoa(s)}`;
 }catch{return null;}
}

export async function routes(env:Env,actor:Actor,body:Record<string,unknown>){
 assert(env.GOOGLE_MAPS_API_KEY,503,'地図の設定が必要です（GOOGLE_MAPS_API_KEY）。');
 const {appointmentIds,avoidHighways}=schema.parse(body);assert(new Set(appointmentIds).size===appointmentIds.length,400,'同じ予定が含まれています。');
 const settings=await getSettings(env.DB);assert(settings.officeAddress,400,'スタッフ管理で事業所の住所を登録してください。');
 const visits:Visit[]=[],skipped:string[]=[];
 for(const id of appointmentIds){
  const a=await get(env.DB,id,'appointments');assert(a&&!a.cancelled,404,'予定が見つかりません。再読込してください。');
  const p=a.patientId?await get(env.DB,String(a.patientId),'patients'):null,f=p?.facilityId?await get(env.DB,String(p.facilityId),'facilities'):null;
  const address=String(p?.address||f?.address||'').trim();if(address)visits.push({id,address,start:0,end:0});else skipped.push(id);
 }
 assert(visits.length,400,'住所のある訪問予定がありません。');
 const stops=groupStops(visits);assert(stops.length<=25,400,'1つのルートの訪問先は25か所までです。');
 await takeAttempt(env,'route:'+actor.id,120);
 const r=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':env.GOOGLE_MAPS_API_KEY,'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.startLocation,routes.legs.endLocation'},
  body:JSON.stringify({origin:{address:settings.officeAddress},destination:{address:settings.officeAddress},intermediates:stops.map(s=>({address:s.address})),travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE',routeModifiers:{avoidHighways},polylineQuality:'OVERVIEW',languageCode:'ja',regionCode:'jp',units:'METRIC'})});
 const data=await r.json().catch(()=>null) as RoutesResponse|null,route=data?.routes?.[0];
 if(!r.ok||!route?.legs||route.legs.length!==stops.length+1){console.error('routes_api_failed',r.status);throw new ApiError(502,'ルートの計算に失敗しました。住所が正しいか確認してください。');}
 const legs=route.legs.map(l=>({minutes:Math.round(parseFloat(l.duration??'0')/60),meters:l.distanceMeters??0}));
 const map=await staticMap(env.GOOGLE_MAPS_API_KEY,route.polyline?.encodedPolyline??'',route.legs[0].startLocation?.latLng,route.legs.slice(0,-1).map(l=>l.endLocation?.latLng));
 return {stops:stops.map(s=>({ids:s.visits.map(v=>v.id),address:s.address})),legs,skipped,map};
}

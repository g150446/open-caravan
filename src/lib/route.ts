// 訪問ルートの計算（地図サービスに頼らない部分）。時刻は0時からの分で扱う。
import {timeKey} from './date';

export interface Visit {id:string;address:string;start:number;end:number;}
export interface Stop {address:string;visits:Visit[];}
export interface Leg {minutes:number;meters:number;}
export type HalfMode='day'|'both'|'am'|'pm';

export const toMinutes=(iso:string)=>{const t=timeKey(iso);return Number(t.slice(0,2))*60+Number(t.slice(3));};
export const clock=(m:number)=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const sameAddress=(a:string,b:string)=>a.replace(/\s/g,'')===b.replace(/\s/g,'');

// 続けて同じ住所（同じ施設など）を訪ねる予定は、1か所の訪問先にまとめる。
export function groupStops(visits:Visit[]):Stop[]{
 const stops:Stop[]=[];
 for(const v of visits){const last=stops.at(-1);if(last&&sameAddress(last.address,v.address))last.visits.push(v);else stops.push({address:v.address,visits:[v]});}
 return stops;
}

// 午前・午後は開始時刻が正午より前かどうかで分ける。午前/午後 のときは昼に事業所へ戻る2本のルートになる。
export function splitHalf(visits:Visit[],mode:HalfMode):Visit[][]{
 const sorted=[...visits].sort((a,b)=>a.start-b.start),am=sorted.filter(v=>v.start<720),pm=sorted.filter(v=>v.start>=720);
 return (mode==='day'?[sorted]:mode==='am'?[am]:mode==='pm'?[pm]:[am,pm]).filter(x=>x.length);
}

const stopStart=(s:Stop)=>Math.min(...s.visits.map(v=>v.start)),stopEnd=(s:Stop)=>Math.max(...s.visits.map(v=>v.end));

// legs は 事業所→1か所目, …, 最後→事業所 の stops.length+1 区間。
export function timeline(stops:Stop[],legs:Leg[]){
 const short=legs.map((leg,i)=>i>0&&i<stops.length&&stopEnd(stops[i-1])+leg.minutes>stopStart(stops[i]));
 return {departure:stopStart(stops[0])-legs[0].minutes,arrival:stopEnd(stops.at(-1)!)+legs[stops.length].minutes,short,totalMinutes:legs.reduce((n,l)=>n+l.minutes,0),totalMeters:legs.reduce((n,l)=>n+l.meters,0)};
}

// 出発時刻から順に、移動時間（2か所目からは余白も足す）の後に5分単位で予定を置き直す。長さは元のまま。
// 同じ訪問先の予定は続けて並べ、自動調整の対象外にした予定は動かさない。
export function autoAdjust(stops:Stop[],legs:Leg[],departure:number,margin:number,fixed:Set<string>){
 const result=new Map<string,{start:number;end:number}>();let cursor=departure;
 stops.forEach((stop,i)=>{
  cursor+=legs[i].minutes+(i>0?margin:0);
  for(const v of stop.visits){
   if(fixed.has(v.id)){result.set(v.id,{start:v.start,end:v.end});cursor=v.end;continue;}
   const start=Math.ceil(cursor/5)*5;result.set(v.id,{start,end:start+v.end-v.start});cursor=start+v.end-v.start;
  }
 });
 return result;
}

// 地図のピンと画面の番号をそろえる（静止画のラベルは1文字なので、10か所目からは A, B, …）。
export const stopLabel=(i:number)=>i<9?String(i+1):String.fromCharCode(65+i-9);
// Google マップの経路URL（鍵は不要。利用者が押したときだけ開く）。経由地は Google の上限に合わせて9か所まで。
export const navUrl=(from:string,to:string,waypoints:string[]=[])=>'https://www.google.com/maps/dir/?'+new URLSearchParams({api:'1',origin:from,destination:to,...(waypoints.length?{waypoints:waypoints.join('|')}:{}),travelmode:'driving'});
export const formatKm=(meters:number)=>(meters/1000).toFixed(1)+'km';

// ここから下は Google を使わない見積もり用。位置は {lat,lng}（度）。
export interface Point {lat:number;lng:number;}
// 「43.0597, 141.7790」（Google マップで右クリックしてコピーした形）を読む。日本の範囲だけ受け付ける。
export function parseLocation(text:string):Point|null{
 const m=text.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,，、]\s*(-?\d{1,3}(?:\.\d+)?)$/);if(!m)return null;
 const lat=Number(m[1]),lng=Number(m[2]);return lat>=20&&lat<=46&&lng>=122&&lng<=154?{lat,lng}:null;
}
export function distanceMeters(a:Point,b:Point){
 const r=Math.PI/180,dLat=(b.lat-a.lat)*r,dLng=(b.lng-a.lng)*r,h=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;
 return 2*6371000*Math.asin(Math.sqrt(h));
}
// 道のりは直線距離の detourFactor 倍、速さは speedKmh で見積もる。分は切り上げ。
export function estimateLeg(a:Point,b:Point,{detourFactor,speedKmh}:{detourFactor:number;speedKmh:number}):Leg{
 const meters=Math.round(distanceMeters(a,b)*detourFactor);return {meters,minutes:Math.ceil(meters/1000/speedKmh*60)};
}
// 事業所から出て事業所へ戻る一周が短くなる順（最近傍法のあと 2-opt）。戻り値は points の添字の並び。
export function nearestOrder(office:Point,points:Point[]):number[]{
 const order:number[]=[],left=new Set(points.map((_,i)=>i));let at=office;
 while(left.size){let best=-1;for(const i of left)if(best<0||distanceMeters(at,points[i])<distanceMeters(at,points[best]))best=i;order.push(best);left.delete(best);at=points[best];}
 const p=(k:number)=>k<0||k>=order.length?office:points[order[k]];
 for(let improved=true;improved;){improved=false;
  for(let i=0;i<order.length-1;i++)for(let j=i+1;j<order.length;j++){
   const before=distanceMeters(p(i-1),p(i))+distanceMeters(p(j),p(j+1)),after=distanceMeters(p(i-1),p(j))+distanceMeters(p(i),p(j+1));
   if(after<before-1e-6){order.splice(i,j-i+1,...order.slice(i,j+1).reverse());improved=true;}
  }}
 return order;
}

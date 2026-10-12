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
export const navUrl=(from:string,to:string)=>'https://www.google.com/maps/dir/?'+new URLSearchParams({api:'1',origin:from,destination:to,travelmode:'driving'});
export const formatKm=(meters:number)=>(meters/1000).toFixed(1)+'km';

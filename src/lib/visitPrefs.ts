// 診察希望日・NG（曜日＋午前／午後）。患者と施設の両方に登録でき、NG は両方を合わせ、希望は患者の登録を優先する。
import type {DayPart,Facility,Patient,VisitPrefs,VisitSlot} from '../models';
import {jstDate,timeKey} from './date';

export const emptyPrefs:VisitPrefs={preferred:[],ng:[],note:''};
export const dayParts:[DayPart,string][]=[['am','午前'],['pm','午後']];
// 表示の並びは月曜始まり（ミニカレンダーと同じ）。
export const weekOrder=[1,2,3,4,5,6,0];
const dayNames='日月火水木金土';
const same=(a:VisitSlot,b:VisitSlot)=>a.weekday===b.weekday&&a.part===b.part;
const sorted=(xs:VisitSlot[])=>[...xs].sort((a,b)=>weekOrder.indexOf(a.weekday)-weekOrder.indexOf(b.weekday)||a.part.localeCompare(b.part));

export function slotState(p:VisitPrefs|undefined,weekday:number,part:DayPart):'preferred'|'ng'|''{
 const s={weekday,part};return p?.preferred.some(x=>same(x,s))?'preferred':p?.ng.some(x=>same(x,s))?'ng':'';
}
// 押すたびに 未設定 → 希望 → NG → 未設定 と切り替える。
export function cycleSlot(p:VisitPrefs|undefined,weekday:number,part:DayPart):VisitPrefs{
 const base=p??emptyPrefs,s={weekday,part},state=slotState(base,weekday,part);
 const preferred=base.preferred.filter(x=>!same(x,s)),ng=base.ng.filter(x=>!same(x,s));
 return {...base,preferred:sorted(state===''?[...preferred,s]:preferred),ng:sorted(state==='preferred'?[...ng,s]:ng)};
}
export const hasPrefs=(p?:VisitPrefs)=>!!p&&(p.preferred.length>0||p.ng.length>0||!!p.note);

// 患者と施設の設定を合わせる。NG はどちらかにあれば NG、希望は患者に1つでもあれば患者、なければ施設のもの。
export function effectivePrefs(patient?:Pick<Patient,'visitPrefs'>|null,facility?:Pick<Facility,'visitPrefs'>|null):VisitPrefs{
 const pp=patient?.visitPrefs,fp=facility?.visitPrefs;
 const ng=sorted([...(fp?.ng??[]),...(pp?.ng??[])].filter((x,i,xs)=>xs.findIndex(y=>same(x,y))===i));
 const preferred=sorted((pp?.preferred.length?pp.preferred:fp?.preferred??[]).filter(x=>!ng.some(y=>same(x,y))));
 const note=[fp?.note?'施設: '+fp.note:'',pp?.note?(fp?.note?'患者: ':'')+pp.note:''].filter(Boolean).join('／');
 return {preferred,ng,note};
}

// 「月・木 午前、水 終日」のように曜日ごとにまとめる。午前と午後の両方なら「終日」。
function slotsLabel(xs:VisitSlot[]){
 const byDay=weekOrder.map(d=>{const parts=xs.filter(x=>x.weekday===d).map(x=>x.part);return {d,part:parts.length===2?'終日':parts[0]==='am'?'午前':parts[0]==='pm'?'午後':''};}).filter(x=>x.part);
 const groups:{part:string;days:number[]}[]=[];
 for(const x of byDay){const g=groups.find(g=>g.part===x.part);if(g)g.days.push(x.d);else groups.push({part:x.part,days:[x.d]});}
 return groups.map(g=>g.days.map(d=>dayNames[d]).join('・')+' '+g.part).join('、');
}
export function prefsSummary(p?:VisitPrefs){
 if(!p)return '';return [p.preferred.length?'希望: '+slotsLabel(p.preferred):'',p.ng.length?'NG: '+slotsLabel(p.ng):''].filter(Boolean).join('／');
}
// 予定の開始日時が日本時間で何曜日の午前／午後か（12:00 より前が午前。出力・複製と同じ境目）。
export function slotOf(startsAt:string):VisitSlot{
 const d=new Date(new Date(startsAt).getTime()+9*3600000);return {weekday:d.getUTCDay(),part:timeKey(startsAt)<'12:00'?'am':'pm'};
}
export const slotOfForm=(date:string,time:string)=>slotOf(jstDate(date,time).toISOString());
export const slotLabel=(s:VisitSlot)=>`${dayNames[s.weekday]}曜${s.part==='am'?'午前':'午後'}`;

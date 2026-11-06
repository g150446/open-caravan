// 「出力（日別）」: その日の予定を担当スタッフごとにまとめ、印刷用のページ（PDF 保存も可）か Excel で開ける CSV にする。
// クロスログの「日別全体」出力にならい、表示する項目と「1日／午前午後で分割」を選べる。
import type {Appointment,Masters} from '../models';
import {timeKey} from './date';
import {encodeCsv} from './csv';
import {markLabel} from './visitMark';

export type ExportColumn='time'|'mark'|'number'|'kana'|'facility'|'address'|'frequency'|'memo'|'handover';
export const exportColumns:{key:ExportColumn;label:string;checked:boolean}[]=[
 {key:'time',label:'時間',checked:true},{key:'mark',label:'マーク',checked:true},{key:'number',label:'患者番号',checked:true},{key:'kana',label:'ふりがな',checked:false},
 {key:'facility',label:'居宅・施設',checked:true},{key:'address',label:'住所',checked:false},{key:'frequency',label:'訪問回数',checked:false},
 {key:'memo',label:'予定メモ',checked:true},{key:'handover',label:'申し送り',checked:false}];
export interface ExportOptions {columns:ExportColumn[];split:boolean;}
export interface ExportSection {staff:string;part:''|'午前'|'午後';items:Appointment[];}

const weekdays='日月火水木金土';
export const exportDayLabel=(day:string)=>{const d=new Date(day+'T00:00:00Z');return `${d.getUTCFullYear()}年${d.getUTCMonth()+1}月${d.getUTCDate()}日(${weekdays[d.getUTCDay()]})`;};
// 午前は 12:00 より前に始まる予定。複製の「午前のみ／午後のみ」も同じ境目を使う。
export const isMorning=(a:Appointment)=>timeKey(a.startsAt)<'12:00';
const staffLabel=(ids:string[],m:Masters)=>{const name=(id:string)=>m.staff.find(s=>s.id===id)?.name??'未登録';return name(ids[0])+(ids.length>1?'（同行: '+ids.slice(1).map(name).join('・')+'）':'');};
const laneKey=(ids:string[])=>[ids[0],...ids.slice(1).sort()].join('|');

// 担当（同行を含む組み合わせ）ごと、分割するときはさらに午前・午後ごとに、開始時刻順で並べる。
export function exportSections(items:Appointment[],m:Masters,split:boolean):ExportSection[]{
 const lanes=new Map<string,Appointment[]>();
 for(const a of [...items].sort((x,y)=>x.startsAt.localeCompare(y.startsAt)))lanes.set(laneKey(a.staffIds),[...(lanes.get(laneKey(a.staffIds))??[]),a]);
 const sections:ExportSection[]=[];
 for(const values of lanes.values()){const staff=staffLabel(values[0].staffIds,m);
  if(!split){sections.push({staff,part:'',items:values});continue;}
  const am=values.filter(isMorning),pm=values.filter(a=>!isMorning(a));
  if(am.length)sections.push({staff,part:'午前',items:am});if(pm.length)sections.push({staff,part:'午後',items:pm});}
 // 分割するときは午前の表をすべて先に、午後をあとにまとめる（午前・午後で別の紙に分けて配れるように）。
 return split?[...sections.filter(s=>s.part==='午前'),...sections.filter(s=>s.part==='午後')]:sections;
}

function cell(a:Appointment,key:ExportColumn,m:Masters):string{
 const p=m.patients.find(x=>x.id===a.patientId),f=m.facilities.find(x=>x.id===p?.facilityId);
 switch(key){
  case 'time':return `${timeKey(a.startsAt)}〜${timeKey(a.endsAt)}`;
  case 'mark':return a.mark?`${a.mark}（${markLabel[a.mark]}）`:'';
  case 'number':return p?.number??'';
  case 'kana':return p?.kana??'';
  case 'facility':return p?(f?.name??'居宅'):'';
  case 'address':return p?(p.address||f?.address||''):'';
  case 'frequency':return p?.visitFrequency??'';
  case 'memo':return a.memo??'';
  case 'handover':return p?.handover??'';
 }
}
const label=(key:ExportColumn)=>exportColumns.find(c=>c.key===key)!.label;
const nameOf=(a:Appointment,m:Masters)=>m.patients.find(x=>x.id===a.patientId)?.name??a.title;
// 項目の並びは exportColumns の順に揃える（チェックを付けた順にならないように）。
const ordered=(columns:ExportColumn[])=>exportColumns.map(c=>c.key).filter(k=>columns.includes(k));

export function dayCsv(day:string,items:Appointment[],m:Masters,o:ExportOptions){
 const cols=ordered(o.columns);
 const rows=[['日付',...(o.split?['区分']:[]),'担当スタッフ','患者名・予定名',...cols.map(label)]];
 for(const s of exportSections(items,m,o.split))for(const a of s.items)rows.push([day,...(o.split?[s.part]:[]),s.staff,nameOf(a,m),...cols.map(k=>cell(a,k,m))]);
 return encodeCsv(rows);
}

const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
// A4 に印刷する前提の独立した HTML。スクリプトは入れず、印刷は呼び出し側から window.print() する。
export function dayPrintHtml(day:string,items:Appointment[],m:Masters,o:ExportOptions,office=''){
 const cols=ordered(o.columns),title=`${exportDayLabel(day)} 訪問予定`;
 const sections=exportSections(items,m,o.split);
 const body=sections.map((s,i)=>`<section${o.split&&i>0&&s.part!==sections[i-1].part?' class="break"':''}><h2>${esc(s.staff)}${s.part?` <span>${s.part}</span>`:''}<small>${s.items.length}件</small></h2><table><thead><tr><th class="no">#</th><th>患者名・予定名</th>${cols.map(k=>`<th class="c-${k}">${label(k)}</th>`).join('')}</tr></thead><tbody>${s.items.map((a,j)=>`<tr><td class="no">${j+1}</td><td class="name">${esc(nameOf(a,m))}</td>${cols.map(k=>`<td class="c-${k}">${esc(cell(a,k,m))}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`).join('');
 return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:-apple-system,'Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;color:#222;font-size:11px;margin:0;padding:16px}
header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #222;padding-bottom:6px;margin-bottom:12px}h1{font-size:18px;margin:0}header small{color:#555}
section{margin-bottom:14px;break-inside:auto}section.break{break-before:page}h2{font-size:13px;margin:0 0 5px;display:flex;gap:8px;align-items:baseline}h2 span{font-size:11px;border:1px solid #444;border-radius:3px;padding:0 5px}h2 small{margin-left:auto;font-weight:400;color:#555}
table{width:100%;border-collapse:collapse;table-layout:auto}th,td{border:1px solid #888;padding:4px 6px;vertical-align:top;text-align:left}th{background:#eee;font-weight:600;white-space:nowrap}tr{break-inside:avoid}
td.no,th.no{width:22px;text-align:center}td.name{font-weight:600;white-space:nowrap}td.c-time,td.c-number,td.c-mark{white-space:nowrap}td.c-memo,td.c-handover{white-space:pre-wrap;overflow-wrap:anywhere;min-width:160px}
.empty{color:#777;padding:20px 0}@media screen{body{max-width:900px;margin:auto}}
</style></head><body><header><h1>${esc(title)}</h1><small>${esc(office)}${office?' ・ ':''}${items.length}件</small></header>${body||'<p class="empty">予定がありません。</p>'}</body></html>`;
}
export const exportFileName=(day:string)=>`訪問予定_${day}.csv`;

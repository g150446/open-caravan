// 日付見出し・スタッフ列の⋮メニューから開く「予定をまとめて複製」と「出力（日別）」。どちらもクロスログの同名機能にならう。
import {useState} from 'react';
import type {Api,Appointment,Masters} from '../models';
import {addDays,timeKey} from '../lib/date';
import {dayCsv,dayPrintHtml,exportColumns,exportDayLabel,exportFileName,isMorning,type ExportColumn} from '../lib/dayExport';
import {Field} from './Forms';

type Part='all'|'am'|'pm';
const parts:[Part,string][]=[['all','全て'],['am','午前のみ'],['pm','午後のみ']];
const pick=(items:Appointment[],part:Part)=>part==='all'?items:items.filter(a=>part==='am'?isMorning(a):!isMorning(a));

export function CopyAppointments({day,title,items,masters,describe,revision,api,onDone,onClose}:{day:string;title:string;items:Appointment[];masters:Masters;describe:(a:Appointment)=>string;revision:number;api:Api;onDone:(date:string,copied:number,skipped:number)=>Promise<void>;onClose:()=>void}){
 const [date,DT]=useState(addDays(day,7)),[part,P]=useState<Part>('all'),[keep,K]=useState(true),[staffIds,S]=useState<string[]>(items[0]?.staffIds??[]),[copyMemo,CM]=useState(true),[busy,B]=useState(false),[error,E]=useState('');
 const targets=[...pick(items,part)].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)),active=masters.staff.filter(s=>s.active);
 const submit=async(e:React.FormEvent)=>{e.preventDefault();E('');
  if(date===day){E('複製元と別の日を選んでください。');return;}if(!keep&&!staffIds[0]){E('担当スタッフを選んでください。');return;}
  B(true);try{const r=await api('appointments/bulk-copy','POST',{items:targets.map(a=>({id:a.id,version:a.version})),date,staffIds:keep?null:staffIds,copyMemo,revision});await onDone(date,r.copied,r.skipped);onClose();}catch(e){E((e as Error).message);}finally{B(false);}};
 return <form onSubmit={submit}>{error&&<p className="error" role="alert">{error}</p>}
  <div className="copy-source"><strong>複製元の予定</strong><span>日付: {exportDayLabel(day)}</span><span>対象: {title}</span></div>
  <div className="copy-arrow" aria-hidden>▼</div>
  <Field label="複製先の日付"><input type="date" required value={date} onChange={e=>DT(e.target.value)}/></Field>
  <div className="field"><span>複製する予定</span><div className="segmented choice" role="group" aria-label="複製する予定の時間帯">{parts.map(([k,l])=><button type="button" key={k} className={part===k?'active':''} aria-pressed={part===k} onClick={()=>P(k)}>{l}</button>)}</div></div>
  <fieldset className="copy-staff"><legend>担当スタッフ</legend>
   <label className="check"><input type="radio" name="copy-staff" checked={keep} onChange={()=>K(true)}/>複製元と同じ担当のまま</label>
   <label className="check"><input type="radio" name="copy-staff" checked={!keep} onChange={()=>K(false)}/>担当を変更する（すべての予定をこの担当にする）</label>
   {!keep&&<><Field label="主担当"><select required value={staffIds[0]??''} onChange={e=>S([e.target.value,...staffIds.slice(1).filter(id=>id!==e.target.value)])}><option value="">選択してください</option>{active.map(s=><option key={s.id} value={s.id}>{s.name}（{s.profession}）</option>)}</select></Field>
   <div className="checks" aria-label="同行スタッフ">{active.filter(s=>s.id!==staffIds[0]).map(s=><label key={s.id}><input type="checkbox" checked={staffIds.slice(1).includes(s.id)} onChange={e=>S([staffIds[0]??'',...(e.target.checked?[...staffIds.slice(1),s.id]:staffIds.slice(1).filter(id=>id!==s.id))])}/><i style={{background:s.color}}/>{s.name}（同行）</label>)}</div></>}
  </fieldset>
  <label className="check"><input type="checkbox" checked={copyMemo} onChange={e=>CM(e.target.checked)}/>予定メモも複製する</label>
  <p className="confirm-text"><strong>{targets.length}件</strong> を <strong>{exportDayLabel(date)}</strong> に複製します。</p>
  <ul className="delete-list">{targets.map(a=><li key={a.id}>{describe(a)}</li>)}</ul>
  <p className="hint">同じ時刻の単発予定として作ります（繰り返しにはなりません）。複製先に同じ患者・同じ時刻の予定があるものは複製しません。初・往・注のマークは複製しません。</p>
  <p className="hint error-text">※複製した予定は元に戻せません。不要な分は個別か一括削除で消してください。</p>
  <div className="form-footer"><button type="button" onClick={onClose}>キャンセル</button><button className="primary" disabled={busy||!targets.length}>{busy?'複製中…':`${targets.length}件を複製する`}</button></div></form>;
}

export function ExportDay({day,title,items,masters,officeName,onClose}:{day:string;title:string;items:Appointment[];masters:Masters;officeName:string;onClose:()=>void}){
 const [columns,C]=useState<ExportColumn[]>(exportColumns.filter(c=>c.checked).map(c=>c.key)),[split,SP]=useState(false),[format,FM]=useState<'print'|'csv'>('print'),[error,E]=useState('');
 const submit=(e:React.FormEvent)=>{e.preventDefault();E('');const o={columns,split};
  if(format==='csv'){const url=URL.createObjectURL(new Blob([dayCsv(day,items,masters,o)],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=exportFileName(day);document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);onClose();return;}
  // 印刷用ページを別ウィンドウで開き、ブラウザの印刷画面を出す（「PDFに保存」も選べる）。
  const w=window.open('','_blank');if(!w){E('ポップアップがブロックされました。ブラウザでこのサイトのポップアップを許可してください。');return;}
  w.document.open();w.document.write(dayPrintHtml(day,items,masters,o,officeName));w.document.close();w.focus();setTimeout(()=>w.print(),300);onClose();};
 const first=items.length?[...items].sort((a,b)=>a.startsAt.localeCompare(b.startsAt))[0]:null;
 return <form onSubmit={submit}>{error&&<p className="error" role="alert">{error}</p>}
  <p className="confirm-text"><strong>{exportDayLabel(day)}</strong>・{title} の予定 <strong>{items.length}件</strong> を出力します。{first&&<small>（{timeKey(first.startsAt)} から）</small>}</p>
  <fieldset><legend>表示する項目</legend><div className="checks">{exportColumns.map(c=><label key={c.key}><input type="checkbox" checked={columns.includes(c.key)} onChange={e=>C(e.target.checked?[...columns,c.key]:columns.filter(k=>k!==c.key))}/>{c.label}</label>)}</div><p className="hint">患者名と担当スタッフは常に出力します。</p></fieldset>
  <div className="field"><span>シートの出力形式</span><div className="segmented choice" role="group" aria-label="シートの出力形式">{([[false,'1日'],[true,'午前午後で分割']] as const).map(([k,l])=><button type="button" key={l} className={split===k?'active':''} aria-pressed={split===k} onClick={()=>SP(k)}>{l}</button>)}</div></div>
  <div className="field"><span>ファイル形式</span><div className="segmented choice" role="group" aria-label="ファイル形式">{([['print','印刷・PDF'],['csv','Excel（CSV）']] as const).map(([k,l])=><button type="button" key={k} className={format===k?'active':''} aria-pressed={format===k} onClick={()=>FM(k)}>{l}</button>)}</div></div>
  <p className="hint">{format==='print'?'印刷用のページを別のタブで開きます。印刷画面の送信先で「PDFに保存」を選ぶと PDF になります。':'Excel でそのまま開ける CSV ファイルをダウンロードします。'}</p>
  <div className="form-footer"><button type="button" onClick={onClose}>閉じる</button><button className="primary" disabled={!items.length}>{format==='print'?'印刷用ページを開く':'ダウンロードする'}</button></div></form>;
}

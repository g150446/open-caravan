import {useCallback,useEffect,useState} from 'react';
import type {Api,Masters,Settings,Staff} from '../models';
import {dateKey,nextMonth} from '../lib/date';
import {formatMinutes,legalTotal,monthDays,scheduledMinutes,shiftLabels,workSystemLabels,type Shift,type ShiftKind,type ShiftPattern} from '../lib/attendance';
import {Dialog,Field} from './Forms';
const today=()=>dateKey(new Date());
const weekday=(day:string)=>new Date(day+'T00:00:00Z').getUTCDay();
const shortLabels:Record<ShiftKind,string>={WORK:'勤',OFF:'休',LEGAL_OFF:'法休',PAID_LEAVE:'有'};
const cellText=(s?:Shift|null)=>!s?'':s.kind==='WORK'?s.pattern||s.start!.slice(0,5):shortLabels[s.kind];
type Brush={kind:ShiftKind;pattern:string|null;start:string|null;end:string|null;breakMinutes:number}|'clear'|'custom';
// 勤務予定表。行がスタッフ、列が日。管理者はパレットで選んだ勤務をセルに入れ、まとめて保存する。
export function ShiftsView({user,masters,settings,api}:{user:Staff;masters:Masters;settings:Settings;api:Api}){
 const admin=user.role==='ADMIN',[month,M]=useState(today().slice(0,7)),[shifts,S]=useState<Shift[]>([]),[confirmed,C]=useState<{at:string;by:string}|null>(null),[draft,DR]=useState<Record<string,Shift|null>>({}),[brush,BR]=useState<Brush>('custom'),[custom,CU]=useState<{staffId:string;day:string}|null>(null),[busy,B]=useState(false),[error,E]=useState(''),[notice,N]=useState('');
 const load=useCallback(()=>api('shifts?month='+month).then(d=>{S(d.shifts);C(d.confirmed);DR({});E('');}).catch(e=>E(e.message)),[api,month]);
 useEffect(()=>{void load();},[load]);
 const days=monthDays(month),staff=masters.staff.filter(s=>s.active&&!s.deleted),key=(staffId:string,day:string)=>staffId+'|'+day;
 const saved=(staffId:string,day:string)=>shifts.find(s=>s.staffId===staffId&&s.day===day)??null;
 const current=(staffId:string,day:string)=>{const k=key(staffId,day);return k in draft?draft[k]:saved(staffId,day);};
 const changes=Object.keys(draft).length;
 function apply(staffId:string,day:string){
  if(!admin)return;if(brush==='custom'){CU({staffId,day});return;}
  const old=saved(staffId,day),next:Shift|null=brush==='clear'?null:{staffId,day,...brush,note:'',version:old?.version??0};
  const k=key(staffId,day),same=JSON.stringify(next&&{...next,version:0})===JSON.stringify(old&&{...old,note:'',version:0});
  const {[k]:_,...rest}=draft;DR(same?rest:{...rest,[k]:next});
 }
 async function save(){B(true);E('');try{const items=Object.values(draft).filter((s):s is Shift=>!!s).map(s=>({...s,version:saved(s.staffId,s.day)?.version??0}));const remove=Object.entries(draft).filter(([,s])=>!s).map(([k])=>{const [staffId,day]=k.split('|');return {staffId,day,version:saved(staffId,day)?.version};}).filter(r=>r.version);if(!items.length&&!remove.length){DR({});return;}await api('shifts','POST',{month,items,remove});await load();N('保存しました');setTimeout(()=>N(''),3500);}catch(e){E((e as Error).message);}finally{B(false);}}
 async function confirm(){if(!window.confirm(`${month.replace('-','年')}月の勤務予定表を確定しますか？確定した後の変更は変更履歴に残ります。`))return;B(true);E('');try{await api('shifts/confirm','POST',{month});await load();}catch(e){E((e as Error).message);}finally{B(false);}}
 const brushes:{label:string;value:Brush;title:string}[]=[...settings.shiftPatterns.map(p=>({label:p.code,value:{kind:'WORK' as const,pattern:p.code,start:p.start,end:p.end,breakMinutes:p.breakMinutes},title:`${p.label} ${p.start}–${p.end} 休憩${p.breakMinutes}分`})),...(['OFF','LEGAL_OFF','PAID_LEAVE'] as const).map(k=>({label:shortLabels[k],value:{kind:k,pattern:null,start:null,end:null,breakMinutes:0},title:shiftLabels[k]})),{label:'時刻を指定',value:'custom',title:'セルを押して時刻を入れる'},{label:'消す',value:'clear',title:'予定を消す'}];
 return <div className="shifts">
  <div className="attendance-toolbar"><div className="date-controls"><button aria-label="前の月" disabled={!!changes} onClick={()=>M(nextMonth(month+'-01',-1).slice(0,7))}>‹</button><strong>{month.slice(0,4)}年{Number(month.slice(5))}月</strong><button aria-label="次の月" disabled={!!changes} onClick={()=>M(nextMonth(month+'-01').slice(0,7))}>›</button></div>
   <span className={'status '+(confirmed?'':'inactive')}>{confirmed?`確定済み（${new Date(confirmed.at).toLocaleString('ja-JP')}）`:'未確定'}</span>
   {admin&&<><button className="primary" disabled={busy||!changes} onClick={save}>{busy?'保存中…':`変更を保存する${changes?`（${changes}件）`:''}`}</button>{changes>0&&<button disabled={busy} onClick={()=>DR({})}>変更を取り消す</button>}{!confirmed&&<button disabled={busy||!!changes} onClick={confirm}>この月を確定する</button>}<button onClick={()=>print()}>⎙ 印刷</button></>}</div>
  {admin&&<div className="shift-palette" role="radiogroup" aria-label="入れる勤務">{brushes.map(b=><button key={b.label} role="radio" aria-checked={JSON.stringify(brush)===JSON.stringify(b.value)} title={b.title} className={JSON.stringify(brush)===JSON.stringify(b.value)?'active':''} onClick={()=>BR(b.value)}>{b.label}</button>)}<span className="hint">勤務を選んでからセルを押します。勤務パターンは基本設定で変えられます。</span></div>}
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<div className="toast" role="status">✓ {notice}</div>}
  <div className="table-wrap shift-table"><table><thead><tr><th className="sticky">スタッフ</th>{days.map(d=><th key={d} className={[weekday(d)===0?'sunday':weekday(d)===6?'saturday':'',d===today()?'is-today':''].join(' ')}>{Number(d.slice(8))}<small>{'日月火水木金土'[weekday(d)]}</small></th>)}<th>予定時間</th></tr></thead>
   <tbody>{staff.map(s=>{const total=days.reduce((n,d)=>n+scheduledMinutes(current(s.id,d)),0),limit=legalTotal(days.length),over=s.workSystem==='monthly_variable'&&total>limit;return <tr key={s.id}><th className="sticky"><i className="color-dot" style={{background:s.color}}/>{s.name}<small>{s.workSystem==='monthly_variable'?'変形制':''}</small></th>{days.map(d=>{const v=current(s.id,d),k=key(s.id,d);return <td key={d} className={['shift-cell',v?'kind-'+v.kind:'',k in draft?'changed':'',d===today()?'is-today':''].join(' ')}>{admin?<button aria-label={`${s.name} ${d}`} title={v?.kind==='WORK'?`${v.start}–${v.end} 休憩${v.breakMinutes}分`:v?shiftLabels[v.kind]:''} onClick={()=>apply(s.id,d)}>{cellText(v)}</button>:<span title={v?.kind==='WORK'?`${v.start}–${v.end}`:''}>{cellText(v)}</span>}</td>;})}<td className={over?'error-text':''}>{formatMinutes(total)||'0:00'}{over&&<small>総枠 {formatMinutes(limit)} 超</small>}</td></tr>;})}</tbody></table></div>
  <p className="hint">略号: {settings.shiftPatterns.map(p=>`${p.code}=${p.label}（${p.start}–${p.end}・休憩${p.breakMinutes}分）`).join('、')}、休=休日、法休=法定休日、有=年次有給休暇。1か月単位の変形労働時間制のスタッフは、月が始まる前に確定してください（{workSystemLabels.monthly_variable}では、確定した勤務予定表が時間外の基準になります）。</p>
  {custom&&<Dialog title="勤務の時刻" onClose={()=>CU(null)}><CustomShift initial={current(custom.staffId,custom.day)} label={`${masters.staff.find(s=>s.id===custom.staffId)?.name} ${custom.day}`} onClose={()=>CU(null)} onDone={v=>{const old=saved(custom.staffId,custom.day);DR({...draft,[key(custom.staffId,custom.day)]:{staffId:custom.staffId,day:custom.day,kind:'WORK',pattern:null,...v,note:'',version:old?.version??0}});CU(null);}}/></Dialog>}
 </div>;
}
function CustomShift({initial,label,onClose,onDone}:{initial:Shift|null;label:string;onClose:()=>void;onDone:(v:{start:string;end:string;breakMinutes:number})=>void}){
 const [v,V]=useState({start:initial?.start??'08:00',end:initial?.end??'17:00',breakMinutes:initial?.breakMinutes??60});
 return <form onSubmit={e=>{e.preventDefault();onDone(v);}}><p>{label}</p><div className="form-grid"><Field label="開始"><input type="time" required value={v.start} onChange={e=>V({...v,start:e.target.value})}/></Field><Field label="終了（開始より前なら翌日）"><input type="time" required value={v.end} onChange={e=>V({...v,end:e.target.value})}/></Field><Field label="休憩（分）"><input type="number" min={0} max={600} value={v.breakMinutes} onChange={e=>V({...v,breakMinutes:Number(e.target.value)})}/></Field></div><p className="hint">予定の労働時間: {formatMinutes(scheduledMinutes({kind:'WORK',...v}))||'0:00'}</p><div className="form-footer"><button type="button" onClick={onClose}>キャンセル</button><button className="primary" disabled={v.start===v.end}>セルに入れる</button></div></form>;
}
// 基本設定の「勤怠」。勤務パターン（勤務予定表のパレット）、法定休日の曜日、週の起算曜日。
export function AttendanceSettings({settings,api,revision,onSaved}:{settings:Settings;api:Api;revision:number;onSaved:()=>Promise<void>}){
 const [v,V]=useState(settings),[busy,B]=useState(false),[error,E]=useState('');
 useEffect(()=>V(settings),[settings.version]);
 const patterns=v.shiftPatterns,setPattern=(i:number,p:Partial<ShiftPattern>)=>V({...v,shiftPatterns:patterns.map((x,j)=>j===i?{...x,...p}:x)});
 const weekdays=[...'日月火水木金土'].map((d,i)=><option key={i} value={i}>{d}曜日</option>);
 return <form className="office-settings" onSubmit={async e=>{e.preventDefault();B(true);E('');try{await api('settings','PATCH',{shiftPatterns:patterns,legalHolidayWeekday:Number(v.legalHolidayWeekday),autoBreakMinutes:Number(v.autoBreakMinutes),weekStartWeekday:Number(v.weekStartWeekday),version:settings.version,revision});await onSaved();}catch(e){E((e as Error).message);}finally{B(false);}}}>
  <div className="section-title"><h3>勤怠（勤務パターン・休日）</h3><span className={'status '+(settings.slack?.configured?'':'inactive')}>{settings.slack?.configured?`Slack 連携中${settings.slack.polledAt?`（最終確認 ${new Date(settings.slack.polledAt).toLocaleTimeString('ja-JP')}）`:'（まだ確認していません）'}`:'Slack 連携なし'}</span></div>{error&&<p className="error" role="alert">{error}</p>}
  <div className="pattern-list">{patterns.map((p,i)=><div className="pattern-row" key={i}><Field label="略号"><input required maxLength={3} value={p.code} onChange={e=>setPattern(i,{code:e.target.value})}/></Field><Field label="名前"><input required maxLength={20} value={p.label} onChange={e=>setPattern(i,{label:e.target.value})}/></Field><Field label="開始"><input type="time" required value={p.start} onChange={e=>setPattern(i,{start:e.target.value})}/></Field><Field label="終了"><input type="time" required value={p.end} onChange={e=>setPattern(i,{end:e.target.value})}/></Field><Field label="休憩（分）"><input type="number" min={0} max={600} value={p.breakMinutes} onChange={e=>setPattern(i,{breakMinutes:Number(e.target.value)})}/></Field><button type="button" className="danger" onClick={()=>V({...v,shiftPatterns:patterns.filter((_,j)=>j!==i)})}>削除</button></div>)}<button type="button" disabled={patterns.length>=20} onClick={()=>V({...v,shiftPatterns:[...patterns,{code:'',label:'',start:'08:00',end:'17:00',breakMinutes:60}]})}>＋ 勤務パターンを追加</button></div>
  <div className="office-grid"><Field label="法定休日（勤務予定がない日）"><select value={v.legalHolidayWeekday} onChange={e=>V({...v,legalHolidayWeekday:Number(e.target.value)})}>{weekdays}</select></Field><Field label="休憩の打刻がない日の休憩（分）"><input type="number" min={0} max={120} value={v.autoBreakMinutes} onChange={e=>V({...v,autoBreakMinutes:Number(e.target.value)})}/></Field><Field label="週の起算曜日"><select value={v.weekStartWeekday} onChange={e=>V({...v,weekStartWeekday:Number(e.target.value)})}>{weekdays}</select></Field><button className="primary" disabled={busy}>{busy?'保存中…':'保存する'}</button></div>
  <p className="hint">就業規則に合わせて設定してください。週40時間の計算は起算曜日から7日ごとに行います（定めがなければ日曜日）。勤務予定表で「法定休日」にした日は、曜日に関係なく法定休日として計算します。休憩の打刻がない平日の勤務（6時間超）は、勤務予定の休憩か、ここで決めた分（0で無効）を取ったものとして差し引きます。就業規則に休憩時間を定め、取れなかった日は本人が勤怠画面で申告してください。</p>
 </form>;
}
// 基本設定の「Slack の過去の投稿」。連携を始める前の #出勤退勤 の投稿を、指定した日から取り込む。Slack には何も返さない。
export function SlackImport({api}:{api:Api}){
 const [from,F]=useState(()=>dateKey(new Date(Date.now()-30*86400000))),[busy,B]=useState(false),[error,E]=useState(''),[result,R]=useState<{punched:number;rejected:number;done:boolean}|null>(null);
 async function run(){
  if(!window.confirm(`${from} 以降の #出勤退勤 の投稿を、打刻として取り込みますか？取り込んだ打刻は消せません（修正は取り消しとして残ります）。`))return;
  B(true);E('');let total={punched:0,rejected:0,done:false},after:string|null=null;R(total);
  try{for(let i=0;i<200&&!total.done;i++){const r:{done:boolean;after:string|null;punched:number;rejected:number}=await api('slack/backfill','POST',{from,...(after?{after}:{})});total={punched:total.punched+r.punched,rejected:total.rejected+r.rejected,done:r.done};after=r.after;R(total);}}
  catch(e){E((e as Error).message);}finally{B(false);}
 }
 return <section className="office-settings"><div className="section-title"><h3>Slack の過去の投稿を取り込む</h3></div>
  <div className="office-grid"><Field label="この日から"><input type="date" value={from} max={dateKey(new Date())} onChange={e=>F(e.target.value)}/></Field><button className="primary" disabled={busy||!from} onClick={run}>{busy?'取り込み中…':'取り込む'}</button></div>
  {error&&<p className="error" role="alert">{error}</p>}{result&&<p className="notice-inline">{result.done?'取り込みました':'取り込み中'}：打刻 {result.punched}件、打刻にしなかった投稿 {result.rejected}件{result.rejected?'（勤怠画面の一覧で確認できます）':''}</p>}
  <p className="hint">連携を始める前の投稿を、投稿した時刻の打刻にします。Slack には ✅ も返信も付けません。すでに取り込んだ投稿は二重になりません。打刻にしなかった投稿は、管理者の勤怠画面に7日間表示されます。</p></section>;
}

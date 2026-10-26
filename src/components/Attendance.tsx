import {useCallback,useEffect,useState} from 'react';
import type {Api,Masters,Settings,Staff} from '../models';
import {addDays,dateKey,nextMonth,timeKey} from '../lib/date';
import {allowedNext,formatMinutes,monthRecord,punchLabels,punchTime,shiftLabels,workSystemLabels,type DayResult,type Punch,type PunchKind,type PunchRequest,type Shift} from '../lib/attendance';
import {Dialog,Field} from './Forms';
const today=()=>dateKey(new Date());
const weekday=(day:string)=>new Date(day+'T00:00:00Z').getUTCDay();
const dayLabel=(day:string)=>`${Number(day.slice(8))}日（${'日月火水木金土'[weekday(day)]}）`;
const monthLabel=(month:string)=>`${month.slice(0,4)}年${Number(month.slice(5))}月`;
const shiftText=(s:Shift|null)=>!s?'':s.kind==='WORK'?`${s.pattern?s.pattern+' ':''}${s.start}–${s.end}`:shiftLabels[s.kind];
const sourceLabels:Record<Punch['source'],string>={punch:'打刻',request:'申請（承認済み）',correction:'管理者の修正'};
interface MonthData {punches:Punch[];requests:PunchRequest[];shifts:Shift[];confirmed:{at:string;by:string}|null;pending:PunchRequest[];}
interface Status {workDate:string;punches:Punch[];next:PunchKind[];shift:Shift|null;serverTime:string;}
// 打刻。時刻はサーバーの時計で記録する（画面の時計は目安）。
function PunchPanel({api,onPunched}:{api:Api;onPunched:()=>void}){
 const [status,S]=useState<Status|null>(null),[busy,B]=useState(false),[error,E]=useState(''),[now,N]=useState(new Date());
 const load=useCallback(()=>api('attendance/status').then(S).catch(e=>E(e.message)),[api]);
 useEffect(()=>{void load();const t=setInterval(()=>N(new Date()),1000);return()=>clearInterval(t);},[load]);
 async function punch(kind:PunchKind){B(true);E('');try{S(await api('attendance/punch','POST',{kind}));onPunched();}catch(e){E((e as Error).message);await load();}finally{B(false);}}
 const state=!status?'':!status.punches.length?'未出勤':{IN:'勤務中',BREAK_END:'勤務中',BREAK_START:'休憩中',OUT:'退勤済み'}[status.punches.at(-1)!.kind];
 return <section className="punch-panel"><div><span className="eyebrow">TIME CLOCK</span><strong className="punch-clock">{timeKey(now)}<small>:{String(now.getSeconds()).padStart(2,'0')}</small></strong><p>{status&&<>{dayLabel(status.workDate)} の勤務 · <b>{state}</b>{status.shift&&<> · 予定 {shiftText(status.shift)}</>}</>}</p>{status&&status.punches.length>0&&<p className="punch-log">{status.punches.map(p=><span key={p.id}>{punchLabels[p.kind]} {punchTime(p.at,status.workDate)}</span>)}</p>}{error&&<p className="error" role="alert">{error}</p>}</div>
  <div className="punch-buttons">{(['IN','BREAK_START','BREAK_END','OUT'] as PunchKind[]).map(k=><button key={k} className={k==='IN'||k==='OUT'?'primary':''} disabled={busy||!status?.next.includes(k)} onClick={()=>punch(k)}>{punchLabels[k]}</button>)}</div></section>;
}
// 1日分の打刻の修正（管理者）か、修正の申請（本人）。取り消した打刻も残して表示する。
function DayDialog({row,staff,admin,requests,api,onClose,onDone}:{row:DayResult;staff:Staff;admin:boolean;requests:PunchRequest[];api:Api;onClose:()=>void;onDone:()=>void}){
 const [remove,R]=useState<string[]>([]),[add,A]=useState<{kind:PunchKind;date:string;time:string}[]>([]),[reason,RS]=useState(''),[busy,B]=useState(false),[error,E]=useState('');
 const next=allowedNext(row.punches).at(-1)??'IN',blank={kind:next,date:row.day,time:row.shift?.kind==='WORK'?(next==='OUT'?row.shift.end:row.shift.start)??'09:00':'09:00'};
 const [request,Q]=useState(blank);
 async function submit(){B(true);E('');try{if(admin)await api('attendance/corrections','POST',{staffId:staff.id,workDate:row.day,add,void:remove,reason});else await api('attendance/requests','POST',{workDate:row.day,...request,reason});onDone();}catch(e){E((e as Error).message);}finally{B(false);}}
 const entry=(v:typeof blank,set:(v:typeof blank)=>void,extra?:React.ReactNode)=><div className="punch-entry"><select aria-label="種類" value={v.kind} onChange={e=>set({...v,kind:e.target.value as PunchKind})}>{Object.entries(punchLabels).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select><select aria-label="日付" value={v.date} onChange={e=>set({...v,date:e.target.value})}><option value={row.day}>当日</option><option value={addDays(row.day,1)}>翌日</option></select><input aria-label="時刻" type="time" required value={v.time} onChange={e=>set({...v,time:e.target.value})}/>{extra}</div>;
 return <div className="day-dialog"><p><strong>{staff.name}</strong> · {row.day.replaceAll('-','/')}（{'日月火水木金土'[weekday(row.day)]}）{row.shift&&<> · 予定 {shiftText(row.shift)}</>}</p>
  <h3>打刻</h3>{!row.punches.length&&<p className="hint">打刻はありません。</p>}<ul className="punch-history">{row.punches.map(p=><li key={p.id} className={p.voidedAt?'voided':''}>{admin&&!p.voidedAt&&<input type="checkbox" aria-label="この打刻を取り消す" checked={remove.includes(p.id)} onChange={e=>R(e.target.checked?[...remove,p.id]:remove.filter(x=>x!==p.id))}/>}<span><b>{punchLabels[p.kind]}</b> {punchTime(p.at,row.day)}</span><small>{sourceLabels[p.source]}{p.device?` · 端末 ${p.device}`:''}{p.reason?` · 理由: ${p.reason}`:''}{p.voidedAt?` · 取消 ${new Date(p.voidedAt).toLocaleString('ja-JP')}（${p.voidReason}）`:''}</small></li>)}</ul>
  {requests.length>0&&<><h3>申請</h3><ul className="punch-history">{requests.map(r=><li key={r.id}><span><b>{punchLabels[r.kind]}</b> {punchTime(r.at,row.day)}</span><small>{{PENDING:'承認待ち',APPROVED:'承認済み',REJECTED:'却下'}[r.status]} · 理由: {r.reason}{r.decisionNote?` · ${r.decisionNote}`:''}</small></li>)}</ul></>}
  {admin?<><h3>打刻を追加</h3>{add.map((v,i)=><div key={i}>{entry(v,x=>A(add.map((y,j)=>j===i?x:y)),<button type="button" className="text-button" onClick={()=>A(add.filter((_,j)=>j!==i))}>外す</button>)}</div>)}<button type="button" onClick={()=>A([...add,blank])}>＋ 打刻を追加</button><p className="hint">チェックした打刻は取り消し済みとして残り、勤怠の計算から外れます。修正は変更履歴に残ります。</p></>:<><h3>修正の申請</h3>{entry(request,Q)}<p className="hint">打ち忘れなどを申請します。管理者が承認すると勤怠に入ります。</p></>}
  <Field label="理由（必須）"><input required maxLength={500} value={reason} placeholder={admin?'例: 本人の申告と訪問記録で確認':'例: 訪問先から直帰のため打刻を忘れた'} onChange={e=>RS(e.target.value)}/></Field>
  {error&&<p className="error" role="alert">{error}</p>}<div className="form-footer"><button type="button" onClick={onClose}>キャンセル</button><button className="primary" disabled={busy||!reason.trim()||(admin&&!add.length&&!remove.length)} onClick={submit}>{busy?'保存中…':admin?'修正を保存する':'申請する'}</button></div></div>;
}
export function AttendanceView({user,masters,settings,api}:{user:Staff;masters:Masters;settings:Settings;api:Api}){
 const admin=user.role==='ADMIN',[month,M]=useState(today().slice(0,7)),[staffId,SI]=useState(user.id),[data,D]=useState<MonthData|null>(null),[error,E]=useState(''),[open,O]=useState<DayResult|null>(null),[notes,NT]=useState<Record<string,string>>({});
 const staff=masters.staff.find(s=>s.id===staffId)??user;
 const load=useCallback(()=>api(`attendance?staffId=${encodeURIComponent(staffId)}&month=${month}`).then(d=>{D(d);E('');}).catch(e=>E(e.message)),[api,staffId,month]);
 useEffect(()=>{D(null);void load();},[load]);
 const system=staff.workSystem??'standard';
 const result=data&&monthRecord({month,system,confirmed:!!data.confirmed,weekStart:settings.weekStartWeekday,legalHolidayWeekday:settings.legalHolidayWeekday,today:today(),punches:data.punches,shifts:data.shifts});
 const name=(id:string)=>masters.staff.find(s=>s.id===id)?.name??id;
 async function decide(r:PunchRequest,approve:boolean){E('');try{await api('attendance/requests/'+r.id,'PATCH',{approve,note:notes[r.id]??''});await load();}catch(e){E((e as Error).message);}}
 return <div className="attendance">
  {staffId===user.id&&<PunchPanel api={api} onPunched={load}/>}
  {admin&&data&&data.pending.length>0&&<section className="pending-requests"><h3>承認待ちの申請（{data.pending.length}件）</h3><div className="table-wrap"><table><thead><tr><th>スタッフ</th><th>勤務日</th><th>打刻</th><th>理由</th><th>申請日時</th><th></th></tr></thead><tbody>{data.pending.map(r=><tr key={r.id}><td>{name(r.staffId)}</td><td>{r.workDate}</td><td>{punchLabels[r.kind]} {punchTime(r.at,r.workDate)}</td><td>{r.reason}</td><td>{new Date(r.createdAt).toLocaleString('ja-JP')}</td><td className="row-actions"><input aria-label="コメント" placeholder="コメント（却下は必須）" value={notes[r.id]??''} onChange={e=>NT({...notes,[r.id]:e.target.value})}/><button onClick={()=>decide(r,true)}>承認</button><button className="danger" disabled={!notes[r.id]?.trim()} onClick={()=>decide(r,false)}>却下</button></td></tr>)}</tbody></table></div></section>}
  <div className="attendance-toolbar"><div className="date-controls"><button aria-label="前の月" onClick={()=>M(nextMonth(month+'-01',-1).slice(0,7))}>‹</button><strong>{monthLabel(month)}</strong><button aria-label="次の月" onClick={()=>M(nextMonth(month+'-01').slice(0,7))}>›</button></div>{admin&&<select aria-label="スタッフ" value={staffId} onChange={e=>SI(e.target.value)}>{masters.staff.filter(s=>!s.deleted).map(s=><option key={s.id} value={s.id}>{s.name}{s.active?'':'（停止中）'}</option>)}</select>}<button onClick={()=>print()}>⎙ 出勤簿を印刷</button></div>
  {error&&<p className="error" role="alert">{error}</p>}
  {result&&<section className="timesheet"><div className="print-only timesheet-head"><h2>出勤簿 {monthLabel(month)}</h2><p>事業所: {settings.officeName||'—'}　氏名: {staff.name}（{staff.profession}）　労働時間制: {workSystemLabels[system]}　出力日: {today()}</p></div>
   <p className="timesheet-meta">{staff.name} · {workSystemLabels[system]}{system==='monthly_variable'&&(data!.confirmed?` · 勤務予定表 確定済み（${new Date(data!.confirmed.at).toLocaleDateString('ja-JP')}）· 法定総枠 ${formatMinutes(result.legalTotal)}`:' · 勤務予定表が未確定のため、通常の労働時間制で計算しています')}</p>
   <div className="table-wrap"><table><thead><tr><th>日付</th><th>予定</th><th>出勤</th><th>退勤</th><th>休憩</th><th>労働時間</th><th>時間外</th><th>深夜</th><th>法定休日</th><th>確認事項</th><th className="no-print"></th></tr></thead><tbody>{result.days.map(r=>{const req=data!.requests.filter(q=>q.workDate===r.day);return <tr key={r.day} className={[weekday(r.day)===0?'sunday':weekday(r.day)===6?'saturday':'',r.day===today()?'is-today':''].join(' ')}><td>{dayLabel(r.day)}</td><td>{shiftText(r.shift)}</td><td>{punchTime(r.start,r.day)}</td><td>{punchTime(r.end,r.day)}</td><td>{formatMinutes(r.breakMinutes)}</td><td><b>{formatMinutes(r.work)}</b></td><td>{formatMinutes(r.overtime)}</td><td>{formatMinutes(r.night)}</td><td>{formatMinutes(r.holiday)}</td><td className="warnings">{r.warnings.map(w=><span key={w}>{w}</span>)}{r.punches.some(p=>p.voidedAt||p.source!=='punch')&&<span className="corrected">修正あり</span>}{req.some(q=>q.status==='PENDING')&&<span className="pending">申請中</span>}</td><td className="no-print"><button disabled={!admin&&r.day>today()} onClick={()=>O(r)}>{admin?'修正':'詳細・申請'}</button></td></tr>;})}</tbody>
   <tfoot><tr><th>合計</th><th>{formatMinutes(result.totals.scheduled)}</th><th colSpan={3}>出勤 {result.totals.workDays}日{result.totals.paidLeave?` · 有休 ${result.totals.paidLeave}日`:''}</th><th>{formatMinutes(result.totals.work)||'0:00'}</th><th>{formatMinutes(result.totals.overtime)||'0:00'}</th><th>{formatMinutes(result.totals.night)||'0:00'}</th><th>{formatMinutes(result.totals.holiday)||'0:00'}</th><th></th><th className="no-print"></th></tr></tfoot></table></div>
   <p className="hint">時刻はサーバーの時計で記録した打刻です。時間は1分単位で、端数は切り捨てていません。時間外は{result.variable?'「予定（8時間を超える日・40時間を超える週はその時間）」と月の法定総枠':'1日8時間・週40時間（週は'+'日月火水木金土'[settings.weekStartWeekday]+'曜日から）'}を超えた時間、深夜は22時〜5時、法定休日は勤務予定表の「法定休日」（予定がない日は{'日月火水木金土'[settings.legalHolidayWeekday]}曜日）の労働です。修正した打刻は取り消した記録も残しています。</p></section>}
  {open&&data&&<Dialog title={admin?'打刻の修正':'打刻の詳細・修正の申請'} onClose={()=>O(null)}><DayDialog row={open} staff={staff} admin={admin} requests={data.requests.filter(q=>q.workDate===open.day)} api={api} onClose={()=>O(null)} onDone={async()=>{O(null);await load();}}/></Dialog>}
 </div>;
}

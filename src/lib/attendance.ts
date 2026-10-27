// 勤怠の集計。打刻と勤務予定から、日ごとの労働時間・時間外・深夜・法定休日の労働を求める。端数は丸めない（分は秒まで足してから四捨五入する）。
import {addDays,dateKey,jstDate,nextMonth,timeKey} from './date';
export type PunchKind='IN'|'OUT'|'BREAK_START'|'BREAK_END';
export type ShiftKind='WORK'|'OFF'|'LEGAL_OFF'|'PAID_LEAVE';
export type WorkSystem='standard'|'monthly_variable';
export interface Punch {id:string;staffId:string;workDate:string;kind:PunchKind;at:string;source:'punch'|'request'|'correction';device:string|null;reason:string|null;createdBy:string;createdAt:string;voidedAt:string|null;voidedBy:string|null;voidReason:string|null;}
export interface Shift {staffId:string;day:string;kind:ShiftKind;pattern:string|null;start:string|null;end:string|null;breakMinutes:number;note:string;version:number;}
export interface PunchRequest {id:string;staffId:string;workDate:string;kind:PunchKind;at:string;reason:string;status:'PENDING'|'APPROVED'|'REJECTED';createdAt:string;decidedBy:string|null;decidedAt:string|null;decisionNote:string|null;replaces?:{id:string;kind:PunchKind;at:string}|null;remove?:boolean;}
export type OncallKind='CALL'|'DISPATCH';
export interface OncallEntry {id:string;staffId:string;workDate:string;kind:OncallKind;start:string;end:string;note:string;source:'manual'|'slack';createdBy:string;createdAt:string;voidedAt:string|null;voidedBy:string|null;voidReason:string|null;}
export interface ShiftPattern {code:string;label:string;start:string;end:string;breakMinutes:number;}
export const punchLabels:Record<PunchKind,string>={IN:'出勤',OUT:'退勤',BREAK_START:'休憩開始',BREAK_END:'休憩終了'};
export const oncallLabels:Record<OncallKind,string>={CALL:'電話対応',DISPATCH:'出動'};
export const shiftLabels:Record<ShiftKind,string>={WORK:'勤務',OFF:'休日',LEGAL_OFF:'法定休日',PAID_LEAVE:'有休'};
export const workSystemLabels:Record<WorkSystem,string>={standard:'通常（1日8時間・週40時間）',monthly_variable:'1か月単位の変形労働時間制'};
export const defaultPatterns:ShiftPattern[]=[{code:'日',label:'日勤',start:'08:00',end:'17:00',breakMinutes:60}];
const DAY=480,WEEK=2400;
const minutesOf=(t:string)=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
const span=(a:string,b:string)=>(Date.parse(b)-Date.parse(a))/60000;
// 重なる区間をまとめる。
const merge=(l:[number,number][])=>[...l].sort((a,b)=>a[0]-b[0]).reduce<[number,number][]>((m,i)=>{const last=m.at(-1);if(last&&i[0]<=last[1])last[1]=Math.max(last[1],i[1]);else m.push([i[0],i[1]]);return m;},[]);
const overlap=(a:[number,number],b:[number,number])=>Math.max(0,Math.min(a[1],b[1])-Math.max(a[0],b[0]));
export const monthEnd=(month:string)=>addDays(nextMonth(month+'-01'),-1);
export const monthDays=(month:string)=>{const days:string[]=[];for(let d=month+'-01';d.slice(0,7)===month;d=addDays(d,1))days.push(d);return days;};
export const weekStartOf=(day:string,startWeekday:number)=>addDays(day,-((new Date(day+'T00:00:00Z').getUTCDay()-startWeekday+7)%7));
// スタッフ本人が修正を申請・休憩を申告できる期限（勤務日の翌月10日）。過ぎた後は管理者が理由を付けて修正する。
export const selfDeadline=(workDate:string)=>nextMonth(workDate.slice(0,7)+'-01').slice(0,8)+'10';
// 1か月単位の変形労働時間制の法定総枠（40時間×暦日数÷7）。
export const legalTotal=(days:number)=>Math.floor(WEEK*days/7);
// 予定の労働時間。終了が開始以前なら翌日の終了とみなす。
export function scheduledMinutes(s?:Pick<Shift,'kind'|'start'|'end'|'breakMinutes'>|null){
 if(!s||s.kind!=='WORK'||!s.start||!s.end)return 0;let m=minutesOf(s.end)-minutesOf(s.start);if(m<=0)m+=1440;return Math.max(0,m-s.breakMinutes);
}
export const formatMinutes=(m:number)=>m?`${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`:'';
// 今の打刻の状態。取り消した打刻は除く。
export function punchState(punches:Punch[]):'OFF'|'WORKING'|'BREAK'|'DONE'{
 const last=punches.filter(p=>!p.voidedAt).sort((a,b)=>a.at.localeCompare(b.at)).at(-1);
 return !last?'OFF':last.kind==='OUT'?'DONE':last.kind==='BREAK_START'?'BREAK':'WORKING';
}
// 次に押せる打刻。勤務日の打刻の並びから決める。退勤した後も、同じ日にもう一度出勤できる（中抜け）。
export function allowedNext(punches:Punch[]):PunchKind[]{
 return {OFF:['IN'],WORKING:['BREAK_START','OUT'],BREAK:['BREAK_END'],DONE:['IN']}[punchState(punches)] as PunchKind[];
}
export interface DayResult {day:string;start:string|null;end:string|null;breakMinutes:number;work:number;night:number;holiday:number;overtime:number;scheduled:number;shift:Shift|null;punches:Punch[];warnings:string[];autoBreak:boolean;waived:boolean;oncall:OncallEntry[];oncallMinutes:number;oncallCount:number;duty:boolean;}
interface DayInput {day:string;punches:Punch[];shift:Shift|null;isLegalHoliday:(day:string)=>boolean;today:string;autoBreakMinutes?:number;waived?:boolean;oncall?:OncallEntry[];duty?:boolean;}
// 1日分の集計（時間外は月の集計で入れる）。
export function dayRecord({day,punches,shift,isLegalHoliday,today,autoBreakMinutes=0,waived=false,oncall=[],duty=false}:DayInput):DayResult{
 const valid=punches.filter(p=>!p.voidedAt).sort((a,b)=>a.at.localeCompare(b.at)),warnings:string[]=[];
 const intervals:[string,string][]=[];let open:string|null=null,broken=false,onBreak=false;
 for(const p of valid){
  if(p.kind==='IN'||p.kind==='BREAK_END'){if(open||(p.kind==='BREAK_END')!==onBreak)broken=true;open=p.at;onBreak=false;}
  else{if(!open||(p.kind==='OUT'&&onBreak))broken=true;if(open)intervals.push([open,p.at]);open=null;onBreak=p.kind==='BREAK_START';}
 }
 if(broken)warnings.push('打刻の順番が正しくありません');
 if((open||onBreak)&&day<today)warnings.push(onBreak?'休憩終了・退勤の打刻がありません':'退勤の打刻がありません');
 const start=valid.find(p=>p.kind==='IN')?.at??null,end=[...valid].reverse().find(p=>p.kind==='OUT')?.at??null;
 // オンコールの対応は通常の勤務と重ねずにまとめ、労働・深夜・法定休日に入れる。休憩と予定の判定は通常の打刻だけで行う。
 const active=oncall.filter(e=>!e.voidedAt),toMs=(l:[string,string][])=>l.map(([a,b])=>[Date.parse(a),Date.parse(b)] as [number,number]);
 const ms=merge([...toMs(intervals),...toMs(active.map(e=>[e.start,e.end]))]),total=(l:[number,number][])=>Math.round(l.reduce((n,i)=>n+i[1]-i[0],0)/60000);
 const sum=(f:(i:[number,number])=>number)=>Math.round(ms.reduce((n,i)=>n+f(i),0)/60000);
 const punched=total(merge(toMs(intervals))),oncallMinutes=total(ms)-punched,spanMinutes=start&&end&&end>start?Math.round(span(start,end)):0;
 // 休憩の打刻がない平日の1日勤務（6時間超）は、勤務予定の休憩（なければ基本設定の分）を取ったものとして差し引く。
 // 平日は、勤務予定が「勤務」の日か、予定がない月〜金。本人が「休憩を取れなかった」と申告した日は差し引かない。
 const weekday=shift?shift.kind==='WORK':![0,6].includes(new Date(day+'T00:00:00Z').getUTCDay());
 const autoMinutes=shift?.kind==='WORK'?shift.breakMinutes:autoBreakMinutes;
 const autoBreak=autoMinutes>0&&!waived&&weekday&&!isLegalHoliday(day)&&!broken&&!open&&!onBreak&&intervals.length===1&&valid.every(p=>p.kind==='IN'||p.kind==='OUT')&&spanMinutes>360;
 const work=Math.max(0,punched-(autoBreak?autoMinutes:0))+oncallMinutes,punchWork=work-oncallMinutes;
 const night=sum(i=>[-1,0,1].reduce((n,k)=>{const d=addDays(day,k);return n+overlap(i,[jstDate(d,'22:00').getTime(),jstDate(addDays(d,1),'05:00').getTime()]);},0));
 // 法定休日の労働は暦日（0時〜24時）で数える。前日からの勤務が法定休日にかかる分も含める。
 const holiday=sum(i=>[0,1].reduce((n,k)=>{const d=addDays(day,k);return isLegalHoliday(d)?n+overlap(i,[jstDate(d).getTime(),jstDate(addDays(d,1)).getTime()]):n;},0));
 const breakMinutes=spanMinutes?Math.max(0,spanMinutes-punchWork):0;
 if(end&&!open&&!onBreak&&!autoBreak){if(punchWork>480&&breakMinutes<60)warnings.push('休憩が60分未満です（8時間超）');else if(punchWork>360&&breakMinutes<45)warnings.push('休憩が45分未満です（6時間超）');}
 const scheduled=scheduledMinutes(shift);
 if(shift?.kind==='WORK'&&shift.start&&shift.end&&start){
  const late=Math.round(span(jstDate(day,shift.start).toISOString(),start));let planEnd=jstDate(day,shift.end);if(minutesOf(shift.end)<=minutesOf(shift.start))planEnd=jstDate(addDays(day,1),shift.end);
  if(Math.abs(late)>=30||(end&&Math.abs(span(planEnd.toISOString(),end))>=30))warnings.push('予定と30分以上ずれています');
 }else if(punchWork&&shift&&shift.kind!=='WORK')warnings.push(`予定は${shiftLabels[shift.kind]}です`);
 return {day,start,end,breakMinutes,work,night,holiday,overtime:0,scheduled,shift,punches,warnings,autoBreak,waived,oncall,oncallMinutes,oncallCount:active.length,duty};
}
export interface MonthOptions {month:string;system:WorkSystem;confirmed:boolean;weekStart:number;legalHolidayWeekday:number;today:string;punches:Punch[];shifts:Shift[];autoBreakMinutes?:number;waivers?:string[];oncall?:OncallEntry[];duties?:string[];}
export interface MonthResult {days:DayResult[];variable:boolean;legalTotal:number;totals:{workDays:number;work:number;overtime:number;night:number;holiday:number;paidLeave:number;scheduled:number;oncall:number;oncallCount:number;duties:number};}
// 1か月の集計。通常は「1日8時間・週40時間」、変形制（確定済みの月）は「予定・週・月の法定総枠」を超えた分を時間外にする。
// 通常の週は月をまたぐので、月初の週は前月の打刻も読む（punches は weekStartOf(月初) から渡す）。
export function monthRecord(o:MonthOptions):MonthResult{
 const first=o.month+'-01',last=monthEnd(o.month),from=weekStartOf(first,o.weekStart),variable=o.system==='monthly_variable'&&o.confirmed;
 const shiftOf=(d:string)=>o.shifts.find(s=>s.day===d)??null;
 const isLegalHoliday=(d:string)=>{const s=shiftOf(d);return s?s.kind==='LEGAL_OFF':new Date(d+'T00:00:00Z').getUTCDay()===o.legalHolidayWeekday;};
 const all:DayResult[]=[];for(let d=variable?first:from;d<=last;d=addDays(d,1))all.push(dayRecord({day:d,punches:o.punches.filter(p=>p.workDate===d),shift:shiftOf(d),isLegalHoliday,today:o.today,autoBreakMinutes:o.autoBreakMinutes,waived:o.waivers?.includes(d),oncall:o.oncall?.filter(e=>e.workDate===d),duty:o.duties?.includes(d)}));
 // 週・月の上限を超えた分は、超えた日に付ける。日ごとの時間外と法定休日の労働は週・月の計算に入れない。
 let week:string|null=null,weekRegular=0,weekLimit=WEEK,monthRegular=0;const total=legalTotal(variable?all.length:0);
 for(const r of all){
  const w=weekStartOf(r.day,o.weekStart);
  if(w!==week){week=w;weekRegular=0;const days=Array.from({length:7},(_,i)=>addDays(w,i));const full=!variable||(days[0]>=first&&days[6]<=last);weekLimit=!full?Infinity:variable?Math.max(WEEK,days.reduce((n,d)=>n+scheduledMinutes(shiftOf(d)),0)):WEEK;}
  const plain=r.work-r.holiday,daily=Math.max(0,plain-(variable?Math.max(DAY,r.scheduled):DAY)),regular=plain-daily;
  const weekly=Math.max(0,Math.min(regular,weekRegular+regular-weekLimit));weekRegular+=regular;
  const rest=regular-weekly,monthly=variable?Math.max(0,Math.min(rest,monthRegular+rest-total)):0;monthRegular+=rest;
  r.overtime=daily+weekly+monthly;
 }
 const days=all.filter(r=>r.day>=first),sum=(f:(r:DayResult)=>number)=>days.reduce((n,r)=>n+f(r),0);
 return {days,variable,legalTotal:legalTotal(days.length),totals:{workDays:sum(r=>r.work-r.oncallMinutes>0?1:0),work:sum(r=>r.work),overtime:sum(r=>r.overtime),night:sum(r=>r.night),holiday:sum(r=>r.holiday),paidLeave:sum(r=>r.shift?.kind==='PAID_LEAVE'?1:0),scheduled:sum(r=>r.scheduled),oncall:sum(r=>r.oncallMinutes),oncallCount:sum(r=>r.oncallCount),duties:sum(r=>r.duty?1:0)}};
}
// 打刻の表示（勤務日と違う日なら「翌」を付ける）。
export const punchTime=(at:string|null,day:string)=>at?(dateKey(at)>day?'翌':dateKey(at)<day?'前':'')+timeKey(at):'';

import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import {SQLite} from '../scripts/sqlite';import sourceWorker from '../worker/index';import type {Env} from '../worker/types';
import {addDays,dateKey,jstDate} from '../src/lib/date';
import {monthRecord,type Punch,type PunchKind,type Shift} from '../src/lib/attendance';
const worker=process.env.TEST_BUNDLE?(await import('../build/worker.js' as string)).default:sourceWorker;

// 打刻を作る。時刻は日本時間の「YYYY-MM-DD HH:MM」。
let n=0;
const punch=(workDate:string,kind:PunchKind,local:string,extra:Partial<Punch>={}):Punch=>({id:'p'+(++n),staffId:'s',workDate,kind,at:jstDate(local.slice(0,10),local.slice(11)).toISOString(),source:'punch',device:null,reason:null,createdBy:'s',createdAt:'',voidedAt:null,voidedBy:null,voidReason:null,...extra});
const day=(d:string,from:string,to:string,breakFrom?:string,breakTo?:string)=>[punch(d,'IN',`${d} ${from}`),...(breakFrom?[punch(d,'BREAK_START',`${d} ${breakFrom}`),punch(d,'BREAK_END',`${d} ${breakTo}`)]:[]),punch(d,'OUT',`${to.length>5?to:d+' '+to}`)];
const shift=(d:string,kind:Shift['kind'],start:string|null=null,end:string|null=null,breakMinutes=0):Shift=>({staffId:'s',day:d,kind,pattern:null,start,end,breakMinutes,note:'',version:1});
const month=(m:string,punches:Punch[],o:{shifts?:Shift[];system?:'standard'|'monthly_variable';confirmed?:boolean;autoBreakMinutes?:number;waivers?:string[]}={})=>monthRecord({month:m,system:o.system??'standard',confirmed:o.confirmed??false,weekStart:0,legalHolidayWeekday:0,today:'2099-01-01',punches,shifts:o.shifts??[],autoBreakMinutes:o.autoBreakMinutes,waivers:o.waivers});
const of=(r:ReturnType<typeof month>,d:string)=>r.days.find(x=>x.day===d)!;

test('daily work over 8 hours is overtime and the break is the gap between punches',()=>{
 const r=of(month('2026-06',day('2026-06-01','09:00','19:00','12:00','13:00')),'2026-06-01');
 assert.equal(r.work,540);assert.equal(r.breakMinutes,60);assert.equal(r.overtime,60);assert.deepEqual(r.warnings,[]);
});
test('a week over 40 hours adds overtime on the day it crosses, counting the previous month in the first week',()=>{
 // 2026-06-28（日）から始まる週。月〜土に8時間ずつ働くと、土曜日の8時間が週40時間を超える。
 const punches=['2026-06-29','2026-06-30','2026-07-01','2026-07-02','2026-07-03','2026-07-04'].flatMap(d=>day(d,'09:00','18:00','12:00','13:00'));
 const r=month('2026-07',punches);
 assert.equal(r.days[0].day,'2026-07-01');assert.equal(of(r,'2026-07-03').overtime,0);assert.equal(of(r,'2026-07-04').overtime,480);
 assert.equal(r.totals.overtime,480);assert.equal(r.totals.work,1920);assert.equal(r.totals.workDays,4);
});
test('monthly variable hours use the confirmed schedule, and fall back to the standard rule until it is confirmed',()=>{
 const shifts=[shift('2026-06-02','WORK','08:00','19:00',60)],punches=day('2026-06-02','08:00','19:00','12:00','13:00');
 assert.equal(of(month('2026-06',punches,{shifts,system:'monthly_variable',confirmed:true}),'2026-06-02').overtime,0);
 assert.equal(of(month('2026-06',punches,{shifts,system:'monthly_variable',confirmed:true}),'2026-06-02').scheduled,600);
 assert.equal(of(month('2026-06',punches,{shifts,system:'monthly_variable',confirmed:false}),'2026-06-02').overtime,120);
 // 予定より長く働いた分は時間外。
 assert.equal(of(month('2026-06',day('2026-06-02','08:00','20:00','12:00','13:00'),{shifts,system:'monthly_variable',confirmed:true}),'2026-06-02').overtime,60);
});
test('monthly variable hours count work over the legal monthly total',()=>{
 // 6月（30日）の法定総枠は 40×30÷7=171時間25分。平日22日×8時間=176時間で、超えた分が時間外になる。
 const days=Array.from({length:30},(_,i)=>addDays('2026-06-01',i)).filter(d=>![0,6].includes(new Date(d+'T00:00:00Z').getUTCDay()));
 const shifts=days.map(d=>shift(d,'WORK','09:00','18:00',60)),punches=days.flatMap(d=>day(d,'09:00','18:00','12:00','13:00'));
 const r=month('2026-06',punches,{shifts,system:'monthly_variable',confirmed:true});
 assert.equal(r.legalTotal,10285);assert.equal(r.totals.work,days.length*480);assert.equal(r.totals.overtime,days.length*480-10285);
});
test('night work, overnight shifts and missing breaks are reported',()=>{
 const r=of(month('2026-06',day('2026-06-03','20:00','2026-06-04 06:00')),'2026-06-03');
 assert.equal(r.work,600);assert.equal(r.night,420);assert.equal(r.overtime,120);assert.equal(r.end?.slice(0,10),'2026-06-03');
 assert(r.warnings.some(w=>w.includes('60分未満')));
});
test('work on the legal holiday is counted separately from overtime',()=>{
 const r=of(month('2026-06',day('2026-06-07','09:00','13:00')),'2026-06-07');
 assert.equal(r.holiday,240);assert.equal(r.overtime,0);
 // 勤務予定表で法定休日を別の曜日にした場合。
 const s=of(month('2026-06',day('2026-06-06','09:00','13:00'),{shifts:[shift('2026-06-06','LEGAL_OFF'),shift('2026-06-07','OFF')]}),'2026-06-06');
 assert.equal(s.holiday,240);assert(s.warnings.includes('予定は法定休日です'));
});
test('voided punches are ignored and a missing clock-out is flagged',()=>{
 const voided=punch('2026-06-05','OUT','2026-06-05 23:00',{voidedAt:'x'});
 const r=of(month('2026-06',[...day('2026-06-05','09:00','17:00'),voided]),'2026-06-05');assert.equal(r.work,480);
 assert(of(month('2026-06',[punch('2026-06-08','IN','2026-06-08 09:00')]),'2026-06-08').warnings.includes('退勤の打刻がありません'));
});

test('weekday full days without break punches get the automatic break',()=>{
 const auto={autoBreakMinutes:60};
 // 平日 8:00〜17:00、休憩の打刻なし → 労働 8:00、休憩 1:00（自動）、時間外なし、警告なし。
 const r=of(month('2026-06',day('2026-06-01','08:00','17:00'),auto),'2026-06-01');
 assert.equal(r.work,480);assert.equal(r.breakMinutes,60);assert(r.autoBreak);assert.equal(r.overtime,0);assert.deepEqual(r.warnings,[]);
 // 休憩の打刻がある日は今までどおり。
 const punched=of(month('2026-06',day('2026-06-01','08:00','17:00','12:00','12:30'),auto),'2026-06-01');assert.equal(punched.work,510);assert(!punched.autoBreak);
 // 土日、勤務予定が休日・有休、6時間以下の日は差し引かない。
 assert(!of(month('2026-06',day('2026-06-06','08:00','17:00'),auto),'2026-06-06').autoBreak);
 assert(!of(month('2026-06',day('2026-06-02','08:00','17:00'),{...auto,shifts:[shift('2026-06-02','OFF')]}),'2026-06-02').autoBreak);
 assert(!of(month('2026-06',day('2026-06-03','09:00','15:00'),auto),'2026-06-03').autoBreak);
 // 勤務予定の休憩が45分ならその値。土曜でも勤務予定が「勤務」なら差し引く。
 assert.equal(of(month('2026-06',day('2026-06-04','08:00','17:00'),{...auto,shifts:[shift('2026-06-04','WORK','08:00','17:00',45)]}),'2026-06-04').work,495);
 assert(of(month('2026-06',day('2026-06-06','08:00','17:00'),{...auto,shifts:[shift('2026-06-06','WORK','08:00','17:00',60)]}),'2026-06-06').autoBreak);
 // 「休憩を取れなかった」と申告した日は差し引かず、警告を出す。設定 0 なら差し引かない。
 const waived=of(month('2026-06',day('2026-06-05','08:00','17:00'),{...auto,waivers:['2026-06-05']}),'2026-06-05');
 assert.equal(waived.work,540);assert(waived.waived);assert(waived.warnings.some(w=>w.includes('60分未満')));
 assert(!of(month('2026-06',day('2026-06-01','08:00','17:00'),{autoBreakMinutes:0}),'2026-06-01').autoBreak);
});
function fixture(){
 const db=new SQLite();for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.raw.exec(readFileSync('migrations/'+file,'utf8'));
 const env:Env={MTLS_MODE:'local',DB:db,APP_ORIGIN:'http://127.0.0.1:3000',AUTH_PEPPER:'test-secret-pepper-32-bytes-long-value',SETUP_TOKEN:'test-setup-token-32-bytes-long-value',SETUP_EXPIRES:String(Date.now()+86400000)};
 let rev=1;type Session={cookie:string;csrf:string;id?:string};const none:Session={cookie:'',csrf:''};
 async function call(s:Session,path:string,method='GET',body?:any){const res=await worker.fetch(new Request(env.APP_ORIGIN+'/api/'+path,{method,headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json',Cookie:s.cookie,'X-CSRF-Token':s.csrf},...(body!==undefined?{body:JSON.stringify(method==='GET'?body:{revision:rev,...body})}:{})}),env);const data:any=await res.json();if(res.ok&&data.revision)rev=data.revision;return {status:res.status,data};}
 async function login(id:string,password:string):Promise<Session|null>{const res=await worker.fetch(new Request(env.APP_ORIGIN+'/api/auth/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({login:id,password})}),env);if(!res.ok)return null;const data:any=await res.json();return {cookie:res.headers.get('set-cookie')!.split(';')[0],csrf:data.csrf,id:data.staff.id};}
 return {db,call,login,setup:async()=>{await call(none,'setup','POST',{token:env.SETUP_TOKEN,login:'admin',name:'テスト管理者',password:'test-password-long-enough'});return (await login('admin','test-password-long-enough'))!;}};
}
async function nurseOf(f:ReturnType<typeof fixture>,admin:any){
 const r=await f.call(admin,'staff','POST',{login:'nurse',name:'テスト看護師',kana:'',profession:'看護師',color:'#336699',role:'STAFF',active:true,workSystem:'monthly_variable'});assert.equal(r.status,200,JSON.stringify(r.data));
 const first=await f.login('nurse',r.data.temporaryPassword);assert.equal((await f.call(first!,'auth/password','POST',{current:r.data.temporaryPassword,next:'nurse-password-long'})).status,200);
 return (await f.login('nurse','nurse-password-long'))!;
}
const thisMonth=()=>dateKey(new Date()).slice(0,7);

test('punches follow the work order and staff only see their own attendance',async()=>{
 const f=fixture(),admin=await f.setup(),nurse=await nurseOf(f,admin);
 assert.equal((await f.call(admin,'bootstrap')).data.data.staff.find((s:any)=>s.id===nurse.id).workSystem,'monthly_variable');
 const p=(kind:string)=>f.call(nurse,'attendance/punch','POST',{kind});
 assert.equal((await p('OUT')).status,409);assert.equal((await p('IN')).status,200);assert.equal((await p('IN')).status,409);
 assert.equal((await p('BREAK_START')).status,200);assert.equal((await p('OUT')).status,409);assert.equal((await p('BREAK_END')).status,200);
 const out=await p('OUT');assert.equal(out.status,200);assert.deepEqual(out.data.next,['IN']);assert.equal(out.data.punches[0].device,'local');
 assert.equal((await f.call(nurse,`attendance?staffId=${admin.id}&month=${thisMonth()}`)).status,403);
 const mine=await f.call(nurse,`attendance?month=${thisMonth()}`);assert.equal(mine.status,200);assert.equal(mine.data.punches.length,4);assert.deepEqual(mine.data.pending,[]);
 const audit=(await f.call(admin,'audit')).data.map((a:any)=>a.action);assert(audit.includes('PUNCH_IN')&&audit.includes('PUNCH_OUT'));
});
test('corrections need a reason, are admin-only and keep the original punch',async()=>{
 const f=fixture(),admin=await f.setup(),nurse=await nurseOf(f,admin);
 await f.call(nurse,'attendance/punch','POST',{kind:'IN'});
 const [original]=(await f.call(nurse,`attendance?month=${thisMonth()}`)).data.punches,workDate=original.workDate;
 const body={staffId:nurse.id,workDate,void:[original.id],add:[{kind:'IN',date:workDate,time:'00:00'}]};
 assert.equal((await f.call(nurse,'attendance/corrections','POST',{...body,reason:'自分で直す'})).status,403);
 assert.equal((await f.call(admin,'attendance/corrections','POST',{...body,reason:' '})).status,400);
 assert.equal((await f.call(admin,'attendance/corrections','POST',{...body,add:[{kind:'IN',date:addDays(workDate,2),time:'09:00'}],reason:'範囲外'})).status,400);
 assert.equal((await f.call(admin,'attendance/corrections','POST',{...body,reason:'出勤時刻の誤り'})).status,200);
 // 同じ打刻をもう一度取り消そうとすると、何も変えずに 409。
 assert.equal((await f.call(admin,'attendance/corrections','POST',{...body,reason:'二重'})).status,409);
 const after=(await f.call(admin,`attendance?staffId=${nurse.id}&month=${thisMonth()}`)).data.punches;
 assert.equal(after.length,2);const old=after.find((x:any)=>x.id===original.id);assert(old.voidedAt);assert.equal(old.voidReason,'出勤時刻の誤り');
 const added=after.find((x:any)=>x.id!==original.id);assert.equal(added.source,'correction');assert.equal(added.reason,'出勤時刻の誤り');assert.equal(added.createdBy,admin.id);
 assert(Number(f.db.raw.prepare('SELECT count(*) AS n FROM punches').get().n)===2);
});
test('missed punches are requested by the staff and added when an admin approves',async()=>{
 const f=fixture(),admin=await f.setup(),nurse=await nurseOf(f,admin),yesterday=addDays(dateKey(new Date()),-1);
 assert.equal((await f.call(nurse,'attendance/requests','POST',{workDate:yesterday,kind:'IN',date:yesterday,time:'09:00',reason:''})).status,400);
 const r=await f.call(nurse,'attendance/requests','POST',{workDate:yesterday,kind:'IN',date:yesterday,time:'09:00',reason:'打刻を忘れた'});assert.equal(r.status,200);
 assert.equal((await f.call(nurse,'attendance/requests/'+r.data.id,'PATCH',{approve:true})).status,403);
 const pending=(await f.call(admin,`attendance?month=${thisMonth()}`)).data.pending;assert.equal(pending.length,1);
 assert.equal((await f.call(admin,'attendance/requests/'+r.data.id,'PATCH',{approve:false,note:''})).status,400);
 assert.equal((await f.call(admin,'attendance/requests/'+r.data.id,'PATCH',{approve:true,note:'確認済み'})).status,200);
 assert.equal((await f.call(admin,'attendance/requests/'+r.data.id,'PATCH',{approve:true})).status,409);
 const punches=(await f.call(nurse,`attendance?month=${yesterday.slice(0,7)}`)).data.punches;assert.equal(punches.length,1);assert.equal(punches[0].source,'request');assert.equal(punches[0].at,jstDate(yesterday,'09:00').toISOString());
});
test('only admins edit the shift schedule, with version checks and confirmation',async()=>{
 const f=fixture(),admin=await f.setup(),nurse=await nurseOf(f,admin),m='2026-08';
 const item={staffId:nurse.id,day:'2026-08-03',kind:'WORK',pattern:'日',start:'09:00',end:'18:00',breakMinutes:60,note:'',version:0};
 assert.equal((await f.call(nurse,'shifts','POST',{month:m,items:[item]})).status,403);
 assert.equal((await f.call(admin,'shifts','POST',{month:m,items:[{...item,day:'2026-09-01'}]})).status,400);
 assert.equal((await f.call(admin,'shifts','POST',{month:m,items:[{...item,start:null}]})).status,400);
 assert.equal((await f.call(admin,'shifts','POST',{month:m,items:[item]})).status,200);
 assert.equal((await f.call(admin,'shifts','POST',{month:m,items:[item]})).status,409);
 const seen=await f.call(nurse,'shifts?month='+m);assert.equal(seen.status,200);assert.equal(seen.data.shifts.length,1);assert.equal(seen.data.shifts[0].version,1);assert.equal(seen.data.confirmed,null);
 assert.equal((await f.call(nurse,'shifts/confirm','POST',{month:m})).status,403);
 assert.equal((await f.call(admin,'shifts/confirm','POST',{month:m})).status,200);assert.equal((await f.call(admin,'shifts/confirm','POST',{month:m})).status,409);
 assert.equal((await f.call(admin,'shifts','POST',{month:m,items:[{...item,kind:'PAID_LEAVE',version:1}],remove:[]})).status,200);
 assert.equal((await f.call(admin,'shifts','POST',{month:m,remove:[{staffId:nurse.id,day:'2026-08-03',version:2}]})).status,200);
 assert.equal((await f.call(nurse,'shifts?month='+m)).data.shifts.length,0);
 assert((await f.call(admin,'audit')).data.some((a:any)=>a.action==='SHIFTS_CHANGED_AFTER_CONFIRM'));
});
test('saving the office settings keeps the shift patterns',async()=>{
 const f=fixture(),admin=await f.setup();
 const patterns=[{code:'早',label:'早番',start:'07:00',end:'16:00',breakMinutes:60}];
 assert.equal((await f.call(admin,'settings','PATCH',{shiftPatterns:patterns,legalHolidayWeekday:6,weekStartWeekday:1,version:0})).status,200);
 assert.equal((await f.call(admin,'settings','PATCH',{officeName:'本院',officeAddress:'',marginMinutes:10,officeLocation:'',detourFactor:1.4,speedKmh:30,version:1})).status,200);
 const s=(await f.call(admin,'bootstrap')).data.data.settings;assert.deepEqual(s.shiftPatterns,patterns);assert.equal(s.legalHolidayWeekday,6);assert.equal(s.officeName,'本院');
 assert.equal((await f.call(admin,'settings','PATCH',{shiftPatterns:[...patterns,patterns[0]],version:2})).status,400);
});
test('staff declare days they could not take a break; admins can revoke, and the record stays',async()=>{
 const f=fixture(),admin=await f.setup(),nurse=await nurseOf(f,admin),yesterday=addDays(dateKey(new Date()),-1);
 assert.equal((await f.call(nurse,'attendance/break-waiver','POST',{workDate:yesterday,reason:' '})).status,400);
 assert.equal((await f.call(nurse,'attendance/break-waiver','POST',{staffId:admin.id,workDate:yesterday,reason:'代理'})).status,403);
 assert.equal((await f.call(nurse,'attendance/break-waiver','POST',{workDate:addDays(dateKey(new Date()),1),reason:'未来'})).status,400);
 assert.equal((await f.call(nurse,'attendance/break-waiver','POST',{workDate:yesterday,reason:'訪問が押して取れなかった'})).status,200);
 assert.equal((await f.call(nurse,'attendance/break-waiver','POST',{workDate:yesterday,reason:'二重'})).status,409);
 assert.equal((await f.call(nurse,'attendance/break-waiver/revoke','POST',{staffId:nurse.id,workDate:yesterday})).status,403);
 assert.equal((await f.call(admin,'attendance/break-waiver/revoke','POST',{staffId:nurse.id,workDate:yesterday})).status,200);
 let w=(await f.call(nurse,`attendance?month=${yesterday.slice(0,7)}`)).data.waivers;assert.equal(w.length,1);assert(w[0].revokedAt);
 assert.equal((await f.call(nurse,'attendance/break-waiver','POST',{workDate:yesterday,reason:'出し直し'})).status,200);
 w=(await f.call(nurse,`attendance?month=${yesterday.slice(0,7)}`)).data.waivers;assert.equal(w[0].revokedAt,null);assert.equal(w[0].reason,'出し直し');
 const actions=(await f.call(admin,'audit')).data.map((a:any)=>a.action);assert(actions.includes('BREAK_WAIVED')&&actions.includes('BREAK_WAIVER_REVOKED'));
});

// Slack の #出勤退勤 の投稿を打刻の種類に読み替える。「出勤」「退勤」「休憩」「オンコール」を含む投稿だけを対象にする。
import type {OncallKind,PunchKind} from './attendance';
// 予定の連絡（「明日は遅れて出勤します」など）は、投稿した時刻に働き始めたわけではないので打刻にしない。
const notice=/できません|できない|しません|休みます|欠勤|遅れ|遅刻|明日|あした|出勤予定|退勤予定/;
export type Oncall={kind:OncallKind;start:string;end:string;note:string};
export type Parsed={kind:PunchKind}|{oncall:Oncall}|{ignored:string}|null;
// 打刻・記録にならなかった投稿への返信に付ける、正しい書き方。
export const postingGuide='書き方：出勤は「出勤します」、退勤は「退勤します」のように、時刻を書かずに投稿してください（投稿した時刻で打刻します）。休憩は「休憩入ります」「休憩終わります」。オンコールの対応は「オンコール 電話対応 18:00-18:05」「オンコール 出動 18時から18時40分」のように、電話対応か出動かと、対応した時刻の範囲を書いてください。';
// 時刻は「18:00」「18時」「18時5分」「18時半」、区切りは 〜 - や「から」。
const time=String.raw`(\d{1,2})\s*(?::\s*(\d{2})|時\s*(?:(\d{1,2})\s*分|(半))?)`;
const range=new RegExp(time+String.raw`\s*(?:[〜～~\-－ー―]|から)\s*`+time);
const hhmm=(h:string,m='0')=>Number(h)<24&&Number(m)<60?`${h.padStart(2,'0')}:${m.padStart(2,'0')}`:null;
const call=/電話|tel/i,dispatch=/出動|往診|訪問(?!看護)|駆けつけ|駆け付け/;
// 電話対応か出動か。どちらか一方の言葉だけがあれば決まる。
const kindOf=(t:string)=>call.test(t)===dispatch.test(t)?null:call.test(t)?'CALL' as const:'DISPATCH' as const;
export function parsePunch(text:string):Parsed{
 // 絵文字（:smile:）は英字を含むものだけを外す（「23:50-0:40」の時刻を消さないため）。
 // チャンネル名の「出勤退勤」「出退勤」は、出勤・退勤の報告ではないので取り除く。
 // 全角の数字・コロンは半角に直す（「１８：００」）。
 const t=text.replace(/[０-９：]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/<[^>]*>/g,' ').replace(/:[a-z0-9_+'-]*[a-z][a-z0-9_+'-]*:/gi,' ').replace(/出勤退勤|出退勤/g,' ');
 // オンコール中の対応は、対応した時間だけを時刻の範囲で報告する（オンコール自体の開始・終了は報告しない）。
 if(/オンコ/.test(t))return oncallOf(t);
 const rest=t.includes('休憩'),out=t.includes('退勤'),start=t.includes('出勤');
 if(!rest&&!out&&!start)return null;
 if(notice.test(t))return {ignored:'予定の連絡と判断したため、打刻にしませんでした。'};
 // ほかの人の報告（「〇〇さんも出勤してます」）は、投稿した本人の打刻にしない。
 if(/さん/.test(t))return {ignored:'ほかの人の出勤・退勤の連絡と判断したため、打刻にしませんでした。本人が投稿するか、アプリで打刻してください。'};
 // 時刻を書いた投稿（「7:30出勤」「昨日17:30 退勤」）は、投稿した時刻と実際の時刻が違うので打刻にしない。
 if(/\d{1,2}\s*[:：時]\s*\d{0,2}|昨日/.test(t))return {ignored:'時刻や日付が書かれていて、投稿した時刻と違う可能性があるため、打刻にしませんでした。'};
 if(Number(rest)+Number(out)+Number(start)>1)return {ignored:'出勤・退勤・休憩のどれか決められなかったため、打刻にしませんでした。1つの投稿には1つだけ書いてください。'};
 if(rest)return {kind:/終わ|おわ|終了|明け|戻/.test(t)?'BREAK_END':'BREAK_START'};
 return {kind:out?'OUT':'IN'};
}
// スタッフ情報の Slack メンバーID（前のアカウントも含め、カンマ区切りで複数）。
export const slackIds=(v:string)=>v.split(',').map(x=>x.trim()).filter(Boolean);
// Slack の ts（秒.マイクロ秒）を日時に。
export const tsDate=(ts:string)=>new Date(Math.round(Number(ts)*1000));
function oncallOf(t:string):Parsed{
 if(notice.test(t.replace(range,' ')))return {ignored:'予定の連絡と判断したため、記録しませんでした。'};
 if(/さん/.test(t))return {ignored:'ほかの人の連絡と判断したため、記録しませんでした。本人が投稿するか、アプリで報告してください。'};
 const m=range.exec(t),start=m&&hhmm(m[1],m[2]??m[3]??(m[4]?'30':undefined)),end=m&&hhmm(m[5],m[6]??m[7]??(m[8]?'30':undefined));
 if(!m||!start||!end)return {ignored:'対応した時刻の範囲が読み取れなかったため、オンコールの対応を記録しませんでした。'};
 // 種類は時刻の前の言葉で決め、決まらなければ投稿全体で決める（メモの「家族から電話あり」で出動が変わらないように）。
 // 全体でも、どちらもない、または両方あるときは記録しない。
 const kind=kindOf(t.slice(0,m.index))??kindOf(t);
 if(!kind)return {ignored:'電話対応か出動か決められなかったため、オンコールの対応を記録しませんでした。どちらか一方を書いてください。'};
 const note=t.slice(m.index+m[0].length).replace(/^\s*まで/,'').replace(/\s+/g,' ').trim().slice(0,200);
 return {oncall:{kind,start,end,note}};
}

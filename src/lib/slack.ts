// Slack の #出勤退勤 の投稿を打刻の種類に読み替える。「出勤」「退勤」「休憩」を含む投稿だけを対象にする。
import type {PunchKind} from './attendance';
// 予定の連絡（「明日は遅れて出勤します」など）は、投稿した時刻に働き始めたわけではないので打刻にしない。
const notice=/できません|できない|しません|休みます|欠勤|遅れ|遅刻|明日|あした|出勤予定|退勤予定/;
export type Parsed={kind:PunchKind}|{ignored:string}|null;
export function parsePunch(text:string):Parsed{
 // チャンネル名の「出勤退勤」「出退勤」は、出勤・退勤の報告ではないので取り除く。
 const t=text.replace(/<[^>]*>/g,' ').replace(/:[a-z0-9_+'-]+:/gi,' ').replace(/出勤退勤|出退勤/g,' ');
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
// Slack の ts（秒.マイクロ秒）を日時に。
export const tsDate=(ts:string)=>new Date(Math.round(Number(ts)*1000));

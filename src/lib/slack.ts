// Slack の #出勤退勤 の投稿を打刻の種類に読み替える。「出勤」「退勤」「休憩」を含む投稿だけを対象にする。
import type {PunchKind} from './attendance';
// 予定の連絡（「明日は遅れて出勤します」など）は、投稿した時刻に働き始めたわけではないので打刻にしない。
const notice=/できません|できない|しません|休みます|欠勤|遅れ|遅刻|明日|あした|出勤予定|退勤予定/;
export type Parsed={kind:PunchKind}|{ignored:string}|null;
export function parsePunch(text:string):Parsed{
 const t=text.replace(/<[^>]*>/g,' ').replace(/:[a-z0-9_+'-]+:/gi,' ');
 const rest=t.includes('休憩'),out=t.includes('退勤'),start=t.includes('出勤');
 if(!rest&&!out&&!start)return null;
 if(notice.test(t))return {ignored:'予定の連絡と判断したため、打刻にしませんでした。'};
 if(Number(rest)+Number(out)+Number(start)>1)return {ignored:'出勤・退勤・休憩のどれか決められなかったため、打刻にしませんでした。1つの投稿には1つだけ書いてください。'};
 if(rest)return {kind:/終わ|おわ|終了|明け|戻/.test(t)?'BREAK_END':'BREAK_START'};
 return {kind:out?'OUT':'IN'};
}
// Slack の ts（秒.マイクロ秒）を日時に。
export const tsDate=(ts:string)=>new Date(Math.round(Number(ts)*1000));

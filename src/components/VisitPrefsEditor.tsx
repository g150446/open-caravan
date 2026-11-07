// 診察希望日・NG を曜日×午前／午後の表で登録する。セルを押すたびに 未設定 → 希望(○) → NG(×) と切り替わる。
import type {VisitPrefs} from '../models';
import {cycleSlot,dayParts,emptyPrefs,slotState,weekOrder} from '../lib/visitPrefs';

const dayNames='日月火水木金土';
const stateLabel={preferred:'希望',ng:'NG','':'未設定'};
export function VisitPrefsEditor({value,onChange}:{value?:VisitPrefs;onChange:(v:VisitPrefs)=>void}){
 const v=value??emptyPrefs;
 return <div className="visit-prefs">
  <div className="prefs-grid" role="group" aria-label="曜日と時間帯ごとの希望・NG">
   <span/>{weekOrder.map(d=><span key={d} className={'prefs-day'+(d===0?' sun':d===6?' sat':'')}>{dayNames[d]}</span>)}
   {dayParts.map(([part,label])=>[<span key={part} className="prefs-part">{label}</span>,...weekOrder.map(d=>{const s=slotState(v,d,part);return <button type="button" key={part+d} className={'prefs-cell '+s} aria-label={`${dayNames[d]}曜${label}: ${stateLabel[s]}`} onClick={()=>onChange(cycleSlot(v,d,part))}>{s==='preferred'?'○':s==='ng'?'×':''}</button>;})])}
  </div>
  <div className="prefs-legend"><span><b className="prefs-cell preferred">○</b>希望</span><span><b className="prefs-cell ng">×</b>NG</span><span className="hint">押すたびに 未設定 → 希望 → NG と切り替わります。</span>{(v.preferred.length>0||v.ng.length>0)&&<button type="button" className="link" onClick={()=>onChange({...v,preferred:[],ng:[]})}>すべてクリア</button>}</div>
  <input aria-label="希望・NGの備考" value={v.note} maxLength={200} placeholder="備考（例: 水曜午後は入浴のため不可）" onChange={e=>onChange({...v,note:e.target.value})}/>
 </div>;
}

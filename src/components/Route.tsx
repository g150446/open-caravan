// CrossLog の「ルート」と「ルートを一括変更する」にあたる画面。列（担当＋同行の組み合わせ）の1日分の訪問を扱う。
import {Fragment,useEffect,useState,type FormEvent} from 'react';
import type {Api,Appointment,Masters,RouteResult,Settings} from '../models';
import {autoAdjust,clock,formatKm,groupStops,navUrl,splitHalf,stopLabel,timeline,toMinutes,type HalfMode,type Leg,type Stop,type Visit} from '../lib/route';
import {Field} from './Forms';

interface Props {heading:string;staffLabel:string;items:Appointment[];masters:Masters;settings:Settings;api:Api;onBack:()=>void;}
const parseClock=(v:string)=>/^\d{2}:\d{2}$/.test(v)?Number(v.slice(0,2))*60+Number(v.slice(3)):NaN;

// 患者の住所（なければ施設の住所）がある訪問だけを経路に入れる。一般予定と住所のない予定は別に並べる。
function visitsOf(items:Appointment[],masters:Masters){
 const visits:Visit[]=[],others:{a:Appointment;reason:string}[]=[];
 for(const a of [...items].sort((x,y)=>x.startsAt.localeCompare(y.startsAt))){
  const p=masters.patients.find(x=>x.id===a.patientId),f=masters.facilities.find(x=>x.id===p?.facilityId),address=(p?.address||f?.address||'').trim();
  if(!p)others.push({a,reason:'一般予定'});else if(!address)others.push({a,reason:'住所が未登録'});else visits.push({id:a.id,address,start:toMinutes(a.startsAt),end:toMinutes(a.endsAt)});
 }
 return {visits,others};
}

// 区間ごとにルートを計算する。並べ替えの途中で何度も呼ばないよう、delay だけ待ってから1回呼ぶ。
function useRoutes(api:Api,segments:string[][],avoidHighways:boolean,enabled:boolean,delay=0){
 const key=JSON.stringify([segments,avoidHighways]);
 const [state,S]=useState<{key:string;results:RouteResult[];error:string;loading:boolean}>({key:'',results:[],error:'',loading:false});
 useEffect(()=>{
  if(!enabled||!segments.length){S({key,results:[],error:'',loading:false});return;}
  let live=true;S(s=>({...s,loading:true,error:''}));
  const timer=setTimeout(async()=>{try{const results=await Promise.all(segments.map(ids=>api('routes','POST',{appointmentIds:ids,avoidHighways}) as Promise<RouteResult>));if(live)S({key,results,error:'',loading:false});}catch(e){if(live)S(s=>({...s,error:(e as Error).message,loading:false}));}},delay);
  return()=>{live=false;clearTimeout(timer);};
 },[key,enabled]);
 return {...state,current:state.key===key};
}

function Options({mode,onMode,highway,onHighway}:{mode?:HalfMode;onMode?:(m:HalfMode)=>void;highway:boolean;onHighway:(v:boolean)=>void}){
 return <div className="route-options">{mode&&onMode&&<div className="route-option"><span>ルート表示</span><div className="segmented">{([['day','1日'],['both','午前 / 午後'],['am','午前'],['pm','午後']] as const).map(([k,l])=><button type="button" key={k} className={mode===k?'active':''} aria-pressed={mode===k} onClick={()=>onMode(k)}>{l}</button>)}</div></div>}
  <div className="route-option"><span>高速道路を</span><div className="segmented">{([[true,'使う'],[false,'使わない']] as const).map(([k,l])=><button type="button" key={l} className={highway===k?'active':''} aria-pressed={highway===k} onClick={()=>onHighway(k)}>{l}</button>)}</div></div></div>;
}

function LegRow({leg,from,to,short}:{leg?:Leg;from:string;to:string;short?:boolean}){
 return <li className="route-leg"><span className="route-minutes">{leg?`${leg.minutes}分`:'…'}</span><a className="route-nav" href={navUrl(from,to)} target="_blank" rel="noopener noreferrer">ナビ</a>{short&&<strong className="route-short">移動時間が不足しています</strong>}</li>;
}

function useNames(masters:Masters){
 const patientOf=(id:string,items:Appointment[])=>masters.patients.find(p=>p.id===items.find(a=>a.id===id)?.patientId);
 const facilityName=(stop:Stop,items:Appointment[])=>{const p=patientOf(stop.visits[0].id,items),f=masters.facilities.find(x=>x.id===p?.facilityId);return f&&(!p?.address||stop.visits.length>1)?f.name:'';};
 return {patientOf,facilityName};
}

export function RouteView({heading,staffLabel,items,masters,settings,api,onBack,onEdit}:Props&{onEdit:()=>void}){
 const [mode,MD]=useState<HalfMode>('both'),[highway,H]=useState(false);
 const {visits,others}=visitsOf(items,masters),segments=splitHalf(visits,mode),byId=new Map(visits.map(v=>[v.id,v]));
 const route=useRoutes(api,segments.map(s=>s.map(v=>v.id)),!highway,!!settings.officeAddress);
 const {patientOf,facilityName}=useNames(masters);
 const views=segments.map((seg,i)=>{const r=route.current?route.results[i]:undefined;if(!r)return {seg,r:undefined,stops:groupStops(seg),t:undefined};const stops=r.stops.map(s=>({address:s.address,visits:s.ids.map(id=>byId.get(id)!)}));return {seg,r,stops,t:timeline(stops,r.legs)};});
 const done=views.every(v=>v.t)&&views.length>0,total=views.reduce((n,v)=>({minutes:n.minutes+(v.t?.totalMinutes??0),meters:n.meters+(v.t?.totalMeters??0)}),{minutes:0,meters:0});
 return <main className="route-page">
  <div className="route-toolbar"><button className="text-button back" onClick={onBack}>‹ カレンダーに戻る</button><span className="spacer"/><button onClick={()=>print()}>印刷する</button><button className="primary" onClick={onEdit} disabled={!visits.length}>ルートを一括変更する</button></div>
  <h1 className="route-title">{heading}のルート{done&&<span className="route-total">（合計時間：{total.minutes}分 / 合計距離：{formatKm(total.meters)}）</span>}</h1>
  <p className="route-staff">{staffLabel}</p>
  <Options mode={mode} onMode={MD} highway={highway} onHighway={H}/>
  {!settings.officeAddress&&<p className="notice-inline">事業所の住所が未登録です。管理者がスタッフ管理の「事業所」で登録すると、ルートを計算できます。</p>}
  {route.error&&<p className="error" role="alert">{route.error}</p>}
  {!visits.length&&<p className="empty-route">住所のある訪問予定がありません。</p>}
  {views.map(({seg,r,stops,t},i)=><section className="route-segment" key={i}>
   <ol className="route-flow" aria-label={segments.length>1?(seg[0].start<720?'午前のルート':'午後のルート'):'ルート'}>
    <li className="route-point"><span className="route-flag">⚑</span>出発 <b>{t?clock(t.departure):'—'}</b></li>
    {stops.map((s,j)=><Fragment key={s.visits[0].id}><LegRow leg={r?.legs[j]} from={j?stops[j-1].address:settings.officeAddress} to={s.address} short={t?.short[j]}/>
     <li className="route-stop"><span className="route-no">{stopLabel(j)}</span><div>{facilityName(s,items)&&<strong className="route-facility">{facilityName(s,items)}</strong>}{s.visits.map(v=><div className="route-visit" key={v.id}><span>{clock(v.start)}-{clock(v.end)}</span>{patientOf(v.id,items)?.name}</div>)}</div></li></Fragment>)}
    <LegRow leg={r?.legs[stops.length]} from={stops.at(-1)!.address} to={settings.officeAddress}/>
    <li className="route-point"><span className="route-flag">●</span>到着 <b>{t?clock(t.arrival):'—'}</b></li>
   </ol>
   <div className="route-map">{r?.map?<img src={r.map} alt={`${heading}のルートの地図`}/>:<div className="route-map-empty">{route.loading?'ルートを計算中…':r?'地図を表示できませんでした':'地図はルートの計算後に表示されます'}</div>}</div>
  </section>)}
  {others.length>0&&<section className="route-others"><h3>ルートに含まれない予定</h3><ul>{others.map(({a,reason})=><li key={a.id}>{clock(toMinutes(a.startsAt))}-{clock(toMinutes(a.endsAt))} {masters.patients.find(p=>p.id===a.patientId)?.name??a.title}<small>（{reason}）</small></li>)}</ul></section>}
 </main>;
}

type Row=Visit&{version:number;fixed:boolean;orig:{start:number;end:number}};
export function RouteEditor({heading,staffLabel,items,masters,settings,api,revision,onBack,onSaved}:Props&{revision:number;onSaved:()=>Promise<void>}){
 const [{rows,removed},R]=useState(()=>{const {visits}=visitsOf(items,masters);return {rows:visits.map(v=>({...v,version:items.find(a=>a.id===v.id)!.version,fixed:false,orig:{start:v.start,end:v.end}})) as Row[],removed:[] as Row[]};});
 const [highway,H]=useState(false),[departure,DP]=useState(''),[error,E]=useState(''),[busy,B]=useState(false),[drag,DG]=useState<number|null>(null);
 const {others}=visitsOf(items,masters),ids=rows.map(r=>r.id);
 const route=useRoutes(api,ids.length?[ids]:[],!highway,!!settings.officeAddress,600);
 const stops=groupStops(rows),legs=route.current?route.results[0]?.legs:undefined,t=legs?timeline(stops,legs):undefined;
 const {patientOf,facilityName}=useNames(masters);
 // 最初の計算結果から出発時刻を入れる。あとは利用者が変えられる。
 useEffect(()=>{if(!departure&&t)DP(clock(Math.max(0,t.departure)));},[t?.departure]);
 const set=(next:Row[],gone=removed)=>{R({rows:next,removed:gone});E('');};
 const move=(from:number,to:number)=>{if(from===to||to<0||to>=rows.length)return;const next=[...rows];const [r]=next.splice(from,1);next.splice(to,0,r);set(next);};
 const update=(id:string,patch:Partial<Row>)=>set(rows.map(r=>r.id===id?{...r,...patch}:r));
 function adjust(){
  const dep=parseClock(departure);if(!legs||isNaN(dep)){E('出発時刻とルートの計算結果が必要です。');return;}
  const times=autoAdjust(stops,legs,dep,settings.marginMinutes,new Set(rows.filter(r=>r.fixed).map(r=>r.id)));
  if([...times.values()].some(x=>x.end>=24*60)){E('24時を過ぎる予定があります。出発時刻を見直してください。');return;}
  set(rows.map(r=>({...r,...times.get(r.id)})));
 }
 async function save(e:FormEvent){
  e.preventDefault();E('');
  const bad=rows.find(r=>isNaN(r.start)||isNaN(r.end)||r.end<=r.start);if(bad){E(`${patientOf(bad.id,items)?.name??''} の終了時刻は開始時刻より後にしてください。`);return;}
  if(rows.some((r,i)=>i>0&&r.start<rows[i-1].start)){E('並び順と時刻が合っていません。「時間を自動調整する」を押すか、時刻を直してください。');return;}
  const updates=rows.filter(r=>r.start!==r.orig.start||r.end!==r.orig.end).map(r=>({id:r.id,version:r.version,startTime:clock(r.start),endTime:clock(r.end)})),deletes=removed.map(r=>({id:r.id,version:r.version}));
  if(!updates.length&&!deletes.length){E('変更はありません。');return;}
  B(true);try{await api('appointments/batch-update','POST',{updates,deletes,revision});await onSaved();}catch(e){E((e as Error).message);}finally{B(false);}
 }
 let index=0;
 return <form className="route-page route-editor" onSubmit={save}>
  <div className="route-toolbar"><button type="button" className="text-button back" onClick={onBack}>‹ 保存せずに戻る</button><span className="spacer"/><button className="primary" disabled={busy}>{busy?'保存中…':'変更を保存する'}</button></div>
  <h1 className="route-title">{heading}のルート一括変更{t&&<span className="route-total">（合計時間：{t.totalMinutes}分 / 合計距離：{formatKm(t.totalMeters)}）</span>}</h1>
  <p className="route-staff">{staffLabel}</p>
  <Options highway={highway} onHighway={H}/>
  {!settings.officeAddress&&<p className="notice-inline">事業所の住所が未登録です。管理者がスタッフ管理の「事業所」で登録すると、ルートを計算できます。</p>}
  {route.error&&<p className="error" role="alert">{route.error}</p>}{error&&<p className="error" role="alert">{error}</p>}
  <section className="route-segment">
   <div className="route-flow route-edit-flow">
    <div className="route-point"><span className="route-flag">⚑</span>出発 <input aria-label="出発時刻" type="time" step={60} value={departure} onChange={e=>DP(e.target.value)}/><button type="button" onClick={adjust} disabled={!legs||!rows.length}>時間を自動調整する</button></div>
    <p className="hint">≡ をドラッグするか ↑↓ で訪問順を入れ替え、「時間を自動調整する」で移動時間{settings.marginMinutes?`と余白${settings.marginMinutes}分`:''}をもとに時刻を詰め直します。「変更を保存する」まで保存されません。</p>
    {stops.map((s,j)=><Fragment key={s.visits[0].id}><ol className="route-flow-legs"><LegRow leg={legs?.[j]} from={j?stops[j-1].address:settings.officeAddress} to={s.address} short={t?.short[j]}/></ol>
     <div className="route-stop editable"><span className="route-no">{stopLabel(j)}</span><div>{facilityName(s,items)&&<strong className="route-facility">{facilityName(s,items)}</strong>}
      {s.visits.map(v=>{const i=index++,r=rows[i];return <div key={r.id} className={'route-edit-row'+(drag===i?' dragging':'')} draggable onDragStart={e=>{DG(i);e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>DG(null)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(drag!==null)move(drag,i);DG(null);}}>
       <span className="drag-handle" aria-hidden="true">≡</span>
       <div className="route-edit-main"><div className="route-edit-name"><strong>{patientOf(r.id,items)?.name}</strong><span className="move-buttons"><button type="button" aria-label="上へ" disabled={i===0} onClick={()=>move(i,i-1)}>↑</button><button type="button" aria-label="下へ" disabled={i===rows.length-1} onClick={()=>move(i,i+1)}>↓</button><button type="button" className="danger" aria-label="この予定を削除" onClick={()=>set(rows.filter(x=>x.id!==r.id),[...removed,r])}>🗑</button></span></div>
        <div className="route-times"><input aria-label="開始時刻" type="time" step={300} value={clock(r.start)} onChange={e=>update(r.id,{start:parseClock(e.target.value)})}/><span>〜</span><input aria-label="終了時刻" type="time" step={300} value={clock(r.end)} onChange={e=>update(r.id,{end:parseClock(e.target.value)})}/></div>
        <label className="check"><input type="checkbox" checked={r.fixed} onChange={e=>update(r.id,{fixed:e.target.checked})}/>時間の自動調整の対象外</label></div></div>;})}
     </div></div></Fragment>)}
    {rows.length>0&&<ol className="route-flow-legs"><LegRow leg={legs?.[stops.length]} from={stops.at(-1)!.address} to={settings.officeAddress}/></ol>}
    <div className="route-point"><span className="route-flag">●</span>到着 <b>{t?clock(t.arrival):'—'}</b></div>
   </div>
   <div className="route-map">{route.current&&route.results[0]?.map?<img src={route.results[0].map} alt={`${heading}のルートの地図`}/>:<div className="route-map-empty">{route.loading||!route.current?'ルートを計算中…':'地図を表示できませんでした'}</div>}</div>
  </section>
  {removed.length>0&&<section className="route-others"><h3>削除する予定（保存時に削除）</h3><ul>{removed.map(r=><li key={r.id}>{clock(r.orig.start)}-{clock(r.orig.end)} {patientOf(r.id,items)?.name}{items.find(a=>a.id===r.id)?.seriesId&&<small>（繰り返しのこの回のみ）</small>}<button type="button" className="text-button" onClick={()=>set([...rows,{...r,start:r.orig.start,end:r.orig.end}].sort((a,b)=>a.start-b.start),removed.filter(x=>x.id!==r.id))}>元に戻す</button></li>)}</ul></section>}
  {others.length>0&&<section className="route-others"><h3>ここでは変更しない予定</h3><ul>{others.map(({a,reason})=><li key={a.id}>{clock(toMinutes(a.startsAt))}-{clock(toMinutes(a.endsAt))} {masters.patients.find(p=>p.id===a.patientId)?.name??a.title}<small>（{reason}）</small></li>)}</ul></section>}
 </form>;
}

export function OfficeSettings({settings,api,revision,onSaved}:{settings:Settings;api:Api;revision:number;onSaved:()=>Promise<void>}){
 const [v,V]=useState(settings),[busy,B]=useState(false),[error,E]=useState('');
 useEffect(()=>V(settings),[settings.version]);
 return <form className="office-settings" onSubmit={async e=>{e.preventDefault();B(true);E('');try{await api('settings','PATCH',{officeName:v.officeName,officeAddress:v.officeAddress,marginMinutes:Number(v.marginMinutes),version:settings.version,revision});await onSaved();}catch(e){E((e as Error).message);}finally{B(false);}}}>
  <div className="section-title"><h3>事業所（訪問ルートの出発・到着地）</h3></div>{error&&<p className="error" role="alert">{error}</p>}
  <div className="office-grid"><Field label="事業所名"><input value={v.officeName} maxLength={200} onChange={e=>V({...v,officeName:e.target.value})}/></Field><Field label="住所"><input value={v.officeAddress} maxLength={500} placeholder="例: 北海道夕張郡栗山町…" onChange={e=>V({...v,officeAddress:e.target.value})}/></Field><Field label="予定間の余白（分）"><input type="number" min={0} max={60} value={v.marginMinutes} onChange={e=>V({...v,marginMinutes:Number(e.target.value)})}/></Field><button className="primary" disabled={busy}>{busy?'保存中…':'保存する'}</button></div>
  <p className="hint">ルートの計算のため、この住所と患者・施設の住所（氏名は送りません）を Google マップに送ります。余白は「時間を自動調整する」で訪問と訪問のあいだに足す時間です。</p>
 </form>;
}

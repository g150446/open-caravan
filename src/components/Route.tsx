// CrossLog の「ルート」と「ルートを一括変更する」にあたる画面。列（担当＋同行の組み合わせ）の1日分の訪問を扱う。
// Google のキーがあれば道路のルート、なければ町丁目の位置と直線距離からの見積もりで動く。
import {Fragment,useEffect,useState,type FormEvent} from 'react';
import type {Api,Appointment,Masters,RouteResult,Settings} from '../models';
import {autoAdjust,clock,estimateLeg,formatKm,groupStops,navUrl,nearestOrder,parseLocation,splitHalf,stopLabel,timeline,toMinutes,type HalfMode,type Leg,type Point,type Stop,type Visit} from '../lib/route';
import {townName} from '../lib/address';
import {locate} from '../lib/geocode';
import {Field} from './Forms';

interface Props {heading:string;staffLabel:string;items:Appointment[];masters:Masters;settings:Settings;api:Api;onBack:()=>void;}
const parseClock=(v:string)=>/^\d{2}:\d{2}$/.test(v)?Number(v.slice(0,2))*60+Number(v.slice(3)):NaN;
const estimateMode=(s:Settings)=>s.routeMode==='estimate';

// 患者の住所（なければ施設の住所）がある訪問だけを経路に入れる。一般予定と住所のない予定は別に並べる。
// 手入力の地図の位置は、住所を使った側（患者か施設）のものを使う。
function visitsOf(items:Appointment[],masters:Masters){
 const visits:Visit[]=[],others:{a:Appointment;reason:string}[]=[],manual=new Map<string,Point>();
 for(const a of [...items].sort((x,y)=>x.startsAt.localeCompare(y.startsAt))){
  const p=masters.patients.find(x=>x.id===a.patientId),f=masters.facilities.find(x=>x.id===p?.facilityId),address=(p?.address||f?.address||'').trim();
  if(!p)others.push({a,reason:'一般予定'});else if(!address)others.push({a,reason:'住所が未登録'});
  else{visits.push({id:a.id,address,start:toMinutes(a.startsAt),end:toMinutes(a.endsAt)});const point=parseLocation((p.address?p.location:f?.location)??'');if(point)manual.set(a.id,point);}
 }
 return {visits,others,manual};
}

// キーがないときは、ブラウザの中で位置を求めて直線距離から見積もる。
async function estimateRoute(api:Api,items:Appointment[],masters:Masters,settings:Settings,ids:string[]):Promise<RouteResult>{
 const {visits,manual}=visitsOf(items,masters),byId=new Map(visits.map(v=>[v.id,v])),chosen=ids.map(id=>byId.get(id)!).filter(Boolean);
 const found=await locate(api,[settings.officeAddress,...chosen.filter(v=>!manual.has(v.id)).map(v=>v.address)]);
 const office=parseLocation(settings.officeLocation)??found.get(settings.officeAddress)??null;
 if(!office)throw new Error('事業所の位置が分かりません。基本設定の「事業所」で位置（緯度, 経度）を入力してください。');
 const at=(v:Visit)=>manual.get(v.id)??found.get(v.address)??null,located=chosen.filter(v=>at(v)),stops=groupStops(located),points=[office,...stops.map(s=>at(s.visits[0])!)];
 const legs=points.map((p,i)=>estimateLeg(p,points[i+1]??office,settings)).slice(0,stops.length+1);
 return {stops:stops.map(s=>({ids:s.visits.map(v=>v.id),address:s.address})),legs,skipped:[],map:null,points,estimated:true,unlocated:chosen.filter(v=>!at(v)).map(v=>v.id)};
}

// 区間ごとにルートを計算する。並べ替えの途中で何度も呼ばないよう、delay だけ待ってから1回呼ぶ。
function useRoutes(compute:(ids:string[])=>Promise<RouteResult>,segments:string[][],avoidHighways:boolean,enabled:boolean,delay=0){
 const key=JSON.stringify([segments,avoidHighways]);
 const [state,S]=useState<{key:string;results:RouteResult[];error:string;loading:boolean}>({key:'',results:[],error:'',loading:false});
 useEffect(()=>{
  if(!enabled||!segments.length){S({key,results:[],error:'',loading:false});return;}
  let live=true;S(s=>({...s,loading:true,error:''}));
  const timer=setTimeout(async()=>{try{const results=await Promise.all(segments.map(compute));if(live)S({key,results,error:'',loading:false});}catch(e){if(live)S(s=>({...s,error:(e as Error).message,loading:false}));}},delay);
  return()=>{live=false;clearTimeout(timer);};
 },[key,enabled]);
 return {...state,current:state.key===key};
}
const computer=(api:Api,items:Appointment[],masters:Masters,settings:Settings,avoidHighways:boolean)=>(ids:string[])=>estimateMode(settings)?estimateRoute(api,items,masters,settings,ids):api('routes','POST',{appointmentIds:ids,avoidHighways}) as Promise<RouteResult>;

function Options({mode,onMode,highway,onHighway,estimate}:{mode?:HalfMode;onMode?:(m:HalfMode)=>void;highway:boolean;onHighway:(v:boolean)=>void;estimate:boolean}){
 return <div className="route-options">{mode&&onMode&&<div className="route-option"><span>ルート表示</span><div className="segmented">{([['day','1日'],['both','午前 / 午後'],['am','午前'],['pm','午後']] as const).map(([k,l])=><button type="button" key={k} className={mode===k?'active':''} aria-pressed={mode===k} onClick={()=>onMode(k)}>{l}</button>)}</div></div>}
  {estimate?<p className="route-estimate-note">移動時間と距離は、町丁目・字の位置と直線距離からの見積もりです（回り道の係数と平均時速は事業所設定）。</p>:<div className="route-option"><span>高速道路を</span><div className="segmented">{([[true,'使う'],[false,'使わない']] as const).map(([k,l])=><button type="button" key={l} className={highway===k?'active':''} aria-pressed={highway===k} onClick={()=>onHighway(k)}>{l}</button>)}</div></div>}</div>;
}

function LegRow({leg,from,to,short,estimated}:{leg?:Leg;from:string;to:string;short?:boolean;estimated?:boolean}){
 return <li className="route-leg"><span className="route-minutes">{leg?`${estimated?'約':''}${leg.minutes}分`:'…'}</span><a className="route-nav" href={navUrl(from,to)} target="_blank" rel="noopener noreferrer">ナビ</a>{short&&<strong className="route-short">移動時間が不足しています</strong>}</li>;
}

function useNames(masters:Masters){
 const patientOf=(id:string,items:Appointment[])=>masters.patients.find(p=>p.id===items.find(a=>a.id===id)?.patientId);
 const facilityName=(stop:Stop,items:Appointment[])=>{const p=patientOf(stop.visits[0].id,items),f=masters.facilities.find(x=>x.id===p?.facilityId);return f&&(!p?.address||stop.visits.length>1)?f.name:'';};
 return {patientOf,facilityName};
}

// 同じ町名が続く訪問先は同じ色にして、地域のまとまりを見せる。
const palette=['#1f6feb','#d9822b','#2e9d6a','#9b59b6','#c0392b','#16a2b8','#7f8c2d'];
function townColors(stops:Stop[]){const towns=new Map<string,string>();for(const s of stops){const t=townName(s.address)||'—';if(!towns.has(t))towns.set(t,palette[towns.size%palette.length]);}return (s:Stop)=>({town:townName(s.address),color:towns.get(townName(s.address)||'—')!});}
function Town({stop,color}:{stop:Stop;color:(s:Stop)=>{town:string;color:string}}){const c=color(stop);return c.town?<span className="route-town" style={{borderColor:c.color,color:c.color}}>{c.town}</span>:null;}

// 外部の地図を使わない簡易図。位置は町丁目の代表点なので、道路ではなく直線で結ぶ。
function RouteSketch({points,stops,color,title}:{points:(Point|null)[];stops:Stop[];color:(s:Stop)=>{town:string;color:string};title:string}){
 const W=640,H=400,pad=40,known=points.filter((p):p is Point=>!!p);if(known.length<2)return <div className="route-map-empty">位置が分かる訪問先がありません</div>;
 const mid=known.reduce((n,p)=>n+p.lat,0)/known.length*Math.PI/180,xs=known.map(p=>p.lng*Math.cos(mid)),ys=known.map(p=>-p.lat);
 const [x0,x1,y0,y1]=[Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)],k=Math.min((W-2*pad)/Math.max(x1-x0,1e-4),(H-2*pad)/Math.max(y1-y0,1e-4));
 const seen=new Map<string,number>();
 const xy=(p:Point)=>{const id=p.lat.toFixed(5)+','+p.lng.toFixed(5),n=seen.get(id)??0;seen.set(id,n+1);const a=n*2.1;return [pad+(p.lng*Math.cos(mid)-x0)*k+(n?Math.cos(a)*14:0)+((W-2*pad)-(x1-x0)*k)/2,pad+(-p.lat-y0)*k+(n?Math.sin(a)*14:0)+((H-2*pad)-(y1-y0)*k)/2] as const;};
 const placed=points.map(p=>p?xy(p):null),path=[...placed,placed[0]].filter(Boolean).map(p=>p!.join(',')).join(' ');
 return <figure className="route-sketch"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}><rect width={W} height={H} fill="#eef3f1"/><polyline points={path} fill="none" stroke="#1f6feb" strokeWidth="3" strokeDasharray="7 5" opacity=".7"/>
  {placed.map((p,i)=>p&&(i===0?<g key="office"><rect x={p[0]-11} y={p[1]-11} width="22" height="22" rx="4" fill="#15877f"/><text x={p[0]} y={p[1]+5} textAnchor="middle" fontSize="13" fill="#fff" fontWeight="700">S</text></g>
   :<g key={i}><circle cx={p[0]} cy={p[1]} r="12" fill={color(stops[i-1]).color}/><text x={p[0]} y={p[1]+4.5} textAnchor="middle" fontSize="12" fill="#fff" fontWeight="700">{stopLabel(i-1)}</text><text x={p[0]+15} y={p[1]-9} fontSize="11" fill="#40585c">{color(stops[i-1]).town}</text></g>))}
 </svg><figcaption>直線で結んだ簡易図（道路ではありません）。位置: アドレス・ベース・レジストリ（デジタル庁）を加工した Geolonia 住所データ（CC BY 4.0）</figcaption></figure>;
}

function MapArea({r,stops,color,loading,heading,office}:{r?:RouteResult;stops:Stop[];color:(s:Stop)=>{town:string;color:string};loading:boolean;heading:string;office:string}){
 const all=stops.length&&stops.length<=9?<a className="route-all" href={navUrl(office,office,stops.map(s=>s.address))} target="_blank" rel="noopener noreferrer">↗ このルートを Google マップで開く</a>:null;
 return <div className="route-map">{r?.map?<img src={r.map} alt={`${heading}のルートの地図`}/>:r?.points?<RouteSketch points={r.points} stops={stops} color={color} title={`${heading}のルートの簡易図`}/>:<div className="route-map-empty">{loading?'ルートを計算中…':r?'地図を表示できませんでした':'地図はルートの計算後に表示されます'}</div>}{all}</div>;
}

export function RouteView({heading,staffLabel,items,masters,settings,api,onBack,onEdit}:Props&{onEdit:()=>void}){
 const [mode,MD]=useState<HalfMode>('both'),[highway,H]=useState(false),estimate=estimateMode(settings);
 const {visits,others}=visitsOf(items,masters),segments=splitHalf(visits,mode),byId=new Map(visits.map(v=>[v.id,v]));
 const route=useRoutes(computer(api,items,masters,settings,!highway),segments.map(s=>s.map(v=>v.id)),!highway,!!settings.officeAddress);
 const {patientOf,facilityName}=useNames(masters);
 const views=segments.map((seg,i)=>{const r=route.current?route.results[i]:undefined;if(!r)return {seg,r:undefined,stops:groupStops(seg),t:undefined};const stops=r.stops.map(s=>({address:s.address,visits:s.ids.map(id=>byId.get(id)!)}));return {seg,r,stops,t:stops.length?timeline(stops,r.legs):undefined};});
 const done=views.length>0&&views.every(v=>v.t),total=views.reduce((n,v)=>({minutes:n.minutes+(v.t?.totalMinutes??0),meters:n.meters+(v.t?.totalMeters??0)}),{minutes:0,meters:0});
 const unlocated=views.flatMap(v=>v.r?.unlocated??[]).map(id=>({a:items.find(a=>a.id===id)!,reason:'位置が分からない（患者・施設情報で地図の位置を入力）'}));
 return <main className="route-page">
  <div className="route-toolbar"><button className="text-button back" onClick={onBack}>‹ カレンダーに戻る</button><span className="spacer"/><button onClick={()=>print()}>印刷する</button><button className="primary" onClick={onEdit} disabled={!visits.length}>ルートを一括変更する</button></div>
  <h1 className="route-title">{heading}のルート{done&&<span className="route-total">（合計時間：{estimate?'約':''}{total.minutes}分 / 合計距離：{estimate?'約':''}{formatKm(total.meters)}）</span>}</h1>
  <p className="route-staff">{staffLabel}</p>
  <Options mode={mode} onMode={MD} highway={highway} onHighway={H} estimate={estimate}/>
  {!settings.officeAddress&&<p className="notice-inline">事業所の住所が未登録です。管理者が基本設定の「事業所」で登録すると、ルートを計算できます。</p>}
  {route.error&&<p className="error" role="alert">{route.error}</p>}
  {!visits.length&&<p className="empty-route">住所のある訪問予定がありません。</p>}
  {views.map(({seg,r,stops,t},i)=>{const color=townColors(stops);return <section className="route-segment" key={i}>
   <ol className="route-flow" aria-label={segments.length>1?(seg[0].start<720?'午前のルート':'午後のルート'):'ルート'}>
    <li className="route-point"><span className="route-flag">⚑</span>出発 <b>{t?clock(t.departure):'—'}</b></li>
    {stops.map((s,j)=><Fragment key={s.visits[0].id}><LegRow leg={r?.legs[j]} from={j?stops[j-1].address:settings.officeAddress} to={s.address} short={t?.short[j]} estimated={r?.estimated}/>
     <li className="route-stop" style={{borderLeftColor:color(s).color}}><span className="route-no" style={{background:color(s).color}}>{stopLabel(j)}</span><div><Town stop={s} color={color}/>{facilityName(s,items)&&<strong className="route-facility">{facilityName(s,items)}</strong>}{s.visits.map(v=><div className="route-visit" key={v.id}><span>{clock(v.start)}-{clock(v.end)}</span>{patientOf(v.id,items)?.name}</div>)}</div></li></Fragment>)}
    {stops.length>0&&<LegRow leg={r?.legs[stops.length]} from={stops.at(-1)!.address} to={settings.officeAddress} estimated={r?.estimated}/>}
    <li className="route-point"><span className="route-flag">●</span>到着 <b>{t?clock(t.arrival):'—'}</b></li>
   </ol>
   <MapArea r={r} stops={stops} color={color} loading={route.loading} heading={heading} office={settings.officeAddress}/>
  </section>;})}
  {others.length+unlocated.length>0&&<section className="route-others"><h3>ルートに含まれない予定</h3><ul>{[...unlocated,...others].map(({a,reason})=><li key={a.id}>{clock(toMinutes(a.startsAt))}-{clock(toMinutes(a.endsAt))} {masters.patients.find(p=>p.id===a.patientId)?.name??a.title}<small>（{reason}）</small></li>)}</ul></section>}
 </main>;
}

type Row=Visit&{version:number;fixed:boolean;orig:{start:number;end:number}};
export function RouteEditor({heading,staffLabel,items,masters,settings,api,revision,onBack,onSaved}:Props&{revision:number;onSaved:()=>Promise<void>}){
 const [{rows,removed,stuck},R]=useState(()=>{const {visits}=visitsOf(items,masters);return {rows:visits.map(v=>({...v,version:items.find(a=>a.id===v.id)!.version,fixed:false,orig:{start:v.start,end:v.end}})) as Row[],removed:[] as Row[],stuck:[] as Row[]};});
 const [highway,H]=useState(false),[departure,DP]=useState(''),[error,E]=useState(''),[info,I]=useState(''),[busy,B]=useState(false),[drag,DG]=useState<number|null>(null),estimate=estimateMode(settings);
 const {others}=visitsOf(items,masters),ids=rows.map(r=>r.id);
 const route=useRoutes(computer(api,items,masters,settings,!highway),ids.length?[ids]:[],!highway,!!settings.officeAddress,600);
 const result=route.current?route.results[0]:undefined,stops=groupStops(rows),legs=result&&result.stops.length===stops.length?result.legs:undefined,t=legs&&stops.length?timeline(stops,legs):undefined;
 const {patientOf,facilityName}=useNames(masters),color=townColors(stops);
 // 位置が分からない訪問は並べ替えの対象から外す（時刻はそのまま残る）。
 useEffect(()=>{const lost=new Set(result?.unlocated??[]);if(lost.size)R(s=>({...s,rows:s.rows.filter(r=>!lost.has(r.id)),stuck:[...s.stuck,...s.rows.filter(r=>lost.has(r.id))]}));},[result]);
 // 最初の計算結果から出発時刻を入れる。あとは利用者が変えられる。
 useEffect(()=>{if(!departure&&t)DP(clock(Math.max(0,t.departure)));},[t?.departure]);
 const set=(next:Row[],gone=removed)=>{R({rows:next,removed:gone,stuck});E('');I('');};
 const move=(from:number,to:number)=>{if(from===to||to<0||to>=rows.length)return;const next=[...rows];const [r]=next.splice(from,1);next.splice(to,0,r);set(next);};
 const update=(id:string,patch:Partial<Row>)=>set(rows.map(r=>r.id===id?{...r,...patch}:r));
 // 計算結果の位置（先頭は事業所）を、訪問先の住所ごとに引けるようにする。
 const where=new Map<string,Point>();result?.stops.forEach((s,i)=>{const p=result.points?.[i+1];if(p)where.set(s.address,p);});const office=result?.points?.[0];
 const canSort=!!office&&stops.length>1&&stops.every(s=>where.has(s.address));
 function sortNearest(){
  if(!canSort||!office)return;const order=nearestOrder(office,stops.map(s=>where.get(s.address)!));
  set(order.flatMap(i=>stops[i].visits.map(v=>rows.find(r=>r.id===v.id)!)));I('近い順に並べました。「時間を自動調整する」で時刻を詰め直してください。');
 }
 function adjust(){
  const dep=parseClock(departure);if(!legs||isNaN(dep)){E('出発時刻とルートの計算結果が必要です。');return;}
  const times=autoAdjust(stops,legs,dep,settings.marginMinutes,new Set(rows.filter(r=>r.fixed).map(r=>r.id)));
  if([...times.values()].some(x=>x.end>=24*60)){E('24時を過ぎる予定があります。出発時刻を見直してください。');return;}
  set(rows.map(r=>({...r,...times.get(r.id)})));
 }
 async function save(e:FormEvent){
  e.preventDefault();E('');I('');
  const bad=rows.find(r=>isNaN(r.start)||isNaN(r.end)||r.end<=r.start);if(bad){E(`${patientOf(bad.id,items)?.name??''} の終了時刻は開始時刻より後にしてください。`);return;}
  if(rows.some((r,i)=>i>0&&r.start<rows[i-1].start)){E('並び順と時刻が合っていません。「時間を自動調整する」を押すか、時刻を直してください。');return;}
  const updates=rows.filter(r=>r.start!==r.orig.start||r.end!==r.orig.end).map(r=>({id:r.id,version:r.version,startTime:clock(r.start),endTime:clock(r.end)})),deletes=removed.map(r=>({id:r.id,version:r.version}));
  if(!updates.length&&!deletes.length){E('変更はありません。');return;}
  B(true);try{await api('appointments/batch-update','POST',{updates,deletes,revision});await onSaved();}catch(e){E((e as Error).message);}finally{B(false);}
 }
 let index=0;
 return <form className="route-page route-editor" onSubmit={save}>
  <div className="route-toolbar"><button type="button" className="text-button back" onClick={onBack}>‹ 保存せずに戻る</button><span className="spacer"/><button className="primary" disabled={busy}>{busy?'保存中…':'変更を保存する'}</button></div>
  <h1 className="route-title">{heading}のルート一括変更{t&&<span className="route-total">（合計時間：{estimate?'約':''}{t.totalMinutes}分 / 合計距離：{estimate?'約':''}{formatKm(t.totalMeters)}）</span>}</h1>
  <p className="route-staff">{staffLabel}</p>
  <Options highway={highway} onHighway={H} estimate={estimate}/>
  {!settings.officeAddress&&<p className="notice-inline">事業所の住所が未登録です。管理者が基本設定の「事業所」で登録すると、ルートを計算できます。</p>}
  {route.error&&<p className="error" role="alert">{route.error}</p>}{error&&<p className="error" role="alert">{error}</p>}{info&&<p className="notice-inline" role="status">{info}</p>}
  <section className="route-segment">
   <div className="route-flow route-edit-flow">
    <div className="route-point"><span className="route-flag">⚑</span>出発 <input aria-label="出発時刻" type="time" step={60} value={departure} onChange={e=>DP(e.target.value)}/><span className="route-actions"><button type="button" onClick={sortNearest} disabled={!canSort} title={canSort?'事業所から出て戻るまでが短くなる順に並べます':'ルートの計算後に使えます'}>近い順に並べる</button><button type="button" onClick={adjust} disabled={!legs||!rows.length}>時間を自動調整する</button></span></div>
    <p className="hint">≡ をドラッグするか ↑↓ で訪問順を入れ替えます。「近い順に並べる」は事業所から出て戻るまでの{estimate?'直線距離':'距離'}が短くなる順に並べ替え、「時間を自動調整する」は移動時間{settings.marginMinutes?`と余白${settings.marginMinutes}分`:''}をもとに時刻を詰め直します。「変更を保存する」まで保存されません。</p>
    {stops.map((s,j)=><Fragment key={s.visits[0].id}><ol className="route-flow-legs"><LegRow leg={legs?.[j]} from={j?stops[j-1].address:settings.officeAddress} to={s.address} short={t?.short[j]} estimated={result?.estimated}/></ol>
     <div className="route-stop editable" style={{borderLeftColor:color(s).color}}><span className="route-no" style={{background:color(s).color}}>{stopLabel(j)}</span><div><Town stop={s} color={color}/>{facilityName(s,items)&&<strong className="route-facility">{facilityName(s,items)}</strong>}
      {s.visits.map(v=>{const i=index++,r=rows[i];return <div key={r.id} className={'route-edit-row'+(drag===i?' dragging':'')} draggable onDragStart={e=>{DG(i);e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>DG(null)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(drag!==null)move(drag,i);DG(null);}}>
       <span className="drag-handle" aria-hidden="true">≡</span>
       <div className="route-edit-main"><div className="route-edit-name"><strong>{patientOf(r.id,items)?.name}</strong><span className="move-buttons"><button type="button" aria-label="上へ" disabled={i===0} onClick={()=>move(i,i-1)}>↑</button><button type="button" aria-label="下へ" disabled={i===rows.length-1} onClick={()=>move(i,i+1)}>↓</button><button type="button" className="danger" aria-label="この予定を削除" onClick={()=>set(rows.filter(x=>x.id!==r.id),[...removed,r])}>🗑</button></span></div>
        <div className="route-times"><input aria-label="開始時刻" type="time" step={300} value={clock(r.start)} onChange={e=>update(r.id,{start:parseClock(e.target.value)})}/><span>〜</span><input aria-label="終了時刻" type="time" step={300} value={clock(r.end)} onChange={e=>update(r.id,{end:parseClock(e.target.value)})}/></div>
        <label className="check"><input type="checkbox" checked={r.fixed} onChange={e=>update(r.id,{fixed:e.target.checked})}/>時間の自動調整の対象外</label></div></div>;})}
     </div></div></Fragment>)}
    {rows.length>0&&<ol className="route-flow-legs"><LegRow leg={legs?.[stops.length]} from={stops.at(-1)!.address} to={settings.officeAddress} estimated={result?.estimated}/></ol>}
    <div className="route-point"><span className="route-flag">●</span>到着 <b>{t?clock(t.arrival):'—'}</b></div>
   </div>
   <MapArea r={legs?result:undefined} stops={stops} color={color} loading={route.loading||!route.current} heading={heading} office={settings.officeAddress}/>
  </section>
  {removed.length>0&&<section className="route-others"><h3>削除する予定（保存時に削除）</h3><ul>{removed.map(r=><li key={r.id}>{clock(r.orig.start)}-{clock(r.orig.end)} {patientOf(r.id,items)?.name}{items.find(a=>a.id===r.id)?.seriesId&&<small>（繰り返しのこの回のみ）</small>}<button type="button" className="text-button" onClick={()=>set([...rows,{...r,start:r.orig.start,end:r.orig.end}].sort((a,b)=>a.start-b.start),removed.filter(x=>x.id!==r.id))}>元に戻す</button></li>)}</ul></section>}
  {others.length+stuck.length>0&&<section className="route-others"><h3>ここでは変更しない予定</h3><ul>{[...stuck.map(r=>({a:items.find(a=>a.id===r.id)!,reason:'位置が分からない（患者・施設情報で地図の位置を入力）'})),...others].map(({a,reason})=><li key={a.id}>{clock(toMinutes(a.startsAt))}-{clock(toMinutes(a.endsAt))} {masters.patients.find(p=>p.id===a.patientId)?.name??a.title}<small>（{reason}）</small></li>)}</ul></section>}
 </form>;
}

export function OfficeSettings({settings,api,revision,onSaved}:{settings:Settings;api:Api;revision:number;onSaved:()=>Promise<void>}){
 const [v,V]=useState(settings),[busy,B]=useState(false),[error,E]=useState(''),estimate=estimateMode(settings);
 useEffect(()=>V(settings),[settings.version]);
 return <form className="office-settings" onSubmit={async e=>{e.preventDefault();B(true);E('');try{await api('settings','PATCH',{officeName:v.officeName,officeAddress:v.officeAddress,marginMinutes:Number(v.marginMinutes),officeLocation:v.officeLocation,detourFactor:Number(v.detourFactor),speedKmh:Number(v.speedKmh),version:settings.version,revision});await onSaved();}catch(e){E((e as Error).message);}finally{B(false);}}}>
  <div className="section-title"><h3>事業所（訪問ルートの出発・到着地）</h3><span className="status">{estimate?'見積もり（Google のキーなし）':'Google マップ（キー設定済み）'}</span></div>{error&&<p className="error" role="alert">{error}</p>}
  <div className="office-grid"><Field label="事業所名"><input value={v.officeName} maxLength={200} onChange={e=>V({...v,officeName:e.target.value})}/></Field><Field label="住所"><input value={v.officeAddress} maxLength={500} placeholder="例: 北海道夕張郡栗山町…" onChange={e=>V({...v,officeAddress:e.target.value})}/></Field><Field label="予定間の余白（分）"><input type="number" min={0} max={60} value={v.marginMinutes} onChange={e=>V({...v,marginMinutes:Number(e.target.value)})}/></Field>
   {estimate&&<><Field label="地図の位置（任意）"><input value={v.officeLocation} maxLength={60} placeholder="43.0597, 141.7790" onChange={e=>V({...v,officeLocation:e.target.value})}/></Field><Field label="回り道の係数"><input type="number" min={1} max={3} step={0.1} value={v.detourFactor} onChange={e=>V({...v,detourFactor:Number(e.target.value)})}/></Field><Field label="平均時速（km）"><input type="number" min={5} max={100} value={v.speedKmh} onChange={e=>V({...v,speedKmh:Number(e.target.value)})}/></Field></>}
   <button className="primary" disabled={busy}>{busy?'保存中…':'保存する'}</button></div>
  <p className="hint">{estimate?'Google のキーがないため、住所データ（アドレス・ベース・レジストリ）から町丁目・字の代表点を求め、直線距離×回り道の係数÷平均時速で移動時間を見積もります。外部へ送るのは都道府県・市区町村の名前だけです。位置がずれる場合は「地図の位置」に、Google マップで右クリックしてコピーした「緯度, 経度」を貼り付けてください。':'ルートの計算のため、この住所と患者・施設の住所（氏名は送りません）を Google マップに送ります。'}余白は「時間を自動調整する」で訪問と訪問のあいだに足す時間です。</p>
 </form>;
}

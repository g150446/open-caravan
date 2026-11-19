import {useEffect,useRef,useState} from 'react';
import type {Api} from '../models';
import {createMonitorPlayer,type MonitorPlayer} from '../lib/monitorAudio';

type Call={id:string;caller:string;state:string;note:string;canTransfer:boolean;startedAt:number};
type Turn={at:string;role:string;text:string};
type Memo={at:string;kind:string;summary:string;name:string;callbackNumber:string};
type PastCall={id:string;startedAt:string|null;caller:string;utterances:number;preview:string;memo?:Memo|null};
type Transcript={id:string;turns:Turn[];memo?:Memo|null};
// 担当者の在席状態。在席中は AI が担当者へ転送し、離席中は折り返しの連絡先を聞いて電話を切る。
type Presence={status:'present'|'away';changedBy:string|null;changedAt:number|null;editable:boolean};
// AI 応答のオン/オフ。オフのときは AI は出ず、同時に鳴っている電話機（JD-AT96）で受ける。
type AiMode={mode:'on'|'off';changedBy:string|null;changedAt:number|null;editable:boolean};
const stateLabels:Record<string,string>={active:'AI が応答中',announcing:'AI が担当者への取り次ぎを案内中',transferring:'転送しています',ending:'AI が通話を終えています'};
const memoLabels:Record<string,string>={pharmacy_inquiry:'疑義照会',callback:'折り返し',transfer:'担当者へ転送',resolved:'AI が対応',other:'その他'};
const RENEW_MS=10*60*1000,RECONNECT_MS=3000,TICKET_RETRY_MS=15000,TICKET_REUSE_MS=30000,FAILURES_BEFORE_HINT=3;
const certificateHint='端末証明書が選択されていない可能性があります。Chrome を完全に終了して開き直し、証明書を選択してください（Android は Chrome を強制停止してから開き直します）。';

const clock=(at:string|number)=>new Date(at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
const dateTime=(at:string|null)=>at?new Date(at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'日時不明';

function Turns({turns,follow}:{turns:Turn[];follow?:boolean}){
 const box=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(follow&&box.current)box.current.scrollTop=box.current.scrollHeight;},[turns.length,follow]);
 return <div className="monitor-turns" ref={box}>{turns.map((t,i)=><p key={i} className={t.role==='USER'?'caller':'ai'}><small>{t.role==='USER'?'発信者':'AI'}・{clock(t.at)}</small>{t.text}</p>)}</div>;
}

function MemoView({memo}:{memo:Memo}){
 const urgent=memo.kind==='pharmacy_inquiry'||memo.kind==='callback';
 // 過去の会話のボタンの中に置くため、ブロック要素は使わない。
 return <span className={urgent?'monitor-memo urgent':'monitor-memo'}>
  <b>{memoLabels[memo.kind]??memo.kind}</b>
  {memo.summary&&<span>{memo.summary}</span>}
  {(memo.name||memo.callbackNumber)&&<span>{memo.name&&`お名前: ${memo.name}`}{memo.name&&memo.callbackNumber&&'・'}{memo.callbackNumber&&`連絡先: ${memo.callbackNumber}`}</span>}
 </span>;
}

export function MonitorView({api}:{api:Api}){
 const [connection,setConnection]=useState('接続中…'),[calls,setCalls]=useState<Call[]>([]),[targets,setTargets]=useState<string[]>([]),[listening,setListening]=useState<string|null>(null),[message,setMessage]=useState<{text:string;error?:boolean}|null>(null),[volume,setVolume]=useState(1),[live,setLive]=useState<Record<string,Turn[]>>({}),[past,setPast]=useState<PastCall[]>([]),[openId,setOpenId]=useState<string|null>(null),[transcript,setTranscript]=useState<Transcript|null>(null),[presence,setPresence]=useState<Presence|null>(null),[aiMode,setAiMode]=useState<AiMode|null>(null);
 const socket=useRef<WebSocket|null>(null),player=useRef<MonitorPlayer|null>(null),listeningId=useRef<string|null>(null),transferredId=useRef<string|null>(null),states=useRef(new Map<string,string>()),wakeLock=useRef<WakeLockSentinel|null>(null);
 const send=(msg:unknown)=>{if(socket.current?.readyState===WebSocket.OPEN)socket.current.send(JSON.stringify(msg));};

 async function updateWakeLock(){
  try{
   if(listeningId.current&&!wakeLock.current&&navigator.wakeLock&&document.visibilityState==='visible'){const lock=await navigator.wakeLock.request('screen');wakeLock.current=lock;lock.addEventListener('release',()=>{wakeLock.current=null;});}
   else if(!listeningId.current&&wakeLock.current)await wakeLock.current.release();
  }catch{/* 取得できない端末では画面の自動消灯に任せる */}
 }
 function changeListening(id:string|null){listeningId.current=id;setListening(id);player.current?.reset();void updateWakeLock();}

 function onCalls(next:Call[]){
  const ids=new Set(next.map(c=>c.id)),current=listeningId.current;
  if(current&&!ids.has(current)){
   const wasTransferring=states.current.get(current)==='transferring';
   setMessage({text:wasTransferring?'転送しました。モニタはここで終了します。転送先が応答しないときは AI に戻り、自動で再開します。':'通話が終了しました。'});
   transferredId.current=wasTransferring?current:null;changeListening(null);
  }
  states.current=new Map(next.map(c=>[c.id,c.state]));setCalls(next);setLive(prev=>Object.fromEntries(Object.entries(prev).filter(([id])=>ids.has(id))));
  if(transferredId.current&&ids.has(transferredId.current)){setMessage({text:'転送先が応答しなかったため、AI に戻りました。'});send({type:'listen',id:transferredId.current});transferredId.current=null;}
 }

 useEffect(()=>{
  let stopped=false,retry:ReturnType<typeof setTimeout>,renew:ReturnType<typeof setInterval>,failures=0;
  async function connect(){
   let ticket:{ticket:string;url:string};
   try{
    ticket=await api('monitor/ticket','POST',{});
    if(stopped)return;
    // Chrome は WebSocket では端末証明書の選択画面を出さない。先に通常のリクエストを送り、選択画面を出す。
    const issuedAt=Date.now();
    await fetch(new URL('/',ticket.url.replace(/^wss:/,'https:')),{mode:'no-cors',credentials:'include',cache:'no-store'}).catch(()=>{});
    if(stopped)return;
    if(Date.now()-issuedAt>TICKET_REUSE_MS)ticket=await api('monitor/ticket','POST',{renew:true});
   }catch(e){if(!stopped){setConnection((e as Error).message);retry=setTimeout(connect,TICKET_RETRY_MS);}return;}
   if(stopped)return;
   const ws=new WebSocket(ticket.url);ws.binaryType='arraybuffer';socket.current=ws;
   ws.onopen=()=>{ws.send(JSON.stringify({type:'auth',ticket:ticket.ticket}));renew=setInterval(()=>{api('monitor/ticket','POST',{renew:true}).then(t=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'auth',ticket:t.ticket}));}).catch(()=>{});},RENEW_MS);};
   ws.onmessage=event=>{
    if(typeof event.data!=='string'){if(listeningId.current)player.current?.play(event.data as ArrayBuffer);return;}
    const msg=JSON.parse(event.data);
    if(msg.type==='hello'){failures=0;setConnection('接続済み');setTargets(msg.transferTargets);send({type:'transcripts'});}
    else if(msg.type==='calls')onCalls(msg.calls);
    else if(msg.type==='utterance')setLive(prev=>({...prev,[msg.id]:[...(prev[msg.id]??[]),{at:msg.at,role:msg.role,text:msg.text}]}));
    else if(msg.type==='utterances')setLive(prev=>({...prev,[msg.id]:msg.items}));
    else if(msg.type==='transcripts')setPast(msg.items);
    else if(msg.type==='transcripts-changed')send({type:'transcripts'});
    else if(msg.type==='transcript')setTranscript(msg.transcript);
    else if(msg.type==='aiMode')setAiMode({mode:msg.mode,changedBy:msg.changedBy??null,changedAt:msg.changedAt??null,editable:msg.editable===true});
    else if(msg.type==='presence')setPresence({status:msg.status,changedBy:msg.changedBy??null,changedAt:msg.changedAt??null,editable:msg.editable===true});
    else if(msg.type==='listening')changeListening(msg.id);
    else if(msg.type==='error')setMessage({text:msg.message,error:true});
   };
   ws.onclose=()=>{clearInterval(renew);changeListening(null);setPresence(null);setAiMode(null);if(!stopped){failures++;setConnection(failures>=FAILURES_BEFORE_HINT?certificateHint:'切断されました。再接続しています…');retry=setTimeout(connect,RECONNECT_MS);}};
  }
  void connect();
  document.addEventListener('visibilitychange',updateWakeLock);
  return ()=>{stopped=true;clearTimeout(retry);clearInterval(renew);document.removeEventListener('visibilitychange',updateWakeLock);socket.current?.close();listeningId.current=null;void wakeLock.current?.release();player.current?.close();player.current=null;};
 },[api]);

 async function listen(id:string){player.current??=createMonitorPlayer(volume);await player.current.resume();setMessage(null);send({type:'listen',id});}
 function togglePast(id:string){if(openId===id){setOpenId(null);return;}setOpenId(id);setTranscript(null);send({type:'transcript',id});}
 function transfer(call:Call,target:string){setMessage({text:`${target} への転送を指示しました。AI が一言案内してから転送します。`});send({type:'transfer',id:call.id,target});}

 return <div className="monitor">
  <div className="monitor-bar"><span className="hint" role="status">{connection}</span><label>音量 <input type="range" min="0" max="2" step="0.05" value={volume} onChange={e=>{const v=Number(e.target.value);setVolume(v);player.current?.setVolume(v);}}/></label></div>
  <div className="monitor-presence">
   <span>AI 応答</span>
   <div className="monitor-presence-toggle" role="group" aria-label="AI 応答のオン/オフ">{(['on','off'] as const).map(mode=><button key={mode} aria-pressed={aiMode?.mode===mode} className={aiMode?.mode===mode?'primary':''} disabled={!aiMode?.editable||aiMode.mode===mode} onClick={()=>send({type:'aiMode',mode})}>{mode==='on'?'オン':'オフ'}</button>)}</div>
   <small>{!aiMode?'AI 応答の設定を読み込んでいます…':aiMode.mode==='on'?'AI がすぐに電話に出ます。':'AI は出ません。今までどおり電話機（JD-AT96）で受けてください。'}{aiMode?.changedAt&&`（${dateTime(new Date(aiMode.changedAt).toISOString())} ${aiMode.changedBy??''}）`}</small>
  </div>
  <div className={aiMode?.mode==='off'?'monitor-presence inactive':'monitor-presence'}>
   <span>担当者</span>
   <div className="monitor-presence-toggle" role="group" aria-label="担当者の在席状態">{(['present','away'] as const).map(status=><button key={status} aria-pressed={presence?.status===status} className={presence?.status===status?'primary':''} disabled={!presence?.editable||presence.status===status} onClick={()=>send({type:'presence',status})}>{status==='present'?'在席':'離席'}</button>)}</div>
   <small>{!presence?'在席状態を読み込んでいます…':presence.status==='present'?'AI が判断した用件は担当者へ転送します。20 秒ほどで出なければ折り返しを受け付けます。':'AI は転送せず、名前と折り返し先を聞いて電話を切ります。'}{presence?.changedAt&&`（${dateTime(new Date(presence.changedAt).toISOString())} ${presence.changedBy??''}）`}</small>
  </div>
  {message&&<p className={message.error?'monitor-message error':'monitor-message'} role="status">{message.text}</p>}
  {calls.length===0?<p className="monitor-empty">進行中の通話はありません</p>:calls.map(call=><section className="monitor-call" key={call.id}>
   <div><strong>発信者 {call.caller||'不明'}</strong><small>{clock(call.startedAt)} 開始・{stateLabels[call.state]??call.state}{call.note&&`（${call.note}）`}</small></div>
   <div className="monitor-actions">{listening===call.id?<button onClick={()=>send({type:'stop'})}>聴取を停止</button>:<button className="primary" onClick={()=>void listen(call.id)}>聴く</button>}{targets.map(target=><button key={target} disabled={!call.canTransfer||call.state!=='active'} onClick={()=>transfer(call,target)}>{target} へ転送</button>)}</div>
   {(live[call.id]?.length??0)>0&&<Turns turns={live[call.id]} follow/>}
  </section>)}
  <h2 className="monitor-heading">過去の会話</h2>
  {past.length===0?<p className="monitor-empty">文字起こしはまだありません</p>:<ul className="monitor-past">{past.map(item=><li key={item.id}>
   <button aria-expanded={openId===item.id} onClick={()=>togglePast(item.id)}><strong>{dateTime(item.startedAt)}</strong><span>発信者 {item.caller||'不明'}・{item.utterances}発話</span>{item.memo?<MemoView memo={item.memo}/>:<small>{item.preview}</small>}</button>
   {openId===item.id&&(transcript?.id===item.id?<Turns turns={transcript.turns}/>:<p className="hint">読み込み中…</p>)}
  </li>)}</ul>}
 </div>;
}

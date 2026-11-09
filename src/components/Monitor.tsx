import {useEffect,useRef,useState} from 'react';
import type {Api} from '../models';
import {createMonitorPlayer,type MonitorPlayer} from '../lib/monitorAudio';

type Call={id:string;caller:string;state:string;note:string;canTransfer:boolean;startedAt:number};
const stateLabels:Record<string,string>={active:'AI が応答中',announcing:'AI が担当者への取り次ぎを案内中',transferring:'転送しています'};
const RENEW_MS=10*60*1000,RECONNECT_MS=3000,TICKET_RETRY_MS=15000,TICKET_REUSE_MS=30000,FAILURES_BEFORE_HINT=3;
const certificateHint='端末証明書が選択されていない可能性があります。Chrome を完全に終了して開き直し、証明書を選択してください（Android は Chrome を強制停止してから開き直します）。';

export function MonitorView({api}:{api:Api}){
 const [connection,setConnection]=useState('接続中…'),[calls,setCalls]=useState<Call[]>([]),[targets,setTargets]=useState<string[]>([]),[listening,setListening]=useState<string|null>(null),[message,setMessage]=useState<{text:string;error?:boolean}|null>(null),[volume,setVolume]=useState(1);
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
  states.current=new Map(next.map(c=>[c.id,c.state]));setCalls(next);
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
    if(msg.type==='hello'){failures=0;setConnection('接続済み');setTargets(msg.transferTargets);}
    else if(msg.type==='calls')onCalls(msg.calls);
    else if(msg.type==='listening')changeListening(msg.id);
    else if(msg.type==='error')setMessage({text:msg.message,error:true});
   };
   ws.onclose=()=>{clearInterval(renew);changeListening(null);if(!stopped){failures++;setConnection(failures>=FAILURES_BEFORE_HINT?certificateHint:'切断されました。再接続しています…');retry=setTimeout(connect,RECONNECT_MS);}};
  }
  void connect();
  document.addEventListener('visibilitychange',updateWakeLock);
  return ()=>{stopped=true;clearTimeout(retry);clearInterval(renew);document.removeEventListener('visibilitychange',updateWakeLock);socket.current?.close();listeningId.current=null;void wakeLock.current?.release();player.current?.close();player.current=null;};
 },[api]);

 async function listen(id:string){player.current??=createMonitorPlayer(volume);await player.current.resume();setMessage(null);send({type:'listen',id});}
 function transfer(call:Call,target:string){setMessage({text:`${target} への転送を指示しました。AI が一言案内してから転送します。`});send({type:'transfer',id:call.id,target});}

 return <div className="monitor">
  <div className="monitor-bar"><span className="hint" role="status">{connection}</span><label>音量 <input type="range" min="0" max="2" step="0.05" value={volume} onChange={e=>{const v=Number(e.target.value);setVolume(v);player.current?.setVolume(v);}}/></label></div>
  {message&&<p className={message.error?'monitor-message error':'monitor-message'} role="status">{message.text}</p>}
  {calls.length===0?<p className="monitor-empty">進行中の通話はありません</p>:calls.map(call=><section className="monitor-call" key={call.id}>
   <div><strong>発信者 {call.caller||'不明'}</strong><small>{new Date(call.startedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})} 開始・{stateLabels[call.state]??call.state}{call.note&&`（${call.note}）`}</small></div>
   <div className="monitor-actions">{listening===call.id?<button onClick={()=>send({type:'stop'})}>聴取を停止</button>:<button className="primary" onClick={()=>void listen(call.id)}>聴く</button>}{targets.map(target=><button key={target} disabled={!call.canTransfer||call.state!=='active'} onClick={()=>transfer(call,target)}>{target} へ転送</button>)}</div>
  </section>)}
 </div>;
}

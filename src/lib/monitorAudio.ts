// 会話モニタリングの音声再生。発信者と AI をそれぞれ独立に再生し、サーバーとの時計のずれは再生速度の微調整で吸収する。
const TARGET_BUFFER_S=0.2,MAX_BUFFER_S=0.8,BATCH_S=0.06,HEADER_BYTES=8;

function channelPlayer(audio:AudioContext,output:AudioNode){
 let pending:Int16Array[]=[],pendingSamples=0,nextTime=0;
 function flush(rate:number){
  const buffer=audio.createBuffer(1,pendingSamples,rate),data=buffer.getChannelData(0);let offset=0;
  for(const chunk of pending)for(let i=0;i<chunk.length;i++)data[offset++]=chunk[i]/32768;
  pending=[];pendingSamples=0;
  const now=audio.currentTime;let depth=nextTime-now;
  if(depth<0.02){nextTime=now+TARGET_BUFFER_S;depth=TARGET_BUFFER_S;}else if(depth>MAX_BUFFER_S)return;
  const speed=depth<TARGET_BUFFER_S-0.06?0.98:depth>TARGET_BUFFER_S+0.1?1.02:1,source=audio.createBufferSource();
  source.buffer=buffer;source.playbackRate.value=speed;source.connect(output);source.start(nextTime);nextTime+=buffer.duration/speed;
 }
 return {
  push(samples:Int16Array,rate:number){pending.push(samples);pendingSamples+=samples.length;if(pendingSamples>=rate*BATCH_S)flush(rate);},
  reset(){pending=[];pendingSamples=0;nextTime=0;},
 };
}

export type MonitorPlayer=ReturnType<typeof createMonitorPlayer>;

export function createMonitorPlayer(volume:number){
 const audio=new AudioContext(),master=audio.createGain();master.gain.value=volume;master.connect(audio.destination);
 const players=[channelPlayer(audio,master),channelPlayer(audio,master)];
 return {
  resume:()=>audio.resume(),
  setVolume(value:number){master.gain.value=value;},
  // 音声フレーム: [チャネル u8][予約 3B][サンプルレート u32le][PCM s16le ...]
  play(frame:ArrayBuffer){const view=new DataView(frame),player=players[view.getUint8(0)];if(player)player.push(new Int16Array(frame,HEADER_BYTES),view.getUint32(4,true));},
  reset(){for(const p of players)p.reset();},
  close(){void audio.close();},
 };
}

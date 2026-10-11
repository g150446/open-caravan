// Local-only visual QA fixture. Never included in the deployment bundle.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
const dir='dist/assets',js=readdirSync(dir).find(n=>n.endsWith('.js')),css=readdirSync(dir).find(n=>n.endsWith('.css'));
const mock=`const staff={id:'doctor',version:1,login:'qa',name:'テスト医師',profession:'医師',color:'#15877f',role:'ADMIN',active:true};
const facility={id:'facility',version:1,name:'サンプル施設',address:'東京都千代田区丸の内1丁目'};
const patient={id:'patient',version:1,number:'TEST001',name:'テスト患者 A',kana:'テストカンジャ',address:'東京都千代田区丸の内1丁目',movacalUrl:'https://demo.movacal.net/patients/TEST001',handover:'テスト用の申し送りです。',visitFrequency:'月2回',facilityId:null,active:true};
let revision=1; const appointments=[{id:'visit1',version:1,patientId:'patient',title:'',staffIds:['doctor'],memo:'訪問前に確認するテストメモ\\nこの予定だけに保存します。',startsAt:'2026-10-13T00:00:00.000Z',endsAt:'2026-10-13T00:30:00.000Z',seriesId:'series',occurrenceDate:'2026-10-13',exception:false,cancelled:false},{id:'visit2',version:1,patientId:'patient',title:'',staffIds:['doctor'],memo:'',startsAt:'2026-10-15T01:00:00.000Z',endsAt:'2026-10-15T01:30:00.000Z',seriesId:'series',occurrenceDate:'2026-10-15',exception:false,cancelled:false},{id:'general',version:1,patientId:null,title:'院内ミーティング（テスト）',staffIds:['doctor'],memo:'議題の確認',startsAt:'2026-10-14T03:00:00.000Z',endsAt:'2026-10-14T04:00:00.000Z',seriesId:null,occurrenceDate:null,exception:false,cancelled:false}];
window.fetch=async(url,options={})=>{const path=new URL(url,location.href).pathname.replace('/api/','');const method=options.method||'GET';const b=options.body?JSON.parse(options.body):{};let result={};
if(path==='auth/me')result={staff,csrf:'local-qa'};
else if(path==='bootstrap')result={revision,data:{staff:[staff],patients:[patient],facilities:[facility]}};
else if(path==='changes')result={revision};
else if(path==='appointments'&&method==='GET')result={revision,data:appointments.filter(a=>!a.cancelled)};
else if(path.startsWith('appointments/')&&method==='GET'){const a=appointments.find(a=>a.id===path.split('/')[1]);result={revision,data:{appointment:a,previous:appointments.filter(x=>x.patientId===a.patientId&&x.startsAt<a.startsAt),next:appointments.filter(x=>x.patientId===a.patientId&&x.startsAt>a.startsAt),series:{id:'series',version:1,startDate:'2026-10-13',endDate:'2026-12-31',rule:{kind:'weekly',interval:1,weekdays:[2,4],ordinals:[]}}}};}
else if(path.endsWith('/memo')){const a=appointments.find(a=>a.id===path.split('/')[1]);a.memo=b.memo;a.version++;result={ok:true,revision:++revision};}
else if(path.endsWith('/handover')){patient.handover=b.handover;patient.version++;result={ok:true,revision:++revision};}
else if(path==='audit')result=[];
else result={ok:true,revision:++revision};return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});};`;
writeFileSync('build/preview.html','<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOCAL QA — Open Caravan</title><style>'+readFileSync(dir+'/'+css,'utf8')+'</style><div id="root"></div><script>'+mock+'</script><script type="module">'+readFileSync(dir+'/'+js,'utf8').replaceAll('</script','<\\/script')+'</script></html>');

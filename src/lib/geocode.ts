// キーなしの見積もり用に、住所から町丁目・字の代表点を求める。
// 辞書は Worker が中継する町丁目までのもので、外へ出るのは都道府県・市区町村の名前だけ。求めた位置は D1 に保存してほかの端末でも使う。
import type {Api} from '../models';
import type {Point} from './route';

let known:Map<string,Point>|null=null;
let library:Promise<typeof import('@geolonia/normalize-japanese-addresses')>|null=null;

export async function locate(api:Api,addresses:string[]):Promise<Map<string,Point|null>>{
 if(!known){const r=await api('geocodes');known=new Map((r.geocodes as {address:string;lat:number;lng:number}[]).map(g=>[g.address,{lat:g.lat,lng:g.lng}]));}
 const cache=known,missing=[...new Set(addresses)].filter(a=>a&&!cache.has(a));
 if(missing.length){
  library??=import('@geolonia/normalize-japanese-addresses').then(m=>{m.config.japaneseAddressesApi=location.origin+'/api/geo/ja';return m;});
  const {normalize}=await library,found:{address:string;lat:number;lng:number;level:number}[]=[];
  for(const address of missing){
   try{const r=await normalize(address,{level:3});
    // 市区町村の代表点（level 2）では距離が大きくずれるので使わない。座標の手入力を促す。
    if(r.point&&r.point.level>=3){found.push({address,lat:r.point.lat,lng:r.point.lng,level:r.point.level});cache.set(address,{lat:r.point.lat,lng:r.point.lng});}
   }catch{/* 見つからない住所は位置なしとして扱う */}
  }
  if(found.length)await api('geocodes','POST',{items:found}).catch(()=>{});
 }
 return new Map(addresses.map(a=>[a,cache.get(a)??null]));
}

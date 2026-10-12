// ふりがなからログインIDを作る。ヘボン式（長音はそのまま: さとう → satou）で、姓と名の間の空白はハイフンにする。
const base:Record<string,string>={あ:'a',い:'i',う:'u',え:'e',お:'o',か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',さ:'sa',し:'shi',す:'su',せ:'se',そ:'so',ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to',だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',や:'ya',ゆ:'yu',よ:'yo',ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',わ:'wa',ゐ:'i',ゑ:'e',を:'o',ん:'n',ゔ:'vu',ぁ:'a',ぃ:'i',ぅ:'u',ぇ:'e',ぉ:'o'};
const small:Record<string,string>={ゃ:'a',ゅ:'u',ょ:'o'};
export function kanaToRomaji(kana:string){
 const s=kana.normalize('NFKC').replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
 let out='';
 for(let i=0;i<s.length;i++){
  const c=s[i];
  if(/\s/.test(c)){out+=' ';continue;}
  if(/[A-Za-z0-9]/.test(c)){out+=c.toLowerCase();continue;}
  if(c==='っ'){const next=base[s[i+1]]??'';out+=next.startsWith('ch')?'t':next[0]&&!'aiueo'.includes(next[0])?next[0]:'';continue;}
  let r=base[c];if(!r)continue;
  const y=small[s[i+1]];
  // きゃ → kya、しゃ → sha、ちゃ → cha、じゃ → ja
  if(y&&r.endsWith('i')&&r!=='i'){r=/(sh|ch|j)i$/.test(r)?r.slice(0,-1)+y:r.slice(0,-1)+'y'+y;i++;}
  out+=r;
 }
 return out.trim().split(/\s+/).filter(Boolean).join('-');
}
// 既存のIDと重ならないように末尾に1から番号を付ける（例: ihara-hiroto1）。
export function uniqueLogin(kana:string,taken:string[]){
 const stem=kanaToRomaji(kana);if(!stem)return '';
 const used=new Set(taken.map(t=>t.toLowerCase()));
 for(let n=1;;n++)if(!used.has(stem+n))return stem+n;
}

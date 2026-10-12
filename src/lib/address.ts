// 住所から予定カードに表示する町名を取り出す。区のある市は区、郡部は町村名、市部は市の後の町名。
export function townName(address:string){
 const all=address.replace(/\s/g,''),pref=all.match(/^(北海道|東京都|京都府|大阪府|.{2,3}県)/)?.[0]??'',s=all.slice(pref.length);
 const gun=s.match(/^[^市]+?郡(.+?[町村])/);if(gun)return gun[1];
 const ward=s.match(/^.+?市(?!市)(.+?区)/)??(pref==='東京都'?s.match(/^()(.+?区)/):null);if(ward)return ward[ward.length-1];
 const rest=s.replace(/^.+?市(?!市)/,'');
 return rest.match(/^[^\d０-９]+?[町村]/)?.[0]??rest.match(/^[^\d０-９丁番-]*/)?.[0]??'';
}

import {assert} from './errors';
import {organizationLabels, type OrganizationKind} from './organizations';
export const csvHeaders={patients:['患者番号','氏名','ふりがな','住所','施設名','モバカルURL','申し送り'],appointments:['患者番号','予定名','日付','開始時刻','終了時刻','担当者ID','予定メモ'],organizations:['種別','名称','カナ','住所','電話','FAX']};
export type ImportKind=keyof typeof csvHeaders;
export function isImportKind(value:string):value is ImportKind{return Object.hasOwn(csvHeaders,value);}
export function parseCsv(text:string){text=text.replace(/^\uFEFF/,'');const rows:string[][]=[],row:string[]=[];let value='',quoted=false,closed=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;}else if(c==='"'){assert(value===''&&!closed,400,'CSVの引用符が不正です。');quoted=true;}else if(c===','||c==='\n'||c==='\r'){row.push(value);value='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(x=>x!==''))rows.push([...row]);row.length=0;}}else{assert(!closed,400,'閉じ引用符の後に不正な文字があります。');value+=c;}}assert(!quoted,400,'CSVの引用符が閉じられていません。');if(value||row.length||closed){row.push(value);if(row.some(x=>x!==''))rows.push(row);}return rows;}
export function encodeCsv(rows:string[][]){return '\uFEFF'+rows.map(r=>r.map(x=>`"${x.replace(/"/g,'""')}"`).join(',')).join('\r\n');}


// モバカルの施設CSVから、登録に使う列だけを取り出す。
const movacalTypes:Record<string,OrganizationKind>={'2':'facilities','3':'careSupportOffices','6':'pharmacies','7':'nursingStations'};
export function readImportRows(text:string,kind:ImportKind){
 const rows=parseCsv(text);
 const header=rows.shift()??[];
 if(JSON.stringify(header)===JSON.stringify(csvHeaders[kind]))return rows;
 const columns=['タイプ','施設名','施設名カナ','住所','tel','fax'].map(name=>header.indexOf(name));
 assert(kind==='organizations'&&columns.every(i=>i>=0),400,'テンプレートと同じ列名・列順で作成してください。');
 return rows.map(row=>{
  assert(row.length===header.length,400,'CSVの列数が一致しません。');
  const [type,...contact]=columns.map(i=>row[i]);
  const organization=Object.hasOwn(movacalTypes,type.trim())?movacalTypes[type.trim()]:undefined;
  return [organization?organizationLabels[organization]:type,...contact];
 });
}
export function decodeCsv(bytes:ArrayBuffer){
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 catch{return new TextDecoder('shift_jis',{fatal:true}).decode(bytes);}
}

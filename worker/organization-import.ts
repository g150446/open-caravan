import {organizationKinds, organizationLabels} from '../src/lib/organizations';
import {organizationSchema, pharmacySchema} from '../src/lib/validation';
import type {Entry} from './domain';
import {list} from './store';
import type {Database, Doc} from './types';

function identity(kind:string, doc:{name:string;address?:string}){
 const name=doc.name.normalize('NFKC').replace(/\s+/g,'');
 const address=doc.address?.normalize('NFKC').replace(/\s+/g,'').replace(/^北海道/,'')??'';
 return JSON.stringify([kind,name,kind==='facilities'?'':address]);
}

export async function organizationImportRows(db:Database, rows:string[][], offset=0, previous:Entry[]=[]){
 const existing=new Map<string,Doc>();
 const masters=await Promise.all(organizationKinds.map(kind=>list(db,kind)));
 organizationKinds.forEach((kind,i)=>{
  for(const doc of masters[i]){
   const key=identity(kind,{name:String(doc.name),address:String(doc.address??'')});
   if(!existing.has(key))existing.set(key,doc);
  }
 });
 const seen=new Map(previous.map(({kind,doc})=>[identity(kind,{name:String(doc.name),address:String(doc.address??'')}),{kind,doc}]));
 return rows.map(([type,name,kana,address,phone,fax],index)=>{
  const row:{line:number;label:string;action:string;errors:string[];entry?:Entry}={
   line:offset+index+2,label:name??'',action:'追加',errors:[],
  };
  const kind=organizationKinds.find(k=>organizationLabels[k]===type?.trim());
  if(!kind){row.errors.push('種別を確認してください。');return row;}
  if(rows[index].length!==6){row.errors.push('列数が一致しません');return row;}
  const schema=kind==='pharmacies'?pharmacySchema:organizationSchema;
  const result=schema.safeParse({name,kana,address,phone,fax,...(kind==='pharmacies'?{openDays:[],holidayClosed:false}:{})});
  if(!result.success){row.errors.push(...result.error.issues.map(issue=>issue.message));return row;}
  const data=result.data;
  const key=identity(kind,data);
  const earlier=seen.get(key);
  if(earlier){
   const fields=['kana','phone','fax'] as const;
   if(fields.some(field=>data[field]&&earlier.doc[field]&&data[field]!==earlier.doc[field])){
    row.errors.push('同じ事業所の行に異なる連絡先またはカナがあります。');
   }else{
    row.action='登録済み';
    row.entry=earlier;
   }
   return row;
  }
  const current=existing.get(key);
  if(current){
   const additions=Object.fromEntries(Object.entries({kana:data.kana,address:data.address,phone:data.phone,fax:data.fax}).filter(([field,value])=>value&&!current[field]));
   row.action=Object.keys(additions).length?'更新':'登録済み';
   row.entry={kind,doc:row.action==='更新'?{...current,...additions,version:current.version+1}:current};
  }else{
   row.entry={kind,doc:{...data,id:crypto.randomUUID(),version:1}};
  }
  seen.set(key,row.entry);
  return row;
 });
}

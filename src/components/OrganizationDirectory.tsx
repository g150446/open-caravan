import {useState} from 'react';
import type {Masters,Organization} from '../models';
import {organizationKinds,organizationLabels,type OrganizationKind} from '../lib/organizations';
import {facilityColor} from '../lib/facilityColor';
import {openDaysLabel} from '../lib/pharmacy';
import {prefsSummary} from '../lib/visitPrefs';
import {Dialog} from './Forms';

type OrganizationRow = {
 [Kind in OrganizationKind]: {kind:Kind;record:Masters[Kind][number]}
}[OrganizationKind];

const normalizeSearch=(value:string)=>value.normalize('NFKC').toLowerCase()
 .replace(/[ぁ-ゖ]/g,c=>String.fromCharCode(c.charCodeAt(0)+0x60)).replace(/\s+/g,'');

export function OrganizationName({record}:{record:Organization}){
 return <><strong>{record.name}</strong>{record.kana&&<small>{record.kana}</small>}</>;
}

export function OrganizationContact({record}:{record:Organization}){
 return <>{record.phone&&<span className="nowrap">TEL {record.phone}</span>}{record.fax&&<small className="nowrap">FAX {record.fax}</small>}{!record.phone&&!record.fax&&'未登録'}</>;
}

export function OrganizationDirectory({masters,onOpen}:{
 masters:Masters;
 onOpen:(kind:OrganizationKind,record?:Organization)=>void;
}){
 const [kind,setKind]=useState<OrganizationKind|''>('');
 const [search,setSearch]=useState('');
 const [choosingKind,setChoosingKind]=useState(false);
 const rows:OrganizationRow[]=[
  ...masters.facilities.map(record=>({kind:'facilities' as const,record})),
  ...masters.pharmacies.map(record=>({kind:'pharmacies' as const,record})),
  ...masters.nursingStations.map(record=>({kind:'nursingStations' as const,record})),
  ...masters.careSupportOffices.map(record=>({kind:'careSupportOffices' as const,record})),
 ];
 const query=normalizeSearch(search);
 const visible=rows.filter(row=>(!kind||row.kind===kind)&&
  [row.record.name,row.record.kana??'',row.record.address].some(value=>normalizeSearch(value).includes(query)));

 return <main className="management organization-directory">
  <div className="page-title">
   <h1>連携先</h1>
   <button className="primary" onClick={()=>kind?onOpen(kind):setChoosingKind(true)}>＋ 新規登録</button>
  </div>
  <div className="management-search">
   <select aria-label="種別で絞り込む" value={kind} onChange={e=>setKind(e.target.value as OrganizationKind|'')}>
    <option value="">すべて</option>
    {organizationKinds.map(value=><option key={value} value={value}>{organizationLabels[value]}</option>)}
   </select>
   <input type="search" aria-label="連携先を検索" placeholder="名称・カナ・住所を検索" value={search} onChange={e=>setSearch(e.target.value)}/>
  </div>
  <div className="table-wrap">
   <table aria-label="連携先一覧">
    <thead><tr>
     <th scope="col">名称・カナ</th>
     <th scope="col">種別</th>
     <th scope="col">電話 / FAX</th>
     <th scope="col">住所</th>
     {kind==='facilities'&&<><th scope="col">希望・NG</th><th scope="col">指定薬局</th></>}
     {kind==='pharmacies'&&<><th scope="col">営業日</th><th scope="col">営業時間</th></>}
     <th scope="col" className="organization-edit" aria-label="操作"/>
    </tr></thead>
    <tbody>{visible.map(row=><tr key={row.kind+':'+row.record.id}>
     <td>
      {row.kind==='facilities'&&<i className="color-dot" style={{background:facilityColor(row.record)}}/>}
      <OrganizationName record={row.record}/>
      {kind==='pharmacies'&&row.kind==='pharmacies'&&row.record.note&&<small>{row.record.note}</small>}
     </td>
     <td>{organizationLabels[row.kind]}</td>
     <td><OrganizationContact record={row.record}/></td>
     <td>{row.record.address||'未登録'}</td>
     {kind==='facilities'&&row.kind==='facilities'&&<>
      <td className="prefs-col">{prefsSummary(row.record.visitPrefs)||'—'}</td>
      <td>{masters.pharmacies.find(p=>p.id===row.record.pharmacyId)?.name??'—'}</td>
     </>}
     {kind==='pharmacies'&&row.kind==='pharmacies'&&<>
      <td>{openDaysLabel(row.record.openDays,row.record.holidayClosed)}</td><td>{row.record.hours||'—'}</td>
     </>}
     <td className="organization-edit">
      <button aria-label={row.record.name+'を編集'} onClick={()=>onOpen(row.kind,row.record)}>編集</button>
     </td>
    </tr>)}</tbody>
   </table>
   {!visible.length&&<p className="empty-table" role="status">{query?'検索条件に一致する連携先がありません。':'連携先がまだ登録されていません。'}</p>}
  </div>
  {choosingKind&&<Dialog title="登録する連携先の種別" onClose={()=>setChoosingKind(false)}>
   <div className="organization-kind-options">
    {organizationKinds.map(value=><button key={value} type="button" onClick={()=>{
     setChoosingKind(false);
     onOpen(value);
    }}>{organizationLabels[value]}</button>)}
   </div>
  </Dialog>}
 </main>;
}

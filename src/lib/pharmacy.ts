// 処方箋薬局。患者に指定があれば患者の薬局、なければ所属施設の薬局を使う。
import type {Facility,Masters,Patient,Pharmacy} from '../models';
import {weekOrder} from './visitPrefs';

const dayNames='日月火水木金土';
export const emptyPharmacy={name:'',address:'',phone:'',fax:'',openDays:[1,2,3,4,5],holidayClosed:true,hours:'',note:''};

export function effectivePharmacy(patient:Pick<Patient,'pharmacyId'>|null|undefined,facility:Pick<Facility,'pharmacyId'>|null|undefined,m:Pick<Masters,'pharmacies'>):{pharmacy:Pharmacy;viaFacility:boolean}|null{
 const own=patient?.pharmacyId?m.pharmacies.find(x=>x.id===patient.pharmacyId):undefined;if(own)return {pharmacy:own,viaFacility:false};
 const shared=facility?.pharmacyId?m.pharmacies.find(x=>x.id===facility.pharmacyId):undefined;return shared?{pharmacy:shared,viaFacility:true}:null;
}
// 月曜始まりで、3日以上続く曜日は「月〜金」のようにまとめる。
export function openDaysLabel(days:number[],holidayClosed:boolean){
 const order=weekOrder.filter(d=>days.includes(d));if(!order.length)return '営業日 未設定';
 const runs:number[][]=[];for(const d of order){const last=runs.at(-1);if(last&&weekOrder.indexOf(d)===weekOrder.indexOf(last.at(-1)!)+1)last.push(d);else runs.push([d]);}
 const label=runs.map(r=>r.length>=3?`${dayNames[r[0]]}〜${dayNames[r.at(-1)!]}`:r.map(d=>dayNames[d]).join('・')).join('・');
 return label+(holidayClosed?'（祝日休み）':'');
}
// 曜日だけで判定する（祝日は見ない）。date は YYYY-MM-DD。
export const isOpenOn=(p:Pick<Pharmacy,'openDays'>,date:string)=>p.openDays.includes(new Date(date+'T00:00:00Z').getUTCDay());

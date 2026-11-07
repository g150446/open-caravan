import test from 'node:test';import assert from 'node:assert/strict';
import {cycleSlot,effectivePrefs,prefsSummary,slotOf,slotState} from '../src/lib/visitPrefs';
import {effectivePharmacy,isOpenOn,openDaysLabel} from '../src/lib/pharmacy';

test('cycleSlot goes empty → preferred → ng → empty',()=>{
 let p=cycleSlot(undefined,3,'pm');assert.equal(slotState(p,3,'pm'),'preferred');
 p=cycleSlot(p,3,'pm');assert.equal(slotState(p,3,'pm'),'ng');assert.equal(p.preferred.length,0);
 p=cycleSlot(p,3,'pm');assert.equal(slotState(p,3,'pm'),'');assert.deepEqual([p.preferred,p.ng],[[],[]]);
});
test('effectivePrefs merges NG and prefers the patient preferences',()=>{
 const facility={visitPrefs:{preferred:[{weekday:2,part:'am' as const}],ng:[{weekday:3,part:'pm' as const}],note:'施設メモ'}};
 assert.deepEqual(effectivePrefs({},facility).preferred,[{weekday:2,part:'am'}]);
 const patient={visitPrefs:{preferred:[{weekday:1,part:'am' as const},{weekday:3,part:'pm' as const}],ng:[{weekday:5,part:'am' as const}],note:'本人メモ'}};
 const e=effectivePrefs(patient,facility);
 assert.deepEqual(e.ng,[{weekday:3,part:'pm'},{weekday:5,part:'am'}]);
 // 施設で NG の枠は、患者の希望にあっても希望にしない。
 assert.deepEqual(e.preferred,[{weekday:1,part:'am'}]);
 assert.equal(e.note,'施設: 施設メモ／患者: 本人メモ');
 assert.equal(effectivePrefs(patient,null).note,'本人メモ');
});
test('prefsSummary groups days and shows 終日',()=>{
 assert.equal(prefsSummary({preferred:[{weekday:4,part:'am'},{weekday:1,part:'am'}],ng:[{weekday:3,part:'am'},{weekday:3,part:'pm'},{weekday:0,part:'pm'}],note:''}),'希望: 月・木 午前／NG: 水 終日、日 午後');
 assert.equal(prefsSummary({preferred:[],ng:[],note:'x'}),'');
});
test('slotOf uses Japan time with the 12:00 boundary',()=>{
 assert.deepEqual(slotOf('2026-11-11T02:59:00.000Z'),{weekday:3,part:'am'});
 assert.deepEqual(slotOf('2026-11-11T03:00:00.000Z'),{weekday:3,part:'pm'});
 assert.deepEqual(slotOf('2026-11-10T15:30:00.000Z'),{weekday:3,part:'am'});
});
test('pharmacy helpers',()=>{
 const a={id:'a',version:1,name:'A薬局',address:'',phone:'',fax:'',openDays:[1,2,3,4,5,6],holidayClosed:true,hours:'',note:''},b={...a,id:'b',name:'B薬局',openDays:[0,3]};
 const m={pharmacies:[a,b]};
 assert.equal(effectivePharmacy({pharmacyId:'b'},{pharmacyId:'a'},m)?.pharmacy.name,'B薬局');
 assert.deepEqual(effectivePharmacy({pharmacyId:null},{pharmacyId:'a'},m),{pharmacy:a,viaFacility:true});
 assert.equal(effectivePharmacy({pharmacyId:'gone'},null,m),null);
 assert.equal(openDaysLabel(a.openDays,true),'月〜土（祝日休み）');
 assert.equal(openDaysLabel([1,2,3,4,5,0],false),'月〜金・日');
 assert.equal(openDaysLabel([3,0],false),'水・日');
 assert.equal(openDaysLabel([],false),'営業日 未設定');
 assert.equal(isOpenOn(a,'2026-11-08'),false);assert.equal(isOpenOn(a,'2026-11-09'),true);
});

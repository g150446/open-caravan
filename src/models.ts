import type {Recurrence} from './lib/date';
import type {ShiftPattern,WorkSystem} from './lib/attendance';
export interface Staff {id:string;version:number;login:string;name:string;kana?:string;profession:string;color:string;role:'ADMIN'|'STAFF';active:boolean;deleted?:boolean;mustChangePassword?:boolean;temporaryExpires?:string;workSystem?:WorkSystem;slackUserId?:string;}
// 診察希望日・NG: 曜日（0=日〜6=土）と午前／午後の組み合わせで登録する。
export type DayPart='am'|'pm';export interface VisitSlot {weekday:number;part:DayPart;}
export interface VisitPrefs {preferred:VisitSlot[];ng:VisitSlot[];note:string;}
// 処方箋薬局。患者・施設から pharmacyId で選ぶ（患者の指定がなければ施設の薬局を使う）。
export interface Pharmacy {id:string;version:number;name:string;address:string;phone:string;fax:string;openDays:number[];holidayClosed:boolean;hours:string;note:string;}
export interface Facility {id:string;version:number;name:string;address:string;location?:string;color?:string;visitPrefs?:VisitPrefs;pharmacyId?:string|null;}
export interface Patient {id:string;version:number;number:string;name:string;kana:string;address:string;movacalUrl:string;handover:string;visitFrequency?:string;facilityId:string|null;location?:string;active:boolean;visitPrefs?:VisitPrefs;pharmacyId?:string|null;}
// 予定に付けるマーク（クロスログのアイコンと同じ意味）: 初=初診, 往=往診, 注=注射予定
export const visitMarks=['初','往','注'] as const;export type VisitMark=typeof visitMarks[number]|'';
export interface Appointment {id:string;version:number;patientId:string|null;title:string;staffIds:string[];startsAt:string;endsAt:string;memo:string;mark?:VisitMark;seriesId:string|null;occurrenceDate:string|null;exception:boolean;cancelled:boolean;}
export interface Series {id:string;version:number;startDate:string;endDate:string;rule:Recurrence;}
export interface Masters {staff:Staff[];patients:Patient[];facilities:Facility[];pharmacies:Pharmacy[];}
export interface Detail {appointment:Appointment;previous:Appointment[];next:Appointment[];series:Series|null;}
export type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
export interface Settings {officeName:string;officeAddress:string;marginMinutes:number;officeLocation:string;detourFactor:number;speedKmh:number;shiftPatterns:ShiftPattern[];legalHolidayWeekday:number;weekStartWeekday:number;autoBreakMinutes:number;routeMode?:'google'|'estimate';slack?:{configured:boolean;polledAt:string|null};version:number;}
export interface RouteResult {stops:{ids:string[];address:string}[];legs:{minutes:number;meters:number}[];skipped:string[];map:string|null;points?:({lat:number;lng:number}|null)[];estimated?:boolean;unlocated?:string[];}

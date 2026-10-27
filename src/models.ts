import type {Recurrence} from './lib/date';
import type {ShiftPattern,WorkSystem} from './lib/attendance';
export interface Staff {id:string;version:number;login:string;name:string;kana?:string;profession:string;color:string;role:'ADMIN'|'STAFF';active:boolean;deleted?:boolean;mustChangePassword?:boolean;temporaryExpires?:string;workSystem?:WorkSystem;slackUserId?:string;}
export interface Facility {id:string;version:number;name:string;address:string;location?:string;}
export interface Patient {id:string;version:number;number:string;name:string;kana:string;address:string;movacalUrl:string;handover:string;visitFrequency?:string;facilityId:string|null;location?:string;active:boolean;}
export interface Appointment {id:string;version:number;patientId:string|null;title:string;staffIds:string[];startsAt:string;endsAt:string;memo:string;seriesId:string|null;occurrenceDate:string|null;exception:boolean;cancelled:boolean;}
export interface Series {id:string;version:number;startDate:string;endDate:string;rule:Recurrence;}
export interface Masters {staff:Staff[];patients:Patient[];facilities:Facility[];}
export interface Detail {appointment:Appointment;previous:Appointment[];next:Appointment[];series:Series|null;}
export type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
export interface Settings {officeName:string;officeAddress:string;marginMinutes:number;officeLocation:string;detourFactor:number;speedKmh:number;shiftPatterns:ShiftPattern[];legalHolidayWeekday:number;weekStartWeekday:number;autoBreakMinutes:number;routeMode?:'google'|'estimate';slack?:{configured:boolean;polledAt:string|null};version:number;}
export interface RouteResult {stops:{ids:string[];address:string}[];legs:{minutes:number;meters:number}[];skipped:string[];map:string|null;points?:({lat:number;lng:number}|null)[];estimated?:boolean;unlocated?:string[];}

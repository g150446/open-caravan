import type {Recurrence} from './lib/date';
export interface Staff {id:string;version:number;login:string;name:string;profession:string;color:string;role:'ADMIN'|'STAFF';active:boolean;}
export interface Facility {id:string;version:number;name:string;address:string;}
export interface Patient {id:string;version:number;number:string;name:string;kana:string;address:string;movacalUrl:string;handover:string;visitFrequency?:string;facilityId:string|null;active:boolean;}
export interface Appointment {id:string;version:number;patientId:string|null;title:string;staffIds:string[];startsAt:string;endsAt:string;memo:string;seriesId:string|null;occurrenceDate:string|null;exception:boolean;cancelled:boolean;}
export interface Series {id:string;version:number;startDate:string;endDate:string;rule:Recurrence;}
export interface Masters {staff:Staff[];patients:Patient[];facilities:Facility[];}
export interface Detail {appointment:Appointment;previous:Appointment[];next:Appointment[];series:Series|null;}
export type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;

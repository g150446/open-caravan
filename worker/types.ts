export interface Statement {bind(...values:unknown[]):Statement;first<T=Record<string,unknown>>(column?:string):Promise<T|null>;all<T=Record<string,unknown>>():Promise<{results:T[]}>;run():Promise<{meta:{changes:number}}>;}
export interface Database {prepare(sql:string):Statement;batch(statements:Statement[]):Promise<unknown[]>;}
export interface Env {DB:Database;ASSETS?:{fetch(req:Request):Promise<Response>};APP_ORIGIN:string;AUTH_PEPPER:string;SETUP_TOKEN:string;SETUP_EXPIRES:string;MTLS_MODE?:'required'|'local';MTLS_HOST?:string;MTLS_ALLOWED_SHA256?:string;CLOUDFLARE_API_TOKEN?:string;CLOUDFLARE_ZONE_ID?:string;CERT_VALIDITY_DAYS?:string;}
export type Doc=Record<string,unknown> & {id:string;version:number};
export type Row={id:string;version:number;data:string};
export type Actor=Doc & {role:string;active:boolean;name:string;login:string};

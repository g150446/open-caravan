// Node 24 is required for the local SQLite test adapter.
// @ts-ignore node:sqlite is available in Node 24.
import {DatabaseSync} from 'node:sqlite';
import type {Database,Statement} from '../worker/types';
export class SQLite implements Database {
 raw:any;
 constructor(path=':memory:'){this.raw=new DatabaseSync(path);this.raw.exec('PRAGMA foreign_keys=ON;');}
 prepare(sql:string):Statement{const raw=this.raw;let values:unknown[]=[];return {bind(...v){values=v;return this;},async first<T>(){return raw.prepare(sql).get(...values) as T??null;},async all<T>(){return {results:raw.prepare(sql).all(...values) as T[]};},async run(){const r=raw.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};}
 async batch(statements:Statement[]){this.raw.exec('BEGIN IMMEDIATE');try{const results=[];for(const s of statements)results.push(await s.run());this.raw.exec('COMMIT');return results;}catch(e){this.raw.exec('ROLLBACK');throw e;}}
 close(){this.raw.close();}
}

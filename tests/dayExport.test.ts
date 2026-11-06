import test from 'node:test';import assert from 'node:assert/strict';
import {dayCsv,dayPrintHtml,exportSections} from '../src/lib/dayExport';
import {jstDate} from '../src/lib/date';
import type {Appointment,Masters} from '../src/models';
const day='2026-11-19';
const m:Masters={staff:[{id:'d',version:1,login:'d',name:'医師 一郎',profession:'医師',color:'#111111',role:'ADMIN',active:true},{id:'n',version:1,login:'n',name:'看護 花子',profession:'看護師',color:'#222222',role:'STAFF',active:true}],
 facilities:[{id:'f',version:1,name:'ホームA',address:'札幌市1-1'}],
 patients:[{id:'p1',version:1,number:'001',name:'山田 花',kana:'やまだ はな',address:'',movacalUrl:'',handover:'申し送り"引用"',facilityId:'f',active:true},{id:'p2',version:1,number:'002',name:'<鈴木>',kana:'すずき',address:'江別市2-2',movacalUrl:'',handover:'',facilityId:null,active:true}]};
const ap=(id:string,start:string,patientId:string|null,staffIds:string[],extra:Partial<Appointment>={}):Appointment=>({id,version:1,patientId,title:'会議',staffIds,startsAt:jstDate(day,start).toISOString(),endsAt:jstDate(day,start.slice(0,3)+'30').toISOString(),memo:'',seriesId:null,occurrenceDate:null,exception:false,cancelled:false,...extra});
const items=[ap('c','14:00','p2',['d','n']),ap('a','09:00','p1',['d','n'],{mark:'初',memo:'採血\n血圧'}),ap('b','10:00',null,['n'])];

test('sections group by staff lane in time order and split morning/afternoon on request',()=>{
 assert.deepEqual(exportSections(items,m,false).map(s=>[s.staff,s.part,s.items.map(a=>a.id)]),[['医師 一郎（同行: 看護 花子）','',['a','c']],['看護 花子','',['b']]]);
 assert.deepEqual(exportSections(items,m,true).map(s=>[s.staff,s.part,s.items.map(a=>a.id)]),[['医師 一郎（同行: 看護 花子）','午前',['a']],['看護 花子','午前',['b']],['医師 一郎（同行: 看護 花子）','午後',['c']]]);
});

test('csv has a fixed column order, a BOM for Excel and quoted multi-line cells',()=>{
 const csv=dayCsv(day,items,m,{columns:['memo','time','facility','mark','handover'],split:false});
 assert.ok(csv.startsWith('﻿'));
 const lines=csv.slice(1).split('\r\n');
 assert.equal(lines[0],'"日付","担当スタッフ","患者名・予定名","時間","マーク","居宅・施設","予定メモ","申し送り"');
 assert.equal(lines[1],'"2026-11-19","医師 一郎（同行: 看護 花子）","山田 花","09:00〜09:30","初（初診）","ホームA","採血\n血圧","申し送り""引用"""');
 assert.ok(lines.some(l=>l.includes('"会議"')&&l.includes('"看護 花子"')));
 assert.ok(dayCsv(day,items,m,{columns:[],split:true}).includes('"日付","区分","担当スタッフ","患者名・予定名"'));
});

test('print page escapes names and puts the afternoon on a new page when split',()=>{
 const html=dayPrintHtml(day,items,m,{columns:['time','address'],split:true},'くりそら');
 assert.ok(html.includes('2026年11月19日(木) 訪問予定'));assert.ok(html.includes('&lt;鈴木&gt;'));assert.ok(!html.includes('<鈴木>'));
 assert.ok(html.includes('江別市2-2'));assert.ok(html.includes('札幌市1-1'));assert.equal((html.match(/class="break"/g)??[]).length,1);
 assert.ok(!/<script/i.test(html));
 assert.ok(dayPrintHtml(day,[],m,{columns:[],split:false}).includes('予定がありません'));
});

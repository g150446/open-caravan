import test from 'node:test';import assert from 'node:assert/strict';
import {autoAdjust,clock,groupStops,splitHalf,stopLabel,timeline,toMinutes,type Visit} from '../src/lib/route';

const v=(id:string,address:string,start:string,end:string):Visit=>({id,address,start:toMinutes(`2026-10-13T${start}:00+09:00`),end:toMinutes(`2026-10-13T${end}:00+09:00`)});

test('consecutive visits at the same address become one stop, and the day splits at noon',()=>{
 const visits=[v('a','栗山町1','09:00','09:30'),v('b','栗山町 2','09:30','10:00'),v('c','施設 1','13:30','14:00'),v('d','施設1','14:00','14:30'),v('e','栗山町1','15:00','15:30')];
 assert.deepEqual(groupStops(visits).map(s=>s.visits.map(x=>x.id)),[['a'],['b'],['c','d'],['e']]);
 assert.deepEqual(splitHalf(visits,'both').map(s=>s.map(x=>x.id)),[['a','b'],['c','d','e']]);
 assert.deepEqual(splitHalf(visits,'am').map(s=>s.map(x=>x.id)),[['a','b']]);
 assert.deepEqual(splitHalf(visits.slice(0,2),'pm'),[]);
 assert.equal(splitHalf(visits,'day').length,1);
 assert.deepEqual([0,8,9,24].map(stopLabel),['1','9','A','P']);
 assert.equal(clock(9*60+5),'09:05');
});

test('timeline finds departure, arrival and legs that are too short',()=>{
 const stops=groupStops([v('a','A','09:00','09:30'),v('b','B','09:30','10:00'),v('c','C','10:20','10:50')]);
 const t=timeline(stops,[{minutes:12,meters:5000},{minutes:1,meters:300},{minutes:25,meters:9000},{minutes:20,meters:8000}]);
 assert.equal(clock(t.departure),'08:48');assert.equal(clock(t.arrival),'11:10');
 assert.deepEqual(t.short,[false,true,true,false]);
 assert.equal(t.totalMinutes,58);assert.equal(t.totalMeters,22300);
});

test('auto adjust packs visits after travel and margin, rounds to 5 minutes, and keeps fixed visits',()=>{
 const stops=groupStops([v('a','A','09:00','09:30'),v('b','F','11:00','11:30'),v('c','F','11:30','12:00'),v('d','D','16:00','16:20')]);
 const legs=[{minutes:12,meters:0},{minutes:7,meters:0},{minutes:3,meters:0},{minutes:5,meters:0}];
 const free=autoAdjust(stops,legs,8*60+40,10,new Set());
 assert.deepEqual([...free.entries()].map(([id,x])=>[id,clock(x.start),clock(x.end)]),[['a','08:55','09:25'],['b','09:45','10:15'],['c','10:15','10:45'],['d','11:00','11:20']]);
 const fixed=autoAdjust(stops,legs,8*60+40,10,new Set(['b']));
 assert.deepEqual([...fixed.entries()].map(([id,x])=>[id,clock(x.start),clock(x.end)]),[['a','08:55','09:25'],['b','11:00','11:30'],['c','11:30','12:00'],['d','12:15','12:35']]);
});

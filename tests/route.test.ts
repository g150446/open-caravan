import test from 'node:test';import assert from 'node:assert/strict';
import {autoAdjust,clock,distanceMeters,estimateLeg,groupStops,navUrl,nearestOrder,parseLocation,splitHalf,stopLabel,timeline,toMinutes,type Visit} from '../src/lib/route';

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

test('without Google: locations parse, distances and legs are estimated, and the nearest order is a short loop',()=>{
 assert.deepEqual(parseLocation('43.059737, 141.77904'),{lat:43.059737,lng:141.77904});assert.deepEqual(parseLocation('43.05，141.7'),{lat:43.05,lng:141.7});
 for(const bad of ['','43.05','141.7, 43.05','51.5, -0.12','abc, def'])assert.equal(parseLocation(bad),null,bad);
 const kuriyama={lat:43.0597,lng:141.7790},iwamizawa={lat:43.2026,lng:141.7670};
 assert(Math.abs(distanceMeters(kuriyama,iwamizawa)-15950)<200);
 assert.deepEqual(estimateLeg(kuriyama,iwamizawa,{detourFactor:1.4,speedKmh:30}),{meters:Math.round(distanceMeters(kuriyama,iwamizawa)*1.4),minutes:45});
 assert.deepEqual(estimateLeg(kuriyama,kuriyama,{detourFactor:1.4,speedKmh:30}),{meters:0,minutes:0});
 const office={lat:43,lng:141},line=[0.04,0.01,0.03,0.02].map(d=>({lat:43+d,lng:141}));
 assert.deepEqual(nearestOrder(office,line),[1,3,2,0]);
 const square=[{lat:43,lng:141.1},{lat:43.1,lng:141},{lat:43.1,lng:141.1}];const loop=nearestOrder(office,square);
 assert(loop.join()==='1,2,0'||loop.join()==='0,2,1',loop.join());
 assert.deepEqual(nearestOrder(office,[]),[]);
 assert.match(navUrl('A','A',['B','C']),/waypoints=B%7CC/);
});

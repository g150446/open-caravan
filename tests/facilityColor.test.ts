import test from 'node:test';import assert from 'node:assert/strict';
import {defaultFacilityColor,facilityColor,facilityPalette,nextFacilityColor} from '../src/lib/facilityColor';
test('facility color is stable per id and honours a registered color',()=>{assert.equal(defaultFacilityColor('abc'),defaultFacilityColor('abc'));assert(facilityPalette.includes(defaultFacilityColor('xyz')));assert.equal(facilityColor({id:'abc',color:'#123456'}),'#123456');assert.equal(facilityColor({id:'abc',color:'bad'}),defaultFacilityColor('abc'));});
test('new facilities get an unused palette color',()=>{const existing=[{id:'a',color:facilityPalette[0]},{id:'b',color:facilityPalette[1]}];assert.equal(nextFacilityColor(existing),facilityPalette[2]);});

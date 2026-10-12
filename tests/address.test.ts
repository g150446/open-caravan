import test from 'node:test';import assert from 'node:assert/strict';
import {townName} from '../src/lib/address';
test('town name follows the district, city or ward',()=>{assert.equal(townName('北海道夕張郡栗山町松風3丁目'),'栗山町');assert.equal(townName('北海道岩見沢市栗沢町由良'),'栗沢町');assert.equal(townName('北海道札幌市中央区南1条西'),'中央区');assert.equal(townName('東京都新宿区西新宿2丁目'),'新宿区');assert.equal(townName('三重県四日市市諏訪町1-5'),'諏訪町');assert.equal(townName('北海道岩見沢市5条西'),'');assert.equal(townName(''),'');});

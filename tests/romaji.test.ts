import test from 'node:test';import assert from 'node:assert/strict';
import {kanaToRomaji,uniqueLogin} from '../src/lib/romaji';
test('furigana becomes a Hepburn login stem',()=>{
 assert.equal(kanaToRomaji('いはら ひろと'),'ihara-hiroto');
 assert.equal(kanaToRomaji('イハラ　ヒロト'),'ihara-hiroto');
 assert.equal(kanaToRomaji('さとう しょうた'),'satou-shouta');
 assert.equal(kanaToRomaji('きっかわ ちゃこ'),'kikkawa-chako');
 assert.equal(kanaToRomaji('はっちょう じゅん'),'hatchou-jun');
 assert.equal(kanaToRomaji('ふじい りょう'),'fujii-ryou');
 assert.equal(kanaToRomaji('てすと 2'),'tesuto-2');
 assert.equal(kanaToRomaji('井原'),'');
});
test('login gets the smallest unused number',()=>{
 assert.equal(uniqueLogin('いはら ひろと',[]),'ihara-hiroto1');
 assert.equal(uniqueLogin('いはら ひろと',['Ihara-Hiroto1','ihara-hiroto2','admin']),'ihara-hiroto3');
 assert.equal(uniqueLogin('',['x']),'');
});

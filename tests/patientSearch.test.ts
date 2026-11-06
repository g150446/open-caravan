import test from 'node:test';import assert from 'node:assert/strict';
import {matchesPatient} from '../src/lib/patientSearch';
const p={name:'高橋 夕起子',kana:'たかはし ゆきこ',number:'000137'};
test('patient search matches part of the name, kana in either script, and the number',()=>{
  for(const q of ['高橋','夕起','高橋夕起子','たかはし','タカハシ','ﾀｶﾊｼ','ゆきこ','137','',' '])assert(matchesPatient(p,q),q);
  for(const q of ['佐藤','さとう','999'])assert(!matchesPatient(p,q),q);
});

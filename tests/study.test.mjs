import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoGuide, validateMaterials, MAX_TOTAL_CHARS, demoTests } from '../src/study.js';
test('every source is represented and questions preserve source citations',()=>{
 const sources=demoTests[0].materials;const guide=buildDemoGuide(sources,'Biology');
 assert.equal(guide.topics.length,sources.length);assert.equal(guide.questions.length,sources.length);
 assert.deepEqual(guide.topics.map(t=>t.sourceIds[0]),sources.map(t=>t.id));
 assert.match(guide.topics[0].summary,/phospholipid/);assert.equal(guide.mode,'demo');
 assert.ok(guide.script.length<=2500);assert.match(guide.script,/selected excerpts/);
});
test('100 sources still retain all source IDs while voice is a bounded excerpt',()=>{
 const sources=Array.from({length:100},(_,i)=>({id:String(i),name:`notes${i}.md`,text:`# Topic ${i}\n${'source fact '.repeat(50)}`}));
 const guide=buildDemoGuide(sources,'Big test');assert.equal(guide.topics.length,100);assert.ok(guide.script.length<=2500);
 assert.equal(guide.topics.at(-1).sourceIds[0],'99');
});
test('rejects empty, duplicate, over-count, and over-size sources without mutating them',()=>{
 assert.throws(()=>validateMaterials([]),/readable/);
 assert.throws(()=>validateMaterials([{id:'a',name:'empty',text:' '}]),/readable/);
 const source={id:'a',name:'note',text:'Fact.'};
 assert.throws(()=>validateMaterials([source,source]),/unique/);
 assert.throws(()=>validateMaterials(Array.from({length:101},(_,i)=>({...source,id:String(i)}))),/100/);
 const huge={...source,text:'x'.repeat(MAX_TOTAL_CHARS+1)};
 assert.throws(()=>validateMaterials([huge]),/500,000/);assert.equal(huge.text.length,MAX_TOTAL_CHARS+1);
});

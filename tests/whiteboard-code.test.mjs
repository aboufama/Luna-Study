import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCode,codeDocument} from '../benchmarks/whiteboard-code-render.mjs';
test('code formats retain loops/JSX expressiveness without requiring external execution capabilities',async()=>{
 const canvas=await compileCode('canvas','function draw(ctx,hit){for(let row=0;row<8;row++){ctx.strokeRect(0,row*20,40,20);hit("row"+row,0,row*20,40,20);}}');assert.match(canvas,/strokeRect/);
 const react=await compileCode('react','function Board(){return <div data-id="equation" style={{position:"absolute",top:20}}>x = 4</div>}');assert.match(react,/React.createElement/);assert.match(react,/x = 4/);
});
test('code contract rejects network, global escape, dynamic evaluation and unbounded loop shortcuts',async()=>{
 for(const snippet of ['fetch("https://example.com")','parent.postMessage("x","*")','eval("1")','while(true){}','for(;;){}','document.body.remove()'])await assert.rejects(compileCode('canvas',`function draw(ctx,hit){${snippet}}`));
 await assert.rejects(compileCode('react','export function Board(){return null}'));
});
test('isolated code documents deny network and forms without exposing the app runtime',async()=>{
 const html=await codeDocument('canvas',await compileCode('canvas','function draw(ctx,hit){ctx.fillText("A",10,20)}'));
 assert.match(html,/default-src 'none'/);assert.match(html,/connect-src 'none'/);assert.match(html,/form-action 'none'/);assert.doesNotMatch(html,/OPENAI_API_KEY|localStorage|sessionStorage/);
});

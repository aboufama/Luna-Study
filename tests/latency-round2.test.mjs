import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createLunaFast} from '../benchmarks/latency-round2-experimental.mjs';

function mock(onTurn){
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  const calls=[];let spawnOptions,args;
  const emit=message=>child.stdout.write(`${JSON.stringify(message)}\n`);
  child.kill=()=>{queueMicrotask(()=>child.emit('close',null));return true;};
  child.stdin.on('data',data=>{for(const line of data.toString().trim().split('\n')){
    const message=JSON.parse(line);calls.push(message);if(message.id===undefined)continue;
    if(message.method==='config/read')emit({id:message.id,result:{config:{mcp_servers:{private_server:{command:'never-launch',env:{SECRET:'never-emit'}}}}}});
    else if(message.method==='thread/start')emit({id:message.id,result:{thread:{id:'thread-1'}}});
    else if(message.method==='turn/start'){emit({id:message.id,result:{turn:{id:'turn-1'}}});queueMicrotask(()=>onTurn?.(emit));}
    else emit({id:message.id,result:{}});
  }});
  return {calls,child,get args(){return args;},get spawnOptions(){return spawnOptions;},spawnImpl(_bin,a,o){args=a;spawnOptions=o;return child;}};
}
const delta=text=>({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',delta:text}});
const completed={method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}};


test('optional prewarmed threads move setup before the turn without dropping any input context',async()=>{
 const transport=mock(emit=>{emit(delta('Same supported response.'));emit(completed);});
 const session=createLunaFast({spawnImpl:transport.spawnImpl,prewarmThread:true});
 const input={materials:[{id:'source',text:'Complete original materials.'}],conversation:[{role:'user',content:'Complete question.'}],whiteboardContext:{board:{title:'Board',blocks:[]},selection:null},privateQuestionBank:{topics:[]},masteryContext:{overall:0}};
 try{
  await session.ready();assert.equal(transport.calls.filter(c=>c.method==='thread/start').length,1);assert.equal(transport.calls.filter(c=>c.method==='turn/start').length,0);
  await session.respond(input);await new Promise(resolve=>setImmediate(resolve));assert.equal(transport.calls.filter(c=>c.method==='thread/start').length,2,'only one next blank thread is prepared');
  await session.respond(input);await new Promise(resolve=>setImmediate(resolve));assert.equal(transport.calls.filter(c=>c.method==='thread/start').length,3);
  for(const turn of transport.calls.filter(c=>c.method==='turn/start')){assert.deepEqual(JSON.parse(turn.params.input[0].text),input);assert.equal(turn.params.effort,'low');}
 }finally{await session.close();}
 const count=transport.calls.filter(c=>c.method==='thread/start').length;await new Promise(resolve=>setImmediate(resolve));assert.equal(transport.calls.filter(c=>c.method==='thread/start').length,count,'nothing starts after close');
});

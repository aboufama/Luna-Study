import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createLunaFast,lunaInstructions} from '../server/luna-fast.mjs';

function mock(onTurn,{beforeTurnAck,onRequest}={}){
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  const calls=[];let spawnOptions,args;
  const emit=message=>child.stdout.write(`${JSON.stringify(message)}\n`);
  child.kill=()=>{queueMicrotask(()=>child.emit('close',null));return true;};
  child.stdin.on('data',data=>{for(const line of data.toString().trim().split('\n')){
    const message=JSON.parse(line);calls.push(message);if(message.id===undefined)continue;
    if(onRequest?.(message,emit))continue;
    if(message.method==='config/read')emit({id:message.id,result:{config:{mcp_servers:{private_server:{command:'never-launch',env:{SECRET:'never-emit'}}}}}});
    else if(message.method==='thread/start')emit({id:message.id,result:{thread:{id:'thread-1'}}});
    else if(message.method==='turn/start'){beforeTurnAck?.(emit);emit({id:message.id,result:{turn:{id:'turn-1'}}});queueMicrotask(()=>onTurn?.(emit));}
    else emit({id:message.id,result:{}});
  }});
  return {calls,child,get args(){return args;},get spawnOptions(){return spawnOptions;},spawnImpl(_bin,a,o){args=a;spawnOptions=o;return child;}};
}
const delta=text=>({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',delta:text}});
const completed={method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}};

test('voice continuity prioritizes recent intent and spoken selection answers without reviving solved work', () => {
  const instructions = lunaInstructions('voice');
  assert.match(instructions, /sessionMemory\.recentConversation contains recent transcript evidence/);
  assert.match(instructions, /newest student intent, corrections, and completed work over older summaries/);
  assert.match(instructions, /current conversation takes priority over older session memory/);
  assert.match(instructions, /do not resume a solved or finished problem unless the student requests it/);
  assert.match(instructions, /Read-only board: omit zones and selection instructions/);
  assert.match(instructions, /source-ready returning welcome may also resume the requested substantive problem/);
});

test('compact voice instructions preserve packed history and restrict source retrieval to before speech', () => {
  const instructions = lunaInstructions('voice');
  assert.ok(instructions.length < 14000, 'the expanded semantic drawing and tutoring instructions retain a bounded context budget');
  assert.match(instructions, /conversationMemory is lossless earlier public dialogue/);
  assert.match(instructions, /exact text or \{repeat: earlier entry\}/);
  assert.match(instructions, /including the tutor context for short student replies/);
  assert.match(instructions, /activeQuestion describes the currently tracked public question, attempt count and assistance/);
  assert.match(instructions, /use only search_materials or read_materials.*BEFORE any speech/);
  assert.match(instructions, /Respond directly when evidence is sufficient, within the active practice and hint permissions/);
  assert.match(instructions, /Never use general tools, files, shell, browsing, or writes/);
  assert.match(instructions, /No verified whole-course completion flag exists/);
  assert.doesNotMatch(lunaInstructions('visual'), /search_materials|read_materials/);
});

test('streaming transport strips secrets, disables inherited MCP servers, and returns streamed speech',async()=>{
  const transport=mock(emit=>{emit(delta('Mitochondria '));emit(delta('produce ATP.'));emit(completed);});
  const session=createLunaFast({env:{HOME:'/tmp',PATH:'/bin',ELEVENLABS_API_KEY:'secret'},spawnImpl:transport.spawnImpl});
  const chunks=[];
  try{
    const reply=await session.respond({materials:[]},{onText:chunk=>chunks.push(chunk)});
    assert.equal(reply.reply,'Mitochondria produce ATP.');assert.equal(chunks.join(''),reply.reply);
    assert.equal(typeof reply.timings.firstDeltaMs,'number');
    assert.equal(transport.spawnOptions.shell,false);assert.equal(transport.spawnOptions.env.ELEVENLABS_API_KEY,undefined);
    const thread=transport.calls.find(call=>call.method==='thread/start').params;
    assert.deepEqual(thread.config.mcp_servers,{private_server:{enabled:false}});
    assert.equal(thread.ephemeral,true);assert.equal(thread.sandbox,'read-only');assert.deepEqual(thread.environments,[]);
    assert.equal(transport.calls.find(call=>call.method==='turn/start').params.effort,'low');
    assert.ok(transport.args.includes('notify=[]'));assert.ok(transport.args.includes('model_provider="openai"'));
  }finally{await session.close();}
});

test('Codex transport restates only snapshotted consumed public question IDs with matching live wording',async()=>{
 const question='Why is the membrane selective?';
 for(const id of ['current','callback-only']){
  const transport=mock(emit=>{emit(delta(`<ask>${id}</ask>`));emit(completed);});
  const session=createLunaFast({spawnImpl:transport.spawnImpl}),spoken=[];
  try{
   const pending=session.respond({workingProblem:{id:'current',question},activeQuestion:{id:'current',question},privateQuestionBank:{topics:[]}},{resolveQuestion:()=>question,onText:value=>spoken.push(value)});
   if(id==='current'){const result=await pending;assert.equal(result.questionId,id);assert.equal(result.reply,question);assert.deepEqual(spoken,[question]);}
   else{await assert.rejects(pending);assert.deepEqual(spoken,[]);}
  }finally{await session.close();}
 }
});

test('streaming transport reserves pending turns and aborts without forwarding stale text',async()=>{
  let emit;const transport=mock(sender=>{emit=sender;});const session=createLunaFast({spawnImpl:transport.spawnImpl});
  const controller=new AbortController();const chunks=[];
  const first=session.respond({}, {signal:controller.signal,onText:chunk=>chunks.push(chunk)});
  await assert.rejects(session.respond({}),error=>error.status===409);
  while(!emit)await new Promise(resolve=>setImmediate(resolve));
  controller.abort();await assert.rejects(first,error=>error.status===499);
  emit(delta('stale'));emit(completed);assert.deepEqual(chunks,[]);
  assert.ok(transport.calls.some(call=>call.method==='turn/interrupt'));
  await session.close();
});

test('a new turn can reserve the session immediately after an active turn is aborted',async()=>{
  let count=0,firstStarted;
  const ready=new Promise(resolve=>{firstStarted=resolve;});
  const transport=mock(emit=>{count++;if(count===1)firstStarted();else{emit(delta('Fresh answer.'));emit(completed);}});
  const session=createLunaFast({spawnImpl:transport.spawnImpl});const controller=new AbortController();
  const old=session.respond({}, {signal:controller.signal});await ready;
  controller.abort();const next=session.respond({});
  await assert.rejects(old,error=>error.status===499);assert.equal((await next).reply,'Fresh answer.');
  await session.close();
});

test('a canceled turn waiting for startup cannot block or unlock its replacement',async()=>{
  let initialize,finish;
  const transport=mock(emit=>{finish=()=>{emit(delta('Fresh answer.'));emit(completed);};},{onRequest(message,emit){
    if(message.method==='initialize'){initialize=()=>emit({id:message.id,result:{}});return true;}
  }});
  const session=createLunaFast({spawnImpl:transport.spawnImpl}),controller=new AbortController();
  try{
    const old=session.respond({}, {signal:controller.signal});
    while(!initialize)await new Promise(resolve=>setImmediate(resolve));
    controller.abort();
    const next=session.respond({});const outcome=next.then(value=>({value}),error=>({error}));
    initialize();await assert.rejects(old,error=>error.status===499);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(typeof finish,'function','replacement reaches generation after shared startup');
    assert.equal(transport.calls.filter(call=>call.method==='thread/start').length,1,'canceled startup never creates its own thread');
    await assert.rejects(session.respond({}),error=>error.status===409,'old finally preserves the replacement reservation');
    finish();const result=await outcome;assert.ifError(result.error);assert.equal(result.value.reply,'Fresh answer.');
  }finally{await session.close();}
});

test('late canceled thread creation cannot erase the replacement thread or its reservation',async()=>{
  let resolveOldThread,finish,threads=0;
  const transport=mock(emit=>{finish=()=>{emit({...delta('Fresh answer.'),params:{...delta('Fresh answer.').params,threadId:'thread-new'}});emit({...completed,params:{...completed.params,threadId:'thread-new'}});};},{onRequest(message,emit){
    if(message.method!=='thread/start')return false;
    threads++;
    if(threads===1)resolveOldThread=()=>emit({id:message.id,result:{thread:{id:'thread-old'}}});
    else emit({id:message.id,result:{thread:{id:'thread-new'}}});
    return true;
  }});
  const session=createLunaFast({spawnImpl:transport.spawnImpl,reuseThread:true}),controller=new AbortController();
  const input={materials:[],conversation:[{role:'user',content:'Explain the gradient.'}]};
  try{
    await session.ready();
    const old=session.respond({}, {signal:controller.signal});
    while(!resolveOldThread)await new Promise(resolve=>setImmediate(resolve));
    controller.abort();
    const next=session.respond(input);const outcome=next.then(value=>({value}),error=>({error}));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(typeof finish,'function','replacement starts while old thread creation is still pending');
    resolveOldThread();await assert.rejects(old,error=>error.status===499);
    await assert.rejects(session.respond({}),error=>error.status===409);
    assert.ok(transport.calls.some(call=>call.method==='thread/unsubscribe'&&call.params.threadId==='thread-old'));
    assert.equal(transport.calls.some(call=>call.method==='thread/unsubscribe'&&call.params.threadId==='thread-new'),false);
    finish();const result=await outcome;assert.ifError(result.error);assert.equal(result.value.reply,'Fresh answer.');
    input.conversation.push({role:'assistant',content:'Fresh answer.'},{role:'user',content:'Continue.'});
    finish=null;const followup=session.respond(input);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(threads,2,'late old acknowledgment cannot erase the reusable replacement thread');
    finish();assert.equal((await followup).timings.reusedThread,true);
  }finally{await session.close();}
});

test('streaming transport rejects forbidden tools, oversize speech, and timeouts',async t=>{
  for(const kind of ['tool','oversize','timeout'])await t.test(kind,async()=>{
    const transport=mock(emit=>{if(kind==='tool')emit({method:'item/started',params:{threadId:'thread-1',item:{type:'commandExecution'}}});if(kind==='oversize')emit(delta('x'.repeat(1801)));});
    const session=createLunaFast({spawnImpl:transport.spawnImpl});
    try{await assert.rejects(session.respond({}, {timeoutMs:20}),error=>error.status===(kind==='timeout'?504:502));}finally{await session.close();}
  });
});

test('reused threads omit repeated sources, and source/history changes start fresh threads',async()=>{
  const transport=mock(emit=>{emit(delta('Correct.'));emit(completed);});
  const session=createLunaFast({spawnImpl:transport.spawnImpl,reuseThread:true});
  const input={materials:[{text:'Original facts'}],conversation:[{role:'user',content:'One?'}]};
  try{
    await session.respond(input);
    input.conversation.push({role:'assistant',content:'Correct.'},{role:'user',content:'Two?'});
    const second=await session.respond(input);assert.equal(second.timings.reusedThread,true);
    assert.equal(transport.calls.filter(call=>call.method==='thread/start').length,1);
    const turn=transport.calls.filter(call=>call.method==='turn/start').at(-1);
    assert.deepEqual(JSON.parse(turn.params.input[0].text),{conversation:[{role:'user',content:'Two?'}]});
    input.materials=[{text:'Changed facts'}];await session.respond(input);
    assert.equal(transport.calls.filter(call=>call.method==='thread/start').length,2);
    input.conversation=[{role:'user',content:'Rewritten history'}];await session.respond(input);
    assert.equal(transport.calls.filter(call=>call.method==='thread/start').length,3);
  }finally{await session.close();}
});

test('UTF-8 deltas remain intact when subprocess chunks split a multibyte character',async()=>{
  const transport=mock(emit=>{
    const bytes=Buffer.from(`${JSON.stringify(delta('The value is π.'))}\n`);const split=bytes.indexOf(Buffer.from('π'))+1;
    transport.child.stdout.write(bytes.subarray(0,split));transport.child.stdout.write(bytes.subarray(split));emit(completed);
  });
  const session=createLunaFast({spawnImpl:transport.spawnImpl});
  try{assert.equal((await session.respond({})).reply,'The value is π.');}finally{await session.close();}
});

test('voice transport streams only speech and returns a separately validated whiteboard',async()=>{
  const board={title:'Matrix',blocks:[{type:'text',content:'What is the determinant?'},{type:'latex',content:'\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}'}]};
  const transport=mock(emit=>{const output=`<say>Consider this. Where would you begin?</say><board>${JSON.stringify(board)}</board>`;for(let i=0;i<output.length;i+=3)emit(delta(output.slice(i,i+3)));emit(completed);});
  const session=createLunaFast({spawnImpl:transport.spawnImpl}),spoken=[];
  try{const result=await session.respond({}, {onText:text=>spoken.push(text)});assert.equal(result.reply,'Consider this. Where would you begin?');assert.equal(spoken.join(''),result.reply);assert.deepEqual(result.board,board);assert.equal(result.boardStatus,'valid');assert.doesNotMatch(spoken.join(''),/pmatrix|<say>|blocks/);}finally{await session.close();}
});

test('voice results retain safe diagnostics when generated boards are omitted, rejected or unfinished',async()=>{
  for(const [tail,boardStatus] of [['','none'],['<board>{"private":"invalid-secret"}</board>','invalid'],['<board>{"private":"invalid-secret"','incomplete']]){
    const transport=mock(emit=>{emit(delta(`<say>Compare these.</say>${tail}`));emit(completed);});
    const session=createLunaFast({spawnImpl:transport.spawnImpl});
    try{
      const result=await session.respond({});
      assert.equal(result.boardStatus,boardStatus);assert.equal(result.reply,'Compare these.');assert.equal(result.board,undefined);
      assert.doesNotMatch(JSON.stringify(result),/invalid-secret|private/);
    }finally{await session.close();}
  }
});

test('voice generation instructions proactively cover conceptual visuals while keeping ordinary conversation spoken',async()=>{
  const transport=mock(emit=>{emit(delta('<say>Compare these two paths.</say>'));emit(completed);});
  const session=createLunaFast({spawnImpl:transport.spawnImpl});
  try{
    await session.respond({materials:[{text:'Diffusion follows the concentration gradient. Active transport requires energy.'}],conversation:[{role:'user',content:'How are these processes different?'}]});
    const instructions=transport.calls.find(call=>call.method==='thread/start').params.baseInstructions;
    assert.equal(instructions,lunaInstructions('voice'));
    assert.match(instructions,/Proactively follow with <board>/);
    for(const category of ['equation','calculation','graph','labeled diagram','process sequence','comparison','tabular choices'])assert.ok(instructions.includes(category));
    assert.match(instructions,/Do not wait for a whiteboard request/);
    assert.match(instructions,/Use speech only for setup, greetings, acknowledgments and simple verbal recall without useful visual structure/);
    assert.match(instructions,/Do not show a solution or reference answer before the student attempts it/);
    assert.match(instructions,/work on or practice an unattempted problem.*not its final answer or a completed derivation/);
    assert.match(instructions,/an explicit request for the answer or a worked solution never overrides the active question and hint policy/);
    assert.match(instructions,/Preserve unspecified payoffs and unknown cells as blank or symbolic/);
    assert.match(instructions,/Preserve exact requested dimensions even without payoffs/);
    assert.match(instructions,/compact form makes exactly 8 rows of 10 empty cells/);
    assert.match(instructions,/Ground facts in original materials/);
    assert.match(instructions,/requires consulting that saved scene.*briefly cue bringing it back so it can reopen/);
    assert.match(instructions,/do not generate a duplicate patch merely to redisplay it/);
    assert.match(instructions,/recall question answerable aloud without consulting the scene does not need to reopen it/);
    assert.match(instructions,/Use the whiteboard across all subjects/);
    assert.match(instructions,/definitions, notes, worked steps and annotations/);
    assert.match(instructions,/Put local visual labels inside the diagram or matrix axes/);
    assert.match(instructions,/Do not duplicate the spoken question, turn the board into a transcript wall/);
    assert.match(instructions,/Use <ask>id<\/ask> for a queued question/);
    assert.match(instructions,/The server speaks its canonical wording and tracks that ID for completion/);
    assert.match(instructions,/Teaching text uses.*concise notes/);
    assert.doesNotMatch(instructions,/do not generate standalone text blocks|Keep the whiteboard to diagrams/);
    assert.match(instructions,/Use mode:"replace" whenever starting a new concrete problem/);
    assert.match(instructions,/Use patches for hints, corrections, and additional steps of the same active problem/);
    assert.doesNotMatch(instructions,/exact question wording in a text block|short visual label or exact question|notation, and the exact active question/);
    assert.doesNotMatch(instructions,/only when a genuine mathematical or spatial visual|Keep visuals sparse/);
  }finally{await session.close();}
});

test('voice and planner distinguish the automatic session date from the optional saved exam deadline', () => {
  for (const mode of ['voice', 'planner']) {
    const instructions = lunaInstructions(mode);
    assert.match(instructions, /sessionDate come from the clock/);
    assert.match(instructions, /never ask the student for the session date/);
    assert.match(instructions, /Missing deadlines never block study or visuals/);
    assert.match(instructions, /A saved deadline needs no confirmation/);
    assert.match(instructions, /Never claim a date was saved from your proposal or a generic yes/);
  }
});

test('planner instructions stay separate from the shared voice protocol',()=>{
  assert.match(lunaInstructions('planner'),/brief teaching hint for a separate live tutor/);
  assert.doesNotMatch(lunaInstructions('planner'),/<say>|<board>/);
  assert.equal(lunaInstructions(),lunaInstructions('voice'));
});

test('silent visual recovery draws only the established grounded problem and preserves unknown cells',()=>{
  const instructions=lunaInstructions('visual');
  assert.match(instructions,/render only the already established public problem from visualRecovery.reply/);
  assert.match(instructions,/Use current original materials for academic facts/);
  assert.match(instructions,/Preserve exactly the established dimensions, known values, variables, unknowns, and unfilled cells/);
  assert.match(instructions,/Do not invent a replacement example/);
  assert.match(instructions,/reveal a reference answer to an unattempted question/);
  assert.match(instructions,/Written definitions, notes, worked steps, and annotations are allowed/);
  assert.match(instructions,/Do not add a redundant copy of the spoken question or a transcript wall/);
  assert.match(instructions,/mode:"patch"; a new concrete problem uses mode:"replace"/);
  assert.match(instructions,/always output exactly <say>Drawing.<\/say>/);
  assert.match(instructions,/cannot be grounded, output only <say>Drawing.<\/say> and no board/);
  assert.match(instructions,/Dimensions1..12; cell strings<=160/);
  assert.match(instructions,/Preserve exact requested dimensions even without payoffs/);
  assert.doesNotMatch(instructions,/You are Luna, a live spoken study tutor|For a session-start|For the current topic, use an available question|Speak the active question in <say>/);
});

const usageNotice=(last,overrides={})=>({method:'thread/tokenUsage/updated',params:{threadId:'thread-1',turnId:'turn-1',tokenUsage:{last,total:{inputTokens:99999,outputTokens:88888}},...overrides}});

test('provider token snapshots report current-turn units without cumulative totals or stale notifications',async()=>{
  const snapshots=[];
  const transport=mock(emit=>{
    emit(usageNotice({inputTokens:1},{threadId:'other-thread'}));
    emit(usageNotice({inputTokens:2},{turnId:'stale-turn'}));
    emit(usageNotice({inputTokens:120,cachedInputTokens:80,outputTokens:4,reasoningOutputTokens:2,totalTokens:124}));
    emit(usageNotice({inputTokens:120,cachedInputTokens:80,outputTokens:12,reasoningOutputTokens:6,totalTokens:132,private:'do not forward'}));
    emit(delta('<say>Compare the two paths.</say>'));emit(completed);
    emit(usageNotice({inputTokens:9000}));
  });
  const session=createLunaFast({spawnImpl:transport.spawnImpl});
  try{
    const result=await session.respond({}, {onUsage:value=>snapshots.push(value)});
    assert.equal(result.reply,'Compare the two paths.');
    assert.deepEqual(snapshots,[
      {units:{inputTokens:120,outputTokens:4,cachedInputTokens:80,reasoningTokens:2}},
      {units:{inputTokens:120,outputTokens:12,cachedInputTokens:80,reasoningTokens:6}},
    ]);
  }finally{await session.close();}
});

test('unreported usage stays unknown and accounting failures cannot interrupt speech',async()=>{
  for(const withUsage of [false,true]){
    let calls=0;
    const transport=mock(emit=>{if(withUsage)emit(usageNotice({inputTokens:7,outputTokens:3}));emit(delta('A useful answer.'));emit(completed);});
    const session=createLunaFast({spawnImpl:transport.spawnImpl});
    try{
      assert.equal((await session.respond({}, {onUsage(){calls++;throw Error('ledger unavailable');}})).reply,'A useful answer.');
      assert.equal(calls,withUsage?1:0);
    }finally{await session.close();}
  }
});

test('usage arriving before the turn acknowledgment is matched to its confirmed turn',async()=>{
  const snapshots=[];
  const transport=mock(emit=>{emit(delta('Continue.'));emit(completed);},{beforeTurnAck(emit){
    emit(usageNotice({inputTokens:20,outputTokens:4}));
    emit(usageNotice({inputTokens:800},{turnId:'previous-turn'}));
  }});
  const session=createLunaFast({spawnImpl:transport.spawnImpl});
  try{
    await session.respond({}, {onUsage:value=>snapshots.push(value)});
    assert.deepEqual(snapshots,[{units:{inputTokens:20,outputTokens:4}}]);
  }finally{await session.close();}
});

test('token usage observed before cancellation is retained without accepting later notifications',async()=>{
  let emit,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const transport=mock(sender=>{emit=sender;emit(usageNotice({inputTokens:40,outputTokens:2}));started();});
  const session=createLunaFast({spawnImpl:transport.spawnImpl});
  const controller=new AbortController(),snapshots=[];
  try{
    const response=session.respond({}, {signal:controller.signal,onUsage:value=>snapshots.push(value)});
    await ready;controller.abort();await assert.rejects(response,error=>error.status===499);
    emit(usageNotice({inputTokens:40,outputTokens:99}));
    assert.deepEqual(snapshots,[{units:{inputTokens:40,outputTokens:2}}]);
  }finally{await session.close();}
});

test('voice transport signals spoken completion before board generation completes',async()=>{
  const events=[];
  const transport=mock(emit=>{
    emit(delta('<say>Consider this.</sa'));assert.deepEqual(events,[]);
    emit(delta('y>'));assert.deepEqual(events,['speech-end']);
    emit(delta('<board>{"title":"Question","blocks":[{"type":"text","content":"What is the determinant?"}]}</board>'));
    events.push('board-generated');emit(completed);
  });
  const session=createLunaFast({spawnImpl:transport.spawnImpl});
  try{
    const result=await session.respond({}, {onSpeechEnd:()=>events.push('speech-end')});
    assert.deepEqual(events,['speech-end','board-generated']);assert.equal(result.reply,'Consider this.');assert.equal(result.board.title,'Question');
  }finally{await session.close();}
});

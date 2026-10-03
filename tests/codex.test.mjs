import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { cliArguments, cliEnvironment, createCodexOrganizer, runCli } from '../server/codex.mjs';

function mockProcess(onStart=()=>{}) {
  const child=new EventEmitter();
  child.stdin=new PassThrough();
  child.stdout=new PassThrough();
  child.stderr=new PassThrough();
  child.signals=[];
  child.kill=signal=>{child.signals.push(signal);queueMicrotask(()=>child.emit('close',null));return true;};
  let invocation;
  return {
    child,
    get invocation(){return invocation;},
    spawnImpl(binary,args,options){invocation={binary,args,options};queueMicrotask(()=>onStart(child));return child;},
  };
}

const statusIs=status=>error=>error.status===status;

test('CLI environment retains login location but strips provider keys and unrelated secrets',()=>{
  const env={HOME:'/home/study',CODEX_HOME:'/home/study/.codex',PATH:'/bin',LANG:'en_US.UTF-8',OPENAI_API_KEY:'api-secret',ELEVENLABS_API_KEY:'voice-secret',DATABASE_URL:'db-secret',NODE_OPTIONS:'--require injected.cjs',CODEX_BIN:'/custom/codex'};
  assert.deepEqual(cliEnvironment(env),{HOME:env.HOME,CODEX_HOME:env.CODEX_HOME,PATH:env.PATH,LANG:env.LANG});
});

test('CLI arguments pin Luna, read-only execution, isolated files, and stdin input',()=>{
  const directory='/tmp/luna-study-isolated';
  const args=cliArguments(directory);
  const valueAfter=flag=>args[args.indexOf(flag)+1];
  assert.equal(args[0],'exec');
  assert.equal(args.at(-1),'-');
  assert.equal(valueAfter('--model'),'gpt-6-luna');
  assert.equal(valueAfter('--sandbox'),'read-only');
  assert.equal(valueAfter('--cd'),directory);
  assert.equal(valueAfter('--output-schema'),`${directory}/schema.json`);
  assert.equal(valueAfter('--output-last-message'),`${directory}/result.json`);
  for(const flag of ['--ignore-user-config','--ephemeral','--skip-git-repo-check','--json'])assert.ok(args.includes(flag),flag);
  const disabled=args.filter((_,i)=>args[i-1]==='--disable');
  for(const flag of ['shell_tool','unified_exec','apps','plugins','remote_plugin','multi_agent','browser_use','computer_use','hooks','view_image'])assert.ok(disabled.includes(flag),flag);
  const configs=args.filter((_,i)=>args[i-1]==='-c');
  for(const config of ['approval_policy="never"','web_search="disabled"','forced_login_method="chatgpt"','project_doc_max_bytes=0','skills.include_instructions=false'])assert.ok(configs.includes(config),config);
});

test('runCli passes literal stdin without a shell and handles child lifecycle',async t=>{
  await t.test('success preserves input and filters child environment',async()=>{
    const mock=mockProcess(child=>{child.stdout.write('{"type":"turn.completed"}\n');child.stderr.write('private diagnostics');child.emit('close',0);});
    const input='study $(do-not-execute) `literal`\nnotes';
    const result=await runCli('/bin/codex',['exec','-'],{input,env:{HOME:'/home/study',OPENAI_API_KEY:'secret'},spawnImpl:mock.spawnImpl,inspectEvents:true});
    assert.equal(mock.child.stdin.read().toString(),input);
    assert.equal(mock.invocation.options.shell,false);
    assert.deepEqual(mock.invocation.options.env,{HOME:'/home/study'});
    assert.equal(result.output,'{"type":"turn.completed"}\n');
    assert.deepEqual(mock.child.signals,[]);
  });
  await t.test('nonzero exit and spawn failures produce safe errors',async()=>{
    const failed=mockProcess(child=>{child.stderr.write('sensitive failure');child.emit('close',1);});
    await assert.rejects(runCli('codex',[],{spawnImpl:failed.spawnImpl,inspectEvents:true}),error=>error.status===502&&!error.message.includes('sensitive'));
    await assert.rejects(runCli('missing',[],{spawnImpl(){throw new Error('local secret');}}),statusIs(503));
    const errored=mockProcess(child=>child.emit('error',new Error('ENOENT')));
    await assert.rejects(runCli('missing',[],{spawnImpl:errored.spawnImpl}),statusIs(503));
  });
  await t.test('timeout and cancellation terminate the subprocess',async()=>{
    const timed=mockProcess();
    await assert.rejects(runCli('codex',[],{spawnImpl:timed.spawnImpl,timeoutMs:10}),statusIs(504));
    assert.ok(timed.child.signals.includes('SIGTERM'));
    const controller=new AbortController();
    const canceled=mockProcess(()=>controller.abort());
    await assert.rejects(runCli('codex',[],{spawnImpl:canceled.spawnImpl,signal:controller.signal}),statusIs(499));
    assert.ok(canceled.child.signals.includes('SIGTERM'));
    let spawned=false;
    await assert.rejects(runCli('codex',[],{signal:controller.signal,spawnImpl(){spawned=true;}}),statusIs(499));
    assert.equal(spawned,false);
  });
});

test('runCli rejects tool actions across chunks and without a final newline',async()=>{
  for(const type of ['command_execution','mcp_tool_call','web_search','file_change','collab_tool_call']){
    for(const newline of ['\n','']){
      const mock=mockProcess(child=>{
        const event=JSON.stringify({type:'item.started',item:{type}})+newline;
        child.stdout.write(event.slice(0,11));
        child.stdout.write(event.slice(11));
        child.emit('close',0);
      });
      await assert.rejects(runCli('codex',[],{spawnImpl:mock.spawnImpl,inspectEvents:true}),statusIs(502),`${type} ${newline?'newline':'unterminated'}`);
    }
  }
});

test('CLI exposes only completed-turn counters, including final lines without newline',async()=>{
  for(const newline of ['\n','']){
    const calls=[];
    const mock=mockProcess(child=>{
      const event=JSON.stringify({type:'turn.completed',usage:{input_tokens:30,cached_input_tokens:20,output_tokens:5},private:'never forward'})+newline;
      child.stdout.write(event.slice(0,20));child.stdout.write(event.slice(20));child.emit('close',0);
    });
    await runCli('codex',['exec'],{spawnImpl:mock.spawnImpl,inspectEvents:true,onUsage:data=>calls.push(data)});
    assert.deepEqual(calls,[{units:{inputTokens:30,outputTokens:5,cachedInputTokens:20}}]);
  }
});

test('organizer stays unavailable without ChatGPT login and never spawns generation',async()=>{
  let calls=0;
  const mock=mockProcess(child=>{child.stderr.write('Not logged in');child.emit('close',1);});
  const organizer=await createCodexOrganizer({env:{},spawnImpl(...args){calls++;return mock.spawnImpl(...args);}});
  assert.equal(organizer.available,false);
  await assert.rejects(organizer.organize({materials:[]}),statusIs(503));
  assert.equal(calls,1);
  assert.deepEqual(mock.invocation.args,['login','status']);
});

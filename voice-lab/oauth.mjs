import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cliArguments, cliEnvironment } from '../server/codex.mjs';

// A dedicated text-only app-server keeps OAuth inside the signed-in CLI and
// exposes message deltas without waiting for an entire JSON response.
export function createOAuthVoice({ model, instructions, env = process.env }) {
  let child, directory, closed = false, id = 0, buffer = '', active, starting, disabledServers = {};
  const requests = new Map();
  const send = value => { if (!closed && child?.stdin.writable) child.stdin.write(JSON.stringify(value) + '\n'); };
  function request(method, params) {
    if (closed) return Promise.reject(new Error('OAuth session ended.'));
    return new Promise((resolve,reject) => {
      const requestId=++id;const timer=setTimeout(()=>{requests.delete(requestId);reject(new Error('OAuth request timed out.'));},20000);
      requests.set(requestId,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
      send({id:requestId,method,params});
    });
  }
  function receive(m) {
    if (m.id != null && !m.method) { const r=requests.get(m.id);requests.delete(m.id);if(m.error)r?.reject(new Error('The OAuth text model rejected the request.'));else r?.resolve(m.result);return; }
    if (m.id != null) { send({id:m.id,error:{code:-32601,message:'Tools and approvals are disabled in this voice experiment.'}});active?.finish(new Error('The text model attempted an unsupported action.'));return; }
    const p=m.params||{};
    if (!active || p.threadId !== active.threadId) return;
    if (m.method === 'item/agentMessage/delta' && typeof p.delta === 'string') { try { active.onText(p.delta); } catch(e) { active?.finish(e); } }
    if (m.method === 'turn/completed') active.finish(p.turn?.status === 'completed' ? null : new Error('OAuth response did not complete.'));
    if (m.method === 'error' && !p.willRetry) active.finish(new Error('OAuth text generation failed.'));
  }
  async function start() {
    directory=await mkdtemp(path.join(tmpdir(),'luna-voice-lab-'));
    if(closed){await rm(directory,{recursive:true,force:true});throw new Error('Session ended.');}
    const base=`${instructions}\nReturn only the spoken reply as plain text. No JSON or XML. This is a text-only conversation. Do not use tools, files, shell, web, apps, or external actions.`;
    await writeFile(path.join(directory,'instructions.txt'),base,{mode:0o600});
    if(closed){await rm(directory,{recursive:true,force:true});throw new Error('Session ended.');}
    const defaults=cliArguments(directory,model);
    const args=['app-server','--stdio',...defaults.slice(defaults.indexOf('--disable'),-1),...['code_mode','code_mode_host','code_mode_only','code_mode_prewarm','artifact','realtime_conversation','request_permissions_tool'].flatMap(flag=>['--disable',flag]),'-c','mcp_servers={}','-c','notify=[]','-c','model_provider="openai"','-c','developer_instructions=""','-c','service_tier="default"','-c',`model=${JSON.stringify(model)}`];
    child=spawn(env.CODEX_BIN?.trim()||'codex',args,{cwd:directory,env:cliEnvironment(env),stdio:['pipe','pipe','pipe'],shell:false});
    child.stdin.on('error',()=>{});child.stderr.resume();child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      buffer+=chunk;if(buffer.length>2_000_000){void close();return;}
      const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){try{receive(JSON.parse(line));}catch{}}
    });
    child.on('error',()=>void close());child.on('close',()=>void close());
    await request('initialize',{clientInfo:{name:'luna_voice_lab',version:'0.1.0'},capabilities:{experimentalApi:true,requestAttestation:false}});send({method:'initialized',params:{}});
    const {config}=await request('config/read',{includeLayers:false,cwd:directory});
    disabledServers=Object.fromEntries(Object.keys(config.mcp_servers||{}).map(name=>[name,{enabled:false}]));
    return base;
  }
  const ready=()=>starting??=start();
  async function close(){
    if(closed)return;closed=true;active?.finish(new Error('OAuth session ended.'));
    for(const r of requests.values())r.reject(new Error('OAuth session ended.'));requests.clear();
    child?.stdin.end();child?.kill('SIGTERM');if(child){const proc=child;const timer=setTimeout(()=>proc.kill('SIGKILL'),1000);timer.unref();proc.once('close',()=>clearTimeout(timer));}
    if(directory)await rm(directory,{recursive:true,force:true});
  }
  async function respond(messages,{signal,onText}) {
    const base=await ready();if(signal.aborted||closed)throw new DOMException('Canceled','AbortError');
    const result=await request('thread/start',{model,cwd:directory,approvalPolicy:'never',sandbox:'read-only',ephemeral:true,baseInstructions:base,developerInstructions:'',config:{mcp_servers:disabledServers},environments:[],dynamicTools:[],selectedCapabilityRoots:[],serviceTier:'default'});
    const threadId=result.thread.id;
    if(signal.aborted||closed){void request('thread/unsubscribe',{threadId}).catch(()=>{});throw new DOMException('Canceled','AbortError');}
    return new Promise((resolve,reject)=>{
      let done=false,turnId;const abort=()=>finish(new DOMException('Canceled','AbortError'));const timer=setTimeout(()=>finish(new Error('OAuth text response timed out.')),45000);
      function finish(error){if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(active?.threadId===threadId)active=null;if(error&&turnId)void request('turn/interrupt',{threadId,turnId}).catch(()=>{});void request('thread/unsubscribe',{threadId}).catch(()=>{});error?reject(error):resolve();}
      active={threadId,onText,finish};signal.addEventListener('abort',abort,{once:true});
      request('turn/start',{threadId,input:[{type:'text',text:JSON.stringify({messages}),text_elements:[]}],model,effort:'low',summary:'none',environments:[],serviceTierForTurn:'default'}).then(r=>{turnId=r.turn.id;if(done)void request('turn/interrupt',{threadId,turnId}).catch(()=>{});}).catch(finish);
    });
  }
  return {ready,respond,close};
}

// Authorized, bounded synthetic profiling. No microphone, speakers or saved audio.
import {spawn} from 'node:child_process';
import {writeFile,readFile} from 'node:fs/promises';
import {createLunaFast} from './latency-round2-experimental.mjs';
import {createSpeechStream,createSpeechTextBuffer} from '../server/speech-stream.mjs';
import {applyBoardUpdate} from '../server/whiteboard.mjs';
import { createUsageBudget } from './usage-budget.mjs';
const usage = await createUsageBudget({ name: 'latency-round2-prewarm.mjs', maxRequests: 10, sttSessionMaxSeconds: 0, ttsModels: [process.env.ELEVENLABS_REALTIME_MODEL_ID?.trim() || 'eleven_v4_turbo'] });
const out=new URL('./latency-round2-results.json',import.meta.url);
const round=n=>Math.round(n*10)/10;
const report=JSON.parse(await readFile(out,'utf8'));
if(report.providerRequests!==4)throw Error('This follow-up expects exactly four earlier requests; do not rerun automatically.');
const input=report.input;
let origin=performance.now(),rpcLog=[],pending=new Map(),childCount=0;
function instrumentedSpawn(...args){const child=spawn(...args),childKey=++childCount,write=child.stdin.write.bind(child.stdin);let output='';child.stdin.write=(chunk,...rest)=>{try{const message=JSON.parse(String(chunk));if(message.id!==undefined&&message.method)pending.set(`${childKey}:${message.id}`,{method:message.method,atMs:round(performance.now()-origin),began:performance.now(),inputBytes:Buffer.byteLength(String(chunk))});}catch{}return write(chunk,...rest);};child.stdout.on('data',chunk=>{output+=String(chunk);const lines=output.split('\n');output=lines.pop();for(const line of lines){let message;try{message=JSON.parse(line);}catch{continue;}const entry=pending.get(`${childKey}:${message.id}`);if(entry){pending.delete(`${childKey}:${message.id}`);rpcLog.push({method:entry.method,atMs:entry.atMs,durationMs:round(performance.now()-entry.began),inputBytes:entry.inputBytes});}}});return child;}
const sessions={current:createLunaFast({spawnImpl:instrumentedSpawn}),prewarmed:createLunaFast({spawnImpl:instrumentedSpawn,prewarmThread:true})};
const save=()=>writeFile(out,JSON.stringify(report,null,2)+'\n');
async function profile(index,condition){
 const luna=sessions[condition];if(report.providerRequests+2>24)throw Error('Provider budget exhausted.');
 origin=performance.now();rpcLog=[];let firstPcmMs=null,bytes=0,firstTextMs=null,meaningfulTextMs=null,partial='',endResolve,endReject;const writes=[],events=[];
 const done=new Promise((r,j)=>{endResolve=r;endReject=j;});done.catch(()=>{});
 const controller=new AbortController();
 report.providerRequests++;
 const speech=createSpeechStream({WebSocketImpl: usage.WebSocket,env:process.env,voice:process.env.ELEVENLABS_VOICE_ID||'JBFqnCBsd6RMkjVDRZzb',model:process.env.ELEVENLABS_REALTIME_MODEL_ID||'eleven_v4_turbo',signal:controller.signal,onAudio(audio){bytes+=Buffer.byteLength(audio,'base64');firstPcmMs??=round(performance.now()-origin);},onEnd:endResolve,onError:()=>endReject(Error('TTS provider failed.'))});
 const chunks=createSpeechTextBuffer(text=>{writes.push({atMs:round(performance.now()-origin),text});speech.write(text);});
 try{
  report.providerRequests++;const result=await luna.respond(input,{effort:'low',timeoutMs:45000,onText(text){const atMs=round(performance.now()-origin);events.push({type:'text',atMs,text});partial+=text;firstTextMs??=atMs;if(partial.replace(/^\s*(?:Consider this\.?\s*)?/i,'').trim().length>8)meaningfulTextMs??=atMs;chunks.push(text);},onSpeechEnd(){events.push({type:'say-end',atMs:round(performance.now()-origin)});chunks.finish();}});
  const modelCompleteMs=round(performance.now()-origin);chunks.finish();speech.finish();await done;
  const sample={index,condition,firstTextMs,firstMeaningfulTextMs:meaningfulTextMs,firstWriteMs:writes[0]?.atMs,firstPcmMs,modelCompleteMs,boardReadyMs:result.board?modelCompleteMs:null,completeAudioMs:round(performance.now()-origin),generatedAudioMs:round(bytes/48000*1000),reply:result.reply,board:result.board||null,timings:result.timings,ttsTimings:speech.timing,rpc:rpcLog,writes,events};report.experiments[1].samples.push(sample);await save();console.log(JSON.stringify({index,condition,firstTextMs,firstMeaningfulTextMs:meaningfulTextMs,firstPcmMs,modelCompleteMs,board:!!result.board,rpc:rpcLog}));
 }finally{controller.abort();speech.cancel();}
}
try{
 if(process.env.LUNA_CLI_MODEL&&process.env.LUNA_CLI_MODEL!=='gpt-5.6-luna')throw Error('Configured model differs from authorized baseline.');if(!process.env.ELEVENLABS_API_KEY)throw Error('Missing TTS configuration.');
 report.experiments.push({name:'fresh-thread-prewarm',samples:[],startup:[]});
 for(const [condition,session] of Object.entries(sessions)){const began=performance.now();await session.ready();report.experiments[1].startup.push({condition,ms:round(performance.now()-began)});}
 for(let i=0;i<5;i++){const order=i%2?['prewarmed','current']:['current','prewarmed'];for(const condition of order)await profile(i,condition);}
}catch{report.error='A bounded profile failed; no automatic retry.';process.exitCode=1;}
finally{report.usageBudget=await usage.finish();await Promise.all(Object.values(sessions).map(session=>session.close()));report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({requests:report.providerRequests,startupMs:report.startupMs,error:report.error}));}

// Explicitly authorized bounded synthetic live-provider benchmark.
// No microphone, browser, speakers, or saved audio. Returned PCM is discarded.
import { writeFile } from 'node:fs/promises';
import { createLunaFast } from '../server/luna-fast.mjs';
import { createSpeechStream, createSpeechTextBuffer } from '../server/speech-stream.mjs';
import { createUsageBudget } from './usage-budget.mjs';
const usage = await createUsageBudget({ name: 'latency-iteration.mjs', maxRequests: 12, sttSessionMaxSeconds: 0, ttsModels: [process.env.ELEVENLABS_REALTIME_MODEL_ID?.trim() || 'eleven_v4_turbo'] });

const report = {
  startedAt: new Date().toISOString(), location: 'New York, USA',
  microphoneUsed: false, playbackUsed: false, audioSaved: false,
  method: 'Capture actual Luna decoded text delta timing with synthetic study inputs. Replay identical trace timing through real ElevenLabs TTS, opened concurrently at turn start. Measure request-start-to-first-returned-PCM; this isolates buffering and excludes STT, physical audio capture/playback, onboarding and Jev. Baseline ignores parsed say-end event; candidate flushes text buffer when say closes. Later cycles vary word-boundary chunk threshold only. Two trials per condition in ABBA order. No raw provider messages, credentials or audio are saved.',
  traces: [], cycles: [],
};
const output = new URL('./latency-iteration-results.json', import.meta.url);
const round = n => Math.round(n * 10) / 10;
const delay = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
const median = values => { const sorted = [...values].sort((a,b) => a-b); return sorted.length ? sorted.length % 2 ? sorted[Math.floor(sorted.length/2)] : (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2 : null; };
const voice = process.env.ELEVENLABS_VOICE_ID?.trim() || 'JBFqnCBsd6RMkjVDRZzb';
const model = process.env.ELEVENLABS_REALTIME_MODEL_ID?.trim() || 'eleven_v4_turbo';
const luna = createLunaFast();
const fixtures = [
  { id: 'visual-tail', input: { examTitle: 'Synthetic linear algebra quiz', materials: [{ name: 'Synthetic matrix notes', text: 'Practice matrix A has first row 1, 2 and second row 3, 4. For a two by two matrix with rows a, b and c, d, the determinant is a times d minus b times c.' }], conversation: [{ role: 'user', content: 'Show the practice matrix on the board without its answer. For the spoken part, just say Consider this.' }] } },
  { id: 'long-sentence', input: { examTitle: 'Synthetic transport quiz', materials: [{ name: 'Synthetic transport notes', text: 'Passive transport moves substances down a concentration gradient without energy. Active transport uses energy to move substances against the concentration gradient, including from a lower concentration to a higher concentration.' }], conversation: [{ role: 'user', content: 'In one sentence, explain the difference between passive and active transport including energy use and direction.' }] } },
];
async function save() { await writeFile(output, JSON.stringify(report, null, 2)+'\n'); }
async function capture(fixture) {
  const began = performance.now(), events=[];
  const result = await luna.respond(fixture.input, { timeoutMs: 30000, onText(text) { events.push({ type: 'text', atMs: round(performance.now()-began), text }); }, onSpeechEnd() { events.push({ type: 'say-end', atMs: round(performance.now()-began) }); } });
  events.push({ type: 'complete', atMs: round(performance.now()-began) });
  const trace = { id: fixture.id, input: fixture.input, reply: result.reply, board: result.board || null, timings: result.timings, events };
  report.traces.push(trace); await save(); console.log(JSON.stringify({ trace: trace.id, reply: trace.reply, boardPresent: Boolean(trace.board), events: trace.events.length, timings: trace.timings }));
  return trace;
}
function thresholdBuffer(write, threshold) {
  let pending='';
  const original=createSpeechTextBuffer(write);
  return { push(text) { pending+=text; while(pending.length>threshold) {const at=pending.lastIndexOf(' ',threshold);if(at<16)break; original.push(pending.slice(0,at+1)); original.finish(); pending=pending.slice(at+1); } }, finish() { original.push(pending);original.finish();pending=''; } };
}
async function replay(trace, variant) {
  const began = performance.now(); let firstAudioMs=null, outputAudioBytes=0;
  const writes=[]; let resolveEnd,rejectEnd;
  const complete=new Promise((resolve,reject)=>{resolveEnd=resolve;rejectEnd=reject;});
  complete.catch(()=>{}); // Budget/provider failure may arrive before trace replay reaches its final await.
  const controller=new AbortController();
  const timeout=setTimeout(()=>{controller.abort();rejectEnd(Error('TTS replay exceeded 30 seconds.'));},30000);
  const speech=createSpeechStream({WebSocketImpl: usage.WebSocket,env:process.env,voice,model,signal:controller.signal,onAudio(audio){const bytes=Buffer.byteLength(audio,'base64');if(bytes){firstAudioMs??=round(performance.now()-began);outputAudioBytes+=bytes;}},onEnd:resolveEnd,onError:message=>rejectEnd(Error(message))});
  const write=text=>{writes.push({atMs:round(performance.now()-began),text});speech.write(text);};
  const chunks=variant.threshold ? thresholdBuffer(write,variant.threshold) : createSpeechTextBuffer(write);
  try {
    for(const event of trace.events) {
      await delay(began+event.atMs-performance.now());
      if(event.type==='text')chunks.push(event.text);
      if(event.type==='say-end'&&variant.sayEnd)chunks.finish();
      if(event.type==='complete'){chunks.finish();speech.finish();}
    }
    await complete;
    return { variant: variant.name, firstAudioMs, firstWriteMs:writes[0]?.atMs ?? null, firstWriteToAudioMs:firstAudioMs!==null?round(firstAudioMs-writes[0].atMs):null, outputAudioBytes, ttsTiming:speech.timing, writes };
  } finally {clearTimeout(timeout);speech.cancel();}
}
async function cycle(number,trace,a,b) {
  const entry={number,traceId:trace.id,runs:[]};report.cycles.push(entry);
  for(const variant of [a,b,b,a]) {const result=await replay(trace,variant);entry.runs.push(result);await save();console.log(JSON.stringify({cycle:number,variant:result.variant,firstAudioMs:result.firstAudioMs,firstWriteMs:result.firstWriteMs}));}
  entry.summary=[a,b].map(variant=>{const rows=entry.runs.filter(run=>run.variant===variant.name);return {variant:variant.name,trials:rows.length,medianFirstAudioMs:round(median(rows.map(row=>row.firstAudioMs))),medianFirstWriteMs:round(median(rows.map(row=>row.firstWriteMs)))};});
  entry.medianReductionMs=round(entry.summary[0].medianFirstAudioMs-entry.summary[1].medianFirstAudioMs);await save();
}
try {
  if(!process.env.ELEVENLABS_API_KEY)throw Error('Missing ElevenLabs configuration.');
  const started=performance.now();await luna.ready();report.startupMs=round(performance.now()-started);report.lunaModel=luna.model;report.ttsModel=model;
  const visual=await capture(fixtures[0]);
  await cycle(1,visual,{name:'baseline-complete-flush',sayEnd:false},{name:'say-end-flush',sayEnd:true});
  const explanatory=await capture(fixtures[1]);
  await cycle(2,explanatory,{name:'say-end-flush',sayEnd:true},{name:'60-character-word-boundary',sayEnd:true,threshold:60});
  await cycle(3,explanatory,{name:'60-character-word-boundary',sayEnd:true,threshold:60},{name:'32-character-word-boundary',sayEnd:true,threshold:32});
} catch(error) { report.error=String(error.message).replaceAll(process.env.ELEVENLABS_API_KEY||'NOT_SET','[redacted]').slice(0,500);process.exitCode=1; }
finally {report.usageBudget=await usage.finish();await luna.close();report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({cycles:report.cycles.map(({number,summary,medianReductionMs})=>({number,summary,medianReductionMs})),error:report.error}));}

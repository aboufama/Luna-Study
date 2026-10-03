// Shared, device-free probe for matched voice comparisons. This file performs
// no provider requests by itself. A separately budgeted runner supplies PCM
// and an isolated local adapter; returned audio is counted, never played.
import {EventEmitter} from 'node:events';
import {performance} from 'node:perf_hooks';
import WebSocket from 'ws';

const round = value => Number(value.toFixed(1));
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, Math.max(0, milliseconds)));
const PUBLIC_TYPES = new Set(['ready','state','transcript','audio-end','interrupt','latency','canvas','hint-state','practice-state','mastery','paused','resumed','setup-date','error','usage','live-usage','delegation','voice-debug']);

export function speechEnergyEnd(pcm, {sampleRate = 16000, rmsThreshold = 160} = {}) {
  if (!Buffer.isBuffer(pcm) || !pcm.length || pcm.length % 2) throw Error('Expected nonempty signed 16-bit mono PCM.');
  const window = Math.max(2, Math.floor(sampleRate / 100) * 2);
  let end = 0;
  for (let offset = 0; offset < pcm.length; offset += window) {
    const limit = Math.min(offset + window, pcm.length);
    let sum = 0;
    for (let index = offset; index < limit; index += 2) sum += pcm.readInt16LE(index) ** 2;
    if (Math.sqrt(sum / ((limit - offset) / 2)) > rmsThreshold) end = limit;
  }
  return end;
}

export function summarizeLatencies(rows, field = 'energySpeechEndToFirstAudioMs') {
  const values = rows.filter(row => row.status === 'complete' && Number.isFinite(row[field])).map(row => row[field]).sort((a,b) => a-b);
  if (!values.length) return {n:0, median:null, minimum:null, maximum:null};
  const middle = Math.floor(values.length / 2);
  return {n:values.length, median:round(values.length % 2 ? values[middle] : (values[middle-1] + values[middle]) / 2), minimum:values[0], maximum:values.at(-1)};
}

export function auditSpokenFidelity(events,{normalize=text=>String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim(),normalization='punctuation-and-case-only',matchApprovedBody}={}) {
  const phases=[...new Set(events.filter(event=>event.type==='transcript'&&event.role==='assistant'&&event.final).map(event=>event.phase))];
  return phases.map(phase=>{
    const selected=events.filter(event=>event.phase===phase);
    const approved=selected.filter(event=>event.type==='transcript'&&event.role==='assistant'&&event.final&&event.source!=='gpt-live-spoken').map(event=>event.text).join(' ');
    const voice=selected.filter(event=>event.type==='voice-debug'&&event.eventType==='live-output-transcript');
    const providerTranscript=voice.map(event=>event.delta||'').join('');
    const transcriptWhileDeliveryActive=voice.filter(event=>event.deliveredStreamActive).map(event=>event.delta||'').join('');
    const exactReportedTextMatch=voice.length?normalize(approved)===normalize(transcriptWhileDeliveryActive):null;
    const approvedBodyMatch=voice.length?(matchApprovedBody?matchApprovedBody(approved,transcriptWhileDeliveryActive):exactReportedTextMatch):null;
    return {phase,approved,providerTranscript,transcriptWhileDeliveryActive,normalization,
      trimmedLiteralTextMatch:voice.length?approved.trim()===transcriptWhileDeliveryActive.trim():null,
      exactReportedTextMatch,approvedBodyMatch,allowedNeutralPrefixApplied:approvedBodyMatch===true&&exactReportedTextMatch===false,
      approximateAudioEnd:selected.some(event=>event.type==='audio-end'&&event.approx),
      limitation:'Provider text deltas and audio packets have separate arrival times. Active-stream membership is an exposure warning, not proof that every corresponding sound was played. Exact normalized match is a fidelity check, not a semantic grading score.',
    };
  });
}

export function deriveTrialMetrics(events, input) {
  const after = events.filter(event => event.atMs >= input.startedAtMs);
  const user = after.find(event => event.type === 'transcript' && event.role === 'user' && event.final);
  const firstText = after.find(event => event.type === 'transcript' && event.role === 'assistant' && event.text?.trim());
  const firstAudio = after.find(event => event.type === 'audio' && event.bytes > 0);
  const final = after.find(event => event.type === 'transcript' && event.role === 'assistant' && event.final && event.text?.trim());
  const audioEnd = after.find(event => event.type === 'audio-end' && (final?.turnId === undefined || event.turnId === final.turnId));
  const delta = (event, time) => event && Number.isFinite(time) ? round(event.atMs-time) : null;
  return {
    committedUserMs:user?.atMs ?? null, firstAssistantTextMs:firstText?.atMs ?? null,
    firstAudioMs:firstAudio?.atMs ?? null, finalAssistantTextMs:final?.atMs ?? null, audioEndMs:audioEnd?.atMs ?? null,
    energySpeechEndToCommitMs:delta(user,input.energySpeechEndAtMs), energySpeechEndToFirstTextMs:delta(firstText,input.energySpeechEndAtMs),
    energySpeechEndToFirstAudioMs:delta(firstAudio,input.energySpeechEndAtMs), pcmEndToFirstAudioMs:delta(firstAudio,input.pcmEndAtMs),
    commitToFirstAudioMs:delta(firstAudio,user?.atMs),
    outputAudioBytes:after.filter(event => event.type === 'audio').reduce((sum,event) => sum+event.bytes,0),
    outputAudioChunks:after.filter(event => event.type === 'audio').length,
    userTranscripts:after.filter(event => event.type === 'transcript' && event.role === 'user' && event.final).map(event => event.text),
    assistantTranscripts:after.filter(event => event.type === 'transcript' && event.role === 'assistant' && event.final&&event.source!=='gpt-live-spoken').map(event => event.text),
    actualSpokenTranscripts:after.filter(event => event.type === 'transcript' && event.role === 'assistant' && event.final&&event.source==='gpt-live-spoken').map(event => event.text),
    // First audio can be an acknowledgement or filler. It is never silently
    // relabeled as the first useful academic answer.
    firstUsefulAudioMs:null, usefulAudioAnnotation:'Not inferable from packet arrival alone; annotate aligned public transcript/audio before claiming a useful-answer latency.',
    outputOverlapsInput:Boolean(firstAudio && firstAudio.atMs < input.energySpeechEndAtMs),
  };
}

export async function createAudioProbe({origin, path='/api/live-voice', start, WebSocketImpl=WebSocket, mapInbound=packet=>packet, mapOutbound=packet=>packet, timeoutMs=60_000, onEvent=()=>{}}) {
  const parsed = new URL(origin);
  if (parsed.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(parsed.hostname) || parsed.username || parsed.password) throw Error('Benchmark only connects to an explicit loopback HTTP origin.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw Error('Probe session ceiling must be at most 120 seconds.');
  const began = performance.now(), events = [], changes = new EventEmitter();
  let closed = false, failure = null, phase = 'startup', receivedAudio = 0, replaying = false, silencePump, playbackUntilMs=0;
  const elapsed = () => round(performance.now()-began);
  const record = {origin:parsed.origin,path,timeoutMs,microphoneUsed:false,playbackUsed:false,audioSaved:false,events,trials:[],startedAt:new Date().toISOString()};
  const socket = new WebSocketImpl(`${origin.replace(/^http:/,'ws:')}${path}`,{origin:parsed.origin,handshakeTimeout:5000,maxPayload:3*1024*1024});
  const timer = setTimeout(() => {failure='Probe session duration ceiling reached.'; close();},timeoutMs);
  function add(event) { const value={...event,atMs:elapsed(),phase};events.push(value);try{onEvent(value);}catch{}changes.emit('change'); }
  function send(packet) {
    if (closed || socket.readyState !== WebSocket.OPEN) throw Error('Probe socket is not open.');
    const output=mapOutbound(packet);
    if (output !== undefined && output !== null) socket.send(typeof output === 'string' || Buffer.isBuffer(output) ? output : JSON.stringify(output));
  }
  function close() {
    if (closed) return;
    closed=true;clearTimeout(timer);clearInterval(silencePump);
    if (socket.readyState === WebSocket.OPEN) {
      try {const stop=mapOutbound({type:'stop'});if(stop!=null)socket.send(typeof stop==='string'?stop:JSON.stringify(stop));}catch{}
      socket.close();
      const teardown=setTimeout(()=>socket.terminate(),1000);teardown.unref?.();socket.once('close',()=>clearTimeout(teardown));
    } else socket.terminate();
    record.finishedAt=new Date().toISOString();record.sessionElapsedMs=elapsed();record.failure=failure;record.receivedAudioBytes=receivedAudio;changes.emit('change');
  }
  function waitFor(predicate,{waitMs=15_000,label='expected event'}={}) {
    return new Promise((resolve,reject)=>{
      let waitTimer;
      const check=()=>{
        const value=predicate(events);
        if(value){clearTimeout(waitTimer);changes.removeListener('change',check);resolve(value);}
        else if(closed||failure){clearTimeout(waitTimer);changes.removeListener('change',check);reject(Error(failure||'Probe closed before '+label));}
      };
      changes.on('change',check);
      waitTimer=setTimeout(()=>{changes.removeListener('change',check);reject(Error('Timed out waiting for '+label));},waitMs);
      check();
    });
  }
  socket.on('open',()=>{add({type:'connected'});send({type:'start',...start});});
  socket.on('message',(bytes,isBinary)=>{
    try {
      const mapped=mapInbound(isBinary?bytes:JSON.parse(bytes.toString()));
      for (const packet of Array.isArray(mapped)?mapped:[mapped]) {
        if (!packet || typeof packet.type !== 'string') continue;
        if (packet.type === 'audio' && packet.audio) {
          const length=Buffer.byteLength(packet.audio,'base64');receivedAudio+=length;
          playbackUntilMs=Math.max(elapsed(),playbackUntilMs)+length/((packet.sampleRate??24000)*2)*1000;
          add({type:'audio',turnId:packet.turnId,bytes:length,sampleRate:packet.sampleRate??24000});
        } else if (PUBLIC_TYPES.has(packet.type)) add(packet);
        if(packet.type==='interrupt')playbackUntilMs=elapsed();
        // A user could retry a recoverable error; benchmark trials never do so
        // silently. Preserve the failure and stop this paid trial immediately.
        if(packet.type==='error') {failure=String(packet.message||'Voice adapter error').slice(0,500);changes.emit('change');}
      }
    } catch {failure='Invalid adapter event.';changes.emit('change');}
  });
  socket.on('error',()=>{failure='Local probe WebSocket failed.';changes.emit('change');});
  socket.on('unexpected-response',(_,response)=>{response.resume();failure=`Local adapter rejected connection (HTTP ${response.statusCode}).`;close();});
  socket.on('close',()=>{if(!closed){failure??='Local adapter closed.';close();}});
  try {
    await waitFor(list=>list.find(event=>event.type==='ready'),{label:'voice readiness'});
    // GPT-Live is a continuous duplex clock: output can stall if input stops.
    // Keep real-time silence flowing during startup and backend/voice output,
    // while reserving the same cadence for the actual student utterance.
    const silence=Buffer.alloc(3200).toString('base64');
    silencePump=setInterval(()=>{if(!closed&&!replaying&&socket.readyState===WebSocket.OPEN){try{send({type:'audio',audio:silence});}catch{}}},100);
  }
  catch(error){close();throw error;}
  return {
    record,send,close,waitFor,
    async drainPlayback(){
      const target=playbackUntilMs;
      await delay(Math.max(0,Math.min(timeoutMs-elapsed(),target-elapsed())));
      if(closed||failure)throw Error(failure||'Probe closed before simulated playback drained.');
      return target;
    },
    async drainGreeting({waitMs=15_000}={}) {
      const end=await waitFor(list=>list.find(event=>event.type==='audio-end'),{waitMs,label:'startup greeting audio-end'});
      await this.drainPlayback();await delay(300);record.greetingEndMs=end.atMs;record.greetingPlaybackDrainMs=elapsed();return end;
    },
    async utterance({id,text,pcm,sampleRate=16000,maxSilenceMs=5000,replyTimeoutMs=20_000,interruptAfterAudioMs=null}) {
      if(sampleRate!==16000||!Buffer.isBuffer(pcm)||!pcm.length||pcm.length%2||pcm.length>sampleRate*2*12)throw Error('Trial input must be at most 12 seconds of 16kHz signed 16-bit mono PCM.');
      if(maxSilenceMs<0||maxSilenceMs>8000||replyTimeoutMs>30000)throw Error('Trial timeout exceeds the bounded audio probe limits.');
      phase=id;const cursor=events.length,trial={id,expectedUserText:text,status:'running',startedAtMs:elapsed(),inputPcmBytes:pcm.length,sampleRate,pcmEndAtMs:null,energySpeechEndAtMs:null};
      record.trials.push(trial);
      const bps=sampleRate*2,chunkBytes=bps/10,energyEnd=speechEnergyEnd(pcm,{sampleRate}),streamStart=performance.now();
      if(!energyEnd)throw Error('Trial input contains no detectable speech.');
      try {
        replaying=true;
        let sent=0;
        for(let offset=0;offset<pcm.length+maxSilenceMs/1000*bps;offset+=chunkBytes){
          if(events.slice(cursor).some(event=>event.type==='transcript'&&event.role==='user'&&event.final)&&offset>=pcm.length)break;
          const speech=offset<pcm.length,chunk=speech?pcm.subarray(offset,Math.min(offset+chunkBytes,pcm.length)):Buffer.alloc(chunkBytes);sent+=chunk.length;
          await delay(streamStart+sent/bps*1000-performance.now());
          const at=elapsed();
          if(speech&&offset<energyEnd&&offset+chunk.length>=energyEnd)trial.energySpeechEndAtMs=round(at-(offset+chunk.length-energyEnd)/bps*1000);
          send({type:'audio',audio:chunk.toString('base64')});
          if(speech&&offset+chunk.length>=pcm.length)trial.pcmEndAtMs=at;
        }
        replaying=false;
        if(interruptAfterAudioMs!==null){
          await waitFor(list=>list.slice(cursor).find(event=>event.type==='audio'),{waitMs:replyTimeoutMs,label:'audio to interrupt'});
          await delay(interruptAfterAudioMs);trial.interruptedAtMs=elapsed();send({type:'interrupt'});
          await delay(300);trial.status='interrupted';
        }else{
          await waitFor(list=>{
            const current=list.slice(cursor),final=current.find(event=>event.type==='transcript'&&event.role==='assistant'&&event.final);
            return final&&current.find(event=>event.type==='audio-end'&&(final.turnId===undefined||event.turnId===final.turnId));
          },{waitMs:replyTimeoutMs,label:'final assistant transcript and audio-end'});
          trial.status='complete';
        }
      } catch(error){trial.status='failed';trial.error=error.message;}
      finally{replaying=false;}
      Object.assign(trial,deriveTrialMetrics(events.slice(cursor),trial));trial.estimatedPlaybackEndMs=round(playbackUntilMs);trial.finishedAtMs=elapsed();phase='between-trials';return trial;
    },
  };
}

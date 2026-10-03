import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_FILE = fileURLToPath(new URL('../data/diagnostics.json', import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_TYPES = new Set(['import.started','import.extracted','import.duplicate','import.failed','import.completed','index.started','index.ready','index.failed']);
const STRINGS = new Set(['reason','phase','source','candidateStatus','boardRevision','indexStatus','transport','reply','stage','model','operation','errorCode','fileName','fileType','requestId']);
const NUMBERS = new Set(['probability','closeProbability','reopenProbability','replaceProbability','latencyMs','sourceCount','characters','durationMs','fileBytes','added','duplicates','failed','total','inputAudioMs','outputAudioMs','speechCharacters','turnId']);
const BOOLEANS = new Set(['visible','needsCanvas','shouldClose','shouldReopen','shouldReplace','hasBoard','studyReady']);
const ARRAYS = new Set(['sourceIds','candidateTypes','missing']);
const clean = (value, max = 2000) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0,max) : '';

function safeDetails(value, client) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key,item] of Object.entries(value)) {
    if (STRINGS.has(key) && typeof item === 'string' && (!client || !['reply','requestId'].includes(key))) result[key] = clean(item, key === 'reply' ? 1800 : 500);
    else if (NUMBERS.has(key) && Number.isFinite(item) && item >= 0) result[key] = item;
    else if (BOOLEANS.has(key) && typeof item === 'boolean') result[key] = item;
    else if (ARRAYS.has(key) && Array.isArray(item)) result[key] = item.filter(x=>typeof x==='string').slice(0,100).map(x=>clean(x,128));
    // Only server-validated, public board output belongs in this field.
    else if (!client && key === 'boardJson' && typeof item === 'string') result[key] = clean(item,20000);
  }
  return result;
}

/** Local debug timeline. Never accepts document bodies, credentials, raw provider
 * responses, audio, or hidden reasoning. Client events are explicitly labeled. */
export function createDiagnostics({ file = DEFAULT_FILE, now = Date.now, maxEvents = 500, maxTotalEvents = 4000 } = {}) {
  let events = [], omitted = {}, trackingStartedAt = new Date(now()).toISOString(), storageError = null, timer;
  let tasks = Promise.resolve(), writes = Promise.resolve();
  const ready = (async()=>{
    try {
      const data = JSON.parse(await readFile(file,'utf8'));
      if (data.version !== 1 || !Array.isArray(data.events)) throw Error('Unsupported diagnostics file');
      events = data.events; omitted = data.omitted || {}; trackingStartedAt = data.trackingStartedAt || trackingStartedAt;
    } catch (error) { if (error.code !== 'ENOENT') storageError = 'Debug history could not be read; existing data was preserved.'; }
  })();
  function persist() {
    clearTimeout(timer); timer = null;
    writes = writes.then(async()=>{
      await ready;
      if (storageError) return;
      try {
        await mkdir(dirname(file),{recursive:true,mode:0o700});
        const temp = `${file}.${randomUUID()}.tmp`;
        await writeFile(temp,JSON.stringify({version:1,trackingStartedAt,events,omitted}),{mode:0o600});
        await rename(temp,file);
      } catch { storageError = 'Debug history could not be saved; current events are available in memory only.'; }
    });
    return writes;
  }
  function record(testId, event = {}, client = false) {
    if (!UUID.test(testId || '') || !/^[a-z][a-z0-9.-]{0,70}$/.test(event.type || '') || (client && !CLIENT_TYPES.has(event.type))) return false;
    const entry = { id:randomUUID(), testId, at:new Date(now()).toISOString(), origin:client?'client':'server', type:event.type, details:safeDetails(event.details,client) };
    if (!client && typeof event.sessionId === 'string') entry.sessionId = clean(event.sessionId,160);
    if (!client && Number.isInteger(event.turnId) && event.turnId >= 0) entry.turnId = event.turnId;
    tasks = tasks.then(async()=>{
      await ready;
      events.push(entry);
      while (events.filter(e=>e.testId===testId).length > maxEvents) {
        events.splice(events.findIndex(e=>e.testId===testId),1); omitted[testId] = (omitted[testId]||0)+1;
      }
      while (events.length > maxTotalEvents) { const old=events.shift(); omitted[old.testId]=(omitted[old.testId]||0)+1; }
      if (!timer) { timer=setTimeout(()=>void persist(),500); timer.unref?.(); }
    });
    return true;
  }
  return {
    record,
    clientRecord:(testId,event)=>record(testId,event,true),
    async read(testId) { await ready; await tasks; return structuredClone({testId,trackingStartedAt,events:events.filter(e=>e.testId===testId),truncated:Boolean(omitted[testId]),omittedEvents:omitted[testId]||0,storageError,measurement:'Server events describe generated or transmitted content, not confirmed speaker playback. Client import events are browser-reported. Prior sessions remain in session-history.json.'}); },
    async flush() { await ready; await tasks; await persist(); await writes; },
  };
}

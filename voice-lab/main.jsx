import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, AudioLines, Check, ChevronRight, Download, FlaskConical, Headphones, Mic, Settings2, Square, Upload, X } from 'lucide-react';
import { PROVIDERS, PROMPT, SCENARIOS } from './catalog.mjs';
import { VoiceSession } from './audio.mjs';
import './style.css';

const displayMs = n => Number.isFinite(n) ? `${(n / 1000).toFixed(2)} s` : '—';
function Mosaic({ variant = 0, live = false }) {
  const tiles = [];
  for (let x = 0; x < 29; x++) for (let y = 0; y < 13; y++) {
    const amplitude = 2 + Math.sin(x * 0.36 + variant * 0.8) * 1.9 + Math.sin(x * 0.83 + variant) * 1.25;
    if (Math.abs(y - 6) < amplitude && ((x * 17 + y * 7 + variant * 3) % 19 !== 0)) tiles.push(<rect key={`${x}-${y}`} x={x * 7.6 + 1} y={y * 7.6 + 1} width="6.1" height="6.1" rx="1.1" opacity={0.32 + ((x * 7 + y * 11) % 9) / 15} style={{ '--delay': `${(x * 0.08 + y * 0.12)}s` }} />);
  }
  return <svg className={`mosaic ${live ? 'live' : ''}`} viewBox="0 0 223 100" aria-hidden="true">{tiles}</svg>;
}
function App() {
  const [selected, setSelected] = useState('local'); const [status, setStatus] = useState(null);
  const [running, setRunning] = useState(false); const [ready, setReady] = useState(false); const [stage, setStage] = useState('Ready when you are');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [rows, setRows] = useState([]);
  const [measurements, setMeasurements] = useState([]); const [timings, setTimings] = useState({}); const [warmup, setWarmup] = useState(null);
  const [connections, setConnections] = useState(false); const [research, setResearch] = useState(false); const [inventory, setInventory] = useState([]);
  const [keys, setKeys] = useState({}); const [llm, setLlm] = useState('codex'); const [prompt, setPrompt] = useState(PROMPT);
  const [modelOverrides, setModelOverrides] = useState({}); const [textModel, setTextModel] = useState(''); const [silenceMs, setSilenceMs] = useState(700); const [stt, setStt] = useState('whisper');
  const [scenario, setScenario] = useState(0); const [rating, setRating] = useState({ natural: '', interrupt: '' });
  const [load, setLoad] = useState(''); const session = useRef(null); const stageRef = useRef(null); const transcriptEnd = useRef(null);
  const selectedProvider = PROVIDERS.find(p => p.id === selected);
  const available = name => Boolean(keys[name]?.trim() || status?.keys?.[name]);
  const missing = selectedProvider.needs.filter(k => !available(k));
  if (selected === 'local' && llm !== 'codex' && !available(llm === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY')) missing.push(llm === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY');
  const current = measurements.filter(m => m.provider === selected);
  const median = values => { if (!values.length) return null; const s = values.slice().sort((a,b) => a-b); return (s[Math.floor((s.length-1)/2)] + s[Math.ceil((s.length-1)/2)])/2; };
  useEffect(() => { fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => setError('The voice lab server is not available.')); fetch('/api/research').then(r=>r.json()).then(x=>setInventory(x.repositories)).catch(()=>{}); return () => session.current?.stop(); }, []);
  useEffect(() => { transcriptEnd.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' }); }, [rows]);
  useEffect(() => { const stop = () => session.current?.stop(); window.addEventListener('pagehide',stop); return () => window.removeEventListener('pagehide',stop); }, []);
  useEffect(() => {
    if (!connections) return;
    const previous=document.activeElement;const dialog=document.querySelector('[role="dialog"]');
    const focusable=()=>[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href]')];focusable()[0]?.focus();
    const key=e=>{if(e.key==='Escape')setConnections(false);if(e.key==='Tab'){const items=focusable(),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
    document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};
  },[connections]);
  function stop() { session.current?.stop(); session.current = null; setRunning(false); setReady(false); setStage('Session ended'); setLoad(''); }
  function choose(id) { if (id === selected) return; stop(); setSelected(id); setRating({ natural: '', interrupt: '' }); setStage('Ready when you are'); setRows([]); setError(''); setNotice(''); setTimings({}); setWarmup(null); }
  async function start() {
    stop(); setRows([]); setError(''); setNotice(''); setWarmup(null); setTimings({}); setRunning(true); setStage('Connecting');
    const active = new VoiceSession({ provider: selected, keys, config: { llm, stt, textModel: textModel.trim() || undefined, model: modelOverrides[selected] || (['openai','gemini'].includes(selected) ? selectedProvider.model : undefined), prompt, silenceMs }, onEvent: m => {
      if (session.current !== active) return;
      if (m.type === 'stage') setStage(m.stage);
      if (m.type === 'ready') { setReady(true); setLoad(''); }
      if (m.type === 'error') { setError(m.message); setRunning(false); setReady(false); setStage('Couldn’t connect'); }
      if (m.type === 'notice') setNotice(m.message);
      if (m.type === 'load') setLoad(m.file ? `${m.file.split('/').pop()}${Number.isFinite(m.progress) ? ` · ${Math.round(m.progress)}%` : ''}` : 'Preparing browser speech recognition…');
      if (m.type === 'warmup') setWarmup(m.ms);
      if (m.type === 'level') stageRef.current?.style.setProperty('--level', Math.min(1, m.value * 9));
      if (m.type === 'timing') setTimings(prev => ({ ...prev, [m.stage]: m.ms }));
      if (m.type === 'transcript') setRows(prev => {
        const value = m.text ?? m.delta; if (!value) return prev;
        if (m.delta && prev.at(-1)?.role === m.role && !prev.at(-1)?.complete) return [...prev.slice(0,-1), { ...prev.at(-1), text: prev.at(-1).text + value }];
        return [...prev.map(r=>({...r,complete:true})), { role: m.role, text: value, complete: Boolean(m.text) }];
      });
      if (m.type === 'done') setRows(prev=>prev.map(r=>({...r,complete:true})));
      if (m.type === 'measurement') setMeasurements(prev => [...prev, { ...m, provider: selected, scenario: SCENARIOS[scenario].name, naturalness: null, interruption: null, id: crypto.randomUUID() }]);
    } });
    session.current = active;
    try { await active.start(); } catch (e) { if (session.current === active && e.name !== 'AbortError') { active.error(e.message); } }
  }
  function saveRating() {
    const last = current.at(-1); if (!last) return;
    setMeasurements(prev=>prev.map(m=>m.id===last.id?{...m,naturalness:rating.natural?Number(rating.natural):null,interruption:rating.interrupt?Number(rating.interrupt):null}:m)); setNotice('Ratings saved to the most recent measured turn.');
  }
  function download() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), methodology: 'Estimated end of speech (local energy VAD) to first PCM scheduled in Web Audio. Includes endpoint delay, STT, AI, TTS, network and scheduling. Excludes hardware output latency. Local model warm-up reported separately. WS relay on localhost for every provider. Ratings are manual. No leaderboard claim from small samples.', measurements }, null, 2)],{type:'application/json'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='luna-voice-comparison.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <div className="app">
    <header className="topbar"><a className="wordmark" href="http://localhost:5188">luna<span> / </span><span>voice lab</span></a><div className="top-actions"><span className="local-badge"><i/> Independent experiment</span><button onClick={()=>setConnections(true)}><Settings2 size={15}/> Connections</button></div></header>
    <main>
      <section className="intro"><div><p className="eyebrow">A little less artificial. A little more conversation.</p><h1>Find a voice that <em>feels right.</em></h1><p>Five approaches worth hearing. One built in house. Same conversation, different chemistry.</p></div><button className="research-link" onClick={()=>setResearch(!research)}><FlaskConical size={16}/>{inventory.length || 34} repos explored <ArrowUpRight size={14}/></button></section>
      {research && <section className="research-panel"><div><h2>Beyond the usual starters.</h2><p>Repository metadata, selected source files, and recent issue samples informed this shortlist. Speed claims in READMEs are not measured results.</p><a href="/RESEARCH.md" target="_blank" rel="noreferrer">Read the findings and selection rationale <ArrowUpRight size={13}/></a></div><div className="repo-list">{inventory.map(r=><a href={r.url} key={r.name} target="_blank" rel="noreferrer"><span>{r.name}</span><small>{r.license || 'License not declared'} · {r.pushed?.slice(0,10)}</small><ArrowUpRight size={12}/></a>)}</div></section>}
      <div className="workspace">
        <aside className="providers" aria-label="Voice options"><div className="section-caption">THE CONTENDERS <span>01 — 06</span></div>{PROVIDERS.map((p,i)=><button key={p.id} className={`provider ${p.color} ${selected===p.id?'selected':''}`} aria-pressed={selected===p.id} onClick={()=>choose(p.id)}><span className="provider-art"><Mosaic variant={i}/></span><span className="provider-copy"><span className="provider-kind">{p.kind}</span><strong>{p.name}</strong><span className="provider-status">{p.needs.every(available)?'Credentials present': 'Needs connection'}{p.id==='local'?' · On-device STT':''}</span></span><span className="provider-index">{selected===p.id?<ChevronRight size={17}/>:p.mark}</span></button>)}</aside>
        <section className={`conversation ${selectedProvider.color}`} aria-label="Conversation tester">
          <div className="conversation-heading"><div><p className="eyebrow">{selectedProvider.kind}</p><h2>{selectedProvider.name}</h2></div><a className="icon-link" aria-label="View source reference" href={selectedProvider.source} target="_blank" rel="noreferrer"><ArrowUpRight size={18}/></a></div>
          <p className="description">{selectedProvider.description}</p>
          <div className="pipeline">{selectedProvider.path.map((part,i)=><React.Fragment key={part}>{i>0&&<ChevronRight size={11}/>}<span>{selected==='local'&&i===0?(stt==='whisper'?'Local Whisper':'Local Moonshine'):part}</span></React.Fragment>)}</div>
          <div className="voice-stage" ref={stageRef}><Mosaic variant={PROVIDERS.indexOf(selectedProvider)} live={running&&ready}/><span className="stage-label" role="status">{stage}</span>{load&&<small className="load-label">{load}</small>}</div>
          <div className="call-controls">{running?<button className="primary stop" onClick={stop}><Square size={13} fill="currentColor"/> End conversation</button>:<button className="primary" disabled={!status} onClick={missing.length?()=>setConnections(true):start}><Mic size={16}/>{missing.length?'Connect to try':'Start a conversation'}</button>}<label className={`replay-button ${!ready?'disabled':''}`} title="Replay the same audio clip across providers"><Upload size={15}/><span>Replay a clip</span><input aria-label="Replay an audio clip" type="file" accept="audio/*" disabled={!ready} onChange={e=>{const f=e.target.files?.[0];if(f)session.current?.replay(f);e.target.value='';}}/></label></div>
          <p className="call-note"><Headphones size={12}/> Headphones help. Audio goes to the selected provider{selected==='local'?' after local transcription, as text':''}.</p>
          {error&&<div className="error" role="alert">{error}<button onClick={()=>setConnections(true)}>Check connections <ChevronRight size={12}/></button></div>}{notice&&<p className="notice" role="status">{notice}</p>}
          <div className="metrics"><div><span>FIRST AUDIO</span><strong>{displayMs(current.at(-1)?.ms)}</strong><small>after estimated speech end</small></div><div><span>MEDIAN FIRST AUDIO</span><strong>{displayMs(median(current.map(m=>m.ms)))}</strong><small>{current.length} measured {current.length===1?'turn':'turns'}</small></div><div><span>{selected==='local'?'LOCAL TRANSCRIPTION':'AI FIRST TEXT'}</span><strong>{displayMs(selected==='local'?timings.stt:timings.llm)}</strong><small>{selected==='local'&&warmup?`warm-up ${displayMs(warmup)} separately`:'when exposed by the pipeline'}</small></div></div>
          <div className="transcript" aria-label="Conversation transcript"><div className="section-caption">THE CONVERSATION <span>{running?'LIVE':'TRANSCRIPT'}</span></div>{rows.length?rows.map((r,i)=><div className={`line ${r.role}`} key={i}><span>{r.role==='user'?'You':'Luna'}</span><p>{r.text}</p></div>):<p className="empty-transcript">A quiet space for your first conversation.</p>}<div ref={transcriptEnd}/></div>
        </section>
        <aside className="experiment">
          <div className="section-caption">MAKE IT A FAIR LISTEN</div><h3>Try the same little<br/>conversation.</h3><div className="scenario-tabs">{SCENARIOS.map((s,i)=><button disabled={running} title={s.name} aria-label={s.name} aria-pressed={scenario===i} className={scenario===i?'active':''} onClick={()=>setScenario(i)} key={s.name}>{String(i+1).padStart(2,'0')}</button>)}</div><p className="scenario-name">{SCENARIOS[scenario].name}</p><blockquote>“{SCENARIOS[scenario].text}”</blockquote>{SCENARIOS[scenario].follow&&<p className="follow">{SCENARIOS[scenario].follow}</p>}
          <div className="fine-rule"/><label className="field">Naturalness<select value={rating.natural} onChange={e=>setRating({...rating,natural:e.target.value})}><option value="">How did it feel?</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} / 5{n===5?' · Effortless':n===1?' · Robotic':''}</option>)}</select></label><label className="field">Interruptions<select value={rating.interrupt} onChange={e=>setRating({...rating,interrupt:e.target.value})}><option value="">Did it listen?</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} / 5{n===5?' · Immediate':n===1?' · Talked over me':''}</option>)}</select></label><button className="save-rating" disabled={!current.length} onClick={saveRating}><Check size={14}/> Save this turn’s ratings</button>
          <details className="tuning"><summary>Fine-tune the experiment <Settings2 size={13}/></summary>{selected==='local'&&<><label className="field">Browser recognition<select disabled={running} value={stt} onChange={e=>setStt(e.target.value)}><option value="whisper">Whisper tiny.en · balanced</option><option value="moonshine">Moonshine tiny · speed experiment</option></select></label><label className="field">Text intelligence<select disabled={running} value={llm} onChange={e=>{setLlm(e.target.value);setTextModel('');}}><option value="codex">Codex OAuth {status?.oauth?'· connected':'· unavailable'}</option><option value="groq">Groq · streaming</option><option value="openai">OpenAI API · streaming</option></select></label>{llm==='codex'&&<p className="fine-print">Streams text through your signed-in Codex app-server. Choose Groq with matching settings for the controlled local-vs-hosted STT comparison.</p>}</>}{(['local','groq'].includes(selected))&&<><label className="field">Text model override<input disabled={running||selected==='local'&&llm==='codex'} value={textModel} placeholder={llm==='openai'&&selected==='local'?'gpt-4.1-mini':'llama-3.1-8b-instant'} onChange={e=>setTextModel(e.target.value)}/></label><label className="field">Pause before replying<select disabled={running} value={silenceMs} onChange={e=>setSilenceMs(Number(e.target.value))}><option value={300}>300 ms · eager</option><option value={460}>460 ms · brisk</option><option value={700}>700 ms · balanced</option></select></label></>}{['openai','gemini'].includes(selected)&&<label className="field">Realtime model<input disabled={running} value={modelOverrides[selected]||selectedProvider.model} onChange={e=>setModelOverrides({...modelOverrides,[selected]:e.target.value})}/></label>}<label className="field">Shared conversation prompt<textarea disabled={running} rows={7} value={prompt} onChange={e=>setPrompt(e.target.value)}/></label></details>
          <p className="fine-print methodology">Speed is estimated from the last detected speech to the first audio scheduled in your browser. It includes the whole pipeline, but not speaker hardware latency. A few turns won’t establish a winner.</p>
        </aside>
      </div>
      <section className="results"><div className="results-head"><div><p className="eyebrow">LISTEN FIRST. THEN COMPARE.</p><h2>Your listening notes</h2></div><button onClick={download} disabled={!measurements.length}><Download size={14}/> Export results</button></div><div className="results-scroll"><table><thead><tr><th>Voice</th><th>Turns</th><th>Median first audio</th><th>Naturalness</th><th>Interruptions</th></tr></thead><tbody>{PROVIDERS.map(p=>{const runs=measurements.filter(m=>m.provider===p.id);const scored=key=>{const values=runs.map(m=>m[key]).filter(Number.isFinite);return values.length?`${(values.reduce((a,b)=>a+b,0)/values.length).toFixed(1)} / 5`:'—';};return <tr key={p.id}><td><i className={`table-dot ${p.color}`}/>{p.name}</td><td>{runs.length||'—'}</td><td>{displayMs(median(runs.map(m=>m.ms)))}</td><td>{scored('naturalness')}</td><td>{scored('interruption')}</td></tr>;})}</tbody></table></div><p className="fine-print">Results live in this tab until you export or reload. Different settings and live/replayed input are recorded in the export; compare matching conditions.</p></section>
      <footer><span>luna · experiments in better conversations</span><span>No trained model. No GPU server. Just listening.</span></footer>
    </main>
    {connections&&<div className="modal-scrim" onClick={e=>{if(e.target===e.currentTarget)setConnections(false);}}><section role="dialog" aria-modal="true" aria-labelledby="connection-title" className="connection-modal"><div className="modal-head"><div><p className="eyebrow">BRING YOUR CONNECTIONS</p><h2 id="connection-title">A few keys. Six voices.</h2></div><button aria-label="Close connections" onClick={()=>setConnections(false)}><X size={20}/></button></div><p>Existing environment keys stay on the local server. Added keys stay in this tab’s memory and go only to the local server and their provider. Nothing is saved to disk.</p><div className="oauth-row"><span><Check size={14}/> Codex OAuth</span><strong>{status?.oauth?`Connected · ${status.oauthModel}`:'Sign in with codex login'}</strong></div><p className="fine-print">OAuth powers text responses in the in-house option. OpenAI Realtime requires its own working API credential. “Present” means configured, not verified.</p>{[['OPENAI_API_KEY','OpenAI','https://platform.openai.com/api-keys'],['GEMINI_API_KEY','Google AI Studio','https://aistudio.google.com/apikey'],['ELEVENLABS_API_KEY','ElevenLabs','https://elevenlabs.io/app/settings/api-keys'],['DEEPGRAM_API_KEY','Deepgram','https://console.deepgram.com/'],['GROQ_API_KEY','Groq','https://console.groq.com/keys']].map(([key,label,url])=><label className="field" key={key}><span>{label}<a href={url} target="_blank" rel="noreferrer">Get a key <ArrowUpRight size={11}/></a></span><input disabled={running} type="password" autoComplete="off" placeholder={status?.keys?.[key]?'Present on local server · override if needed':'Paste an API key'} value={keys[key]||''} onChange={e=>setKeys({...keys,[key]:e.target.value})}/></label>)}<div className="modal-bottom"><button disabled={running} onClick={()=>setKeys({})}>Clear added keys</button><button className="primary" onClick={()=>setConnections(false)}>Done <Check size={14}/></button></div></section></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);

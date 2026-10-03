import React, { useEffect, useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { get, set } from 'idb-keyval';
import { Moon, Plus, ArrowUpRight, Upload, FileText, X, Check, Square, Sparkles, CalendarDays, BookOpen, Layers, ChevronRight, RotateCcw, HelpCircle, CheckCircle2, LoaderCircle, Trash2, Mic, FlaskConical, Sigma } from 'lucide-react';
import { demoTests, buildDemoGuide, validateMaterials, MAX_MATERIALS } from './study';
import { readMaterial } from './imports';
import { LiveVoiceSession } from './live-voice';
import './style.css';

const STORAGE_KEY = 'luna-study-v1';
const dateLabel = date => date ? new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : 'No date yet';
const wordCount = text => text.trim().split(/\s+/).filter(Boolean).length;
let saveQueue = Promise.resolve();

function Modal({title,children,onClose}) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(()=>{ const dialog=ref.current; dialog.showModal(); return ()=>dialog.close(); },[]);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}

function App(){
  const [tests,setTests]=useState([]),[loaded,setLoaded]=useState(false),[selectedId,setSelectedId]=useState(null);
  const [tab,setTab]=useState('materials'),[modal,setModal]=useState(null),[source,setSource]=useState(null);
  const [status,setStatus]=useState({organizer:'demo',voice:'browser',mode:'demo'});
  const [notice,setNotice]=useState(''),[storageError,setStorageError]=useState(''),[busy,setBusy]=useState(''),[drag,setDrag]=useState(false);
  const [questionIndex,setQuestionIndex]=useState(0),[showAnswer,setShowAnswer]=useState(false);
  const [voiceState,setVoiceState]=useState('idle'),[voiceError,setVoiceError]=useState('');
  const [liveMessages,setLiveMessages]=useState([]),[partialSpeech,setPartialSpeech]=useState('');
  const [showTranscript,setShowTranscript]=useState(false);
  const fileInput=useRef(null),liveSession=useRef(null);
  const importing=useRef(false);
  const active=tests.find(t=>t.id===selectedId)||tests[0];
  const guide=active?.guide;
  const isLive=status.organizer!=='demo';
  const modelLabel=status.organizer==='gpt-5.6-luna'?'GPT-5.6 Luna':'GPT-6 Luna';
  useEffect(()=>{
    let current=true;
    get(STORAGE_KEY).then(saved=>{
      if(!current)return;
      const initial=Array.isArray(saved)?saved:structuredClone(demoTests);
      setTests(initial);setSelectedId(initial[0]?.id);setLoaded(true);
    }).catch(()=>{if(current){setTests(structuredClone(demoTests));setLoaded(true);setStorageError('Browser storage is unavailable. Changes will last only in this tab.');}});
    fetch('/api/status').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(current)setStatus(data);}).catch(()=>{if(current)setNotice('Server connection unavailable. The local demo still works.');});
    return ()=>{current=false;liveSession.current?.close();liveSession.current=null;};
  },[]);
  useEffect(()=>{
    if(!loaded||storageError)return;
    saveQueue=saveQueue.then(()=>set(STORAGE_KEY,tests)).catch(()=>setStorageError('Could not save to this browser. Keep this tab open to preserve your changes.'));
  },[tests,loaded,storageError]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6500);return ()=>clearTimeout(timer);},[notice]);

  function updateTest(id, updater){setTests(current=>current.map(test=>test.id===id?updater(test):test));}
  function stopVoice(){liveSession.current?.close();liveSession.current=null;setVoiceState('idle');setPartialSpeech('');}
  function selectTest(id){stopVoice();setVoiceError('');setSelectedId(id);setLiveMessages([]);setTab('materials');setQuestionIndex(0);setShowAnswer(false);setShowTranscript(false);}
  function invalidate(id,materials){updateTest(id,t=>({...t,materials,guide:null,reviewed:[]}));stopVoice();setQuestionIndex(0);setShowAnswer(false);}
  async function importFiles(files){
    if(!active||importing.current||busy)return;
    const list=Array.from(files),id=active.id;
    if(!list.length)return;
    if(active.materials.length+list.length>MAX_MATERIALS){setNotice(`Keep each test to ${MAX_MATERIALS} files or fewer for this prototype.`);return;}
    importing.current=true;setBusy('Reading your files…');
    let materials=[...active.materials],errors=[],added=0;
    try{
      for(let i=0;i<list.length;i++){
        setBusy(`Reading file ${i+1} of ${list.length}…`);
        try{
          const item=await readMaterial(list[i]);
          if(materials.some(m=>m.name===item.name&&m.text===item.text)){errors.push(`${item.name}: already added`);continue;}
          validateMaterials([...materials,item]);materials.push(item);added++;
        }catch(error){errors.push(`${list[i].name}: ${error.message}`);}
      }
      if(added)invalidate(id,materials);
      if(errors.length)setModal({type:'import-errors',errors,added});
      else setNotice(`${added} ${added===1?'file':'files'} added. Ready to organize.`);
    }finally{importing.current=false;setBusy('');if(fileInput.current)fileInput.current.value='';}
  }
  async function organize(){
    if(!active?.materials.length||busy)return;
    stopVoice();
    const id=active.id;setBusy(isLive?'Luna is connecting the ideas…':'Building your local preview…');
    try{
      let result;
      if(isLive){
        const response=await fetch('/api/organize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:active.title,materials:active.materials.map(({id,name,text})=>({id,name,text}))}),signal:AbortSignal.timeout(130000)});
        const data=await response.json();if(!response.ok)throw Error(data.error||'Could not organize this material.');
        result={...data.guide,mode:'live',model:data.model||status.organizer};
      }else result={...buildDemoGuide(active.materials,active.title),mode:'demo'};
      updateTest(id,t=>({...t,guide:result,reviewed:[]}));setTab('guide');setQuestionIndex(0);setShowAnswer(false);stopVoice();
      setNotice(isLive?'Your study guide is ready.':'Local preview ready. Connect GPT-6 Luna for AI synthesis.');
    }catch(error){setNotice(error.name==='TimeoutError'?'Organizing timed out. Your material is safe; try again.':error.message);}
    finally{setBusy('');}
  }
  async function startVoice(){
    if(voiceState!=='idle'){stopVoice();return;}
    if(!active?.materials.length||!isLive||status.voice!=='elevenlabs')return;
    setVoiceError('');setLiveMessages([]);setPartialSpeech('');setShowTranscript(true);setVoiceState('connecting');
    const session=new LiveVoiceSession({
      onState:state=>{if(liveSession.current===session)setVoiceState(state);},
      onTranscript:message=>{
        if(liveSession.current!==session)return;
        if(message.role==='user'&&!message.final){setPartialSpeech(message.text);return;}
        if(message.role==='user')setPartialSpeech('');
        setLiveMessages(messages=>[...messages,{role:message.role,text:message.text}].slice(-40));
      },
      onError:message=>{if(liveSession.current===session)setVoiceError(message);},
      onClose:()=>{if(liveSession.current===session){setVoiceState('idle');setPartialSpeech('');liveSession.current=null;}},
    });
    liveSession.current=session;
    try{await session.start(active);}catch{ /* The session reports an actionable error and closes its microphone. */ }
  }
  function createTest(event){
    event.preventDefault();const form=new FormData(event.currentTarget);
    const title=String(form.get('title')).trim(),subject=String(form.get('subject')).trim();
    if(!title)return;
    const test={id:crypto.randomUUID(),title,subject:subject||'Your next test',date:String(form.get('date')),materials:[],guide:null,reviewed:[]};
    setTests(t=>[...t,test]);selectTest(test.id);setModal(null);setNotice('Your new test is ready. Add your first material.');
  }
  function addNote(event){
    event.preventDefault();const form=new FormData(event.currentTarget),text=String(form.get('text')).trim(),name=String(form.get('name')).trim();
    if(!text||!name)return;
    const materials=[...active.materials,{id:crypto.randomUUID(),name:`${name}.md`,text,type:'md',size:new Blob([text]).size}];
    try{validateMaterials(materials);invalidate(active.id,materials);setModal(null);setNotice('Note added.');}catch(error){setNotice(error.message);}
  }
  const questions=guide?.questions||[],question=questions[questionIndex];
  const reviewed=active?.reviewed||[];
  function markReviewed(){if(!reviewed.includes(questionIndex))updateTest(active.id,t=>({...t,reviewed:[...(t.reviewed||[]),questionIndex]}));if(questionIndex<questions.length-1){setQuestionIndex(q=>q+1);setShowAnswer(false);}else setNotice('You made it through. Revisit any question whenever you need.');}
  function SourceLinks({ids}){return <div className="sources">{ids?.map(id=>{const material=active.materials.find(m=>m.id===id);return material?<button key={id} onClick={()=>setSource(material)}><FileText size={12}/>{material.name}</button>:null;})}</div>;}

  if(!loaded)return <div className="loading"><Moon/><p>Opening your study space…</p></div>;
  return <>
    <header className="topbar"><a href="#" className="brand" aria-label="Luna study home" onClick={e=>{e.preventDefault();window.scrollTo({top:0,behavior:'smooth'});}}><span className="brand-icon"><Moon size={22}/></span>luna<span className="brand-divider"/> <span className="brand-sub">study space</span></a><div className="header-right"><span className="mode-tag">{status.mode==='live'?'Live mode':status.mode==='partial'?'Partial live mode':'Free demo'}</span><button className="icon-button" aria-label="How this prototype works" onClick={()=>setModal({type:'help'})}><HelpCircle size={20}/></button><div className="avatar" title="Local workspace">Y</div></div></header>
    <main>
      <div className="page-intro"><div><p className="eyebrow">A LITTLE FOCUS GOES A LONG WAY</p><h1>What are we studying?</h1><p className="intro-copy">All your material. A clear plan. A voice to walk you through it.</p></div><button className="primary" onClick={()=>setModal({type:'create'})} disabled={!!busy}><Plus size={18}/> New test</button></div>
      {storageError&&<p role="alert" className="error-banner">{storageError}</p>}
      <section className="test-grid" aria-label="Your tests">
        {tests.map((test,index)=><button key={test.id} className={`test-card ${active?.id===test.id?'selected':''}`} onClick={()=>selectTest(test.id)} disabled={!!busy} aria-pressed={active?.id===test.id}><div className="test-card-top"><span className={`subject-icon subject-${index%3}`}>{index%2===0?<FlaskConical size={21}/>:<Sigma size={21}/>}</span><span className="test-date"><CalendarDays size={13}/>{dateLabel(test.date)}</span></div><span className="test-subject">{test.subject}</span><h2>{test.title}</h2><div className="test-card-bottom"><span>{test.materials.length} {test.materials.length===1?'source':'sources'}<span className="dot-separator">·</span>{test.guide?'Guide ready':test.materials.length?'Ready to organize':'Ready for material'}</span>{active?.id===test.id?<span className="selected-dot"><Check size={12}/></span>:<ChevronRight size={16}/>}</div></button>)}
        <button className="add-test-card" onClick={()=>setModal({type:'create'})} disabled={!!busy}><span><Plus size={22}/></span><strong>A fresh start</strong><p>Add your next test</p></button>
      </section>
      {active?<section className="workspace" aria-label={`${active.title} workspace`}>
        <div className="workspace-header"><div><div className="section-eyebrow">YOUR CURRENT FOCUS {active.id==='sample-biology'&&<span className="sample-tag">Sample test</span>}</div><h2>{active.title}</h2><p>{active.subject}<span className="dot-separator">·</span>{active.date?`Test on ${dateLabel(active.date)}`:'Set up your material and make a start'}</p></div><button className="icon-button subtle" aria-label={`Delete ${active.title}`} onClick={()=>setModal({type:'delete',id:active.id})} disabled={!!busy}><Trash2 size={17}/></button></div>
        <div className="workspace-grid"><div className="study-panel">
          <div className="tabs" role="tablist" aria-label="Study workspace">{[{id:'materials',label:'Material',icon:Layers},{id:'guide',label:'Study guide',icon:BookOpen},{id:'practice',label:'Practice',icon:Sparkles}].map(({id,label,icon:Icon})=><button role="tab" aria-selected={tab===id} id={`tab-${id}`} aria-controls="study-content" tabIndex={tab===id?0:-1} onKeyDown={e=>{const tabs=['materials','guide','practice'];if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?tabs[0]:e.key==='End'?tabs[2]:tabs[(tabs.indexOf(id)+(e.key==='ArrowRight'?1:2))%3];setTab(next);document.getElementById(`tab-${next}`)?.focus();}}} key={id} className={tab===id?'active':''} onClick={()=>{setTab(id);setShowAnswer(false);}}><Icon size={17}/>{label}{id==='materials'&&<span>{active.materials.length}</span>}</button>)}</div>
          <div className="panel-content" role="tabpanel" id="study-content" aria-labelledby={`tab-${tab}`}>
            {tab==='materials'&&<>
              <div className={`dropzone ${drag?'dragging':''} ${busy?'disabled':''}`} onDragOver={e=>{e.preventDefault();if(!busy)setDrag(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDrag(false);}} onDrop={e=>{e.preventDefault();setDrag(false);importFiles(e.dataTransfer.files);}}><div className="upload-icon">{busy?<LoaderCircle className="spin" size={24}/>:<Upload size={24}/>}</div><h3>{busy||'Drop the whole pile here.'}</h3><p>Lecture notes, readings, study sheets. It all belongs.</p><button className="secondary" disabled={!!busy} onClick={()=>fileInput.current?.click()}>Browse files</button><small>PDF, DOCX, TXT, MD · 20 MB per file · Up to 100 files</small><input ref={fileInput} aria-label="Upload study material" type="file" accept=".pdf,.docx,.txt,.md" multiple hidden onChange={e=>importFiles(e.target.files)}/></div>
              <div className="material-heading"><h3>Your material <span>{active.materials.length}</span></h3><button className="text-button" onClick={()=>setModal({type:'note'})} disabled={!!busy}><Plus size={15}/>Paste a note</button></div>
              <div className="material-list">{active.materials.length?active.materials.map(material=><div className="material" key={material.id}><div className={`file-icon ${material.type}`}><FileText size={19}/></div><button className="material-title" onClick={()=>setSource(material)}><strong>{material.name}</strong><span>{material.type?.toUpperCase()}<span className="dot-separator">·</span>{wordCount(material.text).toLocaleString()} words</span></button><span className="read-label"><CheckCircle2 size={14}/>Ready</span><button className="icon-button" aria-label={`Remove ${material.name}`} disabled={!!busy} onClick={()=>invalidate(active.id,active.materials.filter(m=>m.id!==material.id))}><X size={15}/></button></div>):<p className="empty-material">Start with a file or paste a few notes above.</p>}</div>
              <div className="organize-footer"><p><Sparkles size={16}/>{isLive?`${modelLabel} connects the dots.`:'Try the flow with a free local preview.'}</p><button className="primary" disabled={!active.materials.length||!!busy} onClick={organize}>{busy?<LoaderCircle size={16} className="spin"/>:<Sparkles size={16}/>} {isLive?'Organize with Luna':'Create study preview'}</button></div>
            </>}
            {tab==='guide'&&(guide?<><div className="guide-intro"><div><p className="section-eyebrow">THE BIG PICTURE</p><h3>A little structure. A lot more clarity.</h3></div><button className="icon-button" aria-label="Regenerate study guide" onClick={organize} disabled={!!busy}>{busy?<LoaderCircle size={17} className="spin"/>:<RotateCcw size={17}/>}</button></div><p className="guide-overview">{guide.overview}</p><p className="preview-disclosure">{guide.mode==='live'?`Generated by ${guide.model==='gpt-5.6-luna'?'GPT-5.6 Luna':'GPT-6 Luna'}. Check the linked sources as you study.`:'Local demo: excerpts and recall prompts from your material. AI synthesis is not connected.'}</p><div className="topic-list">{guide.topics.map((topic,index)=><article className="topic" key={`${index}-${topic.title}`}><span className="topic-number">{String(index+1).padStart(2,'0')}</span><div><h4>{topic.title}</h4><p>{topic.summary}</p><SourceLinks ids={topic.sourceIds}/></div></article>)}</div><button className="secondary" onClick={()=>setTab('practice')}><Sparkles size={16}/>Try a practice question</button></>:<div className="empty-state"><BookOpen size={32}/><h3>Your ideas, connected.</h3><p>Add your material, then create a guide to turn the pile into a plan.</p><button className="primary" onClick={active.materials.length?organize:()=>setTab('materials')} disabled={!!busy}>{active.materials.length?(isLive?'Organize with Luna':'Create study preview'):'Add material'}</button></div>)}
            {tab==='practice'&&(question?<><div className="practice-top"><span className="section-eyebrow">A LITTLE ACTIVE RECALL</span><span>{questionIndex+1} / {questions.length}</span></div><div className="progress-track"><span style={{width:`${reviewed.length/questions.length*100}%`}}/></div><div className="question"><span className="question-label">Without peeking at your notes…</span><h3>{question.question}</h3>{showAnswer?<div className="answer"><span>CHECK YOUR UNDERSTANDING</span><p>{question.answer}</p><SourceLinks ids={question.sourceIds}/></div>:<button className="secondary" onClick={()=>setShowAnswer(true)}>Reveal answer</button>}</div><div className="practice-bottom"><button className="text-button" disabled={questionIndex===0} onClick={()=>{setQuestionIndex(i=>i-1);setShowAnswer(false);}}>Previous</button><span>{reviewed.length} reviewed</span><button className="primary" disabled={!showAnswer} onClick={markReviewed}><Check size={16}/>{questionIndex===questions.length-1?'Mark reviewed':'Got it, next'}</button></div>{questions.length>1&&<div className="question-nav" aria-label="Practice questions">{questions.map((_,i)=><button key={i} aria-label={`Question ${i+1}${reviewed.includes(i)?', reviewed':''}`} aria-current={i===questionIndex?'step':undefined} className={i===questionIndex?'current':reviewed.includes(i)?'reviewed':''} onClick={()=>{setQuestionIndex(i);setShowAnswer(false);}}>{reviewed.includes(i)?<Check size={13}/>:i+1}</button>)}</div>}</>:<div className="empty-state"><Sparkles size={32}/><h3>Make it stick.</h3><p>Create your study guide first, then check what you remember.</p><button className="primary" onClick={active.materials.length?organize:()=>setTab('materials')} disabled={!!busy}>{active.materials.length?(isLive?'Organize with Luna':'Create study preview'):'Add material'}</button></div>)}
          </div>
        </div><aside className="voice-column"><div className="voice-card"><div className="voice-card-top"><span className="voice-icon"><Mic size={21}/></span><span>LIVE CONVERSATION</span></div><h2>Talk it<br/>through.</h2><p>Ask a question, talk through an answer, or ask Luna to quiz you on your material.</p><div className={`waveform ${voiceState==='speaking'?'playing':''}`} aria-hidden="true">{Array.from({length:35},(_,i)=><span key={i} style={{height:`${12+Math.sin(i*1.9)**2*33+Math.sin(i*.37)**2*20}px`,animationDelay:`${i*35}ms`}}/>)}</div><div className="live-state" role="status">{voiceState==='connecting'?'Connecting…':voiceState==='thinking'?'Luna is thinking…':voiceState==='speaking'?'Luna is speaking. You can interrupt.':voiceState==='listening'?'Listening. Go ahead.':'Microphone off'}</div><button className="voice-play" disabled={voiceState==='idle'&&(!active.materials.length||!!busy||!isLive||status.voice!=='elevenlabs')} onClick={startVoice}>{voiceState==='connecting'?<LoaderCircle className="spin" size={17}/>:voiceState!=='idle'?<Square size={15}/>:<Mic size={17}/>} {voiceState==='connecting'?'Cancel connection':voiceState!=='idle'?'End live session':'Start live session'}</button><span className="voice-caption">{!active.materials.length?'Add material to start':!isLive||status.voice!=='elevenlabs'?'Luna and ElevenLabs connections required':'Starts only when you click · Uses account allowance'}</span></div>{voiceError&&<p className="voice-error" role="alert">{voiceError}</p>}
          <button className="transcript-toggle" onClick={()=>setShowTranscript(s=>!s)} aria-expanded={showTranscript}><FileText size={15}/>{showTranscript?'Hide conversation':'Show conversation'}<ChevronRight size={15} className={showTranscript?'rotated':''}/></button>{showTranscript&&<div className="transcript live-transcript"><h3>Your live conversation</h3>{!liveMessages.length&&!partialSpeech&&<p>Start a session, then speak. Your conversation will appear here.</p>}{liveMessages.map((message,index)=><div className={`live-message ${message.role}`} key={index}><strong>{message.role==='user'?'You':'Luna'}</strong><p>{message.text}</p></div>)}{partialSpeech&&<div className="live-message partial"><strong>You</strong><p>{partialSpeech}</p></div>}</div>}
          <div className="how-card"><span className="how-icon"><Sparkles size={19}/></span><h3>Less sorting.<br/>More understanding.</h3><p>Drop in your material. Find the connections. Say it back in your own words.</p><div className="connection"><span>Organize</span><strong>{isLive?(status.organizerTransport==='codex-cli'?`${modelLabel} · CLI`:modelLabel):'Local demo'}</strong></div><div className="connection"><span>Listen</span><strong>{status.voice==='elevenlabs'?'ElevenLabs v4 Turbo':'Not connected'}</strong></div><button className="text-button" onClick={()=>setModal({type:'help'})}>About this prototype <ArrowUpRight size={14}/></button></div>
        </aside></div>
      </section>:<div className="empty-state"><BookOpen/><h2>Your next test starts here.</h2><button className="primary" onClick={()=>setModal({type:'create'})}><Plus size={18}/>Create a test</button></div>}
      <footer><span><Moon size={14}/>A calmer way to prepare.</span><span>{storageError?'Not saved on this device':'Saved in this browser'} <span className="dot-separator">·</span> Proof of concept</span></footer>
    </main>
    {notice&&<div role="status" className="toast"><CheckCircle2 size={18}/><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={()=>setNotice('')}><X size={16}/></button></div>}
    {modal?.type==='create'&&<Modal title="One test. One clear space." onClose={()=>setModal(null)}><form onSubmit={createTest}><label>Test name<input name="title" autoFocus required maxLength={80} placeholder="e.g. Chemistry midterm"/></label><div className="form-row"><label>Class or subject<input name="subject" maxLength={60} placeholder="e.g. CHEM 101"/></label><label>Test date<input name="date" type="date"/></label></div><p className="form-help">Add your readings and notes after creating your test.</p><button className="primary" type="submit"><Plus size={17}/>Create test</button></form></Modal>}
    {modal?.type==='note'&&<Modal title="Something worth remembering." onClose={()=>setModal(null)}><form onSubmit={addNote}><label>Note title<input name="name" required autoFocus maxLength={100} placeholder="e.g. Lecture 04: cell membranes"/></label><label>Your notes<textarea name="text" required rows={9} maxLength={150000} placeholder="Paste your notes here. Headings help keep ideas together."/></label><button className="primary" type="submit"><Plus size={16}/>Add note</button></form></Modal>}
    {modal?.type==='help'&&<Modal title="A small prototype. A clear idea." onClose={()=>setModal(null)}><div className="help-content"><p>Create a test, add a pile of material, organize it with Luna, then talk with ElevenLabs live speech.</p><ol><li><strong>Your material stays organized by test.</strong> Upload text PDFs, DOCX, TXT, or Markdown. Scans and images need OCR and are not supported yet.</li><li><strong>Choose how you study.</strong> Demo mode builds local excerpts and recall questions. Live mode generates a study guide with Luna, then opens a two-way voice session through ElevenLabs.</li><li><strong>Your existing ChatGPT sign-in works here.</strong> On this local app, the selected Luna model runs through your signed-in Codex CLI and uses your plan allowance. ElevenLabs uses its own server-side key and account credits. OpenAI API-key mode is also available.</li></ol><p className="preview-disclosure">Your test data is stored in this browser, on this device. In live mode, organizing sends extracted text through the configured OpenAI connection; a live voice session sends microphone audio to ElevenLabs for transcription and sends Luna replies back for speech. The microphone starts only when you click Start live session. This prototype is intended for local use.</p></div></Modal>}
    {modal?.type==='delete'&&<Modal title="Delete this test?" onClose={()=>setModal(null)}><p>This removes the test and its material from this browser.</p><div className="modal-actions"><button className="secondary" onClick={()=>setModal(null)}>Keep test</button><button className="danger" onClick={()=>{const remaining=tests.filter(t=>t.id!==modal.id);setTests(remaining);selectTest(remaining[0]?.id);setModal(null);}}>Delete test</button></div></Modal>}
    {modal?.type==='import-errors'&&<Modal title="Your import results" onClose={()=>setModal(null)}><p>{modal.added} files added successfully.</p><ul className="import-errors">{modal.errors.map((error,i)=><li key={i}>{error}</li>)}</ul><button className="primary" onClick={()=>setModal(null)}>Done</button></Modal>}
    {source&&<Modal title={source.name} onClose={()=>setSource(null)}><p className="form-help">Extracted source text · {wordCount(source.text).toLocaleString()} words</p><pre className="source-text">{source.text}</pre></Modal>}
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);

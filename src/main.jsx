import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { get, set } from 'idb-keyval';
import { ArrowLeft, Braces, Captions, DollarSign, LibraryBig, LoaderCircle, Mic, MicOff, Plus, SquarePen, X } from 'lucide-react';
import CreateTest, { localDate } from './CreateTest';
import VoiceCanvas from './VoiceCanvas';
import TeacherSkins from './TeacherSkins.jsx';
import DitherImage from './DitherImage';
import Library from './Library';
import MasteryArc from './MasteryArc';
import Whiteboard from './Whiteboard';
import AssistantCaptions from './AssistantCaptions.jsx';
import LearningTrace from './LearningTrace.jsx';
import UsageDebug from './UsageDebug.jsx';
import HintButton from './HintButton.jsx';
import SessionPaused from './SessionPaused.jsx';
import PracticeTrail from './PracticeTrail.jsx';
import TestCard from './course-mosaics/TestCard.jsx';
import useCourseAssignments from './course-mosaics/useCourseAssignments.jsx';
import { transitionStudyView } from './study-navigation.mjs';
import { prepareMaterials } from './prepare-materials.mjs';
import {MATERIAL_ACCEPT,pastedImageFiles} from './image-imports.mjs';
import { validateMaterials } from './study';
import { duplicateMaterial } from './material-dedup.mjs';
import { LiveVoiceSession } from './live-voice';
import './style.css';
import './mosaic-stage.css';
import './study-navigation.css';
import './voice-preview.css';

const STORAGE_KEY='study-board-v2';
let saveQueue=Promise.resolve();
const sourceVersion=materials=>materials.map(item=>item.id).join('|');
function debugEvent(testId,type,details){
  if(!import.meta.env.DEV)return;
  void fetch('/api/debug/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({testId,event:{type,details}})}).catch(()=>{});
}

function GoogleMark(){return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.01v2.5h3.23c1.9-1.75 2.99-4.33 2.99-7.34ZM12 22c2.7 0 4.96-.9 6.61-2.43l-3.23-2.5c-.9.6-2.05.96-3.38.96-2.6 0-4.82-1.76-5.61-4.13H3.05v2.58A9.99 9.99 0 0 0 12 22ZM6.39 13.9A6 6 0 0 1 6.07 12c0-.66.11-1.3.32-1.9V7.52H3.05A10 10 0 0 0 2 12c0 1.61.39 3.14 1.05 4.48l3.34-2.58ZM12 5.97c1.47 0 2.79.51 3.83 1.51l2.88-2.88C16.97 2.99 14.71 2 12 2a9.99 9.99 0 0 0-8.95 5.52l3.34 2.58C7.18 7.73 9.4 5.97 12 5.97Z"/></svg>;}

function AccountPreview(){
  const [open,setOpen]=useState(false),ref=useRef(null),button=useRef(null);
  useEffect(()=>{
    if(!open)return;
    const outside=event=>{if(!ref.current?.contains(event.target))setOpen(false);};
    const escape=event=>{if(event.key==='Escape'){setOpen(false);button.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  return <div className="account" ref={ref}>
    <button ref={button} className="account-avatar" aria-label="Google account preview" aria-expanded={open} aria-controls="account-preview" onClick={()=>setOpen(!open)}>A</button>
    {open&&<section className="account-preview" id="account-preview" aria-label="Google account preview">
      <div className="account-identity"><span className="account-avatar" aria-hidden="true">A</span><div><strong>Your account</strong><span>Logged-in preview</span></div><GoogleMark/></div>
      <p>Google sign-in isn’t connected yet.</p>
    </section>}
  </div>;
}

function App(){
  const [voiceProvider,setVoiceProvider]=useState(()=>import.meta.env.DEV&&new URLSearchParams(location.search).get('voice')==='gpt-live'?'gpt-live':'elevenlabs');
  const [tests,setTests]=useState([]),[loaded,setLoaded]=useState(false),[activeId,setActiveId]=useState(null);
  const [creating,setCreating]=useState(false),[libraryOpen,setLibraryOpen]=useState(false);
  const [traceOpen,setTraceOpen]=useState(false);
  const [usageOpen,setUsageOpen]=useState(false);
  const [hintState,setHintState]=useState(null),[presence,setPresence]=useState(null),[practiceState,setPracticeState]=useState(null);
  const [boardMeasure,setBoardMeasure]=useState(null);
  const boardViews=useRef(new Map());
  const [notice,setNotice]=useState(''),[storageError,setStorageError]=useState('');
  const [voiceState,setVoiceState]=useState('idle'),[voiceError,setVoiceError]=useState(''),[subtitle,setSubtitle]=useState(''),[captions,setCaptions]=useState(true);
  const [uploading,setUploading]=useState({}),[drag,setDrag]=useState(false),[boardOpen,setBoardOpen]=useState(false),[intake,setIntake]=useState(null),[boardSelection,setBoardSelection]=useState(null);
  const studyScreen=useRef(null),orb=useRef(null),dragPosition=useRef({clientX:0,clientY:0});
  const testsRef=useRef(tests),activeRef=useRef(activeId),session=useRef(null),level=useRef(0),fileInput=useRef(null),indexJobs=useRef(new Map()),importJobs=useRef(new Set());
  testsRef.current=tests;activeRef.current=activeId;
  const active=tests.find(item=>item.id===activeId);
  useCourseAssignments(tests,loaded,setTests);
  useEffect(()=>{
    let current=true;
    get(STORAGE_KEY).then(saved=>{if(current){setTests(Array.isArray(saved)?saved.map(item=>({...item,whiteboardSelection:null,...(item.indexStatus==='indexing'?{indexStatus:'error',indexError:'Indexing was interrupted. Retry when ready.'}:{})})):[]);setLoaded(true);}}).catch(()=>{if(current){setLoaded(true);setStorageError('Browser storage is unavailable. This session will not be saved.');}});
    return()=>{current=false;session.current?.close();for(const job of indexJobs.current.values())job.abort();};
  },[]);
  useEffect(()=>{if(loaded&&!storageError)saveQueue=saveQueue.then(()=>set(STORAGE_KEY,tests)).catch(()=>setStorageError('Your changes could not be saved to this browser.'));},[tests,loaded,storageError]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),5500);return()=>clearTimeout(timer);},[notice]);

  function updateTest(id,updater){setTests(current=>current.map(test=>test.id===id?updater(test):test));}
  function stopVoice(){session.current?.close();session.current=null;level.current=0;setVoiceState('idle');setHintState(null);setPresence(null);setPracticeState(null);}
  function startVoice(test,provider=voiceProvider){
    stopVoice();setVoiceError('');setSubtitle('');setBoardSelection(null);setVoiceState('connecting');
    const live=new LiveVoiceSession({
      ...(provider==='gpt-live'?{socketPath:'/api/gpt-live',providerLabel:'GPT-Live',localBargeIn:false}:{}),
      onState:state=>{if(session.current===live)setVoiceState(state);},
      onLevel:value=>{if(session.current===live)level.current=value;},
      onTranscript:()=>{},
      onHintState:state=>{if(session.current===live)setHintState(state);},
      onPresence:state=>{if(session.current===live)setPresence(state);},
      onPracticeState:state=>{if(session.current===live)setPracticeState(state);},
      onCaption:message=>{if(session.current===live){if(message.text)setVoiceError('');setSubtitle(message.phrase??message.text??'');}},
      onCanvas:message=>{
        if(session.current!==live)return;
        if(typeof message.visible==='boolean'){setBoardOpen(message.visible);updateTest(test.id,item=>({...item,whiteboardVisible:message.visible}));}
        if(message.board){
          updateTest(test.id,item=>({...item,whiteboard:message.board,whiteboardSelection:null}));setBoardSelection(null);
        }
        else if(message.board===null){updateTest(test.id,item=>({...item,whiteboard:null,whiteboardSelection:null}));setBoardSelection(null);setBoardOpen(false);}
      },
      onMastery:mastery=>{if(session.current===live)updateTest(test.id,item=>({...item,mastery}));},
      onSetupDate:date=>{if(session.current===live)updateTest(test.id,item=>({...item,date}));},
      onError:message=>{if(session.current===live)setVoiceError(message);},
      onPause:reason=>{if(session.current===live)setVoiceError(reason==='student-idle'?'':reason==='audio-stream-stalled'?'Microphone paused after the audio connection stopped. Tap to resume.':'Paused while away. Tap the microphone to resume.');},
      onClose:()=>{if(session.current===live){session.current=null;level.current=0;setVoiceState('idle');}},
    });
    session.current=live;
    void live.start({...test,localToday:localDate()}).catch(()=>{});
  }
  function openTest(test){
    activeRef.current=test.id;
    // Microphone/audio setup keeps the original user gesture and runs beside
    // the visual transition, never after an animation timeout.
    startVoice(test);
    transitionStudyView(()=>flushSync(()=>{setActiveId(test.id);setLibraryOpen(false);setBoardOpen(false);setVoiceError('');setSubtitle('');}));
  }
  function back(){
    stopVoice();activeRef.current=null;
    transitionStudyView(()=>flushSync(()=>{setDrag(false);setIntake(null);setBoardOpen(false);setActiveId(null);setLibraryOpen(false);setSubtitle('');setVoiceError('');}));
  }
  function createTest(fields){const test={id:crypto.randomUUID(),title:fields.className,...fields,materials:[],guide:null,indexStatus:'empty',createdAt:new Date().toISOString()};setTests(current=>[...current,test]);setCreating(false);openTest(test);}

  async function indexTest(id,materials){
    indexJobs.current.get(id)?.abort();
    if(!materials.length){indexJobs.current.delete(id);updateTest(id,test=>({...test,guide:null,indexStatus:'empty',indexError:''}));return;}
    const revision=sourceVersion(materials),test=testsRef.current.find(item=>item.id===id);
    if(!test)return;
    const controller=new AbortController();indexJobs.current.set(id,controller);
    debugEvent(id,'index.started',{sourceCount:materials.length,sourceIds:materials.map(item=>item.id)});
    if(activeRef.current===id)session.current?.updateIndexStatus('indexing',revision);
    updateTest(id,item=>({...item,indexStatus:'indexing',indexError:'',guide:null}));
    try{
        const response=await fetch('/api/organize',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(130000)]),body:JSON.stringify({testId:id,title:test.title,materials:materials.map(({id,name,text})=>({id,name,text}))})});
        const body=await response.json();if(!response.ok)throw Error(body.error||'Could not index this material.');const guide=body.guide;
      if(!controller.signal.aborted){
        debugEvent(id,'index.ready',{sourceCount:materials.length,sourceIds:materials.map(item=>item.id)});
        updateTest(id,item=>sourceVersion(item.materials)===revision?{...item,guide,indexStatus:'ready',indexedAt:new Date().toISOString()}:item);
        if(activeRef.current===id)session.current?.updateIndexStatus('ready',revision);
      }
    }catch(error){if(!controller.signal.aborted){
      debugEvent(id,'index.failed',{reason:error.name==='TimeoutError'?'timeout':error.message});
      updateTest(id,item=>sourceVersion(item.materials)===revision?{...item,indexStatus:'error',indexError:error.name==='TimeoutError'?'Indexing took too long. Your files are saved; try again.':error.message}:item);
      if(activeRef.current===id)session.current?.updateIndexStatus('error',revision);
    }}
    finally{if(indexJobs.current.get(id)===controller)indexJobs.current.delete(id);}
  }
  function dropMaterials(event){
    event.preventDefault();setDrag(false);
    const files=Array.from(event.dataTransfer.files||[]);
    if(!files.length||importJobs.current.has(activeRef.current))return;
    const bounds=studyScreen.current.getBoundingClientRect();
    void addFiles(files,{x:event.clientX-bounds.left,y:event.clientY-bounds.top});
  }
  function pasteMaterials(event){
    if(!activeRef.current||event.defaultPrevented)return;
    const files=pastedImageFiles(event);
    if(!files.length)return;
    event.preventDefault();
    if(importJobs.current.has(activeRef.current)){setNotice('Wait for the current import to finish, then paste your image again.');return;}
    if(event.isTrusted)session.current?.noteActivity({foreground:true});
    void addFiles(files);
  }
  async function addFiles(files,origin){
    const id=activeRef.current,test=testsRef.current.find(item=>item.id===id),list=Array.from(files||[]);
    if(!test||!list.length||importJobs.current.has(id))return;
    importJobs.current.add(id);setUploading(current=>({...current,[id]:'Reading material'}));
    debugEvent(id,'import.started',{total:list.length});
    const materials=[...test.materials],errors=[];let duplicates=0;
    const beganAt=performance.now();
    const prepared=await prepareMaterials(list,{existing:materials,testId:id,concurrency:5,onEvent:({completed,total})=>setUploading(current=>({...current,[id]:`Reading ${completed} of ${total}`}))});
    for(let i=0;i<list.length;i++){
      try{
        const file=list[i],result=prepared[i];
        if(result.error)throw result.error;
        if(result.duplicate){duplicates++;debugEvent(id,'import.duplicate',{fileName:file.name,reason:result.reason});continue;}
        const material=result.material;
        debugEvent(id,'import.extracted',{fileName:file.name,fileBytes:file.size,fileType:material.type,characters:material.text.length,sourceIds:[material.id]});
        if(duplicateMaterial(material,materials)){duplicates++;debugEvent(id,'import.duplicate',{fileName:file.name,reason:'same-source-text'});continue;}
        validateMaterials([...materials,material]);materials.push(material);
      }
      catch(error){errors.push(`${list[i].name}: ${error.message}`);debugEvent(id,'import.failed',{fileName:list[i].name,reason:error.message});}
    }
    if(materials.length!==test.materials.length){
      if(origin&&activeRef.current===id)setIntake({id:crypto.randomUUID(),...origin,count:materials.length-test.materials.length});
      updateTest(id,item=>({...item,materials,guide:null,mastery:{overall:0,topics:[]},whiteboard:null,whiteboardSelection:null,indexStatus:'indexing'}));
      if(activeRef.current===id){setBoardOpen(false);setBoardSelection(null);setHintState(null);setPracticeState(null);}
      if(activeRef.current===id)session.current?.updateMaterials(materials);
      void indexTest(id,materials);
    }
    importJobs.current.delete(id);setUploading(current=>({...current,[id]:''}));if(fileInput.current)fileInput.current.value='';
    debugEvent(id,'import.completed',{added:materials.length-test.materials.length,duplicates,failed:errors.length,sourceCount:materials.length,durationMs:Math.round(performance.now()-beganAt)});
    const messages=[...(duplicates?[`${duplicates} duplicate ${duplicates===1?'file skipped':'files skipped'}.`]:[]),...errors];
    if(messages.length)setNotice(messages.join(' · '));
  }
  function removeMaterial(materialId){const materials=active.materials.filter(item=>item.id!==materialId);setBoardOpen(false);setBoardSelection(null);setHintState(null);setPracticeState(null);updateTest(active.id,item=>({...item,materials,guide:null,mastery:{overall:0,topics:[]},whiteboard:null,whiteboardSelection:null,indexStatus:materials.length?'indexing':'empty'}));session.current?.updateMaterials(materials);void indexTest(active.id,materials);}
  function toggleVoice(){if(!active)return;if(voiceState==='idle')startVoice(active);else stopVoice();}
  function changeVoiceProvider(provider){
    if(!['gpt-live','elevenlabs'].includes(provider)||provider===voiceProvider)return;
    setVoiceProvider(provider);
    const url=new URL(location.href);if(provider==='gpt-live')url.searchParams.set('voice','gpt-live');else url.searchParams.delete('voice');
    history.replaceState(history.state,'',url);
    if(active)startVoice(active,provider);
  }
  function showBoard(visible){setBoardOpen(visible);if(active)updateTest(active.id,item=>({...item,whiteboardVisible:visible}));session.current?.setCanvasVisible(visible);}

  if(!loaded)return <div className="app-loading"><LoaderCircle size={19} className="spin" aria-label="Loading"/></div>;
  return <div className={`app ${active?'in-test':''}`} onPaste={pasteMaterials}>
    <header className="topbar"><div className="topbar-left"><MasteryArc tests={tests}/>{active&&<button className="icon-button" onClick={back} aria-label="Back to tests"><ArrowLeft size={19}/></button>}</div><div className="topbar-right">{import.meta.env.DEV&&<label className="voice-preview" data-experimental={voiceProvider==='gpt-live'}><span>Voice</span><select aria-label="Voice provider preview" value={voiceProvider} onChange={event=>changeVoiceProvider(event.target.value)}><option value="elevenlabs">Terra + ElevenLabs</option><option value="gpt-live">GPT-Live 1 · Preview</option></select></label>}<AccountPreview/></div></header>
    {storageError&&<div className="storage-notice" role="alert">{storageError}</div>}
    {!active?<main className={`test-board ${tests.length?'has-tests':'is-empty'}`} aria-label="Tests">
      {!tests.length?<div className="empty-board"><DitherImage src="/study-hero-source.png" className="study-hero" alt="An open book, notes, and a pencil, rendered with a subtle dither"/><button className="new-test-button" onClick={()=>setCreating(true)} aria-label="New test"><Plus size={32} strokeWidth={1.3}/></button><span className="new-test-label">Add a test</span></div>:<><div className="board-heading"><h1>Tests</h1><button className="icon-button outlined" aria-label="New test" onClick={()=>setCreating(true)}><Plus size={21}/></button></div><div className="test-grid">{tests.map(test=><TestCard key={test.id} test={test} onOpen={openTest}/>)}</div></>}
    </main>:<main ref={studyScreen} onPointerDownCapture={event=>{if(event.isTrusted)session.current?.noteActivity({foreground:true});}} onKeyDownCapture={event=>{if(event.isTrusted&&!['Shift','Control','Alt','Meta'].includes(event.key))session.current?.noteActivity({foreground:true});}} className={`study-screen ${drag?'dragging':''}`} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragPosition.current={clientX:e.clientX,clientY:e.clientY};setDrag(true);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDrag(false);}} onDrop={dropMaterials}>
      <VoiceCanvas state={voiceState} levelRef={level} dragging={drag} dragPositionRef={dragPosition} boardOpen={boardOpen} boardMeasure={boardMeasure?.revision===active.whiteboard?.revision?boardMeasure:null} orbRef={orb} intake={intake} onIntakeDone={()=>setIntake(null)}/>
      <TeacherSkins orbRef={orb} boardOpen={boardOpen} activeTestId={active.id}/>
      {boardOpen&&<Whiteboard key={active.id} interactive={false} board={active.whiteboard} viewCache={boardViews.current} viewScope={`${active.id}:${sourceVersion(active.materials)}`} onMeasure={measurement=>setBoardMeasure(previous=>previous?.revision===measurement.revision&&previous.width===measurement.width&&previous.height===measurement.height?previous:measurement)} selection={null} onClose={()=>showBoard(false)}/>}
      <PracticeTrail state={practiceState}/>
      {boardOpen&&<button className="tutor-presence" aria-label="Return to voice view" title="Return to voice view" data-state={voiceState} onClick={()=>showBoard(false)}/> }
      <div className={`voice-stage ${boardOpen?'board-mode':''}`}><button ref={orb} className="orb-button" tabIndex={boardOpen?-1:0} aria-hidden={boardOpen||undefined} onClick={()=>boardOpen?showBoard(false):toggleVoice()} aria-label={boardOpen?'Return to voice view':voiceState==='idle'?'Start voice session':'Pause voice session'}></button><AssistantCaptions text={subtitle} state={voiceState} visible={captions} error={voiceError} boardOpen={boardOpen} hostRef={studyScreen} onCapacity={limit=>session.current?.setCaptionMaxChars(limit)}/></div>
      {drag&&<div className="capture-hint">Release to add material</div>}
      <div className="study-dock"><div className="dock-left"><button className={`dock-button ${libraryOpen?'active':''}`} onClick={()=>setLibraryOpen(true)}><LibraryBig size={16}/><span>Library</span>{active.materials.length>0&&<span className="library-count">{active.materials.length}</span>}{(uploading[active.id]||active.indexStatus==='indexing')&&<LoaderCircle className="spin" size={12}/>}</button><HintButton state={hintState} voiceState={voiceState} onRequest={()=>session.current?.requestHint()}/></div><div className="dock-right">{active.whiteboard&&<button className="dock-button" aria-label="Open whiteboard" onClick={()=>showBoard(true)}><SquarePen size={17}/></button>}<button className="dock-button" onClick={()=>fileInput.current?.click()} disabled={!!uploading[active.id]} aria-label="Add material"><Plus size={18}/></button><button className="dock-button" onClick={toggleVoice} aria-label={voiceState==='idle'?'Start microphone':'Stop microphone'}>{voiceState==='idle'?<MicOff size={16}/>:<Mic size={16}/>}</button><button className={`dock-button ${captions?'':'muted'}`} aria-label={captions?'Hide subtitles':'Show subtitles'} aria-pressed={captions} onClick={()=>setCaptions(!captions)}><Captions size={18}/></button>{import.meta.env.DEV&&<button className="dock-button debug-usage" aria-label="Test usage and activity (debug)" onClick={()=>setUsageOpen(true)}><DollarSign size={14}/></button>}{import.meta.env.DEV&&<button className="dock-button debug-trace" aria-label="Learning trace (debug)" onClick={()=>setTraceOpen(true)}><Braces size={14}/></button>}</div></div>
      {presence?.paused&&<SessionPaused resuming={presence.resuming} error={presence.error} onResume={()=>void session.current?.resume()}/>}
      <input ref={fileInput} type="file" multiple accept={MATERIAL_ACCEPT} hidden aria-label="Upload material" onChange={e=>void addFiles(e.target.files)}/>
    </main>}
    {creating&&<CreateTest onClose={()=>setCreating(false)} onCreate={createTest}/>}
    {import.meta.env.DEV&&traceOpen&&active&&<LearningTrace testId={active.id} onClose={()=>setTraceOpen(false)}/>}
    {import.meta.env.DEV&&usageOpen&&active&&<UsageDebug testId={active.id} onClose={()=>setUsageOpen(false)}/>}
    {libraryOpen&&active&&<Library test={active} uploading={uploading[active.id]} onClose={()=>setLibraryOpen(false)} onAdd={()=>fileInput.current?.click()} onRemove={removeMaterial} onRetry={()=>void indexTest(active.id,active.materials)}/>}
    {notice&&<div className="toast" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss message" onClick={()=>setNotice('')}><X size={15}/></button></div>}
  </div>;
}

const root=createRoot(document.getElementById('root'));
if(location.pathname.replace(/\/$/,'')==='/mosaic-lab'){
  void import('./mosaic-lab/Lab.jsx').then(({default:Lab})=>root.render(<Lab/>));
}else if(location.pathname.replace(/\/$/,'')==='/course-mosaics'){
  void import('./course-mosaics/Gallery.jsx').then(({default:Gallery})=>root.render(<Gallery/>));
}else root.render(<App/>);

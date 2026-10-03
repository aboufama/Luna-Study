import React, { useEffect, useRef, useState } from 'react';
import { Braces, RefreshCw, X } from 'lucide-react';
import './learning-trace.css';
const label=value=>String(value||'unclassified').replaceAll('_',' ');
const time=value=>{try{return new Date(value).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}catch{return '';}};
function Tag({name,value}){return value?.label&&<span title={`${name} · classifier score ${Math.round((value.confidence||0)*100)}%`}>{name==='Confidence'?'Expressed ':''}{label(value.label)}</span>;}
export default function LearningTrace({testId,onClose}){
  const dialog=useRef(null),[data,setData]=useState(null),[error,setError]=useState(''),[role,setRole]=useState('all'),[query,setQuery]=useState(''),[refresh,setRefresh]=useState(0);
  useEffect(()=>{dialog.current.showModal();},[]);
  useEffect(()=>{
    let disposed=false,pending=false;const controller=new AbortController();
    async function load(){if(pending||document.hidden)return;pending=true;try{const response=await fetch('/api/debug/learning-trace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({testId}),signal:controller.signal});const value=await response.json();if(!response.ok)throw Error(value.error||'Could not read learning trace.');if(!disposed){setData(value);setError('');}}catch(err){if(!disposed&&!controller.signal.aborted)setError(err.message);}finally{pending=false;}}
    void load();const timer=setInterval(load,3000);return()=>{disposed=true;clearInterval(timer);controller.abort();};
  },[testId,refresh]);
  const sessions=data?.sessions||[],count=data?.summary?.sentences||0;
  return <dialog ref={dialog} className="learning-trace" aria-label="Learning trace debug" onCancel={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <header><div><span className="trace-eyebrow"><Braces size={12}/>Development only</span><h2>Learning trace</h2></div><button className="icon-button" onClick={onClose} aria-label="Close learning trace"><X size={17}/></button></header>
    <p className="trace-explanation">Sentence-level observations, quietly collected in the background. Only checked grades count toward mastery.</p>
    <div className="trace-tools"><select aria-label="Filter speaker" value={role} onChange={event=>setRole(event.target.value)}><option value="all">Everyone</option><option value="user">You</option><option value="assistant">Tutor</option></select><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Find a sentence or category" aria-label="Search learning trace"/><button className="icon-button" aria-label="Refresh learning trace" onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={14}/></button></div>
    <div className="trace-summary"><span>{count} sentences</span><span>{data?.summary?.classified||0} classified</span><span>{(data?.summary?.queued||0)+(data?.summary?.classifying||0)} pending</span></div>
    {error&&<p className="trace-message" role="alert">{error}</p>}
    {!count&&!error&&<p className="trace-message">New conversations will appear here sentence by sentence. Earlier sessions are kept in history; no background reprocessing has been started.</p>}
    {sessions.slice().reverse().map(session=>{
      const entries=session.entries.filter(entry=>(role==='all'||entry.role===role)&&`${entry.text} ${label(entry.classification?.category?.label||'')}`.toLowerCase().includes(query.toLowerCase()));
      if(!entries.length)return null;
      return <section className="trace-session" key={session.id}><h3>{new Date(session.startedAt).toLocaleDateString([],{month:'short',day:'numeric'})}<span>{time(session.startedAt)}{session.endedAt?` – ${time(session.endedAt)}`:' · Active'}</span></h3>{entries.map(entry=>{
        const c=entry.classification,checked=entry.checkedGrades||[];
        return <article className="trace-entry" key={entry.id}><div className="trace-entry-meta"><strong>{entry.role==='user'?'You':'Tutor'}</strong><time>{time(entry.at)}</time><span>{label(entry.status)}</span></div><p>{entry.text}</p><div className="trace-tags"><Tag name="Category" value={c?.category}/><Tag name="Confidence" value={c?.expressedConfidence}/>{checked.map((grade,index)=><span className="trace-checked" key={index}>Checked: {label(grade.verdict||grade.correctness)}</span>)}{!checked.length&&c?.proposedCorrectness?.label&&!['unknown','not_applicable','ungraded'].includes(c.proposedCorrectness.label)&&<span title="Jev's provisional classification. Not a checked grade or mastery result.">Provisional: {label(c.proposedCorrectness.label)}</span>}</div><details><summary>Details</summary><pre>{JSON.stringify({id:entry.id,turnId:entry.turnId,sentenceIndex:entry.sentenceIndex,offsets:[entry.start,entry.end],classification:c,checkedGrades:checked},null,2)}</pre></details></article>;
      })}</section>;
    })}
    <footer>No automatic retries · Classifier confidence is not a measure of your ability.</footer>
  </dialog>;
}

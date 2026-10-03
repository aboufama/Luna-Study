import React,{useEffect,useState} from 'react';
import {ListChecks,ChevronLeft,ChevronRight} from 'lucide-react';
import BoardRichText from './BoardRichText.jsx';
import './practice-trail.css';

export default function PracticeTrail({state}){
  const [open,setOpen]=useState(()=>window.matchMedia('(min-width:1280px)').matches);
  useEffect(()=>{const wide=window.matchMedia('(min-width:1280px)'),mobile=window.matchMedia('(max-width:600px)'),change=()=>setOpen(wide.matches);wide.addEventListener('change',change);mobile.addEventListener('change',change);return()=>{wide.removeEventListener('change',change);mobile.removeEventListener('change',change);};},[]);
  const current=state?.current,seen=new Set(),items=[];
  for(const item of [current&&{...current,status:'current'},...(state?.recent||[]).slice().reverse()]){
    if(!item||typeof item.questionId!=='string'||typeof item.question!=='string'||seen.has(item.questionId))continue;
    seen.add(item.questionId);items.push(item);
  }
  if(!items.length)return null;
  const statusText={current:'Working on',attempted:'Attempted',reviewed:'Reviewed',completed:'Checked','set-aside':'Set aside'};
  return <aside className={`practice-trail ${open?'is-open':''}`} aria-label="Practice problems">
    <button type="button" className="practice-trail-toggle" aria-label={open?'Collapse practice problems':'Show practice problems'} aria-expanded={open} aria-controls="practice-problem-list" onClick={()=>setOpen(!open)}><ListChecks size={16}/><span>Practice</span>{open?<ChevronLeft size={13}/>:<ChevronRight size={13}/>}</button>
    {open&&<div id="practice-problem-list" className="practice-trail-content"><ol>{items.slice(0,12).map(item=><li key={item.questionId} className={`practice-problem is-${item.status||'attempted'}`} aria-current={item.status==='current'?'step':undefined}><span className="practice-problem-dot" aria-hidden="true"/><div><span className="practice-problem-state">{statusText[item.status]||'Attempted'}</span>{item.topicTitle&&<h3>{item.topicTitle}</h3>}<p><BoardRichText text={item.question}/></p></div></li>)}</ol></div>}
  </aside>;
}

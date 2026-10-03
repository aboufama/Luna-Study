import React,{useEffect,useId,useState} from 'react';
import {Lightbulb} from 'lucide-react';
import {hintView} from './hint-state.mjs';
import './hint.css';

export default function HintButton({state,voiceState,onRequest}){
  const [now,setNow]=useState(()=>performance.now()),descriptionId=useId();
  useEffect(()=>{
    setNow(performance.now());if(!state||state.retryAt<=performance.now())return;
    const timer=setInterval(()=>{const next=performance.now();setNow(next);if(next>=state.retryAt)clearInterval(timer);},1000);
    return()=>clearInterval(timer);
  },[state?.receivedAt,state?.retryAt]);
  const view=hintView(state,{voiceState,now});
  return <span className="hint-control">
    <button type="button" className={`dock-button hint-button ${view.suggested?'is-suggested':''}`} aria-label="Request hint" aria-describedby={descriptionId} title={view.description} disabled={!view.available} onClick={onRequest}><Lightbulb size={17}/><span className="hint-label">Hint</span>{state?.questionId&&<span className="hint-count" aria-hidden="true">{view.seconds?`${view.seconds}s`:view.remaining}</span>}</button>
    <span id={descriptionId} className="hint-sr-only">{view.description}</span>
    <span className="hint-sr-only" role="status">{view.suggested?'Luna suggests a hint. Use the Hint button when you are ready.':''}</span>
  </span>;
}
